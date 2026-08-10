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

export function catalogDocumentId(mediaType: string, remoteId: string): string {
  return `catalog:${mediaType}:${remoteId}`;
}

export function nativeDocumentId(bookId: number): string {
  return `native:${bookId}`;
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
