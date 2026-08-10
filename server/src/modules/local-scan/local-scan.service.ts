import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { extname } from 'path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LocalScanRepository, type NewLocalCatalogItem } from './local-scan.repository';
import { AudiobookMatchStrategy } from './strategies/audiobook-match.strategy';
import { ComicMatchStrategy } from './strategies/comic-match.strategy';
import { EbookMatchStrategy } from './strategies/ebook-match.strategy';
import type { LocalMatchStrategy, LocalScanSummary } from './local-scan.types';
import { walkFiles } from './local-scan.walker';

const AUDIOBOOK_REMOTE_PREFIX = '/media/zd-storage-ceph-books/audiobooks/Audiobooks_English/';
const CATALOG_BATCH_SIZE = 5000;
const INSERT_BATCH_SIZE = 500;
const DEFAULT_EXCLUDES = ['.caltrash', '.calnotes'];

const EXTENSIONS: Record<WarehouseMediaType, string[]> = {
  ebook: ['.epub', '.mobi', '.azw3', '.azw', '.pdf', '.fb2'],
  audiobook: ['.m4b', '.mp3', '.m4a', '.opus', '.ogg', '.flac'],
  comic: ['.cbz', '.cbr', '.cb7'],
};

@Injectable()
export class LocalScanService {
  private readonly logger = new Logger(LocalScanService.name);

  constructor(private readonly repository: LocalScanRepository) {}

  private strategyFor(mediaType: WarehouseMediaType): LocalMatchStrategy {
    if (mediaType === 'ebook') return new EbookMatchStrategy();
    if (mediaType === 'audiobook') return new AudiobookMatchStrategy(AUDIOBOOK_REMOTE_PREFIX);
    return new ComicMatchStrategy();
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

    const startedAt = Date.now();
    this.logger.log(`[local_scan.root] [start] rootId=${rootId} mediaType=${root.mediaType} - local scan started`);
    await this.repository.markScanStarted(rootId);

    const strategy = this.strategyFor(root.mediaType);

    const catalogKeys = new Set<string>();
    for await (const batch of this.repository.streamCatalogKeyRows(root.mediaType, CATALOG_BATCH_SIZE)) {
      for (const row of batch) {
        const key = strategy.catalogKey(row);
        if (key) catalogKeys.add(key);
      }
    }

    const summary: LocalScanSummary = { rootId, scanned: 0, matched: 0, inserted: 0, skipped: 0 };
    const seen = new Set<string>();
    let pending: NewLocalCatalogItem[] = [];

    const flush = async () => {
      if (pending.length === 0) return;
      summary.inserted += await this.repository.insertLocalItems(pending);
      pending = [];
    };

    try {
      const excludePatterns = [...DEFAULT_EXCLUDES, ...root.excludePatterns];

      for await (const candidate of walkFiles(root.absolutePath, { extensions: EXTENSIONS[root.mediaType], excludePatterns })) {
        summary.scanned += 1;

        const key = strategy.diskKey(candidate);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        if (catalogKeys.has(key)) {
          summary.matched += 1;
          continue;
        }
        if (seen.has(key)) {
          summary.skipped += 1;
          continue;
        }
        seen.add(key);

        let fileSizeBytes: number | null = null;
        try {
          fileSizeBytes = (await stat(candidate.absolutePath)).size;
        } catch {
          fileSizeBytes = null;
        }

        pending.push({
          mediaType: root.mediaType,
          remoteId: `local:${createHash('sha256').update(candidate.absolutePath).digest('hex')}`,
          title: strategy.titleFor(candidate),
          localPath: candidate.absolutePath,
          format: extname(candidate.fileName).replace('.', '').toLowerCase() || null,
          fileSizeBytes,
        });

        if (pending.length >= INSERT_BATCH_SIZE) await flush();
      }

      await flush();
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error ? error.constructor.name : 'Unknown';
      this.logger.error(
        `[local_scan.root] [fail] rootId=${rootId} durationMs=${durationMs} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - local scan failed`,
      );
      throw error;
    }

    await this.repository.markScanFinished(rootId);
    this.logger.log(
      `[local_scan.root] [end] rootId=${rootId} durationMs=${Date.now() - startedAt} scanned=${summary.scanned} matched=${summary.matched} inserted=${summary.inserted} skipped=${summary.skipped} - local scan completed`,
    );

    return summary;
  }
}
