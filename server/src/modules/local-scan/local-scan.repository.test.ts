import { LocalScanRepository } from './local-scan.repository';

/** `insert` on the outer fake `db` never resolves usefully: it exists only so a future
 *  regression that writes through `this.db` instead of the transaction's `tx` fails loudly
 *  instead of silently reusing the working chain. All real writes go through `txInsert`. */
function makeDb(rowCount: number | null = 2) {
  const onConflictDoNothing = vi.fn().mockResolvedValue({ rowCount });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const txInsert = vi.fn().mockReturnValue({ values });
  const tx = { insert: txInsert };
  const insert = vi.fn();
  const transaction = vi.fn((callback: (tx: { insert: typeof txInsert }) => unknown) => callback(tx));
  const db = { insert, transaction };
  return { db: db as never, insert, values, onConflictDoNothing, txInsert, transaction };
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
    expect(values.mock.calls[1]).toEqual([[{ entityType: 'catalog_item', entityId: 'catalog:ebook:local:aaa', operation: 'upsert' }]]);
  });
});
