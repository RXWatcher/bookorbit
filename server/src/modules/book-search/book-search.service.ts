import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookSearchSettingsService } from './book-search.settings';
import { MeilisearchProvider } from './meilisearch.provider';
import { SqlSearchProvider } from './sql-search.provider';
import type { BookSearchPage, BookSearchQuery } from './book-search.types';

type ProviderName = 'meilisearch' | 'sql';

export interface BookSearchOptions {
  /** Set false by a caller that has its own fallback. The SQL provider only queries the
   *  catalogue, so BookService's merge path, which also covers native books, is strictly
   *  richer and would discard the SQL page anyway. Running it would be one wasted query over
   *  the whole catalogue on every search. */
  allowSqlFallback?: boolean;
}

@Injectable()
export class BookSearchService {
  private readonly logger = new Logger(BookSearchService.name);
  private last: ProviderName | null = null;

  constructor(
    private readonly meili: MeilisearchProvider,
    private readonly sql: SqlSearchProvider,
    private readonly settings: BookSearchSettingsService,
  ) {}

  lastProvider(): ProviderName | null {
    return this.last;
  }

  /** Returns null when Meilisearch did not serve the request and the caller opted out of the
   *  SQL fallback, which is the caller's signal to run its own. */
  async search(query: BookSearchQuery, options: BookSearchOptions = {}): Promise<(BookSearchPage & { provider: ProviderName }) | null> {
    const startedAt = Date.now();

    try {
      const config = await this.settings.get();

      if (config.enabled) {
        if (await this.meili.isAvailable()) {
          const page = await this.meili.search(query);
          this.last = 'meilisearch';
          return { ...page, provider: 'meilisearch' };
        }
        this.logger.warn(
          `[book_search.fallback] [end] userId=${query.userId} durationMs=${Date.now() - startedAt} reason=unavailable - search fell back to sql`,
        );
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[book_search.fallback] [fail] userId=${query.userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - search fell back to sql`,
      );
    }

    this.last = 'sql';

    if (options.allowSqlFallback === false) {
      return null;
    }

    const page = await this.sql.search(query);
    return { ...page, provider: 'sql' };
  }
}
