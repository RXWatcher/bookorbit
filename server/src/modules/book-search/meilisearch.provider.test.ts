import type { ContentFilterRulesWithNames } from '@bookorbit/types';

import { MeilisearchProvider, buildFilter } from './meilisearch.provider';
import type { BookSearchQuery } from './book-search.types';

const NO_CONTENT_FILTERS: ContentFilterRulesWithNames = {
  includeTags: [],
  excludeTags: [],
  includeGenres: [],
  excludeGenres: [],
};

const BASE_QUERY: BookSearchQuery = {
  q: 'dune',
  page: 0,
  size: 10,
  userId: 1,
  accessibleLibraryIds: [],
};

describe('buildFilter', () => {
  it('excludes documents carrying an excluded tag name', () => {
    const filter = buildFilter({
      ...BASE_QUERY,
      contentFilters: { ...NO_CONTENT_FILTERS, excludeTags: [{ id: 7, name: 'Adult' }] },
    });

    expect(filter).toContain('tags NOT IN ["Adult"]');
  });

  it('excludes documents carrying an excluded genre name', () => {
    const filter = buildFilter({
      ...BASE_QUERY,
      contentFilters: { ...NO_CONTENT_FILTERS, excludeGenres: [{ id: 9, name: 'Horror' }] },
    });

    expect(filter).toContain('genres NOT IN ["Horror"]');
  });

  it('keeps a document matching an include rule, ORing tags and genres like the SQL path', () => {
    const filter = buildFilter({
      ...BASE_QUERY,
      contentFilters: {
        ...NO_CONTENT_FILTERS,
        includeTags: [{ id: 1, name: 'Cozy' }],
        includeGenres: [{ id: 2, name: 'Romance' }],
      },
    });

    expect(filter).toContain('(tags IN ["Cozy"] OR genres IN ["Romance"])');
  });

  it('resolves content filter ids to names rather than filtering by id', () => {
    const filter = buildFilter({
      ...BASE_QUERY,
      contentFilters: { ...NO_CONTENT_FILTERS, includeTags: [{ id: 42, name: 'Cozy' }] },
    });

    expect(filter.join(' ')).not.toContain('42');
  });

  it('restricts native documents to accessible libraries', () => {
    const filter = buildFilter({ ...BASE_QUERY, accessibleLibraryIds: [5, 9] });

    expect(filter).toContain('(source = "catalog" OR libraryId IN [5, 9])');
  });

  it('never excludes catalogue documents, which carry a null libraryId, from the library access clause', () => {
    const filter = buildFilter({ ...BASE_QUERY, accessibleLibraryIds: [5] });
    const accessClause = filter.find((clause) => clause.includes('libraryId IN'));

    expect(accessClause).toContain('source = "catalog" OR');
  });

  it('gates catalogue documents by media type without dropping native documents', () => {
    const filter = buildFilter({ ...BASE_QUERY, accessibleLibraryIds: [5], mediaTypes: ['ebook', 'audiobook'] });

    expect(filter).toContain('(source = "native" OR mediaType IN ["ebook", "audiobook"])');
  });

  it('limits results to native documents when the user has no catalogue libraries', () => {
    const filter = buildFilter({ ...BASE_QUERY, accessibleLibraryIds: [5], mediaTypes: [] });

    expect(filter).toContain('source = "native"');
  });

  it('leaves the catalogue unrestricted when no media types are supplied', () => {
    const filter = buildFilter({ ...BASE_QUERY, accessibleLibraryIds: [5] });

    expect(filter.some((clause) => clause.includes('mediaType'))).toBe(false);
  });

  it('limits results to catalogue documents when the user has no accessible libraries', () => {
    const filter = buildFilter({ ...BASE_QUERY, accessibleLibraryIds: [] });

    expect(filter).toContain('source = "catalog"');
  });
});

describe('MeilisearchProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the built filter through to the Meilisearch search request', async () => {
    let capturedBody: { filter?: string[] } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        if (url.endsWith('/search')) capturedBody = JSON.parse(init.body as string) as { filter?: string[] };
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ hits: [{ id: 'catalog:ebook:1' }], estimatedTotalHits: 1 }),
        });
      }),
    );
    const settings = {
      get: vi.fn().mockResolvedValue({ enabled: true, url: 'http://m:7700', activeIndex: 'books', hasApiKey: true }),
      getApiKey: vi.fn().mockResolvedValue('key'),
    };
    const provider = new MeilisearchProvider(settings as never);
    const query: BookSearchQuery = {
      ...BASE_QUERY,
      accessibleLibraryIds: [5],
      contentFilters: { ...NO_CONTENT_FILTERS, excludeTags: [{ id: 1, name: 'Adult' }] },
    };

    await provider.search(query);

    expect(capturedBody?.filter).toEqual(buildFilter(query));
    expect(capturedBody?.filter).toContain('tags NOT IN ["Adult"]');
    expect(capturedBody?.filter).toContain('(source = "catalog" OR libraryId IN [5])');
  });
});
