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
});
