import { NotificationType } from '@bookorbit/types';
import type { WarehouseCatalogItemRow, WarehouseRequestRow, WarehouseSettingRow } from '../../db/schema';

import { NotificationService } from '../notification/notification.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseClientService, type WarehouseAudiobookRequestRow } from './warehouse-client.service';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService } from './warehouse-secret.service';
import { WarehouseRequestSyncService } from './warehouse-request-sync.service';

const CREATED_AT = new Date('2026-06-03T10:00:00.000Z');
const UPDATED_AT = new Date('2026-06-03T10:05:00.000Z');
const SYNCED_AT = new Date('2026-06-03T10:10:00.000Z');
const NOW = new Date('2026-06-03T12:00:00.000Z');
const USER_ID = 42;

type BookRequestRow = Awaited<ReturnType<WarehouseClientService['listBookRequests']>>[number];
type MutableBookRequestRow = BookRequestRow & Record<string, unknown>;
type MutableAudiobookRequestRow = WarehouseAudiobookRequestRow & Record<string, unknown>;
type MutableComicRequestRow = BookRequestRow & Record<string, unknown>;

function makeSettingsRow(overrides: Partial<WarehouseSettingRow> = {}): WarehouseSettingRow {
  return {
    id: 1,
    profileKey: 'default',
    enabled: true,
    baseUrl: 'https://catalog-source.example.test',
    apiKeyEncrypted: 'ciphertext',
    apiKeyNonce: 'nonce',
    apiKeyTag: 'tag',
    syncCadenceMinutes: 45,
    lastConnectionStatus: 'untested',
    lastConnectionCheckedAt: null,
    lastConnectionError: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeRequestRow(overrides: Partial<WarehouseRequestRow> = {}): WarehouseRequestRow {
  return {
    id: 7,
    userId: USER_ID,
    mediaType: 'ebook',
    upstreamRequestId: 'upstream-7',
    status: 'pending',
    title: 'Requested Book',
    author: 'Ada Writer',
    isbn: '9780000000007',
    requestedPayload: { isbn: '9780000000007' },
    completedRemoteId: null,
    lastStatusSyncedAt: SYNCED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeCatalogItemRow(overrides: Partial<WarehouseCatalogItemRow> = {}): WarehouseCatalogItemRow {
  return {
    id: 1,
    mediaType: 'ebook',
    remoteId: 'remote-1',
    title: 'Catalog Book',
    subtitle: null,
    sortTitle: null,
    authors: [],
    narrators: [],
    series: null,
    genres: [],
    tags: [],
    language: null,
    publisher: null,
    identifiers: {},
    format: null,
    durationSeconds: null,
    hasCover: false,
    upstreamCreatedAt: null,
    upstreamUpdatedAt: null,
    rawPayload: {},
    searchText: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeBookRequest(overrides: Partial<MutableBookRequestRow> = {}): MutableBookRequestRow {
  return {
    id: 'upstream-7',
    status: 'pending',
    title: 'Requested Book',
    author: 'Ada Writer',
    isbn: '9780000000007',
    ...overrides,
  };
}

function makeAudiobookRequest(overrides: Partial<MutableAudiobookRequestRow> = {}): MutableAudiobookRequestRow {
  return {
    id: 'audio-7',
    status: 'pending',
    title: 'Requested Audio',
    author: 'Audio Writer',
    ...overrides,
  };
}

function makeComicRequest(overrides: Partial<MutableComicRequestRow> = {}): MutableComicRequestRow {
  return {
    id: 'comic-7',
    status: 'pending',
    title: 'Saga #1',
    author: 'Image',
    ...overrides,
  };
}

function makeRepo(): jest.Mocked<WarehouseRepository> {
  return {
    findSettings: vi.fn(),
    listRequestMirrorsForSync: vi.fn(),
    updateRequestMirror: vi.fn(),
    updateOpenRequestMirror: vi.fn(),
    upsertRequestMirror: vi.fn(),
    findCatalogItem: vi.fn(),
  } as unknown as jest.Mocked<WarehouseRepository>;
}

function makeClient(): jest.Mocked<WarehouseClientService> {
  return {
    listBookRequests: vi.fn(),
    listAudiobookRequests: vi.fn(),
    listComicRequests: vi.fn(),
  } as unknown as jest.Mocked<WarehouseClientService>;
}

function makeSecret(): jest.Mocked<WarehouseSecretService> {
  return {
    decrypt: vi.fn().mockReturnValue('decrypted-api-key'),
  } as unknown as jest.Mocked<WarehouseSecretService>;
}

function makeNotification(): jest.Mocked<NotificationService> {
  return {
    notify: vi.fn(),
  } as unknown as jest.Mocked<NotificationService>;
}

function makeCatalogSync(): jest.Mocked<WarehouseCatalogSyncService> {
  return {
    syncEbooks: vi.fn().mockResolvedValue({}),
    syncAudiobooks: vi.fn().mockResolvedValue({}),
    syncComics: vi.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<WarehouseCatalogSyncService>;
}

function makeService() {
  const repo = makeRepo();
  const client = makeClient();
  const secret = makeSecret();
  const notification = makeNotification();
  const catalogSync = makeCatalogSync();

  return {
    repo,
    client,
    secret,
    notification,
    catalogSync,
    service: new WarehouseRequestSyncService(repo, client, secret, notification, catalogSync),
  };
}

describe('WarehouseRequestSyncService', () => {
  it.each([
    ['missing settings', null, 'disabled'],
    ['disabled settings', makeSettingsRow({ enabled: false }), 'disabled'],
    ['missing encrypted API key', makeSettingsRow({ apiKeyEncrypted: null }), 'missing-credentials'],
    ['missing encrypted API nonce', makeSettingsRow({ apiKeyNonce: null }), 'missing-credentials'],
    ['missing encrypted API tag', makeSettingsRow({ apiKeyTag: null }), 'missing-credentials'],
  ] as const)('skips safely for %s', async (_label, settings, skippedReason) => {
    const { service, repo, client, secret } = makeService();
    repo.findSettings.mockResolvedValue(settings);

    await expect(service.syncDueRequests(NOW)).resolves.toEqual({
      status: 'skipped',
      scannedCount: 0,
      updatedCount: 0,
      notifiedCount: 0,
      catalogSyncCount: 0,
      errorCount: 0,
      skippedReason,
    });
    expect(secret.decrypt).not.toHaveBeenCalled();
    expect(repo.listRequestMirrorsForSync).not.toHaveBeenCalled();
    expect(client.listBookRequests).not.toHaveBeenCalled();
    expect(client.listAudiobookRequests).not.toHaveBeenCalled();
  });

  it('skips safely when credentials cannot be decrypted', async () => {
    const { service, repo, client, secret } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    secret.decrypt.mockImplementation(() => {
      throw new Error('bad decrypt');
    });

    await expect(service.syncDueRequests(NOW)).resolves.toEqual({
      status: 'skipped',
      scannedCount: 0,
      updatedCount: 0,
      notifiedCount: 0,
      catalogSyncCount: 0,
      errorCount: 0,
      skippedReason: 'unreadable-credentials',
    });
    expect(repo.listRequestMirrorsForSync).not.toHaveBeenCalled();
    expect(client.listBookRequests).not.toHaveBeenCalled();
    expect(client.listAudiobookRequests).not.toHaveBeenCalled();
  });

  it('returns skipped/no-candidates without upstream calls and uses the sync cadence for due syncs', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow({ syncCadenceMinutes: 45 }));
    repo.listRequestMirrorsForSync.mockResolvedValue([]);

    await expect(service.syncDueRequests(NOW)).resolves.toEqual({
      status: 'skipped',
      scannedCount: 0,
      updatedCount: 0,
      notifiedCount: 0,
      catalogSyncCount: 0,
      errorCount: 0,
      skippedReason: 'no-candidates',
    });
    expect(repo.listRequestMirrorsForSync).toHaveBeenCalledWith({ staleBefore: new Date('2026-06-03T11:15:00.000Z'), limit: 100 });
    expect(client.listBookRequests).not.toHaveBeenCalled();
    expect(client.listAudiobookRequests).not.toHaveBeenCalled();
  });

  it('syncs all open requests without a staleBefore filter', async () => {
    const { service, repo } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([]);

    await service.syncAllOpenRequests(NOW);

    expect(repo.listRequestMirrorsForSync).toHaveBeenCalledWith({ limit: 100 });
  });

  it('syncs ebook and audiobook candidates from list endpoints, updates only matching rows, and never upserts unknown rows', async () => {
    const { service, repo, client } = makeService();
    const ebook = makeRequestRow({ id: 1, mediaType: 'ebook', upstreamRequestId: 'ebook-1' });
    const audiobook = makeRequestRow({ id: 2, mediaType: 'audiobook', upstreamRequestId: 'audio-1', title: 'Local Audio', isbn: null });
    const invalid = makeRequestRow({ id: 3, mediaType: 'ebook', upstreamRequestId: '  ' });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([ebook, audiobook, invalid]);
    client.listBookRequests.mockResolvedValue([
      makeBookRequest({ id: 'ebook-unknown', status: 'available', title: 'Unknown Book' }),
      makeBookRequest({
        id: 'ebook-1',
        status: 'available',
        title: 'Remote Book',
        author: 'Remote Author',
        isbn: '9781111111111',
        completedRemoteId: 'remote-book-1',
      }),
    ]);
    client.listAudiobookRequests.mockResolvedValue([
      makeAudiobookRequest({ id: 'audio-1', status: 'downloading', title: 'Remote Audio', author: 'Remote Narrator' }),
      makeAudiobookRequest({ id: 'audio-unknown', status: 'available', title: 'Unknown Audio' }),
    ]);
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow());
    repo.updateRequestMirror.mockImplementation((id, scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: scope.mediaType ?? 'ebook', ...data })),
    );
    repo.updateOpenRequestMirror.mockImplementation((id, scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: scope.mediaType ?? 'ebook', ...data })),
    );

    await expect(service.syncDueRequests(NOW)).resolves.toMatchObject({
      status: 'completed',
      scannedCount: 3,
      updatedCount: 2,
      notifiedCount: 1,
      catalogSyncCount: 0,
      errorCount: 0,
    });

    expect(client.listBookRequests).toHaveBeenCalledTimes(1);
    expect(client.listBookRequests).toHaveBeenCalledWith({ baseUrl: 'https://catalog-source.example.test', apiKey: 'decrypted-api-key' });
    expect(client.listAudiobookRequests).toHaveBeenCalledTimes(1);
    expect(client.listAudiobookRequests).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      limit: 100,
    });
    expect(repo.updateOpenRequestMirror).toHaveBeenCalledTimes(2);
    expect(repo.updateOpenRequestMirror).toHaveBeenNthCalledWith(
      1,
      1,
      { userId: USER_ID, mediaType: 'ebook' },
      expect.objectContaining({
        status: 'completed',
        title: 'Remote Book',
        author: 'Remote Author',
        isbn: '9781111111111',
        completedRemoteId: 'remote-book-1',
        lastStatusSyncedAt: NOW,
      }),
    );
    expect(repo.updateOpenRequestMirror).toHaveBeenNthCalledWith(
      2,
      2,
      { userId: USER_ID, mediaType: 'audiobook' },
      expect.objectContaining({
        status: 'processing',
        title: 'Remote Audio',
        author: 'Remote Narrator',
        lastStatusSyncedAt: NOW,
      }),
    );
    expect(repo.updateRequestMirror).not.toHaveBeenCalled();
    expect(repo.upsertRequestMirror).not.toHaveBeenCalled();
  });

  it('does not let stale non-terminal sync writes overwrite a row that already left the open set', async () => {
    const { service, repo, client, notification, catalogSync } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({ id: 16, mediaType: 'audiobook', upstreamRequestId: 'audio-stale', status: 'pending', title: 'Stale Audio', isbn: null }),
    ]);
    client.listAudiobookRequests.mockResolvedValue([makeAudiobookRequest({ id: 'audio-stale', status: 'downloading', title: 'Stale Audio' })]);
    repo.updateOpenRequestMirror.mockResolvedValue(undefined);

    const summary = await service.syncDueRequests(NOW);

    expect(repo.updateOpenRequestMirror).toHaveBeenCalledWith(
      16,
      { userId: USER_ID, mediaType: 'audiobook' },
      expect.objectContaining({ status: 'processing' }),
    );
    expect(repo.updateRequestMirror).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ status: 'completed', updatedCount: 0, notifiedCount: 0, catalogSyncCount: 0, errorCount: 0 });
    expect(notification.notify).not.toHaveBeenCalled();
    expect(catalogSync.syncAudiobooks).not.toHaveBeenCalled();
  });

  it('sends completed and failed notifications only for non-terminal transitions', async () => {
    const { service, repo, client, notification } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({ id: 11, mediaType: 'ebook', upstreamRequestId: 'ebook-complete', status: 'pending', title: 'Soon Ready' }),
      makeRequestRow({ id: 12, mediaType: 'audiobook', upstreamRequestId: 'audio-fail', status: 'processing', title: 'Soon Failed', isbn: null }),
      makeRequestRow({
        id: 13,
        mediaType: 'ebook',
        upstreamRequestId: 'ebook-already',
        status: 'completed',
        title: 'Already Ready',
        completedRemoteId: 'remote-13',
      }),
      makeRequestRow({
        id: 14,
        mediaType: 'audiobook',
        upstreamRequestId: 'audio-already',
        status: 'failed',
        title: 'Already Failed',
        isbn: null,
        completedRemoteId: 'remote-14',
      }),
    ]);
    client.listBookRequests.mockResolvedValue([
      makeBookRequest({ id: 'ebook-complete', status: 'available', title: 'Soon Ready', remoteId: 'remote-11' }),
      makeBookRequest({ id: 'ebook-already', status: 'available', title: 'Already Ready', remoteId: 'remote-13' }),
    ]);
    client.listAudiobookRequests.mockResolvedValue([
      makeAudiobookRequest({ id: 'audio-fail', status: 'error', title: 'Soon Failed' }),
      makeAudiobookRequest({ id: 'audio-already', status: 'error', title: 'Already Failed' }),
    ]);
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow());
    repo.updateOpenRequestMirror.mockImplementation((id, scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: scope.mediaType ?? 'ebook', ...data })),
    );

    const summary = await service.syncDueRequests(NOW);

    expect(summary).toMatchObject({ status: 'completed', updatedCount: 2, notifiedCount: 2, errorCount: 0 });
    expect(repo.updateOpenRequestMirror.mock.calls.map(([id]) => id)).toEqual([11, 12]);
    expect(repo.updateRequestMirror).not.toHaveBeenCalled();
    expect(repo.findCatalogItem.mock.calls.map(([, remoteId]) => remoteId)).not.toContain('remote-13');
    expect(repo.findCatalogItem.mock.calls.map(([, remoteId]) => remoteId)).not.toContain('remote-14');
    expect(notification.notify).toHaveBeenCalledTimes(2);
    expect(notification.notify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: NotificationType.CatalogRequestCompleted,
        title: 'Request completed',
        message: 'Soon Ready is ready.',
        actionUrl: '/requests',
        scope: { kind: 'user', userId: USER_ID },
        meta: { requestId: 11, mediaType: 'ebook', status: 'completed' },
      }),
    );
    expect(notification.notify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: NotificationType.CatalogRequestFailed,
        title: 'Request failed',
        message: 'Soon Failed could not be completed.',
        actionUrl: '/requests',
        scope: { kind: 'user', userId: USER_ID },
        meta: { requestId: 12, mediaType: 'audiobook', status: 'failed' },
      }),
    );
    const metas = notification.notify.mock.calls.map(([payload]) => payload.meta);
    for (const meta of metas) {
      expect(meta).not.toHaveProperty('upstreamRequestId');
      expect(meta).not.toHaveProperty('completedRemoteId');
    }
  });

  it('does not notify or trigger catalog sync when a terminal transition claim loses a race', async () => {
    const { service, repo, client, notification, catalogSync } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({ id: 15, mediaType: 'ebook', upstreamRequestId: 'ebook-race', status: 'pending', title: 'Race Ready' }),
    ]);
    client.listBookRequests.mockResolvedValue([
      makeBookRequest({ id: 'ebook-race', status: 'available', title: 'Race Ready', remoteId: 'remote-race' }),
    ]);
    repo.updateOpenRequestMirror.mockResolvedValue(undefined);

    const summary = await service.syncDueRequests(NOW);

    expect(repo.updateOpenRequestMirror).toHaveBeenCalledWith(
      15,
      { userId: USER_ID, mediaType: 'ebook' },
      expect.objectContaining({ status: 'completed', completedRemoteId: 'remote-race' }),
    );
    expect(summary).toMatchObject({ status: 'completed', updatedCount: 0, notifiedCount: 0, catalogSyncCount: 0, errorCount: 0 });
    expect(notification.notify).not.toHaveBeenCalled();
    expect(repo.findCatalogItem).not.toHaveBeenCalled();
    expect(catalogSync.syncEbooks).not.toHaveBeenCalled();
  });

  it('preserves local safe metadata when upstream metadata is unsafe or missing', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({
        id: 21,
        mediaType: 'ebook',
        upstreamRequestId: 'ebook-unsafe',
        title: 'Local Safe Title',
        author: 'Local Author',
        isbn: '9782222222222',
      }),
    ]);
    client.listBookRequests.mockResolvedValue([
      makeBookRequest({
        id: 'ebook-unsafe',
        status: 'available',
        title: 'https://catalog-source.example.test/internal/ebook-unsafe',
        author: 'Authorization: bearer secret',
        isbn: 'abcdefghijklmnopqrstuvwxyzABCDEFGH',
        remoteId: 'remote-unsafe',
      }),
    ]);
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow());
    repo.updateOpenRequestMirror.mockResolvedValue(makeRequestRow({ id: 21, status: 'completed' }));

    await service.syncDueRequests(NOW);

    const update = repo.updateOpenRequestMirror.mock.calls[0]?.[2];
    expect(update).toMatchObject({ status: 'completed', completedRemoteId: 'remote-unsafe', lastStatusSyncedAt: NOW });
    expect(update).not.toHaveProperty('title');
    expect(update).not.toHaveProperty('author');
    expect(update).not.toHaveProperty('isbn');
  });

  it('keeps comic request notifications on local safe metadata when upstream returns storage paths', async () => {
    const { service, repo, client, notification } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({
        id: 27,
        mediaType: 'comic',
        upstreamRequestId: 'comic-unsafe',
        status: 'pending',
        title: 'Local Comic',
        author: 'Local Publisher',
        isbn: null,
      }),
    ]);
    client.listComicRequests.mockResolvedValue([
      makeComicRequest({
        id: 'comic-unsafe',
        status: 'available',
        title: '/media/comics/private/Saga.cbz',
        author: 'ceph://private/comics',
        remoteId: 'comic-unsafe-remote',
      }),
    ]);
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'comic', remoteId: 'comic-unsafe-remote' }));
    repo.updateOpenRequestMirror.mockResolvedValue(makeRequestRow({ id: 27, mediaType: 'comic', status: 'completed', title: 'Local Comic' }));

    await service.syncDueRequests(NOW);

    const update = repo.updateOpenRequestMirror.mock.calls[0]?.[2];
    expect(update).toMatchObject({ status: 'completed', completedRemoteId: 'comic-unsafe-remote', lastStatusSyncedAt: NOW });
    expect(update).not.toHaveProperty('title');
    expect(update).not.toHaveProperty('author');
    expect(notification.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Local Comic is ready.',
        meta: { requestId: 27, mediaType: 'comic', status: 'completed' },
      }),
    );
  });

  it('sets completedRemoteId from all supported upstream remote ID spellings', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({ id: 31, upstreamRequestId: 'ebook-31' }),
      makeRequestRow({ id: 32, upstreamRequestId: 'ebook-32' }),
      makeRequestRow({ id: 33, upstreamRequestId: 'ebook-33' }),
      makeRequestRow({ id: 34, upstreamRequestId: 'ebook-34' }),
    ]);
    client.listBookRequests.mockResolvedValue([
      makeBookRequest({ id: 'ebook-31', status: 'available', completedRemoteId: 'remote-camel-completed' }),
      makeBookRequest({ id: 'ebook-32', status: 'available', completed_remote_id: 'remote-snake-completed' }),
      makeBookRequest({ id: 'ebook-33', status: 'available', remoteId: 'remote-camel' }),
      makeBookRequest({ id: 'ebook-34', status: 'available', remote_id: 'remote-snake' }),
    ]);
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow());
    repo.updateOpenRequestMirror.mockImplementation((id, scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: scope.mediaType ?? 'ebook', ...data })),
    );

    await service.syncDueRequests(NOW);

    expect(repo.updateOpenRequestMirror.mock.calls.map((call) => call[2].completedRemoteId)).toEqual([
      'remote-camel-completed',
      'remote-snake-completed',
      'remote-camel',
      'remote-snake',
    ]);
  });

  it('triggers at most one catalog sync per media type when completed remote IDs are missing locally', async () => {
    const { service, repo, client, catalogSync } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({ id: 41, mediaType: 'ebook', upstreamRequestId: 'ebook-41' }),
      makeRequestRow({ id: 42, mediaType: 'ebook', upstreamRequestId: 'ebook-42' }),
      makeRequestRow({ id: 43, mediaType: 'audiobook', upstreamRequestId: 'audio-43', isbn: null }),
      makeRequestRow({ id: 44, mediaType: 'audiobook', upstreamRequestId: 'audio-44', isbn: null }),
    ]);
    client.listBookRequests.mockResolvedValue([
      makeBookRequest({ id: 'ebook-41', status: 'available', remoteId: 'remote-41' }),
      makeBookRequest({ id: 'ebook-42', status: 'available', remoteId: 'remote-42' }),
    ]);
    client.listAudiobookRequests.mockResolvedValue([
      makeAudiobookRequest({ id: 'audio-43', status: 'available', remote_id: 'remote-43' }),
      makeAudiobookRequest({ id: 'audio-44', status: 'available', remote_id: 'remote-44' }),
    ]);
    repo.findCatalogItem.mockResolvedValue(null);
    repo.updateOpenRequestMirror.mockImplementation((id, scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: scope.mediaType ?? 'ebook', ...data })),
    );

    await expect(service.syncDueRequests(NOW)).resolves.toMatchObject({
      status: 'completed',
      updatedCount: 4,
      catalogSyncCount: 2,
      errorCount: 0,
    });
    expect(catalogSync.syncEbooks).toHaveBeenCalledTimes(1);
    expect(catalogSync.syncAudiobooks).toHaveBeenCalledTimes(1);
  });

  it('syncs comic request mirrors from the comic request endpoint and refreshes missing completed comics', async () => {
    const { service, repo, client, notification, catalogSync } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({ id: 61, mediaType: 'comic', upstreamRequestId: 'comic-61', status: 'pending', title: 'Saga #1', author: 'Image', isbn: null }),
      makeRequestRow({
        id: 62,
        mediaType: 'comic',
        upstreamRequestId: 'comic-62',
        status: 'processing',
        title: 'Saga #2',
        author: 'Image',
        isbn: null,
      }),
    ]);
    client.listComicRequests.mockResolvedValue([
      makeComicRequest({ id: 'comic-61', status: 'available', title: 'Saga #1', author: 'Image', remoteId: 'comic-remote-61' }),
      makeComicRequest({ id: 'comic-62', status: 'available', title: 'Saga #2', author: 'Image', remote_id: 'comic-remote-62' }),
      makeComicRequest({ id: 'comic-unknown', status: 'available', title: 'Unknown Comic' }),
    ]);
    repo.findCatalogItem.mockResolvedValue(null);
    repo.updateOpenRequestMirror.mockImplementation((id, scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: scope.mediaType ?? 'ebook', ...data })),
    );

    await expect(service.syncDueRequests(NOW)).resolves.toMatchObject({
      status: 'completed',
      scannedCount: 2,
      updatedCount: 2,
      notifiedCount: 2,
      catalogSyncCount: 1,
      errorCount: 0,
    });

    expect(client.listBookRequests).not.toHaveBeenCalled();
    expect(client.listAudiobookRequests).not.toHaveBeenCalled();
    expect(client.listComicRequests).toHaveBeenCalledTimes(1);
    expect(client.listComicRequests).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      limit: 100,
    });
    expect(repo.updateOpenRequestMirror).toHaveBeenNthCalledWith(
      1,
      61,
      { userId: USER_ID, mediaType: 'comic' },
      expect.objectContaining({
        status: 'completed',
        title: 'Saga #1',
        author: 'Image',
        completedRemoteId: 'comic-remote-61',
        lastStatusSyncedAt: NOW,
      }),
    );
    expect(repo.updateOpenRequestMirror).toHaveBeenNthCalledWith(
      2,
      62,
      { userId: USER_ID, mediaType: 'comic' },
      expect.objectContaining({
        status: 'completed',
        title: 'Saga #2',
        author: 'Image',
        completedRemoteId: 'comic-remote-62',
        lastStatusSyncedAt: NOW,
      }),
    );
    expect(repo.findCatalogItem).toHaveBeenCalledTimes(1);
    expect(repo.findCatalogItem).toHaveBeenCalledWith('comic', 'comic-remote-61');
    expect(catalogSync.syncComics).toHaveBeenCalledTimes(1);
    expect(notification.notify).toHaveBeenCalledTimes(2);
    expect(notification.notify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        meta: { requestId: 61, mediaType: 'comic', status: 'completed' },
        message: 'Saga #1 is ready.',
        actionUrl: '/requests',
      }),
    );
  });

  it('continues after notification or catalog sync failures and returns a failed summary', async () => {
    const { service, repo, client, notification, catalogSync } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestMirrorsForSync.mockResolvedValue([
      makeRequestRow({ id: 51, mediaType: 'ebook', upstreamRequestId: 'ebook-51', status: 'pending' }),
      makeRequestRow({ id: 52, mediaType: 'ebook', upstreamRequestId: 'ebook-52', status: 'pending' }),
    ]);
    client.listBookRequests.mockResolvedValue([
      makeBookRequest({ id: 'ebook-51', status: 'available', remoteId: 'remote-51' }),
      makeBookRequest({ id: 'ebook-52', status: 'available', remoteId: 'remote-52' }),
    ]);
    repo.findCatalogItem.mockResolvedValue(null);
    repo.updateOpenRequestMirror.mockImplementation((id, scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: scope.mediaType ?? 'ebook', ...data })),
    );
    notification.notify.mockRejectedValueOnce(new Error('notification database unavailable')).mockResolvedValueOnce(undefined);
    catalogSync.syncEbooks.mockRejectedValue(new Error('catalog sync failed'));

    const summary = await service.syncDueRequests(NOW);

    expect(repo.updateOpenRequestMirror).toHaveBeenCalledTimes(2);
    expect(notification.notify).toHaveBeenCalledTimes(2);
    expect(catalogSync.syncEbooks).toHaveBeenCalledTimes(1);
    expect(summary.status).toBe('failed');
    expect(summary.updatedCount).toBe(2);
    expect(summary.notifiedCount).toBe(1);
    expect(summary.catalogSyncCount).toBe(0);
    expect(summary.errorCount).toBeGreaterThan(0);
  });
});
