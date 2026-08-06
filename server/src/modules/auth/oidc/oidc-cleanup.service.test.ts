import { OidcCleanupService } from './oidc-cleanup.service';

function makeDb() {
  const chain = {
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };
  return {
    delete: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

describe('OidcCleanupService', () => {
  let service: OidcCleanupService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    service = new OidcCleanupService(db as never);
  });

  it('deletes expired/revoked sessions, expired states, and expired JTIs in parallel and returns counts', async () => {
    db._chain.returning
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ state: 'abc' }])
      .mockResolvedValueOnce([]);

    const result = await service.runCleanup();

    expect(db.delete).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ deletedSessions: 2, deletedStates: 1, deletedJtis: 0 });
  });

  it('returns correct counts for each deleted entity type', async () => {
    db._chain.returning
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ state: 'xyz' }])
      .mockResolvedValueOnce([{ jti: 'jti-1' }, { jti: 'jti-2' }]);

    const result = await service.runCleanup();

    expect(result).toEqual({ deletedSessions: 1, deletedStates: 1, deletedJtis: 2 });
  });

  it('propagates errors to the caller', async () => {
    db._chain.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(service.runCleanup()).rejects.toThrow('DB connection lost');
  });
});
