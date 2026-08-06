import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import * as schema from '../../db/schema';
import { WarehouseRepository } from './warehouse.repository';

const dialect = new PgDialect();

function makeSelectChain<T>(terminalMethod: 'where' | 'orderBy' | 'limit' | 'offset', terminalResult: T) {
  const chain: Record<string, vi.Mock> = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);

  if (terminalMethod === 'where') {
    chain.where.mockResolvedValue(terminalResult);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.offset.mockReturnValue(chain);
  } else if (terminalMethod === 'orderBy') {
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockResolvedValue(terminalResult);
    chain.limit.mockReturnValue(chain);
    chain.offset.mockReturnValue(chain);
  } else if (terminalMethod === 'limit') {
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockResolvedValue(terminalResult);
    chain.offset.mockReturnValue(chain);
  } else {
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.offset.mockResolvedValue(terminalResult);
  }

  return chain;
}

function makeInsertChain<T>(returningResult?: T) {
  const chain = {
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };

  chain.values.mockReturnValue(chain);
  chain.onConflictDoNothing.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockResolvedValue(undefined);
  chain.returning.mockResolvedValue(returningResult);

  return chain;
}

function makeUpdateChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };

  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue([]);

  return chain;
}

function makeDeleteChain() {
  const chain = {
    where: vi.fn(),
  };

  chain.where.mockResolvedValue(undefined);

  return chain;
}

function makeDb() {
  const settingsInsert = makeInsertChain();
  const catalogItemInsert = makeInsertChain();
  const catalogItemAuthorInsert = makeInsertChain();
  const catalogDetailInsert = makeInsertChain();
  const userItemInsert = makeInsertChain();
  const userStateInsert = makeInsertChain();
  const bookmarkInsert = makeInsertChain();
  const requestInsert = makeInsertChain();
  const syncRunInsert = makeInsertChain();
  const updateChain = makeUpdateChain();
  const userItemDelete = makeDeleteChain();
  const bookmarkDelete = {
    where: vi.fn(),
    returning: vi.fn(),
  };
  bookmarkDelete.where.mockReturnValue(bookmarkDelete);
  bookmarkDelete.returning.mockResolvedValue([]);

  const db = {
    insert: vi.fn((table: unknown) => {
      if (table === schema.warehouseSettings) return settingsInsert;
      if (table === schema.warehouseCatalogItems) return catalogItemInsert;
      if (table === schema.warehouseCatalogItemAuthors) return catalogItemAuthorInsert;
      if (table === schema.warehouseCatalogDetails) return catalogDetailInsert;
      if (table === schema.warehouseUserItems) return userItemInsert;
      if (table === schema.warehouseUserState) return userStateInsert;
      if (table === schema.warehouseBookmarks) return bookmarkInsert;
      if (table === schema.warehouseRequests) return requestInsert;
      if (table === schema.warehouseCatalogSyncRuns) return syncRunInsert;
      throw new Error(`Unexpected insert table: ${String(table)}`);
    }),
    update: vi.fn().mockReturnValue(updateChain),
    delete: vi.fn((table: unknown) => {
      if (table === schema.warehouseUserItems) return userItemDelete;
      if (table === schema.warehouseBookmarks) return bookmarkDelete;
      throw new Error(`Unexpected delete table: ${String(table)}`);
    }),
    execute: vi.fn(),
    select: vi.fn(),
    query: {
      warehouseSettings: {
        findFirst: vi.fn(),
      },
      warehouseCatalogItems: {
        findFirst: vi.fn(),
      },
      warehouseCatalogDetails: {
        findFirst: vi.fn(),
      },
      warehouseUserItems: {
        findFirst: vi.fn(),
      },
      warehouseUserState: {
        findFirst: vi.fn(),
      },
      warehouseRequests: {
        findFirst: vi.fn(),
      },
      warehouseCatalogSyncRuns: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    _chains: {
      settingsInsert,
      catalogItemInsert,
      catalogItemAuthorInsert,
      catalogDetailInsert,
      userItemInsert,
      userStateInsert,
      bookmarkInsert,
      requestInsert,
      syncRunInsert,
      updateChain,
      userItemDelete,
      bookmarkDelete,
    },
  };

  return db;
}

function renderSql(condition: SQL | undefined) {
  if (!condition) {
    return null;
  }

  return dialect.sqlToQuery(condition);
}

describe('WarehouseRepository', () => {
  let repo: WarehouseRepository;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    repo = new WarehouseRepository(db as never);
  });

  describe('findSettings', () => {
    it('returns the default profile settings row', async () => {
      const row = { profileKey: 'default', enabled: true };
      db.query.warehouseSettings.findFirst.mockResolvedValue(row);

      await expect(repo.findSettings()).resolves.toEqual(row);
      expect(db.query.warehouseSettings.findFirst).toHaveBeenCalledWith({ where: expect.anything() });
    });
  });

  describe('listAudiobookCatalogDimensions', () => {
    it('queries audiobook narrators from local cached catalog rows with a bounded result', async () => {
      db.execute.mockResolvedValue({
        rows: [
          { name: 'Robin Miles', item_count: 2 },
          { name: 'Kevin R. Free', item_count: 1 },
        ],
      });

      await expect(repo.listAudiobookCatalogDimensions('narrator')).resolves.toEqual([
        { name: 'Robin Miles', itemCount: 2 },
        { name: 'Kevin R. Free', itemCount: 1 },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain('"media_type" = $1');
      expect(rendered?.sql).toContain('limit 100');
      expect(rendered?.params).toEqual(['audiobook']);
    });
  });

  describe('listEbookCatalogDimensions', () => {
    it('queries ebook genres from local cached catalog rows with a bounded result', async () => {
      db.execute.mockResolvedValue({
        rows: [
          { name: 'Fantasy', item_count: 3 },
          { name: 'Science Fiction', item_count: 2 },
        ],
      });

      await expect(repo.listEbookCatalogDimensions('genre')).resolves.toEqual([
        { name: 'Fantasy', itemCount: 3 },
        { name: 'Science Fiction', itemCount: 2 },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain('"media_type" = $1');
      expect(rendered?.sql).toContain('limit 100');
      expect(rendered?.params).toEqual(['ebook']);
    });
  });

  describe('getCatalogLibraryOverview', () => {
    it('counts cached catalog rows as native library inventory with content filters', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            total_books: '3',
            total_authors: '2',
            total_series: '1',
            books_added_this_year: '3',
          },
        ],
      });

      await expect(
        repo.getCatalogLibraryOverview(
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        totalBooks: 3,
        totalAuthors: 2,
        totalSeries: 1,
        totalStorageBytes: 0,
        booksAddedThisYear: 3,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain("date_trunc('year', current_date)");
      expect(rendered?.sql).toContain('coalesce("warehouse_catalog_items"."upstream_created_at", "warehouse_catalog_items"."created_at")');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.sql).toContain('from "genres"');
      expect(rendered?.params).toEqual(expect.arrayContaining(['ebook', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns an empty cached catalog library overview without querying when media filter is empty', async () => {
      await expect(repo.getCatalogLibraryOverview(undefined, [])).resolves.toEqual({
        totalBooks: 0,
        totalAuthors: 0,
        totalSeries: 0,
        totalStorageBytes: 0,
        booksAddedThisYear: 0,
      });

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('counts only user-owned catalog rows for requested source-backed media libraries', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            total_books: '2',
            total_authors: '2',
            total_series: '1',
            books_added_this_year: '1',
          },
        ],
      });

      await expect(
        repo.getUserCatalogLibraryOverview(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        totalBooks: 2,
        totalAuthors: 2,
        totalSeries: 1,
        totalStorageBytes: 0,
        booksAddedThisYear: 1,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(rendered?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(rendered?.sql).toContain('"warehouse_user_items"."added_at"');
      expect(rendered?.sql).not.toContain('coalesce("warehouse_catalog_items"."upstream_created_at", "warehouse_catalog_items"."created_at")');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns an empty user-owned catalog library overview without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogLibraryOverview(42, undefined, [])).resolves.toEqual({
        totalBooks: 0,
        totalAuthors: 0,
        totalSeries: 0,
        totalStorageBytes: 0,
        booksAddedThisYear: 0,
      });

      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('listCatalogAuthorSummaries', () => {
    it('groups synced catalog rows by author with stable virtual ids', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            id: '-3001',
            name: 'Octavia Butler',
            book_count: '3',
            last_added_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      await expect(repo.listCatalogAuthorSummaries({ userId: 42, q: 'octavia', mediaType: 'ebook' })).resolves.toEqual([
        {
          id: -3001,
          name: 'Octavia Butler',
          sortName: null,
          description: null,
          bookCount: 3,
          lastAddedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_item_authors"');
      expect(rendered?.sql).toContain('inner join "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('left join "warehouse_user_items"');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('warehouse_catalog_item_authors');
      expect(rendered?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(rendered?.sql).toContain('count(distinct ("warehouse_catalog_items"."media_type"');
      expect(rendered?.sql).toContain('"warehouse_catalog_item_authors"."author_id"');
      expect(rendered?.sql).toContain('group by "warehouse_catalog_item_authors"."canonical_name"');
      expect(rendered?.sql).not.toContain('jsonb_array_elements_text("warehouse_catalog_items"."authors")');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."media_type" = $');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, '%octavia%', 'ebook']));
    });

    it('canonicalizes comma-form source-backed authors before grouping and hashing', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            id: '-3001',
            name: 'Teresa Burrell',
            book_count: '2',
            last_added_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      await expect(repo.listCatalogAuthorSummaries({ userId: 42, q: 'Teresa Burrell' })).resolves.toEqual([
        {
          id: -3001,
          name: 'Teresa Burrell',
          sortName: null,
          description: null,
          bookCount: 2,
          lastAddedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_catalog_item_authors');
      expect(rendered?.sql).toContain('group by "warehouse_catalog_item_authors"."canonical_name"');
      expect(rendered?.sql).not.toContain('split_part');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, '%Teresa Burrell%']));
    });

    it('finds one synced catalog author by virtual id', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            id: '-3001',
            name: 'Octavia Butler',
            book_count: '3',
            last_added_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      await expect(repo.findCatalogAuthorSummaryById(-3001, 42)).resolves.toEqual({
        id: -3001,
        name: 'Octavia Butler',
        sortName: null,
        description: null,
        bookCount: 3,
        lastAddedAt: '2026-01-01T00:00:00.000Z',
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_item_authors"');
      expect(rendered?.sql).toContain('inner join "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('left join "warehouse_user_items"');
      expect(rendered?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(rendered?.sql).toContain('count(distinct ("warehouse_catalog_items"."media_type"');
      expect(rendered?.sql).toContain('"warehouse_catalog_item_authors"."author_id" = $');
      expect(rendered?.sql).toContain('limit 1');
      expect(rendered?.params).toContain(42);
      expect(rendered?.params).toContain(-3001);
    });
  });

  describe('listCatalogSeriesSummaries', () => {
    it('groups synced catalog items by series with user read state overlay', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            name: 'Dune',
            book_count: 3,
            read_count: 1,
            authors: ['Frank Herbert'],
            last_added_at: '2026-02-01 00:00:00',
          },
        ],
      });

      await expect(repo.listCatalogSeriesSummaries({ userId: 7, q: 'dune', author: 'herbert' })).resolves.toEqual([
        {
          name: 'Dune',
          bookCount: 3,
          readCount: 1,
          authors: ['Frank Herbert'],
          coverBookIds: [],
          lastAddedAt: '2026-02-01 00:00:00',
        },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('left join "warehouse_user_items"');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('warehouse_catalog_item_authors');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(rendered?.sql).toContain('count(distinct ("warehouse_catalog_items"."media_type"');
      expect(rendered?.sql).toContain('"read_status" = \'read\'');
      expect(rendered?.sql).toContain('jsonb_agg(distinct nullif("warehouse_catalog_item_authors"."name"');
      expect(rendered?.sql).toContain('group by lower(trim');
      expect(rendered?.params).toEqual(expect.arrayContaining([7, '%dune%', '%herbert%']));
    });
  });

  describe('listCatalogItemsBySeries', () => {
    it('queries synced catalog rows by exact series name with user state overlay', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'dune-1',
          title: 'Dune',
          series: 'Dune',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 3 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.listCatalogItemsBySeries({
          userId: 42,
          seriesName: ' Dune ',
          page: 2,
          size: 999,
          sort: 'title',
          order: 'asc',
          contentFilters: {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [],
          },
        }),
      ).resolves.toEqual({ rows, total: 3, page: 2, size: 999 });

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(db.select).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          userAddedAt: schema.warehouseUserItems.addedAt,
          rating: schema.warehouseUserState.rating,
          readingProgress: schema.warehouseUserState.progressPercent,
          readStatus: schema.warehouseUserState.readStatus,
        }),
      );
      expect(listChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());
      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(countChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.limit).toHaveBeenCalledWith(999);
      expect(listChain.offset).toHaveBeenCalledWith(1998);

      const renderedJoin = renderSql(listChain.leftJoin.mock.calls[0]?.[1]);
      expect(renderedJoin?.sql).toContain('"warehouse_user_items"."user_id" = $');
      expect(renderedJoin?.params).toContain(42);

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('lower(btrim("warehouse_catalog_items"."series")) = lower(btrim($1))');
      expect(renderedWhere?.sql).toContain('from "tags"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([' Dune ', 7]));

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title")');
    });

    it('orders series item rows by source-backed series index', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', [{ total: 0 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await repo.listCatalogItemsBySeries({
        userId: 42,
        seriesName: 'Dune',
        page: 0,
        size: 25,
        sort: 'seriesIndex',
        order: 'asc',
      });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."series_index"');
      expect(renderedOrder?.sql).toContain('asc');
    });
  });

  describe('listCatalogItemsByAuthor', () => {
    it('queries synced catalog rows by virtual author id and media library with user state overlay', async () => {
      const rows = [
        {
          id: 2,
          mediaType: 'ebook',
          remoteId: 'kindred',
          title: 'Kindred',
          authors: ['Octavia Butler'],
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.listCatalogItemsByAuthor({
          userId: 42,
          authorId: -3001,
          page: 1,
          size: 25,
          sort: 'addedAt',
          order: 'desc',
          mediaType: 'ebook',
        }),
      ).resolves.toEqual({ rows, total: 1, page: 1, size: 25 });

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItemAuthors);
      expect(db.select).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          userAddedAt: schema.warehouseUserItems.addedAt,
          rating: schema.warehouseUserState.rating,
          readingProgress: schema.warehouseUserState.progressPercent,
          readStatus: schema.warehouseUserState.readStatus,
        }),
      );
      expect(listChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(listChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());
      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItemAuthors);
      expect(countChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(countChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.limit).toHaveBeenCalledWith(25);
      expect(listChain.offset).toHaveBeenCalledWith(25);

      const renderedJoin = renderSql(listChain.leftJoin.mock.calls[0]?.[1]);
      expect(renderedJoin?.sql).toContain('"warehouse_user_items"."user_id" = $');
      expect(renderedJoin?.params).toContain(42);

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_item_authors"."author_id" = $');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type" = $');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([-3001, 'ebook']));

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_user_items"."added_at"');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."synced_at"');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."created_at") desc');
    });
  });

  describe('listCurrentlyReadingUserCatalogItems', () => {
    it('queries user catalog progress rows as native currently-reading candidates', async () => {
      const rows = [
        {
          id: 2,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Cloud Audio',
          progressPercent: 67,
          positionSeconds: 3600,
          lastActivityAt: new Date('2026-06-02T00:00:00.000Z'),
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(
        repo.listCurrentlyReadingUserCatalogItems(42, 25, {
          includeTagIds: [7],
          excludeTagIds: [],
          includeGenreIds: [],
          excludeGenreIds: [],
        }),
      ).resolves.toEqual(rows);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseUserState);
      expect(listChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(listChain.innerJoin).toHaveBeenCalledTimes(1);
      expect(listChain.limit).toHaveBeenCalledWith(25);

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."user_id" = $');
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."read_status" in');
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."progress_percent" > $');
      expect(renderedWhere?.sql).toContain('from "tags"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, 'reading', 'rereading', 0, 100, 7]));

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_state"."updated_at" desc');
    });

    it('scopes currently-reading rows to selected source-backed media libraries', async () => {
      const listChain = makeSelectChain('limit', []);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listCurrentlyReadingUserCatalogItems(42, 25, undefined, ['ebook'])).resolves.toEqual([]);

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type" in');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, 'ebook']));
    });
  });

  describe('listUserCatalogReadingActivityDays', () => {
    it('lists current user source-backed reading activity days with ownership, media, and content filters', async () => {
      db.execute.mockResolvedValue({ rows: [{ day: '2026-06-03' }, { day: '2026-06-04' }] });

      await expect(
        repo.listUserCatalogReadingActivityDays(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual(['2026-06-03', '2026-06-04']);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_state"."user_id"');
      expect(rendered?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."updated_at"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."progress_percent"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."position_seconds"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."read_status" in');
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.sql).toContain('from "genres"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns no source-backed reading activity days without querying when media filter is empty', async () => {
      await expect(repo.listUserCatalogReadingActivityDays(42, undefined, [])).resolves.toEqual([]);

      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('user catalog statistics aggregates', () => {
    it('summarizes only user-owned source-backed rows for requested media libraries', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            total_books: '5',
            total_authors: '3',
            total_series: '2',
            total_publishers: '2',
            total_genres: '4',
            total_languages: '2',
            books_added_this_year: '3',
          },
        ],
      });

      await expect(
        repo.getUserCatalogStatisticsSummary(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        totalBooks: 5,
        totalAuthors: 3,
        totalSeries: 2,
        totalPublishers: 2,
        totalStorageBytes: 0,
        totalGenres: 4,
        totalLanguages: 2,
        publicationYearMin: null,
        publicationYearMax: null,
        booksAddedThisYear: 3,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(rendered?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain("date_trunc('year', current_date)");
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns an empty statistics summary without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogStatisticsSummary(42, undefined, [])).resolves.toEqual({
        totalBooks: 0,
        totalAuthors: 0,
        totalSeries: 0,
        totalPublishers: 0,
        totalStorageBytes: 0,
        totalGenres: 0,
        totalLanguages: 0,
        publicationYearMin: null,
        publicationYearMax: null,
        booksAddedThisYear: 0,
      });

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns top source-backed authors, genres, and series from user-owned rows', async () => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ name: 'Ada', count: '4' }] })
        .mockResolvedValueOnce({ rows: [{ genre: 'Mystery', count: '5' }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ name: 'Orbit', count: '3' }] });

      await expect(repo.topUserCatalogAuthors(42, undefined, ['ebook'])).resolves.toEqual([{ name: 'Ada', count: 4 }]);
      await expect(repo.topUserCatalogGenres(42, undefined, ['ebook'])).resolves.toEqual({
        items: [{ genre: 'Mystery', count: 5 }],
        unknownCount: 2,
      });
      await expect(repo.topUserCatalogSeries(42, undefined, ['ebook'])).resolves.toEqual([{ name: 'Orbit', count: 3 }]);

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered.every((entry) => entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.sql.includes('"warehouse_user_items"."media_type"'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes(42))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
      expect(rendered.some((entry) => entry?.sql.includes('jsonb_array_elements_text'))).toBe(true);
    });

    it('returns format distribution from cached source-backed library rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          { format: 'epub', count: '5' },
          { format: 'pdf', count: '2' },
        ],
      });

      await expect(repo.formatDistribution(undefined, ['ebook'])).resolves.toEqual([
        { format: 'epub', count: 5 },
        { format: 'pdf', count: 2 },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
      expect(rendered?.params).toContain('epub');
    });

    it('returns language distribution from cached source-backed library rows', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [
            { language: 'en', count: '5' },
            { language: 'fr', count: '2' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] });

      await expect(repo.languageDistribution(undefined, ['ebook'])).resolves.toEqual({
        items: [
          { language: 'en', count: 5 },
          { language: 'fr', count: 2 },
        ],
        unknownCount: 3,
      });

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered.every((entry) => entry?.sql.includes('from "warehouse_catalog_items"'))).toBe(true);
      expect(rendered.every((entry) => entry?.sql.includes('"warehouse_catalog_items"."language"'))).toBe(true);
      expect(rendered.every((entry) => !entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
    });

    it('returns books-added-over-time rows from cached source-backed library rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          { year: 2026, month: 4, count: '5' },
          { year: 2026, month: 5, count: '2' },
        ],
      });

      await expect(repo.booksAddedOverTime(undefined, ['ebook'], 'monthly', 'last-5-years')).resolves.toEqual([
        { year: 2026, month: 4, count: 5 },
        { year: 2026, month: 5, count: 2 },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('upstream_created_at');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
    });

    it('returns storage-by-format rows from cached source-backed library rows', async () => {
      db.execute.mockResolvedValueOnce({
        rows: [
          { format: 'epub', size_bytes: '4096' },
          { format: 'pdf', size_bytes: '2048' },
        ],
      });

      await expect(repo.storageByFormat(undefined, ['ebook'])).resolves.toEqual([
        { format: 'epub', sizeBytes: 4096 },
        { format: 'pdf', sizeBytes: 2048 },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('fileSizeBytes');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
    });

    it('returns format-share-over-time rows from cached source-backed library rows', async () => {
      db.execute.mockResolvedValueOnce({
        rows: [
          { year: 2025, month: 1, format: 'epub', count: '3' },
          { year: 2025, month: 2, format: 'pdf', count: '1' },
        ],
      });

      await expect(repo.formatShareOverTime(undefined, ['ebook'])).resolves.toEqual([
        { year: 2025, month: 1, format: 'epub', count: 3 },
        { year: 2025, month: 2, format: 'pdf', count: 1 },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('extract(year from');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."upstream_created_at"');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
    });

    it('returns library metadata completeness rows from cached source-backed library rows', async () => {
      db.execute.mockResolvedValueOnce({
        rows: [
          {
            library_id: '-1',
            library_name: 'Ebook Library',
            total: '4',
            has_title: '4',
            has_cover: '3',
            has_author: '2',
            has_genre: '2',
            has_tag: '0',
            has_description: '1',
            has_publisher: '1',
            has_year: '3',
            has_language: '4',
            has_page_count: '2',
            has_rating: '1',
            has_series: '1',
            has_isbn: '2',
          },
        ],
      });

      await expect(repo.libraryMetadataCompleteness(undefined, ['ebook'])).resolves.toEqual([
        {
          libraryId: -1,
          libraryName: 'Ebook Library',
          total: 4,
          hasTitle: 4,
          hasCover: 3,
          hasAuthor: 2,
          hasGenre: 2,
          hasTag: 0,
          hasDescription: 1,
          hasPublisher: 1,
          hasYear: 3,
          hasLanguage: 4,
          hasPageCount: 2,
          hasRating: 1,
          hasSeries: 1,
          hasIsbn: 2,
        },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('has_cover');
      expect(rendered?.sql).toContain('library_id');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
    });

    it('returns page-count distribution rows from cached source-backed library rows', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [{ format: 'epub', count: '3', min: 100, q1: 125.5, median: 150, q3: 175.5, max: 200 }],
        })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] });

      await expect(repo.pageCountDistributionByFormat(undefined, ['ebook'])).resolves.toEqual({
        items: [{ format: 'epub', count: 3, min: 100, q1: 125.5, median: 150, q3: 175.5, max: 200 }],
        unknownCount: 2,
      });

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered.every((entry) => entry?.sql.includes('from "warehouse_catalog_items"'))).toBe(true);
      expect(rendered[0]?.sql).toContain('percentile_cont');
      expect(rendered[0]?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(rendered.every((entry) => !entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
    });

    it('returns metadata freshness gauge counts from cached source-backed library rows', async () => {
      db.execute.mockResolvedValueOnce({
        rows: [
          {
            total_books: '8',
            fresh_30d_count: '4',
            stale_31_to_90d_count: '2',
            stale_91_to_180d_count: '1',
            stale_over_180d_count: '1',
          },
        ],
      });

      await expect(repo.metadataFreshnessGauge(undefined, ['ebook'])).resolves.toEqual({
        totalBooks: 8,
        neverFetchedCount: 0,
        fresh30dCount: 4,
        stale31To90dCount: 2,
        stale91To180dCount: 1,
        staleOver180dCount: 1,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."synced_at"');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
    });

    it('returns library integrity gauge counts from cached source-backed library rows', async () => {
      db.execute.mockResolvedValueOnce({
        rows: [
          {
            total_books: '8',
            present_count: '7',
            primary_file_count: '6',
            metadata_count: '5',
          },
        ],
      });

      await expect(repo.libraryIntegrityGauge(undefined, ['ebook'])).resolves.toEqual({
        totalBooks: 8,
        presentCount: 7,
        primaryFileCount: 6,
        metadataCount: 5,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('warehouse_catalog_details');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
    });

    it('returns acquisition lag scatter rows from cached source-backed library rows', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [
            { added_year: 2024, lag_years: 5, count: '3' },
            { added_year: 2025, lag_years: 12, count: '2' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ unknown_count: '4' }] });

      await expect(repo.acquisitionLagScatter(undefined, ['ebook'])).resolves.toEqual({
        items: [
          { addedYear: 2024, lagYears: 5, count: 3 },
          { addedYear: 2025, lagYears: 12, count: 2 },
        ],
        unknownCount: 4,
      });

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered[0]?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered[0]?.sql).toContain('upstream_created_at');
      expect(rendered[0]?.sql).toContain('publishedYear');
      expect(rendered.every((entry) => !entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
    });

    it('returns genre co-occurrence rows from cached source-backed library rows', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [{ name: 'Mystery' }, { name: 'Thriller' }, { name: 'Sci-Fi' }],
        })
        .mockResolvedValueOnce({
          rows: [
            { source: 'Mystery', target: 'Thriller', value: 4 },
            { source: 'Mystery', target: 'Sci-Fi', value: 2 },
          ],
        });

      await expect(repo.getGenreCooccurrence(undefined, ['ebook'])).resolves.toEqual({
        nodes: [{ name: 'Mystery' }, { name: 'Thriller' }, { name: 'Sci-Fi' }],
        links: [
          { source: 'Mystery', target: 'Thriller', value: 4 },
          { source: 'Mystery', target: 'Sci-Fi', value: 2 },
        ],
      });

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered[0]?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered[0]?.sql).toContain('jsonb_array_elements_text');
      expect(rendered[1]?.sql).toContain('with top_genres');
      expect(rendered[1]?.sql).toContain('g1.name < g2.name');
      expect(rendered.every((entry) => !entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
    });

    it('returns metadata score distribution rows from cached source-backed library rows', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [
            { min_score: 20, count: '3' },
            { min_score: 80, count: '2' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({
          rows: [{ total_count: '5', percentile25: 20, percentile50: 50, percentile75: 80, percentile90: 90 }],
        });

      await expect(repo.metadataScoreDistribution(undefined, ['ebook'])).resolves.toEqual({
        bins: [
          { minScore: 20, maxScore: 29, count: 3 },
          { minScore: 80, maxScore: 89, count: 2 },
        ],
        unknownCount: 0,
        totalCount: 5,
        percentile25: 20,
        percentile50: 50,
        percentile75: 80,
        percentile90: 90,
      });

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered.every((entry) => entry?.sql.includes('from "warehouse_catalog_items"'))).toBe(true);
      expect(rendered.every((entry) => entry?.sql.includes('floor'))).toBe(true);
      expect(rendered.every((entry) => !entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
    });

    it('returns publication decade rows from cached source-backed library rows', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [
            { decade: 1990, count: '5' },
            { decade: 2010, count: '2' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] });

      await expect(repo.publicationDecade(undefined, ['ebook'])).resolves.toEqual({
        items: [
          { decade: 1990, count: 5 },
          { decade: 2010, count: 2 },
        ],
        unknownCount: 3,
      });

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered.every((entry) => entry?.sql.includes('from "warehouse_catalog_items"'))).toBe(true);
      expect(rendered.every((entry) => entry?.sql.includes('publishedYear'))).toBe(true);
      expect(rendered.every((entry) => !entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
    });

    it('returns publication year timeline rows from cached source-backed library rows', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [
            { year: 1999, count: '5' },
            { year: 2018, count: '2' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { year: 1999, title: 'A' },
            { year: 1999, title: 'B' },
            { year: 2018, title: 'C' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] });

      await expect(repo.publicationYearTimeline(undefined, ['ebook'])).resolves.toEqual({
        items: [
          { year: 1999, count: 5, topTitles: ['A', 'B'] },
          { year: 2018, count: 2, topTitles: ['C'] },
        ],
        unknownCount: 3,
      });

      const rendered = db.execute.mock.calls.map((call) => renderSql(call[0]));
      expect(rendered.every((entry) => entry?.sql.includes('from "warehouse_catalog_items"'))).toBe(true);
      expect(rendered.every((entry) => entry?.sql.includes('publishedYear'))).toBe(true);
      expect(rendered.every((entry) => !entry?.sql.includes('warehouse_user_items'))).toBe(true);
      expect(rendered.every((entry) => entry?.params.includes('ebook'))).toBe(true);
    });

    it('returns largest book rows from cached source-backed library rows', async () => {
      db.execute.mockResolvedValueOnce({
        rows: [
          { id: 10, title: 'Large Source Book', size_bytes: '4096', format: 'epub' },
          { id: 11, title: 'Medium Source Book', size_bytes: '2048', format: 'pdf' },
        ],
      });

      await expect(repo.largestBooks(undefined, ['ebook'])).resolves.toEqual([
        { id: 10, title: 'Large Source Book', sizeBytes: 4096, format: 'epub' },
        { id: 11, title: 'Medium Source Book', sizeBytes: 2048, format: 'pdf' },
      ]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('from "warehouse_catalog_items"');
      expect(rendered?.sql).toContain('fileSizeBytes');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.params).toContain('ebook');
    });

    it('returns empty top aggregate rows without querying when media filter is empty', async () => {
      await expect(repo.topUserCatalogAuthors(42, undefined, [])).resolves.toEqual([]);
      await expect(repo.topUserCatalogGenres(42, undefined, [])).resolves.toEqual({ items: [], unknownCount: 0 });
      await expect(repo.topUserCatalogSeries(42, undefined, [])).resolves.toEqual([]);

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns diversity score data from user-owned source-backed rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            unique_genres_read: '2',
            total_genres_in_library: '5',
            unique_authors_read: '3',
            total_books_read: '4',
            publication_years: [1990, 2020],
            unique_languages: '2',
            genres_read: ['mystery', 'sci-fi'],
            genres_in_library: ['mystery', 'romance', 'sci-fi', 'thriller', 'western'],
            authors_read: ['ada', 'becky', 'chen'],
            languages_read: ['en', 'fr'],
          },
        ],
      });

      await expect(
        repo.getUserCatalogDiversityData(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        uniqueGenresRead: 2,
        totalGenresInLibrary: 5,
        uniqueAuthorsRead: 3,
        totalBooksRead: 4,
        publicationYears: [1990, 2020],
        uniqueLanguages: 2,
        genresRead: ['mystery', 'sci-fi'],
        genresInLibrary: ['mystery', 'romance', 'sci-fi', 'thriller', 'western'],
        authorsRead: ['ada', 'becky', 'chen'],
        languagesRead: ['en', 'fr'],
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('owned_items as');
      expect(rendered?.sql).toContain('read_items as');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain('read_status');
      expect(rendered?.sql).toContain('raw_payload');
      expect(rendered?.sql).toContain('genres_read');
      expect(rendered?.sql).toContain('genres_in_library');
      expect(rendered?.sql).toContain('authors_read');
      expect(rendered?.sql).toContain('languages_read');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 'read', 7, 9]));
      expect(rendered?.params).not.toContain('skimmed');
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns empty diversity score data without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogDiversityData(42, undefined, [])).resolves.toEqual({
        uniqueGenresRead: 0,
        totalGenresInLibrary: 0,
        uniqueAuthorsRead: 0,
        totalBooksRead: 0,
        publicationYears: [],
        uniqueLanguages: 0,
        genresRead: [],
        genresInLibrary: [],
        authorsRead: [],
        languagesRead: [],
      });

      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('source-backed user reading statistics', () => {
    it('returns user reading summary from owned source-backed rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            tracked_books: '6',
            started_books: '5',
            in_progress_books: '2',
            completed_books: '3',
            mean_progress_percent: '66.5',
          },
        ],
      });

      await expect(
        repo.getUserReadingSummary(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        trackedBooks: 6,
        startedBooks: 5,
        inProgressBooks: 2,
        completedBooks: 3,
        meanProgressPercent: 66.5,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(rendered?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."read_status"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."progress_percent"');
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.sql).toContain('from "genres"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns source-backed progress funnel from owned user state in range', async () => {
      const since = new Date('2026-03-10T00:00:00.000Z');
      const until = new Date('2026-04-09T00:00:00.000Z');
      db.execute.mockResolvedValue({
        rows: [
          {
            started: '7',
            reached25: '6',
            reached50: '4',
            reached75: '3',
            completed: '2',
          },
        ],
      });

      await expect(repo.getUserProgressFunnelInRange(42, undefined, ['audiobook'], since, until)).resolves.toEqual({
        started: 7,
        reached25: 6,
        reached50: 4,
        reached75: 3,
        completed: 2,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_state"."updated_at" >=');
      expect(rendered?.sql).toContain('"warehouse_user_state"."updated_at" <');
      expect(rendered?.sql).toContain('greatest');
      expect(rendered?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, since.toISOString(), until.toISOString(), 'audiobook']));
      expect(rendered?.params).not.toContain('ebook');
    });

    it('returns monthly completions from source-backed finished user state', async () => {
      db.execute.mockResolvedValue({
        rows: [{ year: '2026', month: '3', count: '4' }],
      });

      await expect(
        repo.getUserMonthlyCompletions(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
          120,
        ),
      ).resolves.toEqual([{ year: 2026, month: 3, count: 4 }]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_state"."finished_at" is not null');
      expect(rendered?.sql).toContain('"warehouse_user_state"."finished_at" >=');
      expect(rendered?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(rendered?.sql).toContain('extract(year from "warehouse_user_state"."finished_at")');
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.sql).toContain('from "genres"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'read', 'ebook', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns completion latency days from source-backed added and finished state', async () => {
      db.execute.mockResolvedValue({
        rows: [{ days: '5.5' }, { days: '40' }],
      });

      await expect(
        repo.getUserCompletionLatencyDays(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['audiobook'],
          365,
        ),
      ).resolves.toEqual([5.5, 40]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_items"."added_at"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."finished_at" is not null');
      expect(rendered?.sql).toContain('"warehouse_user_state"."finished_at" >=');
      expect(rendered?.sql).toContain('extract(epoch from');
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.sql).toContain('from "genres"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'read', 'audiobook', 7, 9]));
      expect(rendered?.params).not.toContain('ebook');
    });

    it('returns reading survival max progress from source-backed user state', async () => {
      db.execute.mockResolvedValue({
        rows: [{ max_progress: '25' }, { max_progress: '80.5' }, { max_progress: '100' }],
      });

      await expect(
        repo.getUserReadingSurvivalMaxProgress(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
          365,
        ),
      ).resolves.toEqual([25, 80.5, 100]);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).not.toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('"warehouse_user_state"."updated_at" >=');
      expect(rendered?.sql).toContain('greatest');
      expect(rendered?.sql).toContain(`"warehouse_user_state"."read_status" = 'read'`);
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.sql).toContain('from "genres"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('short-circuits source-backed user reading statistics when no source-backed media types are accessible', async () => {
      await expect(repo.getUserReadingSummary(42, undefined, [])).resolves.toEqual({
        trackedBooks: 0,
        startedBooks: 0,
        inProgressBooks: 0,
        completedBooks: 0,
        meanProgressPercent: 0,
      });
      await expect(repo.getUserProgressFunnelInRange(42, undefined, [], new Date(), new Date())).resolves.toEqual({
        started: 0,
        reached25: 0,
        reached50: 0,
        reached75: 0,
        completed: 0,
      });
      await expect(repo.getUserMonthlyCompletions(42, undefined, [], 120)).resolves.toEqual([]);
      await expect(repo.getUserCompletionLatencyDays(42, undefined, [], 365)).resolves.toEqual([]);
      await expect(repo.getUserReadingSurvivalMaxProgress(42, undefined, [], 365)).resolves.toEqual([]);

      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('countCompletedUserCatalogItemsThisYear', () => {
    it('counts user-owned source-backed read and skimmed items completed this year with content filters', async () => {
      db.execute.mockResolvedValue({ rows: [{ count: '3' }] });

      await expect(
        repo.countCompletedUserCatalogItemsThisYear(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toBe(3);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(rendered?.sql).toContain('"warehouse_user_state"."read_status" in');
      expect(rendered?.sql).toContain('"warehouse_user_state"."finished_at" is not null');
      expect(rendered?.sql).toContain('"warehouse_user_state"."finished_at" >=');
      expect(rendered?.sql).toContain("date_trunc('year', current_date)");
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.sql).toContain('from "genres"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 'read', 'skimmed', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns zero completed source-backed items without querying when media filter is empty', async () => {
      await expect(repo.countCompletedUserCatalogItemsThisYear(42, undefined, [])).resolves.toBe(0);

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns year projection data from user-owned source-backed rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            books_completed_ytd: '3',
            pages_read_last_30_days: '450',
            hours_read_last_30_days: '6.5',
            books_completed_last_30_days: '2',
          },
        ],
      });
      const yearStart = new Date('2026-01-01T00:00:00.000Z');
      const thirtyDaysAgo = new Date('2026-05-05T00:00:00.000Z');

      await expect(
        repo.getUserCatalogYearProjectionData(
          42,
          yearStart,
          thirtyDaysAgo,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        booksCompletedYtd: 3,
        pagesReadLast30Days: 450,
        hoursReadLast30Days: 6.5,
        booksCompletedLast30Days: 2,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('finished_at');
      expect(rendered?.sql).toContain('duration_seconds');
      expect(rendered?.sql).toContain('raw_payload');
      expect(rendered?.sql).toContain('books_completed_ytd');
      expect(rendered?.sql).toContain('pages_read_last_30_days');
      expect(rendered?.sql).toContain('hours_read_last_30_days');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 'read', 'skimmed', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('keeps mixed ebook and audiobook projection signals separated', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            books_completed_ytd: '2',
            pages_read_last_30_days: '0',
            hours_read_last_30_days: '3',
            books_completed_last_30_days: '2',
          },
        ],
      });

      await expect(
        repo.getUserCatalogYearProjectionData(42, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-05-05T00:00:00.000Z'), undefined, [
          'ebook',
          'audiobook',
        ]),
      ).resolves.toEqual({
        booksCompletedYtd: 2,
        pagesReadLast30Days: 0,
        hoursReadLast30Days: 3,
        booksCompletedLast30Days: 2,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain("= 'ebook'");
      expect(rendered?.sql).toContain("~ '^[0-9]+$'");
      expect(rendered?.sql).toContain('else 0');
      expect(rendered?.sql).toContain("media_type = 'audiobook'");
      expect(rendered?.params).toEqual(expect.arrayContaining(['ebook', 'audiobook']));
    });

    it('returns empty year projection data without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogYearProjectionData(42, new Date(), new Date(), undefined, [])).resolves.toEqual({
        booksCompletedYtd: 0,
        pagesReadLast30Days: 0,
        hoursReadLast30Days: 0,
        booksCompletedLast30Days: 0,
      });

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns reading DNA data from user-owned source-backed rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            avg_page_count: '360',
            unique_genres: '3',
            genres_read: ['mystery', 'sci-fi', 'thriller'],
            total_books: '5',
            reading_days: ['2026-06-01', '2026-06-02'],
            lookback_days: '180',
            peak_hour: '20',
            hour_buckets: [{ hour: 20, totalSeconds: 2 }],
            pages_read_for_speed: '0',
            seconds_read_for_speed: '0',
          },
        ],
      });
      const since = new Date('2025-12-04T00:00:00.000Z');

      await expect(
        repo.getUserCatalogReadingDnaData(
          42,
          since,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        avgPageCount: 360,
        uniqueGenres: 3,
        totalBooks: 5,
        readingDaysRatio: 2 / 180,
        peakHour: 20,
        avgPagesPerHour: null,
        genresRead: ['mystery', 'sci-fi', 'thriller'],
        readingDays: ['2026-06-01', '2026-06-02'],
        lookbackDays: 180,
        hourBuckets: [{ hour: 20, totalSeconds: 2 }],
        pagesReadForSpeed: 0,
        secondsReadForSpeed: 0,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain('updated_at');
      expect(rendered?.sql).toContain('raw_payload');
      expect(rendered?.sql).toContain('duration_seconds');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 'read', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns empty reading DNA data without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogReadingDnaData(42, new Date(), undefined, [])).resolves.toEqual({
        avgPageCount: 0,
        uniqueGenres: 0,
        totalBooks: 0,
        readingDaysRatio: 0,
        peakHour: 12,
        avgPagesPerHour: null,
        genresRead: [],
        readingDays: [],
        lookbackDays: 0,
        hourBuckets: [],
        pagesReadForSpeed: 0,
        secondsReadForSpeed: 0,
      });

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns challenge pattern data from user-owned source-backed rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            avg_page_count: '260',
            unique_genres_last_6_months: '4',
            genres_last_6_months: ['mystery', 'sci-fi'],
            stale_in_progress_count: '1',
            top_author_book_count: '3',
            total_books_read: '5',
            pages_this_month: '420',
            short_books_completed: '1',
            new_genres_read: '2',
            genres_read_this_month: ['mystery'],
            oldest_in_progress_finished: true,
            new_authors_read: '2',
            authors_read_this_month: ['ada'],
            reading_days_this_month: ['2026-06-01', '2026-06-02'],
          },
        ],
      });
      const monthStart = new Date('2026-06-01T00:00:00.000Z');
      const sixMonthsAgo = new Date('2025-12-04T00:00:00.000Z');

      await expect(
        repo.getUserCatalogChallengePatternData(
          42,
          monthStart,
          sixMonthsAgo,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toEqual({
        avgPageCount: 260,
        uniqueGenresLast6Months: 4,
        staleInProgressCount: 1,
        currentStreak: 0,
        maxStreakThisMonth: 2,
        topAuthorBookCount: 3,
        totalBooksRead: 5,
        pagesThisMonth: 420,
        shortBooksCompleted: 1,
        newGenresRead: 2,
        oldestInProgressFinished: true,
        newAuthorsRead: 2,
        pagesReadThisMonth: 420,
        genresLast6Months: ['mystery', 'sci-fi'],
        genresReadThisMonth: ['mystery'],
        authorsReadThisMonth: ['ada'],
        readingDaysThisMonth: ['2026-06-01', '2026-06-02'],
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain('raw_payload');
      expect(rendered?.sql).toContain('duration_seconds');
      expect(rendered?.sql).toContain('finished_at');
      expect(rendered?.sql).toContain('updated_at');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 'read', 'skimmed', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns empty challenge pattern data without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogChallengePatternData(42, new Date(), new Date(), undefined, [])).resolves.toEqual({
        avgPageCount: 0,
        uniqueGenresLast6Months: 0,
        staleInProgressCount: 0,
        currentStreak: 0,
        maxStreakThisMonth: 0,
        topAuthorBookCount: 0,
        totalBooksRead: 0,
        pagesThisMonth: 0,
        shortBooksCompleted: 0,
        newGenresRead: 0,
        oldestInProgressFinished: false,
        newAuthorsRead: 0,
        pagesReadThisMonth: 0,
        genresLast6Months: [],
        genresReadThisMonth: [],
        authorsReadThisMonth: [],
        readingDaysThisMonth: [],
      });

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns neglected gems from user-owned source-backed rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            id: 901,
            media_type: 'comic',
            remote_id: 'comic-901',
            title: 'Cloud Comic Gem',
            has_cover: true,
            rating: '5',
            added_at: '2026-05-01T00:00:00.000Z',
            genre: 'Comics',
          },
        ],
      });
      const today = new Date('2026-06-04T00:00:00.000Z');

      await expect(
        repo.getUserCatalogNeglectedGems(
          42,
          today,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['comic'],
        ),
      ).resolves.toEqual({
        gems: [
          {
            type: 'catalog-item',
            bookId: 901,
            mediaType: 'comic',
            remoteId: 'comic-901',
            title: 'Cloud Comic Gem',
            hasCover: true,
            rating: 5,
            waitingDays: 34,
            genre: 'Comics',
          },
        ],
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain('rating');
      expect(rendered?.sql).toContain('read_status');
      expect(rendered?.sql).toContain('added_at');
      expect(rendered?.sql).toContain('limit 5');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'comic', 4, 'read', 'skimmed', 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns empty neglected gems without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogNeglectedGems(42, new Date(), undefined, [])).resolves.toEqual({ gems: [] });

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns the oldest unstarted source-backed long-wait item', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            id: 901,
            media_type: 'comic',
            remote_id: 'comic-901',
            title: 'Cloud Old Comic',
            has_cover: true,
            added_at: '2026-05-01T00:00:00.000Z',
            page_count: '320',
            genre: 'Comics',
            format: 'cbz',
          },
        ],
      });
      const today = new Date('2026-06-04T00:00:00.000Z');

      await expect(
        repo.getUserCatalogLongWait(
          42,
          today,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['comic'],
        ),
      ).resolves.toEqual({
        type: 'catalog-item',
        bookId: 901,
        mediaType: 'comic',
        remoteId: 'comic-901',
        title: 'Cloud Old Comic',
        hasCover: true,
        addedAt: '2026-05-01T00:00:00.000Z',
        waitingDays: 34,
        pageCount: 320,
        genre: 'Comics',
        fileId: null,
        fileFormat: 'cbz',
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('jsonb_array_elements_text');
      expect(rendered?.sql).toContain('read_status');
      expect(rendered?.sql).toContain('progress_percent');
      expect(rendered?.sql).toContain('position_seconds');
      expect(rendered?.sql).toContain('added_at');
      expect(rendered?.sql).toContain('raw_payload');
      expect(rendered?.sql).toContain('limit 1');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'comic', 'unread', 0, 7, 9]));
      expect(rendered?.params).not.toContain('audiobook');
    });

    it('returns null long-wait candidate without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogLongWait(42, new Date(), undefined, [])).resolves.toBeNull();

      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('catalog annotations for dashboard widgets', () => {
    it('counts only user-owned source-backed annotations with content filters', async () => {
      const countChain = makeSelectChain('where', [{ count: 2 }]);
      db.select.mockReturnValueOnce(countChain);

      await expect(
        repo.countUserCatalogAnnotations(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [9],
          },
          ['ebook'],
        ),
      ).resolves.toBe(2);

      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseAnnotations);
      expect(countChain.innerJoin).toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(countChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());

      const renderedWhere = renderSql(countChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_annotations"."user_id" = $');
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type" in');
      expect(renderedWhere?.sql).toContain('from "tags"');
      expect(renderedWhere?.sql).toContain('from "genres"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, 'ebook', 7, 9]));
      expect(renderedWhere?.params).not.toContain('audiobook');
    });

    it('returns zero source-backed annotation count without querying when media filter is empty', async () => {
      await expect(repo.countUserCatalogAnnotations(42, undefined, [])).resolves.toBe(0);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('fetches a source-backed annotation by offset for the current user library item', async () => {
      const row = {
        text: 'Cloud quote',
        note: null,
        bookTitle: 'Cloud Book',
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        hasCover: true,
        chapterTitle: 'Chapter 1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      const selectChain = makeSelectChain('offset', [row]);
      db.select.mockReturnValueOnce(selectChain);

      await expect(repo.getUserCatalogAnnotationByOffset(42, 3, undefined, ['ebook'])).resolves.toEqual(row);

      expect(selectChain.from).toHaveBeenCalledWith(schema.warehouseAnnotations);
      expect(selectChain.innerJoin).toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(selectChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(selectChain.limit).toHaveBeenCalledWith(1);
      expect(selectChain.offset).toHaveBeenCalledWith(3);

      const renderedWhere = renderSql(selectChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_annotations"."user_id" = $');
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type" in');
      expect(renderedWhere?.params).toEqual([42, 'ebook']);
    });

    it('returns no source-backed annotation by offset without querying when media filter is empty', async () => {
      await expect(repo.getUserCatalogAnnotationByOffset(42, 3, undefined, [])).resolves.toBeNull();

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('upsertSettings', () => {
    it('inserts the default profile and updates on profile-key conflict', async () => {
      const data = {
        enabled: true,
        baseUrl: 'https://catalog-source.example.test',
        apiKeyEncrypted: 'ciphertext',
        apiKeyNonce: 'nonce',
        apiKeyTag: 'tag',
        syncCadenceMinutes: 360,
        lastConnectionStatus: 'untested' as const,
        lastConnectionCheckedAt: null,
        lastConnectionError: null,
      };

      await repo.upsertSettings(data);

      expect(db.insert).toHaveBeenCalledWith(schema.warehouseSettings);
      expect(db._chains.settingsInsert.values).toHaveBeenCalledWith({ profileKey: 'default', ...data });
      expect(db._chains.settingsInsert.onConflictDoUpdate).toHaveBeenCalledWith({
        target: schema.warehouseSettings.profileKey,
        set: data,
      });
    });
  });

  describe('updateConnectionStatus', () => {
    it('updates the default profile connection fields', async () => {
      const checkedAt = new Date('2026-02-03T04:05:06.000Z');

      await repo.updateConnectionStatus('error', checkedAt, 'Connection failed');

      expect(db.update).toHaveBeenCalledWith(schema.warehouseSettings);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith({
        lastConnectionStatus: 'error',
        lastConnectionCheckedAt: checkedAt,
        lastConnectionError: 'Connection failed',
      });
      expect(db._chains.updateChain.where).toHaveBeenCalledWith(expect.anything());
    });
  });

  describe('createSyncRun', () => {
    it('inserts a running sync row and returns it', async () => {
      const row = {
        id: 77,
        mediaType: 'ebook' as const,
        status: 'running' as const,
        startedAt: new Date('2026-06-02T10:00:00.000Z'),
        finishedAt: null,
        fetchedCount: 0,
        savedCount: 0,
        errorMessage: null,
        timings: {},
      };
      db._chains.syncRunInsert.returning.mockResolvedValue([row]);

      await expect(repo.createSyncRun('ebook', { ownerToken: 123 })).resolves.toEqual(row);

      expect(db.insert).toHaveBeenCalledWith(schema.warehouseCatalogSyncRuns);
      expect(db._chains.syncRunInsert.values).toHaveBeenCalledWith({
        mediaType: 'ebook',
        status: 'running',
        timings: { ownerToken: 123 },
      });
      expect(db._chains.syncRunInsert.returning).toHaveBeenCalledTimes(1);
    });
  });

  describe('completeSyncRun', () => {
    it('marks a sync run as completed with counts and timings', async () => {
      await repo.completeSyncRun(77, { fetchedCount: 120, savedCount: 118 }, { fetchMs: 3450, saveMs: 980 });

      expect(db.update).toHaveBeenCalledWith(schema.warehouseCatalogSyncRuns);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith({
        status: 'completed',
        finishedAt: expect.any(Date),
        fetchedCount: 120,
        savedCount: 118,
        timings: { fetchMs: 3450, saveMs: 980 },
      });
      expect(db._chains.updateChain.where).toHaveBeenCalledWith(expect.anything());
    });
  });

  describe('updateSyncRunProgress', () => {
    it('updates running sync counts without marking the run finished', async () => {
      await repo.updateSyncRunProgress(77, { fetchedCount: 100, savedCount: 98 }, { lastProgressAtMs: 456 });

      expect(db.update).toHaveBeenCalledWith(schema.warehouseCatalogSyncRuns);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith({
        fetchedCount: 100,
        savedCount: 98,
        timings: { lastProgressAtMs: 456 },
      });
      expect(db._chains.updateChain.where).toHaveBeenCalledWith(expect.anything());
    });
  });

  describe('failSyncRun', () => {
    it('marks a sync run as failed with a sanitized error message and optional fields', async () => {
      await repo.failSyncRun(
        88,
        'boom\nhttps://catalog-source.example.test/books?apiKey=secret',
        { fetchedCount: 12, savedCount: 5 },
        { fetchMs: 2000 },
      );

      expect(db.update).toHaveBeenCalledWith(schema.warehouseCatalogSyncRuns);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith({
        status: 'failed',
        finishedAt: expect.any(Date),
        errorMessage: 'boom [redacted-url]',
        fetchedCount: 12,
        savedCount: 5,
        timings: { fetchMs: 2000 },
      });
      expect(db._chains.updateChain.where).toHaveBeenCalledWith(expect.anything());
    });
  });

  describe('findLatestSyncRun', () => {
    it('loads the newest run overall when no media filter is provided', async () => {
      const row = { id: 9, mediaType: 'mixed' };
      db.query.warehouseCatalogSyncRuns.findFirst.mockResolvedValue(row);

      await expect(repo.findLatestSyncRun()).resolves.toEqual(row);

      const args = db.query.warehouseCatalogSyncRuns.findFirst.mock.calls[0]?.[0];
      expect(args.where).toBeUndefined();
      expect(args.orderBy({ startedAt: 'startedAt', id: 'id' }, { desc: (value: string) => `desc(${value})` })).toEqual([
        'desc(startedAt)',
        'desc(id)',
      ]);
    });

    it('applies the media filter when provided', async () => {
      db.query.warehouseCatalogSyncRuns.findFirst.mockResolvedValue(null);

      await repo.findLatestSyncRun('ebook');

      const args = db.query.warehouseCatalogSyncRuns.findFirst.mock.calls[0]?.[0];
      const where = renderSql(args.where);

      expect(args).toEqual(
        expect.objectContaining({
          where: expect.anything(),
          orderBy: expect.any(Function),
        }),
      );
      expect(where?.sql).toContain('"warehouse_catalog_sync_runs"."media_type"');
      expect(where?.params).toEqual(['ebook']);
    });
  });

  describe('findRunningSyncRun', () => {
    it('loads the newest running run regardless of media type', async () => {
      const row = { id: 12, mediaType: 'ebook', status: 'running' };
      db.query.warehouseCatalogSyncRuns.findFirst.mockResolvedValue(row);

      await expect(repo.findRunningSyncRun()).resolves.toEqual(row);

      const args = db.query.warehouseCatalogSyncRuns.findFirst.mock.calls[0]?.[0];
      const where = renderSql(args.where);

      expect(args).toEqual(
        expect.objectContaining({
          where: expect.anything(),
          orderBy: expect.any(Function),
        }),
      );
      expect(where?.sql).toContain('"warehouse_catalog_sync_runs"."status"');
      expect(where?.params).toEqual(['running']);
      expect(args.orderBy({ startedAt: 'startedAt', id: 'id' }, { desc: (value: string) => `desc(${value})` })).toEqual([
        'desc(startedAt)',
        'desc(id)',
      ]);
    });
  });

  describe('listRunningSyncRuns', () => {
    it('loads running runs newest first', async () => {
      const rows = [
        { id: 12, mediaType: 'ebook', status: 'running' },
        { id: 10, mediaType: 'audiobook', status: 'running' },
      ];
      db.query.warehouseCatalogSyncRuns.findMany.mockResolvedValue(rows);

      await expect(repo.listRunningSyncRuns()).resolves.toEqual(rows);

      const args = db.query.warehouseCatalogSyncRuns.findMany.mock.calls[0]?.[0];
      const where = renderSql(args.where);

      expect(args).toEqual(
        expect.objectContaining({
          where: expect.anything(),
          orderBy: expect.any(Function),
        }),
      );
      expect(where?.sql).toContain('"warehouse_catalog_sync_runs"."status"');
      expect(where?.params).toEqual(['running']);
      expect(args.orderBy({ startedAt: 'startedAt', id: 'id' }, { desc: (value: string) => `desc(${value})` })).toEqual([
        'desc(startedAt)',
        'desc(id)',
      ]);
    });
  });

  describe('upsertCatalogItems', () => {
    it('returns 0 without hitting the database when no items are provided', async () => {
      await expect(repo.upsertCatalogItems([])).resolves.toBe(0);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('upserts by media type and remote id and returns the saved count', async () => {
      const items = [
        {
          mediaType: 'ebook' as const,
          remoteId: 'bk-1',
          title: 'Dune',
          subtitle: null,
          sortTitle: 'Dune',
          authors: ['Herbert, Frank; Brian Herbert and Kevin J. Anderson'],
          narrators: [],
          series: 'Dune',
          genres: ['Sci-Fi'],
          tags: ['classic'],
          language: 'en',
          publisher: 'Ace',
          identifiers: { isbn13: '9780441172719' },
          format: 'epub',
          hasCover: true,
          upstreamCreatedAt: null,
          upstreamUpdatedAt: null,
          rawPayload: { id: 'bk-1' },
          syncedAt: new Date('2026-06-02T12:00:00.000Z'),
        },
      ];

      await expect(repo.upsertCatalogItems(items)).resolves.toBe(1);

      expect(db.insert).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(db._chains.catalogItemInsert.values).toHaveBeenCalledWith(items);
      expect(db._chains.catalogItemInsert.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: [schema.warehouseCatalogItems.mediaType, schema.warehouseCatalogItems.remoteId],
          set: expect.objectContaining({
            title: expect.anything(),
            subtitle: expect.anything(),
            durationSeconds: expect.anything(),
            rawPayload: expect.anything(),
            syncedAt: expect.anything(),
          }),
        }),
      );
      expect(db.execute).toHaveBeenCalledTimes(1);
      const renderedDelete = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(renderedDelete?.sql).toContain('delete from "warehouse_catalog_item_authors"');
      expect(renderedDelete?.sql).toContain('where ("warehouse_catalog_item_authors"."media_type", "warehouse_catalog_item_authors"."remote_id")');
      expect(renderedDelete?.params).toEqual(expect.arrayContaining(['ebook', 'bk-1']));
      expect(db.insert).toHaveBeenCalledWith(schema.warehouseCatalogItemAuthors);
      expect(db._chains.catalogItemAuthorInsert.values).toHaveBeenCalledWith([
        expect.objectContaining({
          mediaType: 'ebook',
          remoteId: 'bk-1',
          name: 'Frank Herbert',
          canonicalName: 'frank herbert',
          sortOrder: 0,
        }),
        expect.objectContaining({
          mediaType: 'ebook',
          remoteId: 'bk-1',
          name: 'Brian Herbert',
          canonicalName: 'brian herbert',
          sortOrder: 1,
        }),
        expect.objectContaining({
          mediaType: 'ebook',
          remoteId: 'bk-1',
          name: 'Kevin J. Anderson',
          canonicalName: 'kevin j. anderson',
          sortOrder: 2,
        }),
      ]);
      expect(db._chains.catalogItemAuthorInsert.onConflictDoNothing).toHaveBeenCalled();
    });
  });

  describe('findCatalogItem', () => {
    it('looks up a catalog item by media type and remote id', async () => {
      const row = { id: 1, mediaType: 'ebook', remoteId: 'bk-1' };
      db.query.warehouseCatalogItems.findFirst.mockResolvedValue(row);

      await expect(repo.findCatalogItem('ebook', 'bk-1')).resolves.toEqual(row);
      expect(db.query.warehouseCatalogItems.findFirst).toHaveBeenCalledWith({ where: expect.anything() });
    });
  });

  describe('upsertCatalogDetail', () => {
    it('upserts details by media type and remote id', async () => {
      const detail = {
        mediaType: 'ebook' as const,
        remoteId: 'bk-1',
        rawPayload: { title: 'Dune' },
      };

      await repo.upsertCatalogDetail(detail);

      expect(db.insert).toHaveBeenCalledWith(schema.warehouseCatalogDetails);
      expect(db._chains.catalogDetailInsert.values).toHaveBeenCalledWith(detail);
      expect(db._chains.catalogDetailInsert.onConflictDoUpdate).toHaveBeenCalledWith({
        target: [schema.warehouseCatalogDetails.mediaType, schema.warehouseCatalogDetails.remoteId],
        set: {
          rawPayload: expect.anything(),
          fetchedAt: expect.any(Date),
        },
      });
    });
  });

  describe('findCatalogDetail', () => {
    it('looks up a catalog detail row by media type and remote id', async () => {
      const row = { id: 5, mediaType: 'ebook', remoteId: 'bk-1' };
      db.query.warehouseCatalogDetails.findFirst.mockResolvedValue(row);

      await expect(repo.findCatalogDetail('ebook', 'bk-1')).resolves.toEqual(row);
      expect(db.query.warehouseCatalogDetails.findFirst).toHaveBeenCalledWith({ where: expect.anything() });
    });
  });

  describe('user catalog state', () => {
    it('returns default user catalog state when no membership or state rows exist', async () => {
      db.query.warehouseUserItems.findFirst.mockResolvedValue(undefined);
      db.query.warehouseUserState.findFirst.mockResolvedValue(undefined);

      await expect(repo.getUserCatalogState(42, 'ebook', 'bk-1')).resolves.toEqual({
        mediaType: 'ebook',
        remoteId: 'bk-1',
        inLibrary: false,
        favorite: false,
        rating: null,
        readStatus: null,
        progressPercent: null,
        positionSeconds: null,
        finishedAt: null,
        updatedAt: null,
      });

      const itemWhere = db.query.warehouseUserItems.findFirst.mock.calls[0]?.[0].where;
      const stateWhere = db.query.warehouseUserState.findFirst.mock.calls[0]?.[0].where;
      expect(renderSql(itemWhere)?.params).toEqual([42, 'ebook', 'bk-1']);
      expect(renderSql(stateWhere)?.params).toEqual([42, 'ebook', 'bk-1']);
    });

    it('upserts user catalog state membership and personal state without cross-user writes', async () => {
      const itemUpdatedAt = new Date('2026-06-03T10:00:00.000Z');
      const stateUpdatedAt = new Date('2026-06-03T10:05:00.000Z');
      db.query.warehouseUserItems.findFirst.mockResolvedValue({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        updatedAt: itemUpdatedAt,
      });
      db.query.warehouseUserState.findFirst.mockResolvedValue({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        favorite: true,
        rating: 5,
        readStatus: 'reading',
        progressPercent: 12.5,
        positionSeconds: 37,
        finishedAt: null,
        updatedAt: stateUpdatedAt,
      });

      await expect(
        repo.upsertUserCatalogState(42, 'ebook', 'bk-1', {
          inLibrary: true,
          favorite: true,
          rating: 5,
          readStatus: 'reading',
          progressPercent: 12.5,
          positionSeconds: 37,
        }),
      ).resolves.toEqual({
        mediaType: 'ebook',
        remoteId: 'bk-1',
        inLibrary: true,
        favorite: true,
        rating: 5,
        readStatus: 'reading',
        progressPercent: 12.5,
        positionSeconds: 37,
        finishedAt: null,
        updatedAt: stateUpdatedAt,
      });

      expect(db.insert).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(db._chains.userItemInsert.values).toHaveBeenCalledWith({ userId: 42, mediaType: 'ebook', remoteId: 'bk-1' });
      expect(db._chains.userItemInsert.onConflictDoUpdate).toHaveBeenCalledWith({
        target: [schema.warehouseUserItems.userId, schema.warehouseUserItems.mediaType, schema.warehouseUserItems.remoteId],
        set: { updatedAt: expect.any(Date) },
      });
      expect(db.insert).toHaveBeenCalledWith(schema.warehouseUserState);
      expect(db._chains.userStateInsert.values).toHaveBeenCalledWith({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        favorite: true,
        rating: 5,
        readStatus: 'reading',
        progressPercent: 12.5,
        positionSeconds: 37,
        finishedAt: null,
      });
      expect(db._chains.userStateInsert.onConflictDoUpdate).toHaveBeenCalledWith({
        target: [schema.warehouseUserState.userId, schema.warehouseUserState.mediaType, schema.warehouseUserState.remoteId],
        set: {
          favorite: true,
          rating: 5,
          readStatus: 'reading',
          progressPercent: 12.5,
          positionSeconds: 37,
          finishedAt: null,
          updatedAt: expect.any(Date),
        },
      });

      const itemWhere = db.query.warehouseUserItems.findFirst.mock.calls[0]?.[0].where;
      const stateWhere = db.query.warehouseUserState.findFirst.mock.calls[0]?.[0].where;
      expect(renderSql(itemWhere)?.params).toEqual([42, 'ebook', 'bk-1']);
      expect(renderSql(stateWhere)?.params).toEqual([42, 'ebook', 'bk-1']);
      expect(renderSql(itemWhere)?.params).not.toContain(43);
      expect(renderSql(stateWhere)?.params).not.toContain(43);
    });

    it('clearing user catalog state membership does not clear favorite rating or progress', async () => {
      const stateUpdatedAt = new Date('2026-06-03T11:05:00.000Z');
      db.query.warehouseUserItems.findFirst.mockResolvedValue(undefined);
      db.query.warehouseUserState.findFirst.mockResolvedValue({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        favorite: true,
        rating: 4,
        readStatus: 'reading',
        progressPercent: 66.5,
        positionSeconds: 1234,
        finishedAt: null,
        updatedAt: stateUpdatedAt,
      });

      await expect(repo.upsertUserCatalogState(42, 'ebook', 'bk-1', { inLibrary: false })).resolves.toEqual({
        mediaType: 'ebook',
        remoteId: 'bk-1',
        inLibrary: false,
        favorite: true,
        rating: 4,
        readStatus: 'reading',
        progressPercent: 66.5,
        positionSeconds: 1234,
        finishedAt: null,
        updatedAt: stateUpdatedAt,
      });

      expect(db.delete).toHaveBeenCalledWith(schema.warehouseUserItems);
      const deleteWhere = db._chains.userItemDelete.where.mock.calls[0]?.[0];
      expect(renderSql(deleteWhere)?.params).toEqual([42, 'ebook', 'bk-1']);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('normalizes or omits invalid numeric user catalog state values before SQL writes', async () => {
      db.query.warehouseUserItems.findFirst.mockResolvedValue(undefined);
      db.query.warehouseUserState.findFirst.mockResolvedValue(undefined);

      await repo.upsertUserCatalogState(42, 'ebook', 'bk-1', {
        rating: 8.9,
        progressPercent: 140.5,
        positionSeconds: Number.POSITIVE_INFINITY,
      });
      await repo.upsertUserCatalogState(42, 'ebook', 'bk-1', {
        rating: null,
        progressPercent: Number.NaN,
        positionSeconds: -5,
      });

      expect(db._chains.userStateInsert.values.mock.calls[0]?.[0]).toEqual({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        rating: 5,
        progressPercent: 100,
      });
      expect(db._chains.userStateInsert.onConflictDoUpdate.mock.calls[0]?.[0].set).toEqual({
        rating: 5,
        progressPercent: 100,
        updatedAt: expect.any(Date),
      });
      expect(db._chains.userStateInsert.values.mock.calls[1]?.[0]).toEqual({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        rating: null,
        positionSeconds: 0,
      });
      expect(db._chains.userStateInsert.onConflictDoUpdate.mock.calls[1]?.[0].set).toEqual({
        rating: null,
        positionSeconds: 0,
        updatedAt: expect.any(Date),
      });
    });

    it('stamps completed source-backed state once and clears the date when status becomes incomplete', async () => {
      db.query.warehouseUserItems.findFirst.mockResolvedValue(undefined);
      db.query.warehouseUserState.findFirst.mockResolvedValue(undefined);

      await repo.upsertUserCatalogState(42, 'ebook', 'bk-1', { readStatus: 'read', progressPercent: 100 });
      await repo.upsertUserCatalogState(42, 'ebook', 'bk-1', { readStatus: 'reading', progressPercent: 50 });

      const completedValues = db._chains.userStateInsert.values.mock.calls[0]?.[0];
      expect(completedValues).toEqual({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        readStatus: 'read',
        progressPercent: 100,
        finishedAt: expect.any(Date),
      });
      const completedSet = db._chains.userStateInsert.onConflictDoUpdate.mock.calls[0]?.[0].set;
      expect(completedSet).toMatchObject({
        readStatus: 'read',
        progressPercent: 100,
        updatedAt: expect.any(Date),
      });
      expect(renderSql(completedSet.finishedAt)?.sql).toContain('coalesce');
      expect(renderSql(completedSet.finishedAt)?.sql).toContain('"warehouse_user_state"."finished_at"');

      expect(db._chains.userStateInsert.values.mock.calls[1]?.[0]).toEqual({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        readStatus: 'reading',
        progressPercent: 50,
        finishedAt: null,
      });
      expect(db._chains.userStateInsert.onConflictDoUpdate.mock.calls[1]?.[0].set).toEqual({
        readStatus: 'reading',
        progressPercent: 50,
        finishedAt: null,
        updatedAt: expect.any(Date),
      });
    });
  });

  describe('catalog bookmarks', () => {
    it('lists catalog bookmarks by current user and catalog identity', async () => {
      const rows = [{ id: 17, userId: 42, mediaType: 'ebook', remoteId: 'bk-1', cfi: 'epubcfi(/6/8)' }];
      const select = makeSelectChain('orderBy', rows);
      db.select.mockReturnValue(select);

      await expect(repo.findCatalogBookmarks(42, 'ebook', 'bk-1')).resolves.toEqual(rows);
      expect(select.from).toHaveBeenCalledWith(schema.warehouseBookmarks);
      const rendered = renderSql(select.where.mock.calls[0]?.[0]);
      expect(rendered?.params).toEqual([42, 'ebook', 'bk-1']);
    });

    it('finds existing catalog bookmarks by CFI before inserting duplicates', async () => {
      const rows = [{ id: 18, userId: 42, mediaType: 'ebook', remoteId: 'bk-1', cfi: 'epubcfi(/6/8)' }];
      const select = makeSelectChain('limit', rows);
      db.select.mockReturnValue(select);

      await expect(repo.findExistingCatalogBookmarkByLocation(42, 'ebook', 'bk-1', { cfi: 'epubcfi(/6/8)', positionSeconds: null })).resolves.toEqual(
        rows[0],
      );
      const rendered = renderSql(select.where.mock.calls[0]?.[0]);
      expect(rendered?.params).toEqual([42, 'ebook', 'bk-1', 'epubcfi(/6/8)']);
    });

    it('finds existing catalog bookmarks by audio position when no CFI is present', async () => {
      const rows = [{ id: 19, userId: 42, mediaType: 'audiobook', remoteId: 'audio-1', cfi: null, positionSeconds: 91.5 }];
      const select = makeSelectChain('limit', rows);
      db.select.mockReturnValue(select);

      await expect(repo.findExistingCatalogBookmarkByLocation(42, 'audiobook', 'audio-1', { cfi: null, positionSeconds: 91.5 })).resolves.toEqual(
        rows[0],
      );
      const rendered = renderSql(select.where.mock.calls[0]?.[0]);
      expect(rendered?.params).toEqual([42, 'audiobook', 'audio-1', 91.5]);
      expect(rendered?.sql).toContain('"cfi" is null');
    });

    it('creates catalog bookmarks without overwriting conflict winners', async () => {
      const row = { id: 20, userId: 42, mediaType: 'ebook' as const, remoteId: 'bk-1', cfi: 'epubcfi(/6/8)', title: 'Chapter 2' };
      db._chains.bookmarkInsert.returning.mockResolvedValue([row]);

      await expect(
        repo.createCatalogBookmark(42, 'ebook', 'bk-1', { cfi: 'epubcfi(/6/8)', title: 'Chapter 2', positionSeconds: null }),
      ).resolves.toEqual(row);
      expect(db.insert).toHaveBeenCalledWith(schema.warehouseBookmarks);
      expect(db._chains.bookmarkInsert.values).toHaveBeenCalledWith({
        userId: 42,
        mediaType: 'ebook',
        remoteId: 'bk-1',
        cfi: 'epubcfi(/6/8)',
        title: 'Chapter 2',
        positionSeconds: null,
      });
      expect(db._chains.bookmarkInsert.onConflictDoNothing).toHaveBeenCalled();
    });

    it('deletes catalog bookmarks only inside the current user catalog scope', async () => {
      db._chains.bookmarkDelete.returning.mockResolvedValue([{ id: 17 }]);

      await expect(repo.deleteCatalogBookmark(42, 'ebook', 'bk-1', 17)).resolves.toBe(true);
      const rendered = renderSql(db._chains.bookmarkDelete.where.mock.calls[0]?.[0]);
      expect(rendered?.params).toEqual([17, 42, 'ebook', 'bk-1']);
    });
  });

  describe('createRequestMirror', () => {
    it('inserts an ebook request mirror for the user with normalized status and sanitized payload', async () => {
      const row = {
        id: 9,
        userId: 42,
        mediaType: 'ebook' as const,
        upstreamRequestId: 'up-1',
        status: 'processing' as const,
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        requestedPayload: { isbn: '9780441172719' },
        completedRemoteId: null,
        lastStatusSyncedAt: null,
      };
      db._chains.requestInsert.returning.mockResolvedValue([row]);

      await expect(
        repo.createRequestMirror({
          userId: 42,
          upstreamRequestId: 'up-1',
          status: 'In Progress',
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: '9780441172719',
          requestedPayload: {
            isbn: '9780441172719',
            preferredFormat: 'epub',
            baseUrl: 'https://book-warehouse.example.test',
            apiKey: 'secret',
            authorization: 'Bearer secret',
            searchResult: {
              title: 'Dune',
              source: 'open_library',
              sourceName: 'Open Library',
              url: 'https://book-warehouse.example.test/search',
            },
          },
        }),
      ).resolves.toEqual(row);

      expect(db.insert).toHaveBeenCalledWith(schema.warehouseRequests);
      expect(db._chains.requestInsert.values).toHaveBeenCalledWith({
        userId: 42,
        mediaType: 'ebook',
        upstreamRequestId: 'up-1',
        status: 'processing',
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        requestedPayload: {
          isbn: '9780441172719',
          preferredFormat: 'epub',
          searchResult: {
            title: 'Dune',
          },
        },
        completedRemoteId: null,
        lastStatusSyncedAt: null,
      });
      expect(db._chains.requestInsert.returning).toHaveBeenCalledTimes(1);
    });

    it('drops secret, provider, and error payload data while preserving safe request summary fields', async () => {
      const row = {
        id: 10,
        userId: 42,
        mediaType: 'ebook' as const,
        upstreamRequestId: 'up-2',
        status: 'pending' as const,
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        requestedPayload: {},
        completedRemoteId: null,
        lastStatusSyncedAt: null,
      };
      db._chains.requestInsert.returning.mockResolvedValue([row]);

      await repo.createRequestMirror({
        userId: 42,
        upstreamRequestId: 'up-2',
        status: 'pending',
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
        requestedPayload: {
          isbn: '9780441172719',
          title: 'Dune',
          author: 'Frank Herbert',
          preferredFormat: 'epub',
          token: 'secret-token',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          secret: 'secret',
          password: 'password',
          key: 'vendor-client-id',
          header: { vendor: 'warehouse-x' },
          headers: { authorization: 'Bearer secret' },
          authorization: 'Bearer secret',
          provider: { name: 'vendor', baseUrl: 'vendor.example.test' },
          providerName: 'Open Library',
          upstream: { sourceUrl: 'https://vendor.example.test/books/1' },
          warehouseName: 'Book Warehouse',
          thirdPartyLabel: 'Hardcover',
          error: { message: 'failed', stack: 'stack trace' },
          errors: [{ message: 'failed' }],
          raw: { anything: true },
          rawResponse: { status: 500 },
          url: 'https://vendor.example.test/books/1',
          uri: 'vendor.example.test/books/1',
          hostValue: 'api.vendor.example.test',
          bearerNote: 'Bearer abcdef',
          apiKeyNote: 'api key abcdef',
          opaqueValue: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH',
          related: [
            [
              {
                title: 'Nested Dune',
                source: 'open_library',
                url: 'https://vendor.example.test/nested',
                header: { vendor: 'warehouse-x' },
              },
              'safe note',
              'https://vendor.example.test/leak',
            ],
          ],
          searchResult: {
            isbn: '9780441172719',
            title: 'Dune',
            author: 'Frank Herbert',
            source: 'open_library',
            sourceId: 'open-library',
            sourceLabel: 'Open Library',
            sourceDisplayName: 'Open Library',
            sourceProviderName: 'Hardcover',
            preferredFormat: 'epub',
            message: 'provider failure',
            url: 'https://vendor.example.test/search',
            headers: { authorization: 'Bearer nested' },
            rawResponse: { status: 500 },
          },
        },
      });

      expect(db._chains.requestInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedPayload: {
            isbn: '9780441172719',
            title: 'Dune',
            author: 'Frank Herbert',
            preferredFormat: 'epub',
            related: [[{ title: 'Nested Dune' }, 'safe note']],
            searchResult: {
              isbn: '9780441172719',
              title: 'Dune',
              author: 'Frank Herbert',
              preferredFormat: 'epub',
            },
          },
        }),
      );
    });
  });

  describe('upsertRequestMirror', () => {
    it('updates the existing row when an upstream request id is already mirrored', async () => {
      const existing = { id: 123, upstreamRequestId: 'up-1' };
      const updated = { ...existing, status: 'completed' };
      db.query.warehouseRequests.findFirst.mockResolvedValue(existing);
      db._chains.updateChain.returning.mockResolvedValue([updated]);

      await expect(
        repo.upsertRequestMirror({
          userId: 42,
          upstreamRequestId: 'up-1',
          status: 'success',
          title: 'Dune',
        }),
      ).resolves.toEqual(updated);

      expect(db.insert).not.toHaveBeenCalledWith(schema.warehouseRequests);
      expect(db.update).toHaveBeenCalledWith(schema.warehouseRequests);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          title: 'Dune',
        }),
      );
      const renderedWhere = renderSql(db._chains.updateChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedWhere?.params).toEqual([123, 42, 'ebook']);
    });

    it('scopes upstream request id upserts to the requesting user and media type', async () => {
      const existing = { id: 123, userId: 42, mediaType: 'audiobook', upstreamRequestId: 'up-1' };
      const updated = { ...existing, status: 'completed' };
      db.query.warehouseRequests.findFirst.mockResolvedValue(existing);
      db._chains.updateChain.returning.mockResolvedValue([updated]);

      await expect(
        repo.upsertRequestMirror({
          userId: 42,
          mediaType: 'audiobook',
          upstreamRequestId: 'up-1',
          status: 'success',
          title: 'Dune',
        }),
      ).resolves.toEqual(updated);

      const findArgs = db.query.warehouseRequests.findFirst.mock.calls[0]?.[0];
      const renderedFindWhere = renderSql(findArgs.where);
      expect(renderedFindWhere?.sql).toContain('"warehouse_requests"."upstream_request_id"');
      expect(renderedFindWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedFindWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedFindWhere?.params).toEqual(['up-1', 42, 'audiobook']);

      const renderedUpdateWhere = renderSql(db._chains.updateChain.where.mock.calls[0]?.[0]);
      expect(renderedUpdateWhere?.sql).toContain('"warehouse_requests"."id"');
      expect(renderedUpdateWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedUpdateWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedUpdateWhere?.params).toEqual([123, 42, 'audiobook']);
    });

    it('scopes local id upserts to the requesting user and default media type', async () => {
      const updated = { id: 123, userId: 42, mediaType: 'ebook', status: 'completed' };
      db._chains.updateChain.returning.mockResolvedValue([updated]);

      await expect(
        repo.upsertRequestMirror({
          id: 123,
          userId: 42,
          status: 'success',
          title: 'Dune',
        }),
      ).resolves.toEqual(updated);

      expect(db.query.warehouseRequests.findFirst).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalledWith(schema.warehouseRequests);
      const renderedWhere = renderSql(db._chains.updateChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedWhere?.params).toEqual([123, 42, 'ebook']);
    });
  });

  describe('listRequestsForUser', () => {
    it('filters by user id, default ebook media type, status, and paginates newest first', async () => {
      const rows = [{ id: 2, userId: 42, mediaType: 'ebook', status: 'pending', title: 'Dune' }];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(repo.listRequestsForUser(42, { status: 'pending', page: 2, limit: 5 })).resolves.toEqual({
        rows,
        total: 1,
        page: 2,
        limit: 5,
      });

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseRequests);
      const rowWhere = listChain.where.mock.calls[0]?.[0];
      const renderedWhere = renderSql(rowWhere);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."status"');
      expect(renderedWhere?.params).toEqual([42, 'ebook', 'pending']);
      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_requests"."created_at" desc');
      expect(listChain.limit).toHaveBeenCalledWith(5);
      expect(listChain.offset).toHaveBeenCalledWith(5);
      expect(countChain.where).toHaveBeenCalledWith(rowWhere);
    });
  });

  describe('listRequestMirrorsForSync request sync', () => {
    it('renders request sync candidate SQL with ownership, upstream, open status, stale, and optional media filters', async () => {
      const staleBefore = new Date('2026-06-03T12:00:00.000Z');
      const unfilteredChain = makeSelectChain('limit', [{ id: 1 }]);
      const mediaChain = makeSelectChain('limit', []);
      db.select.mockReturnValueOnce(unfilteredChain).mockReturnValueOnce(mediaChain);

      await repo.listRequestMirrorsForSync({ staleBefore });
      await repo.listRequestMirrorsForSync({ mediaType: 'audiobook', staleBefore });

      const renderedUnfilteredWhere = renderSql(unfilteredChain.where.mock.calls[0]?.[0]);
      expect(renderedUnfilteredWhere?.sql).toContain('"warehouse_requests"."user_id" is not null');
      expect(renderedUnfilteredWhere?.sql).toContain('"warehouse_requests"."upstream_request_id" is not null');
      expect(renderedUnfilteredWhere?.sql).toContain('nullif(trim');
      expect(renderedUnfilteredWhere?.sql).toContain('"warehouse_requests"."status" in');
      expect(renderedUnfilteredWhere?.sql).toContain('"warehouse_requests"."last_status_synced_at" is null');
      expect(renderedUnfilteredWhere?.sql).toContain('"warehouse_requests"."last_status_synced_at" <');
      expect(renderedUnfilteredWhere?.sql).toContain(' or ');
      expect(renderedUnfilteredWhere?.sql).not.toContain('"warehouse_requests"."media_type"');
      expect(renderedUnfilteredWhere?.params).toEqual(['pending', 'processing', 'unknown', staleBefore.toISOString()]);
      expect(renderedUnfilteredWhere?.params).not.toContain('completed');
      expect(renderedUnfilteredWhere?.params).not.toContain('failed');
      expect(renderedUnfilteredWhere?.params).not.toContain('cancelled');

      const renderedMediaWhere = renderSql(mediaChain.where.mock.calls[0]?.[0]);
      expect(renderedMediaWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedMediaWhere?.params).toEqual(['pending', 'processing', 'unknown', 'audiobook', staleBefore.toISOString()]);
    });

    it('caps request sync candidate limit at 100 and orders stale rows first', async () => {
      const rows = [{ id: 2 }];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRequestMirrorsForSync({ limit: 999 })).resolves.toEqual(rows);

      expect(listChain.limit).toHaveBeenCalledWith(100);
      expect(listChain.orderBy).toHaveBeenCalledWith(expect.anything(), expect.anything());
      const [staleOrder, idOrder] = listChain.orderBy.mock.calls[0] ?? [];
      expect(renderSql(staleOrder)?.sql).toContain('"warehouse_requests"."last_status_synced_at" asc nulls first');
      expect(renderSql(idOrder)?.sql).toContain('"warehouse_requests"."id" asc');
    });

    it('normalizes blank upstream request ids to null before inserting or updating mirrors', async () => {
      db._chains.requestInsert.returning.mockResolvedValue([{ id: 99 }]);
      db._chains.updateChain.returning.mockResolvedValue([{ id: 99 }]);

      await repo.createRequestMirror({
        userId: 42,
        upstreamRequestId: '   ',
        status: 'pending',
        title: 'Dune',
      });
      await repo.updateRequestMirror(99, { userId: 42, mediaType: 'ebook' }, { upstreamRequestId: '   ' });

      expect(db._chains.requestInsert.values).toHaveBeenCalledWith(expect.objectContaining({ upstreamRequestId: null }));
      expect(db._chains.updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ upstreamRequestId: null }));
    });
  });

  describe('findRequestForUser', () => {
    it('looks up a request by local id and requesting user id', async () => {
      const row = { id: 5, userId: 42 };
      db.query.warehouseRequests.findFirst.mockResolvedValue(row);

      await expect(repo.findRequestForUser(5, 42)).resolves.toEqual(row);

      const args = db.query.warehouseRequests.findFirst.mock.calls[0]?.[0];
      const renderedWhere = renderSql(args.where);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.params).toEqual([5, 42]);
    });
  });

  describe('findRequestByUpstreamId', () => {
    it('looks up a request by upstream request id, user id, and default media type', async () => {
      const row = { id: 5, userId: 42, mediaType: 'ebook', upstreamRequestId: 'up-1' };
      db.query.warehouseRequests.findFirst.mockResolvedValue(row);

      await expect(repo.findRequestByUpstreamId('up-1', { userId: 42 })).resolves.toEqual(row);

      const args = db.query.warehouseRequests.findFirst.mock.calls[0]?.[0];
      const renderedWhere = renderSql(args.where);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."upstream_request_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedWhere?.params).toEqual(['up-1', 42, 'ebook']);
    });
  });

  describe('updateRequestMirror', () => {
    it('updates status, completed remote id, payload, and last status sync timestamp for the scoped user row', async () => {
      const syncedAt = new Date('2026-06-03T12:00:00.000Z');
      const row = { id: 5, status: 'completed', lastStatusSyncedAt: syncedAt };
      db._chains.updateChain.returning.mockResolvedValue([row]);

      await expect(
        repo.updateRequestMirror(
          5,
          { userId: 42 },
          {
            status: 'succeeded',
            completedRemoteId: 'remote-1',
            requestedPayload: { isbn: '9780441172719', upstreamUrl: 'https://book-warehouse.example.test' },
            lastStatusSyncedAt: syncedAt,
          },
        ),
      ).resolves.toEqual(row);

      expect(db.update).toHaveBeenCalledWith(schema.warehouseRequests);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith({
        status: 'completed',
        completedRemoteId: 'remote-1',
        requestedPayload: { isbn: '9780441172719' },
        lastStatusSyncedAt: syncedAt,
      });
      const renderedWhere = renderSql(db._chains.updateChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedWhere?.params).toEqual([5, 42, 'ebook']);
    });

    it('claims only open request mirrors for terminal transition side effects', async () => {
      const syncedAt = new Date('2026-06-03T12:00:00.000Z');
      const row = { id: 5, status: 'completed', lastStatusSyncedAt: syncedAt };
      db._chains.updateChain.returning.mockResolvedValue([row]);

      await expect(
        repo.updateOpenRequestMirror(5, { userId: 42, mediaType: 'audiobook' }, { status: 'available', lastStatusSyncedAt: syncedAt }),
      ).resolves.toEqual(row);

      expect(db.update).toHaveBeenCalledWith(schema.warehouseRequests);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith({
        status: 'completed',
        lastStatusSyncedAt: syncedAt,
      });
      const renderedWhere = renderSql(db._chains.updateChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."status" in');
      expect(renderedWhere?.params).toEqual([5, 42, 'audiobook', 'pending', 'processing', 'unknown']);
    });
  });

  describe('deleteRequestMirror', () => {
    it('marks only the requesting user row as cancelled', async () => {
      const row = { id: 5, userId: 42, status: 'cancelled' };
      db._chains.updateChain.returning.mockResolvedValue([row]);

      await expect(repo.deleteRequestMirror(5, 42)).resolves.toEqual(row);

      expect(db.update).toHaveBeenCalledWith(schema.warehouseRequests);
      expect(db._chains.updateChain.set).toHaveBeenCalledWith({ status: 'cancelled' });
      const renderedWhere = renderSql(db._chains.updateChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."id"');
      expect(renderedWhere?.sql).toContain('"warehouse_requests"."user_id"');
      expect(renderedWhere?.params).toEqual([5, 42]);
    });
  });

  describe('user catalog items', () => {
    it('joins user catalog items on media and remote id and caps the limit at 100', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Dune Audio',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listUserCatalogItems(42, 'audiobook', 999)).resolves.toEqual(rows);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(listChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      const renderedJoin = renderSql(listChain.innerJoin.mock.calls[0]?.[1]);
      expect(renderedJoin?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(renderedJoin?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedJoin?.sql).toContain('"warehouse_user_items"."remote_id"');
      expect(renderedJoin?.sql).toContain('"warehouse_catalog_items"."remote_id"');

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(renderedWhere?.params).toEqual([42, 'audiobook']);

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_items"."updated_at" desc');
      expect(listChain.limit).toHaveBeenCalledWith(100);
    });

    it('finds one user-owned catalog item by local id through the media-aware ownership join', async () => {
      const rows = [
        {
          id: 33,
          mediaType: 'audiobook',
          remoteId: 'audio-33',
          title: 'Owned Audio',
        },
      ];
      const findChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(findChain);

      await expect(repo.findUserCatalogItemById(7, 'audiobook', 33)).resolves.toEqual(rows[0]);

      expect(findChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(findChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      const renderedJoin = renderSql(findChain.innerJoin.mock.calls[0]?.[1]);
      expect(renderedJoin?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(renderedJoin?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedJoin?.sql).toContain('"warehouse_user_items"."remote_id"');
      expect(renderedJoin?.sql).toContain('"warehouse_catalog_items"."remote_id"');

      const renderedWhere = renderSql(findChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."id"');
      expect(renderedWhere?.params).toEqual([7, 'audiobook', 33]);
      expect(findChain.limit).toHaveBeenCalledWith(1);
    });

    it('finds one cached catalog item by local id without requiring a user ownership row', async () => {
      const rows = [
        {
          id: 33,
          mediaType: 'audiobook',
          remoteId: 'audio-33',
          title: 'Cached Audio',
        },
      ];
      const findChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(findChain);

      await expect(repo.findCatalogItemById('audiobook', 33)).resolves.toEqual(rows[0]);

      expect(findChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(findChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      const renderedWhere = renderSql(findChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."id"');
      expect(renderedWhere?.params).toEqual(['audiobook', 33]);
      expect(findChain.limit).toHaveBeenCalledWith(1);
    });

    it('lists recent user catalog items across media types by owned item recency', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
        {
          id: 2,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Dune Audio',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRecentUserCatalogItems(42, 999)).resolves.toEqual(rows);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(listChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(db.select).toHaveBeenCalledWith(
        expect.objectContaining({
          userItemUpdatedAt: schema.warehouseUserItems.updatedAt,
        }),
      );

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.params).toEqual([42]);

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_items"."updated_at" desc');
      expect(listChain.limit).toHaveBeenCalledWith(100);
    });

    it('applies content filters when listing recent user catalog items', async () => {
      const listChain = makeSelectChain('limit', []);
      db.select.mockReturnValueOnce(listChain);

      await expect(
        repo.listRecentUserCatalogItems(42, 12, {
          includeTagIds: [],
          excludeTagIds: [],
          includeGenreIds: [3],
          excludeGenreIds: [8],
        }),
      ).resolves.toEqual([]);

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"genres"."id" in ($2)');
      expect(renderedWhere?.sql).toContain('not exists');
      expect(renderedWhere?.params).toEqual([42, 3, 8]);
    });

    it('filters recent user catalog items by source-backed media library when requested', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Dune Audio',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRecentUserCatalogItems(42, 20, undefined, ['audiobook'])).resolves.toEqual(rows);

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type" in');
      expect(renderedWhere?.params).toEqual([42, 'audiobook']);
    });

    it('returns no recent user catalog rows without querying when media filter is empty', async () => {
      await expect(repo.listRecentUserCatalogItems(42, 20, undefined, [])).resolves.toEqual([]);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('lists recent cached catalog items by upstream recency with missing dates last', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRecentCatalogItems(999, undefined, ['ebook'])).resolves.toEqual(rows);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(listChain.innerJoin).not.toHaveBeenCalled();
      expect(db.select).toHaveBeenCalledWith(expect.objectContaining({ id: schema.warehouseCatalogItems.id }));

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type" in ($1)');
      expect(renderedWhere?.params).toEqual(['ebook']);

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."upstream_created_at"');
      expect(renderedOrder?.sql).toContain('desc nulls last');
      expect(listChain.limit).toHaveBeenCalledWith(100);
    });

    it('short-circuits recent cached catalog items when no source-backed media types are accessible', async () => {
      await expect(repo.listRecentCatalogItems(12, undefined, [])).resolves.toEqual([]);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('lists random user catalog items across media types for discovery shelves', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRandomUserCatalogItems(42, 999)).resolves.toEqual(rows);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(listChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(listChain.leftJoin).not.toHaveBeenCalled();

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).not.toContain('warehouse_user_state');
      expect(renderedWhere?.params).toEqual([42]);

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('random()');
      expect(listChain.limit).toHaveBeenCalledWith(100);
    });

    it('filters random user catalog items by source-backed media library when requested', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRandomUserCatalogItems(42, 20, undefined, ['ebook'])).resolves.toEqual(rows);

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type" in');
      expect(renderedWhere?.params).toEqual([42, 'ebook']);
    });

    it('filters normal random catalog scroller rows to unstarted source-backed items', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRandomUserCatalogItems(42, 20, undefined, ['ebook'], { onlyUnstarted: true })).resolves.toEqual(rows);

      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());
      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."progress_percent" is null');
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."progress_percent" = $');
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."read_status" is null');
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."read_status" in');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, 0, 'unread', 'want_to_read', 'ebook']));
    });

    it('returns no random catalog rows without querying when media filter is empty', async () => {
      await expect(repo.listRandomUserCatalogItems(42, 20, undefined, [])).resolves.toEqual([]);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('lists random cached catalog items by media filter without user membership rows', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(listChain);

      await expect(repo.listRandomCatalogItems(999, undefined, ['ebook'])).resolves.toEqual(rows);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(listChain.innerJoin).not.toHaveBeenCalled();
      expect(db.select).toHaveBeenCalledWith(expect.objectContaining({ id: schema.warehouseCatalogItems.id }));

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type" in ($1)');
      expect(renderedWhere?.params).toEqual(['ebook']);

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('random()');
      expect(listChain.limit).toHaveBeenCalledWith(100);
    });

    it('returns no random cached catalog rows without querying when media filter is empty', async () => {
      await expect(repo.listRandomCatalogItems(20, undefined, [])).resolves.toEqual([]);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('counts random user catalog candidates with optional media and content filters', async () => {
      const countChain = makeSelectChain('where', [{ total: 6 }]);
      db.select.mockReturnValueOnce(countChain);

      await expect(
        repo.countRandomUserCatalogItems(
          42,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [],
          },
          ['ebook'],
        ),
      ).resolves.toBe(6);

      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(countChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(countChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());

      const renderedWhere = renderSql(countChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type" in');
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."progress_percent" is null');
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."read_status" in');
      expect(renderedWhere?.sql).toContain('from "tags"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, 0, 'unread', 'want_to_read', 'ebook', 7]));
    });

    it('returns zero random catalog candidate count without querying when media filter is empty', async () => {
      await expect(repo.countRandomUserCatalogItems(42, undefined, [])).resolves.toBe(0);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('lists source-backed up-next-in-series candidates using user state and promoted series order', async () => {
      const rows = [
        {
          id: 2,
          mediaType: 'ebook',
          remoteId: 'ebook-2',
          title: 'Dune Messiah',
          series: 'Dune',
          seriesIndex: 2,
          previousCompletionUpdatedAt: new Date('2026-01-04T00:00:00.000Z'),
        },
      ];
      db.execute.mockResolvedValue({ rows });

      await expect(
        repo.listUpNextInSeriesUserCatalogItems(
          42,
          20,
          {
            includeTagIds: [7],
            excludeTagIds: [],
            includeGenreIds: [],
            excludeGenreIds: [],
          },
          ['ebook'],
        ),
      ).resolves.toEqual(rows);

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      expect(rendered?.sql).toContain('warehouse_user_items');
      expect(rendered?.sql).toContain('warehouse_catalog_items');
      expect(rendered?.sql).toContain('warehouse_user_state');
      expect(rendered?.sql).toContain('"series_index" is not null');
      expect(rendered?.sql).toContain('partition by');
      expect(rendered?.sql).toContain('lag');
      expect(rendered?.sql).toContain("\"read_status\" in ('read', 'skimmed')");
      expect(rendered?.sql).toContain('"progress_percent", 0) >= 100');
      expect(rendered?.sql).toContain('current_progress = 0');
      expect(rendered?.sql).toContain('from "tags"');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'ebook', 7, 20]));
    });

    it('returns no up-next-in-series catalog rows without querying when media filter is empty', async () => {
      await expect(repo.listUpNextInSeriesUserCatalogItems(42, 20, undefined, [])).resolves.toEqual([]);

      expect(db.execute).not.toHaveBeenCalled();
    });

    it('searches only the current user owned catalog items across requested media types and content filters', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
        {
          id: 2,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Dune Audio',
        },
      ];
      const searchChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(searchChain);

      await expect(
        repo.searchUserCatalogItems(
          42,
          'dune',
          999,
          {
            includeTagIds: [101],
            excludeTagIds: [202],
            includeGenreIds: [],
            excludeGenreIds: [],
          },
          ['ebook'],
        ),
      ).resolves.toEqual(rows);

      expect(searchChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(searchChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());

      const renderedWhere = renderSql(searchChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title" ilike');
      expect(renderedWhere?.sql).toContain('from "warehouse_catalog_item_authors"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_item_authors"."name" ilike');
      expect(renderedWhere?.sql).not.toContain('jsonb_array_elements_text("warehouse_catalog_items"."authors")');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."narrators"');
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."media_type"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, '%dune%']));
      expect(renderedWhere?.params).toContain('ebook');
      expect(renderedWhere?.params).not.toContain('audiobook');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([101, 202]));

      const renderedOrder = renderSql(searchChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title")');
      expect(searchChain.limit).toHaveBeenCalledWith(100);
    });

    it('returns no owned catalog search rows without querying when media filter is empty', async () => {
      await expect(repo.searchUserCatalogItems(42, 'dune', 20, undefined, [])).resolves.toEqual([]);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('searches synced catalog library items across media types without user ownership', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
        {
          id: 2,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Dune Audio',
        },
      ];
      const searchChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(searchChain);

      await expect(repo.searchCatalogItems('dune', 999, undefined, ['ebook'])).resolves.toEqual(rows);

      expect(searchChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(searchChain.innerJoin).not.toHaveBeenCalled();

      const renderedWhere = renderSql(searchChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title" ilike');
      expect(renderedWhere?.sql).toContain('from "warehouse_catalog_item_authors"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_item_authors"."name" ilike');
      expect(renderedWhere?.sql).not.toContain('jsonb_array_elements_text("warehouse_catalog_items"."authors")');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."narrators"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."series"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining(['%dune%']));
      expect(renderedWhere?.params).toContain('ebook');
      expect(renderedWhere?.params).not.toContain('audiobook');
      expect(renderedWhere?.params).not.toContain(42);

      const renderedOrder = renderSql(searchChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title")');
      expect(searchChain.limit).toHaveBeenCalledWith(100);
    });

    it('applies content filters to synced catalog library search', async () => {
      const rows = [{ id: 1, mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune' }];
      const searchChain = makeSelectChain('limit', rows);
      db.select.mockReturnValueOnce(searchChain);

      await expect(
        repo.searchCatalogItems('dune', 10, {
          includeTagIds: [7],
          excludeTagIds: [],
          includeGenreIds: [],
          excludeGenreIds: [9],
        }),
      ).resolves.toEqual(rows);

      const renderedWhere = renderSql(searchChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title" ilike');
      expect(renderedWhere?.sql).toContain('from "tags"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."tags" ? "tags"."name"');
      expect(renderedWhere?.sql).toContain('not exists');
      expect(renderedWhere?.sql).toContain('from "genres"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."genres" ? "genres"."name"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining(['%dune%', 7, 9]));
    });

    it('returns no synced catalog search rows without querying when media filter is empty', async () => {
      await expect(repo.searchCatalogItems('dune', 20, undefined, [])).resolves.toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns no synced catalog search rows for blank queries', async () => {
      await expect(repo.searchCatalogItems('   ', 10)).resolves.toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('queries current user owned catalog items with supported smart scope rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 7 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [
              { type: 'rule', field: 'title', operator: 'contains', value: 'Dune' },
              { type: 'rule', field: 'author', operator: 'includesAny', value: ['Teresa Burrell'] },
            ],
          },
          q: 'arrakis',
          page: 1,
          limit: 999,
        }),
      ).resolves.toEqual({ rows, total: 7, page: 1, limit: 100 });

      expect(db.select).toHaveBeenCalledTimes(2);
      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(listChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());

      const rowWhere = listChain.where.mock.calls[0]?.[0];
      const countWhere = countChain.where.mock.calls[0]?.[0];
      expect(rowWhere).toBe(countWhere);

      const renderedWhere = renderSql(rowWhere);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title" ilike');
      expect(renderedWhere?.sql).toContain('jsonb_array_elements_text("warehouse_catalog_items"."authors")');
      expect(renderedWhere?.sql).toContain('split_part');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."narrators"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, '%Dune%', 'Teresa Burrell', '%arrakis%']));

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title")');
      expect(listChain.limit).toHaveBeenCalledWith(100);
      expect(listChain.offset).toHaveBeenCalledWith(100);
      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseUserItems);
      expect(countChain.innerJoin).toHaveBeenCalledWith(schema.warehouseCatalogItems, expect.anything());
      expect(countChain.where).toHaveBeenCalledWith(rowWhere);
    });

    it('queries all current user owned catalog items for a source-backed library media type without requiring smart scope rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          q: 'arrakis',
          sort: [{ field: 'title', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title" ilike');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining([42, 'ebook', '%arrakis%']));

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") desc');
      expect(listChain.limit).toHaveBeenCalledWith(50);
      expect(listChain.offset).toHaveBeenCalledWith(0);
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('queries all synced catalog items for source-backed library browse without requiring user ownership rows', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          userAddedAt: null,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          includeAllCatalogItems: true,
          mediaType: 'ebook',
          q: 'arrakis',
          sort: [{ field: 'addedAt', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const rowWhere = listChain.where.mock.calls[0]?.[0];
      const renderedWhere = renderSql(rowWhere);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(listChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());
      expect(renderedWhere?.sql).not.toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title" ilike');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining(['ebook', '%arrakis%']));

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_user_items"."added_at"');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."synced_at"');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."created_at") desc');

      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(countChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(countChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());
      expect(countChain.where).toHaveBeenCalledWith(rowWhere);
    });

    it('queries source-backed comic jump buckets from synced catalog rows', async () => {
      db.execute.mockResolvedValue({
        rows: [
          { bucket: 'A', item_index: '0', total: '12' },
          { bucket: 'B', item_index: '7', total: '12' },
        ],
      });

      await expect(
        repo.queryUserCatalogJumpBuckets(42, {
          includeAllCatalogItems: true,
          mediaType: 'comic',
          q: 'astro',
          sort: [{ field: 'author', dir: 'asc' }],
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Astro' }],
          },
        }),
      ).resolves.toEqual({
        buckets: [
          { key: 'A', label: 'A', index: 0 },
          { key: 'B', label: 'B', index: 7 },
        ],
        total: 12,
        // JumpBucketsResponse gained kind/granularity upstream.
        kind: 'letter',
        granularity: null,
      });

      const rendered = renderSql(db.execute.mock.calls[0]?.[0]);
      const renderedSql = rendered?.sql.toLowerCase();
      expect(renderedSql).toContain('with ordered as');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"');
      expect(renderedSql).toContain('left join "warehouse_user_items"');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."title" ilike');
      expect(rendered?.sql).toContain('"warehouse_catalog_items"."authors"->>0');
      expect(renderedSql).toContain('row_number() over');
      expect(rendered?.params).toEqual(expect.arrayContaining([42, 'comic', '%Astro%', '%astro%']));
    });

    it('queries all synced catalog items across accessible source-backed media libraries', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          userAddedAt: null,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          includeAllCatalogItems: true,
          mediaTypes: ['ebook', 'audiobook'],
          q: 'arrakis',
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);

      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(listChain.innerJoin).not.toHaveBeenCalledWith(schema.warehouseUserItems, expect.anything());
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type" in');
      expect(renderedWhere?.sql).not.toContain('"warehouse_user_items"."user_id"');
      expect(renderedWhere?.params).toEqual(expect.arrayContaining(['ebook', 'audiobook', '%arrakis%']));
    });

    it('returns empty catalog query results for an empty source-backed media library scope', async () => {
      await expect(
        repo.queryUserCatalogItems(42, {
          includeAllCatalogItems: true,
          mediaTypes: [],
          page: 2,
          limit: 25,
        }),
      ).resolves.toEqual({ rows: [], total: 0, page: 2, limit: 25 });

      expect(db.select).not.toHaveBeenCalled();
    });

    it('orders current user owned catalog items by source-backed rating state', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          rating: 5,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'rating', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_state"."rating" desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed read progress state', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          readingProgress: 75,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'readProgress', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_state"."progress_percent" desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed last read activity', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          lastReadAt: new Date('2026-02-02T00:00:00.000Z'),
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'lastReadAt', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_state"."updated_at" desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed finished date', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          finishedAt: new Date('2026-02-02T00:00:00.000Z'),
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'finishedAt', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_state"."finished_at" desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed read status', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          readStatus: 'reading',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'readStatus', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      expect(listChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_user_state"."read_status" desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed published year', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          publishedYear: 1965,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'publishedYear', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('raw_payload');
      expect(renderedOrder?.sql).toContain('publishedYear');
      expect(renderedOrder?.sql).toContain('published_date');
      expect(renderedOrder?.sql).toContain('desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed page count', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          pageCount: 640,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'pageCount', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('raw_payload');
      expect(renderedOrder?.sql).toContain('pageCount');
      expect(renderedOrder?.sql).toContain('duration_seconds');
      expect(renderedOrder?.sql).toContain('desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders source-backed catalog windows by series index before stable title fallback', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Dune Messiah',
          seriesIndex: 2,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          includeAllCatalogItems: true,
          mediaType: 'audiobook',
          sort: [{ field: 'seriesIndex', dir: 'asc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."series_index" asc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed updated time', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          updatedAt: new Date('2026-02-02T00:00:00.000Z'),
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'updatedAt', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."updated_at" desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed file size', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          fileSizeBytes: 640,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'fileSize', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('raw_payload');
      expect(renderedOrder?.sql).toContain('sizeBytes');
      expect(renderedOrder?.sql).toContain('size_bytes');
      expect(renderedOrder?.sql).toContain('jsonb_array_elements');
      expect(renderedOrder?.sql).toContain('desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('orders current user owned catalog items by source-backed metadata score', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          metadataScore: 86,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          mediaType: 'ebook',
          sort: [{ field: 'metadataScore', dir: 'desc' }],
          page: 0,
          limit: 50,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 50 });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('floor((');
      expect(renderedOrder?.sql).toContain('jsonb_array_length');
      expect(renderedOrder?.sql).toContain('has_cover');
      expect(renderedOrder?.sql).toContain('publishedYear');
      expect(renderedOrder?.sql).toContain('case when');
      expect(renderedOrder?.sql).toContain('double precision > 0 else false end');
      expect(renderedOrder?.sql).toContain('desc nulls last');
      expect(renderedOrder?.sql).toContain('coalesce("warehouse_catalog_items"."sort_title", "warehouse_catalog_items"."title") asc');
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."remote_id" asc');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('queries current user owned catalog items with source-backed title negative rules', async () => {
      const rows = [{ id: 1, mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune Messiah' }];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'title', operator: 'notContains', value: 'Appendix_%' }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title"');
      expect(renderedWhere?.sql).toContain('not');
      expect(renderedWhere?.params).toContain('%Appendix\\_\\%%');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed title not-equals smart scope rules', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', [{ total: 0 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await repo.queryUserCatalogItems(42, {
        filter: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'title', operator: 'notEq', value: 'Dune_%' }],
        },
        page: 0,
        limit: 25,
      });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title"');
      expect(renderedWhere?.sql).toContain('not');
      expect(renderedWhere?.params).toContain('Dune\\_\\%');
    });

    it('queries current user owned catalog items with source-backed publisher set rules', async () => {
      const rows = [{ id: 1, mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune', publisher: 'Ace Books' }];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'publisher', operator: 'includesAny', value: ['Ace Books', 'Tor'] }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."publisher"');
      expect(renderedWhere?.sql).toContain('in');
      expect(renderedWhere?.params).toContain('Ace Books');
      expect(renderedWhere?.params).toContain('Tor');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed publisher exclusion smart scope rules', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', [{ total: 0 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await repo.queryUserCatalogItems(42, {
        filter: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'publisher', operator: 'excludesAll', value: ['Bad Press'] }],
        },
        page: 0,
        limit: 25,
      });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."publisher"');
      expect(renderedWhere?.sql).toContain('is null');
      expect(renderedWhere?.sql).toContain('not');
      expect(renderedWhere?.params).toContain('Bad Press');
    });

    it('queries current user owned catalog items with source-backed exact author rules', async () => {
      const rows = [{ id: 1, mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune', authors: ['Burrell, Teresa'] }];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'author', operator: 'includesAny', value: ['Teresa Burrell'] }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."authors"');
      expect(renderedWhere?.sql).toContain('jsonb_array_elements_text');
      expect(renderedWhere?.sql).toContain('split_part');
      expect(renderedWhere?.params).toContain('Teresa Burrell');
      expect(renderedWhere?.params).not.toContain('%Teresa Burrell%');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('queries current user owned catalog items with source-backed metadata score rules', async () => {
      const rows = [{ id: 1, mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune', metadataScore: 86 }];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'metadataScore', operator: 'gte', value: '80' }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('floor((');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_details"."raw_payload"');
      expect(renderedWhere?.sql).toContain('>=');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
      expect(countChain.leftJoin).toHaveBeenCalledWith(schema.warehouseCatalogDetails, expect.anything());
    });

    it('supports source-backed metadata score between and emptiness smart scope rules', async () => {
      const cases = [
        { operator: 'between' as const, value: 40, valueTo: '90', expectedSql: [' >= ', ' <= '] },
        { operator: 'isEmpty' as const, value: undefined, expectedSql: [' is null'] },
        { operator: 'isNotEmpty' as const, value: undefined, expectedSql: [' is not null'] },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [
              {
                type: 'rule',
                field: 'metadataScore',
                operator: testCase.operator,
                value: testCase.value,
                valueTo: testCase.valueTo,
              },
            ],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        expect(renderedWhere?.sql).toContain('floor((');
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
      }
    });

    it('queries current user owned catalog items with source-backed read status rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          readStatus: 'reading',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['reading'] }],
          },
          page: 2,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 2, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."read_status"');
      expect(renderedWhere?.sql).toContain('in');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('queries current user owned catalog items with source-backed rating rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          rating: 5,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'rating', operator: 'gte', value: 4 }],
          },
          page: 1,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 1, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."rating"');
      expect(renderedWhere?.sql).toContain('>=');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed rating comparison and emptiness smart scope rules', async () => {
      const cases = [
        { operator: 'eq' as const, value: '5', expectedSql: ['"warehouse_user_state"."rating" ='] },
        { operator: 'gt' as const, value: 3, expectedSql: ['"warehouse_user_state"."rating" >'] },
        { operator: 'lt' as const, value: 4, expectedSql: ['"warehouse_user_state"."rating" <'] },
        { operator: 'lte' as const, value: 2, expectedSql: ['"warehouse_user_state"."rating" <='] },
        { operator: 'isEmpty' as const, value: undefined, expectedSql: ['"warehouse_user_state"."rating" is null'] },
        { operator: 'isNotEmpty' as const, value: undefined, expectedSql: ['"warehouse_user_state"."rating" is not null'] },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'rating', operator: testCase.operator, value: testCase.value }],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
      }
    });

    it('queries current user owned catalog items with source-backed read progress rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          readingProgress: 65,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'readProgress', operator: 'isInProgress' }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."progress_percent"');
      expect(renderedWhere?.sql).toContain('>');
      expect(renderedWhere?.sql).toContain('<');
      expect(countChain.leftJoin).toHaveBeenCalledWith(schema.warehouseUserState, expect.anything());
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed unread and finished read progress smart scope rules', async () => {
      const cases = [
        {
          operator: 'isUnread' as const,
          expectedSql: ['"warehouse_user_state"."progress_percent" is null', '"warehouse_user_state"."progress_percent" <='],
        },
        {
          operator: 'isFinished' as const,
          expectedSql: ['"warehouse_user_state"."progress_percent" >='],
        },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'readProgress', operator: testCase.operator }],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
      }
    });

    it('queries current user owned catalog items with source-backed published year rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          publishedYear: 2024,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'publishedYear', operator: 'gte', value: '2020' }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('publishedYear');
      expect(renderedWhere?.sql).toContain('published_date');
      expect(renderedWhere?.sql).toContain('>=');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed published year numeric and emptiness smart scope rules', async () => {
      const cases = [
        { operator: 'eq' as const, value: 2024, expectedSql: [' = '] },
        { operator: 'notEq' as const, value: 2024, expectedSql: ['<>'], absentSql: [' is null'] },
        { operator: 'gt' as const, value: 2000, expectedSql: [' > '] },
        { operator: 'lt' as const, value: 2030, expectedSql: [' < '] },
        { operator: 'lte' as const, value: 2030, expectedSql: [' <= '] },
        { operator: 'between' as const, value: 1990, valueTo: '2020', expectedSql: [' >= ', ' <= '] },
        { operator: 'isEmpty' as const, value: undefined, expectedSql: [' is null'] },
        { operator: 'isNotEmpty' as const, value: undefined, expectedSql: [' is not null'] },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [
              {
                type: 'rule',
                field: 'publishedYear',
                operator: testCase.operator,
                value: testCase.value,
                valueTo: testCase.valueTo,
              },
            ],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        expect(renderedWhere?.sql).toContain('publishedYear');
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
        for (const absent of testCase.absentSql ?? []) {
          expect(renderedWhere?.sql).not.toContain(absent);
        }
      }
    });

    it('queries current user owned catalog items with source-backed page count rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          pageCount: 640,
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'pageCount', operator: 'gte', value: '300' }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('pageCount');
      expect(renderedWhere?.sql).toContain('duration_seconds');
      expect(renderedWhere?.sql).toContain('>=');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed page count numeric and emptiness smart scope rules', async () => {
      const cases = [
        { operator: 'gt' as const, value: 100, expectedSql: [' > '] },
        { operator: 'lt' as const, value: 900, expectedSql: [' < '] },
        { operator: 'lte' as const, value: '900', expectedSql: [' <= '] },
        { operator: 'between' as const, value: 100, valueTo: '900', expectedSql: [' >= ', ' <= '] },
        { operator: 'isEmpty' as const, value: undefined, expectedSql: [' is null'] },
        { operator: 'isNotEmpty' as const, value: undefined, expectedSql: [' is not null'] },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [
              {
                type: 'rule',
                field: 'pageCount',
                operator: testCase.operator,
                value: testCase.value,
                valueTo: testCase.valueTo,
              },
            ],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        expect(renderedWhere?.sql).toContain('pageCount');
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
      }
    });

    it('queries current user owned catalog items with source-backed format rules', async () => {
      const rows = [{ id: 1, mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune', format: 'EPUB' }];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['EPUB', 'PDF'] }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(renderedWhere?.params).toContain('EPUB');
      expect(renderedWhere?.params).toContain('PDF');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed format exclusion smart scope rules', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', [{ total: 0 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await repo.queryUserCatalogItems(42, {
        filter: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'format', operator: 'excludesAll', value: ['PDF'] }],
        },
        page: 0,
        limit: 25,
      });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(renderedWhere?.sql).toContain('is null');
      expect(renderedWhere?.sql).toContain('not');
      expect(renderedWhere?.params).toContain('PDF');
    });

    it('queries current user owned catalog items with source-backed isbn rules', async () => {
      const rows = [{ id: 1, mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune', identifiers: { isbn13: '9780441172719' } }];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'isbn', operator: 'eq', value: '9780441172719' }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."identifiers"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."raw_payload"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_details"."raw_payload"');
      expect(renderedWhere?.sql).toContain('nullif(trim');
      expect(renderedWhere?.params).toContain('9780441172719');
      expect(renderedWhere?.params.filter((param) => param === '9780441172719').length).toBeGreaterThan(1);
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
      expect(countChain.leftJoin).toHaveBeenCalledWith(schema.warehouseCatalogDetails, expect.anything());
    });

    it('supports source-backed isbn emptiness smart scope rules', async () => {
      const cases = [
        { operator: 'isEmpty' as const, expectedSql: ['is null'] },
        { operator: 'isNotEmpty' as const, expectedSql: ['is not null'] },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'isbn', operator: testCase.operator }],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."identifiers"');
        expect(renderedWhere?.sql).toContain('nullif(trim');
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
      }
    });

    it('queries current user owned catalog items with source-backed genre rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          genres: ['Science Fiction'],
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'genre', operator: 'includesAny', value: ['Science Fiction'] }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."genres"');
      expect(renderedWhere?.sql).toContain('jsonb_array_elements_text');
      expect(renderedWhere?.params).toContain('Science Fiction');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed genre all/exclusion and emptiness smart scope rules', async () => {
      const cases = [
        {
          operator: 'includesAll' as const,
          value: ['Science Fiction', 'Space Opera'],
          expectedSql: ['"warehouse_catalog_items"."genres"', 'jsonb_array_elements_text', 'and'],
          expectedParams: ['Science Fiction', 'Space Opera'],
        },
        {
          operator: 'excludesAll' as const,
          value: ['Romance'],
          expectedSql: ['not', '"warehouse_catalog_items"."genres"', 'jsonb_array_elements_text'],
          expectedParams: ['Romance'],
        },
        {
          operator: 'isEmpty' as const,
          value: undefined,
          expectedSql: ['jsonb_array_length("warehouse_catalog_items"."genres") = 0'],
          expectedParams: [],
        },
        {
          operator: 'isNotEmpty' as const,
          value: undefined,
          expectedSql: ['jsonb_array_length("warehouse_catalog_items"."genres") > 0'],
          expectedParams: [],
        },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'genre', operator: testCase.operator, value: testCase.value }],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
        for (const expected of testCase.expectedParams) {
          expect(renderedWhere?.params).toContain(expected);
        }
      }
    });

    it('queries current user owned catalog items with source-backed tag rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          tags: ['Hugo Winner'],
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'tag', operator: 'includesAny', value: ['Hugo Winner'] }],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."tags"');
      expect(renderedWhere?.sql).toContain('jsonb_array_elements_text');
      expect(renderedWhere?.params).toContain('Hugo Winner');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('supports source-backed tag all/exclusion and emptiness smart scope rules', async () => {
      const cases = [
        {
          operator: 'includesAll' as const,
          value: ['Hugo Winner', 'Favorites'],
          expectedSql: ['"warehouse_catalog_items"."tags"', 'jsonb_array_elements_text', 'and'],
          expectedParams: ['Hugo Winner', 'Favorites'],
        },
        {
          operator: 'excludesAll' as const,
          value: ['DNF'],
          expectedSql: ['not', '"warehouse_catalog_items"."tags"', 'jsonb_array_elements_text'],
          expectedParams: ['DNF'],
        },
        {
          operator: 'isEmpty' as const,
          value: undefined,
          expectedSql: ['jsonb_array_length("warehouse_catalog_items"."tags") = 0'],
          expectedParams: [],
        },
        {
          operator: 'isNotEmpty' as const,
          value: undefined,
          expectedSql: ['jsonb_array_length("warehouse_catalog_items"."tags") > 0'],
          expectedParams: [],
        },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'tag', operator: testCase.operator, value: testCase.value }],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
        for (const expected of testCase.expectedParams) {
          expect(renderedWhere?.params).toContain(expected);
        }
      }
    });

    it('supports source-backed read status exclusion and emptiness smart scope rules', async () => {
      const cases = [
        {
          operator: 'excludesAll' as const,
          value: ['read'],
          expectedSql: ['"warehouse_user_state"."read_status" is null', 'not'],
        },
        {
          operator: 'isEmpty' as const,
          value: undefined,
          expectedSql: ['"warehouse_user_state"."read_status" is null'],
        },
        {
          operator: 'isNotEmpty' as const,
          value: undefined,
          expectedSql: ['"warehouse_user_state"."read_status" is not null'],
        },
      ];

      for (const testCase of cases) {
        const listChain = makeSelectChain('offset', []);
        const countChain = makeSelectChain('where', [{ total: 0 }]);
        db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

        await repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'readStatus', operator: testCase.operator, value: testCase.value }],
          },
          page: 0,
          limit: 25,
        });

        const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
        for (const expected of testCase.expectedSql) {
          expect(renderedWhere?.sql).toContain(expected);
        }
      }
    });

    it('filters source-backed catalog rows by collection membership rules', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', [{ total: 0 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await repo.queryUserCatalogItems(42, {
        filter: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'collection', operator: 'includesAny', value: ['Favorites'] }],
        },
        page: 0,
        limit: 25,
      });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('collection_catalog_items');
      expect(renderedWhere?.sql).toContain('"collections"."name"');
      expect(renderedWhere?.sql).toContain('"collections"."user_id"');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('keeps supported source-backed rules in OR groups with local-book-only rules', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Dune',
          readStatus: 'reading',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 1 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'OR',
            rules: [
              { type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['reading'] },
              { type: 'rule', field: 'fileAvailability', operator: 'isPresent' },
            ],
          },
          page: 0,
          limit: 25,
        }),
      ).resolves.toEqual({ rows, total: 1, page: 0, limit: 25 });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_user_state"."read_status"');
      expect(renderedWhere?.sql).not.toContain('book_files');
      expect(countChain.where).toHaveBeenCalledWith(listChain.where.mock.calls[0]?.[0]);
    });

    it('returns an empty catalog page when smart scope rules are local-book only', async () => {
      await expect(
        repo.queryUserCatalogItems(42, {
          filter: {
            type: 'group',
            join: 'AND',
            rules: [{ type: 'rule', field: 'fileAvailability', operator: 'isPresent' }],
          },
          page: 2,
          limit: 25,
        }),
      ).resolves.toEqual({ rows: [], total: 0, page: 2, limit: 25 });

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('listEbookCatalog', () => {
    it('applies ebook pagination, search/filter inputs, and separate total count queries', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'ebook',
          remoteId: 'bk-1',
          title: 'Dune',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 42 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      const result = await repo.listEbookCatalog({
        q: 'dune',
        page: -4,
        limit: 999,
        sort: 'author',
        order: 'asc',
        author: 'Frank Herbert',
        series: 'Dune',
        genre: 'Science Fiction',
        language: 'en',
        format: 'epub',
        hasCover: true,
      });

      expect(result).toEqual({
        rows,
        total: 42,
        page: 1,
        limit: 100,
      });
      expect(db.select).toHaveBeenCalledTimes(2);
      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      const rowWhere = listChain.where.mock.calls[0]?.[0];
      const countWhere = countChain.where.mock.calls[0]?.[0];
      const renderedWhere = renderSql(rowWhere);

      expect(rowWhere).toBe(countWhere);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title"');
      expect(renderedWhere?.sql).toContain('from "warehouse_catalog_item_authors"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_item_authors"."name" ilike');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."genres"::text');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."series"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."identifiers"::text');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."language"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."publisher"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."has_cover"');
      expect(renderedWhere?.params).toEqual([
        'ebook',
        '%dune%',
        '%dune%',
        '%dune%',
        '%dune%',
        '%dune%',
        '%dune%',
        '%dune%',
        '%Frank Herbert%',
        '%Dune%',
        '%Science Fiction%',
        '%en%',
        '%epub%',
        true,
      ]);
      expect(listChain.orderBy).toHaveBeenCalledWith(expect.anything());
      expect(listChain.limit).toHaveBeenCalledWith(100);
      expect(listChain.offset).toHaveBeenCalledWith(0);
      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(countChain.where).toHaveBeenCalledWith(rowWhere);
    });

    it('returns an empty page with total zero when the count query is empty', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', []);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(repo.listEbookCatalog({ page: 3, limit: 20 })).resolves.toEqual({
        rows: [],
        total: 0,
        page: 3,
        limit: 20,
      });
    });
  });

  describe('listAudiobookCatalog', () => {
    it('applies audiobook pagination, search/filter inputs, and separate total count queries', async () => {
      const rows = [
        {
          id: 1,
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Dune Audio',
        },
      ];
      const listChain = makeSelectChain('offset', rows);
      const countChain = makeSelectChain('where', [{ total: 7 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      const result = await repo.listAudiobookCatalog({
        q: 'case',
        page: -4,
        limit: 999,
        sort: 'narrator',
        order: 'asc',
        author: 'Frank Herbert',
        narrator: 'Case Reader',
        series: 'Dune',
        genre: 'Fantasy',
        language: 'en',
        format: 'm4b',
        hasCover: true,
      });

      expect(result).toEqual({
        rows,
        total: 7,
        page: 1,
        limit: 100,
      });
      expect(db.select).toHaveBeenCalledTimes(2);
      expect(listChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      const rowWhere = listChain.where.mock.calls[0]?.[0];
      const countWhere = countChain.where.mock.calls[0]?.[0];
      const renderedWhere = renderSql(rowWhere);

      expect(rowWhere).toBe(countWhere);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."media_type"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."title"');
      expect(renderedWhere?.sql).toContain('from "warehouse_catalog_item_authors"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_item_authors"."name" ilike');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."narrators"::text');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."genres"::text');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."series"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."identifiers"::text');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."format"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."language"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."publisher"');
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."has_cover"');
      expect(renderedWhere?.params).toEqual([
        'audiobook',
        '%case%',
        '%case%',
        '%case%',
        '%case%',
        '%case%',
        '%case%',
        '%case%',
        '%case%',
        '%Frank Herbert%',
        '%Case Reader%',
        '%Dune%',
        '%Fantasy%',
        '%en%',
        '%m4b%',
        true,
      ]);
      expect(listChain.orderBy).toHaveBeenCalledWith(expect.anything());
      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."narrators"->>0');
      expect(listChain.limit).toHaveBeenCalledWith(100);
      expect(listChain.offset).toHaveBeenCalledWith(0);
      expect(countChain.from).toHaveBeenCalledWith(schema.warehouseCatalogItems);
      expect(countChain.where).toHaveBeenCalledWith(rowWhere);
    });

    it('searches narrators without requiring a narrator filter', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', [{ total: 0 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await repo.listAudiobookCatalog({ q: 'reader' });

      const renderedWhere = renderSql(listChain.where.mock.calls[0]?.[0]);
      expect(renderedWhere?.sql).toContain('"warehouse_catalog_items"."narrators"::text');
      expect(renderedWhere?.params).toEqual([
        'audiobook',
        '%reader%',
        '%reader%',
        '%reader%',
        '%reader%',
        '%reader%',
        '%reader%',
        '%reader%',
        '%reader%',
      ]);
    });

    it('sorts duration using duration_seconds', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', [{ total: 0 }]);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await repo.listAudiobookCatalog({ sort: 'duration', order: 'asc' });

      const renderedOrder = renderSql(listChain.orderBy.mock.calls[0]?.[0]);
      expect(renderedOrder?.sql).toContain('"warehouse_catalog_items"."duration_seconds"');
    });

    it('returns an empty page with total zero when the count query is empty', async () => {
      const listChain = makeSelectChain('offset', []);
      const countChain = makeSelectChain('where', []);
      db.select.mockReturnValueOnce(listChain).mockReturnValueOnce(countChain);

      await expect(repo.listAudiobookCatalog({ page: 3, limit: 20 })).resolves.toEqual({
        rows: [],
        total: 0,
        page: 3,
        limit: 20,
      });
    });
  });
});
