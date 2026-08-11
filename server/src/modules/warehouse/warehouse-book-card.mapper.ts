import { normalizeCoverAspectRatio } from '@bookorbit/types';
import type { BookCard, ReadStatus, UserBookStatus, WarehouseMediaType } from '@bookorbit/types';

import type { WarehouseCatalogItemRow } from '../../db/schema';
import { parsePublishedDateKey } from '../../common/utils/published-date.utils';
import type { UserOwnedCatalogItemRow } from './warehouse.repository';

const WAREHOUSE_BOOK_ID_BLOCK = 1_000_000_000;
const WAREHOUSE_MEDIA_ORDINAL: Record<WarehouseMediaType, number> = {
  ebook: 1,
  audiobook: 2,
  comic: 3,
};
const WAREHOUSE_MEDIA_BY_ORDINAL: Record<number, WarehouseMediaType> = {
  1: 'ebook',
  2: 'audiobook',
  3: 'comic',
};

type WarehouseBookCardRow = WarehouseCatalogItemRow &
  Partial<UserOwnedCatalogItemRow> & {
    progressPercent?: number | null;
    lastActivityAt?: Date | string | null;
  };

export type DecodedWarehouseBookId = {
  mediaType: WarehouseMediaType;
  catalogItemId: number;
};

export function encodeWarehouseBookId(mediaType: WarehouseMediaType, catalogItemId: number): number {
  const ordinal = WAREHOUSE_MEDIA_ORDINAL[mediaType];
  return -(ordinal * WAREHOUSE_BOOK_ID_BLOCK + catalogItemId);
}

export function decodeWarehouseBookId(id: number): DecodedWarehouseBookId | null {
  if (!Number.isInteger(id) || id >= 0) return null;
  const value = Math.abs(id);
  const ordinal = Math.floor(value / WAREHOUSE_BOOK_ID_BLOCK);
  const catalogItemId = value % WAREHOUSE_BOOK_ID_BLOCK;
  const mediaType = WAREHOUSE_MEDIA_BY_ORDINAL[ordinal];
  if (!mediaType || catalogItemId <= 0) return null;
  return { mediaType, catalogItemId };
}

export function syntheticWarehouseSeriesId(name: string): number {
  let hash = 0;
  const normalized = name.trim().toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}

export function mapWarehouseCatalogItemToBookCard(row: WarehouseBookCardRow): BookCard {
  const id = encodeWarehouseBookId(row.mediaType, row.id);
  const format = row.format ?? defaultFormatForMediaType(row.mediaType);
  const seriesName = normalizeNullableText(row.series);
  const addedAt = dateToIso(row.userAddedAt ?? row.upstreamCreatedAt ?? row.createdAt ?? row.syncedAt);
  const updatedAt = dateToIso(row.upstreamUpdatedAt ?? row.updatedAt ?? row.syncedAt);
  const seriesId = seriesName ? syntheticWarehouseSeriesId(seriesName) : null;
  const publishedDate = parseWarehousePublishedDate(row.rawPayload);

  return {
    id,
    catalogSource: {
      mediaType: row.mediaType,
      remoteId: row.remoteId,
    },
    // Warehouse items have no backing library row to read this from, so use the
    // same default the libraries table uses.
    coverAspectRatio: normalizeCoverAspectRatio(undefined),
    status: 'present',
    // Carried so the Audiobookshelf-compatible API can report a length. All
    // 184,500 audiobooks have this; it was simply never copied onto the card,
    // so ABS clients saw duration: null for every one of them.
    durationSeconds: row.durationSeconds ?? null,
    title: row.title,
    authors: safeStringArray(row.authors),
    seriesId,
    seriesName,
    seriesIndex: row.seriesIndex ?? null,
    seriesMemberships: seriesName
      ? [
          {
            seriesId: seriesId ?? syntheticWarehouseSeriesId(seriesName),
            seriesName,
            seriesIndex: row.seriesIndex ?? null,
            expectedBookCount: null,
            displayOrder: 0,
          },
        ]
      : [],
    files: [
      {
        id,
        format,
        role: 'primary',
        sizeBytes: row.fileSizeBytes ?? null,
      },
    ],
    publishedDate,
    publishedYear: row.publishedYear ?? null,
    language: row.language ?? null,
    genres: safeStringArray(row.genres),
    rating: row.rating ?? null,
    readingProgress: row.readingProgress ?? row.progressPercent ?? null,
    readStatus: mapReadStatus(row),
    addedAt,
    updatedAt,
    metadataScore: row.metadataScore ?? null,
    hasCover: row.hasCover,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: row.subtitle ?? null,
    publisher: row.publisher ?? null,
    pageCount: row.pageCount ?? null,
    isbn13: null,
    hardcoverId: null,
    hardcoverEditionId: null,
    narrators: safeStringArray(row.narrators),
    tags: safeStringArray(row.tags),
    customMetadata: [],
  };
}

function parseWarehousePublishedDate(rawPayload: Record<string, unknown>): string | null {
  return parsePublishedDateKey(rawPayload['publishedDate'] ?? rawPayload['published_date']) ?? null;
}

function mapReadStatus(row: WarehouseBookCardRow): UserBookStatus | null {
  const status = row.readStatus ?? inferredReadStatus(row);
  if (!status) return null;
  const updatedAt = dateToIso(row.lastActivityAt ?? row.lastReadAt ?? row.finishedAt ?? row.updatedAt ?? row.syncedAt);
  return {
    status,
    source: 'manual',
    startedAt: null,
    finishedAt: row.finishedAt ? dateToIso(row.finishedAt) : null,
    updatedAt,
  };
}

function inferredReadStatus(row: WarehouseBookCardRow): ReadStatus | null {
  const progress = row.readingProgress ?? row.progressPercent ?? null;
  if (typeof progress !== 'number' || progress <= 0) return null;
  return progress >= 100 ? 'read' : 'reading';
}

function defaultFormatForMediaType(mediaType: WarehouseMediaType): string {
  if (mediaType === 'audiobook') return 'm4b';
  if (mediaType === 'comic') return 'cbz';
  return 'epub';
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dateToIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}
