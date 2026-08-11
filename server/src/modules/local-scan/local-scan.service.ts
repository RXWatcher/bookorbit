import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { extname } from 'path';
import { ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, forwardRef } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { LocalScanRepository, type NewLocalCatalogItem } from './local-scan.repository';
import { AudiobookMatchStrategy } from './strategies/audiobook-match.strategy';
import { ComicMatchStrategy } from './strategies/comic-match.strategy';
import { EbookMatchStrategy } from './strategies/ebook-match.strategy';
import type { LocalMatchStrategy, LocalScanSummary, WalkStats } from './local-scan.types';
import { walkFiles } from './local-scan.walker';

const AUDIOBOOK_REMOTE_PREFIX = '/media/zd-storage-ceph-books/audiobooks/Audiobooks_English/';
const CATALOG_BATCH_SIZE = 5000;
const INSERT_BATCH_SIZE = 500;
const DEFAULT_EXCLUDES = ['.caltrash', '.calnotes'];
const UNKEYED_SAMPLE_LIMIT = 5;
const COMIC_SERIES_PAGE_SIZE = 100;
const COMIC_SERIES_MAX_PAGES = 200;

const EXTENSIONS: Record<WarehouseMediaType, string[]> = {
  ebook: ['.epub', '.mobi', '.azw3', '.azw', '.pdf', '.fb2'],
  audiobook: ['.m4b', '.mp3', '.m4a', '.opus', '.ogg', '.flac'],
  comic: ['.cbz', '.cbr', '.cb7'],
};

/** Identity of a local row. Derived from the book directory key rather than the file path,
 *  because the deduplication unit is the book, not whichever sibling file the walk reached
 *  first. Hashing the file path made the id change when a format was added or removed, which
 *  let a rescan insert a second row for the same book. */
function localRemoteId(mediaType: WarehouseMediaType, key: string): string {
  return `local:${createHash('sha256').update(`${mediaType}\0${key}`).digest('hex')}`;
}

function emptySummary(rootId: number): LocalScanSummary {
  return {
    rootId,
    scanned: 0,
    matched: 0,
    matchedByFallback: 0,
    inserted: 0,
    unkeyed: 0,
    deduped: 0,
    reconciled: 0,
    unreadableDirs: 0,
    symlinksSkipped: 0,
  };
}

@Injectable()
export class LocalScanService {
  private readonly logger = new Logger(LocalScanService.name);

  constructor(
    private readonly repository: LocalScanRepository,
    @Inject(forwardRef(() => WarehouseCatalogService))
    private readonly warehouseCatalog: WarehouseCatalogService,
  ) {}

  private async strategyFor(mediaType: WarehouseMediaType): Promise<LocalMatchStrategy> {
    switch (mediaType) {
      case 'ebook':
        return new EbookMatchStrategy();
      case 'audiobook':
        return new AudiobookMatchStrategy(AUDIOBOOK_REMOTE_PREFIX);
      case 'comic':
        return new ComicMatchStrategy(await this.loadComicSeriesTitles());
      default:
        throw new NotFoundException(`No local match strategy for media type ${String(mediaType)}`);
    }
  }

  /**
   * Comic identity is (series, issue), and the series name exists only upstream. An empty
   * or partial map keys nothing, and a comic that keys nothing is inserted as a new local
   * row, so a silent failure here would duplicate the entire comic catalogue. Abort instead.
   */
  private async loadComicSeriesTitles(): Promise<ReadonlyMap<string, string>> {
    const titles = new Map<string, string>();
    for (let page = 0; page < COMIC_SERIES_MAX_PAGES; page++) {
      const result = await this.warehouseCatalog.listComicSeries({ page, limit: COMIC_SERIES_PAGE_SIZE });
      const items = result.items ?? [];
      if (items.length === 0) break;
      for (const series of items) {
        if (series.id && series.title) titles.set(series.id, series.title);
      }
      if (items.length < COMIC_SERIES_PAGE_SIZE) break;
    }

    if (titles.size === 0) {
      throw new ServiceUnavailableException('Comic series titles are unavailable, so a comic scan would duplicate the catalogue');
    }
    this.logger.log(`[local_scan.comic_series] [end] seriesCount=${titles.size} - resolved comic series titles`);
    return titles;
  }

  getStatuses() {
    return this.repository.findRootStatuses();
  }

  /** Validates before the caller detaches the run, so an unknown or disabled root still
   *  answers 404 rather than failing invisibly in the background. */
  async assertScannable(rootId: number): Promise<void> {
    const roots = await this.repository.findEnabledRoots();
    if (!roots.some((root) => root.id === rootId)) throw new NotFoundException(`Scan root ${rootId} not found or disabled`);
  }

  /** Detached run. Failures are recorded on the root by markScanFailed, so they are
   *  observable through GET roots rather than lost with the request. */
  runInBackground(rootId: number): void {
    void this.scanRoot(rootId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[local_scan.background] [fail] rootId=${rootId} error="${sanitizeLogValue(message)}" - detached scan failed`);
    });
  }

  runAllInBackground(): void {
    void this.scanAll().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[local_scan.background] [fail] error="${sanitizeLogValue(message)}" - detached scan of all roots failed`);
    });
  }

  async scanAll(): Promise<LocalScanSummary[]> {
    const roots = await this.repository.findEnabledRoots();
    const summaries: LocalScanSummary[] = [];
    for (const root of roots) {
      summaries.push(await this.scanRoot(root.id));
    }
    return summaries;
  }

  async scanRoot(rootId: number): Promise<LocalScanSummary> {
    const roots = await this.repository.findEnabledRoots();
    const root = roots.find((candidate) => candidate.id === rootId);
    if (!root) throw new NotFoundException(`Scan root ${rootId} not found or disabled`);

    const locked = await this.repository.tryLockRoot(rootId);
    if (!locked) throw new ConflictException(`Scan root ${rootId} is already being scanned`);

    const startedAt = Date.now();
    const scanStartedAt = new Date();
    const summary = emptySummary(rootId);
    const walkStats: WalkStats = { unreadableDirs: 0, symlinksSkipped: 0 };

    this.logger.log(`[local_scan.root] [start] rootId=${rootId} mediaType=${root.mediaType} - local scan started`);
    await this.repository.markScanStarted(rootId);

    try {
      const strategy = await this.strategyFor(root.mediaType);

      const catalogKeys = new Set<string>();
      const catalogFallbackKeys = new Set<string>();
      for await (const batch of this.repository.streamCatalogKeyRows(root.mediaType, CATALOG_BATCH_SIZE)) {
        for (const row of batch) {
          const key = strategy.catalogKey(row);
          if (key) catalogKeys.add(key);
          const fallback = strategy.fallbackCatalogKey?.(row);
          if (fallback) catalogFallbackKeys.add(fallback);
        }
      }

      const seen = new Set<string>();
      const seenFallback = new Set<string>();
      const unkeyedSamples: string[] = [];
      let pending: NewLocalCatalogItem[] = [];

      const flush = async () => {
        if (pending.length === 0) return;
        summary.inserted += await this.repository.insertLocalItems(pending);
        pending = [];
      };

      const excludePatterns = [...DEFAULT_EXCLUDES, ...root.excludePatterns];

      for await (const candidate of walkFiles(root.absolutePath, {
        extensions: EXTENSIONS[root.mediaType],
        excludePatterns,
        stats: walkStats,
      })) {
        summary.scanned += 1;

        const key = strategy.diskKey(candidate);
        if (!key) {
          summary.unkeyed += 1;
          if (unkeyedSamples.length < UNKEYED_SAMPLE_LIMIT) unkeyedSamples.push(candidate.relativePath);
          continue;
        }
        if (catalogKeys.has(key)) {
          summary.matched += 1;
          continue;
        }
        if (seen.has(key)) {
          summary.deduped += 1;
          continue;
        }

        // The same book can be filed under a series prefixed directory upstream, so a path
        // miss is checked again on author plus title before it counts as missing.
        const fallbackKey = strategy.fallbackDiskKey?.(candidate);
        if (fallbackKey && catalogFallbackKeys.has(fallbackKey)) {
          summary.matchedByFallback += 1;
          continue;
        }
        if (fallbackKey && seenFallback.has(fallbackKey)) {
          summary.deduped += 1;
          continue;
        }

        seen.add(key);
        if (fallbackKey) seenFallback.add(fallbackKey);

        let fileSizeBytes: number | null = null;
        try {
          fileSizeBytes = (await stat(candidate.absolutePath)).size;
        } catch {
          fileSizeBytes = null;
        }

        pending.push({
          mediaType: root.mediaType,
          remoteId: localRemoteId(root.mediaType, key),
          title: strategy.titleFor(candidate),
          localPath: candidate.absolutePath,
          format: extname(candidate.fileName).replace('.', '').toLowerCase() || null,
          fileSizeBytes,
        });

        if (pending.length >= INSERT_BATCH_SIZE) await flush();
      }

      await flush();

      summary.reconciled = await this.reconcileAgainstLateSyncs(root.mediaType, strategy, scanStartedAt, seen);
      summary.inserted -= summary.reconciled;
      summary.unreadableDirs = walkStats.unreadableDirs;
      summary.symlinksSkipped = walkStats.symlinksSkipped;

      if (summary.unkeyed > 0) {
        this.logger.warn(
          `[local_scan.unkeyed] [end] rootId=${rootId} unkeyed=${summary.unkeyed} samples="${sanitizeLogValue(unkeyedSamples.join(' | '))}" - candidates produced no key and are not in the library`,
        );
      }
      if (walkStats.unreadableDirs > 0) {
        this.logger.warn(
          `[local_scan.unreadable] [end] rootId=${rootId} unreadableDirs=${walkStats.unreadableDirs} - directories could not be opened and their contents were not scanned`,
        );
      }

      await this.repository.markScanFinished(rootId, summary);
      this.logger.log(
        `[local_scan.root] [end] rootId=${rootId} durationMs=${Date.now() - startedAt} scanned=${summary.scanned} matched=${summary.matched} matchedByFallback=${summary.matchedByFallback} inserted=${summary.inserted} unkeyed=${summary.unkeyed} deduped=${summary.deduped} reconciled=${summary.reconciled} - local scan completed`,
      );

      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error ? error.constructor.name : 'Unknown';
      summary.unreadableDirs = walkStats.unreadableDirs;
      summary.symlinksSkipped = walkStats.symlinksSkipped;
      await this.repository.markScanFailed(rootId, message, summary);
      this.logger.error(
        `[local_scan.root] [fail] rootId=${rootId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - local scan failed`,
      );
      throw error;
    } finally {
      await this.repository.unlockRoot(rootId);
    }
  }

  /** The catalogue key set is a snapshot taken before a walk that can run for minutes. A
   *  warehouse sync landing in that window would leave both its row and a local row for the
   *  same book, so any local row this run created for a newly synced key is removed. */
  private async reconcileAgainstLateSyncs(
    mediaType: WarehouseMediaType,
    strategy: LocalMatchStrategy,
    since: Date,
    insertedKeys: Set<string>,
  ): Promise<number> {
    const lateRows = await this.repository.findCatalogKeyRowsSyncedSince(mediaType, since);
    if (lateRows.length === 0) return 0;

    const collisions: string[] = [];
    for (const row of lateRows) {
      const key = strategy.catalogKey(row);
      if (key && insertedKeys.has(key)) collisions.push(localRemoteId(mediaType, key));
    }

    if (collisions.length === 0) return 0;
    return this.repository.deleteLocalItemsByRemoteIds(mediaType, collisions);
  }
}
