import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { BookSearchSettingsService } from './book-search.settings';
import { MeilisearchClient } from './meilisearch.client';
import type { BookSearchPage, BookSearchProvider, BookSearchQuery } from './book-search.types';

function buildFilter(query: BookSearchQuery): string[] {
  const filter: string[] = [];

  if (query.mediaTypes?.length) {
    filter.push(`mediaType IN [${query.mediaTypes.map((mediaType) => `"${mediaType}"`).join(', ')}]`);
  }
  if (query.libraryIds?.length) {
    filter.push(`libraryId IN [${query.libraryIds.join(', ')}]`);
  }

  return filter;
}

@Injectable()
export class MeilisearchProvider implements BookSearchProvider {
  readonly name = 'meilisearch' as const;

  constructor(private readonly settings: BookSearchSettingsService) {}

  private async buildClient(): Promise<MeilisearchClient | null> {
    const config = await this.settings.get();
    if (!config.enabled || !config.url || !config.hasApiKey) return null;

    const apiKey = await this.settings.getApiKey();
    if (!apiKey) return null;

    return new MeilisearchClient({ url: config.url, apiKey });
  }

  async isAvailable(): Promise<boolean> {
    const client = await this.buildClient();
    if (!client) return false;
    return client.health();
  }

  async search(query: BookSearchQuery): Promise<BookSearchPage> {
    const config = await this.settings.get();
    const client = await this.buildClient();
    if (!client) {
      throw new ServiceUnavailableException('Meilisearch is not configured');
    }

    const result = await client.search(config.activeIndex, {
      q: query.q,
      offset: query.page * query.size,
      limit: query.size,
      filter: buildFilter(query),
    });

    return { ids: result.ids, total: result.total, page: query.page, size: query.size };
  }
}
