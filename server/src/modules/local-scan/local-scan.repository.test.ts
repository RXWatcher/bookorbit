import { catalogDocumentId } from '../book-search/book-search-document.mapper';
import { LocalScanRepository } from './local-scan.repository';

/** `insert` on the outer fake `db` never resolves usefully: it exists only so a future
 *  regression that writes through `this.db` instead of the transaction's `tx` fails loudly
 *  instead of silently reusing the working chain. All real writes go through `txInsert`. */
function makeDb(rowCount: number | null = 2, deletedRows: Array<{ remoteId: string }> = [{ remoteId: 'local:aaa' }]) {
  const onConflictDoNothing = vi.fn().mockResolvedValue({ rowCount });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const txInsert = vi.fn().mockReturnValue({ values });
  const returning = vi.fn().mockResolvedValue(deletedRows);
  const deleteWhere = vi.fn().mockReturnValue({ returning });
  const txDelete = vi.fn().mockReturnValue({ where: deleteWhere });
  const tx = { insert: txInsert, delete: txDelete };
  const insert = vi.fn();
  const dbDelete = vi.fn();
  const transaction = vi.fn((callback: (tx: typeof tx) => unknown) => callback(tx));
  const db = { insert, delete: dbDelete, transaction };
  return { db: db as never, insert, dbDelete, values, onConflictDoNothing, txInsert, txDelete, returning, transaction };
}

const ROW = {
  mediaType: 'ebook' as const,
  remoteId: 'local:aaa',
  title: 'Book',
  localPath: '/mnt/books/a/b.epub',
  format: 'epub',
  fileSizeBytes: 10,
};

describe('LocalScanRepository', () => {
  it('inserts local rows with source local and ignores duplicates', async () => {
    const { db, values, onConflictDoNothing } = makeDb();
    const repository = new LocalScanRepository(db);

    await repository.insertLocalItems([ROW]);

    expect(values).toHaveBeenCalledWith([expect.objectContaining({ source: 'local', remoteId: 'local:aaa', localPath: '/mnt/books/a/b.epub' })]);
    expect(onConflictDoNothing).toHaveBeenCalled();
  });

  it('does nothing when given an empty batch', async () => {
    const { db, insert, transaction } = makeDb();
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([])).resolves.toBe(0);
    expect(insert).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('reports rows actually persisted, not the batch size', async () => {
    const { db } = makeDb(0);
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([ROW, { ...ROW, remoteId: 'local:bbb' }])).resolves.toBe(0);
  });

  it('reports a partial insert when only some rows conflict', async () => {
    const { db } = makeDb(1);
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([ROW, { ...ROW, remoteId: 'local:bbb' }])).resolves.toBe(1);
  });

  it('treats a missing rowCount as zero rather than reporting the batch size', async () => {
    const { db } = makeDb(null);
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([ROW])).resolves.toBe(0);
  });

  it('writes the catalog insert and the search index enqueue through the same transaction handle', async () => {
    const { db, insert, transaction, txInsert, values } = makeDb();
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([ROW])).resolves.toBe(2);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(txInsert).toHaveBeenCalledTimes(2);
    expect(values.mock.calls[1]).toEqual([[{ entityType: 'catalog_item', entityId: catalogDocumentId('ebook', 'local:aaa'), operation: 'upsert' }]]);
  });

  it('enqueues a delete event for every local row the delete actually removed', async () => {
    const { db, dbDelete, transaction, txDelete, values } = makeDb(2, [{ remoteId: 'local:aaa' }, { remoteId: 'local:bbb' }]);
    const repository = new LocalScanRepository(db);

    await expect(repository.deleteLocalItemsByRemoteIds('ebook', ['local:aaa', 'local:bbb', 'local:ccc'])).resolves.toBe(2);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(dbDelete).not.toHaveBeenCalled();
    expect(txDelete).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      { entityType: 'catalog_item', entityId: catalogDocumentId('ebook', 'local:aaa'), operation: 'delete' },
      { entityType: 'catalog_item', entityId: catalogDocumentId('ebook', 'local:bbb'), operation: 'delete' },
    ]);
  });

  it('enqueues nothing when the delete matched no local rows', async () => {
    const { db, txInsert } = makeDb(2, []);
    const repository = new LocalScanRepository(db);

    await expect(repository.deleteLocalItemsByRemoteIds('ebook', ['local:aaa'])).resolves.toBe(0);

    expect(txInsert).not.toHaveBeenCalled();
  });

  it('does nothing when given no remote ids to delete', async () => {
    const { db, transaction } = makeDb();
    const repository = new LocalScanRepository(db);

    await expect(repository.deleteLocalItemsByRemoteIds('ebook', [])).resolves.toBe(0);

    expect(transaction).not.toHaveBeenCalled();
  });
});
