import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { LocalScanService } from './local-scan.service';

function makeRepository(root: string, catalogRows: unknown[][]) {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    inserted,
    repository: {
      findEnabledRoots: vi.fn().mockResolvedValue([{ id: 7, mediaType: 'ebook', absolutePath: root, excludePatterns: [] }]),
      streamCatalogKeyRows: vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        for (const batch of catalogRows) yield batch;
      }),
      insertLocalItems: vi.fn().mockImplementation((rows: Array<Record<string, unknown>>) => {
        inserted.push(...rows);
        return Promise.resolve(rows.length);
      }),
      markScanStarted: vi.fn().mockResolvedValue(undefined),
      markScanFinished: vi.fn().mockResolvedValue(undefined),
    },
  };
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
    const { repository, inserted } = makeRepository(root, [[{ remoteId: 'r1', title: 'Known', rawPayload: { calibre_path: 'Author/Known (1)' } }]]);

    const service = new LocalScanService(repository as never);
    const summary = await service.scanRoot(7);

    expect(summary.inserted).toBe(1);
    expect(summary.matched).toBe(1);
    expect(inserted).toEqual([
      expect.objectContaining({ mediaType: 'ebook', title: 'Missing', localPath: join(root, 'Author', 'Missing (2)', 'b.epub') }),
    ]);
  });

  it('gives every local row a deterministic namespaced remote id', async () => {
    const { repository, inserted } = makeRepository(root, [[]]);

    const service = new LocalScanService(repository as never);
    await service.scanRoot(7);

    expect(inserted).toHaveLength(2);
    for (const row of inserted) {
      expect(row.remoteId as string).toMatch(/^local:[0-9a-f]{64}$/);
    }
  });

  it('records scan start and finish on the root', async () => {
    const { repository } = makeRepository(root, [[]]);

    const service = new LocalScanService(repository as never);
    await service.scanRoot(7);

    expect(repository.markScanStarted).toHaveBeenCalledWith(7);
    expect(repository.markScanFinished).toHaveBeenCalledWith(7);
  });

  it('throws NotFoundException for an unknown root', async () => {
    const repository = {
      findEnabledRoots: vi.fn().mockResolvedValue([]),
      streamCatalogKeyRows: vi.fn(),
      insertLocalItems: vi.fn(),
      markScanStarted: vi.fn(),
      markScanFinished: vi.fn(),
    };

    const service = new LocalScanService(repository as never);
    await expect(service.scanRoot(99)).rejects.toThrow('Scan root 99 not found or disabled');
  });
});
