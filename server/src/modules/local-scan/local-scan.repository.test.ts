import { LocalScanRepository } from './local-scan.repository';

function makeDb() {
  const onConflictDoNothing = vi.fn().mockResolvedValue({ rowCount: 2 });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values, onConflictDoNothing };
}

describe('LocalScanRepository', () => {
  it('inserts local rows with source local and ignores duplicates', async () => {
    const { db, values, onConflictDoNothing } = makeDb();
    const repository = new LocalScanRepository(db);

    await repository.insertLocalItems([
      { mediaType: 'ebook', remoteId: 'local:aaa', title: 'Book', localPath: '/mnt/books/a/b.epub', format: 'epub', fileSizeBytes: 10 },
    ]);

    expect(values).toHaveBeenCalledWith([expect.objectContaining({ source: 'local', remoteId: 'local:aaa', localPath: '/mnt/books/a/b.epub' })]);
    expect(onConflictDoNothing).toHaveBeenCalled();
  });

  it('does nothing when given an empty batch', async () => {
    const { db, insert } = makeDb();
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([])).resolves.toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns the number of rows handed to it', async () => {
    const { db } = makeDb();
    const repository = new LocalScanRepository(db);

    const rows = [
      { mediaType: 'ebook' as const, remoteId: 'local:a', title: 'A', localPath: '/a.epub', format: 'epub', fileSizeBytes: null },
      { mediaType: 'ebook' as const, remoteId: 'local:b', title: 'B', localPath: '/b.epub', format: 'epub', fileSizeBytes: null },
    ];

    await expect(repository.insertLocalItems(rows)).resolves.toBe(2);
  });
});
