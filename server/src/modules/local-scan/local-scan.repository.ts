import { Inject, Injectable } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';
import { and, asc, eq, gt } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { CatalogKeyRow } from './local-scan.types';

type Db = NodePgDatabase<typeof schema>;

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

  async insertLocalItems(rows: NewLocalCatalogItem[]): Promise<number> {
    if (rows.length === 0) return 0;

    await this.db
      .insert(schema.warehouseCatalogItems)
      .values(rows.map((row) => ({ ...row, source: 'local' as const })))
      .onConflictDoNothing({ target: [schema.warehouseCatalogItems.mediaType, schema.warehouseCatalogItems.remoteId] });

    return rows.length;
  }

  async markScanStarted(rootId: number): Promise<void> {
    await this.db.update(schema.localScanRoots).set({ lastScanStartedAt: new Date() }).where(eq(schema.localScanRoots.id, rootId));
  }

  async markScanFinished(rootId: number): Promise<void> {
    await this.db.update(schema.localScanRoots).set({ lastScanFinishedAt: new Date() }).where(eq(schema.localScanRoots.id, rootId));
  }
}
