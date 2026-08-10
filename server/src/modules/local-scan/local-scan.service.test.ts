import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { LocalScanService } from './local-scan.service';

interface RepoOptions {
  catalogRows?: unknown[][];
  lateRows?: unknown[];
  locked?: boolean;
  insertThrows?: boolean;
}

function makeRepository(root: string, options: RepoOptions = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const failures: Array<{ message: string }> = [];
  const finished: unknown[] = [];

  const repository = {
    findEnabledRoots: vi.fn().mockResolvedValue([{ id: 7, mediaType: 'ebook', absolutePath: root, excludePatterns: [] }]),
    streamCatalogKeyRows: vi.fn().mockImplementation(async function* () {
      await Promise.resolve();
      for (const batch of options.catalogRows ?? [[]]) yield batch;
    }),
    insertLocalItems: vi.fn().mockImplementation((rows: Array<Record<string, unknown>>) => {
      if (options.insertThrows) return Promise.reject(new Error('insert exploded'));
      inserted.push(...rows);
      return Promise.resolve(rows.length);
    }),
    findCatalogKeyRowsSyncedSince: vi.fn().mockResolvedValue(options.lateRows ?? []),
    deleteLocalItemsByRemoteIds: vi.fn().mockImplementation((_type: string, ids: string[]) => {
      deleted.push(...ids);
      return Promise.resolve(ids.length);
    }),
    tryLockRoot: vi.fn().mockResolvedValue(options.locked ?? true),
    unlockRoot: vi.fn().mockResolvedValue(undefined),
    markScanStarted: vi.fn().mockResolvedValue(undefined),
    markScanFinished: vi.fn().mockImplementation((_id: number, summary: unknown) => {
      finished.push(summary);
      return Promise.resolve();
    }),
    markScanFailed: vi.fn().mockImplementation((_id: number, message: string) => {
      failures.push({ message });
      return Promise.resolve();
    }),
    findRootStatuses: vi.fn().mockResolvedValue([]),
  };

  return { repository, inserted, deleted, failures, finished };
}

describe('LocalScanService', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bookorbit-local-scan-'));
    await fs.mkdir(join(root, 'Author', 'Known (1)'), { recursive: true });
    await fs.mkdir(join(root, 'Author', 'Missing (2)'), { recursive: true });
    await fs.writeFile(join(root, 'Author', 'Known (1)', 'a.epub'), 'x');
    await fs.writeFile(join(root, 'Author', 'Missing (2)', 'b.epub'), 'x');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('inserts only the books the catalogue does not already have', async () => {
    const { repository, inserted } = makeRepository(root, {
      catalogRows: [[{ remoteId: 'r1', title: 'Known', rawPayload: { calibre_path: 'Author/Known (1)' } }]],
    });

    const summary = await new LocalScanService(repository as never).scanRoot(7);

    expect(summary.inserted).toBe(1);
    expect(summary.matched).toBe(1);
    expect(inserted).toEqual([
      expect.objectContaining({ mediaType: 'ebook', title: 'Missing', localPath: join(root, 'Author', 'Missing (2)', 'b.epub') }),
    ]);
  });

  it('derives remote id from the book directory so a rescan cannot duplicate the book', async () => {
    const first = makeRepository(root);
    await new LocalScanService(first.repository as never).scanRoot(7);

    // A second format arriving beside the first must not change the book's identity.
    await fs.writeFile(join(root, 'Author', 'Missing (2)', 'b.mobi'), 'x');
    const second = makeRepository(root);
    await new LocalScanService(second.repository as never).scanRoot(7);

    const idsFor = (rows: Array<Record<string, unknown>>, dir: string) =>
      rows.filter((r) => String(r.localPath).includes(dir)).map((r) => r.remoteId);

    expect(idsFor(first.inserted, 'Missing (2)')).toEqual(idsFor(second.inserted, 'Missing (2)'));
    expect(second.inserted.filter((r) => String(r.localPath).includes('Missing (2)'))).toHaveLength(1);
  });

  it('counts unkeyed candidates separately from deduplicated siblings', async () => {
    await fs.writeFile(join(root, 'loose.epub'), 'x');
    await fs.writeFile(join(root, 'Author', 'Missing (2)', 'second.epub'), 'x');
    const { repository } = makeRepository(root);

    const summary = await new LocalScanService(repository as never).scanRoot(7);

    expect(summary.unkeyed).toBe(1);
    expect(summary.deduped).toBe(1);
  });

  it('removes a local row when a warehouse sync lands the same book mid walk', async () => {
    const { repository, deleted } = makeRepository(root, {
      lateRows: [{ remoteId: 'r9', title: 'Missing', rawPayload: { calibre_path: 'Author/Missing (2)' } }],
    });

    const summary = await new LocalScanService(repository as never).scanRoot(7);

    expect(summary.reconciled).toBe(1);
    expect(deleted).toHaveLength(1);
  });

  it('records failure state and releases the lock when the run throws', async () => {
    const { repository, failures } = makeRepository(root, { insertThrows: true });
    const service = new LocalScanService(repository as never);

    await expect(service.scanRoot(7)).rejects.toThrow('insert exploded');
    expect(failures).toHaveLength(1);
    expect(repository.markScanFinished).not.toHaveBeenCalled();
    expect(repository.unlockRoot).toHaveBeenCalledWith(7);
  });

  it('refuses to run when another scan holds the root lock', async () => {
    const { repository } = makeRepository(root, { locked: false });

    await expect(new LocalScanService(repository as never).scanRoot(7)).rejects.toThrow('already being scanned');
    expect(repository.markScanStarted).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an unknown root', async () => {
    const { repository } = makeRepository(root);
    repository.findEnabledRoots.mockResolvedValue([]);

    await expect(new LocalScanService(repository as never).scanRoot(99)).rejects.toThrow('Scan root 99 not found or disabled');
  });
});
