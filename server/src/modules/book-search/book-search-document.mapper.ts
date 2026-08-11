import type { BookSearchDocument } from './book-search.types';

export interface CatalogDocumentRow {
  mediaType: string;
  remoteId: string;
  title: string;
  sortTitle: string | null;
  authors: string[];
  narrators: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  language: string | null;
  tags: string[];
  genres: string[];
  identifiers: Record<string, string>;
  format: string | null;
  publishedYear: number | null;
  hasCover: boolean;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  syncedAt: Date | null;
}

export interface NativeDocumentRow {
  id: number;
  libraryId: number;
  title: string;
  sortTitle: string | null;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  language: string | null;
  format: string | null;
  publishedYear: number | null;
  hasCover: boolean;
  fileSizeBytes: number | null;
  createdAt: Date | null;
}

const CATALOG_ID_PREFIX = 'catalog_';
const NATIVE_ID_PREFIX = 'native_';
const MEILISEARCH_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MEILISEARCH_ID_MAX_BYTES = 511;

/** Meilisearch document ids allow only `a-z A-Z 0-9 - _`. A catalogue remote id can carry
 *  arbitrary characters of its own, including a local scan's `local:<sha256hex>` form, so it
 *  cannot be inlined as-is. Base64url is exactly the permitted alphabet and round trips
 *  arbitrary bytes, so the remote id is encoded rather than sanitised: sanitising (stripping or
 *  replacing disallowed characters) would make `local:abc` and `local-abc` collide. */
function encodeRemoteId(remoteId: string): string {
  return Buffer.from(remoteId, 'utf8').toString('base64url');
}

function decodeRemoteId(encoded: string): string | null {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function assertValidMeilisearchId(id: string): string {
  if (!MEILISEARCH_ID_PATTERN.test(id) || Buffer.byteLength(id, 'utf8') > MEILISEARCH_ID_MAX_BYTES) {
    throw new Error(`generated an invalid meilisearch document id: ${id}`);
  }
  return id;
}

export function catalogDocumentId(mediaType: string, remoteId: string): string {
  return assertValidMeilisearchId(`${CATALOG_ID_PREFIX}${mediaType}_${encodeRemoteId(remoteId)}`);
}

export function nativeDocumentId(bookId: number): string {
  return assertValidMeilisearchId(`${NATIVE_ID_PREFIX}${bookId}`);
}

export type ParsedSearchDocumentId = { source: 'native'; bookId: number } | { source: 'catalog'; mediaType: string; remoteId: string };

/** Reverses catalogDocumentId/nativeDocumentId. Shared by every consumer that needs to turn a
 *  Meilisearch document id back into a media type and remote id (or a native book id), so the
 *  encoding and decoding halves cannot drift apart from each other. */
export function parseSearchDocumentId(id: string): ParsedSearchDocumentId | null {
  if (id.startsWith(NATIVE_ID_PREFIX)) {
    const bookId = Number(id.slice(NATIVE_ID_PREFIX.length));
    return Number.isFinite(bookId) ? { source: 'native', bookId } : null;
  }

  if (id.startsWith(CATALOG_ID_PREFIX)) {
    const rest = id.slice(CATALOG_ID_PREFIX.length);
    const separatorIndex = rest.indexOf('_');
    if (separatorIndex <= 0) return null;

    const mediaType = rest.slice(0, separatorIndex);
    const encodedRemoteId = rest.slice(separatorIndex + 1);
    if (!encodedRemoteId) return null;

    const remoteId = decodeRemoteId(encodedRemoteId);
    return remoteId ? { source: 'catalog', mediaType, remoteId } : null;
  }

  return null;
}

/** Meili searches arrays of strings, and the identifier keys carry no query value. */
function identifierValues(identifiers: Record<string, string> | null | undefined): string[] {
  if (!identifiers) return [];
  return Object.values(identifiers).filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function mapCatalogRowToDocument(row: CatalogDocumentRow): BookSearchDocument {
  return {
    id: catalogDocumentId(row.mediaType, row.remoteId),
    source: 'catalog',
    mediaType: row.mediaType,
    title: row.title,
    sortTitle: row.sortTitle,
    authors: row.authors ?? [],
    narrators: row.narrators ?? [],
    series: row.series,
    seriesIndex: row.seriesIndex,
    publisher: row.publisher,
    language: row.language,
    tags: row.tags ?? [],
    genres: row.genres ?? [],
    identifiers: identifierValues(row.identifiers),
    format: row.format,
    publishedYear: row.publishedYear,
    hasCover: row.hasCover,
    durationSeconds: row.durationSeconds,
    fileSizeBytes: row.fileSizeBytes,
    libraryId: null,
    addedAt: row.syncedAt ? row.syncedAt.getTime() : null,
  };
}

export function mapNativeBookToDocument(row: NativeDocumentRow): BookSearchDocument {
  return {
    id: nativeDocumentId(row.id),
    source: 'native',
    mediaType: 'ebook',
    title: row.title,
    sortTitle: row.sortTitle,
    authors: row.authors ?? [],
    narrators: [],
    series: row.series,
    seriesIndex: row.seriesIndex,
    publisher: row.publisher,
    language: row.language,
    tags: [],
    genres: [],
    identifiers: [],
    format: row.format,
    publishedYear: row.publishedYear,
    hasCover: row.hasCover,
    durationSeconds: null,
    fileSizeBytes: row.fileSizeBytes,
    libraryId: row.libraryId,
    addedAt: row.createdAt ? row.createdAt.getTime() : null,
  };
}
