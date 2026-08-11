import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { WarehouseCatalogSyncMediaType, WarehouseCatalogSyncState, WarehouseCatalogSyncSummary } from '@bookorbit/types';

import type { NewWarehouseCatalogItemRow, WarehouseCatalogSyncRunRow, WarehouseSettingRow } from '../../db/schema';
import { WarehouseClientService } from './warehouse-client.service';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService } from './warehouse-secret.service';
import { mapWarehouseAudiobookCatalogItemRow, mapWarehouseComicCatalogItemRow, mapWarehouseEbookCatalogItemRow } from './warehouse-catalog.mapper';
import { WarehouseApiError } from './warehouse.errors';

const COMIC_SERIES_PAGE_SIZE = 100;
const COMIC_SERIES_MAX_PAGES = 200;
const PAGE_LIMIT = 100;
const DISABLED_MESSAGE = 'Enable the catalog source before running a catalog sync.';
const MISSING_CREDENTIALS_MESSAGE = 'Catalog source credentials are missing. Save the catalog source configuration and try again.';
const UNREADABLE_API_KEY_MESSAGE = 'The stored catalog source API key could not be decrypted. Save a new catalog source API key and try again.';
const SYNC_FAILURE_MESSAGE = 'Catalog source sync failed. Try again later.';
const INTERRUPTED_SYNC_MESSAGE = 'Catalog source sync was interrupted before it could finish.';
const RUNNING_SYNC_STALE_MS = 10 * 60 * 1000;
const CATALOG_PAGE_REQUEST_TIMEOUT_MS = 30_000;
const CATALOG_PAGE_MAX_ATTEMPTS = 3;
const CATALOG_PAGE_RETRY_BASE_DELAY_MS = 1_000;
type CatalogPage<Item> = {
  items: Item[];
  total?: number | null;
};
type CatalogItemRow = Omit<NewWarehouseCatalogItemRow, 'id' | 'createdAt' | 'updatedAt'>;

@Injectable()
export class WarehouseCatalogSyncService implements OnModuleInit {
  private readonly logger = new Logger(WarehouseCatalogSyncService.name);
  private readonly activeSyncRunIds = new Set<number>();
  private readonly processToken = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  private readonly processStartedAtMs = Date.now();

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly secret: WarehouseSecretService,
    private readonly client: WarehouseClientService,
  ) {}

  /**
   * Reconcile orphaned runs at startup.
   *
   * A process that dies mid-sync leaves its run marked 'running' forever:
   * reconcileRunningSyncRuns was only ever reached through getSyncState, so a
   * stale row was cleared only if an admin happened to open the sync status
   * page. Restarting IS the ordinary way a sync gets interrupted — a container
   * rebuild orphaned a 184,500-item audiobook run that then sat 'running' for
   * a day — so this is exactly the moment to do it.
   *
   * Never allowed to block boot: a reconcile failure must not stop the app
   * from serving.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.reconcileRunningSyncRuns();
    } catch (error) {
      this.logger.warn(`[catalog.sync.reconcile] startup reconcile failed - ${String(error)}`);
    }
  }

  async getSyncState(): Promise<WarehouseCatalogSyncState> {
    const runningRun = await this.reconcileRunningSyncRuns();
    const [latestRun, latestEbookRun, latestAudiobookRun, latestComicRun] = await Promise.all([
      this.repository.findLatestSyncRun(),
      this.repository.findLatestSyncRun('ebook'),
      this.repository.findLatestSyncRun('audiobook'),
      this.repository.findLatestSyncRun('comic'),
    ]);

    return {
      lastRun: summaryFromRun(latestRun),
      lastRuns: {
        ebook: summaryFromRun(latestEbookRun),
        audiobook: summaryFromRun(latestAudiobookRun),
        comic: summaryFromRun(latestComicRun),
      },
      running: Boolean(runningRun),
    };
  }

  async syncEbooks(): Promise<WarehouseCatalogSyncSummary> {
    return this.syncCatalog(
      'ebook',
      (request) => this.client.listBooks(request),
      (item, syncedAt) => mapWarehouseEbookCatalogItemRow(item, syncedAt),
    );
  }

  async syncAudiobooks(): Promise<WarehouseCatalogSyncSummary> {
    return this.syncCatalog(
      'audiobook',
      (request) => this.client.listAudiobooks(request),
      (item, syncedAt) => mapWarehouseAudiobookCatalogItemRow(item, syncedAt),
    );
  }

  async syncComics(): Promise<WarehouseCatalogSyncSummary> {
    const seriesTitles = await this.loadComicSeriesTitles();
    return this.syncCatalog(
      'comic',
      (request) => this.client.listComics(request),
      (item, syncedAt) => mapWarehouseComicCatalogItemRow(item, syncedAt, seriesTitles),
    );
  }

  /**
   * A comic payload carries seriesId but no series name, so without this lookup every
   * comic row stores a null series and the library is a flat list of story titles with
   * nothing grouping them.
   *
   * Unlike the local scan, a missing map here is not damaging: series simply stays as it
   * would have been anyway, so this degrades to a warning rather than failing the sync.
   */
  private async loadComicSeriesTitles(): Promise<ReadonlyMap<string, string>> {
    const titles = new Map<string, string>();
    try {
      const settings = await this.repository.findSettings();
      const encryptedSecret = settings ? encryptedSecretFromRow(settings) : null;
      if (!settings?.enabled || !encryptedSecret || !settings.baseUrl.trim()) return titles;

      const apiKey = this.secret.decrypt(encryptedSecret);
      for (let page = 0; page < COMIC_SERIES_MAX_PAGES; page++) {
        const result = await this.client.listComicSeries({ baseUrl: settings.baseUrl, apiKey, page, limit: COMIC_SERIES_PAGE_SIZE });
        const items = result.items ?? [];
        if (items.length === 0) break;
        for (const series of items) {
          if (series.id && series.title) titles.set(series.id, series.title);
        }
        if (items.length < COMIC_SERIES_PAGE_SIZE) break;
      }
      this.logger.log(`[catalog.sync] [comic_series] seriesCount=${titles.size} - resolved comic series titles`);
    } catch (error) {
      this.logger.warn(`[catalog.sync] [comic_series] failed, comic series will stay unset - ${String(error)}`);
    }
    return titles;
  }

  async syncAll(): Promise<WarehouseCatalogSyncSummary[]> {
    const summaries = await Promise.all([this.syncEbooks(), this.syncAudiobooks(), this.syncComics()]);
    await this.refreshDerivedColumns();
    return summaries;
  }

  /**
   * Recompute the columns derived from a synced row.
   *
   * An upsert leaves metadata_score null on new rows, and the statistics
   * endpoint falls back to computing it inline — which is exactly the 30s
   * timeout the column exists to avoid. Scoped to `is null`, so this is cheap
   * on an ordinary sync.
   *
   * Never allowed to fail the sync: the rows are already stored and correct,
   * and a missing score degrades to the slower path rather than losing data.
   */
  private async refreshDerivedColumns(): Promise<void> {
    try {
      const updated = await this.repository.refreshMetadataScores();
      if (updated > 0) {
        this.logger.log(`[catalog.sync] [derived] metadata_score refreshed for ${updated} rows`);
      }
    } catch (error) {
      this.logger.warn(`[catalog.sync] [derived] metadata_score refresh failed - ${String(error)}`);
    }
  }

  private async syncCatalog<Item>(
    mediaType: Exclude<WarehouseCatalogSyncMediaType, 'mixed'>,
    listItems: (request: { baseUrl: string; apiKey: string; page: number; limit: number; timeoutMs?: number }) => Promise<CatalogPage<Item>>,
    mapItem: (item: Item, syncedAt: Date) => CatalogItemRow,
  ): Promise<WarehouseCatalogSyncSummary> {
    const settings = await this.repository.findSettings();

    if (!settings?.enabled) {
      throw new BadRequestException(DISABLED_MESSAGE);
    }

    const encryptedSecret = encryptedSecretFromRow(settings);
    if (!encryptedSecret || !settings.baseUrl.trim()) {
      throw new BadRequestException(MISSING_CREDENTIALS_MESSAGE);
    }

    let apiKey: string;
    try {
      apiKey = this.secret.decrypt(encryptedSecret);
    } catch {
      throw new BadRequestException(UNREADABLE_API_KEY_MESSAGE);
    }

    let syncRun: WarehouseCatalogSyncRunRow | undefined;
    let fetchedCount = 0;
    let savedCount = 0;
    let totalCount: number | null = null;
    let page = 1;

    try {
      syncRun = await this.repository.createSyncRun(mediaType, this.syncRunTimings());
      this.activeSyncRunIds.add(syncRun.id);
      const syncedAt = syncRun.startedAt;

      while (true) {
        const response = await this.fetchCatalogPageWithRetry(
          listItems,
          {
            baseUrl: settings.baseUrl,
            apiKey,
            page,
            limit: PAGE_LIMIT,
            timeoutMs: CATALOG_PAGE_REQUEST_TIMEOUT_MS,
          },
          {
            mediaType,
            syncRunId: syncRun.id,
            page,
            counts: () => ({ fetchedCount, savedCount }),
          },
        );

        const items = response.items.map((item) => mapItem(item, syncedAt));
        totalCount = normalizeCatalogTotal(response.total) ?? totalCount;
        fetchedCount += items.length;
        savedCount += await this.repository.upsertCatalogItems(items);
        await this.repository.updateSyncRunProgress(
          syncRun.id,
          { fetchedCount, savedCount },
          this.syncRunTimings({ currentPage: page, currentAttempt: 1, totalCount: totalCount ?? undefined }),
        );

        const reachedShortPage = items.length < PAGE_LIMIT;
        const reachedUpstreamTotal = totalCount !== null && fetchedCount >= totalCount;

        if (reachedShortPage || reachedUpstreamTotal) {
          const finishedAt = new Date();
          await this.repository.completeSyncRun(
            syncRun.id,
            { fetchedCount, savedCount },
            this.syncRunTimings({ completedPage: page, currentPage: page, totalCount: totalCount ?? undefined }),
          );

          return toSummary(syncRun, {
            status: 'completed',
            fetchedCount,
            savedCount,
            totalCount,
            errorMessage: null,
            finishedAt,
          });
        }

        page += 1;
      }
    } catch (error) {
      throw await this.handleSyncFailure(error, syncRun, { fetchedCount, savedCount }, page, totalCount);
    } finally {
      if (syncRun) {
        this.activeSyncRunIds.delete(syncRun.id);
      }
    }
  }

  private async reconcileRunningSyncRuns(): Promise<WarehouseCatalogSyncRunRow | null> {
    const runningRuns = await this.repository.listRunningSyncRuns();
    const activeRuns = runningRuns.filter((run) => this.activeSyncRunIds.has(run.id));
    const now = Date.now();

    await Promise.all(
      runningRuns
        .filter((run) => !this.activeSyncRunIds.has(run.id) && this.shouldMarkInterrupted(run, now))
        .map((run) =>
          this.repository.failSyncRun(run.id, INTERRUPTED_SYNC_MESSAGE, {
            fetchedCount: run.fetchedCount,
            savedCount: run.savedCount,
          }),
        ),
    );

    return activeRuns[0] ?? runningRuns.find((run) => !this.shouldMarkInterrupted(run, now)) ?? null;
  }

  private shouldMarkInterrupted(run: WarehouseCatalogSyncRunRow, now: number): boolean {
    const timings = run.timings ?? {};
    const ownerToken = timings.ownerToken;
    const lastProgressAtMs = timings.lastProgressAtMs;

    if (ownerToken === this.processToken) {
      return true;
    }

    if (typeof lastProgressAtMs === 'number' && Number.isFinite(lastProgressAtMs)) {
      return now - lastProgressAtMs >= RUNNING_SYNC_STALE_MS;
    }

    return now - run.startedAt.getTime() >= RUNNING_SYNC_STALE_MS;
  }

  private async fetchCatalogPageWithRetry<Item>(
    listItems: (request: { baseUrl: string; apiKey: string; page: number; limit: number; timeoutMs?: number }) => Promise<CatalogPage<Item>>,
    request: { baseUrl: string; apiKey: string; page: number; limit: number; timeoutMs?: number },
    context: {
      mediaType: Exclude<WarehouseCatalogSyncMediaType, 'mixed'>;
      syncRunId: number;
      page: number;
      counts: () => { fetchedCount: number; savedCount: number };
    },
  ): Promise<CatalogPage<Item>> {
    for (let attempt = 1; attempt <= CATALOG_PAGE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await listItems(request);
      } catch (error) {
        const transient = this.isTransientCatalogPageError(error);
        const finalAttempt = attempt >= CATALOG_PAGE_MAX_ATTEMPTS || !transient;
        const status = this.catalogErrorStatus(error);
        const timings = this.syncRunTimings({
          currentPage: context.page,
          currentAttempt: attempt,
          maxAttempts: CATALOG_PAGE_MAX_ATTEMPTS,
          lastFailureAtMs: Date.now(),
          ...(status === undefined ? {} : { lastErrorStatus: status }),
        });

        await this.repository.updateSyncRunProgress(context.syncRunId, context.counts(), timings);
        this.logCatalogPageFailure(error, context.mediaType, context.page, attempt, finalAttempt);

        if (finalAttempt) {
          throw error;
        }

        await this.sleep(this.retryDelayMs(attempt));
      }
    }

    throw new InternalServerErrorException(SYNC_FAILURE_MESSAGE);
  }

  private syncRunTimings(extra: Record<string, number | undefined> = {}): Record<string, number> {
    const timings: Record<string, number> = {
      ownerToken: this.processToken,
      ownerStartedAtMs: this.processStartedAtMs,
      lastProgressAtMs: Date.now(),
    };

    for (const [key, value] of Object.entries(extra)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        timings[key] = value;
      }
    }

    return timings;
  }

  private async handleSyncFailure(
    error: unknown,
    syncRun?: WarehouseCatalogSyncRunRow,
    counts?: { fetchedCount: number; savedCount: number },
    page?: number,
    totalCount?: number | null,
  ): Promise<InternalServerErrorException> {
    if (!syncRun) {
      return new InternalServerErrorException(SYNC_FAILURE_MESSAGE);
    }

    try {
      await this.repository.failSyncRun(
        syncRun.id,
        SYNC_FAILURE_MESSAGE,
        counts ?? { fetchedCount: 0, savedCount: 0 },
        this.syncRunTimings({
          ...(page === undefined ? {} : { failedPage: page, currentPage: page }),
          ...(totalCount === null || totalCount === undefined ? {} : { totalCount }),
          ...(this.catalogErrorStatus(error) === undefined ? {} : { lastErrorStatus: this.catalogErrorStatus(error) }),
          lastFailureAtMs: Date.now(),
        }),
      );
    } catch {
      // The original sync failure is the important error to surface here.
    }

    this.logger.error(
      `[warehouse.catalog_sync] [fail] runId=${syncRun.id} mediaType=${syncRun.mediaType} page=${page ?? 'unknown'} fetched=${counts?.fetchedCount ?? 0} saved=${counts?.savedCount ?? 0} error="${this.safeErrorSummary(error)}" - catalog sync failed`,
    );
    return new InternalServerErrorException(SYNC_FAILURE_MESSAGE);
  }

  private isTransientCatalogPageError(error: unknown): boolean {
    if (error instanceof WarehouseApiError) {
      return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return message.includes('timed out') || message.includes('request failed');
  }

  private catalogErrorStatus(error: unknown): number | undefined {
    return error instanceof WarehouseApiError ? error.status : undefined;
  }

  private safeErrorSummary(error: unknown): string {
    if (error instanceof WarehouseApiError) {
      return `Catalog source API error ${error.status}`;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('timed out')) {
        return 'Catalog source request timed out';
      }

      if (message.includes('request failed')) {
        return 'Catalog source request failed';
      }

      return error.name || 'Unexpected catalog source sync error';
    }

    return 'Unexpected catalog source sync error';
  }

  private logCatalogPageFailure(
    error: unknown,
    mediaType: Exclude<WarehouseCatalogSyncMediaType, 'mixed'>,
    page: number,
    attempt: number,
    finalAttempt: boolean,
  ) {
    this.logger.warn(
      `[warehouse.catalog_sync.page] [${finalAttempt ? 'fail' : 'retry'}] mediaType=${mediaType} page=${page} attempt=${attempt}/${CATALOG_PAGE_MAX_ATTEMPTS} error="${this.safeErrorSummary(error)}" - catalog page fetch failed`,
    );
  }

  private retryDelayMs(attempt: number): number {
    return CATALOG_PAGE_RETRY_BASE_DELAY_MS * attempt;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function encryptedSecretFromRow(row: WarehouseSettingRow) {
  if (!row.apiKeyEncrypted || !row.apiKeyNonce || !row.apiKeyTag) {
    return null;
  }

  return {
    ciphertext: row.apiKeyEncrypted,
    nonce: row.apiKeyNonce,
    tag: row.apiKeyTag,
  };
}

function toSummary(
  syncRun: WarehouseCatalogSyncRunRow,
  state: Pick<WarehouseCatalogSyncSummary, 'status' | 'fetchedCount' | 'savedCount' | 'errorMessage'> & {
    finishedAt: Date | null;
    totalCount?: number | null;
  },
): WarehouseCatalogSyncSummary {
  return {
    runId: syncRun.id,
    status: state.status,
    mediaType: syncRun.mediaType,
    fetchedCount: state.fetchedCount,
    savedCount: state.savedCount,
    totalCount: state.totalCount ?? totalCountFromTimings(syncRun.timings),
    errorMessage: state.errorMessage,
    startedAt: syncRun.startedAt.toISOString(),
    finishedAt: state.finishedAt?.toISOString() ?? null,
  };
}

function summaryFromRun(syncRun: WarehouseCatalogSyncRunRow | null | undefined): WarehouseCatalogSyncSummary | null {
  if (!syncRun) {
    return null;
  }

  return toSummary(syncRun, {
    status: syncRun.status,
    fetchedCount: syncRun.fetchedCount,
    savedCount: syncRun.savedCount,
    totalCount: totalCountFromTimings(syncRun.timings),
    errorMessage: syncRun.errorMessage,
    finishedAt: syncRun.finishedAt,
  });
}

function normalizeCatalogTotal(total: number | null | undefined): number | null {
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? Math.floor(total) : null;
}

function totalCountFromTimings(timings: Record<string, number> | null | undefined): number | null {
  return normalizeCatalogTotal(timings?.totalCount);
}
