import { SearchIndexerService } from './search-indexer.service';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const repository = {
    claimBatch: vi.fn().mockResolvedValue([]),
    deleteEvents: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line require-yield -- models an empty stream, so it never yields a batch
    streamCatalogDocuments: vi.fn().mockImplementation(async function* () {
      await Promise.resolve();
    }),
    // eslint-disable-next-line require-yield -- models an empty stream, so it never yields a batch
    streamNativeDocuments: vi.fn().mockImplementation(async function* () {
      await Promise.resolve();
    }),
    ...overrides,
  };
  const client = {
    addDocuments: vi.fn().mockResolvedValue(undefined),
    deleteDocuments: vi.fn().mockResolvedValue(undefined),
    createIndex: vi.fn().mockResolvedValue(undefined),
    applySettings: vi.fn().mockResolvedValue(undefined),
    deleteIndex: vi.fn().mockResolvedValue(undefined),
  };
  const settings = {
    get: vi.fn().mockResolvedValue({
      enabled: true,
      url: 'http://m:7700',
      activeIndex: 'books',
      hasApiKey: true,
    }),
    getApiKey: vi.fn().mockResolvedValue('key'),
    save: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, client, settings };
}

const CATALOG_ROW = {
  mediaType: 'ebook',
  remoteId: '1',
  title: 'Title',
  sortTitle: null,
  authors: [],
  narrators: [],
  series: null,
  seriesIndex: null,
  publisher: null,
  language: null,
  tags: [],
  genres: [],
  identifiers: {},
  format: null,
  publishedYear: null,
  hasCover: false,
  durationSeconds: null,
  fileSizeBytes: null,
  syncedAt: null,
};

describe('SearchIndexerService', () => {
  it('does nothing when the outbox is empty', async () => {
    const { repository, client, settings } = makeDeps();
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.drain()).resolves.toEqual({ applied: 0, failed: 0 });
    expect(client.addDocuments).not.toHaveBeenCalled();
  });

  it('leaves events in the outbox when the write fails, so they retry', async () => {
    const { repository, client, settings } = makeDeps({
      claimBatch: vi.fn().mockResolvedValue([
        {
          id: 1,
          entityType: 'catalog_item',
          entityId: 'catalog:ebook:1',
          operation: 'delete',
        },
      ]),
    });
    client.deleteDocuments.mockRejectedValue(new Error('meili down'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    const result = await service.drain();

    expect(result.failed).toBeGreaterThan(0);
    expect(repository.deleteEvents).not.toHaveBeenCalled();
  });

  it('only activates the new index after the rebuild finishes', async () => {
    const { repository, client, settings } = makeDeps();
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await service.rebuild();

    const saveOrder = settings.save.mock.invocationCallOrder[0];
    const settingsOrder = client.applySettings.mock.invocationCallOrder[0];
    expect(saveOrder).toBeGreaterThan(settingsOrder);
    expect(settings.save).toHaveBeenCalledWith(
      expect.objectContaining({
        activeIndex: expect.stringContaining('bookorbit_books_rebuild_'),
      }),
    );
  });

  it('leaves the active index alone when the rebuild throws', async () => {
    const { repository, client, settings } = makeDeps();
    client.createIndex.mockRejectedValue(new Error('cannot create'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.rebuild()).rejects.toThrow();
    expect(settings.save).not.toHaveBeenCalled();
  });

  it('deletes the index it was building and rethrows the original error when population fails', async () => {
    const { repository, client, settings } = makeDeps({
      streamCatalogDocuments: vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield [CATALOG_ROW];
      }),
    });
    client.addDocuments.mockRejectedValue(new Error('write failed'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.rebuild()).rejects.toThrow('write failed');

    expect(client.deleteIndex).toHaveBeenCalledTimes(1);
    expect(client.deleteIndex.mock.calls[0][0]).toMatch(/^bookorbit_books_rebuild_/);
    expect(client.createIndex.mock.calls[0][0]).toBe(client.deleteIndex.mock.calls[0][0]);
  });

  it('still rethrows the original error when the cleanup delete also fails', async () => {
    const { repository, client, settings } = makeDeps({
      streamCatalogDocuments: vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield [CATALOG_ROW];
      }),
    });
    client.addDocuments.mockRejectedValue(new Error('write failed'));
    client.deleteIndex.mockRejectedValue(new Error('cleanup failed'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.rebuild()).rejects.toThrow('write failed');
  });

  it('never deletes the index if it happens to match the currently active index name', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const activeIndex = `bookorbit_books_rebuild_${Date.now()}`;

    const { repository, client, settings } = makeDeps({
      streamCatalogDocuments: vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield [CATALOG_ROW];
      }),
    });
    settings.get.mockResolvedValue({
      enabled: true,
      url: 'http://m:7700',
      activeIndex,
      hasApiKey: true,
    });
    client.addDocuments.mockRejectedValue(new Error('write failed'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.rebuild()).rejects.toThrow('write failed');

    expect(client.deleteIndex).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
