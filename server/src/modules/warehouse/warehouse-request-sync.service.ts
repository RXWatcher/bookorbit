import { Injectable } from '@nestjs/common';
import { NotificationType, type WarehouseMediaType, type WarehouseRequestStatus } from '@bookorbit/types';
import type { WarehouseRequestRow, WarehouseSettingRow } from '../../db/schema';

import { NotificationService } from '../notification/notification.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseClientService } from './warehouse-client.service';
import { normalizeWarehouseRequestStatus } from './warehouse-request.mapper';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService, type EncryptedWarehouseSecret } from './warehouse-secret.service';

const REQUEST_SYNC_LIMIT = 100;
const EBOOK_MEDIA_TYPE = 'ebook' as const;
const AUDIOBOOK_MEDIA_TYPE = 'audiobook' as const;
const COMIC_MEDIA_TYPE = 'comic' as const;
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

export type WarehouseRequestSyncSummary = {
  status: 'skipped' | 'completed' | 'failed';
  scannedCount: number;
  updatedCount: number;
  notifiedCount: number;
  catalogSyncCount: number;
  errorCount: number;
  skippedReason?: 'disabled' | 'missing-credentials' | 'unreadable-credentials' | 'no-candidates';
};

type UpstreamCredentials = {
  baseUrl: string;
  apiKey: string;
};
type SyncCandidate = {
  row: WarehouseRequestRow;
  upstreamRequestId: string;
  userId: number;
};
type UpstreamRequestRow =
  | Awaited<ReturnType<WarehouseClientService['listBookRequests']>>[number]
  | Awaited<ReturnType<WarehouseClientService['listAudiobookRequests']>>[number];
type RequestMirrorUpdate = Parameters<WarehouseRepository['updateRequestMirror']>[2];
type CredentialResult =
  | { status: 'ready'; credentials: UpstreamCredentials; settings: WarehouseSettingRow }
  | { status: 'skipped'; reason: NonNullable<WarehouseRequestSyncSummary['skippedReason']> };

@Injectable()
export class WarehouseRequestSyncService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly client: WarehouseClientService,
    private readonly secrets: WarehouseSecretService,
    private readonly notifications: NotificationService,
    private readonly catalogSync: WarehouseCatalogSyncService,
  ) {}

  async syncDueRequests(now = new Date()): Promise<WarehouseRequestSyncSummary> {
    const credentialResult = await this.credentials();
    if (credentialResult.status === 'skipped') {
      return skippedSummary(credentialResult.reason);
    }

    const cadenceMinutes = Math.max(0, credentialResult.settings.syncCadenceMinutes);
    const staleBefore = new Date(now.getTime() - cadenceMinutes * 60_000);

    return this.syncRequests(credentialResult.credentials, { staleBefore, now });
  }

  async syncAllOpenRequests(now = new Date()): Promise<WarehouseRequestSyncSummary> {
    const credentialResult = await this.credentials();
    if (credentialResult.status === 'skipped') {
      return skippedSummary(credentialResult.reason);
    }

    return this.syncRequests(credentialResult.credentials, { now });
  }

  private async syncRequests(credentials: UpstreamCredentials, options: { now: Date; staleBefore?: Date }): Promise<WarehouseRequestSyncSummary> {
    const candidates = await this.repository.listRequestMirrorsForSync({
      ...(options.staleBefore ? { staleBefore: options.staleBefore } : {}),
      limit: REQUEST_SYNC_LIMIT,
    });

    if (candidates.length === 0) {
      return skippedSummary('no-candidates');
    }

    const summary = completedSummary(candidates.length);
    const validCandidates = candidates.map((row) => syncCandidate(row)).filter((candidate): candidate is SyncCandidate => candidate !== null);
    const ebookCandidates = validCandidates.filter((candidate) => candidate.row.mediaType === EBOOK_MEDIA_TYPE);
    const audiobookCandidates = validCandidates.filter((candidate) => candidate.row.mediaType === AUDIOBOOK_MEDIA_TYPE);
    const comicCandidates = validCandidates.filter((candidate) => candidate.row.mediaType === COMIC_MEDIA_TYPE);
    const upstreamByMedia = new Map<WarehouseMediaType, Map<string, UpstreamRequestRow>>();

    if (ebookCandidates.length > 0) {
      try {
        upstreamByMedia.set(EBOOK_MEDIA_TYPE, upstreamRequestMap(await this.client.listBookRequests(credentials)));
      } catch {
        summary.errorCount += 1;
      }
    }

    if (audiobookCandidates.length > 0) {
      try {
        upstreamByMedia.set(
          AUDIOBOOK_MEDIA_TYPE,
          upstreamRequestMap(await this.client.listAudiobookRequests({ ...credentials, limit: REQUEST_SYNC_LIMIT })),
        );
      } catch {
        summary.errorCount += 1;
      }
    }

    if (comicCandidates.length > 0) {
      try {
        upstreamByMedia.set(COMIC_MEDIA_TYPE, upstreamRequestMap(await this.client.listComicRequests({ ...credentials, limit: REQUEST_SYNC_LIMIT })));
      } catch {
        summary.errorCount += 1;
      }
    }

    const catalogSyncNeeded = new Set<WarehouseMediaType>();

    for (const candidate of validCandidates) {
      const upstream = upstreamByMedia.get(candidate.row.mediaType)?.get(candidate.upstreamRequestId);
      if (!upstream) {
        continue;
      }

      const update = requestMirrorUpdate(upstream, candidate.row, options.now);
      const previousStatus = normalizeWarehouseRequestStatus(candidate.row.status);
      let updated: WarehouseRequestRow | undefined;
      try {
        const scope = { userId: candidate.userId, mediaType: candidate.row.mediaType };
        updated = await this.repository.updateOpenRequestMirror(candidate.row.id, scope, update);
      } catch {
        summary.errorCount += 1;
        continue;
      }

      if (!updated) {
        continue;
      }

      summary.updatedCount += 1;
      if (shouldNotifyStatusTransition(previousStatus, update.status)) {
        try {
          await this.notifyStatusTransition(updated, update.status, candidate.userId);
          summary.notifiedCount += 1;
        } catch {
          summary.errorCount += 1;
        }
      }

      const remoteId = update.completedRemoteId ?? safePrivateIdentifier(candidate.row.completedRemoteId);
      if (update.status === 'completed' && remoteId && !catalogSyncNeeded.has(candidate.row.mediaType)) {
        try {
          const existing = await this.repository.findCatalogItem(candidate.row.mediaType, remoteId);
          if (!existing) {
            catalogSyncNeeded.add(candidate.row.mediaType);
          }
        } catch {
          summary.errorCount += 1;
        }
      }
    }

    await this.runCatalogSyncs(catalogSyncNeeded, summary);

    return { ...summary, status: summary.errorCount > 0 ? 'failed' : 'completed' };
  }

  private async credentials(): Promise<CredentialResult> {
    const settings = await this.repository.findSettings();
    if (!settings || !settings.enabled) {
      return { status: 'skipped', reason: 'disabled' };
    }

    const secret = encryptedSecretFromSettings(settings);
    const baseUrl = trimmedString(settings.baseUrl);
    if (!secret || !baseUrl) {
      return { status: 'skipped', reason: 'missing-credentials' };
    }

    try {
      return {
        status: 'ready',
        settings,
        credentials: {
          baseUrl,
          apiKey: this.secrets.decrypt(secret),
        },
      };
    } catch {
      return { status: 'skipped', reason: 'unreadable-credentials' };
    }
  }

  private async notifyStatusTransition(row: WarehouseRequestRow, status: 'completed' | 'failed', userId: number): Promise<void> {
    const completed = status === 'completed';
    const safeTitle = safePublicText(row.title) ?? 'Your request';

    await this.notifications.notify({
      type: completed ? NotificationType.CatalogRequestCompleted : NotificationType.CatalogRequestFailed,
      title: completed ? 'Request completed' : 'Request failed',
      message: completed ? `${safeTitle} is ready.` : `${safeTitle} could not be completed.`,
      actionUrl: '/requests',
      meta: {
        requestId: row.id,
        mediaType: row.mediaType,
        status,
      },
      scope: { kind: 'user', userId },
    });
  }

  private async runCatalogSyncs(mediaTypes: Set<WarehouseMediaType>, summary: WarehouseRequestSyncSummary): Promise<void> {
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
        summary.catalogSyncCount += 1;
      } catch {
        summary.errorCount += 1;
      }
    }
  }
}

function skippedSummary(skippedReason: NonNullable<WarehouseRequestSyncSummary['skippedReason']>): WarehouseRequestSyncSummary {
  return {
    status: 'skipped',
    scannedCount: 0,
    updatedCount: 0,
    notifiedCount: 0,
    catalogSyncCount: 0,
    errorCount: 0,
    skippedReason,
  };
}

function completedSummary(scannedCount: number): WarehouseRequestSyncSummary {
  return {
    status: 'completed',
    scannedCount,
    updatedCount: 0,
    notifiedCount: 0,
    catalogSyncCount: 0,
    errorCount: 0,
  };
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

function syncCandidate(row: WarehouseRequestRow): SyncCandidate | null {
  if (isTerminalRequestStatus(normalizeWarehouseRequestStatus(row.status))) {
    return null;
  }

  const upstreamRequestId = safePrivateIdentifier(row.upstreamRequestId);
  if (!upstreamRequestId || typeof row.userId !== 'number') {
    return null;
  }

  return {
    row,
    upstreamRequestId,
    userId: row.userId,
  };
}

function upstreamRequestMap(rows: UpstreamRequestRow[]): Map<string, UpstreamRequestRow> {
  const map = new Map<string, UpstreamRequestRow>();
  for (const row of rows) {
    const id = safePrivateIdentifier(recordValue(row, 'id'));
    if (id) {
      map.set(id, row);
    }
  }

  return map;
}

function requestMirrorUpdate(
  upstream: UpstreamRequestRow,
  local: WarehouseRequestRow,
  now: Date,
): RequestMirrorUpdate & { status: WarehouseRequestStatus } {
  const status = normalizeWarehouseRequestStatus(recordValue(upstream, 'status'));
  const title = safePublicText(recordValue(upstream, 'title'));
  const author = safePublicText(recordValue(upstream, 'author'));
  const isbn = safePublicText(recordValue(upstream, 'isbn'));
  const remoteId = completedRemoteId(upstream);

  return {
    status,
    lastStatusSyncedAt: now,
    ...(title !== undefined ? { title } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(isbn !== undefined ? { isbn } : {}),
    ...(remoteId !== undefined ? { completedRemoteId: remoteId } : {}),
  };
}

function completedRemoteId(upstream: UpstreamRequestRow): string | undefined {
  return (
    safePrivateIdentifier(recordValue(upstream, 'completedRemoteId')) ??
    safePrivateIdentifier(recordValue(upstream, 'completed_remote_id')) ??
    safePrivateIdentifier(recordValue(upstream, 'remoteId')) ??
    safePrivateIdentifier(recordValue(upstream, 'remote_id'))
  );
}

function shouldNotifyStatusTransition(
  previousStatus: WarehouseRequestStatus,
  nextStatus: WarehouseRequestStatus,
): nextStatus is 'completed' | 'failed' {
  return !isTerminalRequestStatus(previousStatus) && (nextStatus === 'completed' || nextStatus === 'failed');
}

function isTerminalRequestStatus(status: WarehouseRequestStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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
