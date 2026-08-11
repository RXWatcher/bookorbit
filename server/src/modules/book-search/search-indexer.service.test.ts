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
    addDocuments: vi.fn().mockResolvedValue(1),
    deleteDocuments: vi.fn().mockResolvedValue(2),
    createIndex: vi.fn().mockResolvedValue(undefined),
    applySettings: vi.fn().mockResolvedValue(undefined),
    deleteIndex: vi.fn().mockResolvedValue(undefined),
    waitForTask: vi.fn().mockResolvedValue(undefined),
  };
  // The stored active index has to move when save() is called, because the rebuild reads it
  // back to confirm the flip landed before it deletes the index it replaced.
  const state = { activeIndex: 'bookorbit_books' };
  const settings = {
    get: vi.fn().mockImplementation(() =>
      Promise.resolve({
        enabled: true,
        url: 'http://m:7700',
        activeIndex: state.activeIndex,
        hasApiKey: true,
      }),
    ),
    getApiKey: vi.fn().mockResolvedValue('key'),
    save: vi.fn().mockImplementation((input: { activeIndex?: string }) => {
      if (input.activeIndex) state.activeIndex = input.activeIndex;
      return Promise.resolve(undefined);
    }),
  };
  return { repository, client, settings, state };
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

  it('applies a delete before a later reinsert of the same document', async () => {
    const { repository, client, settings } = makeDeps({
      claimBatch: vi.fn().mockResolvedValue([
        { id: 1, entityType: 'catalog_item', entityId: 'catalog:ebook:1', operation: 'upsert' },
        { id: 2, entityType: 'catalog_item', entityId: 'catalog:ebook:1', operation: 'delete' },
        { id: 3, entityType: 'catalog_item', entityId: 'catalog:ebook:1', operation: 'upsert' },
      ]),
      getCatalogRowsByKeys: vi.fn().mockResolvedValue([CATALOG_ROW]),
      getNativeRowsByIds: vi.fn().mockResolvedValue([]),
    });
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.drain()).resolves.toEqual({ applied: 3, failed: 0 });

    // The reinsert must be the last thing Meilisearch sees, otherwise the document that the
    // batch ends with present has been deleted.
    expect(client.addDocuments.mock.invocationCallOrder[0]).toBeLessThan(client.deleteDocuments.mock.invocationCallOrder[0]);
    expect(client.addDocuments.mock.invocationCallOrder[1]).toBeGreaterThan(client.deleteDocuments.mock.invocationCallOrder[0]);
    expect(repository.deleteEvents).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('keeps a failed batch and everything after it in the outbox', async () => {
    const { repository, client, settings } = makeDeps({
      claimBatch: vi.fn().mockResolvedValue([
        { id: 1, entityType: 'catalog_item', entityId: 'catalog:ebook:1', operation: 'delete' },
        { id: 2, entityType: 'catalog_item', entityId: 'catalog:ebook:1', operation: 'upsert' },
      ]),
      getCatalogRowsByKeys: vi.fn().mockResolvedValue([CATALOG_ROW]),
      getNativeRowsByIds: vi.fn().mockResolvedValue([]),
    });
    client.deleteDocuments.mockRejectedValue(new Error('meili down'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.drain()).resolves.toEqual({ applied: 0, failed: 2 });

    expect(client.addDocuments).not.toHaveBeenCalled();
    expect(repository.deleteEvents).not.toHaveBeenCalled();
  });

  it('keeps the events when the submitted task never succeeds', async () => {
    const { repository, client, settings } = makeDeps({
      claimBatch: vi.fn().mockResolvedValue([{ id: 1, entityType: 'catalog_item', entityId: 'catalog:ebook:1', operation: 'delete' }]),
    });
    client.waitForTask.mockRejectedValue(new Error('task failed'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.drain()).resolves.toEqual({ applied: 0, failed: 1 });

    expect(client.waitForTask).toHaveBeenCalledWith(2);
    expect(repository.deleteEvents).not.toHaveBeenCalled();
  });

  it('waits for the last indexing task before activating the rebuilt index', async () => {
    const { repository, client, settings } = makeDeps({
      streamCatalogDocuments: vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield [CATALOG_ROW];
      }),
    });
    client.addDocuments.mockResolvedValue(77);
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await service.rebuild();

    expect(client.waitForTask).toHaveBeenCalledWith(77, expect.any(Number));
    expect(client.waitForTask.mock.invocationCallOrder[0]).toBeLessThan(settings.save.mock.invocationCallOrder[0]);
  });

  it('does not activate a rebuilt index whose last task never succeeded', async () => {
    const { repository, client, settings } = makeDeps({
      streamCatalogDocuments: vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        yield [CATALOG_ROW];
      }),
    });
    client.addDocuments.mockResolvedValue(77);
    client.waitForTask.mockRejectedValue(new Error('task failed'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.rebuild()).rejects.toThrow('task failed');
    expect(settings.save).not.toHaveBeenCalled();
    expect(client.deleteIndex).toHaveBeenCalledTimes(1);
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

  it('deletes the index it replaced once the pointer has been flipped', async () => {
    const { repository, client, settings } = makeDeps();
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    const { index } = await service.rebuild();

    expect(client.deleteIndex).toHaveBeenCalledTimes(1);
    expect(client.deleteIndex).toHaveBeenCalledWith('bookorbit_books');
    expect(client.deleteIndex.mock.invocationCallOrder[0]).toBeGreaterThan(settings.save.mock.invocationCallOrder[0]);
    expect(client.deleteIndex).not.toHaveBeenCalledWith(index);
  });

  it('deletes a previous rebuild index, which is what the active pointer normally names', async () => {
    const { repository, client, settings, state } = makeDeps();
    state.activeIndex = 'bookorbit_books_rebuild_1700000000000';
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await service.rebuild();

    expect(client.deleteIndex).toHaveBeenCalledWith('bookorbit_books_rebuild_1700000000000');
  });

  it('refuses to delete an index this module does not own', async () => {
    const { repository, client, settings, state } = makeDeps();
    state.activeIndex = 'silo_media_items_rebuild_1785187701';
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await service.rebuild();

    expect(client.deleteIndex).not.toHaveBeenCalled();
  });

  it('refuses to delete the index it just activated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { repository, client, settings, state } = makeDeps();
    state.activeIndex = `bookorbit_books_rebuild_${Date.now()}`;
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    const { index } = await service.rebuild();

    expect(index).toBe(state.activeIndex);
    expect(client.deleteIndex).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('completes the rebuild even when deleting the replaced index fails', async () => {
    const { repository, client, settings } = makeDeps();
    client.deleteIndex.mockRejectedValue(new Error('delete refused'));
    const service = new SearchIndexerService(repository as never, settings as never);
    (service as unknown as { clientFor: () => unknown }).clientFor = () => client;

    await expect(service.rebuild()).resolves.toMatchObject({ indexed: 0 });
    expect(settings.save).toHaveBeenCalled();
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
