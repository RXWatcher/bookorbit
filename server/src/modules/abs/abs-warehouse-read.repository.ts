import { Injectable, Optional } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { decodeWarehouseBookId, encodeWarehouseBookId } from '../warehouse/warehouse-book-card.mapper';
import type { AbsAudioFileRow, AbsItemRow } from './abs-read.repository';
import { mediaTypeForSourceBackedLibrary } from './abs-library-source';

/** The stored columns this adapter reads. Kept structural so it does not bind to the ORM row type. */
interface WarehouseRowLike {
  id: number;
  mediaType: WarehouseMediaType;
  title: string | null;
  subtitle: string | null;
  series: string | null;
  seriesIndex: number | null;
  language: string | null;
  publisher: string | null;
  publishedYear?: number | null;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  format: string | null;
  localPath: string | null;
  authors: unknown;
  narrators: unknown;
  identifiers: unknown;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  upstreamCreatedAt?: Date | null;
  upstreamUpdatedAt?: Date | null;
  syncedAt?: Date | null;
}

/**
 * Reads ABS items out of the warehouse catalogue instead of the native `books` tables.
 *
 * On a warehouse-backed deployment the native tables are empty, so without this the ABS adapter
 * reports an empty server. It deliberately returns the *same* shapes the native repository returns
 * (`AbsItemRow`, `AbsAudioFileRow`), so every mapper, service and controller downstream is unchanged.
 *
 * Items are addressed by the negative synthetic book ids the rest of the app already uses
 * (`encodeWarehouseBookId`), which is what lets a single id space carry both sources.
 */
@Injectable()
export class AbsWarehouseReadRepository {
  constructor(@Optional() private readonly catalog?: WarehouseCatalogService) {}

  /** True when this deployment has a warehouse catalogue to read at all. */
  get available(): boolean {
    return !!this.catalog;
  }

  async listItems(
    user: RequestUser,
    libraryId: number,
    opts: { limit: number; offset: number; q?: string },
  ): Promise<{ rows: AbsItemRow[]; total: number }> {
    const mediaType = mediaTypeForSourceBackedLibrary(libraryId);
    if (!this.catalog || !mediaType) return { rows: [], total: 0 };

    const { rows, total } = await this.catalog.listCatalogRowsForAdapter(user, mediaType, {
      limit: opts.limit > 0 ? opts.limit : 50,
      offset: opts.offset,
      q: opts.q,
    });
    return { rows: rows.map((row) => toAbsItemRow(row as WarehouseRowLike, libraryId)), total: total ?? rows.length };
  }

  async findItem(user: RequestUser, bookId: number): Promise<AbsItemRow | null> {
    const decoded = decodeWarehouseBookId(bookId);
    if (!this.catalog || !decoded) return null;

    const row = await this.catalog.findAccessibleCatalogItemById(user, decoded.mediaType, decoded.catalogItemId);
    return row ? toAbsItemRow(row as WarehouseRowLike, libraryIdForMediaType(decoded.mediaType)) : null;
  }

  async findItemsByIds(user: RequestUser, bookIds: number[]): Promise<AbsItemRow[]> {
    const rows = await Promise.all(bookIds.map((id) => this.findItem(user, id)));
    return rows.filter((row): row is AbsItemRow => row !== null);
  }

  /**
   * Authors and narrators are stored on the catalogue row as jsonb arrays of names, so relations
   * need no joins. Author ids are synthesised from the name so they stay stable across requests.
   */
  async relationsFor(user: RequestUser, bookIds: number[]) {
    const relations = new Map<
      number,
      {
        authors: { id: number; name: string }[];
        narrators: { name: string }[];
        series: { id: number; name: string; sequence: number | null }[];
        audioFiles: AbsAudioFileRow[];
      }
    >();
    if (!this.catalog) return relations;

    for (const bookId of bookIds) {
      // Every requested id gets an entry: the item mapper asserts one exists, so a row that is
      // unresolvable here (deleted between the list and this call, or a malformed id) must still
      // map to empty relations rather than take down the whole page with it.
      relations.set(bookId, { authors: [], narrators: [], series: [], audioFiles: [] });
      const decoded = decodeWarehouseBookId(bookId);
      if (!decoded) continue;
      const row = (await this.catalog.findAccessibleCatalogItemById(user, decoded.mediaType, decoded.catalogItemId)) as WarehouseRowLike | null;
      if (!row) continue;
      relations.set(bookId, {
        authors: nameList(row.authors).map((name) => ({ id: syntheticNameId(name), name })),
        narrators: nameList(row.narrators).map((name) => ({ name })),
        series: row.series ? [{ id: syntheticNameId(row.series), name: row.series, sequence: row.seriesIndex ?? null }] : [],
        audioFiles: audioFilesFor(row, bookId),
      });
    }
    return relations;
  }
}

/** Warehouse audiobooks are a single logical file; the id doubles as the ABS `ino`. */
function audioFilesFor(row: WarehouseRowLike, bookId: number): AbsAudioFileRow[] {
  if (row.mediaType !== 'audiobook') return [];
  return [
    {
      id: row.id,
      bookId,
      format: row.format,
      sortOrder: 0,
      durationSeconds: row.durationSeconds,
      sizeBytes: row.fileSizeBytes,
      // Empty for remote items: the bytes come from the upstream proxy, not a path on this host.
      absolutePath: row.localPath ?? '',
    },
  ];
}

export function toAbsItemRow(row: WarehouseRowLike, libraryId: number): AbsItemRow {
  const identifiers = (row.identifiers ?? {}) as Record<string, unknown>;
  return {
    id: encodeWarehouseBookId(row.mediaType, row.id),
    libraryId,
    status: 'ready',
    addedAt: firstDate(row.upstreamCreatedAt, row.createdAt, row.syncedAt),
    updatedAt: firstDate(row.upstreamUpdatedAt, row.updatedAt, row.syncedAt),
    title: row.title,
    subtitle: row.subtitle,
    description: null,
    publishedYear: row.publishedYear ?? null,
    publisher: row.publisher,
    language: row.language,
    isbn13: stringOrNull(identifiers.isbn13 ?? identifiers.isbn_13),
    isbn10: stringOrNull(identifiers.isbn10 ?? identifiers.isbn_10),
    seriesName: row.series,
    seriesIndex: row.seriesIndex,
    durationSeconds: row.durationSeconds,
    chapters: null,
  };
}

function libraryIdForMediaType(mediaType: WarehouseMediaType): number {
  // Mirrors mediaTypeForSourceBackedLibrary; kept local so the mapping has one direction each way.
  if (mediaType === 'ebook') return -1;
  if (mediaType === 'audiobook') return -2;
  return -3;
}

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

/**
 * Warehouse authors and series have no numeric primary key, so ABS ids are derived from the name.
 * Stable for a given name, which is all a client needs to group and re-request by author.
 */
export function syntheticNameId(name: string): number {
  let hash = 0;
  const normalized = name.trim().toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }
  return Math.max(1, Math.abs(hash));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstDate(...values: (Date | null | undefined)[]): Date {
  for (const value of values) {
    if (value instanceof Date) return value;
  }
  return new Date(0);
}
