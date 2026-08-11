vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
  count: vi.fn(() => ({ op: 'count' })),
  desc: vi.fn((value: unknown) => ({ op: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  getTableColumns: vi.fn((table: unknown) => ({ table })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ op: 'ilike', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      join: vi.fn((chunks: unknown[], separator: unknown) => ({ op: 'sql.join', chunks, separator })),
    },
  ),
}));

import { CollectionRepository } from './collection.repository';

describe('CollectionRepository', () => {
  const txWhere = vi.fn();
  const txSet = vi.fn();
  const txUpdate = vi.fn(() => ({ set: txSet }));
  const tx = {
    update: txUpdate,
  };

  const db = {
    select: vi.fn(),
    transaction: vi.fn(),
  };

  let repo: CollectionRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new CollectionRepository(db as never);

    db.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx));
    txUpdate.mockImplementation(() => ({ set: txSet }));
    txSet.mockReturnValue({ where: txWhere });
    txWhere.mockResolvedValue(undefined);
  });

  it('updateDisplayOrders performs all updates in a single transaction and updates timestamps', async () => {
    await repo.updateDisplayOrders(12, [
      { id: 1, displayOrder: 3 },
      { id: 2, displayOrder: 4 },
    ]);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(txSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayOrder: 3, updatedAt: expect.anything() }));
    expect(txSet).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayOrder: 4, updatedAt: expect.anything() }));
  });

  it('findBookIdsPage short-circuits when no library ids are accessible', async () => {
    const result = await repo.findBookIdsPage(20, [], 1, 25);

    expect(result).toEqual({ bookIds: [], total: 0, page: 1, size: 25 });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('findBookIdsPage returns paged ids and total count', async () => {
    const firstOffset = vi.fn().mockResolvedValue([{ bookId: 7 }, { bookId: 9 }]);
    const firstLimit = vi.fn().mockReturnValue({ offset: firstOffset });
    const firstOrderBy = vi.fn().mockReturnValue({ limit: firstLimit });
    const firstWhere = vi.fn().mockReturnValue({ orderBy: firstOrderBy });
    const firstInnerJoin2 = vi.fn().mockReturnValue({ where: firstWhere });
    const firstInnerJoin = vi.fn().mockReturnValue({ innerJoin: firstInnerJoin2 });
    const firstFrom = vi.fn().mockReturnValue({ innerJoin: firstInnerJoin });
    const firstSelect = { from: firstFrom };

    const secondWhere = vi.fn().mockResolvedValue([{ total: '2' }]);
    const secondInnerJoin2 = vi.fn().mockReturnValue({ where: secondWhere });
    const secondInnerJoin = vi.fn().mockReturnValue({ innerJoin: secondInnerJoin2 });
    const secondFrom = vi.fn().mockReturnValue({ innerJoin: secondInnerJoin });
    const secondSelect = { from: secondFrom };

    db.select.mockReturnValueOnce(firstSelect as never).mockReturnValueOnce(secondSelect as never);

    const result = await repo.findBookIdsPage(20, [100, 101], 1, 2);

    expect(firstLimit).toHaveBeenCalledWith(2);
    expect(firstOffset).toHaveBeenCalledWith(2);
    expect(result).toEqual({ bookIds: [7, 9], total: 2, page: 1, size: 2 });
  });

  it('findAllForUserWithMembership builds membership projection for provided book ids', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 1, memberCount: 2 }]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    db.select.mockReturnValueOnce({ from } as never);

    const rows = await repo.findAllForUserWithMembership(5, [100, 101]);

    expect(rows).toEqual([{ id: 1, memberCount: 2 }]);
    expect(db.select).toHaveBeenCalledWith(expect.objectContaining({ memberCount: expect.anything() }));
  });

  it('findAllForUserWithMembership accepts source-backed item refs for membership projection', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 1, memberCount: 1 }]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    db.select.mockReturnValueOnce({ from } as never);

    const rows = await repo.findAllForUserWithMembership(5, [], [{ mediaType: 'audiobook', remoteId: 'audio-1' }]);

    expect(rows).toEqual([{ id: 1, memberCount: 1 }]);
    expect(db.select).toHaveBeenCalledWith(expect.objectContaining({ memberCount: expect.anything() }));
  });

  it('addBooks and removeBooks issue membership writes with expected payloads', async () => {
    const insertChain = {
      values: vi.fn(),
      onConflictDoNothing: vi.fn(),
      returning: vi.fn(),
    };
    insertChain.values.mockReturnValue(insertChain);
    insertChain.onConflictDoNothing.mockReturnValue(insertChain);
    insertChain.returning.mockResolvedValue([{ collectionId: 10, bookId: 1 }]);

    const deleteChain = {
      where: vi.fn(),
      returning: vi.fn(),
    };
    deleteChain.where.mockReturnValue(deleteChain);
    deleteChain.returning.mockResolvedValue([{ collectionId: 10, bookId: 1 }]);

    const localDb = {
      insert: vi.fn().mockReturnValue(insertChain),
      delete: vi.fn().mockReturnValue(deleteChain),
    };
    const localRepo = new CollectionRepository(localDb as never);

    await localRepo.addBooks(10, [1, 2]);
    await localRepo.removeBooks(10, [1]);

    expect(insertChain.values).toHaveBeenCalledWith([
      { collectionId: 10, bookId: 1 },
      { collectionId: 10, bookId: 2 },
    ]);
    expect(insertChain.onConflictDoNothing).toHaveBeenCalled();
    expect(deleteChain.where).toHaveBeenCalled();
  });

  it('addCatalogItems and removeCatalogItems issue source-backed membership writes', async () => {
    const insertChain = {
      values: vi.fn(),
      onConflictDoNothing: vi.fn(),
      returning: vi.fn(),
    };
    insertChain.values.mockReturnValue(insertChain);
    insertChain.onConflictDoNothing.mockReturnValue(insertChain);
    insertChain.returning.mockResolvedValue([{ collectionId: 10, mediaType: 'ebook', remoteId: 'remote-1' }]);

    const deleteChain = {
      where: vi.fn(),
      returning: vi.fn(),
    };
    deleteChain.where.mockReturnValue(deleteChain);
    deleteChain.returning.mockResolvedValue([{ collectionId: 10, mediaType: 'ebook', remoteId: 'remote-1' }]);

    const localDb = {
      insert: vi.fn().mockReturnValue(insertChain),
      delete: vi.fn().mockReturnValue(deleteChain),
    };
    const localRepo = new CollectionRepository(localDb as never);

    await localRepo.addCatalogItems(10, [{ mediaType: 'ebook', remoteId: 'remote-1' }]);
    await localRepo.removeCatalogItems(10, [{ mediaType: 'ebook', remoteId: 'remote-1' }]);

    expect(insertChain.values).toHaveBeenCalledWith([{ collectionId: 10, mediaType: 'ebook', remoteId: 'remote-1' }]);
    expect(insertChain.onConflictDoNothing).toHaveBeenCalled();
    expect(deleteChain.where).toHaveBeenCalled();
  });

  it('findCatalogItemsPage returns source-backed catalog rows and total count', async () => {
    const firstOffset = vi.fn().mockResolvedValue([{ remoteId: 'remote-1', title: 'Catalog Title' }]);
    const firstLimit = vi.fn().mockReturnValue({ offset: firstOffset });
    const firstOrderBy = vi.fn().mockReturnValue({ limit: firstLimit });
    const firstWhere = vi.fn().mockReturnValue({ orderBy: firstOrderBy });
    const firstLeftJoin2 = vi.fn().mockReturnValue({ where: firstWhere });
    const firstLeftJoin = vi.fn().mockReturnValue({ leftJoin: firstLeftJoin2 });
    const firstInnerJoin = vi.fn().mockReturnValue({ leftJoin: firstLeftJoin });
    const firstFrom = vi.fn().mockReturnValue({ innerJoin: firstInnerJoin });

    const secondWhere = vi.fn().mockResolvedValue([{ total: '1' }]);
    const secondInnerJoin = vi.fn().mockReturnValue({ where: secondWhere });
    const secondFrom = vi.fn().mockReturnValue({ innerJoin: secondInnerJoin });

    db.select.mockReturnValueOnce({ from: firstFrom } as never).mockReturnValueOnce({ from: secondFrom } as never);

    const result = await repo.findCatalogItemsPage(20, 7, 2, 25, 'dune', [{ field: 'rating', dir: 'desc' }]);

    expect(firstOrderBy).toHaveBeenCalledWith(expect.objectContaining({ op: 'sql' }));
    expect(firstLimit).toHaveBeenCalledWith(25);
    expect(firstOffset).toHaveBeenCalledWith(50);
    expect(result).toEqual({
      rows: [{ remoteId: 'remote-1', title: 'Catalog Title' }],
      total: 1,
      page: 2,
      size: 25,
    });
  });
});
