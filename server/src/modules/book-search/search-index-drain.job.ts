import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookSearchSettingsService } from './book-search.settings';
import { DRAIN_BATCH_SIZE, SearchIndexerService } from './search-indexer.service';

/** A catalogue sync enqueues far more than one batch, so a tick keeps draining while batches
 *  come back full. The cap bounds a single tick rather than the backlog: what is left waits
 *  for the next one. */
const MAX_BATCHES_PER_TICK = 10;

@Injectable()
export class SearchIndexDrainJob {
  private readonly logger = new Logger(SearchIndexDrainJob.name);
  private draining = false;

  constructor(
    private readonly indexer: SearchIndexerService,
    private readonly settings: BookSearchSettingsService,
  ) {}

  @Cron('* * * * *')
  async runDrain(): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;
    const startedAt = Date.now();
    try {
      const config = await this.settings.get();
      if (!config.enabled) {
        return;
      }

      let applied = 0;
      let failed = 0;

      for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
        const result = await this.indexer.drain();
        applied += result.applied;
        failed += result.failed;
        if (result.failed > 0 || result.applied + result.failed < DRAIN_BATCH_SIZE) {
          break;
        }
      }

      if (applied > 0 || failed > 0) {
        this.logger.log(
          `[search_index.drain_job] [end] durationMs=${Date.now() - startedAt} applied=${applied} failed=${failed} - scheduled drain completed`,
        );
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[search_index.drain_job] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - scheduled drain failed, events stay in the outbox`,
      );
    } finally {
      this.draining = false;
    }
  }
}
