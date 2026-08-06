import { OidcCleanupJob } from './oidc-cleanup.job';

describe('OidcCleanupJob', () => {
  it('runs cleanup through oidcCleanupService and logs counts on success', async () => {
    const oidcCleanupService = {
      runCleanup: vi.fn().mockResolvedValue({ deletedSessions: 2, deletedStates: 1, deletedJtis: 0 }),
    };
    const job = new OidcCleanupJob(oidcCleanupService as never);
    const logSpy = vi.spyOn(job['logger'], 'log').mockImplementation(() => undefined);

    await job.runCleanup();

    expect(oidcCleanupService.runCleanup).toHaveBeenCalledTimes(1);
    const endLog = logSpy.mock.calls.find((args) => String(args[0]).includes('[end]'));
    expect(String(endLog![0])).toMatch('deletedSessions=2');
    expect(String(endLog![0])).toMatch('deletedStates=1');
    expect(String(endLog![0])).toMatch('deletedJtis=0');
  });

  it('logs error and does not throw when cleanup fails', async () => {
    const oidcCleanupService = {
      runCleanup: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    };
    const job = new OidcCleanupJob(oidcCleanupService as never);
    const errorSpy = vi.spyOn(job['logger'], 'error').mockImplementation(() => undefined);

    await expect(job.runCleanup()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching('[fail]'));
  });
});
