import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { mapCatalogRowToDocument, mapNativeBookToDocument, parseSearchDocumentId } from './book-search-document.mapper';
import { BookSearchSettingsService, DEFAULT_BOOK_SEARCH_INDEX } from './book-search.settings';
import type { BookSearchDocument } from './book-search.types';
import { MeilisearchClient } from './meilisearch.client';
import { SearchIndexRepository } from './search-index.repository';

export const DRAIN_BATCH_SIZE = 500;
const REBUILD_BATCH_SIZE = 1000;
const REBUILD_INDEX_PREFIX = 'bookorbit_books_rebuild_';
/** A full rebuild is hundreds of batches over 400,000 rows, and the final task only completes
 *  once every earlier one has, so this wait is measured in minutes rather than seconds. */
const REBUILD_TASK_TIMEOUT_MS = 30 * 60 * 1000;

interface OutboxEvent {
  id: number;
  entityType: 'catalog_item' | 'native_book';
  entityId: string;
  operation: 'upsert' | 'delete';
}

interface OutboxRun {
  operation: 'upsert' | 'delete';
  events: OutboxEvent[];
}

/** Events are claimed in id order and applied in consecutive same-operation runs, so a delete
 *  followed by a reinsert of the same document inside one batch keeps that order. Grouping all
 *  upserts and then all deletes would have applied the delete last and lost the document. */
function groupConsecutiveRuns(events: OutboxEvent[]): OutboxRun[] {
  const runs: OutboxRun[] = [];

  for (const event of events) {
    const current = runs[runs.length - 1];
    if (current && current.operation === event.operation) {
      current.events.push(event);
      continue;
    }
    runs.push({ operation: event.operation, events: [event] });
  }

  return runs;
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
    const catalogKeys: { mediaType: WarehouseMediaType; remoteId: string }[] = [];
    const nativeIds: number[] = [];

    for (const event of events) {
      const parsed = parseSearchDocumentId(event.entityId);
      if (!parsed) continue;

      if (parsed.source === 'catalog' && event.entityType === 'catalog_item') {
        catalogKeys.push({ mediaType: parsed.mediaType as WarehouseMediaType, remoteId: parsed.remoteId });
      } else if (parsed.source === 'native' && event.entityType === 'native_book') {
        nativeIds.push(parsed.bookId);
      }
    }

    const [catalogRows, nativeRows] = await Promise.all([
      this.repository.getCatalogRowsByKeys(catalogKeys),
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

    const runs = groupConsecutiveRuns(events);
    const succeededIds: number[] = [];
    let applied = 0;

    for (const run of runs) {
      try {
        await this.applyRun(client, config.activeIndex, run);
      } catch (error) {
        const errorClass = error instanceof Error ? error.name : 'UnknownError';
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[search_index.drain] [fail] op=${run.operation} count=${run.events.length} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - failed to apply a batch, it and everything after it stay in the outbox`,
        );
        break;
      }

      succeededIds.push(...run.events.map((event) => event.id));
      applied += run.events.length;
    }

    if (succeededIds.length > 0) {
      await this.repository.deleteEvents(succeededIds);
    }

    const failed = events.length - applied;
    this.logger.log(`[search_index.drain] [end] durationMs=${Date.now() - startedAt} applied=${applied} failed=${failed} - outbox drain completed`);

    return { applied, failed };
  }

  private async applyRun(client: MeilisearchClient, index: string, run: OutboxRun): Promise<void> {
    const taskUid =
      run.operation === 'upsert'
        ? await client.addDocuments(index, await this.loadUpsertDocuments(run.events))
        : await client.deleteDocuments(
            index,
            run.events.map((event) => event.entityId),
          );

    if (typeof taskUid === 'number') {
      await client.waitForTask(taskUid);
    }
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

  /** Only a name this module owns may be removed, and never the one the pointer now aims at.
   *  Meilisearch is shared with another product, so a cleanup bug that removed a live index
   *  would be far worse than the leak it exists to prevent. */
  private isDeletableIndexName(index: string): boolean {
    return index.startsWith(REBUILD_INDEX_PREFIX) || index === DEFAULT_BOOK_SEARCH_INDEX;
  }

  /** Runs after the pointer has been flipped, so the rebuild has already succeeded and a
   *  failure here is logged rather than surfaced. */
  private async deleteReplacedIndex(client: MeilisearchClient, previousIndex: string, activeIndex: string): Promise<void> {
    if (!previousIndex || previousIndex === activeIndex || !this.isDeletableIndexName(previousIndex)) {
      return;
    }

    try {
      const config = await this.settings.get();
      if (config.activeIndex !== activeIndex) {
        return;
      }

      await client.deleteIndex(previousIndex);
      this.logger.log(`[search_index.rebuild_replace] [end] index="${sanitizeLogValue(previousIndex)}" - deleted the index the rebuild replaced`);
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[search_index.rebuild_replace] [fail] index="${sanitizeLogValue(previousIndex)}" errorClass=${errorClass} error="${sanitizeLogValue(message)}" - failed to delete the replaced index, it is left on the server`,
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
      const previousIndex = (await this.settings.get()).activeIndex;
      client = await this.clientFor();
      await client.createIndex(index);
      created = true;
      await client.applySettings(index);

      let indexed = 0;
      let lastTaskUid: number | null = null;

      for await (const batch of this.repository.streamCatalogDocuments(REBUILD_BATCH_SIZE)) {
        lastTaskUid = await client.addDocuments(index, batch.map(mapCatalogRowToDocument));
        indexed += batch.length;
      }

      for await (const batch of this.repository.streamNativeDocuments(REBUILD_BATCH_SIZE)) {
        lastTaskUid = await client.addDocuments(index, batch.map(mapNativeBookToDocument));
        indexed += batch.length;
      }

      // Meilisearch processes an index's tasks in submission order, so the last one succeeding
      // means the whole rebuild has landed. Flipping the pointer before that would activate a
      // half populated index.
      if (typeof lastTaskUid === 'number') {
        await client.waitForTask(lastTaskUid, REBUILD_TASK_TIMEOUT_MS);
      }

      await this.settings.save({ activeIndex: index });
      await this.deleteReplacedIndex(client, previousIndex, index);

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
