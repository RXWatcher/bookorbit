import { describe, expect, it, vi } from 'vitest';

import { SUPERUSER_KEY } from '../../common/decorators/require-superuser.decorator';
import { WarehouseAdminController } from './warehouse-admin.controller';

describe('WarehouseAdminController', () => {
  it('sets class-level administrator-only metadata', () => {
    expect(Reflect.getMetadata(SUPERUSER_KEY, WarehouseAdminController)).toBe(true);
  });

  it('delegates getSettings() to the settings service', async () => {
    const expected = { enabled: false };
    const settings = {
      getAdminSettings: vi.fn().mockResolvedValue(expected),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.getSettings()).resolves.toBe(expected);
    expect(settings.getAdminSettings).toHaveBeenCalledTimes(1);
  });

  it('delegates updateSettings() to the settings service', async () => {
    const dto = { enabled: true };
    const expected = { enabled: true };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn().mockResolvedValue(expected),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.updateSettings(dto)).resolves.toBe(expected);
    expect(settings.upsertAdminSettings).toHaveBeenCalledWith(dto);
  });

  it('delegates testConnection() to the settings service', async () => {
    const expected = {
      ok: true,
      status: 200,
      message: 'ok',
      checkedAt: '2026-06-02T00:00:00.000Z',
    };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(expected),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.testConnection()).resolves.toBe(expected);
    expect(settings.testConnection).toHaveBeenCalledTimes(1);
  });

  it('delegates getCatalogSyncState() to the sync service', async () => {
    const expected = {
      lastRun: {
        runId: 18,
        status: 'completed',
        mediaType: 'ebook',
        fetchedCount: 42,
        savedCount: 41,
        errorMessage: null,
        startedAt: '2026-06-02T11:00:00.000Z',
        finishedAt: '2026-06-02T11:02:00.000Z',
      },
      running: false,
    };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn().mockResolvedValue(expected),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.getCatalogSyncState()).resolves.toBe(expected);
    expect(catalogSync.getSyncState).toHaveBeenCalledTimes(1);
  });

  it('delegates syncEbooks() to the sync service', async () => {
    const expected = {
      runId: 19,
      status: 'completed',
      mediaType: 'ebook',
      fetchedCount: 25,
      savedCount: 25,
      errorMessage: null,
      startedAt: '2026-06-02T12:00:00.000Z',
      finishedAt: '2026-06-02T12:01:00.000Z',
    };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn().mockResolvedValue(expected),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.syncEbooks()).resolves.toBe(expected);
    expect(catalogSync.syncEbooks).toHaveBeenCalledTimes(1);
  });

  it('delegates syncAudiobooks() to the sync service', async () => {
    const expected = {
      runId: 20,
      status: 'completed',
      mediaType: 'audiobook',
      fetchedCount: 18,
      savedCount: 18,
      errorMessage: null,
      startedAt: '2026-06-02T12:10:00.000Z',
      finishedAt: '2026-06-02T12:11:00.000Z',
    };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn().mockResolvedValue(expected),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.syncAudiobooks()).resolves.toBe(expected);
    expect(catalogSync.syncAudiobooks).toHaveBeenCalledTimes(1);
  });

  it('delegates syncComics() to the sync service', async () => {
    const expected = {
      runId: 21,
      status: 'completed',
      mediaType: 'comic',
      fetchedCount: 16,
      savedCount: 16,
      errorMessage: null,
      startedAt: '2026-06-10T12:10:00.000Z',
      finishedAt: '2026-06-10T12:11:00.000Z',
    };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn().mockResolvedValue(expected),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.syncComics()).resolves.toBe(expected);
    expect(catalogSync.syncComics).toHaveBeenCalledTimes(1);
  });

  it('delegates syncAll() to the sync service', async () => {
    const expected = [
      {
        runId: 19,
        status: 'completed',
        mediaType: 'ebook',
        fetchedCount: 25,
        savedCount: 25,
        errorMessage: null,
        startedAt: '2026-06-02T12:00:00.000Z',
        finishedAt: '2026-06-02T12:01:00.000Z',
      },
      {
        runId: 20,
        status: 'completed',
        mediaType: 'audiobook',
        fetchedCount: 18,
        savedCount: 18,
        errorMessage: null,
        startedAt: '2026-06-02T12:10:00.000Z',
        finishedAt: '2026-06-02T12:11:00.000Z',
      },
      {
        runId: 21,
        status: 'completed',
        mediaType: 'comic',
        fetchedCount: 16,
        savedCount: 16,
        errorMessage: null,
        startedAt: '2026-06-10T12:10:00.000Z',
        finishedAt: '2026-06-10T12:11:00.000Z',
      },
    ];
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn().mockResolvedValue(expected),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.syncAll()).resolves.toBe(expected);
    expect(catalogSync.syncAll).toHaveBeenCalledTimes(1);
  });

  it('delegates getCacheStatus() to the cover cache service', async () => {
    const expected = {
      covers: {
        totalEntries: 3,
        totalBytes: 1024,
        byMediaType: {
          ebook: { entries: 2, bytes: 700 },
          audiobook: { entries: 1, bytes: 324 },
        },
      },
    };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn().mockResolvedValue(expected),
      clear: vi.fn(),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.getCacheStatus()).resolves.toBe(expected);
    expect(coverCache.getStatus).toHaveBeenCalledTimes(1);
  });

  it('delegates clearCache() to the cover cache service', async () => {
    const expected = {
      cleared: {
        covers: { entries: 2, bytes: 8 },
      },
      covers: {
        totalEntries: 0,
        totalBytes: 0,
        byMediaType: {
          ebook: { entries: 0, bytes: 0 },
          audiobook: { entries: 0, bytes: 0 },
        },
      },
    };
    const settings = {
      getAdminSettings: vi.fn(),
      upsertAdminSettings: vi.fn(),
      testConnection: vi.fn(),
    };
    const catalogSync = {
      getSyncState: vi.fn(),
      syncEbooks: vi.fn(),
      syncAudiobooks: vi.fn(),
      syncComics: vi.fn(),
      syncAll: vi.fn(),
    };
    const coverCache = {
      getStatus: vi.fn(),
      clear: vi.fn().mockResolvedValue(expected),
    };
    const controller = new WarehouseAdminController(settings as never, catalogSync as never, coverCache as never);

    await expect(controller.clearCache()).resolves.toBe(expected);
    expect(coverCache.clear).toHaveBeenCalledTimes(1);
  });
});
