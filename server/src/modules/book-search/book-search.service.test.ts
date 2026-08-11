import { Logger } from '@nestjs/common';

import { BookSearchService } from './book-search.service';

const QUERY = { q: 'dune', page: 0, size: 10, userId: 1, accessibleLibraryIds: [] };

function makeService(
  meili: Partial<{ isAvailable: unknown; search: unknown }>,
  sqlSearch = vi.fn().mockResolvedValue({ ids: ['sql:1'], total: 1, page: 0, size: 10 }),
) {
  const meiliProvider = {
    name: 'meilisearch' as const,
    isAvailable: meili.isAvailable ?? vi.fn().mockResolvedValue(true),
    search: meili.search ?? vi.fn().mockResolvedValue({ ids: ['meili:1'], total: 1, page: 0, size: 10 }),
  };
  const sqlProvider = {
    name: 'sql' as const,
    isAvailable: vi.fn().mockResolvedValue(true),
    search: sqlSearch,
  };
  const settings = {
    get: vi.fn().mockResolvedValue({
      enabled: true,
      url: 'http://m:7700',
      activeIndex: 'i',
      hasApiKey: true,
    }),
  };
  return {
    service: new BookSearchService(meiliProvider as never, sqlProvider as never, settings as never),
    meiliProvider,
    sqlProvider,
  };
}

describe('BookSearchService', () => {
  it('uses Meilisearch when it is enabled and available', async () => {
    const { service, sqlProvider } = makeService({});

    await expect(service.search(QUERY)).resolves.toMatchObject({
      ids: ['meili:1'],
      provider: 'meilisearch',
    });
    expect(sqlProvider.search).not.toHaveBeenCalled();
  });

  it('falls back to SQL when Meilisearch is unavailable', async () => {
    const { service } = makeService({
      isAvailable: vi.fn().mockResolvedValue(false),
    });

    await expect(service.search(QUERY)).resolves.toMatchObject({
      ids: ['sql:1'],
      provider: 'sql',
    });
  });

  it('falls back to SQL when the Meilisearch search throws', async () => {
    const { service } = makeService({
      search: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    await expect(service.search(QUERY)).resolves.toMatchObject({
      ids: ['sql:1'],
      provider: 'sql',
    });
  });

  it('uses SQL without calling Meilisearch when the integration is disabled', async () => {
    const { service, meiliProvider } = makeService({});
    (service as unknown as { settings: { get: ReturnType<typeof vi.fn> } }).settings.get.mockResolvedValue({
      enabled: false,
      url: '',
      activeIndex: 'i',
      hasApiKey: false,
    });

    await expect(service.search(QUERY)).resolves.toMatchObject({
      provider: 'sql',
    });
    expect(meiliProvider.search).not.toHaveBeenCalled();
  });

  it('reports which provider served the last search', async () => {
    const { service } = makeService({
      isAvailable: vi.fn().mockResolvedValue(false),
    });

    await service.search(QUERY);

    expect(service.lastProvider()).toBe('sql');
  });

  it('falls back to SQL when the settings read throws', async () => {
    const { service } = makeService({});
    (service as unknown as { settings: { get: ReturnType<typeof vi.fn> } }).settings.get.mockRejectedValue(new Error('connection lost'));

    await expect(service.search(QUERY)).resolves.toMatchObject({
      ids: ['sql:1'],
      provider: 'sql',
    });
  });

  it('logs the user id and duration, without the query text, when falling back on unavailability', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeService({ isAvailable: vi.fn().mockResolvedValue(false) });

    await service.search(QUERY);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[book_search\.fallback\] \[end\] userId=1 durationMs=\d+ reason=unavailable - /));
    expect(warnSpy.mock.calls[0][0]).not.toContain('dune');
    warnSpy.mockRestore();
  });

  it('logs the user id, duration, and error class when Meilisearch search throws', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = makeService({ search: vi.fn().mockRejectedValue(new Error('connection refused')) });

    await service.search(QUERY);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[book_search\.fallback\] \[fail\] userId=1 durationMs=\d+ errorClass=Error error="connection refused" - /),
    );
    warnSpy.mockRestore();
  });
});
