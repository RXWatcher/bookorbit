import { Injectable } from '@nestjs/common';
import type { ContentFilterRules, ContentFilterRulesWithNames, WarehouseMediaType } from '@bookorbit/types';

import { WarehouseRepository } from '../warehouse/warehouse.repository';
import { catalogDocumentId } from './book-search-document.mapper';
import type { BookSearchPage, BookSearchProvider, BookSearchQuery } from './book-search.types';

/** The catalog tables key content filters by tag/genre id, not name. */
function toContentFilterRules(rules: ContentFilterRulesWithNames | undefined): ContentFilterRules | undefined {
  if (!rules) return undefined;

  return {
    includeTagIds: rules.includeTags.map((tag) => tag.id),
    excludeTagIds: rules.excludeTags.map((tag) => tag.id),
    includeGenreIds: rules.includeGenres.map((genre) => genre.id),
    excludeGenreIds: rules.excludeGenres.map((genre) => genre.id),
  };
}

@Injectable()
export class SqlSearchProvider implements BookSearchProvider {
  readonly name = 'sql' as const;

  constructor(private readonly warehouseRepository: WarehouseRepository) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async search(query: BookSearchQuery): Promise<BookSearchPage> {
    const page = await this.warehouseRepository.queryUserCatalogItems(query.userId, {
      q: query.q,
      page: query.page,
      limit: query.size,
      mediaTypes: query.mediaTypes as WarehouseMediaType[] | undefined,
      contentFilters: toContentFilterRules(query.contentFilters),
    });

    return {
      ids: page.rows.map((row) => catalogDocumentId(row.mediaType, row.remoteId)),
      total: page.total ?? 0,
      page: page.page,
      size: page.limit,
    };
  }
}
