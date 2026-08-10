import { LocalScanController } from './local-scan.controller';

describe('LocalScanController', () => {
  const enrich = { runInBackground: vi.fn() };

  it('validates the root before detaching, then starts it', async () => {
    const service = {
      assertScannable: vi.fn().mockResolvedValue(undefined),
      runInBackground: vi.fn(),
      runAllInBackground: vi.fn(),
      getStatuses: vi.fn(),
    };
    const controller = new LocalScanController(service as never, enrich as never);

    await expect(controller.scanRoot(7)).resolves.toEqual({ started: true, rootId: 7 });
    expect(service.assertScannable).toHaveBeenCalledWith(7);
    expect(service.runInBackground).toHaveBeenCalledWith(7);
  });

  it('does not start a run when the root is unknown', async () => {
    const service = {
      assertScannable: vi.fn().mockRejectedValue(new Error('Scan root 99 not found or disabled')),
      runInBackground: vi.fn(),
      runAllInBackground: vi.fn(),
      getStatuses: vi.fn(),
    };
    const controller = new LocalScanController(service as never, enrich as never);

    await expect(controller.scanRoot(99)).rejects.toThrow('not found or disabled');
    expect(service.runInBackground).not.toHaveBeenCalled();
  });

  it('detaches the enrichment run', () => {
    const service = { assertScannable: vi.fn(), runInBackground: vi.fn(), runAllInBackground: vi.fn(), getStatuses: vi.fn() };
    const controller = new LocalScanController(service as never, enrich as never);

    expect(controller.enrich()).toEqual({ started: true });
    expect(enrich.runInBackground).toHaveBeenCalled();
  });

  it('detaches a full scan', () => {
    const service = { assertScannable: vi.fn(), runInBackground: vi.fn(), runAllInBackground: vi.fn(), getStatuses: vi.fn() };
    const controller = new LocalScanController(service as never, enrich as never);

    expect(controller.scanAll()).toEqual({ started: true });
    expect(service.runAllInBackground).toHaveBeenCalled();
  });

  it('exposes root status for polling', () => {
    const statuses = [{ id: 1, lastScanStatus: 'completed' }];
    const service = {
      assertScannable: vi.fn(),
      runInBackground: vi.fn(),
      runAllInBackground: vi.fn(),
      getStatuses: vi.fn().mockReturnValue(statuses),
    };
    const controller = new LocalScanController(service as never, enrich as never);

    expect(controller.getStatuses()).toBe(statuses);
  });
});
