import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { Injectable } from '@nestjs/common';

import type {
  WarehouseAudiobookSummary,
  WarehouseBookSummary,
  WarehouseComicPagesPage,
  WarehouseComicSeriesSummary,
  WarehouseComicSummary,
  WarehouseConnectionTestResult,
  WarehouseErrorPayload,
  WarehouseExternalBookSearchResult,
  WarehouseListPage,
} from '@bookorbit/types';

import { WAREHOUSE_API_PREFIX, WAREHOUSE_MAX_PAGE_LIMIT, WAREHOUSE_REQUEST_TIMEOUT_MS, WAREHOUSE_USER_AGENT } from './warehouse.constants';
import { WarehouseApiError } from './warehouse.errors';

export type { WarehouseConnectionTestResult } from '@bookorbit/types';

type BaseRequest = {
  baseUrl: string;
  apiKey: string;
  range?: string;
  timeoutMs?: number;
};

type PageRequest = BaseRequest & {
  page: number;
  limit: number;
};

type SearchRequest = BaseRequest & {
  q: string;
};

type AudiobookRequest = BaseRequest & {
  id: string;
};

type BookCatalogRequest = BaseRequest & {
  id: string;
};

type ComicCatalogRequest = BaseRequest & {
  id: string;
};

type BookCoverRequest = BookCatalogRequest & {
  size: string;
};

type ComicPageImageRequest = ComicCatalogRequest & {
  pageIndex: number;
};

type ComicSeriesItemsRequest = BaseRequest & {
  seriesId: string;
  page: number;
  limit: number;
};

type ComicSeriesSearchRequest = SearchRequest & {
  page: number;
  limit: number;
};

type AudiobookFileRequest = AudiobookRequest & {
  fileId: string;
};

type BookRequestRequest = BaseRequest & {
  id: string;
};

type RequestBookRequest = BaseRequest & {
  isbn?: string;
  preferred_format?: string;
  search_result?: Record<string, unknown>;
};

type RequestAudiobookRequest = BaseRequest & {
  title: string;
  author?: string;
};

type RequestComicRequest = BaseRequest & {
  seriesTitle: string;
  issueNumber?: string;
  publisher?: string;
  year?: number;
};

type ListComicRequestsRequest = BaseRequest & {
  limit?: number;
};

type ListAudiobookRequestsRequest = BaseRequest & {
  status?: string;
  limit?: number;
};

type ListAudiobookRequestQueueRequest = BaseRequest & {
  limit?: number;
};

type WarehouseExternalBookSearchResponse = {
  results: WarehouseExternalBookSearchResult[];
};

type WarehouseWireListPage<T> = {
  items?: T[];
  books?: T[];
  audiobooks?: T[];
  comics?: T[];
  series?: T[];
  results?: T[];
  page?: number;
  limit?: number;
  total?: number | null;
  totalCount?: number | null;
  total_count?: number | null;
  count?: number | null;
  hasNextPage?: boolean;
  has_next_page?: boolean;
};

type WarehouseBookWireSummary = {
  id: string;
  title: string;
  author?: string | null;
  authors?: string[];
  format?: string | null;
  file_format?: string | null;
  fileFormat?: string | null;
  language?: string | null;
  series?: string | null;
  publisher?: string | null;
  cover_url?: string | null;
  has_cover?: boolean | null;
};

type WarehouseAudiobookWireSummary = {
  id: string;
  title: string;
  author?: string | null;
  authors?: string[];
  narrators?: string[];
  series?: string | null;
  duration?: number | null;
  cover_url?: string | null;
};

type WarehouseComicWireSummary = WarehouseBookWireSummary & {
  series_id?: string | null;
  issue_number?: string | null;
  year?: number | null;
  [key: string]: unknown;
};

type WarehouseComicSeriesWireSummary = {
  id: string;
  title: string;
  publisher?: string | null;
  year?: number | null;
  path?: unknown;
  storage_path?: unknown;
  media_path?: unknown;
};

type WarehouseComicPagesWireResponse =
  | {
      pages?: unknown;
      items?: unknown;
      total?: unknown;
    }
  | unknown[];

type WarehouseComicPageWireItem = {
  index?: unknown;
  page_index?: unknown;
  contentType?: unknown;
  content_type?: unknown;
  width?: unknown;
  height?: unknown;
  sizeBytes?: unknown;
  size_bytes?: unknown;
  path?: unknown;
  storage_path?: unknown;
  [key: string]: unknown;
};

type WarehouseAudiobookWireDetail = {
  id?: unknown;
  title?: unknown;
  subtitle?: unknown;
  author?: unknown;
  authors?: unknown;
  narrator?: unknown;
  narrators?: unknown;
  series?: unknown;
  language?: unknown;
  publisher?: unknown;
  identifiers?: unknown;
  format?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
  duration_seconds?: unknown;
  hasCover?: unknown;
  has_cover?: unknown;
  chapters?: unknown;
  files?: unknown;
  [key: string]: unknown;
};

type WarehouseAudiobookWireChapter = {
  id?: unknown;
  title?: unknown;
  start?: unknown;
  startSeconds?: unknown;
  start_seconds?: unknown;
  end?: unknown;
  endSeconds?: unknown;
  end_seconds?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
  duration_seconds?: unknown;
  [key: string]: unknown;
};

type WarehouseAudiobookWireFile = {
  id?: unknown;
  file_id?: unknown;
  name?: unknown;
  filename?: unknown;
  format?: unknown;
  mime_type?: unknown;
  duration?: unknown;
  durationSeconds?: unknown;
  duration_seconds?: unknown;
  size?: unknown;
  sizeBytes?: unknown;
  size_bytes?: unknown;
  [key: string]: unknown;
};

type WarehouseExternalBookSearchWireResult = {
  title: string;
  author?: string | null;
  isbn?: string | null;
  source?: string | null;
  cover_url?: string | null;
};

type WarehouseExternalAudiobookSearchResult = {
  title: string;
  author?: string | null;
  authors?: string[];
  narrators?: string[];
  asin?: string | null;
  source?: string | null;
  coverUrl?: string | null;
  duration?: number | null;
  series?: string | null;
  [key: string]: unknown;
};

type WarehouseExternalAudiobookSearchWireResult = {
  title: string;
  author?: string | null;
  authors?: string[];
  narrators?: string[];
  asin?: string | null;
  source?: string | null;
  cover_url?: string | null;
  duration?: number | null;
  series?: string | null;
  [key: string]: unknown;
};

type WarehouseExternalAudiobookSearchResponse = {
  results: WarehouseExternalAudiobookSearchResult[];
};

type WarehouseAbiplayerAudiobookSearchResult = {
  id?: string | null;
  asin?: string | null;
  title: string;
  author?: string | null;
  authors?: string[];
  narrators?: string[];
  coverUrl?: string | null;
  duration?: number | null;
  series?: string | null;
  [key: string]: unknown;
};

type WarehouseAbiplayerAudiobookSearchWireResult = {
  id?: string | null;
  asin?: string | null;
  title: string;
  author?: string | null;
  authors?: string[];
  narrators?: string[];
  cover_url?: string | null;
  duration?: number | null;
  series?: string | null;
  [key: string]: unknown;
};

type WarehouseAbiplayerAudiobookSearchResponse = {
  results: WarehouseAbiplayerAudiobookSearchResult[];
};

type WarehouseBookRequestResponse = {
  id?: string | null;
  request_id?: string | null;
  requestId?: string | null;
  status?: string | null;
  title?: string | null;
  author?: string | null;
  isbn?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  message?: string | null;
  book_id?: string | null;
  bookId?: string | null;
  completed_remote_id?: string | null;
  completedRemoteId?: string | null;
  [key: string]: unknown;
};

type WarehouseBookRequestListWireResponse =
  | WarehouseBookRequestResponse[]
  | {
      items?: unknown;
      requests?: unknown;
      monitoring?: unknown;
      results?: unknown;
    };

type WarehouseBookRequestCancellationResponse = {
  status: number;
  payload: unknown | null;
};

type WarehouseAudiobookRequestResponse = {
  id: string;
  title: string;
  author?: string | null;
  status: string;
};

type WarehouseAudiobookRequestListWireResponse =
  | WarehouseAudiobookRequestWireRow[]
  | {
      items?: unknown;
      requests?: unknown;
      queue?: unknown;
      results?: unknown;
    };

type WarehouseAudiobookRequestWireRow = {
  id?: unknown;
  title?: unknown;
  author?: unknown;
  status?: unknown;
  [key: string]: unknown;
};

export type WarehouseAudiobookRequestRow = {
  id?: string;
  title: string;
  author?: string;
  status?: string;
  remoteId?: string;
  completedRemoteId?: string;
};

export type WarehouseAudiobookDetailChapter = {
  id?: string;
  title: string;
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number | null;
};

export type WarehouseAudiobookDetailFile = {
  id: string;
  name: string;
  format: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
};

export type WarehouseAudiobookDetailPayload = {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
  series: string | null;
  language: string | null;
  publisher: string | null;
  identifiers: Record<string, string>;
  format: string | null;
  durationSeconds: number | null;
  hasCover: boolean | null;
  chapters: WarehouseAudiobookDetailChapter[];
  files: WarehouseAudiobookDetailFile[];
  rawPayload: Record<string, unknown>;
};

export type WarehouseBinaryResponse = {
  status: number;
  contentType: string;
  contentLength: number | null;
  contentRange?: string | null;
  acceptRanges?: string | null;
  body: Buffer | Readable;
  fileName: string | null;
};

const REQUEST_TIMEOUT_ERROR_MESSAGE = 'Catalog source request timed out';
const REQUEST_FAILED_ERROR_MESSAGE = 'Catalog source request failed';
const GENERIC_UPSTREAM_ERROR_MESSAGE = 'Request failed';

@Injectable()
export class WarehouseClientService {
  async testConnection(baseUrl: string, apiKey: string): Promise<WarehouseConnectionTestResult> {
    const checkedAt = new Date().toISOString();
    const response = await this.fetchWithTimeout(`${this.normalizeBaseUrl(baseUrl)}/health`, {
      headers: this.headers(apiKey),
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        message: 'Connected',
        checkedAt,
      };
    }

    return {
      ok: false,
      status: response.status,
      message: this.formatApiError(response.status, await this.errorMessage(response, apiKey, baseUrl)),
      checkedAt,
    };
  }

  async listBooks(request: PageRequest): Promise<WarehouseListPage<WarehouseBookSummary>> {
    const response = await this.getJson<WarehouseWireListPage<WarehouseBookWireSummary>>('/books', request, {
      page: request.page,
      limit: this.limit(request.limit),
    });

    return this.mapListPage(response, request, 'books', (item) => this.mapBookSummary(item));
  }

  downloadBook(request: BookCatalogRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/books/${this.encodePathSegment(request.id)}/download`, request);
  }

  getBookCover(request: BookCoverRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/books/${this.encodePathSegment(request.id)}/cover/${this.encodePathSegment(request.size)}`, request);
  }

  async listAudiobooks(request: PageRequest): Promise<WarehouseListPage<WarehouseAudiobookSummary>> {
    const response = await this.getJson<WarehouseWireListPage<WarehouseAudiobookWireSummary>>('/audiobooks', request, {
      page: request.page,
      limit: this.limit(request.limit),
    });

    return this.mapListPage(response, request, 'audiobooks', (item) => this.mapAudiobookSummary(item));
  }

  async listComics(request: PageRequest): Promise<WarehouseListPage<WarehouseComicSummary>> {
    const response = await this.getJson<WarehouseWireListPage<WarehouseComicWireSummary>>('/comics/items', request, {
      page: request.page,
      limit: this.limit(request.limit),
      sort: 'title',
      order: 'asc',
    });

    return this.mapListPage(response, request, 'comics', (item) => this.mapComicSummary(item));
  }

  async listComicSeries(request: PageRequest): Promise<WarehouseListPage<WarehouseComicSeriesSummary>> {
    const response = await this.getJson<WarehouseWireListPage<WarehouseComicSeriesWireSummary>>('/comics/series', request, {
      page: request.page,
      limit: this.limit(request.limit),
    });

    return this.mapListPage(response, request, 'series', (item) => this.mapComicSeriesSummary(item));
  }

  async searchComicSeries(request: ComicSeriesSearchRequest): Promise<WarehouseListPage<WarehouseComicSeriesSummary>> {
    const response = await this.getJson<WarehouseWireListPage<WarehouseComicSeriesWireSummary>>('/comics/series/search', request, {
      q: request.q,
      page: request.page,
      limit: this.limit(request.limit),
    });

    return this.mapListPage(response, request, 'results', (item) => this.mapComicSeriesSummary(item));
  }

  async listComicSeriesItems(request: ComicSeriesItemsRequest): Promise<WarehouseListPage<WarehouseComicSummary>> {
    const response = await this.getJson<WarehouseWireListPage<WarehouseComicWireSummary>>(
      `/comics/series/${this.encodePathSegment(request.seriesId)}/items`,
      request,
      {
        page: request.page,
        limit: this.limit(request.limit),
      },
    );

    return this.mapListPage(response, request, 'comics', (item) => this.mapComicSummary(item));
  }

  downloadComic(request: ComicCatalogRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/comics/items/${this.encodePathSegment(request.id)}/download`, request);
  }

  async listComicPages(request: ComicCatalogRequest): Promise<WarehouseComicPagesPage> {
    const response = await this.getJson<WarehouseComicPagesWireResponse>(`/comics/items/${this.encodePathSegment(request.id)}/pages`, request, {});

    return this.mapComicPages(response);
  }

  getComicPageImage(request: ComicPageImageRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/comics/items/${this.encodePathSegment(request.id)}/pages/${Math.max(0, Math.trunc(request.pageIndex))}`, request);
  }

  async getAudiobook(request: AudiobookRequest): Promise<WarehouseAudiobookDetailPayload> {
    const response = await this.getJson<WarehouseAudiobookWireDetail>(`/audiobooks/${this.encodePathSegment(request.id)}`, request, {});

    return this.mapAudiobookDetail(response);
  }

  getAudiobookCover(request: AudiobookRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/audiobooks/${this.encodePathSegment(request.id)}/cover`, request);
  }

  streamAudiobook(request: AudiobookRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/audiobooks/${this.encodePathSegment(request.id)}/stream`, request);
  }

  downloadAudiobook(request: AudiobookRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/audiobooks/${this.encodePathSegment(request.id)}/download`, request);
  }

  downloadAudiobookFile(request: AudiobookFileRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/audiobooks/${this.encodePathSegment(request.id)}/files/${this.encodePathSegment(request.fileId)}/download`, request);
  }

  async searchExternalBooks(request: SearchRequest): Promise<WarehouseExternalBookSearchResponse> {
    const response = await this.getJson<{ results?: WarehouseExternalBookSearchWireResult[] }>('/search/external', request, {
      q: request.q,
    });

    return {
      results: (response.results ?? []).map((item) => this.mapExternalBookSearchResult(item)),
    };
  }

  async searchExternalAudiobooks(request: SearchRequest): Promise<WarehouseExternalAudiobookSearchResponse> {
    const response = await this.getJson<{ results?: WarehouseExternalAudiobookSearchWireResult[] }>('/audiobooks/search/external', request, {
      q: request.q,
    });

    return {
      results: (response.results ?? []).map((item) => this.mapExternalAudiobookSearchResult(item)),
    };
  }

  async searchAbiplayerAudiobooks(request: SearchRequest): Promise<WarehouseAbiplayerAudiobookSearchResponse> {
    const response = await this.getJson<{ results?: WarehouseAbiplayerAudiobookSearchWireResult[] }>('/audiobooks/abiplayer/search', request, {
      q: request.q,
    });

    return {
      results: (response.results ?? []).map((item) => this.mapAbiplayerAudiobookSearchResult(item)),
    };
  }

  requestBook(request: RequestBookRequest): Promise<WarehouseBookRequestResponse> {
    return this.postJson<WarehouseBookRequestResponse>('/monitoring/add', request, {
      isbn: request.isbn,
      preferred_format: request.preferred_format,
      search_result: request.search_result,
    }).then((response) => this.mapBookRequestResponse(response));
  }

  async listBookRequests(request: BaseRequest): Promise<WarehouseBookRequestResponse[]> {
    const response = await this.getJson<WarehouseBookRequestListWireResponse>('/monitoring', request, {});

    return this.bookRequestItems(response);
  }

  getBookRequest(request: BookRequestRequest): Promise<WarehouseBookRequestResponse> {
    return this.getJson<WarehouseBookRequestResponse>(`/monitoring/${this.encodePathSegment(request.id)}`, request, {});
  }

  cancelBookRequest(request: BookRequestRequest): Promise<WarehouseBookRequestCancellationResponse> {
    return this.deleteStatus(`/monitoring/${this.encodePathSegment(request.id)}`, request);
  }

  streamBookRequest(request: BookRequestRequest): Promise<WarehouseBinaryResponse> {
    return this.getBinary(`/monitoring/${this.encodePathSegment(request.id)}/stream`, request);
  }

  requestAudiobook(request: RequestAudiobookRequest): Promise<WarehouseAudiobookRequestResponse> {
    const author = this.stringValue(request.author) ?? undefined;

    return this.postJson('/audiobooks/abiplayer/requests', request, {
      title: request.title,
      author,
    });
  }

  requestComic(request: RequestComicRequest): Promise<WarehouseBookRequestResponse> {
    return this.postJson<WarehouseBookRequestResponse>('/comics/requests', request, {
      series_title: request.seriesTitle,
      issue_number: this.stringValue(request.issueNumber) ?? undefined,
      publisher: this.stringValue(request.publisher) ?? undefined,
      year: request.year,
    }).then((response) => this.mapBookRequestResponse(response));
  }

  async listComicRequests(request: ListComicRequestsRequest): Promise<WarehouseBookRequestResponse[]> {
    const response = await this.getJson<WarehouseBookRequestListWireResponse>('/comics/requests', request, {
      limit: request.limit,
    });

    return this.bookRequestItems(response);
  }

  async listAudiobookRequests(request: ListAudiobookRequestsRequest): Promise<WarehouseAudiobookRequestRow[]> {
    const response = await this.getJson<WarehouseAudiobookRequestListWireResponse>('/audiobooks/abiplayer/requests', request, {
      status: this.stringValue(request.status),
      limit: request.limit,
    });

    return this.audiobookRequestItems(response);
  }

  async listAudiobookRequestQueue(request: ListAudiobookRequestQueueRequest): Promise<WarehouseAudiobookRequestRow[]> {
    const response = await this.getJson<WarehouseAudiobookRequestListWireResponse>('/audiobooks/abiplayer/queue', request, {
      limit: request.limit,
    });

    return this.audiobookRequestItems(response);
  }

  private async getJson<T>(path: string, request: BaseRequest, query: Record<string, string | number | null | undefined>): Promise<T> {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) {
        continue;
      }

      searchParams.set(key, String(value));
    }

    const queryString = searchParams.toString();
    const url = `${this.normalizeBaseUrl(request.baseUrl)}${WAREHOUSE_API_PREFIX}${path}${queryString ? `?${queryString}` : ''}`;
    return this.fetchJson<T>(
      url,
      {
        headers: this.headers(request.apiKey),
      },
      request.timeoutMs,
    );
  }

  private async postJson<T>(path: string, request: BaseRequest, body: Record<string, unknown>): Promise<T> {
    const url = `${this.normalizeBaseUrl(request.baseUrl)}${WAREHOUSE_API_PREFIX}${path}`;
    return this.fetchJson<T>(
      url,
      {
        method: 'POST',
        headers: {
          ...this.headers(request.apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.compact(body)),
      },
      request.timeoutMs,
    );
  }

  private async deleteStatus(path: string, request: BaseRequest): Promise<WarehouseBookRequestCancellationResponse> {
    const url = `${this.normalizeBaseUrl(request.baseUrl)}${WAREHOUSE_API_PREFIX}${path}`;
    const response = await this.fetchWithTimeout(url, {
      method: 'DELETE',
      headers: this.headers(request.apiKey),
    });

    if (!response.ok) {
      throw new WarehouseApiError(response.status, await this.errorMessage(response, request.apiKey, request.baseUrl));
    }

    return {
      status: response.status,
      payload: await this.safeJsonPayload(response),
    };
  }

  private async getBinary(path: string, request: BaseRequest): Promise<WarehouseBinaryResponse> {
    const url = `${this.normalizeBaseUrl(request.baseUrl)}${WAREHOUSE_API_PREFIX}${path}`;
    const response = await this.fetchWithTimeout(url, {
      headers: this.headers(request.apiKey, request.range),
    });
    const contentRange = this.contentRange(response.headers?.get('content-range') ?? null);
    const acceptRanges = this.acceptRanges(response.headers?.get('accept-ranges') ?? null);

    if (response.status === 416 && this.isUnsatisfiedContentRange(contentRange)) {
      return {
        status: 416,
        contentType: this.contentType(response.headers?.get('content-type') ?? null),
        contentLength: 0,
        contentRange,
        acceptRanges,
        body: Buffer.alloc(0),
        fileName: null,
      };
    }

    if (!response.ok) {
      throw new WarehouseApiError(response.status, await this.errorMessage(response, request.apiKey, request.baseUrl));
    }

    return {
      status: response.status,
      contentType: this.contentType(response.headers?.get('content-type') ?? null),
      contentLength: this.contentLength(response.headers?.get('content-length') ?? null),
      contentRange,
      acceptRanges,
      body: this.responseBody(response),
      fileName: this.fileName(response.headers?.get('content-disposition') ?? null),
    };
  }

  private async fetchJson<T>(url: string, init: RequestInit, timeoutMs?: number): Promise<T> {
    const response = await this.fetchWithTimeout(url, init, timeoutMs);

    if (!response.ok) {
      throw new WarehouseApiError(response.status, await this.errorMessage(response, this.apiKeyFromHeaders(init.headers), url));
    }

    return response.json() as Promise<T>;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs = WAREHOUSE_REQUEST_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromExternalSignal = () => controller.abort();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
      }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new Error(REQUEST_TIMEOUT_ERROR_MESSAGE, { cause: error });
      }

      if (!(error instanceof Error)) {
        this.throwNetworkFailure();
      }

      error.message = REQUEST_FAILED_ERROR_MESSAGE;
      error.stack = `${error.name}: ${REQUEST_FAILED_ERROR_MESSAGE}`;
      delete error.cause;
      throw new Error(REQUEST_FAILED_ERROR_MESSAGE, { cause: error });
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
  }

  private headers(apiKey: string, range?: string): Record<string, string> {
    const headers = {
      'X-API-Key': apiKey,
      'User-Agent': WAREHOUSE_USER_AGENT,
    };

    const safeRange = this.rangeHeader(range);
    if (safeRange) {
      return {
        ...headers,
        Range: safeRange,
      };
    }

    return headers;
  }

  private async errorMessage(response: Response, apiKey?: string, sourceUrl?: string): Promise<string> {
    try {
      const payload = (await response.json()) as WarehouseErrorPayload | null;
      if (payload?.error) {
        return this.safeErrorText(payload.error, response.statusText, apiKey, sourceUrl);
      }
    } catch {
      return this.safeErrorText(response.statusText, GENERIC_UPSTREAM_ERROR_MESSAGE, apiKey, sourceUrl);
    }

    return this.safeErrorText(response.statusText, GENERIC_UPSTREAM_ERROR_MESSAGE, apiKey, sourceUrl);
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '');
  }

  private isAbortError(error: unknown): error is Error {
    return error instanceof Error && error.name === 'AbortError';
  }

  private throwNetworkFailure(): never {
    throw new Error(REQUEST_FAILED_ERROR_MESSAGE);
  }

  private limit(limit: number): number {
    return Math.min(WAREHOUSE_MAX_PAGE_LIMIT, Math.max(1, limit));
  }

  private formatApiError(status: number, message: string): string {
    return new WarehouseApiError(status, message).message;
  }

  private encodePathSegment(value: string): string {
    return encodeURIComponent(value);
  }

  private rangeHeader(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(trimmed);
    if (!match) {
      return null;
    }

    const start = match[1] ?? '';
    const end = match[2] ?? '';
    if (!start && !end) {
      return null;
    }

    if (start && end && BigInt(start) > BigInt(end)) {
      return null;
    }

    return trimmed;
  }

  private contentType(value: string | null): string {
    return value?.trim() || 'application/octet-stream';
  }

  private contentRange(value: string | null): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }

    if (this.isUnsatisfiedContentRange(trimmed)) {
      return trimmed;
    }

    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(trimmed);
    if (!match) {
      return null;
    }

    const start = BigInt(match[1] as string);
    const end = BigInt(match[2] as string);
    if (start > end) {
      return null;
    }

    const total = match[3] as string;
    if (total !== '*' && end >= BigInt(total)) {
      return null;
    }

    return trimmed;
  }

  private acceptRanges(value: string | null): string | null {
    return value?.trim().toLowerCase() === 'bytes' ? 'bytes' : null;
  }

  private isUnsatisfiedContentRange(value: string | null): value is string {
    return typeof value === 'string' && /^bytes \*\/\d+$/i.test(value);
  }

  private mapListPage<TWire, TPublic>(
    response: WarehouseWireListPage<TWire>,
    request: PageRequest,
    collectionKey: 'books' | 'audiobooks' | 'comics' | 'series' | 'results',
    mapItem: (item: TWire) => TPublic,
  ): WarehouseListPage<TPublic> {
    const rawItems = response.items ?? response[collectionKey] ?? [];

    return {
      items: rawItems.map((item) => mapItem(item)),
      page: response.page ?? request.page,
      limit: response.limit ?? this.limit(request.limit),
      total: this.firstNonNegativeNumber(response.total, response.totalCount, response.total_count, response.count),
      hasNextPage: response.hasNextPage ?? response.has_next_page ?? false,
    };
  }

  private mapBookSummary(item: WarehouseBookWireSummary): WarehouseBookSummary {
    const { cover_url, has_cover, file_format, fileFormat, ...rest } = item;

    return {
      ...rest,
      format: rest.format ?? file_format ?? fileFormat,
      coverUrl: cover_url,
      hasCover: has_cover,
    };
  }

  private mapAudiobookSummary(item: WarehouseAudiobookWireSummary): WarehouseAudiobookSummary {
    const { cover_url, ...rest } = item;

    return {
      ...rest,
      coverUrl: cover_url,
    };
  }

  private mapComicSummary(item: WarehouseComicWireSummary): WarehouseComicSummary {
    const { id, title, author, authors, format, language, series, publisher, cover_url, has_cover, series_id, issue_number, year } = item;
    const safeCoverUrl = typeof cover_url === 'string' && !cover_url.includes('/media/') ? cover_url : undefined;

    return {
      id,
      title,
      author,
      authors,
      format,
      language,
      series,
      publisher,
      coverUrl: safeCoverUrl,
      hasCover: has_cover,
      seriesId: series_id,
      issueNumber: issue_number,
      year,
    };
  }

  private mapComicSeriesSummary(item: WarehouseComicSeriesWireSummary): WarehouseComicSeriesSummary {
    const { id, title, publisher, year } = item;

    return {
      id,
      title,
      publisher,
      year,
    };
  }

  private mapComicPages(response: WarehouseComicPagesWireResponse): WarehouseComicPagesPage {
    const rawItems = Array.isArray(response) ? response : this.isRecord(response) ? (response.pages ?? response.items) : [];
    const items = this.recordArray(rawItems).map((item) => this.mapComicPageItem(item));
    const total = !Array.isArray(response) && this.isRecord(response) ? this.firstNonNegativeNumber(response.total) : null;

    return {
      items,
      total: total ?? items.length,
    };
  }

  private mapComicPageItem(item: WarehouseComicPageWireItem): WarehouseComicPagesPage['items'][number] {
    return {
      index: this.firstNonNegativeNumber(item.index, item.page_index) ?? 0,
      contentType: this.stringValue(item.contentType ?? item.content_type),
      width: this.firstNonNegativeNumber(item.width),
      height: this.firstNonNegativeNumber(item.height),
      sizeBytes: this.firstNonNegativeNumber(item.sizeBytes, item.size_bytes),
    };
  }

  private mapAudiobookDetail(item: WarehouseAudiobookWireDetail): WarehouseAudiobookDetailPayload {
    return {
      id: this.stringValue(item.id) ?? '',
      title: this.stringValue(item.title) ?? 'Untitled',
      subtitle: this.stringValue(item.subtitle),
      authors: this.stringArray(item.authors, item.author),
      narrators: this.stringArray(item.narrators, item.narrator),
      series: this.stringValue(item.series),
      language: this.stringValue(item.language),
      publisher: this.stringValue(item.publisher),
      identifiers: this.identifiers(item),
      format: this.stringValue(item.format),
      durationSeconds: this.firstNonNegativeNumber(item.durationSeconds, item.duration_seconds, item.duration),
      hasCover: this.booleanValue(item.hasCover ?? item.has_cover),
      chapters: this.recordArray(item.chapters).map((chapter) => this.mapAudiobookChapter(chapter)),
      files: this.recordArray(item.files)
        .map((file) => this.mapAudiobookFile(file))
        .filter((file): file is WarehouseAudiobookDetailFile => file !== null),
      rawPayload: item,
    };
  }

  private mapAudiobookChapter(item: WarehouseAudiobookWireChapter): WarehouseAudiobookDetailChapter {
    const startSeconds = this.firstNonNegativeNumber(item.startSeconds, item.start_seconds, item.start) ?? 0;
    const endSeconds = this.firstNonNegativeNumber(item.endSeconds, item.end_seconds, item.end);
    const explicitDuration = this.firstNonNegativeNumber(item.durationSeconds, item.duration_seconds, item.duration);

    return {
      id: this.stringValue(item.id) ?? undefined,
      title: this.stringValue(item.title) ?? 'Chapter',
      startSeconds,
      endSeconds,
      durationSeconds: explicitDuration ?? (endSeconds === null ? null : Math.max(0, endSeconds - startSeconds)),
    };
  }

  private mapAudiobookFile(item: WarehouseAudiobookWireFile): WarehouseAudiobookDetailFile | null {
    const id = this.stringValue(item.id) ?? this.stringValue(item.file_id);
    if (id === null) {
      return null;
    }

    const name = this.stringValue(item.name) ?? this.stringValue(item.filename) ?? id;

    return {
      id,
      name,
      format: this.stringValue(item.format) ?? this.stringValue(item.mime_type),
      durationSeconds: this.firstNonNegativeNumber(item.durationSeconds, item.duration_seconds, item.duration),
      sizeBytes: this.firstNonNegativeNumber(item.sizeBytes, item.size_bytes, item.size),
    };
  }

  private mapExternalBookSearchResult(item: WarehouseExternalBookSearchWireResult): WarehouseExternalBookSearchResult {
    return {
      title: item.title,
      ...(item.author !== undefined ? { author: item.author } : {}),
      ...(item.isbn !== undefined ? { isbn: item.isbn } : {}),
    };
  }

  private mapExternalAudiobookSearchResult(item: WarehouseExternalAudiobookSearchWireResult): WarehouseExternalAudiobookSearchResult {
    const { cover_url, ...rest } = item;

    return {
      ...rest,
      coverUrl: cover_url,
    };
  }

  private mapAbiplayerAudiobookSearchResult(item: WarehouseAbiplayerAudiobookSearchWireResult): WarehouseAbiplayerAudiobookSearchResult {
    const { cover_url, ...rest } = item;

    return {
      ...rest,
      coverUrl: cover_url,
    };
  }

  private bookRequestItems(response: WarehouseBookRequestListWireResponse): WarehouseBookRequestResponse[] {
    if (Array.isArray(response)) {
      return this.recordArray(response).map((item) => this.mapBookRequestResponse(item));
    }

    return this.recordArray(response.items ?? response.requests ?? response.monitoring ?? response.results).map((item) =>
      this.mapBookRequestResponse(item),
    );
  }

  private mapBookRequestResponse(item: WarehouseBookRequestResponse): WarehouseBookRequestResponse {
    const id = this.stringValue(item.id ?? item.requestId ?? item.request_id);
    const isbn = this.stringValue(item.isbn ?? item.isbn13 ?? item.isbn10);
    const completedRemoteId = this.stringValue(item.completedRemoteId ?? item.completed_remote_id ?? item.bookId ?? item.book_id);

    return {
      ...item,
      ...(id !== null ? { id } : {}),
      ...(isbn !== null ? { isbn } : {}),
      ...(completedRemoteId !== null ? { completedRemoteId } : {}),
    };
  }

  private audiobookRequestItems(response: WarehouseAudiobookRequestListWireResponse): WarehouseAudiobookRequestRow[] {
    if (Array.isArray(response)) {
      return this.recordArray(response).map((item) => this.mapAudiobookRequestRow(item));
    }

    if (!this.isRecord(response)) {
      return [];
    }

    const items = this.recordArray(response.items ?? response.requests ?? response.queue ?? response.results);

    return items.map((item) => this.mapAudiobookRequestRow(item));
  }

  private mapAudiobookRequestRow(item: WarehouseAudiobookRequestWireRow): WarehouseAudiobookRequestRow {
    return {
      ...(this.stringValue(item.id) !== null ? { id: this.stringValue(item.id) as string } : {}),
      title: this.stringValue(item.title) ?? 'Untitled',
      ...(this.stringValue(item.author) !== null ? { author: this.stringValue(item.author) as string } : {}),
      ...(this.stringValue(item.status) !== null ? { status: this.stringValue(item.status) as string } : {}),
      ...(this.stringValue(item.remoteId ?? item.remote_id) !== null
        ? { remoteId: this.stringValue(item.remoteId ?? item.remote_id) as string }
        : {}),
      ...(this.stringValue(item.completedRemoteId ?? item.completed_remote_id) !== null
        ? { completedRemoteId: this.stringValue(item.completedRemoteId ?? item.completed_remote_id) as string }
        : {}),
    };
  }

  private compact<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
  }

  private async safeJsonPayload(response: Response): Promise<unknown | null> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  }

  private recordArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is Record<string, unknown> => this.isRecord(item));
  }

  private responseBody(response: Response): Readable {
    if (!response.body) {
      return Readable.from([]);
    }

    return Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
  }

  private stringArray(preferred: unknown, fallback?: unknown): string[] {
    const fromPreferred = this.toStringArray(preferred);
    if (fromPreferred.length > 0) {
      return fromPreferred;
    }

    return this.toStringArray(fallback);
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => this.stringValue(item)).filter((item): item is string => item !== null);
    }

    const single = this.stringValue(value);
    return single === null ? [] : [single];
  }

  private identifiers(item: WarehouseAudiobookWireDetail): Record<string, string> {
    const identifiers: Record<string, string> = {};

    if (this.isRecord(item.identifiers)) {
      for (const [key, value] of Object.entries(item.identifiers)) {
        const stringValue = this.stringValue(value);
        if (stringValue !== null) {
          identifiers[key] = stringValue;
        }
      }
    }

    for (const key of ['isbn', 'isbn13', 'asin', 'sourceId', 'source_id']) {
      const value = this.stringValue(item[key]);
      if (value !== null) {
        identifiers[key] = value;
      }
    }

    return identifiers;
  }

  private firstNonNegativeNumber(...values: unknown[]): number | null {
    for (const value of values) {
      const number = this.numberValue(value);
      if (number !== null && number >= 0) {
        return number;
      }
    }

    return null;
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private stringValue(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return null;
  }

  private booleanValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private contentLength(value: string | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private fileName(contentDisposition: string | null): string | null {
    if (contentDisposition === null) {
      return null;
    }

    const encodedMatch = contentDisposition.match(/filename\*\s*=\s*(?:[^']*'[^']*')?([^;]+)/i);
    const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]*)"/i);
    const unquotedMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
    const rawFileName = encodedMatch?.[1] ?? quotedMatch?.[1] ?? unquotedMatch?.[1] ?? null;

    if (rawFileName === null) {
      return null;
    }

    return this.sanitizeFileName(this.decodeHeaderValue(rawFileName));
  }

  private decodeHeaderValue(value: string): string {
    const trimmed = value.trim().replace(/^"|"$/g, '');

    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }

  private sanitizeFileName(value: string): string | null {
    const withoutControlCharacters = Array.from(value)
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && code !== 0x7f;
      })
      .join('');
    const safeName = withoutControlCharacters
      .replace(/[\\/]+/g, '_')
      .replace(/^\.+/g, '')
      .replace(/\.{2,}/g, '.')
      .trim();

    return safeName === '' ? null : safeName;
  }

  private apiKeyFromHeaders(headers: HeadersInit | undefined): string | undefined {
    if (headers instanceof Headers) {
      return headers.get('X-API-Key') ?? undefined;
    }

    if (Array.isArray(headers)) {
      const header = headers.find(([key]) => key.toLowerCase() === 'x-api-key');
      return typeof header?.[1] === 'string' ? header[1] : undefined;
    }

    if (this.isRecord(headers)) {
      const value = headers['X-API-Key'] ?? headers['x-api-key'];
      return typeof value === 'string' ? value : undefined;
    }

    return undefined;
  }

  private safeErrorText(message: string | null | undefined, fallback: string, apiKey?: string, sourceUrl?: string): string {
    const candidate = this.stringValue(message) ?? fallback;
    const safeMessage = this.scrubErrorText(candidate, apiKey, sourceUrl).replace(/\s+/g, ' ').trim();

    return safeMessage || this.scrubErrorText(fallback, apiKey, sourceUrl) || GENERIC_UPSTREAM_ERROR_MESSAGE;
  }

  private scrubErrorText(value: string, apiKey?: string, sourceUrl?: string): string {
    let safeValue = apiKey ? value.replace(new RegExp(this.escapeRegExp(apiKey), 'g'), '') : value;
    const sourceHost = this.sourceHost(sourceUrl);

    if (sourceHost) {
      safeValue = safeValue.replace(new RegExp(this.escapeRegExp(sourceHost), 'gi'), '');
    }

    return safeValue
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\b(?:x-api-key|api[_ -]?key)\b\s*[:=]?\s*\S+/gi, '')
      .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, '')
      .replace(/\b(?:book\s+warehouse|upstream|third[-\s]+party|provider|vendor)\b/gi, '')
      .replace(/\b(?=[A-Za-z0-9_-]{12,}\b)(?=[A-Za-z0-9_-]*[0-9_-])[A-Za-z0-9_-]+\b/g, '')
      .trim();
  }

  private sourceHost(sourceUrl?: string): string | null {
    if (!sourceUrl) {
      return null;
    }

    try {
      return new URL(sourceUrl).host;
    } catch {
      return null;
    }
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
