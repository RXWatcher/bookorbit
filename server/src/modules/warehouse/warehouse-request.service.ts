import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  type WarehouseMediaType,
  type WarehouseAudiobookExternalSearchPage,
  type WarehouseAudiobookQueueItem,
  type WarehouseAudiobookQueuePage,
  WarehouseEbookExternalSearchPage,
  WarehouseExternalBookSearchResult,
  type WarehouseExternalAudiobookSearchResult,
  WarehouseRequestDetail,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
  type WarehouseRequestStatus,
} from '@bookorbit/types';

import type { WarehouseRequestRow } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { NotificationService } from '../notification/notification.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseClientService, type WarehouseBinaryResponse } from './warehouse-client.service';
import { REQUEST_FALLBACK_TITLE, mapWarehouseRequestRow, normalizeWarehouseRequestStatus } from './warehouse-request.mapper';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService, type EncryptedWarehouseSecret } from './warehouse-secret.service';

const EBOOK_MEDIA_TYPE = 'ebook' as const;
const AUDIOBOOK_MEDIA_TYPE = 'audiobook' as const;
const COMIC_MEDIA_TYPE = 'comic' as const;
const REQUESTS_UNAVAILABLE_MESSAGE = 'Requests are temporarily unavailable.';
const REQUEST_NOT_AVAILABLE_MESSAGE = 'Request is not available.';
const STREAM_NOT_AVAILABLE_MESSAGE = 'Request stream is not available.';
const SEARCH_QUERY_REQUIRED_MESSAGE = 'Search query is required.';
const SUBMIT_TARGET_REQUIRED_MESSAGE = 'Either isbn or searchResult is required.';
const SUBMIT_AUDIOBOOK_TITLE_REQUIRED_MESSAGE = 'Title is required.';
const SUBMIT_AUDIOBOOK_AUTHOR_INVALID_MESSAGE = 'Author is not valid.';
const SUBMIT_COMIC_TITLE_REQUIRED_MESSAGE = 'Series title is required.';
const AUDIOBOOK_SYNC_LOOKUP_LIMIT = 100;
const AUDIOBOOK_QUEUE_LOOKUP_LIMIT = 100;
const FORBIDDEN_PUBLIC_TEXT_PATTERNS = [
  /\bbook\s+warehouse\b/i,
  /\bwarehouse\b/i,
  /\bcatalog[-\s]+source\b/i,
  /\bsource\b/i,
  /\bupstream\b/i,
  /\bthird[-\s]+party\b/i,
  /\bprovider\b/i,
  /\bvendor\b/i,
  /\/media\//i,
  /\bceph:\/\//i,
];
const URL_PATTERN = /https?:\/\/\S+/i;
const HOSTNAME_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|\b)/i;
const OPAQUE_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/;
const SECRET_TEXT_PATTERNS = [/\bapi[\s_-]*key\b/i, /\bx[\s_-]*api[\s_-]*key\b/i, /\bbearer\s+\S+/i, /\bauthorization\s*:/i];

type UpstreamCredentials = {
  baseUrl: string;
  apiKey: string;
};

type EbookRequestPayload = {
  isbn?: string;
  preferredFormat?: string;
  searchResult?: Record<string, unknown>;
};

type UpstreamBookRequest = Awaited<ReturnType<WarehouseClientService['requestBook']>>;
type UpstreamAudiobookRequest = Awaited<ReturnType<WarehouseClientService['requestAudiobook']>>;
type UpstreamAudiobookRequestRow = Awaited<ReturnType<WarehouseClientService['listAudiobookRequests']>>[number];
type UpstreamComicRequestRow = Awaited<ReturnType<WarehouseClientService['listComicRequests']>>[number];
type RequestMirrorUpdate = Parameters<WarehouseRepository['updateOpenRequestMirror']>[2];

type AudiobookRequestPayload = {
  title?: string;
  author?: string;
};

type ComicRequestPayload = {
  seriesTitle?: string;
  issueNumber?: string;
  publisher?: string;
  year?: number;
};

@Injectable()
export class WarehouseRequestService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly client: WarehouseClientService,
    private readonly secret: WarehouseSecretService,
    private readonly notifications: NotificationService,
    private readonly catalogSync: WarehouseCatalogSyncService,
  ) {}

  async searchExternalBooks(q: string): Promise<WarehouseEbookExternalSearchPage> {
    const query = q.trim();
    if (!query) {
      throw new BadRequestException(SEARCH_QUERY_REQUIRED_MESSAGE);
    }

    const credentials = await this.credentials();

    try {
      const page = await this.client.searchExternalBooks({ ...credentials, q: query });
      return {
        results: page.results.map(safeExternalBookSearchResult).filter((result): result is WarehouseExternalBookSearchResult => result !== null),
      };
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }
  }

  async submitEbookRequest(user: RequestUser, payload: EbookRequestPayload): Promise<WarehouseRequestDetail> {
    const requestPayload = normalizeSubmitPayload(payload);
    if (!requestPayload.isbn && !requestPayload.searchResult) {
      throw new BadRequestException(SUBMIT_TARGET_REQUIRED_MESSAGE);
    }

    const credentials = await this.credentials();

    let upstream: UpstreamBookRequest;
    try {
      upstream = await this.client.requestBook({
        ...credentials,
        ...(requestPayload.isbn ? { isbn: requestPayload.isbn } : {}),
        ...(requestPayload.preferredFormat ? { preferred_format: requestPayload.preferredFormat } : {}),
        ...(requestPayload.searchResult ? { search_result: requestPayload.searchResult } : {}),
      });
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    const row = await this.repository.upsertRequestMirror({
      mediaType: EBOOK_MEDIA_TYPE,
      userId: user.id,
      upstreamRequestId: stringValue(upstream.id),
      status: stringValue(upstream.status),
      title: requestTitle(upstream, requestPayload),
      author: safePublicText(upstream.author) ?? searchResultAuthor(requestPayload.searchResult),
      isbn: safePublicText(upstream.isbn) ?? requestPayload.isbn ?? searchResultIsbn(requestPayload.searchResult),
      completedRemoteId: completedRemoteId(upstream) ?? null,
      lastStatusSyncedAt: new Date(),
      requestedPayload: requestPayload as Record<string, unknown>,
    });

    if (!row) {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    return mapWarehouseRequestRow(row);
  }

  async searchAudiobooks(q: string): Promise<WarehouseAudiobookExternalSearchPage> {
    const query = q.trim();
    if (!query) {
      throw new BadRequestException(SEARCH_QUERY_REQUIRED_MESSAGE);
    }

    const credentials = await this.credentials();

    try {
      const page = await this.client.searchExternalAudiobooks({ ...credentials, q: query });
      return safeAudiobookSearchPage(page.results as unknown[]);
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }
  }

  async searchAudiobookCandidates(q: string): Promise<WarehouseAudiobookExternalSearchPage> {
    const query = q.trim();
    if (!query) {
      throw new BadRequestException(SEARCH_QUERY_REQUIRED_MESSAGE);
    }

    const credentials = await this.credentials();

    try {
      const page = await this.client.searchAbiplayerAudiobooks({ ...credentials, q: query });
      return safeAudiobookSearchPage(page.results as unknown[]);
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }
  }

  async submitAudiobookRequest(user: RequestUser, payload: AudiobookRequestPayload): Promise<WarehouseRequestDetail> {
    const requestPayload = normalizeAudiobookSubmitPayload(payload);
    const credentials = await this.credentials();

    let upstream: UpstreamAudiobookRequest;
    try {
      upstream = await this.client.requestAudiobook({
        ...credentials,
        title: requestPayload.title,
        ...(requestPayload.author ? { author: requestPayload.author } : {}),
      });
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    const row = await this.repository.upsertRequestMirror({
      mediaType: AUDIOBOOK_MEDIA_TYPE,
      userId: user.id,
      upstreamRequestId: safePrivateIdentifier(upstream.id) ?? null,
      status: stringValue(upstream.status),
      title: safePublicText(upstream.title) ?? requestPayload.title,
      author: safePublicText(upstream.author) ?? requestPayload.author ?? null,
      isbn: null,
      completedRemoteId: null,
      lastStatusSyncedAt: new Date(),
      requestedPayload: requestPayload,
    });

    if (!row) {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    return mapWarehouseRequestRow(row);
  }

  async submitComicRequest(user: RequestUser, payload: ComicRequestPayload): Promise<WarehouseRequestDetail> {
    const requestPayload = normalizeComicSubmitPayload(payload);
    const credentials = await this.credentials();

    let upstream: UpstreamBookRequest;
    try {
      upstream = await this.client.requestComic({
        ...credentials,
        seriesTitle: requestPayload.seriesTitle,
        ...(requestPayload.issueNumber ? { issueNumber: requestPayload.issueNumber } : {}),
        ...(requestPayload.publisher ? { publisher: requestPayload.publisher } : {}),
        ...(requestPayload.year ? { year: requestPayload.year } : {}),
      });
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    const title = comicRequestTitle(requestPayload);
    const row = await this.repository.upsertRequestMirror({
      mediaType: COMIC_MEDIA_TYPE,
      userId: user.id,
      upstreamRequestId: safePrivateIdentifier(upstream.id) ?? null,
      status: stringValue(upstream.status),
      title: safePublicText(upstream.title) ?? title,
      author: safePublicText(upstream.author) ?? requestPayload.publisher ?? null,
      isbn: null,
      completedRemoteId: completedRemoteId(upstream) ?? null,
      lastStatusSyncedAt: new Date(),
      requestedPayload: requestPayload,
    });

    if (!row) {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    return mapWarehouseRequestRow(row);
  }

  async listRequests(user: RequestUser, query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
    if (query.mediaType === AUDIOBOOK_MEDIA_TYPE) {
      return this.listAudiobookRequests(user, query);
    }

    if (query.mediaType === COMIC_MEDIA_TYPE) {
      return this.listComicRequests(user, query);
    }

    const page = await this.repository.listRequestsForUser(user.id, { ...query, mediaType: EBOOK_MEDIA_TYPE });

    return {
      items: page.rows.map(mapWarehouseRequestRow),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  async listAudiobookRequests(user: RequestUser, query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
    await this.syncAudiobookRequests(user);

    return this.listLocalAudiobookRequests(user, query);
  }

  async listComicRequests(user: RequestUser, query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
    await this.syncComicRequests(user);

    return this.listLocalComicRequests(user, query);
  }

  async listLocalComicRequests(user: RequestUser, query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
    const page = await this.repository.listRequestsForUser(user.id, { ...query, mediaType: COMIC_MEDIA_TYPE });

    return {
      items: page.rows.map(mapWarehouseRequestRow),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  async refreshAudiobookRequests(user: RequestUser, query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
    await this.syncAudiobookRequests(user);

    return this.listLocalAudiobookRequests(user, query);
  }

  async refreshComicRequests(user: RequestUser, query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
    await this.syncComicRequests(user);

    return this.listLocalComicRequests(user, query);
  }

  async getAudiobookQueue(user: RequestUser): Promise<WarehouseAudiobookQueuePage> {
    const localPage = await this.repository.listRequestsForUser(user.id, { mediaType: AUDIOBOOK_MEDIA_TYPE, limit: AUDIOBOOK_QUEUE_LOOKUP_LIMIT });
    const localByUpstreamId = new Map<string, WarehouseRequestRow>();

    for (const row of localPage.rows) {
      const upstreamRequestId = trimmedString(row.upstreamRequestId);
      if (upstreamRequestId) {
        localByUpstreamId.set(upstreamRequestId, row);
      }
    }

    if (localByUpstreamId.size === 0) {
      return { items: [] };
    }

    const credentials = await this.credentials();

    try {
      const rows = await this.client.listAudiobookRequestQueue({ ...credentials, limit: AUDIOBOOK_QUEUE_LOOKUP_LIMIT });
      return {
        items: rows
          .slice(0, AUDIOBOOK_QUEUE_LOOKUP_LIMIT)
          .map((row) => {
            const local = localByUpstreamId.get(trimmedString(row.id) ?? '');
            return local ? safeAudiobookQueueItem(local, row) : null;
          })
          .filter((item): item is WarehouseAudiobookQueueItem => item !== null),
      };
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }
  }

  async getRequest(user: RequestUser, id: number): Promise<WarehouseRequestDetail> {
    return mapWarehouseRequestRow(await this.findUserRequest(user, id));
  }

  async refreshRequest(user: RequestUser, id: number): Promise<WarehouseRequestDetail> {
    const existing = await this.findUserRequest(user, id);
    if (!existing.upstreamRequestId) {
      return mapWarehouseRequestRow(existing);
    }

    const credentials = await this.credentials();
    let upstream: UpstreamBookRequest;

    try {
      upstream = await this.client.getBookRequest({ ...credentials, id: existing.upstreamRequestId });
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    const update = mirrorUpdateFromUpstream(upstream);
    const row = await this.updateOpenRequestMirror(existing.id, { userId: user.id, mediaType: EBOOK_MEDIA_TYPE }, update);
    if (!row) {
      return mapWarehouseRequestRow(await this.findUserRequest(user, id));
    }

    const catalogSyncNeeded = new Set<WarehouseMediaType>();
    await this.collectCatalogSyncIfMissing(
      EBOOK_MEDIA_TYPE,
      normalizeWarehouseRequestStatus(update.status ?? row.status),
      update.completedRemoteId ?? row.completedRemoteId,
      catalogSyncNeeded,
    );
    await this.runCatalogSyncs(catalogSyncNeeded);

    return mapWarehouseRequestRow(row);
  }

  async cancelRequest(user: RequestUser, id: number): Promise<WarehouseRequestDetail> {
    const existing = await this.findUserRequest(user, id);

    if (existing.upstreamRequestId) {
      const credentials = await this.credentials();
      try {
        await this.client.cancelBookRequest({ ...credentials, id: existing.upstreamRequestId });
      } catch {
        throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
      }
    }

    const row = await this.repository.deleteRequestMirror(id, user.id);
    if (!row) {
      throw new NotFoundException(REQUEST_NOT_AVAILABLE_MESSAGE);
    }

    return mapWarehouseRequestRow(row);
  }

  async streamRequest(user: RequestUser, id: number): Promise<WarehouseBinaryResponse> {
    const existing = await this.findUserRequest(user, id);
    const upstreamRequestId = trimmedString(existing.upstreamRequestId);

    if (normalizeWarehouseRequestStatus(existing.status) !== 'completed' || !upstreamRequestId) {
      throw new NotFoundException(STREAM_NOT_AVAILABLE_MESSAGE);
    }

    const credentials = await this.credentials();

    try {
      return await this.client.streamBookRequest({ ...credentials, id: upstreamRequestId });
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }
  }

  private async findUserRequest(user: RequestUser, id: number): Promise<WarehouseRequestRow> {
    const row = await this.repository.findRequestForUser(id, user.id);
    if (!row || row.mediaType !== EBOOK_MEDIA_TYPE) {
      throw new NotFoundException(REQUEST_NOT_AVAILABLE_MESSAGE);
    }

    return row;
  }

  private async listLocalAudiobookRequests(user: RequestUser, query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
    const page = await this.repository.listRequestsForUser(user.id, { ...query, mediaType: AUDIOBOOK_MEDIA_TYPE });

    return {
      items: page.rows.map(mapWarehouseRequestRow),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  private async syncAudiobookRequests(user: RequestUser): Promise<void> {
    const localPage = await this.repository.listRequestsForUser(user.id, { mediaType: AUDIOBOOK_MEDIA_TYPE, limit: AUDIOBOOK_SYNC_LOOKUP_LIMIT });
    const localByUpstreamId = new Map<string, WarehouseRequestRow>();

    for (const row of localPage.rows) {
      const upstreamRequestId = trimmedString(row.upstreamRequestId);
      if (upstreamRequestId) {
        localByUpstreamId.set(upstreamRequestId, row);
      }
    }

    if (localByUpstreamId.size === 0) {
      return;
    }

    const credentials = await this.credentials();
    let upstreamRows: UpstreamAudiobookRequestRow[];
    const catalogSyncNeeded = new Set<WarehouseMediaType>();

    try {
      upstreamRows = await this.client.listAudiobookRequests({
        ...credentials,
        limit: AUDIOBOOK_SYNC_LOOKUP_LIMIT,
      });
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    for (const upstream of upstreamRows) {
      const upstreamRequestId = trimmedString(upstream.id);
      if (!upstreamRequestId) {
        continue;
      }

      const existing = localByUpstreamId.get(upstreamRequestId);
      if (!existing) {
        continue;
      }

      const update = audiobookSyncUpdateFromUpstream(upstream);
      const previousStatus = normalizeWarehouseRequestStatus(existing.status);
      if (isTerminalRequestStatus(previousStatus)) {
        continue;
      }

      const nextStatus = normalizeWarehouseRequestStatus(update.status);
      const shouldNotify = shouldNotifyAudiobookStatusTransition(previousStatus, nextStatus);
      const updated = await this.updateOpenRequestMirror(existing.id, { userId: user.id, mediaType: AUDIOBOOK_MEDIA_TYPE }, update);

      if (updated && shouldNotify) {
        await this.notifyAudiobookStatusTransition(existing, nextStatus, user.id);
      }

      if (updated) {
        await this.collectCatalogSyncIfMissing(
          AUDIOBOOK_MEDIA_TYPE,
          nextStatus,
          update.completedRemoteId ?? updated.completedRemoteId,
          catalogSyncNeeded,
        );
      }
    }

    await this.runCatalogSyncs(catalogSyncNeeded);
  }

  private async syncComicRequests(user: RequestUser): Promise<void> {
    const localPage = await this.repository.listRequestsForUser(user.id, { mediaType: COMIC_MEDIA_TYPE, limit: AUDIOBOOK_SYNC_LOOKUP_LIMIT });
    const localByUpstreamId = new Map<string, WarehouseRequestRow>();

    for (const row of localPage.rows) {
      const upstreamRequestId = trimmedString(row.upstreamRequestId);
      if (upstreamRequestId) {
        localByUpstreamId.set(upstreamRequestId, row);
      }
    }

    if (localByUpstreamId.size === 0) {
      return;
    }

    const credentials = await this.credentials();
    let upstreamRows: UpstreamComicRequestRow[];
    const catalogSyncNeeded = new Set<WarehouseMediaType>();

    try {
      upstreamRows = await this.client.listComicRequests({
        ...credentials,
        limit: AUDIOBOOK_SYNC_LOOKUP_LIMIT,
      });
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    for (const upstream of upstreamRows) {
      const upstreamRequestId = trimmedString(upstream.id);
      if (!upstreamRequestId) {
        continue;
      }

      const existing = localByUpstreamId.get(upstreamRequestId);
      if (!existing) {
        continue;
      }

      const update = comicSyncUpdateFromUpstream(upstream);
      const previousStatus = normalizeWarehouseRequestStatus(existing.status);
      if (isTerminalRequestStatus(previousStatus)) {
        continue;
      }

      const nextStatus = normalizeWarehouseRequestStatus(update.status);
      const shouldNotify = shouldNotifyAudiobookStatusTransition(previousStatus, nextStatus);
      const updated = await this.updateOpenRequestMirror(existing.id, { userId: user.id, mediaType: COMIC_MEDIA_TYPE }, update);

      if (updated && shouldNotify) {
        await this.notifyRequestStatusTransition(existing, nextStatus, user.id, COMIC_MEDIA_TYPE, 'Your comic request');
      }

      if (updated) {
        await this.collectCatalogSyncIfMissing(
          COMIC_MEDIA_TYPE,
          nextStatus,
          update.completedRemoteId ?? updated.completedRemoteId,
          catalogSyncNeeded,
        );
      }
    }

    await this.runCatalogSyncs(catalogSyncNeeded);
  }

  private updateOpenRequestMirror(
    id: number,
    scope: { userId: number; mediaType: WarehouseMediaType },
    update: RequestMirrorUpdate,
  ): Promise<WarehouseRequestRow | undefined> {
    return this.repository.updateOpenRequestMirror(id, scope, update);
  }

  private async notifyAudiobookStatusTransition(row: WarehouseRequestRow, status: 'completed' | 'failed', userId: number): Promise<void> {
    return this.notifyRequestStatusTransition(row, status, userId, AUDIOBOOK_MEDIA_TYPE, 'Your audiobook request');
  }

  private async notifyRequestStatusTransition(
    row: WarehouseRequestRow,
    status: 'completed' | 'failed',
    userId: number,
    mediaType: WarehouseMediaType,
    fallbackTitle: string,
  ): Promise<void> {
    const completed = status === 'completed';
    const title = completed ? 'Request completed' : 'Request failed';
    const safeTitle = safePublicText(row.title) ?? fallbackTitle;

    try {
      await this.notifications.notify({
        type: completed ? NotificationType.CatalogRequestCompleted : NotificationType.CatalogRequestFailed,
        title,
        message: completed ? `${safeTitle} is ready.` : `${safeTitle} could not be completed.`,
        actionUrl: '/requests',
        meta: {
          requestId: row.id,
          mediaType,
          status,
        },
        scope: { kind: 'user', userId },
      });
    } catch {
      return;
    }
  }

  private async collectCatalogSyncIfMissing(
    mediaType: WarehouseMediaType,
    status: WarehouseRequestStatus,
    remoteId: unknown,
    catalogSyncNeeded: Set<WarehouseMediaType>,
  ): Promise<void> {
    const safeRemoteId = safePrivateIdentifier(remoteId);
    if (status !== 'completed' || !safeRemoteId || catalogSyncNeeded.has(mediaType)) {
      return;
    }

    try {
      const existing = await this.repository.findCatalogItem(mediaType, safeRemoteId);
      if (!existing) {
        catalogSyncNeeded.add(mediaType);
      }
    } catch {
      return;
    }
  }

  private async runCatalogSyncs(mediaTypes: Set<WarehouseMediaType>): Promise<void> {
    for (const mediaType of [EBOOK_MEDIA_TYPE, AUDIOBOOK_MEDIA_TYPE, COMIC_MEDIA_TYPE] as const) {
      if (!mediaTypes.has(mediaType)) {
        continue;
      }

      try {
        if (mediaType === EBOOK_MEDIA_TYPE) {
          await this.catalogSync.syncEbooks();
        } else if (mediaType === AUDIOBOOK_MEDIA_TYPE) {
          await this.catalogSync.syncAudiobooks();
        } else {
          await this.catalogSync.syncComics();
        }
      } catch {
        continue;
      }
    }
  }

  private async credentials(): Promise<UpstreamCredentials> {
    let settings: Awaited<ReturnType<WarehouseRepository['findSettings']>>;

    try {
      settings = await this.repository.findSettings();
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    if (!settings?.enabled) {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    const encryptedSecret = encryptedSecretFromSettings(settings);
    if (!encryptedSecret) {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }

    try {
      return {
        baseUrl: settings.baseUrl,
        apiKey: this.secret.decrypt(encryptedSecret),
      };
    } catch {
      throw new BadGatewayException(REQUESTS_UNAVAILABLE_MESSAGE);
    }
  }
}

function encryptedSecretFromSettings(settings: {
  apiKeyEncrypted: string | null;
  apiKeyNonce: string | null;
  apiKeyTag: string | null;
}): EncryptedWarehouseSecret | null {
  if (!settings.apiKeyEncrypted || !settings.apiKeyNonce || !settings.apiKeyTag) {
    return null;
  }

  return {
    ciphertext: settings.apiKeyEncrypted,
    nonce: settings.apiKeyNonce,
    tag: settings.apiKeyTag,
  };
}

function normalizeSubmitPayload(payload: EbookRequestPayload): EbookRequestPayload {
  const isbn = trimmedString(payload.isbn);
  const preferredFormat = trimmedString(payload.preferredFormat);
  const searchResult = hasSearchResultTarget(payload.searchResult) ? payload.searchResult : undefined;

  return {
    ...(isbn ? { isbn } : {}),
    ...(preferredFormat ? { preferredFormat } : {}),
    ...(searchResult ? { searchResult } : {}),
  };
}

function normalizeAudiobookSubmitPayload(payload: AudiobookRequestPayload): { title: string; author?: string } {
  const title = safePublicText(payload.title);
  if (!title) {
    throw new BadRequestException(SUBMIT_AUDIOBOOK_TITLE_REQUIRED_MESSAGE);
  }

  const rawAuthor = trimmedString(payload.author);
  if (!rawAuthor) {
    return { title };
  }

  const author = safePublicText(rawAuthor);
  if (!author) {
    throw new BadRequestException(SUBMIT_AUDIOBOOK_AUTHOR_INVALID_MESSAGE);
  }

  return { title, author };
}

function normalizeComicSubmitPayload(payload: ComicRequestPayload): { seriesTitle: string; issueNumber?: string; publisher?: string; year?: number } {
  const seriesTitle = safePublicText(payload.seriesTitle);
  if (!seriesTitle) {
    throw new BadRequestException(SUBMIT_COMIC_TITLE_REQUIRED_MESSAGE);
  }

  const issueNumber = safePublicText(payload.issueNumber);
  const publisher = safePublicText(payload.publisher);
  const year = typeof payload.year === 'number' && Number.isInteger(payload.year) ? payload.year : undefined;

  return {
    seriesTitle,
    ...(issueNumber !== undefined ? { issueNumber } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(year !== undefined ? { year } : {}),
  };
}

function safeExternalBookSearchResult(result: WarehouseExternalBookSearchResult): WarehouseExternalBookSearchResult | null {
  const title = safePublicText(result.title);
  if (!title) {
    return null;
  }

  const author = safePublicText(result.author);
  const isbn = safePublicText(result.isbn);

  return {
    title,
    ...(author !== undefined ? { author } : {}),
    ...(isbn !== undefined ? { isbn } : {}),
  };
}

function mirrorUpdateFromUpstream(upstream: UpstreamBookRequest) {
  const upstreamRequestId = trimmedString(upstream.id);
  const title = safePublicText(upstream.title);
  const author = safePublicText(upstream.author);
  const isbn = safePublicText(upstream.isbn);
  const remoteId = completedRemoteId(upstream);

  return {
    status: stringValue(upstream.status),
    ...(upstreamRequestId !== undefined ? { upstreamRequestId } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(isbn !== undefined ? { isbn } : {}),
    ...(remoteId !== undefined ? { completedRemoteId: remoteId } : {}),
    lastStatusSyncedAt: new Date(),
  };
}

function audiobookSyncUpdateFromUpstream(upstream: UpstreamAudiobookRequestRow) {
  const title = safePublicText(upstream.title);
  const author = safePublicText(upstream.author);
  const remoteId = completedRemoteId(upstream);

  return {
    status: stringValue(upstream.status),
    ...(title !== undefined ? { title } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(remoteId !== undefined ? { completedRemoteId: remoteId } : {}),
    lastStatusSyncedAt: new Date(),
  };
}

function comicSyncUpdateFromUpstream(upstream: UpstreamComicRequestRow) {
  const title = safePublicText(upstream.title);
  const author = safePublicText(upstream.author);
  const remoteId = completedRemoteId(upstream);

  return {
    status: stringValue(upstream.status),
    ...(title !== undefined ? { title } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(remoteId !== undefined ? { completedRemoteId: remoteId } : {}),
    lastStatusSyncedAt: new Date(),
  };
}

function safeAudiobookSearchPage(results: unknown[]): WarehouseAudiobookExternalSearchPage {
  return {
    results: results
      .map((result) => safeExternalAudiobookSearchResult(result))
      .filter((result): result is WarehouseExternalAudiobookSearchResult => result !== null),
  };
}

function safeExternalAudiobookSearchResult(value: unknown): WarehouseExternalAudiobookSearchResult | null {
  const result = isRecord(value) ? value : {};
  const title = safePublicText(result.title);
  if (!title) {
    return null;
  }

  const author = safePublicText(result.author);
  const authors = safePublicTextList(result.authors);
  const narrators = safePublicTextList(result.narrators);
  const asin = safePublicText(result.asin);
  const series = safePublicText(result.series);
  const durationSeconds = nonNegativeNumber(result.durationSeconds ?? result.duration_seconds ?? result.duration);

  return {
    title,
    ...(author !== undefined ? { author } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(narrators.length > 0 ? { narrators } : {}),
    ...(asin !== undefined ? { asin } : {}),
    ...(series !== undefined ? { series } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
}

function safeAudiobookQueueItem(local: WarehouseRequestRow, row: UpstreamAudiobookRequestRow): WarehouseAudiobookQueueItem {
  const title = safePublicText(local.title) ?? REQUEST_FALLBACK_TITLE;
  const author = safePublicText(local.author);

  return {
    title,
    ...(author !== undefined ? { author } : {}),
    status: normalizeWarehouseRequestStatus(row.status),
  };
}

function safePublicTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => safePublicText(entry)).filter((entry): entry is string => entry !== undefined);
}

function nonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

function shouldNotifyAudiobookStatusTransition(
  previousStatus: WarehouseRequestStatus,
  nextStatus: WarehouseRequestStatus,
): nextStatus is 'completed' | 'failed' {
  return (
    (previousStatus === 'pending' || previousStatus === 'processing' || previousStatus === 'unknown') &&
    (nextStatus === 'completed' || nextStatus === 'failed')
  );
}

function isTerminalRequestStatus(status: WarehouseRequestStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function requestTitle(upstream: UpstreamBookRequest, payload: EbookRequestPayload): string {
  return safePublicText(upstream.title) ?? safePublicText(payload.searchResult?.title) ?? payload.isbn ?? REQUEST_FALLBACK_TITLE;
}

function comicRequestTitle(payload: { seriesTitle: string; issueNumber?: string }): string {
  return payload.issueNumber ? `${payload.seriesTitle} #${payload.issueNumber}` : payload.seriesTitle;
}

function searchResultAuthor(searchResult: EbookRequestPayload['searchResult']): string | null {
  return safePublicText(searchResult?.author) ?? safePublicText(firstArrayValue(searchResult?.authors)) ?? null;
}

function searchResultIsbn(searchResult: EbookRequestPayload['searchResult']): string | null {
  return safePublicText(searchResult?.isbn) ?? safePublicText(searchResult?.isbn13) ?? safePublicText(searchResult?.isbn_13) ?? null;
}

function completedRemoteId(upstream: unknown): string | undefined {
  const source = isRecord(upstream) ? upstream : {};

  return (
    safePrivateIdentifier(source.completedRemoteId) ??
    safePrivateIdentifier(source.completed_remote_id) ??
    safePrivateIdentifier(source.remoteId) ??
    safePrivateIdentifier(source.remote_id)
  );
}

function firstArrayValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringValue(value: unknown): string | null {
  return trimmedString(value) ?? null;
}

function safePublicText(value: unknown): string | undefined {
  const text = trimmedString(value);
  if (!text || looksUnsafePublicValue(text)) {
    return undefined;
  }

  return text;
}

function safePrivateIdentifier(value: unknown): string | undefined {
  const text = trimmedString(value);
  if (!text || URL_PATTERN.test(text) || HOSTNAME_PATTERN.test(text)) {
    return undefined;
  }

  const normalized = text.toLowerCase();
  if (SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return undefined;
  }

  return text;
}

function looksUnsafePublicValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    URL_PATTERN.test(value) ||
    HOSTNAME_PATTERN.test(value) ||
    OPAQUE_TOKEN_PATTERN.test(value) ||
    SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    FORBIDDEN_PUBLIC_TEXT_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasSearchResultTarget(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return Boolean(trimmedString(value.title) ?? trimmedString(value.isbn) ?? trimmedString(value.isbn13) ?? trimmedString(value.isbn_13));
}
