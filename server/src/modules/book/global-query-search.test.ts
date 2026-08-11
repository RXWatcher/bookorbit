import type { RequestUser } from '../../common/types/request-user';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { BookService } from './book.service';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  };
}

function makeService() {
  const bookRepo = {};
  const libraryService = {
    findAll: vi.fn().mockResolvedValue([{ id: 3 }]),
  };
  const queryBuilder = {
    buildWhere: vi.fn().mockReturnValue('GLOBAL_WHERE'),
    buildOrderBy: vi.fn().mockReturnValue(['GLOBAL_ORDER']),
  };
  const metadataService = {};
  const scoreService = {};
  const pipeline = {};
  const config = {
    get: vi.fn().mockImplementation((key: string) => (key === 'storage.appDataPath' ? '/tmp/books' : undefined)),
  };
  const appSettings = {};
  const userBookStatusService = {};
  const userBookNoteService = {};
  const narratorService = {};
  const comicMetadataService = {};
  const customMetadataService = {};
  const bookMetadataLockService = {};
  const embedder = {};
  const fileWriteService = {};
  const fileRenameService = {};
  const achievementEvents = {};
  const warehouseRepo = {};
  const warehouseCatalog = {
    getCatalogItemsByRemoteIds: vi.fn().mockResolvedValue([]),
    queryLibraryBooks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 0, limit: 50 }),
  };
  const seriesMemberships = {};
  const seriesExpectedCount = {};
  const bookSearchService = {
    search: vi.fn(),
  };
  const contentFilterRepository = {
    findByUserIdWithNames: vi.fn().mockResolvedValue({ includeTags: [], excludeTags: [], includeGenres: [], excludeGenres: [] }),
  };

  const service = new BookService(
    bookRepo as never,
    libraryService as never,
    queryBuilder as never,
    metadataService as never,
    scoreService as never,
    pipeline as never,
    config as never,
    appSettings as never,
    userBookStatusService as never,
    userBookNoteService as never,
    narratorService as never,
    comicMetadataService as never,
    customMetadataService as never,
    bookMetadataLockService as never,
    embedder as never,
    fileWriteService as never,
    fileRenameService as never,
    achievementEvents as never,
    warehouseRepo as never,
    warehouseCatalog as never,
    seriesMemberships as never,
    seriesExpectedCount as never,
    bookSearchService as never,
    contentFilterRepository as never,
  );

  return { service, libraryService, queryBuilder, warehouseCatalog, bookSearchService, contentFilterRepository };
}

function makeBookCard(overrides: Record<string, unknown>) {
  return {
    id: 1,
    title: 'Untitled',
    authors: [],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: null,
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    publisher: null,
    pageCount: null,
    isbn13: null,
    hardcoverId: null,
    hardcoverEditionId: null,
    narrators: [],
    ...overrides,
  };
}

describe('globalQuery search routing', () => {
  it('returns provider order rather than re-sorting when Meilisearch served the search', async () => {
    const { service, bookSearchService, warehouseCatalog, queryBuilder } = makeService();
    const user = makeUser({ id: 7 });

    // Provider returns the relevant book first; the old merge would have sorted it by title
    // and buried it, which is the defect this task removes.
    const ids = ['catalog:audiobook:relevant', 'catalog:ebook:aaa-alphabetically-first'];
    bookSearchService.search.mockResolvedValue({ ids, total: 2, page: 0, size: 10, provider: 'meilisearch' });

    const relevantCard = makeBookCard({
      title: 'Relevant Book',
      catalogSource: { mediaType: 'audiobook', remoteId: 'relevant' },
    });
    const aaaCard = makeBookCard({
      title: 'AAA Book',
      catalogSource: { mediaType: 'ebook', remoteId: 'aaa-alphabetically-first' },
    });
    warehouseCatalog.getCatalogItemsByRemoteIds.mockImplementation((_user: unknown, mediaType: string) =>
      mediaType === 'audiobook' ? Promise.resolve([relevantCard]) : Promise.resolve([aaaCard]),
    );

    const result = await service.globalQuery(user, {
      filter: null,
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(result).toEqual({
      items: [relevantCard, aaaCard],
      total: 2,
      page: 0,
      size: 10,
    });
    expect(warehouseCatalog.getCatalogItemsByRemoteIds).toHaveBeenCalledWith(user, 'audiobook', ['relevant']);
    expect(warehouseCatalog.getCatalogItemsByRemoteIds).toHaveBeenCalledWith(user, 'ebook', ['aaa-alphabetically-first']);
    expect(queryBuilder.buildWhere).not.toHaveBeenCalled();
    expect(bookSearchService.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'dune', userId: 7, accessibleLibraryIds: [3] }));
  });

  it('keeps the existing merge when there is no search term', async () => {
    const { service, bookSearchService, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    const localBook = makeBookCard({ id: 5, title: 'Local Book' });
    vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({ items: [localBook], total: 1, page: 0, size: 10 } as never);

    const result = await service.globalQuery(user, { filter: null, sort: [], pagination: { page: 0, size: 10 } } as never);

    expect(bookSearchService.search).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [localBook], total: 1, page: 0, size: 10 });
  });

  it('keeps the existing merge when the provider fell back to sql', async () => {
    const { service, bookSearchService, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    // Provider reports provider: 'sql'; assert the merge path is used so SQL ordering rules apply.
    bookSearchService.search.mockResolvedValue({
      ids: ['native:99'],
      total: 1,
      page: 0,
      size: 10,
      provider: 'sql',
    });
    const localBook = makeBookCard({ id: 5, title: 'Local Dune' });
    vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({ items: [localBook], total: 1, page: 0, size: 10 } as never);

    const result = await service.globalQuery(user, {
      filter: null,
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(bookSearchService.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'dune', userId: 7, accessibleLibraryIds: [3] }));
    expect(result).toEqual({ items: [localBook], total: 1, page: 0, size: 10 });
  });
});
