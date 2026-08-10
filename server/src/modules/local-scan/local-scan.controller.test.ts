import { LocalScanController } from './local-scan.controller';

describe('LocalScanController', () => {
  it('delegates a single root scan to the service', async () => {
    const service = {
      scanRoot: vi.fn().mockResolvedValue({ rootId: 7, scanned: 1, matched: 0, inserted: 1, skipped: 0 }),
      scanAll: vi.fn(),
    };
    const controller = new LocalScanController(service as never);

    await expect(controller.scanRoot(7)).resolves.toEqual({ rootId: 7, scanned: 1, matched: 0, inserted: 1, skipped: 0 });
    expect(service.scanRoot).toHaveBeenCalledWith(7);
  });

  it('delegates a full scan to the service', async () => {
    const service = { scanRoot: vi.fn(), scanAll: vi.fn().mockResolvedValue([]) };
    const controller = new LocalScanController(service as never);

    await expect(controller.scanAll()).resolves.toEqual([]);
    expect(service.scanAll).toHaveBeenCalled();
  });
});
