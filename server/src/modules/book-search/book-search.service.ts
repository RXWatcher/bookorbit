import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookSearchSettingsService } from './book-search.settings';
import { MeilisearchProvider } from './meilisearch.provider';
import { SqlSearchProvider } from './sql-search.provider';
import type { BookSearchPage, BookSearchQuery } from './book-search.types';

type ProviderName = 'meilisearch' | 'sql';

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

  async search(query: BookSearchQuery): Promise<BookSearchPage & { provider: ProviderName }> {
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

    const page = await this.sql.search(query);
    this.last = 'sql';
    return { ...page, provider: 'sql' };
  }
}
