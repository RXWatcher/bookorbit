import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ContentFilterRulesWithNames } from '@bookorbit/types';

import { BookSearchSettingsService } from './book-search.settings';
import { MeilisearchClient } from './meilisearch.client';
import type { BookSearchPage, BookSearchProvider, BookSearchQuery } from './book-search.types';

function quoteValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function quoteValues(values: string[]): string {
  return values.map(quoteValue).join(', ');
}

/** Mirrors buildCatalogContentFilterClauses in warehouse.repository.ts: include is a disjunction
 *  across tags and genres, exclude is a conjunction of two independent negative clauses. */
function buildContentFilterClauses(contentFilters: ContentFilterRulesWithNames | undefined): string[] {
  if (!contentFilters) return [];

  const clauses: string[] = [];
  const includeTagNames = contentFilters.includeTags.map((tag) => tag.name);
  const includeGenreNames = contentFilters.includeGenres.map((genre) => genre.name);
  const includeParts: string[] = [];
  if (includeTagNames.length) includeParts.push(`tags IN [${quoteValues(includeTagNames)}]`);
  if (includeGenreNames.length) includeParts.push(`genres IN [${quoteValues(includeGenreNames)}]`);
  if (includeParts.length) clauses.push(`(${includeParts.join(' OR ')})`);

  const excludeTagNames = contentFilters.excludeTags.map((tag) => tag.name);
  const excludeGenreNames = contentFilters.excludeGenres.map((genre) => genre.name);
  if (excludeTagNames.length) clauses.push(`tags NOT IN [${quoteValues(excludeTagNames)}]`);
  if (excludeGenreNames.length) clauses.push(`genres NOT IN [${quoteValues(excludeGenreNames)}]`);

  return clauses;
}

/** Catalogue documents carry no library, so a bare libraryId filter would drop every one of
 *  them. Native documents must still be limited to the libraries the user can access. */
function buildLibraryAccessClause(accessibleLibraryIds: number[]): string {
  if (accessibleLibraryIds.length === 0) return 'source = "catalog"';
  return `(source = "catalog" OR libraryId IN [${accessibleLibraryIds.join(', ')}])`;
}

/** The merge path only reaches a catalogue media type when the user has that cloud library, so
 *  the same gate has to reach the index or it returns rows the merge path would not and
 *  inflates the total. Native documents are gated by library access instead. */
function buildCatalogMediaTypeClause(mediaTypes: string[] | undefined): string | null {
  if (!mediaTypes) return null;
  if (mediaTypes.length === 0) return 'source = "native"';
  return `(source = "native" OR mediaType IN [${quoteValues(mediaTypes)}])`;
}

export function buildFilter(query: BookSearchQuery): string[] {
  const filter: string[] = [];

  const mediaTypeClause = buildCatalogMediaTypeClause(query.mediaTypes);
  if (mediaTypeClause) {
    filter.push(mediaTypeClause);
  }
  if (query.libraryIds?.length) {
    filter.push(`libraryId IN [${query.libraryIds.join(', ')}]`);
  }

  filter.push(...buildContentFilterClauses(query.contentFilters));
  filter.push(buildLibraryAccessClause(query.accessibleLibraryIds));

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
