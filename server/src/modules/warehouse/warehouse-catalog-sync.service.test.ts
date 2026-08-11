import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

import type { WarehouseSettingRow, WarehouseCatalogSyncRunRow } from '../../db/schema';
import { WarehouseClientService } from './warehouse-client.service';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService } from './warehouse-secret.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseApiError } from './warehouse.errors';

const CREATED_AT = new Date('2026-06-02T10:00:00.000Z');
const UPDATED_AT = new Date('2026-06-02T10:05:00.000Z');

function makeSettingsRow(overrides: Partial<WarehouseSettingRow> = {}): WarehouseSettingRow {
  return {
    id: 1,
    profileKey: 'default',
    enabled: true,
    baseUrl: 'https://catalog-source.example.test',
    apiKeyEncrypted: 'ciphertext',
    apiKeyNonce: 'nonce',
    apiKeyTag: 'tag',
    syncCadenceMinutes: 360,
    lastConnectionStatus: 'untested',
    lastConnectionCheckedAt: null,
    lastConnectionError: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeSyncRunRow(overrides: Partial<WarehouseCatalogSyncRunRow> = {}): WarehouseCatalogSyncRunRow {
  return {
    id: 77,
    mediaType: 'ebook',
    status: 'running',
    startedAt: new Date('2026-06-02T11:00:00.000Z'),
    finishedAt: null,
    fetchedCount: 0,
    savedCount: 0,
    errorMessage: null,
    timings: {},
    ...overrides,
  };
}

function makeRepo(): jest.Mocked<WarehouseRepository> {
  return {
    findSettings: vi.fn(),
    findLatestSyncRun: vi.fn(),
    findRunningSyncRun: vi.fn(),
    listRunningSyncRuns: vi.fn(),
    createSyncRun: vi.fn(),
    updateSyncRunProgress: vi.fn().mockResolvedValue(undefined),
    completeSyncRun: vi.fn().mockResolvedValue(undefined),
    failSyncRun: vi.fn().mockResolvedValue(undefined),
    upsertCatalogItems: vi.fn(),
  } as unknown as jest.Mocked<WarehouseRepository>;
}

function makeSecret(): jest.Mocked<WarehouseSecretService> {
  return {
    decrypt: vi.fn().mockReturnValue('plain-api-key'),
  } as unknown as jest.Mocked<WarehouseSecretService>;
}

function makeClient(): jest.Mocked<WarehouseClientService> {
  return {
    listBooks: vi.fn(),
    listAudiobooks: vi.fn(),
    listComics: vi.fn(),
  } as unknown as jest.Mocked<WarehouseClientService>;
}

describe('WarehouseCatalogSyncService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let secret: ReturnType<typeof makeSecret>;
  let client: ReturnType<typeof makeClient>;
  let service: WarehouseCatalogSyncService;

  beforeEach(() => {
    repo = makeRepo();
    secret = makeSecret();
    client = makeClient();
    repo.listRunningSyncRuns.mockResolvedValue([]);
    service = new WarehouseCatalogSyncService(repo, secret, client);
  });

  it('syncs every catalog media type when populating all catalog caches', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun
      .mockResolvedValueOnce(makeSyncRunRow({ id: 201, mediaType: 'ebook' }))
      .mockResolvedValueOnce(makeSyncRunRow({ id: 202, mediaType: 'audiobook' }))
      .mockResolvedValueOnce(makeSyncRunRow({ id: 203, mediaType: 'comic' }));
    repo.upsertCatalogItems.mockResolvedValue(1);
    client.listBooks.mockResolvedValue({ items: [{ id: 'ebook-1', title: 'Ebook One' }], total: 1 });
    client.listAudiobooks.mockResolvedValue({ items: [{ id: 'audio-1', title: 'Audio One' }], total: 1 });
    client.listComics.mockResolvedValue({ items: [{ id: 'comic-1', title: 'Comic One' }], total: 1 });

    await expect(service.syncAll()).resolves.toEqual([
      expect.objectContaining({ mediaType: 'ebook', status: 'completed', fetchedCount: 1, savedCount: 1 }),
      expect.objectContaining({ mediaType: 'audiobook', status: 'completed', fetchedCount: 1, savedCount: 1 }),
      expect.objectContaining({ mediaType: 'comic', status: 'completed', fetchedCount: 1, savedCount: 1 }),
    ]);
    expect(client.listBooks).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://catalog-source.example.test', apiKey: 'plain-api-key', page: 1, limit: 100 }),
    );
    expect(client.listAudiobooks).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://catalog-source.example.test', apiKey: 'plain-api-key', page: 1, limit: 100 }),
    );
    expect(client.listComics).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://catalog-source.example.test', apiKey: 'plain-api-key', page: 1, limit: 100 }),
    );
  });

  it('returns sync state from latest overall and per-media catalog sync runs', async () => {
    repo.findLatestSyncRun
      .mockResolvedValueOnce(
        makeSyncRunRow({
          id: 101,
          mediaType: 'audiobook',
          status: 'completed',
          fetchedCount: 55,
          savedCount: 54,
          timings: { totalCount: 60 },
          finishedAt: new Date('2026-06-02T11:10:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        makeSyncRunRow({
          id: 99,
          mediaType: 'ebook',
          status: 'completed',
          fetchedCount: 20,
          savedCount: 19,
          timings: { totalCount: 25 },
          startedAt: new Date('2026-06-02T10:00:00.000Z'),
          finishedAt: new Date('2026-06-02T10:05:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        makeSyncRunRow({
          id: 101,
          mediaType: 'audiobook',
          status: 'completed',
          fetchedCount: 55,
          savedCount: 54,
          timings: { totalCount: 60 },
          finishedAt: new Date('2026-06-02T11:10:00.000Z'),
        }),
      );
    repo.listRunningSyncRuns.mockResolvedValue([]);

    await expect(service.getSyncState()).resolves.toEqual({
      lastRun: {
        runId: 101,
        status: 'completed',
        mediaType: 'audiobook',
        fetchedCount: 55,
        savedCount: 54,
        totalCount: 60,
        errorMessage: null,
        startedAt: '2026-06-02T11:00:00.000Z',
        finishedAt: '2026-06-02T11:10:00.000Z',
      },
      lastRuns: {
        ebook: {
          runId: 99,
          status: 'completed',
          mediaType: 'ebook',
          fetchedCount: 20,
          savedCount: 19,
          totalCount: 25,
          errorMessage: null,
          startedAt: '2026-06-02T10:00:00.000Z',
          finishedAt: '2026-06-02T10:05:00.000Z',
        },
        audiobook: {
          runId: 101,
          status: 'completed',
          mediaType: 'audiobook',
          fetchedCount: 55,
          savedCount: 54,
          totalCount: 60,
          errorMessage: null,
          startedAt: '2026-06-02T11:00:00.000Z',
          finishedAt: '2026-06-02T11:10:00.000Z',
        },
        comic: null,
      },
      running: false,
    });
    expect(repo.findLatestSyncRun).toHaveBeenNthCalledWith(1);
    expect(repo.findLatestSyncRun).toHaveBeenNthCalledWith(2, 'ebook');
    expect(repo.findLatestSyncRun).toHaveBeenNthCalledWith(3, 'audiobook');
    expect(repo.findLatestSyncRun).toHaveBeenNthCalledWith(4, 'comic');
    expect(repo.listRunningSyncRuns).toHaveBeenCalledWith();
  });

  it('marks database running rows as interrupted when this process is not syncing them', async () => {
    const interrupted = makeSyncRunRow({
      id: 102,
      status: 'failed',
      errorMessage: 'Catalog source sync was interrupted before it could finish.',
      finishedAt: new Date('2026-06-02T12:00:00.000Z'),
    });
    repo.findLatestSyncRun.mockResolvedValueOnce(interrupted).mockResolvedValueOnce(interrupted).mockResolvedValueOnce(null);
    repo.listRunningSyncRuns.mockResolvedValue([makeSyncRunRow({ id: 102 })]);

    await expect(service.getSyncState()).resolves.toEqual({
      lastRun: {
        runId: 102,
        status: 'failed',
        mediaType: 'ebook',
        fetchedCount: 0,
        savedCount: 0,
        totalCount: null,
        errorMessage: 'Catalog source sync was interrupted before it could finish.',
        startedAt: '2026-06-02T11:00:00.000Z',
        finishedAt: '2026-06-02T12:00:00.000Z',
      },
      lastRuns: {
        ebook: {
          runId: 102,
          status: 'failed',
          mediaType: 'ebook',
          fetchedCount: 0,
          savedCount: 0,
          totalCount: null,
          errorMessage: 'Catalog source sync was interrupted before it could finish.',
          startedAt: '2026-06-02T11:00:00.000Z',
          finishedAt: '2026-06-02T12:00:00.000Z',
        },
        audiobook: null,
        comic: null,
      },
      running: false,
    });
    expect(repo.failSyncRun).toHaveBeenCalledWith(102, 'Catalog source sync was interrupted before it could finish.', {
      fetchedCount: 0,
      savedCount: 0,
    });
  });

  it('keeps an in-process sync marked as running', async () => {
    const activeRun = makeSyncRunRow({ id: 102, mediaType: 'ebook' });
    let resolveList: (value: { items: []; total: number }) => void = () => {};
    const pendingList = new Promise<{ items: []; total: number }>((resolve) => {
      resolveList = resolve;
    });

    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(activeRun);
    repo.upsertCatalogItems.mockResolvedValue(0);
    client.listBooks.mockReturnValue(pendingList as ReturnType<typeof client.listBooks>);

    const syncPromise = service.syncEbooks();
    await Promise.resolve();
    await Promise.resolve();

    repo.listRunningSyncRuns.mockResolvedValue([activeRun]);
    repo.findLatestSyncRun.mockResolvedValue(activeRun);

    await expect(service.getSyncState()).resolves.toMatchObject({
      lastRun: {
        runId: 102,
        status: 'running',
      },
      running: true,
    });
    expect(repo.failSyncRun).not.toHaveBeenCalled();

    resolveList({ items: [], total: 0 });
    await expect(syncPromise).resolves.toMatchObject({ status: 'completed', runId: 102 });
  });

  it('keeps multiple in-process syncs marked as running', async () => {
    const ebookRun = makeSyncRunRow({ id: 201, mediaType: 'ebook' });
    const audiobookRun = makeSyncRunRow({ id: 202, mediaType: 'audiobook' });
    let resolveBooks: (value: { items: []; total: number }) => void = () => {};
    let resolveAudiobooks: (value: { items: []; total: number }) => void = () => {};
    const pendingBooks = new Promise<{ items: []; total: number }>((resolve) => {
      resolveBooks = resolve;
    });
    const pendingAudiobooks = new Promise<{ items: []; total: number }>((resolve) => {
      resolveAudiobooks = resolve;
    });

    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValueOnce(ebookRun).mockResolvedValueOnce(audiobookRun);
    repo.upsertCatalogItems.mockResolvedValue(0);
    client.listBooks.mockReturnValue(pendingBooks as ReturnType<typeof client.listBooks>);
    client.listAudiobooks.mockReturnValue(pendingAudiobooks as ReturnType<typeof client.listAudiobooks>);

    const ebookPromise = service.syncEbooks();
    const audiobookPromise = service.syncAudiobooks();
    await Promise.resolve();
    await Promise.resolve();

    repo.listRunningSyncRuns.mockResolvedValue([audiobookRun, ebookRun]);
    repo.findLatestSyncRun.mockResolvedValue(audiobookRun);

    await expect(service.getSyncState()).resolves.toMatchObject({
      lastRun: {
        runId: 202,
        status: 'running',
      },
      running: true,
    });
    expect(repo.failSyncRun).not.toHaveBeenCalled();

    resolveBooks({ items: [], total: 0 });
    resolveAudiobooks({ items: [], total: 0 });
    await expect(ebookPromise).resolves.toMatchObject({ status: 'completed', runId: 201 });
    await expect(audiobookPromise).resolves.toMatchObject({ status: 'completed', runId: 202 });
  });

  it('leaves a fresh externally owned running sync alone', async () => {
    const externalRun = makeSyncRunRow({
      id: 301,
      mediaType: 'audiobook',
      startedAt: new Date(),
      timings: {
        ownerToken: 999,
        lastProgressAtMs: Date.now(),
      },
    });
    repo.listRunningSyncRuns.mockResolvedValue([externalRun]);
    repo.findLatestSyncRun.mockResolvedValue(externalRun);

    await expect(service.getSyncState()).resolves.toMatchObject({
      lastRun: {
        runId: 301,
        status: 'running',
        mediaType: 'audiobook',
      },
      running: true,
    });
    expect(repo.failSyncRun).not.toHaveBeenCalled();
  });

  it('does not let a later completed sync mask an interrupted older running sync', async () => {
    repo.findLatestSyncRun
      .mockResolvedValueOnce(
        makeSyncRunRow({
          id: 120,
          mediaType: 'audiobook',
          status: 'completed',
          finishedAt: new Date('2026-06-02T13:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        makeSyncRunRow({
          id: 102,
          mediaType: 'ebook',
          status: 'failed',
          errorMessage: 'Catalog source sync was interrupted before it could finish.',
          finishedAt: new Date('2026-06-02T12:15:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        makeSyncRunRow({
          id: 120,
          mediaType: 'audiobook',
          status: 'completed',
          finishedAt: new Date('2026-06-02T13:00:00.000Z'),
        }),
      );
    repo.listRunningSyncRuns.mockResolvedValue([makeSyncRunRow({ id: 102, mediaType: 'ebook' })]);

    await expect(service.getSyncState()).resolves.toMatchObject({
      lastRun: {
        runId: 120,
        status: 'completed',
        mediaType: 'audiobook',
      },
      lastRuns: {
        ebook: {
          runId: 102,
          status: 'failed',
          mediaType: 'ebook',
        },
        audiobook: {
          runId: 120,
          status: 'completed',
          mediaType: 'audiobook',
        },
      },
      running: false,
    });
    expect(repo.failSyncRun).toHaveBeenCalledWith(102, 'Catalog source sync was interrupted before it could finish.', {
      fetchedCount: 0,
      savedCount: 0,
    });
  });

  it('returns null per-media sync state when that media has not synced', async () => {
    repo.findLatestSyncRun.mockResolvedValue(null);
    repo.listRunningSyncRuns.mockResolvedValue([]);

    await expect(service.getSyncState()).resolves.toEqual({
      lastRun: null,
      lastRuns: {
        ebook: null,
        audiobook: null,
        comic: null,
      },
      running: false,
    });
  });

  it('rejects when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.syncEbooks()).rejects.toThrow(BadRequestException);
    await expect(service.syncEbooks()).rejects.toThrow('catalog source');
    expect(repo.createSyncRun).not.toHaveBeenCalled();
    expect(secret.decrypt).not.toHaveBeenCalled();
  });

  it('rejects when credentials are missing', async () => {
    repo.findSettings.mockResolvedValue(
      makeSettingsRow({
        apiKeyEncrypted: null,
        apiKeyNonce: null,
        apiKeyTag: null,
      }),
    );

    await expect(service.syncEbooks()).rejects.toThrow(BadRequestException);
    expect(repo.createSyncRun).not.toHaveBeenCalled();
    expect(secret.decrypt).not.toHaveBeenCalled();
  });

  it('rejects when stored credentials cannot be decrypted', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    secret.decrypt.mockImplementation(() => {
      throw new Error('auth failure');
    });

    await expect(service.syncEbooks()).rejects.toThrow(BadRequestException);
    await expect(service.syncEbooks()).rejects.toThrow('could not be decrypted');
    expect(repo.createSyncRun).not.toHaveBeenCalled();
  });

  it('sanitizes sync run startup failures without recording a failed run', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ baseUrl: 'https://catalog-source.example.test/root' }));
    repo.createSyncRun.mockRejectedValue(new Error('insert failed for https://catalog-source.example.test/root with X-API-Key top-secret-key'));

    try {
      await service.syncEbooks();
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as Error).message).toBe('Catalog source sync failed. Try again later.');
      expect((error as Error).message).not.toContain('Book Warehouse');
      expect((error as Error).message).not.toContain('insert failed');
      expect((error as Error).message).not.toContain('https://catalog-source.example.test/root');
      expect((error as Error).message).not.toContain('top-secret-key');
    }

    expect(repo.failSyncRun).not.toHaveBeenCalled();
  });

  it('pages until a page returns fewer than the max limit', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow());
    repo.upsertCatalogItems.mockResolvedValueOnce(100).mockResolvedValueOnce(23);
    client.listBooks
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => ({ id: `book-${index + 1}`, title: `Book ${index + 1}` })),
        page: 1,
        limit: 100,
        total: null,
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 23 }, (_, index) => ({ id: `book-${index + 101}`, title: `Book ${index + 101}` })),
        page: 2,
        limit: 100,
        total: null,
        hasNextPage: false,
      });

    const summary = await service.syncEbooks();

    expect(client.listBooks).toHaveBeenCalledTimes(2);
    expect(client.listBooks).toHaveBeenNthCalledWith(1, {
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'plain-api-key',
      page: 1,
      limit: 100,
      timeoutMs: 30000,
    });
    expect(client.listBooks).toHaveBeenNthCalledWith(2, {
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'plain-api-key',
      page: 2,
      limit: 100,
      timeoutMs: 30000,
    });
    expect(repo.upsertCatalogItems).toHaveBeenCalledTimes(2);
    expect(repo.updateSyncRunProgress).toHaveBeenNthCalledWith(
      1,
      77,
      { fetchedCount: 100, savedCount: 100 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.updateSyncRunProgress).toHaveBeenNthCalledWith(
      2,
      77,
      { fetchedCount: 123, savedCount: 123 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      77,
      { fetchedCount: 123, savedCount: 123 },
      expect.objectContaining({ completedPage: 2, currentPage: 2 }),
    );
    expect(summary).toMatchObject({
      runId: 77,
      status: 'completed',
      mediaType: 'ebook',
      fetchedCount: 123,
      savedCount: 123,
      errorMessage: null,
      startedAt: '2026-06-02T11:00:00.000Z',
    });
    expect(summary.finishedAt).toEqual(expect.any(String));
  });

  it('records the upstream total count in sync progress and the returned summary', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 118 }));
    repo.upsertCatalogItems.mockResolvedValueOnce(2);
    client.listBooks.mockResolvedValueOnce({
      items: [
        { id: 'book-1', title: 'Book 1' },
        { id: 'book-2', title: 'Book 2' },
      ],
      total: 25,
    });

    const summary = await service.syncEbooks();

    expect(repo.updateSyncRunProgress).toHaveBeenCalledWith(
      118,
      { fetchedCount: 2, savedCount: 2 },
      expect.objectContaining({ currentPage: 1, totalCount: 25 }),
    );
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      118,
      { fetchedCount: 2, savedCount: 2 },
      expect.objectContaining({ completedPage: 1, currentPage: 1, totalCount: 25 }),
    );
    expect(summary).toMatchObject({
      fetchedCount: 2,
      savedCount: 2,
      totalCount: 25,
    });
  });

  it('stops at the upstream total when provided', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 88 }));
    repo.upsertCatalogItems.mockResolvedValue(100);
    client.listBooks.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({ id: `book-${index + 1}`, title: `Book ${index + 1}` })),
      page: 1,
      limit: 100,
      total: 100,
      hasNextPage: true,
    });

    const summary = await service.syncEbooks();

    expect(client.listBooks).toHaveBeenCalledTimes(1);
    expect(repo.updateSyncRunProgress).toHaveBeenCalledWith(
      88,
      { fetchedCount: 100, savedCount: 100 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      88,
      { fetchedCount: 100, savedCount: 100 },
      expect.objectContaining({ completedPage: 1, currentPage: 1 }),
    );
    expect(summary.fetchedCount).toBe(100);
    expect(summary.savedCount).toBe(100);
  });

  it('records completed run counts', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 91 }));
    repo.upsertCatalogItems.mockResolvedValue(2);
    client.listBooks.mockResolvedValue({
      items: [
        { id: 'book-1', title: 'Book 1', author: 'Ada Writer' },
        { id: 'book-2', title: 'Book 2', authors: ['Bea Writer'] },
      ],
      page: 1,
      limit: 100,
      total: 2,
      hasNextPage: false,
    });

    const summary = await service.syncEbooks();

    expect(repo.createSyncRun).toHaveBeenCalledWith(
      'ebook',
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.updateSyncRunProgress).toHaveBeenCalledWith(
      91,
      { fetchedCount: 2, savedCount: 2 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      91,
      { fetchedCount: 2, savedCount: 2 },
      expect.objectContaining({ completedPage: 1, currentPage: 1 }),
    );
    expect(summary).toMatchObject({
      runId: 91,
      status: 'completed',
      mediaType: 'ebook',
      fetchedCount: 2,
      savedCount: 2,
      errorMessage: null,
    });
  });

  it('records a failed run on client or repository error with a safe message', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ baseUrl: 'https://catalog-source.example.test/root' }));
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 99 }));
    client.listBooks.mockRejectedValue(
      new Error('Book Warehouse outage at https://catalog-source.example.test/root/books with X-API-Key top-secret-key'),
    );

    await expect(service.syncEbooks()).rejects.toThrow('Catalog source sync failed. Try again later.');

    expect(repo.updateSyncRunProgress).toHaveBeenCalledWith(
      99,
      { fetchedCount: 0, savedCount: 0 },
      expect.objectContaining({ currentPage: 1, currentAttempt: 1, maxAttempts: 3 }),
    );
    expect(repo.failSyncRun).toHaveBeenCalledTimes(1);
    const [runId, errorMessage, counts] = repo.failSyncRun.mock.calls[0]!;
    expect(runId).toBe(99);
    expect(errorMessage).toBe('Catalog source sync failed. Try again later.');
    expect(errorMessage).not.toContain('Book Warehouse');
    expect(errorMessage).not.toContain('https://catalog-source.example.test/root');
    expect(errorMessage).not.toContain('top-secret-key');
    expect(counts).toEqual({ fetchedCount: 0, savedCount: 0 });
  });

  it('rejects audiobook sync when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.syncAudiobooks()).rejects.toThrow(BadRequestException);
    expect(repo.createSyncRun).not.toHaveBeenCalled();
    expect(secret.decrypt).not.toHaveBeenCalled();
  });

  it('rejects audiobook sync when credentials are missing', async () => {
    repo.findSettings.mockResolvedValue(
      makeSettingsRow({
        apiKeyEncrypted: null,
        apiKeyNonce: null,
        apiKeyTag: null,
      }),
    );

    await expect(service.syncAudiobooks()).rejects.toThrow(BadRequestException);
    expect(repo.createSyncRun).not.toHaveBeenCalled();
    expect(secret.decrypt).not.toHaveBeenCalled();
  });

  it('rejects audiobook sync when stored credentials cannot be decrypted', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    secret.decrypt.mockImplementation(() => {
      throw new Error('auth failure');
    });

    await expect(service.syncAudiobooks()).rejects.toThrow(BadRequestException);
    await expect(service.syncAudiobooks()).rejects.toThrow('could not be decrypted');
    expect(repo.createSyncRun).not.toHaveBeenCalled();
  });

  it('pages audiobook sync until a page returns fewer than the max limit', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ mediaType: 'audiobook' }));
    repo.upsertCatalogItems.mockResolvedValueOnce(100).mockResolvedValueOnce(12);
    client.listAudiobooks
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => ({ id: `audio-${index + 1}`, title: `Audio ${index + 1}` })),
        page: 1,
        limit: 100,
        total: null,
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 12 }, (_, index) => ({ id: `audio-${index + 101}`, title: `Audio ${index + 101}` })),
        page: 2,
        limit: 100,
        total: null,
        hasNextPage: false,
      });

    const summary = await service.syncAudiobooks();

    expect(client.listAudiobooks).toHaveBeenCalledTimes(2);
    expect(client.listAudiobooks).toHaveBeenNthCalledWith(1, {
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'plain-api-key',
      page: 1,
      limit: 100,
      timeoutMs: 30000,
    });
    expect(client.listAudiobooks).toHaveBeenNthCalledWith(2, {
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'plain-api-key',
      page: 2,
      limit: 100,
      timeoutMs: 30000,
    });
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      77,
      { fetchedCount: 112, savedCount: 112 },
      expect.objectContaining({ completedPage: 2, currentPage: 2 }),
    );
    expect(repo.updateSyncRunProgress).toHaveBeenNthCalledWith(
      1,
      77,
      { fetchedCount: 100, savedCount: 100 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.updateSyncRunProgress).toHaveBeenNthCalledWith(
      2,
      77,
      { fetchedCount: 112, savedCount: 112 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(summary).toMatchObject({
      runId: 77,
      status: 'completed',
      mediaType: 'audiobook',
      fetchedCount: 112,
      savedCount: 112,
      errorMessage: null,
    });
  });

  it('stops audiobook sync at the upstream total when provided', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 108, mediaType: 'audiobook' }));
    repo.upsertCatalogItems.mockResolvedValue(100);
    client.listAudiobooks.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, index) => ({ id: `audio-${index + 1}`, title: `Audio ${index + 1}` })),
      page: 1,
      limit: 100,
      total: 100,
      hasNextPage: true,
    });

    const summary = await service.syncAudiobooks();

    expect(client.listAudiobooks).toHaveBeenCalledTimes(1);
    expect(repo.updateSyncRunProgress).toHaveBeenCalledWith(
      108,
      { fetchedCount: 100, savedCount: 100 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      108,
      { fetchedCount: 100, savedCount: 100 },
      expect.objectContaining({ completedPage: 1, currentPage: 1 }),
    );
    expect(summary.fetchedCount).toBe(100);
    expect(summary.savedCount).toBe(100);
  });

  it('retries transient audiobook catalog page failures before completing', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 109, mediaType: 'audiobook' }));
    repo.upsertCatalogItems.mockResolvedValue(2);
    vi.spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue(undefined);
    client.listAudiobooks
      .mockRejectedValueOnce(new WarehouseApiError(429, 'Too Many Requests'))
      .mockRejectedValueOnce(new WarehouseApiError(503, 'Unavailable'))
      .mockResolvedValueOnce({
        items: [
          { id: 'audio-1', title: 'Audio 1' },
          { id: 'audio-2', title: 'Audio 2' },
        ],
        page: 1,
        limit: 100,
        total: 2,
        hasNextPage: false,
      });

    const summary = await service.syncAudiobooks();

    expect(client.listAudiobooks).toHaveBeenCalledTimes(3);
    expect(repo.updateSyncRunProgress).toHaveBeenNthCalledWith(
      1,
      109,
      { fetchedCount: 0, savedCount: 0 },
      expect.objectContaining({ currentPage: 1, currentAttempt: 1, maxAttempts: 3, lastErrorStatus: 429 }),
    );
    expect(repo.updateSyncRunProgress).toHaveBeenNthCalledWith(
      2,
      109,
      { fetchedCount: 0, savedCount: 0 },
      expect.objectContaining({ currentPage: 1, currentAttempt: 2, maxAttempts: 3, lastErrorStatus: 503 }),
    );
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      109,
      { fetchedCount: 2, savedCount: 2 },
      expect.objectContaining({ completedPage: 1, currentPage: 1 }),
    );
    expect(repo.failSyncRun).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      runId: 109,
      status: 'completed',
      fetchedCount: 2,
      savedCount: 2,
    });
  });

  it('records failed audiobook catalog page metadata when retries are exhausted', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 110, mediaType: 'audiobook' }));
    vi.spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue(undefined);
    client.listAudiobooks.mockRejectedValue(new WarehouseApiError(503, 'Unavailable'));

    await expect(service.syncAudiobooks()).rejects.toThrow('Catalog source sync failed. Try again later.');

    expect(client.listAudiobooks).toHaveBeenCalledTimes(3);
    expect(repo.updateSyncRunProgress).toHaveBeenCalledTimes(3);
    expect(repo.failSyncRun).toHaveBeenCalledWith(
      110,
      'Catalog source sync failed. Try again later.',
      { fetchedCount: 0, savedCount: 0 },
      expect.objectContaining({ failedPage: 1, currentPage: 1, lastErrorStatus: 503 }),
    );
  });

  it('records completed audiobook run counts with audiobook media type', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 111, mediaType: 'audiobook' }));
    repo.upsertCatalogItems.mockResolvedValue(2);
    client.listAudiobooks.mockResolvedValue({
      items: [
        { id: 'audio-1', title: 'Audio 1', authors: ['Ada Writer'], narrators: ['A Narrator'] },
        { id: 'audio-2', title: 'Audio 2', author: 'Bea Writer', narrator: 'B Narrator' },
      ],
      page: 1,
      limit: 100,
      total: 2,
      hasNextPage: false,
    });

    const summary = await service.syncAudiobooks();

    expect(repo.createSyncRun).toHaveBeenCalledWith(
      'audiobook',
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.updateSyncRunProgress).toHaveBeenCalledWith(
      111,
      { fetchedCount: 2, savedCount: 2 },
      expect.objectContaining({ ownerToken: expect.any(Number), lastProgressAtMs: expect.any(Number) }),
    );
    expect(repo.completeSyncRun).toHaveBeenCalledWith(
      111,
      { fetchedCount: 2, savedCount: 2 },
      expect.objectContaining({ completedPage: 1, currentPage: 1 }),
    );
    expect(repo.upsertCatalogItems).toHaveBeenCalledWith([
      expect.objectContaining({ mediaType: 'audiobook', remoteId: 'audio-1', title: 'Audio 1', narrators: ['A Narrator'] }),
      expect.objectContaining({ mediaType: 'audiobook', remoteId: 'audio-2', title: 'Audio 2', narrators: ['B Narrator'] }),
    ]);
    expect(summary).toMatchObject({
      runId: 111,
      status: 'completed',
      mediaType: 'audiobook',
      fetchedCount: 2,
      savedCount: 2,
      errorMessage: null,
    });
  });

  it('records a failed audiobook run with a safe message', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ baseUrl: 'https://catalog-source.example.test/root' }));
    repo.createSyncRun.mockResolvedValue(makeSyncRunRow({ id: 119, mediaType: 'audiobook' }));
    client.listAudiobooks.mockRejectedValue(
      new Error('Book Warehouse outage at https://catalog-source.example.test/root/audiobooks with apiKey=top-secret-key'),
    );

    await expect(service.syncAudiobooks()).rejects.toThrow('Catalog source sync failed. Try again later.');

    expect(repo.failSyncRun).toHaveBeenCalledTimes(1);
    const [runId, errorMessage, counts] = repo.failSyncRun.mock.calls[0]!;
    expect(runId).toBe(119);
    expect(errorMessage).toBe('Catalog source sync failed. Try again later.');
    expect(errorMessage).not.toContain('Book Warehouse');
    expect(errorMessage).not.toContain('https://catalog-source.example.test/root');
    expect(errorMessage).not.toContain('top-secret-key');
    expect(counts).toEqual({ fetchedCount: 0, savedCount: 0 });
  });
});
