import { LocalScanRepository } from './local-scan.repository';

function makeDb(rowCount: number | null = 2) {
  const onConflictDoNothing = vi.fn().mockResolvedValue({ rowCount });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values, onConflictDoNothing };
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
    const { db, insert } = makeDb();
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([])).resolves.toBe(0);
    expect(insert).not.toHaveBeenCalled();
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
});
