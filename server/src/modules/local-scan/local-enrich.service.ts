import { readdir, readFile } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LocalScanRepository, type LocalEnrichmentValues } from './local-scan.repository';
import { parseOpfSidecar } from './opf-sidecar.parser';

const BATCH_SIZE = 500;
const SIDECAR_NAME = 'metadata.opf';
const COVER_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png'];
/** Calibre appends the library id to the book directory, as in "Title (61069)". */
const TRAILING_CALIBRE_ID = / \(\d+\)$/;

export interface LocalEnrichSummary {
  examined: number;
  enriched: number;
  noSidecar: number;
  unparsable: number;
  coversFound: number;
}

/** One directory read answers the cover question, rather than probing each candidate name. */
async function hasCoverFile(bookDir: string): Promise<boolean> {
  try {
    const entries = await readdir(bookDir);
    return entries.some((entry) => COVER_NAMES.includes(entry.toLowerCase()));
  } catch {
    return false;
  }
}

@Injectable()
export class LocalEnrichService {
  private readonly logger = new Logger(LocalEnrichService.name);

  constructor(private readonly repository: LocalScanRepository) {}

  /** Author is recoverable from the Calibre layout (<Author>/<Title (id)>/file) without any
   *  lookup, so a book whose sidecar is missing or unreadable still gets one. */
  private fallbackFromPath(localPath: string): LocalEnrichmentValues {
    const bookDir = dirname(localPath);
    const authorDir = basename(dirname(bookDir));
    const title = basename(bookDir).replace(TRAILING_CALIBRE_ID, '');
    return { title, authors: authorDir ? [authorDir] : [] };
  }

  async enrichAll(): Promise<LocalEnrichSummary> {
    const startedAt = Date.now();
    const summary: LocalEnrichSummary = { examined: 0, enriched: 0, noSidecar: 0, unparsable: 0, coversFound: 0 };
    this.logger.log('[local_enrich.run] [start] - sidecar enrichment started');

    let pending: Array<{ id: number; values: LocalEnrichmentValues }> = [];

    try {
      for await (const batch of this.repository.streamLocalItemsNeedingEnrichment(BATCH_SIZE)) {
        for (const row of batch) {
          summary.examined += 1;
          if (!row.localPath) continue;

          const bookDir = dirname(row.localPath);
          const sidecarPath = join(bookDir, SIDECAR_NAME);

          let values: LocalEnrichmentValues;
          let xml: string | null = null;
          try {
            xml = await readFile(sidecarPath, 'utf8');
          } catch {
            summary.noSidecar += 1;
          }

          if (xml === null) {
            values = this.fallbackFromPath(row.localPath);
          } else {
            const parsed = parseOpfSidecar(xml);
            if (!parsed) {
              summary.unparsable += 1;
              values = this.fallbackFromPath(row.localPath);
            } else {
              const fallback = this.fallbackFromPath(row.localPath);
              values = {
                title: parsed.title ?? fallback.title,
                sortTitle: parsed.title ?? fallback.title ?? null,
                authors: parsed.authors.length > 0 ? parsed.authors : (fallback.authors ?? []),
                series: parsed.series,
                seriesIndex: parsed.seriesIndex,
                publisher: parsed.publisher,
                language: parsed.language,
                tags: parsed.tags,
                publishedYear: parsed.publishedYear,
                identifiers: parsed.identifiers,
              };
            }
          }

          if (await hasCoverFile(bookDir)) {
            values.hasCover = true;
            summary.coversFound += 1;
          }

          pending.push({ id: row.id, values });
          if (pending.length >= BATCH_SIZE) {
            summary.enriched += await this.repository.applyEnrichmentBatch(pending);
            pending = [];
          }
        }
      }

      summary.enriched += await this.repository.applyEnrichmentBatch(pending);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error ? error.constructor.name : 'Unknown';
      this.logger.error(
        `[local_enrich.run] [fail] durationMs=${Date.now() - startedAt} examined=${summary.examined} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - sidecar enrichment failed`,
      );
      throw error;
    }

    this.logger.log(
      `[local_enrich.run] [end] durationMs=${Date.now() - startedAt} examined=${summary.examined} enriched=${summary.enriched} noSidecar=${summary.noSidecar} unparsable=${summary.unparsable} coversFound=${summary.coversFound} - sidecar enrichment completed`,
    );

    return summary;
  }

  runInBackground(): void {
    void this.enrichAll().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[local_enrich.background] [fail] error="${sanitizeLogValue(message)}" - detached enrichment failed`);
    });
  }
}
