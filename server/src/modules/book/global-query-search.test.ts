import { drizzle } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import type { RequestUser } from '../../common/types/request-user';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import * as schema from '../../db/schema';
import { books } from '../../db/schema';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookSortBuilder } from './book-sort-builder.service';
import { BookService } from './book.service';

/** A real drizzle instance over a stub client compiles the predicates the production code
 *  would send, so the native read-time guards can be asserted on the emitted SQL rather than
 *  on a mock's arguments. */
function makeRealQueryBuilder() {
  const client = { query: () => Promise.resolve({ rows: [], fields: [] }) };
  const db = drizzle({ client: client as never, schema });
  return { db, queryBuilder: new BookQueryBuilder(db as never, new BookSortBuilder()) };
}

function compileWhere(db: ReturnType<typeof makeRealQueryBuilder>['db'], where: SQL): { sql: string; params: unknown[] } {
  return db.select({ id: books.id }).from(books).where(where).toSQL();
}

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

function makeService(overrides: { queryBuilder?: unknown } = {}) {
  const bookRepo = {};
  const libraryService = {
    findAll: vi.fn().mockResolvedValue([{ id: 3 }]),
  };
  const queryBuilder = (overrides.queryBuilder ?? {
    buildWhere: vi.fn().mockReturnValue('GLOBAL_WHERE'),
    buildOrderBy: vi.fn().mockReturnValue(['GLOBAL_ORDER']),
  }) as { buildWhere: ReturnType<typeof vi.fn>; buildOrderBy: ReturnType<typeof vi.fn> };
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
    const { service, bookSearchService, warehouseCatalog, queryBuilder, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);

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
    expect(bookSearchService.search).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'dune', userId: 7, accessibleLibraryIds: [3], mediaTypes: ['ebook', 'audiobook'] }),
      { allowSqlFallback: false },
    );
  });

  it('restores provider order within a single media type even when the row loader returns rows in a different order', async () => {
    const { service, bookSearchService, warehouseCatalog, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);

    // Two ids land in the SAME media type group (ebook), so a single getCatalogItemsByRemoteIds
    // call must resolve both. The provider wants "second" before "first", but the loader (like
    // a real `WHERE remote_id IN (...)` query) hands rows back in the opposite order. A naive
    // implementation that just concatenates whatever the loader returned, ignoring the
    // requested id order, would produce [firstCard, secondCard] here and this test would catch it.
    const ids = ['catalog:ebook:second', 'catalog:ebook:first'];
    bookSearchService.search.mockResolvedValue({ ids, total: 2, page: 0, size: 10, provider: 'meilisearch' });

    const firstCard = makeBookCard({ title: 'First Row From DB', catalogSource: { mediaType: 'ebook', remoteId: 'first' } });
    const secondCard = makeBookCard({ title: 'Second Row From DB', catalogSource: { mediaType: 'ebook', remoteId: 'second' } });
    warehouseCatalog.getCatalogItemsByRemoteIds.mockResolvedValue([firstCard, secondCard]);

    const result = await service.globalQuery(user, {
      filter: null,
      sort: [],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(result.items).toEqual([secondCard, firstCard]);
    expect(warehouseCatalog.getCatalogItemsByRemoteIds).toHaveBeenCalledWith(user, 'ebook', ['second', 'first']);
  });

  it('excludes a native search result whose library is not in the user accessible library ids', async () => {
    const { db, queryBuilder } = makeRealQueryBuilder();
    const { service, bookSearchService, libraryService } = makeService({ queryBuilder });
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    // The index returns a native id for a book in library 99, which the user cannot access.
    // A stale or lagging index is the first line of defence's failure mode; the read-time
    // library filter is what must still exclude it.
    bookSearchService.search.mockResolvedValue({
      ids: ['native:10', 'native:20'],
      total: 2,
      page: 0,
      size: 10,
      provider: 'meilisearch',
    });
    const accessibleBook = makeBookCard({ id: 10, title: 'Accessible Book' });
    const executeBooksQuerySpy = vi
      .spyOn(service, 'executeBooksQuery')
      .mockResolvedValue({ items: [accessibleBook], total: 1, page: 0, size: 2 } as never);

    const result = await service.globalQuery(user, {
      filter: null,
      sort: [],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(result.items).toEqual([accessibleBook]);
    // The where clause passed to executeBooksQuery must restrict to accessibleLibraryIds, not
    // just the requested book ids, so a book in an inaccessible library is excluded at read
    // time even if the search index still lists it.
    const compiled = compileWhere(db, executeBooksQuerySpy.mock.calls[0][1] as SQL);
    expect(compiled.sql).toContain('"books"."id" in');
    expect(compiled.sql).toContain('"books"."library_id" in');
    expect(compiled.params).toEqual(expect.arrayContaining([10, 20, 3]));
  });

  it('drops a native search result carrying a tag the user content filters exclude', async () => {
    const { db, queryBuilder } = makeRealQueryBuilder();
    const { service, bookSearchService, libraryService } = makeService({ queryBuilder });
    const user = makeUser({
      id: 7,
      contentFilters: { includeTagIds: [], excludeTagIds: [42], includeGenreIds: [], excludeGenreIds: [] },
    });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    // Native documents are indexed with empty tags and genres, and Meili's `tags NOT IN [...]`
    // matches an empty field, so the index happily returns the excluded book. Only the
    // read-time filter keeps it out of the response.
    bookSearchService.search.mockResolvedValue({
      ids: ['native:10', 'native:20'],
      total: 2,
      page: 0,
      size: 10,
      provider: 'meilisearch',
    });
    const allowedBook = makeBookCard({ id: 20, title: 'Allowed Book' });
    const executeBooksQuerySpy = vi
      .spyOn(service, 'executeBooksQuery')
      .mockResolvedValue({ items: [allowedBook], total: 1, page: 0, size: 2 } as never);

    const result = await service.globalQuery(user, {
      filter: null,
      sort: [],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(result.items).toEqual([allowedBook]);
    expect(result.items.some((item) => item.id === 10)).toBe(false);
    const compiled = compileWhere(db, executeBooksQuerySpy.mock.calls[0][1] as SQL);
    expect(compiled.sql).toContain('not exists');
    expect(compiled.sql).toContain('"book_tags"');
    expect(compiled.params).toEqual(expect.arrayContaining([42]));
  });

  it('does not apply content filters to a superuser native load', async () => {
    const { db, queryBuilder } = makeRealQueryBuilder();
    const { service, bookSearchService, libraryService } = makeService({ queryBuilder });
    const user = makeUser({
      id: 7,
      isSuperuser: true,
      contentFilters: { includeTagIds: [], excludeTagIds: [42], includeGenreIds: [], excludeGenreIds: [] },
    });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    bookSearchService.search.mockResolvedValue({ ids: ['native:10'], total: 1, page: 0, size: 10, provider: 'meilisearch' });
    const executeBooksQuerySpy = vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({ items: [], total: 0, page: 0, size: 1 } as never);

    await service.globalQuery(user, { filter: null, sort: [], pagination: { page: 0, size: 10 }, q: 'dune' } as never);

    const compiled = compileWhere(db, executeBooksQuerySpy.mock.calls[0][1] as SQL);
    expect(compiled.sql).not.toContain('not exists');
  });

  it('keeps the existing merge when a filter is present alongside a search term', async () => {
    const { service, bookSearchService, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    const localBook = makeBookCard({ id: 5, title: 'Local Dune' });
    vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({ items: [localBook], total: 1, page: 0, size: 10 } as never);
    const filter = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'genre', operator: 'includesAny', value: ['Sci-Fi'] }],
    };

    const result = await service.globalQuery(user, {
      filter,
      sort: [],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(bookSearchService.search).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [localBook], total: 1, page: 0, size: 10 });
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

  it('keeps the existing merge when the provider did not serve the search', async () => {
    const { service, bookSearchService, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    // Null means Meilisearch did not answer, so the merge path runs and SQL ordering applies.
    bookSearchService.search.mockResolvedValue(null);
    const localBook = makeBookCard({ id: 5, title: 'Local Dune' });
    vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({ items: [localBook], total: 1, page: 0, size: 10 } as never);

    const result = await service.globalQuery(user, {
      filter: null,
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(bookSearchService.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'dune', userId: 7, accessibleLibraryIds: [3] }), {
      allowSqlFallback: false,
    });
    expect(result).toEqual({ items: [localBook], total: 1, page: 0, size: 10 });
  });

  it('resolves the content filter names for a filtered user and passes them to the provider', async () => {
    const { service, bookSearchService, libraryService, contentFilterRepository } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    const resolved = {
      includeTags: [{ id: 1, name: 'Cozy' }],
      excludeTags: [{ id: 2, name: 'Adult' }],
      includeGenres: [],
      excludeGenres: [{ id: 3, name: 'Horror' }],
    };
    contentFilterRepository.findByUserIdWithNames.mockResolvedValue(resolved);
    bookSearchService.search.mockResolvedValue(null);
    vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({ items: [], total: 0, page: 0, size: 10 } as never);

    await service.globalQuery(user, { filter: null, sort: [], pagination: { page: 0, size: 10 }, q: 'dune' } as never);

    // The provider filters on tag and genre NAMES, so the ids on the request user are not
    // enough: they have to be resolved before the query is built.
    expect(contentFilterRepository.findByUserIdWithNames).toHaveBeenCalledWith(7);
    expect(bookSearchService.search).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: resolved }), { allowSqlFallback: false });
  });

  it('sends no content filters for a superuser and does not resolve any', async () => {
    const { service, bookSearchService, libraryService, contentFilterRepository } = makeService();
    const user = makeUser({ id: 7, isSuperuser: true });
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    bookSearchService.search.mockResolvedValue(null);
    vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({ items: [], total: 0, page: 0, size: 10 } as never);

    await service.globalQuery(user, { filter: null, sort: [], pagination: { page: 0, size: 10 }, q: 'dune' } as never);

    expect(contentFilterRepository.findByUserIdWithNames).not.toHaveBeenCalled();
    expect(bookSearchService.search).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }), { allowSqlFallback: false });
  });

  it('does not ask the provider for a catalogue media type the user has no library for', async () => {
    const { service, bookSearchService, warehouseCatalog, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
    // The index still holds audiobook documents, and the merge path would never surface them
    // for this user, so neither the query nor the row load may include them.
    bookSearchService.search.mockResolvedValue({
      ids: ['catalog:ebook:allowed', 'catalog:audiobook:not-allowed'],
      total: 2,
      page: 0,
      size: 10,
      provider: 'meilisearch',
    });
    const allowedCard = makeBookCard({ title: 'Allowed', catalogSource: { mediaType: 'ebook', remoteId: 'allowed' } });
    warehouseCatalog.getCatalogItemsByRemoteIds.mockResolvedValue([allowedCard]);

    const result = await service.globalQuery(user, {
      filter: null,
      sort: [],
      pagination: { page: 0, size: 10 },
      q: 'dune',
    } as never);

    expect(bookSearchService.search).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['ebook'] }), { allowSqlFallback: false });
    expect(warehouseCatalog.getCatalogItemsByRemoteIds).toHaveBeenCalledTimes(1);
    expect(warehouseCatalog.getCatalogItemsByRemoteIds).toHaveBeenCalledWith(user, 'ebook', ['allowed']);
    expect(result.items).toEqual([allowedCard]);
  });
});
