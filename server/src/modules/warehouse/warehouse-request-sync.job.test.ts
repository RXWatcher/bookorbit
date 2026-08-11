import { Logger } from '@nestjs/common';

import type { WarehouseRequestSyncService, WarehouseRequestSyncSummary } from './warehouse-request-sync.service';
import { WarehouseRequestSyncJob } from './warehouse-request-sync.job';

function makeSummary(overrides: Partial<WarehouseRequestSyncSummary> = {}): WarehouseRequestSyncSummary {
  return {
    status: 'completed',
    scannedCount: 0,
    updatedCount: 0,
    notifiedCount: 0,
    catalogSyncCount: 0,
    errorCount: 0,
    ...overrides,
  };
}

function makeService(): jest.Mocked<WarehouseRequestSyncService> {
  return {
    syncDueRequests: vi.fn().mockResolvedValue(makeSummary()),
  } as unknown as jest.Mocked<WarehouseRequestSyncService>;
}

describe('WarehouseRequestSyncJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls syncDueRequests', async () => {
    const service = makeService();
    const job = new WarehouseRequestSyncJob(service);

    await job.runRequestSync();

    expect(service.syncDueRequests).toHaveBeenCalledTimes(1);
  });

  it('does not start a second sync while a previous run is still active', async () => {
    const service = makeService();
    let resolveSync!: (summary: WarehouseRequestSyncSummary) => void;
    const inFlight = new Promise<WarehouseRequestSyncSummary>((resolve) => {
      resolveSync = resolve;
    });
    service.syncDueRequests.mockReturnValueOnce(inFlight);
    const job = new WarehouseRequestSyncJob(service);

    const firstRun = job.runRequestSync();
    await Promise.resolve();

    await job.runRequestSync();
    expect(service.syncDueRequests).toHaveBeenCalledTimes(1);

    resolveSync(makeSummary());
    await firstRun;

    await job.runRequestSync();
    expect(service.syncDueRequests).toHaveBeenCalledTimes(2);
  });

  it('catches service errors and logs only a sanitized failure message', async () => {
    const service = makeService();
    service.syncDueRequests.mockRejectedValue(
      new Error('https://warehouse.example.test X-API-Key sk-secret upstream-request-123 raw upstream timeout'),
    );
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = new WarehouseRequestSyncJob(service);

    await expect(job.runRequestSync()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('Warehouse request sync failed');
    const loggedText = errorSpy.mock.calls.flat().map(String).join(' ');
    expect(loggedText).not.toContain('https://warehouse.example.test');
    expect(loggedText).not.toContain('X-API-Key');
    expect(loggedText).not.toContain('sk-secret');
    expect(loggedText).not.toContain('upstream-request-123');
    expect(loggedText).not.toContain('raw upstream timeout');
  });

  it.each([
    ['updated rows', makeSummary({ scannedCount: 3, updatedCount: 2, notifiedCount: 1, catalogSyncCount: 1 })],
    ['service errors', makeSummary({ status: 'failed', scannedCount: 4, errorCount: 1 })],
  ] as const)('logs a summary when work completes with %s', async (_label, summary) => {
    const service = makeService();
    service.syncDueRequests.mockResolvedValue(summary);
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const job = new WarehouseRequestSyncJob(service);

    await job.runRequestSync();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`status=${summary.status}`));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`scanned=${summary.scannedCount}`));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`updated=${summary.updatedCount}`));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`notified=${summary.notifiedCount}`));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`catalogSyncs=${summary.catalogSyncCount}`));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`errors=${summary.errorCount}`));
  });

  it('stays quiet for skipped/no-candidates', async () => {
    const service = makeService();
    service.syncDueRequests.mockResolvedValue(makeSummary({ status: 'skipped', skippedReason: 'no-candidates' }));
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = new WarehouseRequestSyncJob(service);

    await job.runRequestSync();

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
