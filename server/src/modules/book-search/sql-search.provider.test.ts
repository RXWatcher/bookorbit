import { catalogDocumentId } from './book-search-document.mapper';
import { SqlSearchProvider } from './sql-search.provider';
import type { BookSearchQuery } from './book-search.types';

const BASE_QUERY: BookSearchQuery = {
  q: 'dune',
  page: 0,
  size: 10,
  userId: 1,
  accessibleLibraryIds: [],
};

function makeRepository() {
  return {
    queryUserCatalogItems: vi.fn().mockResolvedValue({
      rows: [{ mediaType: 'ebook', remoteId: '99' }],
      total: 1,
      page: 0,
      limit: 10,
    }),
  };
}

describe('SqlSearchProvider', () => {
  it('maps catalog rows to document ids', async () => {
    const repository = makeRepository();
    const provider = new SqlSearchProvider(repository as never);

    await expect(provider.search(BASE_QUERY)).resolves.toEqual({
      ids: [catalogDocumentId('ebook', '99')],
      total: 1,
      page: 0,
      size: 10,
    });
  });

  it('resolves content filter names back to ids before calling the repository', async () => {
    const repository = makeRepository();
    const provider = new SqlSearchProvider(repository as never);

    await provider.search({
      ...BASE_QUERY,
      contentFilters: {
        includeTags: [{ id: 1, name: 'Cozy' }],
        excludeTags: [{ id: 2, name: 'Adult' }],
        includeGenres: [{ id: 3, name: 'Romance' }],
        excludeGenres: [{ id: 4, name: 'Horror' }],
      },
    });

    expect(repository.queryUserCatalogItems).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        contentFilters: {
          includeTagIds: [1],
          excludeTagIds: [2],
          includeGenreIds: [3],
          excludeGenreIds: [4],
        },
      }),
    );
  });
});
