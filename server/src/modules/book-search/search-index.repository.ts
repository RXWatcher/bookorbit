import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { CatalogDocumentRow, NativeDocumentRow } from './book-search-document.mapper';

type Db = NodePgDatabase<typeof schema>;

export interface SearchIndexEventInput {
  entityType: 'catalog_item' | 'native_book';
  entityId: string;
  operation: 'upsert' | 'delete';
}

type Writer = Pick<Db, 'insert'>;

@Injectable()
export class SearchIndexRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async enqueue(events: SearchIndexEventInput[], tx?: unknown): Promise<void> {
    if (events.length === 0) return;

    const writer = (tx as Writer | undefined) ?? this.db;
    await writer.insert(schema.searchIndexEvents).values(events.map((event) => ({ ...event })));
  }

  async claimBatch(limit: number) {
    return this.db
      .select({
        id: schema.searchIndexEvents.id,
        entityType: schema.searchIndexEvents.entityType,
        entityId: schema.searchIndexEvents.entityId,
        operation: schema.searchIndexEvents.operation,
      })
      .from(schema.searchIndexEvents)
      .orderBy(asc(schema.searchIndexEvents.id))
      .limit(limit);
  }

  async deleteEvents(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(schema.searchIndexEvents).where(inArray(schema.searchIndexEvents.id, ids));
  }

  async *streamCatalogDocuments(batchSize: number): AsyncGenerator<CatalogDocumentRow[]> {
    let cursor = 0;

    for (;;) {
      const rows = await this.db
        .select({
          id: schema.warehouseCatalogItems.id,
          mediaType: schema.warehouseCatalogItems.mediaType,
          remoteId: schema.warehouseCatalogItems.remoteId,
          title: schema.warehouseCatalogItems.title,
          sortTitle: schema.warehouseCatalogItems.sortTitle,
          authors: schema.warehouseCatalogItems.authors,
          narrators: schema.warehouseCatalogItems.narrators,
          series: schema.warehouseCatalogItems.series,
          seriesIndex: schema.warehouseCatalogItems.seriesIndex,
          publisher: schema.warehouseCatalogItems.publisher,
          language: schema.warehouseCatalogItems.language,
          tags: schema.warehouseCatalogItems.tags,
          genres: schema.warehouseCatalogItems.genres,
          identifiers: schema.warehouseCatalogItems.identifiers,
          format: schema.warehouseCatalogItems.format,
          publishedYear: schema.warehouseCatalogItems.publishedYear,
          hasCover: schema.warehouseCatalogItems.hasCover,
          durationSeconds: schema.warehouseCatalogItems.durationSeconds,
          fileSizeBytes: schema.warehouseCatalogItems.fileSizeBytes,
          syncedAt: schema.warehouseCatalogItems.syncedAt,
        })
        .from(schema.warehouseCatalogItems)
        .where(gt(schema.warehouseCatalogItems.id, cursor))
        .orderBy(asc(schema.warehouseCatalogItems.id))
        .limit(batchSize);

      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].id;
      yield rows;
    }
  }

  async *streamNativeDocuments(batchSize: number): AsyncGenerator<NativeDocumentRow[]> {
    let cursor = 0;

    for (;;) {
      const rows = await this.db
        .select({
          id: schema.books.id,
          libraryId: schema.books.libraryId,
          title: schema.bookMetadata.title,
          sortTitle: schema.books.primaryAuthorSortName,
          series: schema.bookMetadata.seriesName,
          seriesIndex: schema.bookMetadata.seriesIndex,
          publisher: schema.bookMetadata.publisher,
          language: schema.bookMetadata.language,
          publishedYear: schema.bookMetadata.publishedYear,
          createdAt: schema.books.addedAt,
        })
        .from(schema.books)
        .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
        .where(gt(schema.books.id, cursor))
        .orderBy(asc(schema.books.id))
        .limit(batchSize);

      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].id;

      // Native books keep their title in book_metadata, their format and size on book_files,
      // and their authors in a join table. Format, size, cover and authors are left empty
      // here and filled in phase 2 rather than adding two more joins to this stream.
      yield rows.map((row) => ({
        ...row,
        title: row.title ?? '(untitled)',
        authors: [],
        format: null,
        hasCover: false,
        fileSizeBytes: null,
      }));
    }
  }
}
