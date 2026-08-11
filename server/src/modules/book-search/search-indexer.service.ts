import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { mapCatalogRowToDocument, mapNativeBookToDocument } from './book-search-document.mapper';
import { BookSearchSettingsService } from './book-search.settings';
import type { BookSearchDocument } from './book-search.types';
import { MeilisearchClient } from './meilisearch.client';
import { SearchIndexRepository } from './search-index.repository';

export const DRAIN_BATCH_SIZE = 500;
const REBUILD_BATCH_SIZE = 1000;
const REBUILD_INDEX_PREFIX = 'bookorbit_books_rebuild_';

interface OutboxEvent {
  id: number;
  entityType: 'catalog_item' | 'native_book';
  entityId: string;
  operation: 'upsert' | 'delete';
}

function parseCatalogEntityId(entityId: string): { mediaType: string; remoteId: string } {
  const parts = entityId.split(':');
  return { mediaType: parts[1] ?? '', remoteId: parts.slice(2).join(':') };
}

function parseNativeEntityId(entityId: string): number {
  return Number(entityId.split(':')[1]);
}

@Injectable()
export class SearchIndexerService {
  private readonly logger = new Logger(SearchIndexerService.name);

  constructor(
    private readonly repository: SearchIndexRepository,
    private readonly settings: BookSearchSettingsService,
  ) {}

  private async clientFor(): Promise<MeilisearchClient> {
    const config = await this.settings.get();
    const apiKey = await this.settings.getApiKey();
    if (!config.url || !apiKey) {
      throw new ServiceUnavailableException('Meilisearch is not configured');
    }
    return new MeilisearchClient({ url: config.url, apiKey });
  }

  private async loadUpsertDocuments(events: OutboxEvent[]): Promise<BookSearchDocument[]> {
    const catalogKeys = events
      .filter((event) => event.entityType === 'catalog_item')
      .map((event) => parseCatalogEntityId(event.entityId))
      .filter((key) => key.mediaType !== '' && key.remoteId !== '');
    const nativeIds = events
      .filter((event) => event.entityType === 'native_book')
      .map((event) => parseNativeEntityId(event.entityId))
      .filter((id) => Number.isFinite(id));

    const [catalogRows, nativeRows] = await Promise.all([
      this.repository.getCatalogRowsByKeys(catalogKeys as { mediaType: WarehouseMediaType; remoteId: string }[]),
      this.repository.getNativeRowsByIds(nativeIds),
    ]);

    return [...catalogRows.map(mapCatalogRowToDocument), ...nativeRows.map(mapNativeBookToDocument)];
  }

  async drain(): Promise<{ applied: number; failed: number }> {
    const startedAt = Date.now();
    const events = (await this.repository.claimBatch(DRAIN_BATCH_SIZE)) as OutboxEvent[];

    if (events.length === 0) {
      return { applied: 0, failed: 0 };
    }

    let config: Awaited<ReturnType<BookSearchSettingsService['get']>>;
    let client: MeilisearchClient;
    try {
      config = await this.settings.get();
      client = await this.clientFor();
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[search_index.drain] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - failed to prepare meilisearch client, outbox left untouched`,
      );
      throw error;
    }

    const upserts = events.filter((event) => event.operation === 'upsert');
    const deletes = events.filter((event) => event.operation === 'delete');

    let applied = 0;
    let failed = 0;
    const succeededIds: number[] = [];

    if (upserts.length > 0) {
      try {
        const documents = await this.loadUpsertDocuments(upserts);
        await client.addDocuments(config.activeIndex, documents);
        succeededIds.push(...upserts.map((event) => event.id));
        applied += upserts.length;
      } catch (error) {
        failed += upserts.length;
        const errorClass = error instanceof Error ? error.name : 'UnknownError';
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[search_index.drain] [fail] op=upsert count=${upserts.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - failed to write upserts, events left in outbox`,
        );
      }
    }

    if (deletes.length > 0) {
      try {
        await client.deleteDocuments(
          config.activeIndex,
          deletes.map((event) => event.entityId),
        );
        succeededIds.push(...deletes.map((event) => event.id));
        applied += deletes.length;
      } catch (error) {
        failed += deletes.length;
        const errorClass = error instanceof Error ? error.name : 'UnknownError';
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[search_index.drain] [fail] op=delete count=${deletes.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - failed to delete documents, events left in outbox`,
        );
      }
    }

    if (succeededIds.length > 0) {
      await this.repository.deleteEvents(succeededIds);
    }

    this.logger.log(`[search_index.drain] [end] durationMs=${Date.now() - startedAt} applied=${applied} failed=${failed} - outbox drain completed`);

    return { applied, failed };
  }

  /** Best effort only: the cleanup outcome must never change which error the caller sees,
   *  because the original failure is what explains why the rebuild did not complete. */
  private async cleanupFailedRebuild(client: MeilisearchClient, index: string): Promise<void> {
    if (!index.startsWith(REBUILD_INDEX_PREFIX)) return;

    try {
      const config = await this.settings.get();
      if (index === config.activeIndex) return;

      await client.deleteIndex(index);
    } catch (cleanupError) {
      const errorClass = cleanupError instanceof Error ? cleanupError.name : 'UnknownError';
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      this.logger.error(
        `[search_index.rebuild_cleanup] [fail] index="${sanitizeLogValue(index)}" errorClass=${errorClass} error="${sanitizeLogValue(message)}" - failed to delete orphaned rebuild index`,
      );
    }
  }

  async rebuild(): Promise<{ indexed: number; index: string }> {
    const startedAt = Date.now();
    const index = `${REBUILD_INDEX_PREFIX}${Date.now()}`;
    let client: MeilisearchClient | undefined;
    let created = false;

    this.logger.log(`[search_index.rebuild] [start] index="${sanitizeLogValue(index)}" - rebuild started`);

    try {
      client = await this.clientFor();
      await client.createIndex(index);
      created = true;
      await client.applySettings(index);

      let indexed = 0;

      for await (const batch of this.repository.streamCatalogDocuments(REBUILD_BATCH_SIZE)) {
        await client.addDocuments(index, batch.map(mapCatalogRowToDocument));
        indexed += batch.length;
      }

      for await (const batch of this.repository.streamNativeDocuments(REBUILD_BATCH_SIZE)) {
        await client.addDocuments(index, batch.map(mapNativeBookToDocument));
        indexed += batch.length;
      }

      await this.settings.save({ activeIndex: index });

      this.logger.log(
        `[search_index.rebuild] [end] index="${sanitizeLogValue(index)}" durationMs=${Date.now() - startedAt} indexed=${indexed} - rebuild completed`,
      );

      return { indexed, index };
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[search_index.rebuild] [fail] index="${sanitizeLogValue(index)}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - rebuild failed, previous index remains active`,
      );

      if (created && client) {
        await this.cleanupFailedRebuild(client, index);
      }

      throw error;
    }
  }

  rebuildInBackground(): void {
    void this.rebuild().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[search_index.rebuild_background] [fail] error="${sanitizeLogValue(message)}" - detached rebuild failed`);
    });
  }
}
