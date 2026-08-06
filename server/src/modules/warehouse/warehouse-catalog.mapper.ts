import type {
  WarehouseAudiobookChapter,
  WarehouseAudiobookFile,
  WarehouseAudiobookSummary,
  WarehouseBookSummary,
  WarehouseComicSummary,
} from '@bookorbit/types';

import type { NewWarehouseCatalogItemRow } from '../../db/schema';

type WarehouseRawBookSummary = WarehouseBookSummary | Record<string, unknown>;
type WarehouseRawAudiobookSummary = WarehouseAudiobookSummary | Record<string, unknown>;
type WarehouseRawComicSummary = WarehouseComicSummary | Record<string, unknown>;
type WarehouseAudiobookPublicDetail = {
  chapters: WarehouseAudiobookChapter[];
  files: WarehouseAudiobookFile[];
};

type NewCatalogItem = Omit<NewWarehouseCatalogItemRow, 'id' | 'createdAt' | 'updatedAt'>;

const UNTITLED_TITLE = 'Untitled';

export function mapWarehouseEbookCatalogItemRow(payload: WarehouseRawBookSummary, syncedAt: Date): NewCatalogItem {
  const raw = asRecord(payload);
  const title = textValue(raw.title) ?? UNTITLED_TITLE;

  return {
    mediaType: 'ebook',
    remoteId: stringValue(raw.id),
    title,
    subtitle: textValue(raw.subtitle),
    sortTitle: textValue(raw.sortTitle) ?? textValue(raw.sort_title) ?? title,
    authors: authorList(raw),
    narrators: [],
    series: seriesTitle(raw),
    seriesIndex: firstNonNegativeNumber(
      raw.seriesIndex,
      raw.series_index,
      raw.seriesNumber,
      raw.series_number,
      raw.volume,
      raw.bookNumber,
      raw.book_number,
    ),
    genres: namedList(raw, 'genres', 'genre'),
    tags: namedList(raw, 'tags', 'tag'),
    language: textValue(raw.language),
    publisher: textValue(raw.publisher),
    identifiers: identifiers(raw),
    format: textValue(raw.format) ?? textValue(raw.fileFormat) ?? textValue(raw.file_format),
    hasCover: coverFlag(raw),
    upstreamCreatedAt: dateValue(raw.createdAt) ?? dateValue(raw.created_at),
    upstreamUpdatedAt: dateValue(raw.updatedAt) ?? dateValue(raw.updated_at),
    rawPayload: raw,
    syncedAt,
  };
}

export function mapWarehouseAudiobookCatalogItemRow(payload: WarehouseRawAudiobookSummary, syncedAt: Date): NewCatalogItem {
  const raw = asRecord(payload);
  const title = textValue(raw.title) ?? UNTITLED_TITLE;

  return {
    mediaType: 'audiobook',
    remoteId: stringValue(raw.id),
    title,
    subtitle: textValue(raw.subtitle),
    sortTitle: textValue(raw.sortTitle) ?? textValue(raw.sort_title) ?? title,
    authors: contributorList(raw, 'authors', 'author'),
    narrators: contributorList(raw, 'narrators', 'narrator'),
    series: seriesTitle(raw),
    seriesIndex: firstNonNegativeNumber(
      raw.seriesIndex,
      raw.series_index,
      raw.seriesNumber,
      raw.series_number,
      raw.volume,
      raw.bookNumber,
      raw.book_number,
    ),
    genres: namedList(raw, 'genres', 'genre'),
    tags: namedList(raw, 'tags', 'tag'),
    language: textValue(raw.language),
    publisher: textValue(raw.publisher),
    identifiers: identifiers(raw),
    format: textValue(raw.format),
    durationSeconds: firstNonNegativeInteger(raw.durationSeconds, raw.duration_seconds, raw.duration),
    hasCover: coverFlag(raw),
    upstreamCreatedAt: dateValue(raw.createdAt) ?? dateValue(raw.created_at),
    upstreamUpdatedAt: dateValue(raw.updatedAt) ?? dateValue(raw.updated_at),
    rawPayload: raw,
    syncedAt,
  };
}

export function mapWarehouseComicCatalogItemRow(payload: WarehouseRawComicSummary, syncedAt: Date): NewCatalogItem {
  const raw = sanitizedComicPayload(asRecord(payload));
  const title = textValue(raw.title) ?? UNTITLED_TITLE;

  return {
    mediaType: 'comic',
    remoteId: stringValue(raw.id),
    title,
    subtitle: textValue(raw.subtitle),
    sortTitle: textValue(raw.sortTitle) ?? textValue(raw.sort_title) ?? title,
    authors: authorList(raw),
    narrators: [],
    series: seriesTitle(raw),
    seriesIndex: firstNonNegativeNumber(raw.seriesIndex, raw.series_index, raw.issueNumber, raw.issue_number),
    genres: namedList(raw, 'genres', 'genre'),
    tags: namedList(raw, 'tags', 'tag'),
    language: textValue(raw.language),
    publisher: textValue(raw.publisher),
    identifiers: comicIdentifiers(raw),
    format: textValue(raw.format) ?? 'CBZ',
    hasCover: coverFlag(raw),
    upstreamCreatedAt: dateValue(raw.createdAt) ?? dateValue(raw.created_at),
    upstreamUpdatedAt: dateValue(raw.updatedAt) ?? dateValue(raw.updated_at),
    rawPayload: raw,
    syncedAt,
  };
}

export function mapWarehouseAudiobookDetail(raw: unknown): WarehouseAudiobookPublicDetail {
  const detail = asRecord(raw);
  const rawPayload = asRecord(detail.rawPayload);

  return {
    chapters: recordArray(detail.chapters ?? rawPayload.chapters).map(mapAudiobookChapter),
    files: recordArray(detail.files ?? rawPayload.files)
      .map(mapAudiobookFile)
      .filter((file): file is WarehouseAudiobookFile => file !== null),
  };
}

function sanitizedComicPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...raw };
  for (const key of ['storage_path', 'storagePath', 'media_path', 'mediaPath']) {
    delete sanitized[key];
  }

  for (const key of ['cover_url', 'coverUrl']) {
    const value = sanitized[key];
    if (typeof value === 'string' && value.includes('/media/')) {
      delete sanitized[key];
    }
  }

  return sanitized;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  return '';
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function seriesTitle(raw: Record<string, unknown>): string | null {
  return textValue(raw.series) ?? textValue(raw.seriesName) ?? textValue(raw.series_name);
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function authorList(raw: Record<string, unknown>): string[] {
  return contributorList(raw, 'authors', 'author');
}

function contributorList(raw: Record<string, unknown>, arrayKey: string, scalarKey: string): string[] {
  const scalarContributors = textValue(raw[arrayKey]);
  if (scalarContributors) {
    return normalizeContributorList([scalarContributors]);
  }

  const fromArray = listValue(raw[arrayKey]);
  if (fromArray.length > 0) {
    return normalizeContributorList(fromArray);
  }

  const scalarContributor = textValue(raw[scalarKey]);
  return scalarContributor ? normalizeContributorList([scalarContributor]) : [];
}

function namedList(raw: Record<string, unknown>, arrayKey: string, scalarKey: string): string[] {
  const values = listValue(raw[arrayKey]);
  if (values.length > 0) {
    return values;
  }

  const scalar = textValue(raw[scalarKey]);
  return scalar ? [scalar] : [];
}

function listValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeContributorList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.flatMap(splitContributorValue)) {
    const displayName = contributorDisplayName(value);
    const key = displayName.toLowerCase();
    if (!displayName || seen.has(key)) continue;
    seen.add(key);
    result.push(displayName);
  }

  return result;
}

function splitContributorValue(value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [];

  const delimiterSplit = normalized
    .split(/\s*(?:;|\s+&\s+|\s+and\s+)\s*/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidates = delimiterSplit.length > 1 ? delimiterSplit : [normalized];

  return candidates.flatMap((entry) => splitCommaContributorValue(entry));
}

function splitCommaContributorValue(value: string): string[] {
  const parts = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (parts.length <= 1) return [value];
  if (parts.length === 2 && looksLikeLastFirstName(parts[0], parts[1])) return [value];
  return parts;
}

function looksLikeLastFirstName(last: string, first: string): boolean {
  return plausibleNamePart(last, 2) && plausibleNamePart(first, 3) && !last.includes('.');
}

function plausibleNamePart(value: string, maxWords: number): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= maxWords && words.every((word) => /^[\p{L}.'-]+$/u.test(word));
}

function contributorDisplayName(value: string): string {
  const trimmed = value.trim();
  const parts = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (parts.length === 2 && looksLikeLastFirstName(parts[0], parts[1])) {
    return `${parts[1]} ${parts[0]}`.trim();
  }

  return trimmed;
}

function identifiers(raw: Record<string, unknown>): Record<string, string> {
  const mapped: Record<string, string> = {};
  const nestedIdentifiers = raw.identifiers;
  const isbn = identifierValue(raw.isbn);
  const isbn10 = identifierValue(raw.isbn10 ?? raw.isbn_10);
  const isbn13 = identifierValue(raw.isbn13 ?? raw.isbn_13);
  const asin = identifierValue(raw.asin);
  const sourceId = identifierValue(raw.sourceId);
  const sourceSnakeId = identifierValue(raw.source_id);

  if (isPlainRecord(nestedIdentifiers)) {
    for (const [key, value] of Object.entries(nestedIdentifiers)) {
      const identifier = nestedIdentifierValue(value);
      if (identifier !== null) {
        mapped[key] = identifier;
      }
    }
  }

  if (isbn) {
    mapped.isbn = isbn;
  }

  if (isbn10) {
    mapped.isbn10 = isbn10;
  }

  if (isbn13) {
    mapped.isbn13 = isbn13;
  }

  if (asin) {
    mapped.asin = asin;
  }

  if (sourceId) {
    mapped.sourceId = sourceId;
  }

  if (sourceSnakeId) {
    mapped.source_id = sourceSnakeId;
  }

  return mapped;
}

function comicIdentifiers(raw: Record<string, unknown>): Record<string, string> {
  const mapped = identifiers(raw);
  const seriesId = identifierValue(raw.seriesId ?? raw.series_id);
  const issueNumber = identifierValue(raw.issueNumber ?? raw.issue_number);
  const year = identifierValue(raw.year);

  if (seriesId) {
    mapped.seriesId = seriesId;
  }

  if (issueNumber) {
    mapped.issueNumber = issueNumber;
  }

  if (year) {
    mapped.year = year;
  }

  return mapped;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function identifierValue(value: unknown): string | null {
  const text = textValue(value);
  if (text !== null) {
    return text;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return String(value);
  }

  return null;
}

function nestedIdentifierValue(value: unknown): string | null {
  const text = textValue(value);
  if (text !== null) {
    return text;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function coverFlag(raw: Record<string, unknown>): boolean {
  if (typeof raw.hasCover === 'boolean') {
    return raw.hasCover;
  }

  if (typeof raw.has_cover === 'boolean') {
    return raw.has_cover;
  }

  return Boolean(textValue(raw.coverUrl) ?? textValue(raw.cover_url));
}

function firstNonNegativeNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed === null || parsed < 0) {
      continue;
    }

    return parsed;
  }

  return null;
}

function firstNonNegativeInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed === null || parsed < 0) {
      continue;
    }

    return Math.trunc(parsed);
  }

  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function mapAudiobookChapter(raw: Record<string, unknown>): WarehouseAudiobookChapter {
  const startSeconds = firstNonNegativeInteger(raw.startSeconds, raw.start_seconds, raw.start) ?? 0;
  const endSeconds = firstNonNegativeInteger(raw.endSeconds, raw.end_seconds, raw.end);
  const explicitDuration = firstNonNegativeInteger(raw.durationSeconds, raw.duration_seconds, raw.duration);

  return {
    id: identifierValue(raw.id) ?? undefined,
    title: textValue(raw.title) ?? 'Chapter',
    startSeconds,
    endSeconds,
    durationSeconds: explicitDuration ?? (endSeconds === null ? null : Math.max(0, endSeconds - startSeconds)),
  };
}

function mapAudiobookFile(raw: Record<string, unknown>): WarehouseAudiobookFile | null {
  const id = identifierValue(raw.id) ?? identifierValue(raw.file_id);
  if (id === null) {
    return null;
  }

  return {
    id,
    name: textValue(raw.name) ?? textValue(raw.filename) ?? id,
    format: textValue(raw.format) ?? textValue(raw.mimeType) ?? textValue(raw.mime_type),
    durationSeconds: firstNonNegativeInteger(raw.durationSeconds, raw.duration_seconds, raw.duration),
    sizeBytes: firstNonNegativeInteger(raw.sizeBytes, raw.size_bytes, raw.size),
  };
}
