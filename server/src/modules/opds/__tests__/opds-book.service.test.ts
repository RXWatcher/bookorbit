import { ForbiddenException } from '@nestjs/common';
import { CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import * as schema from '../../../db/schema';
import { OpdsBookService, type OpdsBookEntry } from '../opds-book.service';

const dialect = new PgDialect();
const { bookSeries, bookSeriesMemberships } = schema;

type BookPageResult = { entries: unknown[]; total: number };

type TestableOpdsBookService = {
  buildCatalogSearchClause(q: string): unknown;
  buildReadStatusClause(userId: number, status: 'unread' | 'reading' | 'finished'): unknown;
  fetchBookEntries(bookIds: number[], options?: unknown): Promise<unknown[]>;
  buildSmartScopeWhere(userId: number, smartScopeId: number, accessibleIds: number[], contentFilters?: unknown, q?: string): Promise<unknown>;
  fetchManifestRows(bookIds: number[]): Promise<unknown[]>;
  paginatedBookQuery(where: unknown, sortOrder: string, page: number, size: number, userId?: number, options?: unknown): Promise<BookPageResult>;
};

function testable(service: OpdsBookService): TestableOpdsBookService {
  return service as unknown as TestableOpdsBookService;
}

function makeChain(result: unknown, fields?: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const key of Object.keys(fields ?? {})) {
    chain[key] = { key };
  }

  const methods = ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset', '$dynamic', 'as'] as const;
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);

  return chain;
}

function makeDb(selectQueue: unknown[] = [], executeQueue: unknown[] = []) {
  const queue = [...selectQueue];
  const executeResults = [...executeQueue];

  return {
    select: vi.fn((fields?: Record<string, unknown>) => makeChain(queue.shift() ?? [], fields)),
    execute: vi.fn().mockImplementation(() => Promise.resolve(executeResults.shift() ?? [])),
  };
}

function makeService(selectQueue: unknown[] = [], queryBuilderOverrides: Record<string, unknown> = {}) {
  const db = makeDb(selectQueue);
  const queryBuilder = {
    buildWhere: vi.fn().mockReturnValue(undefined),
    ...queryBuilderOverrides,
  };
  const service = new OpdsBookService(db as never, queryBuilder as never);
  return { service, db, queryBuilder };
}

function makeCatalogRow(remoteId: string, title: string, addedAt = '2025-01-02T00:00:00.000Z') {
  return {
    remoteId,
    title,
    sortTitle: title,
    authors: ['Ada Writer'],
    series: null,
    language: 'en',
    publisher: 'Orbit',
    identifiers: { isbn13: '9780000000000' },
    format: 'epub',
    hasCover: true,
    syncedAt: new Date(addedAt),
    userAddedAt: new Date(addedAt),
    updatedAt: new Date(addedAt),
  };
}

function collectValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || typeof value !== 'object') return [value];
  if (seen.has(value)) return [];
  seen.add(value);

  const values: unknown[] = [];
  if ('value' in value) values.push((value as { value: unknown }).value);
  for (const key of Object.getOwnPropertyNames(value)) {
    values.push(...collectValues((value as Record<string, unknown>)[key], seen));
  }
  return values;
}

function renderSql(condition: SQL | undefined) {
  if (!condition) return null;
  return dialect.sqlToQuery(condition);
}

function opdsEntry(id: number | string, title: string, updatedAt: string, overrides?: Partial<OpdsBookEntry>): OpdsBookEntry {
  return {
    id,
    title,
    sortTitle: title,
    folderPath: '',
    addedAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    description: null,
    seriesName: null,
    seriesIndex: null,
    language: null,
    publisher: null,
    isbn13: null,
    hasCover: false,
    authors: [],
    files: [],
    ...overrides,
  };
}

type CombinedOpdsBookService = OpdsBookService & {
  getBooksAndCatalogEbooksPage(
    userId: number,
    sortOrder: 'recent' | 'title_asc' | 'title_desc' | 'author_asc' | 'author_desc' | 'series_asc' | 'series_desc',
    page: number,
    size: number,
    filters?: { collectionId?: number; author?: string; series?: string; q?: string },
    isSuperuser?: boolean,
    contentFilters?: { includeTagIds: number[]; excludeTagIds: number[]; includeGenreIds: number[]; excludeGenreIds: number[] },
  ): Promise<{ entries: OpdsBookEntry[]; total: number }>;
  getRecentBooksAndCatalogEbooksPage(
    userId: number,
    page: number,
    size: number,
    isSuperuser?: boolean,
    contentFilters?: { includeTagIds: number[]; excludeTagIds: number[]; includeGenreIds: number[]; excludeGenreIds: number[] },
  ): Promise<{ entries: OpdsBookEntry[]; total: number }>;
  getLibraryBooksPage(
    userId: number,
    sortOrder: 'recent' | 'title_asc' | 'title_desc' | 'author_asc' | 'author_desc' | 'series_asc' | 'series_desc',
    libraryId: number,
    page: number,
    size: number,
    filters?: { author?: string; series?: string; q?: string },
    isSuperuser?: boolean,
    contentFilters?: { includeTagIds: number[]; excludeTagIds: number[]; includeGenreIds: number[]; excludeGenreIds: number[] },
  ): Promise<{ entries: OpdsBookEntry[]; total: number }>;
};

describe('OpdsBookService', () => {
  it('returns accessible library ids for superusers and regular users', async () => {
    const superDb = makeDb([[{ id: 1 }, { id: 4 }]]);
    const superService = new OpdsBookService(superDb as never, {} as never);
    await expect(superService.getAccessibleLibraryIds(7, true)).resolves.toEqual([1, 4]);

    const userDb = makeDb([[{ libraryId: 2 }, { libraryId: 3 }]]);
    const userService = new OpdsBookService(userDb as never, {} as never);
    await expect(userService.getAccessibleLibraryIds(7, false)).resolves.toEqual([2, 3]);
  });

  it('includes Ebook Library in OPDS library navigation when source-backed ebooks are enabled', async () => {
    const db = makeDb([[{ id: 2, name: 'Local', bookCount: 4 }]]);
    const warehouseCatalog = {
      isCatalogEnabled: vi.fn().mockResolvedValue(true),
      getUserLibraryOverview: vi.fn().mockResolvedValue({ totalBooks: 3 }),
    };
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);

    await expect(service.getAccessibleLibraries(7, false)).resolves.toEqual([
      { id: CLOUD_EBOOK_LIBRARY_ID, name: 'Books', bookCount: 3 },
      { id: 2, name: 'Local', bookCount: 4 },
    ]);
    expect(warehouseCatalog.getUserLibraryOverview).toHaveBeenCalledWith(7, undefined, ['ebook']);
  });

  it('handles getBooksPage access checks and smartScope delegation', async () => {
    const { service } = makeService([[{ userId: 999 }], [{ userId: 7 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const privateService = testable(service);
    // This fork routes smart-scope browsing through getBooksBySmartScope,
    // which returns entries itself; upstream's buildSmartScopeWhere path is
    // used by the catalog/manifest endpoints instead.
    const smartScopeSpy = vi.spyOn(privateService, 'getBooksBySmartScope');
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getBooksPage(7, 'recent', 1, 50)).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { libraryId: 2 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { collectionId: 11 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ entries: [{ id: 5 }], total: 1 });
    await expect(service.getBooksPage(7, 'recent', 3, 25, { smartScopeId: 4 })).resolves.toEqual({ entries: [{ id: 5 }], total: 1 });
    expect(smartScopeSpy).toHaveBeenCalledWith(7, 4, [1, 2], 'recent', 3, 25, undefined, undefined);

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ entries: [{ id: 6 }], total: 1 });
    await expect(service.getBooksPage(7, 'recent', 1, 20, { smartScopeId: 4, q: 'dune' })).resolves.toEqual({ entries: [{ id: 6 }], total: 1 });
    expect(smartScopeSpy).toHaveBeenCalledWith(7, 4, [1, 2], 'recent', 1, 20, undefined, 'dune');

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ entries: [], total: 0 });
    await expect(service.getBooksPage(7, 'recent', 1, 20, { smartScopeId: 4 })).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([1, 2]);
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 9 }], total: 1 });
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');
    await expect(
      service.getBooksPage(7, 'title_asc', 2, 20, {
        libraryId: 1,
        collectionId: 10,
        author: 'Frank Herbert',
        series: 'Dune',
        q: 'arrakis',
      }),
    ).resolves.toEqual({ entries: [{ id: 9 }], total: 1 });
    // Smart-scope requests are served by getBooksBySmartScope (mocked above),
    // so only this non-scoped query reaches paginatedBookQuery.
    expect(paginatedSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('arrakis');
  });

  it('pages the bulk manifest by book id and reports whether more rows follow', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    const privateService = testable(service);
    const fetchSpy = vi.spyOn(privateService, 'fetchManifestRows').mockResolvedValue([{ id: 3 }, { id: 7 }]);

    const chain = makeChain([{ id: 3 }, { id: 7 }, { id: 9 }]);
    const selectSpy = vi.spyOn(service as unknown as { db: { select: unknown } }, 'db', 'get');
    selectSpy.mockReturnValue({ select: vi.fn().mockReturnValue(chain) });

    await expect(service.getBookManifestPage(7, { afterId: 2, limit: 2 })).resolves.toEqual({
      rows: [{ id: 3 }, { id: 7 }],
      hasNext: true,
    });
    // One extra row is fetched purely to answer hasNext without a count query.
    expect(chain.limit).toHaveBeenCalledWith(3);
    expect(fetchSpy).toHaveBeenCalledWith([3, 7]);
  });

  it('returns an empty manifest page when the user can reach no library', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);

    await expect(service.getBookManifestPage(7, { limit: 50 })).resolves.toEqual({ rows: [], hasNext: false });
  });

  it('builds catalog search across title, author, series, and normalized ISBN', () => {
    const { service, db } = makeService();

    const clause = testable(service).buildCatalogSearchClause('978-0 141187761');
    const values = collectValues(clause);

    expect(db.select).toHaveBeenCalledWith({ one: expect.anything() });
    expect(values).toContain('%978-0 141187761%');
    expect(values).toContain('9780141187761');
  });

  it('escapes catalog search LIKE patterns', () => {
    const { service } = makeService();

    const clause = testable(service).buildCatalogSearchClause('100%_\\');
    const values = collectValues(clause);

    expect(values).toContain('%100\\%\\_\\\\%');
  });

  it('handles getRecentBooksPage empty-access and delegated paths', async () => {
    const { service } = makeService();
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const paginatedSpy = vi.spyOn(testable(service), 'paginatedBookQuery');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getRecentBooksPage(5, 1, 30)).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([2, 3]);
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 1 }], total: 1 });
    await expect(service.getRecentBooksPage(5, 2, 15)).resolves.toEqual({ entries: [{ id: 1 }], total: 1 });
  });

  it('handles getRandomBooks guard branches and randomized id selection', async () => {
    const { service, db } = makeService([[], [{ id: 11 }, { id: 10 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const fetchSpy = vi.spyOn(testable(service), 'fetchBookEntries');

    await expect(service.getRandomBooks(7, 0)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    fetchSpy.mockResolvedValueOnce([{ id: 11 }, { id: 10 }]);
    const randomBooks = await service.getRandomBooks(7, 2);
    expect(randomBooks).toHaveLength(2);
    expect(randomBooks).toEqual(expect.arrayContaining([{ id: 10 }, { id: 11 }]));
    expect(fetchSpy).toHaveBeenCalledWith([11, 10]);

    const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value as Record<string, unknown>);
    const orderBy = chains.at(-1)!['orderBy'] as ReturnType<typeof vi.fn>;
    const values = orderBy.mock.calls.flat().flatMap((arg: unknown) => collectValues(arg));
    expect(values).toContain('random()');
  });

  it('returns catalog ebook random picks for OPDS users without filesystem library access', async () => {
    const now = new Date('2026-06-05T12:00:00.000Z');
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const db = makeDb([
      [
        {
          remoteId: 'cloud-random-1',
          title: 'Cloud Random',
          sortTitle: 'Cloud Random',
          authors: ['Ada Writer'],
          series: 'Wayfarers',
          language: 'en',
          publisher: 'Small Press',
          identifiers: { isbn13: '9780000000001' },
          format: 'epub',
          hasCover: true,
          syncedAt: now,
          addedAt: now,
          userUpdatedAt: now,
        },
      ],
    ]);
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);

    await expect(service.getRandomBooks(42, 25)).resolves.toEqual([
      expect.objectContaining({
        id: 'cloud-random-1',
        kind: 'catalog-ebook',
        title: 'Cloud Random',
      }),
    ]);

    const [randomCatalogChain] = (db.select as ReturnType<typeof vi.fn>).mock.results.map(
      (result: { value: Record<string, unknown> }) => result.value,
    );
    expect(randomCatalogChain?.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
    expect(randomCatalogChain?.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
    expect(randomCatalogChain?.leftJoin).toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
  });

  it('applies content filters to OPDS surprise catalog ebooks', async () => {
    const db = makeDb([
      [
        {
          remoteId: 'cloud-visible',
          title: 'Cloud Visible',
          sortTitle: 'Cloud Visible',
          authors: ['Ada Writer'],
          series: null,
          language: null,
          publisher: null,
          identifiers: {},
          format: 'epub',
          hasCover: true,
          syncedAt: new Date('2026-06-01T00:00:00.000Z'),
          addedAt: new Date('2026-06-01T00:00:00.000Z'),
          userUpdatedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    ]);
    const service = new OpdsBookService(db as never, {} as never, { isCatalogEnabled: vi.fn().mockResolvedValue(true) } as never);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);
    const contentFilters = { includeTagIds: [7], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };

    await expect(service.getRandomBooks(42, 25, false, contentFilters)).resolves.toEqual([
      expect.objectContaining({ id: 'cloud-visible', kind: 'catalog-ebook' }),
    ]);
    const [randomCatalogChain] = (db.select as ReturnType<typeof vi.fn>).mock.results.map(
      (result: { value: Record<string, unknown> }) => result.value,
    );
    expect(renderSql(randomCatalogChain?.where.mock.calls.at(-1)?.[0] as SQL)?.sql).toContain('"warehouse_catalog_items"."tags" ? "tags"."name"');
  });

  it('returns distinct authors and series with and without access', async () => {
    const { service, db } = makeService([[{ name: 'Frank Herbert', bookCount: 2 }], [{ name: 'Dune', bookCount: 2 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getDistinctAuthors(1)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getDistinctAuthors(1)).resolves.toEqual([{ name: 'Frank Herbert', bookCount: 2 }]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getDistinctSeries(1)).resolves.toEqual([{ name: 'Dune', bookCount: 2 }]);

    expect(db.select).toHaveBeenCalled();
  });

  it('merges owned catalog ebook authors and series into OPDS navigation summaries', async () => {
    const db = makeDb(
      [[{ name: 'Frank Herbert', bookCount: 2 }], [{ name: 'Dune', bookCount: 2 }]],
      [
        [
          { name: 'Ada Writer', bookCount: 1 },
          { name: 'Frank Herbert', bookCount: 1 },
        ],
        [
          { name: 'Dune', bookCount: 1 },
          { name: 'Wayfarers', bookCount: 1 },
        ],
      ],
    );
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1]);

    await expect(service.getDistinctAuthors(42)).resolves.toEqual([
      { name: 'Ada Writer', bookCount: 1 },
      { name: 'Frank Herbert', bookCount: 3 },
    ]);
    await expect(service.getDistinctSeries(42)).resolves.toEqual([
      { name: 'Dune', bookCount: 3 },
      { name: 'Wayfarers', bookCount: 1 },
    ]);
  });

  it('returns catalog ebook authors and series for OPDS users without filesystem library access', async () => {
    const db = makeDb([], [[{ name: 'Cloud Author', bookCount: 1 }], [{ name: 'Cloud Series', bookCount: 1 }]]);
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);

    await expect(service.getDistinctAuthors(42)).resolves.toEqual([{ name: 'Cloud Author', bookCount: 1 }]);
    await expect(service.getDistinctSeries(42)).resolves.toEqual([{ name: 'Cloud Series', bookCount: 1 }]);
  });

  it('queries cached Ebook Library inventory for OPDS author and series navigation', async () => {
    const db = makeDb([], [[{ name: 'Cached Author', bookCount: 1 }], [{ name: 'Cached Series', bookCount: 1 }]]);
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);

    await expect(service.getDistinctAuthors(42)).resolves.toEqual([{ name: 'Cached Author', bookCount: 1 }]);
    await expect(service.getDistinctSeries(42)).resolves.toEqual([{ name: 'Cached Series', bookCount: 1 }]);

    const [authorSql, seriesSql] = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map((call) => renderSql(call[0] as SQL)?.sql ?? '');
    expect(authorSql).toContain('from "warehouse_catalog_items"');
    expect(authorSql).not.toContain('from "warehouse_user_items"');
    expect(seriesSql).toContain('from "warehouse_catalog_items"');
    expect(seriesSql).not.toContain('from "warehouse_user_items"');
  });

  it('applies content filters to OPDS author and series catalog navigation', async () => {
    const db = makeDb(
      [[], [{ name: 'Visible Local Author', bookCount: 1 }], [], [{ name: 'Visible Local Series', bookCount: 1 }]],
      [[{ name: 'Visible Catalog Author', bookCount: 1 }], [{ name: 'Visible Catalog Series', bookCount: 1 }]],
    );
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    const contentFilters = { includeTagIds: [7], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1]);

    await expect(service.getDistinctAuthors(42, false, contentFilters)).resolves.toEqual([
      { name: 'Visible Catalog Author', bookCount: 1 },
      { name: 'Visible Local Author', bookCount: 1 },
    ]);
    await expect(service.getDistinctSeries(42, false, contentFilters)).resolves.toEqual([
      { name: 'Visible Catalog Series', bookCount: 1 },
      { name: 'Visible Local Series', bookCount: 1 },
    ]);
    const [authorSql, seriesSql] = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map((call) => renderSql(call[0] as SQL)?.sql ?? '');
    expect(authorSql).toContain('"warehouse_catalog_items"."tags" ? "tags"."name"');
    expect(seriesSql).toContain('"warehouse_catalog_items"."tags" ? "tags"."name"');
  });

  it('returns user collections and visible smartScopes', async () => {
    const { service, db } = makeService([
      [{ id: 4, name: 'Favorites', bookCount: 1 }],
      [
        { id: 7, name: 'Unread', icon: 'sparkles' },
        { id: 8, name: 'Shared Scope', icon: 'globe' },
      ],
    ]);

    await expect(service.getUserCollections(8)).resolves.toEqual([{ id: 4, name: 'Favorites', bookCount: 1 }]);
    await expect(service.getUserSmartScopes(8)).resolves.toEqual([
      { id: 7, name: 'Unread', icon: 'sparkles' },
      { id: 8, name: 'Shared Scope', icon: 'globe' },
    ]);
    const [, smartScopeChain] = (db.select as ReturnType<typeof vi.fn>).mock.results.map(
      (result: { value: Record<string, unknown> }) => result.value,
    );
    const renderedWhere = renderSql(smartScopeChain?.where.mock.calls.at(-1)?.[0] as SQL);
    expect(renderedWhere?.sql).toContain('"smart_scopes"."user_id"');
    expect(renderedWhere?.sql).toContain('"smart_scopes"."is_public"');
  });

  it('counts owned catalog ebook collection members in OPDS collection navigation', async () => {
    const { service, db } = makeService([[{ id: 4, name: 'Favorites', bookCount: 2 }]]);

    await expect(service.getUserCollections(8)).resolves.toEqual([{ id: 4, name: 'Favorites', bookCount: 2 }]);

    const [fields] = (db.select as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const values = collectValues(fields);
    expect(values).toContain(8);
    expect(values).toContain('ebook');
  });

  it('returns user-owned catalog ebook OPDS entries with native OPDS media links', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const { service } = makeService([
      [
        {
          remoteId: 'book 1/with slash',
          title: 'The Long Way Home',
          authors: ['Ada Writer'],
          series: 'Wayfarers',
          language: 'en',
          publisher: 'Small Press',
          identifiers: { isbn13: '9780000000001' },
          format: 'epub',
          hasCover: true,
          syncedAt: now,
          addedAt: now,
          userUpdatedAt: now,
        },
      ],
      [{ total: 1 }],
    ]);

    await expect(service.getCatalogEbookPage(42, 1, 24, { q: 'long way' })).resolves.toEqual({
      entries: [
        expect.objectContaining({
          id: 'book 1/with slash',
          kind: 'catalog-ebook',
          title: 'The Long Way Home',
          authors: ['Ada Writer'],
          seriesName: 'Wayfarers',
          isbn13: '9780000000001',
          hasCover: true,
          files: [
            {
              id: 'book 1/with slash',
              format: 'epub',
              href: '/api/v1/opds/catalog-ebooks/book%201%2Fwith%20slash/download',
            },
          ],
          coverHref: '/api/v1/opds/catalog-ebooks/book%201%2Fwith%20slash/cover',
          thumbnailHref: '/api/v1/opds/catalog-ebooks/book%201%2Fwith%20slash/thumbnail',
        }),
      ],
      total: 1,
    });
  });

  it('queries cached Ebook Library inventory instead of requiring source-backed membership rows', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const { service, db } = makeService([
      [
        {
          remoteId: 'cached-only',
          title: 'Cached Only',
          authors: ['Ada Writer'],
          series: null,
          language: 'en',
          publisher: 'Small Press',
          identifiers: { isbn13: '9780000000002' },
          format: 'epub',
          hasCover: true,
          syncedAt: now,
          addedAt: now,
          userUpdatedAt: now,
        },
      ],
      [{ total: 1 }],
    ]);

    await expect(service.getCatalogEbookPage(42, 1, 24)).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: 'cached-only', kind: 'catalog-ebook', title: 'Cached Only' })],
      total: 1,
    });

    const [listChain, countChain] = (db.select as ReturnType<typeof vi.fn>).mock.results.map(
      (result: { value: Record<string, unknown> }) => result.value,
    );
    expect(listChain?.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
    expect(countChain?.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
  });

  it('filters catalog ebook OPDS entries by collection membership', async () => {
    const { service, db } = makeService([[], [{ total: 0 }]]);

    await service.getCatalogEbookPage(42, 1, 10, { collectionId: 9, q: 'favorite' });

    const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r: { value: Record<string, unknown> }) => r.value);
    const whereValues = chains.flatMap((chain: Record<string, unknown>) => {
      const fn = chain['where'] as ReturnType<typeof vi.fn>;
      return fn.mock.calls.flatMap((call) => call.flatMap((arg: unknown) => collectValues(arg)));
    });

    expect(whereValues).toContain(9);
  });

  it('filters catalog ebook OPDS entries by content filters', async () => {
    const { service, db } = makeService([[], [{ total: 0 }]]);
    const contentFilters = { includeTagIds: [7], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [9] };

    await service.getCatalogEbookPage(42, 1, 10, undefined, 'title_asc', contentFilters);

    const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r: { value: Record<string, unknown> }) => r.value);
    const renderedWhereSql = chains.map((chain: Record<string, unknown>) => {
      const fn = chain['where'] as ReturnType<typeof vi.fn>;
      return renderSql(fn.mock.calls[0]?.[0])?.sql ?? '';
    });

    expect(renderedWhereSql.every((value) => value.includes('"warehouse_catalog_items"."media_type"'))).toBe(true);
    expect(renderedWhereSql.every((value) => value.includes('"warehouse_catalog_items"."tags"'))).toBe(true);
    expect(renderedWhereSql.every((value) => value.includes('"warehouse_catalog_items"."genres"'))).toBe(true);
  });

  it('merges local and catalog ebook catalog pages before slicing', async () => {
    const { service } = makeService();
    const localSpy = vi.spyOn(service, 'getBooksPage').mockResolvedValue({
      entries: [opdsEntry(1, 'Bravo', '2026-06-01T00:00:00.000Z')],
      total: 1,
    });
    const catalogSpy = vi.spyOn(service, 'getCatalogEbookPage').mockResolvedValue({
      entries: [opdsEntry('remote-alpha', 'Alpha', '2026-06-02T00:00:00.000Z', { kind: 'catalog-ebook' })],
      total: 1,
    });
    const emptyContentFilters = { includeTagIds: [], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };

    await expect(
      (service as CombinedOpdsBookService).getBooksAndCatalogEbooksPage(
        42,
        'title_asc',
        1,
        2,
        { author: 'Ada Writer', series: 'Wayfarers', q: 'long way' },
        false,
        emptyContentFilters,
      ),
    ).resolves.toEqual({
      entries: [expect.objectContaining({ id: 'remote-alpha', title: 'Alpha' }), expect.objectContaining({ id: 1, title: 'Bravo' })],
      total: 2,
    });
    expect(localSpy).toHaveBeenCalledWith(
      42,
      'title_asc',
      1,
      2,
      { author: 'Ada Writer', series: 'Wayfarers', q: 'long way' },
      false,
      emptyContentFilters,
    );
    expect(catalogSpy).toHaveBeenCalledWith(42, 1, 2, { author: 'Ada Writer', series: 'Wayfarers', q: 'long way' }, 'title_asc', emptyContentFilters);
  });

  it('merges collection-scoped local and catalog ebook pages before slicing', async () => {
    const { service } = makeService();
    const localSpy = vi.spyOn(service, 'getBooksPage').mockResolvedValue({
      entries: [opdsEntry(1, 'Local Favorite', '2026-06-01T00:00:00.000Z')],
      total: 1,
    });
    const catalogSpy = vi.spyOn(service, 'getCatalogEbookPage').mockResolvedValue({
      entries: [opdsEntry('remote-favorite', 'Library Favorite', '2026-06-02T00:00:00.000Z', { kind: 'catalog-ebook' })],
      total: 1,
    });

    await expect(
      (service as CombinedOpdsBookService).getBooksAndCatalogEbooksPage(42, 'title_asc', 1, 10, { collectionId: 9, q: 'favorite' }),
    ).resolves.toEqual({
      entries: [expect.objectContaining({ id: 'remote-favorite' }), expect.objectContaining({ id: 1 })],
      total: 2,
    });
    expect(localSpy).toHaveBeenCalledWith(42, 'title_asc', 1, 10, { collectionId: 9, q: 'favorite' }, false, undefined);
    expect(catalogSpy).toHaveBeenCalledWith(42, 1, 10, { collectionId: 9, q: 'favorite' }, 'title_asc', undefined);
  });

  it('applies content filters to merged catalog feeds', async () => {
    const { service } = makeService();
    const localSpy = vi.spyOn(service, 'getBooksPage').mockResolvedValue({
      entries: [opdsEntry(1, 'Visible Local', '2026-06-01T00:00:00.000Z')],
      total: 1,
    });
    const catalogSpy = vi.spyOn(service, 'getCatalogEbookPage').mockResolvedValue({
      entries: [opdsEntry('remote-visible', 'Visible Remote', '2026-06-02T00:00:00.000Z', { kind: 'catalog-ebook' })],
      total: 1,
    });
    const contentFilters = { includeTagIds: [7], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };

    await expect(
      (service as CombinedOpdsBookService).getBooksAndCatalogEbooksPage(42, 'title_asc', 1, 20, { q: 'visible' }, false, contentFilters),
    ).resolves.toEqual({
      entries: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 'remote-visible' })],
      total: 2,
    });
    expect(localSpy).toHaveBeenCalledWith(42, 'title_asc', 1, 20, { q: 'visible' }, false, contentFilters);
    expect(catalogSpy).toHaveBeenCalledWith(42, 1, 20, { q: 'visible' }, 'title_asc', contentFilters);
  });

  it('treats Ebook Library as a normal OPDS library filter', async () => {
    const warehouseCatalog = {
      isCatalogEnabled: vi.fn().mockResolvedValue(true),
    };
    const db = makeDb();
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    const catalogSpy = vi.spyOn(service, 'getCatalogEbookPage').mockResolvedValue({
      entries: [opdsEntry('remote-alpha', 'Alpha', '2026-06-02T00:00:00.000Z', { kind: 'catalog-ebook' })],
      total: 1,
    });
    const localSpy = vi.spyOn(service, 'getBooksPage');

    await expect(
      (service as CombinedOpdsBookService).getLibraryBooksPage(
        42,
        'title_asc',
        CLOUD_EBOOK_LIBRARY_ID,
        1,
        25,
        { author: 'Ada Writer', series: 'Wayfarers', q: 'long way' },
        false,
        undefined,
      ),
    ).resolves.toEqual({
      entries: [expect.objectContaining({ id: 'remote-alpha', kind: 'catalog-ebook' })],
      total: 1,
    });
    expect(catalogSpy).toHaveBeenCalledWith(42, 1, 25, { author: 'Ada Writer', series: 'Wayfarers', q: 'long way' }, 'title_asc', undefined);
    expect(localSpy).not.toHaveBeenCalled();
  });

  it('returns an empty Ebook Library OPDS feed when catalog access is disabled', async () => {
    const warehouseCatalog = {
      isCatalogEnabled: vi.fn().mockResolvedValue(false),
    };
    const db = makeDb();
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    const catalogSpy = vi.spyOn(service, 'getCatalogEbookPage');

    await expect(
      (service as CombinedOpdsBookService).getLibraryBooksPage(42, 'title_asc', CLOUD_EBOOK_LIBRARY_ID, 1, 25, undefined, false, undefined),
    ).resolves.toEqual({ entries: [], total: 0 });
    expect(catalogSpy).not.toHaveBeenCalled();
  });

  it('applies content filters when Ebook Library is browsed through OPDS', async () => {
    const warehouseCatalog = {
      isCatalogEnabled: vi.fn().mockResolvedValue(true),
    };
    const db = makeDb();
    const service = new OpdsBookService(db as never, {} as never, warehouseCatalog as never);
    const catalogSpy = vi.spyOn(service, 'getCatalogEbookPage').mockResolvedValue({
      entries: [opdsEntry('remote-visible', 'Visible Remote', '2026-06-02T00:00:00.000Z', { kind: 'catalog-ebook' })],
      total: 1,
    });
    const contentFilters = { includeTagIds: [7], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };

    await expect(
      (service as CombinedOpdsBookService).getLibraryBooksPage(
        42,
        'title_asc',
        CLOUD_EBOOK_LIBRARY_ID,
        1,
        25,
        { q: 'visible' },
        false,
        contentFilters,
      ),
    ).resolves.toEqual({
      entries: [expect.objectContaining({ id: 'remote-visible', kind: 'catalog-ebook' })],
      total: 1,
    });
    expect(catalogSpy).toHaveBeenCalledWith(42, 1, 25, { q: 'visible' }, 'title_asc', contentFilters);
  });

  it('sorts recent local and catalog ebook entries by added time', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getRecentBooksPage').mockResolvedValue({
      entries: [
        opdsEntry(1, 'Local Older', '2026-06-01T00:00:00.000Z', { updatedAt: new Date('2026-06-10T00:00:00.000Z') }),
        opdsEntry(2, 'Local Newer', '2026-06-03T00:00:00.000Z', { updatedAt: new Date('2026-06-04T00:00:00.000Z') }),
      ],
      total: 2,
    });
    vi.spyOn(service, 'getCatalogEbookPage').mockResolvedValue({
      entries: [
        opdsEntry('remote-middle', 'Catalog Middle', '2026-06-02T00:00:00.000Z', {
          kind: 'catalog-ebook',
          updatedAt: new Date('2026-06-11T00:00:00.000Z'),
        }),
      ],
      total: 1,
    });

    await expect((service as CombinedOpdsBookService).getRecentBooksAndCatalogEbooksPage(42, 1, 3, false, undefined)).resolves.toEqual({
      entries: [expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 'remote-middle' }), expect.objectContaining({ id: 1 })],
      total: 3,
    });
  });

  it('applies content filters to merged recent feeds', async () => {
    const { service } = makeService();
    const localSpy = vi.spyOn(service, 'getRecentBooksPage').mockResolvedValue({
      entries: [opdsEntry(1, 'Visible Local', '2026-06-01T00:00:00.000Z')],
      total: 1,
    });
    const catalogSpy = vi.spyOn(service, 'getCatalogEbookPage').mockResolvedValue({
      entries: [opdsEntry('remote-visible', 'Visible Remote', '2026-06-02T00:00:00.000Z', { kind: 'catalog-ebook' })],
      total: 1,
    });
    const contentFilters = { includeTagIds: [], excludeTagIds: [9], includeGenreIds: [], excludeGenreIds: [] };

    await expect((service as CombinedOpdsBookService).getRecentBooksAndCatalogEbooksPage(42, 1, 20, false, contentFilters)).resolves.toEqual({
      entries: [expect.objectContaining({ id: 'remote-visible' }), expect.objectContaining({ id: 1 })],
      total: 2,
    });
    expect(localSpy).toHaveBeenCalledWith(42, 1, 20, false, contentFilters);
    expect(catalogSpy).toHaveBeenCalledWith(42, 1, 20, undefined, 'recent', contentFilters);
  });

  it('builds catalog ebook author filters as exact author-name matches', () => {
    const { service } = makeService();

    const clause = (service as unknown as { buildCatalogEbookAuthorClause(author: string): unknown }).buildCatalogEbookAuthorClause('Ann');
    const values = collectValues(clause);

    expect(values).toContain('Ann');
    expect(values).not.toContain('%Ann%');
  });

  it('enforces validateBookAccess ownership checks', async () => {
    const { service } = makeService([[{ libraryId: 3 }], [{ libraryId: 4 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');

    accessSpy.mockResolvedValueOnce([1, 2]);
    await expect(service.validateBookAccess(5, 7)).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1, 4]);
    await expect(service.validateBookAccess(5, 7)).resolves.toBeUndefined();
  });

  it('resolves getBookFiles with fallback formatting and title values', async () => {
    const { service } = makeService([[], [{ absolutePath: '/books/a.epub', format: null, title: null }], []]);

    await expect(service.getBookFiles(7, 42)).resolves.toBeNull();

    await expect(service.getBookFiles(7)).resolves.toEqual({
      absolutePath: '/books/a.epub',
      format: 'unknown',
      title: 'book-7',
      authorName: '',
    });
  });

  it('applies text search inside smartScope when q is provided', async () => {
    const { service } = makeService([[{ id: 3, userId: 7, isPublic: false, filter: null }]]);
    const privateService = testable(service);
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');

    const where = await privateService.buildSmartScopeWhere(7, 3, [1], undefined, 'dune');

    expect(searchSpy).toHaveBeenCalledWith('dune');
    expect(collectValues(where)).toContain('%dune%');
  });

  it('omits text search clause inside smartScope when q is absent', async () => {
    const { service } = makeService([[{ id: 3, userId: 7, isPublic: false, filter: null }]]);
    const privateService = testable(service);
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');

    await expect(privateService.buildSmartScopeWhere(7, 3, [1])).resolves.not.toBeNull();

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('returns no smartScope books when smartScope is missing or private to another user', async () => {
    const { service } = makeService([[], [{ id: 5, userId: 99, isPublic: false, filter: null }]]);
    const privateService = testable(service);

    await expect(privateService.buildSmartScopeWhere(7, 5, [1])).resolves.toBeNull();
    await expect(privateService.buildSmartScopeWhere(7, 5, [1])).resolves.toBeNull();
  });

  it('builds smartScope filters and delegates smartScope pagination', async () => {
    const { service, queryBuilder } = makeService([[{ id: 9, userId: 7, isPublic: false, filter: { op: 'and' } }]], {
      buildWhere: vi.fn().mockReturnValue({ kind: 'where' }),
    });
    const privateService = testable(service);
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1, 2]);

    await expect(service.getBooksPage(7, 'title_desc', 2, 10, { smartScopeId: 9 })).resolves.toEqual({ entries: [{ id: 1 }], total: 1 });
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith({ op: 'and' }, { accessibleLibraryIds: [1, 2], userId: 7 });
    expect(paginatedSpy).toHaveBeenCalledTimes(1);
  });

  it('merges smartScope OPDS books with source-backed Ebook Library matches', async () => {
    const filter = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'cloud' }] };
    const db = makeDb([[{ id: 9, userId: 7, isPublic: false, filter }]]);
    const queryBuilder = { buildWhere: vi.fn().mockReturnValue({ kind: 'where' }) };
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const warehouseRepository = {
      queryUserCatalogItems: vi.fn().mockResolvedValue({
        rows: [makeCatalogRow('cloud-1', 'Alpha Cloud')],
        total: 1,
        page: 0,
        limit: 10,
      }),
    };
    const service = new OpdsBookService(db as never, queryBuilder as never, warehouseCatalog as never, warehouseRepository as never);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    vi.spyOn(service as never, 'paginatedBookQuery').mockResolvedValue({
      entries: [opdsEntry(3, 'Beta Local', '2025-01-01T00:00:00.000Z')],
      total: 1,
    });

    await expect(service.getBooksPage(7, 'title_asc', 1, 10, { smartScopeId: 9 })).resolves.toMatchObject({
      total: 2,
      entries: [
        { id: 'cloud-1', kind: 'catalog-ebook', title: 'Alpha Cloud', coverHref: '/api/v1/opds/catalog-ebooks/cloud-1/cover' },
        { id: 3, title: 'Beta Local' },
      ],
    });
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(filter, { accessibleLibraryIds: [1], userId: 7 });
    expect(warehouseCatalog.isCatalogEnabled).toHaveBeenCalledTimes(1);
    expect(warehouseRepository.queryUserCatalogItems).toHaveBeenCalledWith(7, {
      includeAllCatalogItems: true,
      filter,
      mediaType: 'ebook',
      q: undefined,
      sort: [{ field: 'title', dir: 'asc' }],
      page: 0,
      limit: 10,
    });
  });

  it('keeps smartScope OPDS source-backed matches for cloud-only users', async () => {
    const filter = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'cloud' }] };
    const db = makeDb([[{ id: 9, userId: 7, isPublic: false, filter }]]);
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const warehouseRepository = {
      queryUserCatalogItems: vi.fn().mockResolvedValue({
        rows: [makeCatalogRow('cloud-only', 'Cloud Only')],
        total: 1,
        page: 0,
        limit: 25,
      }),
    };
    const service = new OpdsBookService(db as never, { buildWhere: vi.fn() } as never, warehouseCatalog as never, warehouseRepository as never);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);
    const paginatedSpy = vi.spyOn(service as never, 'paginatedBookQuery');

    await expect(service.getBooksPage(7, 'recent', 1, 25, { smartScopeId: 9 })).resolves.toMatchObject({
      total: 1,
      entries: [{ id: 'cloud-only', kind: 'catalog-ebook', title: 'Cloud Only' }],
    });
    expect(paginatedSpy).not.toHaveBeenCalled();
    expect(warehouseRepository.queryUserCatalogItems).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ includeAllCatalogItems: true, filter, mediaType: 'ebook', sort: [{ field: 'addedAt', dir: 'desc' }] }),
    );
  });

  it('applies content filters to smartScope OPDS source-backed matches', async () => {
    const filter = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'cloud' }] };
    const db = makeDb([[{ id: 9, userId: 7, isPublic: false, filter }]]);
    const queryBuilder = { buildWhere: vi.fn().mockReturnValue({ kind: 'where' }) };
    const warehouseCatalog = { isCatalogEnabled: vi.fn().mockResolvedValue(true) };
    const warehouseRepository = {
      queryUserCatalogItems: vi.fn().mockResolvedValue({
        rows: [makeCatalogRow('cloud-filtered', 'Filtered Cloud')],
        total: 1,
        page: 0,
        limit: 25,
      }),
    };
    const service = new OpdsBookService(db as never, queryBuilder as never, warehouseCatalog as never, warehouseRepository as never);
    const contentFilters = { includeTagIds: [1], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    vi.spyOn(service as never, 'paginatedBookQuery').mockResolvedValue({ entries: [opdsEntry(3, 'Local', '2025-01-01T00:00:00.000Z')], total: 1 });

    await expect(service.getBooksPage(7, 'recent', 1, 25, { smartScopeId: 9 }, false, contentFilters)).resolves.toMatchObject({
      entries: [
        { id: 'cloud-filtered', kind: 'catalog-ebook', title: 'Filtered Cloud' },
        { id: 3, title: 'Local' },
      ],
      total: 2,
    });
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(filter, { accessibleLibraryIds: [1], userId: 7, contentFilters });
    expect(warehouseCatalog.isCatalogEnabled).toHaveBeenCalledTimes(1);
    expect(warehouseRepository.queryUserCatalogItems).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        includeAllCatalogItems: true,
        contentFilters,
        filter,
        mediaType: 'ebook',
        sort: [{ field: 'addedAt', dir: 'desc' }],
      }),
    );
  });

  it('paginates ids and only fetches entries when rows are present', async () => {
    const empty = makeService([[], [{ total: 5 }]]);
    await expect(testable(empty.service).paginatedBookQuery({ kind: 'where' }, 'recent', 2, 10)).resolves.toEqual({ entries: [], total: 5 });

    const filled = makeService([[{ id: 3 }, { id: 1 }], [{ total: 2 }]]);
    const filledPrivateService = testable(filled.service);
    const fetchSpy = vi.spyOn(filledPrivateService, 'fetchBookEntries').mockResolvedValue([{ id: 3 }, { id: 1 }]);

    await expect(filledPrivateService.paginatedBookQuery({ kind: 'where' }, 'author_asc', 1, 25)).resolves.toEqual({
      entries: [{ id: 3 }, { id: 1 }],
      total: 2,
    });
    expect(fetchSpy).toHaveBeenCalledWith([3, 1], {});
  });

  it('builds read-status, format, and id filters and forwards the user id to pagination', async () => {
    const { service } = makeService();
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const paginatedSpy = vi.spyOn(testable(service), 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });

    accessSpy.mockResolvedValueOnce([1, 2]);
    await expect(service.getBooksPage(7, 'recently_read', 1, 20, { readStatus: 'reading', format: 'EPUB', ids: [3, 1] })).resolves.toEqual({
      entries: [{ id: 1 }],
      total: 1,
    });

    expect(paginatedSpy).toHaveBeenCalledTimes(1);
    const [where, sortOrder, page, size, userId] = paginatedSpy.mock.calls[0] as unknown[];
    expect(sortOrder).toBe('recently_read');
    expect(page).toBe(1);
    expect(size).toBe(20);
    expect(userId).toBe(7);

    const values = collectValues(where);
    expect(values).toContain('reading');
    expect(values).toContain('epub');
    expect(values).toContain(3);
    expect(values).toContain(1);
  });

  it('builds membership-backed series filters from explicit and opaque legacy series ids', async () => {
    const explicit = makeService();
    const explicitAccessSpy = vi.spyOn(explicit.service, 'getAccessibleLibraryIds');
    const explicitPaginatedSpy = vi.spyOn(testable(explicit.service), 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });

    explicitAccessSpy.mockResolvedValueOnce([1]);
    await expect(explicit.service.getBooksPage(7, 'series_asc', 1, 20, { seriesId: 42 })).resolves.toEqual({
      entries: [{ id: 1 }],
      total: 1,
    });

    expect(explicitPaginatedSpy).toHaveBeenCalledTimes(1);
    expect((explicitPaginatedSpy.mock.calls[0] as unknown[])[5]).toEqual({ contextSeries: { seriesId: 42 } });
    expect(collectValues((explicitPaginatedSpy.mock.calls[0] as unknown[])[0])).toContain(42);

    const legacy = makeService();
    const legacyAccessSpy = vi.spyOn(legacy.service, 'getAccessibleLibraryIds');
    const legacyPaginatedSpy = vi.spyOn(testable(legacy.service), 'paginatedBookQuery').mockResolvedValue({ entries: [], total: 0 });

    legacyAccessSpy.mockResolvedValueOnce([1]);
    await legacy.service.getBooksPage(7, 'series_asc', 1, 20, { series: 'series:99' });

    expect((legacyPaginatedSpy.mock.calls[0] as unknown[])[5]).toEqual({ contextSeries: { seriesId: 99 } });
    expect(collectValues((legacyPaginatedSpy.mock.calls[0] as unknown[])[0])).toContain(99);
  });

  it('normalizes legacy series-name filters to membership identity', async () => {
    const { service } = makeService();
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const paginatedSpy = vi.spyOn(testable(service), 'paginatedBookQuery').mockResolvedValue({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([1]);
    await service.getBooksPage(7, 'series_asc', 1, 20, { series: ' Dune Saga ' });

    expect((paginatedSpy.mock.calls[0] as unknown[])[5]).toEqual({ contextSeries: { normalizedName: 'dune saga' } });
    expect(collectValues((paginatedSpy.mock.calls[0] as unknown[])[0])).toContain('dune saga');
  });

  it('returns paged distinct series from membership rows with stable ids', async () => {
    const { service, db } = makeService([
      [
        { id: 1, name: 'Dune', bookCount: 6 },
        { id: 2, name: 'World of Warcraft', bookCount: 9 },
      ],
    ]);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

    await expect(service.getDistinctSeriesPage(7, { q: 'war', limit: 1, offset: 0 })).resolves.toEqual({
      items: [{ id: 1, name: 'Dune', bookCount: 6 }],
      hasNext: true,
    });

    const chain = (db.select as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(chain.from).toHaveBeenCalledWith(bookSeries);
    expect(chain.innerJoin).toHaveBeenCalledWith(bookSeriesMemberships, expect.anything());
    expect(collectValues(chain.where.mock.calls[0]?.[0])).toEqual(expect.arrayContaining([1, '%war%']));
  });

  it('short-circuits when an empty id filter is supplied', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 20, { ids: [] })).resolves.toEqual({ entries: [], total: 0 });
  });

  it('builds unread read-status as a negated active-status subquery', () => {
    const { service } = makeService();

    const readingClause = testable(service).buildReadStatusClause(7, 'reading');
    const unreadClause = testable(service).buildReadStatusClause(7, 'unread');

    expect(collectValues(readingClause)).toEqual(expect.arrayContaining([7, 'reading', 'rereading', 'on_hold']));
    expect(collectValues(unreadClause)).toEqual(expect.arrayContaining([7, 'read', 'skimmed', 'abandoned']));
  });

  it('every sort order includes a books.id tiebreaker as its final ORDER BY clause', async () => {
    const sortOrders = [
      'recent',
      'recent_asc',
      'updated',
      'updated_asc',
      'recently_read',
      'recently_read_asc',
      'title_asc',
      'title_desc',
      'author_asc',
      'author_desc',
      'series_asc',
      'series_desc',
    ] as const;

    for (const sortOrder of sortOrders) {
      const { service, db } = makeService([[], [{ total: 0 }]]);
      await testable(service).paginatedBookQuery({ kind: 'where' }, sortOrder, 1, 25, 7);

      const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value as Record<string, unknown>);
      const orderByArgs = chains.flatMap((chain: Record<string, unknown>) => {
        const fn = chain['orderBy'] as ReturnType<typeof vi.fn>;
        return fn.mock.calls.flat() as unknown[];
      });

      const allValues = orderByArgs.flatMap((arg: unknown) => collectValues(arg));
      const hasIdTiebreaker = allValues.some((v) => v === 'id');

      expect(hasIdTiebreaker, `sort order "${sortOrder}" is missing books.id tiebreaker`).toBe(true);
    }
  });

  it('maps metadata, authors, and files into ordered OPDS entries', async () => {
    const now = new Date('2026-04-15T00:00:00.000Z');
    const { service } = makeService([
      [
        {
          id: 2,
          folderPath: '/library/second',
          addedAt: now,
          bookUpdatedAt: now,
          title: null,
          description: null,
          seriesId: null,
          seriesName: null,
          seriesIndex: null,
          language: null,
          publisher: null,
          isbn13: null,
          coverSource: null,
        },
        {
          id: 1,
          folderPath: '/library/first',
          addedAt: now,
          bookUpdatedAt: now,
          title: 'First',
          description: 'Desc',
          seriesId: 42,
          seriesName: 'Series',
          seriesIndex: 1,
          language: 'en',
          publisher: 'Pub',
          isbn13: '123',
          coverSource: 'extracted',
        },
      ],
      [
        { bookId: 1, name: 'Author One' },
        { bookId: 2, name: 'Author Two' },
      ],
      [
        { bookId: 1, id: 10, format: 'epub', role: 'content' },
        { bookId: 1, id: 11, format: 'mobi', role: 'content' },
        { bookId: 1, id: 12, format: 'jpg', role: 'cover' },
        { bookId: 2, id: 20, format: null, role: 'content' },
      ],
    ]);

    await expect(testable(service).fetchBookEntries([1, 2])).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        title: 'First',
        seriesId: 42,
        hasCover: true,
        authors: ['Author One'],
        files: [
          { id: 10, format: 'epub' },
          { id: 11, format: 'mobi' },
        ],
      }),
      expect.objectContaining({
        id: 2,
        title: 'second',
        hasCover: false,
        authors: ['Author Two'],
        files: [{ id: 20, format: 'unknown' }],
      }),
    ]);

    await expect(testable(service).fetchBookEntries([])).resolves.toEqual([]);
  });

  it('overrides primary metadata with the contextual series membership for series-scoped pages', async () => {
    const now = new Date('2026-04-15T00:00:00.000Z');
    const { service } = makeService([
      [
        {
          id: 1,
          folderPath: '/library/first',
          addedAt: now,
          bookUpdatedAt: now,
          title: 'First',
          description: null,
          seriesId: null,
          seriesName: 'Primary Saga',
          seriesIndex: 1,
          language: 'en',
          publisher: null,
          isbn13: null,
          coverSource: null,
        },
      ],
      [{ bookId: 1, name: 'Author One' }],
      [{ bookId: 1, id: 10, format: 'epub', role: 'content' }],
      [{ bookId: 1, seriesId: 42, seriesName: 'Secondary Arc', seriesIndex: 3 }],
    ]);

    await expect(testable(service).fetchBookEntries([1], { contextSeries: { seriesId: 42 } })).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        seriesId: 42,
        seriesName: 'Secondary Arc',
        seriesIndex: 3,
      }),
    ]);
  });
});
