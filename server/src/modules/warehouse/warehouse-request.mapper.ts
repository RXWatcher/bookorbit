import type {
  WarehouseMediaType,
  WarehouseRequestDetail,
  WarehouseRequestPayloadSummary,
  WarehouseRequestSearchResultSummary,
  WarehouseRequestStatus,
} from '@bookorbit/types';

import type { WarehouseRequestRow } from '../../db/schema';

const PENDING_STATUSES = new Set(['pending', 'requested', 'new']);
const PROCESSING_STATUSES = new Set(['processing', 'downloading', 'queued', 'searching', 'monitoring', 'active', 'in_progress']);
const COMPLETED_STATUSES = new Set(['completed', 'succeeded', 'success', 'available', 'done']);
const FAILED_STATUSES = new Set(['failed', 'error', 'errored', 'not_found']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);
export const REQUEST_FALLBACK_TITLE = 'Library request';
const FORBIDDEN_PUBLIC_TEXT_PATTERNS = [
  /\bbook\s+warehouse\b/i,
  /\bwarehouse\b/i,
  /\bcatalog[-\s]+source\b/i,
  /\bsource\b/i,
  /\bupstream\b/i,
  /\bthird[-\s]+party\b/i,
  /\bprovider\b/i,
  /\bvendor\b/i,
];
const URL_PATTERN = /https?:\/\/\S+/i;
const HOSTNAME_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|\b)/i;
const OPAQUE_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/;
const SECRET_TEXT_PATTERNS = [/\bapi[\s_-]*key\b/i, /\bx[\s_-]*api[\s_-]*key\b/i, /\bbearer\s+\S+/i, /\bauthorization\s*:/i];

export function normalizeWarehouseRequestStatus(value: unknown): WarehouseRequestStatus {
  const normalized = normalizeStatusText(value);

  if (!normalized) {
    return 'unknown';
  }

  if (PENDING_STATUSES.has(normalized)) {
    return 'pending';
  }

  if (PROCESSING_STATUSES.has(normalized)) {
    return 'processing';
  }

  if (COMPLETED_STATUSES.has(normalized)) {
    return 'completed';
  }

  if (FAILED_STATUSES.has(normalized)) {
    return 'failed';
  }

  if (CANCELLED_STATUSES.has(normalized)) {
    return 'cancelled';
  }

  return 'unknown';
}

export function mapWarehouseRequestRow(row: WarehouseRequestRow): WarehouseRequestDetail {
  const status = normalizeWarehouseRequestStatus(row.status);

  return {
    id: row.id,
    mediaType: row.mediaType,
    status,
    title: safeText(row.title) ?? REQUEST_FALLBACK_TITLE,
    author: nullableSafeText(row.author) ?? null,
    isbn: nullableSafeText(row.isbn) ?? null,
    completedRemoteId: status === 'completed' ? (safeRouteIdentifier(row.completedRemoteId) ?? null) : null,
    requestedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastStatusSyncedAt: row.lastStatusSyncedAt?.toISOString() ?? null,
    requestedPayload: requestedPayloadSummary(row.requestedPayload, row.mediaType),
  };
}

function normalizeStatusText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replaceAll('-', '_').replaceAll(/\s+/g, '_');
  return normalized ? normalized : null;
}

function requestedPayloadSummary(value: unknown, mediaType: WarehouseMediaType): WarehouseRequestPayloadSummary {
  const payload = asRecord(value);
  const summary: WarehouseRequestPayloadSummary = {};

  if (mediaType === 'audiobook') {
    const title = safeText(payload.title);
    const author = safeText(payload.author);

    if (title) {
      summary.title = title;
    }

    if (author) {
      summary.author = author;
    }

    return summary;
  }

  const isbn = safeText(payload.isbn);
  const preferredFormat = safeText(payload.preferredFormat ?? payload.preferred_format);
  const searchResult = searchResultSummary(payload.searchResult ?? payload.search_result);

  if (isbn) {
    summary.isbn = isbn;
  }

  if (preferredFormat) {
    summary.preferredFormat = preferredFormat;
  }

  if (searchResult) {
    summary.searchResult = searchResult;
  }

  return summary;
}

function searchResultSummary(value: unknown): WarehouseRequestSearchResultSummary | undefined {
  const raw = asRecord(value);
  const summary: WarehouseRequestSearchResultSummary = {};
  const title = safeText(raw.title);
  const author = nullableSafeText(raw.author);
  const authors = safeTextList(raw.authors);
  const isbn = nullableSafeText(raw.isbn);
  const isbn13 = nullableSafeText(raw.isbn13 ?? raw.isbn_13);

  if (title) {
    summary.title = title;
  }

  if (author !== undefined) {
    summary.author = author;
  }

  if (authors.length > 0) {
    summary.authors = authors;
  }

  if (isbn !== undefined) {
    summary.isbn = isbn;
  }

  if (isbn13 !== undefined) {
    summary.isbn13 = isbn13;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || looksUnsafePublicValue(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function nullableSafeText(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return safeText(value);
}

function safeRouteIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || URL_PATTERN.test(trimmed) || HOSTNAME_PATTERN.test(trimmed)) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(normalized)) || FORBIDDEN_PUBLIC_TEXT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return undefined;
  }

  return trimmed;
}

function safeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => safeText(entry)).filter((entry): entry is string => entry !== undefined);
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
