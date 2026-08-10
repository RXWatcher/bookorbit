import { Inject, Injectable } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';
import { and, asc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { CatalogKeyRow, LocalScanSummary } from './local-scan.types';

type Db = NodePgDatabase<typeof schema>;

/** Arbitrary namespace so local scan advisory locks cannot collide with another feature's. */
const LOCAL_SCAN_LOCK_NAMESPACE = 8_140_231;

export interface LocalEnrichmentValues {
  title?: string;
  sortTitle?: string | null;
  authors?: string[];
  series?: string | null;
  seriesIndex?: number | null;
  publisher?: string | null;
  language?: string | null;
  tags?: string[];
  publishedYear?: number | null;
  identifiers?: Record<string, string>;
  hasCover?: boolean;
}

export interface NewLocalCatalogItem {
  mediaType: WarehouseMediaType;
  remoteId: string;
  title: string;
  localPath: string;
  format: string | null;
  fileSizeBytes: number | null;
}

@Injectable()
export class LocalScanRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findEnabledRoots() {
    return this.db
      .select({
        id: schema.localScanRoots.id,
        mediaType: schema.localScanRoots.mediaType,
        absolutePath: schema.localScanRoots.absolutePath,
        excludePatterns: schema.localScanRoots.excludePatterns,
      })
      .from(schema.localScanRoots)
      .where(eq(schema.localScanRoots.enabled, true))
      .orderBy(asc(schema.localScanRoots.id));
  }

  async *streamCatalogKeyRows(mediaType: WarehouseMediaType, batchSize: number): AsyncGenerator<CatalogKeyRow[]> {
    let cursor = 0;

    for (;;) {
      const batch = await this.db
        .select({
          id: schema.warehouseCatalogItems.id,
          remoteId: schema.warehouseCatalogItems.remoteId,
          title: schema.warehouseCatalogItems.title,
          rawPayload: schema.warehouseCatalogItems.rawPayload,
        })
        .from(schema.warehouseCatalogItems)
        .where(and(eq(schema.warehouseCatalogItems.mediaType, mediaType), gt(schema.warehouseCatalogItems.id, cursor)))
        .orderBy(asc(schema.warehouseCatalogItems.id))
        .limit(batchSize);

      if (batch.length === 0) return;

      cursor = batch[batch.length - 1].id;
      yield batch.map(({ remoteId, title, rawPayload }) => ({ remoteId, title, rawPayload }));
    }
  }

  /** Returns rows actually persisted, which is not the batch size: conflicting rows are
   *  dropped by onConflictDoNothing, so a rescan legitimately inserts zero. */
  async insertLocalItems(rows: NewLocalCatalogItem[]): Promise<number> {
    if (rows.length === 0) return 0;

    const result = await this.db
      .insert(schema.warehouseCatalogItems)
      .values(rows.map((row) => ({ ...row, source: 'local' as const })))
      .onConflictDoNothing({ target: [schema.warehouseCatalogItems.mediaType, schema.warehouseCatalogItems.remoteId] });

    return result.rowCount ?? 0;
  }

  /** Warehouse rows written since the scan began, so a book the sync landed mid walk can be
   *  reconciled against the local row this run inserted for it. */
  async findCatalogKeyRowsSyncedSince(mediaType: WarehouseMediaType, since: Date): Promise<CatalogKeyRow[]> {
    const rows = await this.db
      .select({
        remoteId: schema.warehouseCatalogItems.remoteId,
        title: schema.warehouseCatalogItems.title,
        rawPayload: schema.warehouseCatalogItems.rawPayload,
      })
      .from(schema.warehouseCatalogItems)
      .where(
        and(
          eq(schema.warehouseCatalogItems.mediaType, mediaType),
          eq(schema.warehouseCatalogItems.source, 'warehouse'),
          gte(schema.warehouseCatalogItems.syncedAt, since),
        ),
      );

    return rows;
  }

  async deleteLocalItemsByRemoteIds(mediaType: WarehouseMediaType, remoteIds: string[]): Promise<number> {
    if (remoteIds.length === 0) return 0;

    const result = await this.db
      .delete(schema.warehouseCatalogItems)
      .where(
        and(
          eq(schema.warehouseCatalogItems.mediaType, mediaType),
          eq(schema.warehouseCatalogItems.source, 'local'),
          inArray(schema.warehouseCatalogItems.remoteId, remoteIds),
        ),
      );

    return result.rowCount ?? 0;
  }

  /** Session scoped advisory lock keyed on the root, so two concurrent scans of the same root
   *  cannot both walk and both write. Returns false when another scan holds it. */
  async tryLockRoot(rootId: number): Promise<boolean> {
    const result = await this.db.execute<{ locked: boolean }>(sql`select pg_try_advisory_lock(${LOCAL_SCAN_LOCK_NAMESPACE}, ${rootId}) as locked`);
    return result.rows[0]?.locked === true;
  }

  async unlockRoot(rootId: number): Promise<void> {
    await this.db.execute(sql`select pg_advisory_unlock(${LOCAL_SCAN_LOCK_NAMESPACE}, ${rootId})`);
  }

  async markScanStarted(rootId: number): Promise<void> {
    await this.db
      .update(schema.localScanRoots)
      .set({ lastScanStartedAt: new Date(), lastScanStatus: 'running', lastScanError: null })
      .where(eq(schema.localScanRoots.id, rootId));
  }

  async markScanFinished(rootId: number, summary: LocalScanSummary): Promise<void> {
    await this.db
      .update(schema.localScanRoots)
      .set({
        lastScanFinishedAt: new Date(),
        lastScanStatus: 'completed',
        lastScanError: null,
        lastScanSummary: { ...summary },
      })
      .where(eq(schema.localScanRoots.id, rootId));
  }

  async markScanFailed(rootId: number, message: string, summary: LocalScanSummary): Promise<void> {
    await this.db
      .update(schema.localScanRoots)
      .set({
        lastScanFinishedAt: new Date(),
        lastScanStatus: 'failed',
        lastScanError: message.slice(0, 2000),
        lastScanSummary: { ...summary },
      })
      .where(eq(schema.localScanRoots.id, rootId));
  }

  /** Local rows that still carry only a directory-derived title, walked by id so a long
   *  enrichment run holds one page at a time rather than the whole set. */
  async *streamLocalItemsNeedingEnrichment(batchSize: number): AsyncGenerator<Array<{ id: number; localPath: string | null }>> {
    let cursor = 0;

    for (;;) {
      const batch = await this.db
        .select({ id: schema.warehouseCatalogItems.id, localPath: schema.warehouseCatalogItems.localPath })
        .from(schema.warehouseCatalogItems)
        .where(
          and(
            eq(schema.warehouseCatalogItems.source, 'local'),
            gt(schema.warehouseCatalogItems.id, cursor),
            sql`jsonb_array_length(${schema.warehouseCatalogItems.authors}) = 0`,
          ),
        )
        .orderBy(asc(schema.warehouseCatalogItems.id))
        .limit(batchSize);

      if (batch.length === 0) return;

      cursor = batch[batch.length - 1].id;
      yield batch;
    }
  }

  async applyEnrichment(id: number, values: LocalEnrichmentValues): Promise<void> {
    await this.db.update(schema.warehouseCatalogItems).set(values).where(eq(schema.warehouseCatalogItems.id, id));
  }

  findRootStatuses() {
    return this.db
      .select({
        id: schema.localScanRoots.id,
        mediaType: schema.localScanRoots.mediaType,
        absolutePath: schema.localScanRoots.absolutePath,
        enabled: schema.localScanRoots.enabled,
        lastScanStatus: schema.localScanRoots.lastScanStatus,
        lastScanStartedAt: schema.localScanRoots.lastScanStartedAt,
        lastScanFinishedAt: schema.localScanRoots.lastScanFinishedAt,
        lastScanError: schema.localScanRoots.lastScanError,
        lastScanSummary: schema.localScanRoots.lastScanSummary,
      })
      .from(schema.localScanRoots)
      .orderBy(asc(schema.localScanRoots.id));
  }
}
