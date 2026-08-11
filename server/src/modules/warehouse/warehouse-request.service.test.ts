import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@bookorbit/types';
import type { WarehouseRequestRow, WarehouseSettingRow } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';

import { NotificationService } from '../notification/notification.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseClientService } from './warehouse-client.service';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService } from './warehouse-secret.service';
import { WarehouseRequestService } from './warehouse-request.service';

const CREATED_AT = new Date('2026-06-03T10:00:00.000Z');
const UPDATED_AT = new Date('2026-06-03T10:05:00.000Z');
const SYNCED_AT = new Date('2026-06-03T10:10:00.000Z');
const USER = { id: 42 } as RequestUser;

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

function makeRequestRow(overrides: Partial<WarehouseRequestRow> = {}): WarehouseRequestRow {
  return {
    id: 7,
    userId: USER.id,
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

function makeRepo(): jest.Mocked<WarehouseRepository> {
  return {
    findSettings: vi.fn(),
    upsertRequestMirror: vi.fn(),
    listRequestsForUser: vi.fn(),
    findRequestForUser: vi.fn(),
    updateRequestMirror: vi.fn(),
    updateOpenRequestMirror: vi.fn(),
    deleteRequestMirror: vi.fn(),
    findCatalogItem: vi.fn().mockResolvedValue({ id: 1 }),
  } as unknown as jest.Mocked<WarehouseRepository>;
}

function makeClient(): jest.Mocked<WarehouseClientService> {
  return {
    searchExternalBooks: vi.fn(),
    searchExternalAudiobooks: vi.fn(),
    searchAbiplayerAudiobooks: vi.fn(),
    requestBook: vi.fn(),
    requestAudiobook: vi.fn(),
    requestComic: vi.fn(),
    listAudiobookRequests: vi.fn(),
    listComicRequests: vi.fn(),
    listAudiobookRequestQueue: vi.fn(),
    getBookRequest: vi.fn(),
    cancelBookRequest: vi.fn(),
    streamBookRequest: vi.fn(),
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
    service: new WarehouseRequestService(repo, client, secret, notification, catalogSync),
  };
}

describe('WarehouseRequestService', () => {
  it.each([
    ['missing settings', null],
    ['disabled settings', makeSettingsRow({ enabled: false })],
    ['missing API key', makeSettingsRow({ apiKeyEncrypted: null })],
  ])('rejects %s with a safe native error', async (_label, settings) => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(settings);

    await expect(service.searchExternalBooks('dune')).rejects.toThrow(BadGatewayException);
    await expect(service.searchExternalBooks('dune')).rejects.toThrow('Requests are temporarily unavailable.');
    expect(client.searchExternalBooks).not.toHaveBeenCalled();
  });

  it('rejects decrypt failures with a safe native error', async () => {
    const { service, repo, secret } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    secret.decrypt.mockImplementation(() => {
      throw new Error('raw key failure');
    });

    await expect(service.searchExternalBooks('dune')).rejects.toThrow(BadGatewayException);
    await expect(service.searchExternalBooks('dune')).rejects.toThrow('Requests are temporarily unavailable.');
  });

  it('searches upstream and returns native-safe results without source identity', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.searchExternalBooks.mockResolvedValue({
      results: [
        {
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: '9780441172719',
          source: 'openlibrary',
          coverUrl: 'https://covers.example.test/dune.jpg',
        } as never,
        {
          title: 'catalog-source.example.test/leak',
          author: 'Provider Person',
          isbn: 'api_key:secret',
        },
        {
          title: 'Safe Title',
          author: 'Safe Author',
          isbn: '9780000000002',
        },
      ],
    });

    await expect(service.searchExternalBooks('  dune  ')).resolves.toEqual({
      results: [
        {
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: '9780441172719',
        },
        {
          title: 'Safe Title',
          author: 'Safe Author',
          isbn: '9780000000002',
        },
      ],
    });
    expect(client.searchExternalBooks).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      q: 'dune',
    });
  });

  it('searches upstream audiobook discovery and candidates with safe public result fields only', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.searchExternalAudiobooks.mockResolvedValue({
      results: [
        {
          title: 'Dune',
          author: 'Frank Herbert',
          authors: ['Frank Herbert', 'https://authors.example.test/leak'],
          narrators: ['Simon Vance', 'Bearer secret-token'],
          asin: 'B000R34YKC',
          series: 'Dune',
          duration: 76140,
          source: 'audible',
          coverUrl: 'https://covers.example.test/dune.jpg',
        },
        {
          title: 'catalog-source.example.test/leak',
          author: 'Provider Person',
          asin: 'api_key:secret',
        },
      ],
    });
    client.searchAbiplayerAudiobooks.mockResolvedValue({
      results: [
        {
          id: 'provider-candidate-1',
          title: 'Dune Candidate',
          author: 'Frank Herbert',
          coverUrl: 'https://covers.example.test/dune-candidate.jpg',
          source: 'abiplayer',
        },
      ],
    });

    await expect(service.searchAudiobooks('  dune  ')).resolves.toEqual({
      results: [
        {
          title: 'Dune',
          author: 'Frank Herbert',
          authors: ['Frank Herbert'],
          narrators: ['Simon Vance'],
          asin: 'B000R34YKC',
          series: 'Dune',
          durationSeconds: 76140,
        },
      ],
    });
    await expect(service.searchAudiobookCandidates('  dune  ')).resolves.toEqual({
      results: [
        {
          title: 'Dune Candidate',
          author: 'Frank Herbert',
        },
      ],
    });
    expect(JSON.stringify(client.searchExternalAudiobooks.mock.calls)).not.toContain('Bearer secret-token');
    expect(client.searchExternalAudiobooks).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      q: 'dune',
    });
    expect(client.searchAbiplayerAudiobooks).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      q: 'dune',
    });
  });

  it('rejects empty audiobook search and unsafe submit titles with safe native errors', async () => {
    const { service, client } = makeService();

    await expect(service.searchAudiobooks('   ')).rejects.toThrow(BadRequestException);
    await expect(service.searchAudiobookCandidates('   ')).rejects.toThrow('Search query is required.');
    await expect(service.submitAudiobookRequest(USER, { title: 'https://catalog-source.example.test/request' })).rejects.toThrow(BadRequestException);
    expect(client.searchExternalAudiobooks).not.toHaveBeenCalled();
    expect(client.searchAbiplayerAudiobooks).not.toHaveBeenCalled();
    expect(client.requestAudiobook).not.toHaveBeenCalled();
  });

  it('returns safe native errors for audiobook upstream and secret failures', async () => {
    const { service, repo, client, secret } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.searchExternalAudiobooks.mockRejectedValue(new Error('raw upstream hostname leak'));
    client.requestAudiobook.mockRejectedValue(new Error('raw request failure'));

    await expect(service.searchAudiobooks('dune')).rejects.toThrow(BadGatewayException);
    await expect(service.searchAudiobooks('dune')).rejects.toThrow('Requests are temporarily unavailable.');
    await expect(service.submitAudiobookRequest(USER, { title: 'Dune' })).rejects.toThrow('Requests are temporarily unavailable.');

    secret.decrypt.mockImplementation(() => {
      throw new Error('api_key leaked');
    });
    await expect(service.searchAudiobookCandidates('dune')).rejects.toThrow('Requests are temporarily unavailable.');
  });

  it('submits an ISBN request and upserts a user-owned local mirror', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.requestBook.mockResolvedValue({
      id: 'upstream-10',
      status: 'queued',
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      remote_id: 'book-10',
    });
    repo.upsertRequestMirror.mockResolvedValue(makeRequestRow({ id: 10, title: 'Dune', author: 'Frank Herbert', status: 'processing' }));

    const result = await service.submitEbookRequest(USER, { isbn: '9780441172719', preferredFormat: 'epub' });

    expect(client.requestBook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      isbn: '9780441172719',
      preferred_format: 'epub',
    });
    expect(repo.upsertRequestMirror).toHaveBeenCalledWith({
      mediaType: 'ebook',
      userId: USER.id,
      upstreamRequestId: 'upstream-10',
      status: 'queued',
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      completedRemoteId: 'book-10',
      lastStatusSyncedAt: expect.any(Date),
      requestedPayload: { isbn: '9780441172719', preferredFormat: 'epub' },
    });
    expect(JSON.stringify(result)).not.toContain('upstream-10');
  });

  it('does not mirror unsafe upstream title, author, or isbn from submit responses', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.requestBook.mockResolvedValue({
      id: 'upstream-unsafe',
      status: 'queued',
      title: 'Warehouse API request 123',
      author: 'Catalog source API request 123',
      isbn: 'tok_abcdefghijklmnopqrstuvwxyz123456',
    });
    repo.upsertRequestMirror.mockResolvedValue(makeRequestRow({ title: '9780441172719', author: null, isbn: '9780441172719' }));

    await service.submitEbookRequest(USER, { isbn: '9780441172719' });

    expect(repo.upsertRequestMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '9780441172719',
        author: null,
        isbn: '9780441172719',
      }),
    );
  });

  it('submits a search-result request without inventing upstream fields', async () => {
    const { service, repo, client } = makeService();
    const searchResult = { title: 'Ancillary Justice', author: 'Ann Leckie', isbn: '9780316246620', source: 'openlibrary' };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.requestBook.mockResolvedValue({ id: 'upstream-11', status: 'requested', title: 'Ancillary Justice', author: 'Ann Leckie' });
    repo.upsertRequestMirror.mockResolvedValue(makeRequestRow({ id: 11, title: 'Ancillary Justice', author: 'Ann Leckie' }));

    await service.submitEbookRequest(USER, { searchResult });

    expect(client.requestBook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      search_result: searchResult,
    });
    expect(repo.upsertRequestMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'ebook',
        userId: USER.id,
        upstreamRequestId: 'upstream-11',
        title: 'Ancillary Justice',
        author: 'Ann Leckie',
        isbn: '9780316246620',
        requestedPayload: { searchResult },
      }),
    );
  });

  it('submits an audiobook request and mirrors a user-owned safe local row without upstream metadata', async () => {
    const { service, repo, client } = makeService();
    const opaqueUpstreamId = 'audio-request-abcdefghijklmnopqrstuvwxyz123456';
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.requestAudiobook.mockResolvedValue({
      id: opaqueUpstreamId,
      status: 'queued',
      title: 'https://catalog-source.example.test/leaked-title',
      author: 'api_key leaked',
      coverUrl: 'https://covers.example.test/leak.jpg',
    } as never);
    repo.upsertRequestMirror.mockResolvedValue(
      makeRequestRow({
        id: 10,
        mediaType: 'audiobook',
        upstreamRequestId: opaqueUpstreamId,
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: null,
        requestedPayload: { title: 'Dune', author: 'Frank Herbert' },
      }),
    );

    const result = await service.submitAudiobookRequest(USER, { title: '  Dune  ', author: '  Frank Herbert  ' });

    expect(client.requestAudiobook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      title: 'Dune',
      author: 'Frank Herbert',
    });
    expect(repo.upsertRequestMirror).toHaveBeenCalledWith({
      mediaType: 'audiobook',
      userId: USER.id,
      upstreamRequestId: opaqueUpstreamId,
      status: 'queued',
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: null,
      completedRemoteId: null,
      lastStatusSyncedAt: expect.any(Date),
      requestedPayload: { title: 'Dune', author: 'Frank Herbert' },
    });
    expect(result).toMatchObject({ id: 10, mediaType: 'audiobook', title: 'Dune', author: 'Frank Herbert', isbn: null });
    expect(JSON.stringify(result)).not.toContain(opaqueUpstreamId);
    expect(JSON.stringify(result)).not.toContain('catalog-source.example.test');
  });

  it('submits a comic request and mirrors a user-owned safe local row', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.requestComic.mockResolvedValue({
      id: 'comic-request-1',
      status: 'queued',
      title: '/media/private/Saga',
      author: 'Image',
    } as never);
    repo.upsertRequestMirror.mockResolvedValue(
      makeRequestRow({
        id: 11,
        mediaType: 'comic',
        upstreamRequestId: 'comic-request-1',
        title: 'Saga #1',
        author: 'Image',
        isbn: null,
        requestedPayload: { seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 },
      }),
    );

    const result = await service.submitComicRequest(USER, { seriesTitle: '  Saga  ', issueNumber: ' 1 ', publisher: ' Image ', year: 2012 });

    expect(client.requestComic).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      seriesTitle: 'Saga',
      issueNumber: '1',
      publisher: 'Image',
      year: 2012,
    });
    expect(repo.upsertRequestMirror).toHaveBeenCalledWith({
      mediaType: 'comic',
      userId: USER.id,
      upstreamRequestId: 'comic-request-1',
      status: 'queued',
      title: 'Saga #1',
      author: 'Image',
      isbn: null,
      completedRemoteId: null,
      lastStatusSyncedAt: expect.any(Date),
      requestedPayload: { seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 },
    });
    expect(result).toMatchObject({ id: 11, mediaType: 'comic', title: 'Saga #1', author: 'Image', isbn: null });
    expect(JSON.stringify(result)).not.toContain('/media/');
  });

  it('rejects direct service submits without an ISBN or search result', async () => {
    const { service, client } = makeService();

    await expect(service.submitEbookRequest(USER, {})).rejects.toThrow(BadRequestException);
    await expect(service.submitEbookRequest(USER, { searchResult: {} })).rejects.toThrow(BadRequestException);
    expect(client.requestBook).not.toHaveBeenCalled();
  });

  it('lists and reads user requests from the local mirror only', async () => {
    const { service, repo, client } = makeService();
    repo.listRequestsForUser.mockResolvedValue({ rows: [makeRequestRow()], page: 2, limit: 5, total: 1 });
    repo.findRequestForUser.mockResolvedValue(makeRequestRow());

    await expect(service.listRequests(USER, { status: 'pending', page: 2, limit: 5 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 7, title: 'Requested Book' })],
      page: 2,
      limit: 5,
      total: 1,
    });
    await expect(service.getRequest(USER, 7)).resolves.toMatchObject({ id: 7, title: 'Requested Book' });
    expect(repo.listRequestsForUser).toHaveBeenCalledWith(USER.id, { status: 'pending', page: 2, limit: 5, mediaType: 'ebook' });
    expect(repo.findRequestForUser).toHaveBeenCalledWith(7, USER.id);
    expect(client.getBookRequest).not.toHaveBeenCalled();
  });

  it('lists comic requests from the generic request path when mediaType is comic', async () => {
    const { service, repo, client } = makeService();
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [makeRequestRow({ id: 11, mediaType: 'comic', upstreamRequestId: 'comic-11', title: 'Saga #1', author: 'Image', isbn: null })],
        page: 1,
        limit: 100,
        total: 1,
      })
      .mockResolvedValueOnce({
        rows: [makeRequestRow({ id: 11, mediaType: 'comic', upstreamRequestId: 'comic-11', title: 'Saga #1', author: 'Image', isbn: null })],
        page: 2,
        limit: 5,
        total: 1,
      });
    client.listComicRequests.mockResolvedValue([{ id: 'comic-11', status: 'queued', title: 'Saga #1', author: 'Image' }]);

    await expect(service.listRequests(USER, { mediaType: 'comic', status: 'pending', page: 2, limit: 5 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 11, mediaType: 'comic', title: 'Saga #1' })],
      page: 2,
      limit: 5,
      total: 1,
    });

    expect(client.listComicRequests).toHaveBeenCalledTimes(1);
    expect(repo.listRequestsForUser).toHaveBeenLastCalledWith(USER.id, { mediaType: 'comic', status: 'pending', page: 2, limit: 5 });
  });

  it('lists audiobook requests by syncing only current-user local mirrors that match upstream ids', async () => {
    const { service, repo, client, notification, catalogSync } = makeService();
    const localPending = makeRequestRow({
      id: 21,
      mediaType: 'audiobook',
      upstreamRequestId: 'audio-21',
      status: 'pending',
      title: 'Pending Audio',
      isbn: null,
    });
    const localCompleted = makeRequestRow({
      id: 22,
      mediaType: 'audiobook',
      upstreamRequestId: 'audio-22',
      status: 'completed',
      title: 'Completed Audio',
      isbn: null,
    });
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [localPending, localCompleted, makeRequestRow({ id: 23, mediaType: 'audiobook', upstreamRequestId: null })],
        page: 1,
        limit: 100,
        total: 3,
      })
      .mockResolvedValueOnce({
        rows: [makeRequestRow({ id: 21, mediaType: 'audiobook', status: 'completed', title: 'Ready Audio', isbn: null })],
        page: 2,
        limit: 5,
        total: 1,
      });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(null);
    client.listAudiobookRequests.mockResolvedValue([
      { id: 'audio-21', status: 'available', title: 'Ready Audio', author: 'Narrator Safe', remote_id: 'remote-audio-21' },
      { id: 'audio-unknown', status: 'failed', title: 'Unknown Remote' },
      { id: 'audio-22', status: 'available', title: 'Already Complete' },
    ]);
    repo.updateOpenRequestMirror.mockResolvedValueOnce(
      makeRequestRow({
        id: 21,
        mediaType: 'audiobook',
        status: 'completed',
        title: 'Ready Audio',
        completedRemoteId: 'remote-audio-21',
        isbn: null,
      }),
    );

    await expect(service.listAudiobookRequests(USER, { status: 'pending', page: 2, limit: 5 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 21, mediaType: 'audiobook', status: 'completed' })],
      page: 2,
      limit: 5,
      total: 1,
    });

    expect(client.listAudiobookRequests).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      limit: 100,
    });
    expect(repo.updateOpenRequestMirror).toHaveBeenCalledTimes(1);
    expect(repo.updateOpenRequestMirror).toHaveBeenNthCalledWith(
      1,
      21,
      { userId: USER.id, mediaType: 'audiobook' },
      expect.objectContaining({
        status: 'available',
        title: 'Ready Audio',
        author: 'Narrator Safe',
        completedRemoteId: 'remote-audio-21',
        lastStatusSyncedAt: expect.any(Date),
      }),
    );
    expect(repo.updateRequestMirror).not.toHaveBeenCalled();
    expect(repo.upsertRequestMirror).not.toHaveBeenCalled();
    expect(repo.findCatalogItem).toHaveBeenCalledWith('audiobook', 'remote-audio-21');
    expect(catalogSync.syncAudiobooks).toHaveBeenCalledTimes(1);
    expect(catalogSync.syncEbooks).not.toHaveBeenCalled();
    expect(notification.notify).toHaveBeenCalledTimes(1);
    expect(repo.listRequestsForUser).toHaveBeenLastCalledWith(USER.id, { status: 'pending', page: 2, limit: 5, mediaType: 'audiobook' });
  });

  it('does not notify or sync catalog when audiobook completion loses an open-row claim race', async () => {
    const { service, repo, client, notification, catalogSync } = makeService();
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [
          makeRequestRow({
            id: 24,
            mediaType: 'audiobook',
            upstreamRequestId: 'audio-race',
            status: 'pending',
            title: 'Race Audio',
            isbn: null,
          }),
        ],
        page: 1,
        limit: 100,
        total: 1,
      })
      .mockResolvedValueOnce({ rows: [], page: 1, limit: 20, total: 0 });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listAudiobookRequests.mockResolvedValue([{ id: 'audio-race', status: 'available', title: 'Race Audio', remote_id: 'remote-audio-race' }]);
    repo.updateOpenRequestMirror.mockResolvedValue(undefined);

    await service.refreshAudiobookRequests(USER, {});

    expect(repo.updateOpenRequestMirror).toHaveBeenCalledWith(
      24,
      { userId: USER.id, mediaType: 'audiobook' },
      expect.objectContaining({ status: 'available', completedRemoteId: 'remote-audio-race' }),
    );
    expect(notification.notify).not.toHaveBeenCalled();
    expect(repo.findCatalogItem).not.toHaveBeenCalled();
    expect(catalogSync.syncAudiobooks).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal audiobook row when a stale non-terminal refresh loses the open-row claim', async () => {
    const { service, repo, client, notification } = makeService();
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [
          makeRequestRow({
            id: 25,
            mediaType: 'audiobook',
            upstreamRequestId: 'audio-stale',
            status: 'pending',
            title: 'Stale Audio',
            isbn: null,
          }),
        ],
        page: 1,
        limit: 100,
        total: 1,
      })
      .mockResolvedValueOnce({ rows: [], page: 1, limit: 20, total: 0 });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listAudiobookRequests.mockResolvedValue([{ id: 'audio-stale', status: 'downloading', title: 'Stale Audio' }]);
    repo.updateOpenRequestMirror.mockResolvedValue(undefined);

    await service.refreshAudiobookRequests(USER, {});

    expect(repo.updateOpenRequestMirror).toHaveBeenCalledWith(
      25,
      { userId: USER.id, mediaType: 'audiobook' },
      expect.objectContaining({ status: 'downloading' }),
    );
    expect(repo.updateRequestMirror).not.toHaveBeenCalled();
    expect(notification.notify).not.toHaveBeenCalled();
  });

  it('refreshes audiobook requests while preserving local metadata on partial or unsafe upstream rows', async () => {
    const { service, repo, client } = makeService();
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [
          makeRequestRow({
            id: 31,
            mediaType: 'audiobook',
            upstreamRequestId: 'audio-31',
            status: 'processing',
            title: 'Local Title',
            author: 'Local Author',
            isbn: null,
          }),
        ],
        page: 1,
        limit: 100,
        total: 1,
      })
      .mockResolvedValueOnce({
        rows: [makeRequestRow({ id: 31, mediaType: 'audiobook', status: 'processing', title: 'Local Title', author: 'Local Author', isbn: null })],
        page: 1,
        limit: 20,
        total: 1,
      });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listAudiobookRequests.mockResolvedValue([
      { id: 'audio-31', status: 'processing', title: 'https://catalog-source.example.test/leak', author: 'Bearer raw-token' },
    ]);
    repo.updateOpenRequestMirror.mockResolvedValue(
      makeRequestRow({ id: 31, mediaType: 'audiobook', status: 'processing', title: 'Local Title', author: 'Local Author', isbn: null }),
    );

    await service.refreshAudiobookRequests(USER, {});

    const update = repo.updateOpenRequestMirror.mock.calls[0]![2];
    expect(update).toEqual(
      expect.objectContaining({
        status: 'processing',
        lastStatusSyncedAt: expect.any(Date),
      }),
    );
    expect(update).not.toHaveProperty('upstreamRequestId');
    expect(update).not.toHaveProperty('title');
    expect(update).not.toHaveProperty('author');
    expect(update).not.toHaveProperty('isbn');
  });

  it('refreshes comic requests from matching upstream rows and syncs missing completed comics', async () => {
    const { service, repo, client, catalogSync, notification } = makeService();
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [
          makeRequestRow({
            id: 41,
            mediaType: 'comic',
            upstreamRequestId: 'comic-41',
            status: 'processing',
            title: 'Local Saga #1',
            author: 'Image',
            isbn: null,
          }),
          makeRequestRow({
            id: 42,
            mediaType: 'comic',
            upstreamRequestId: 'comic-42',
            status: 'pending',
            title: 'Local Unsafe',
            author: 'Safe Publisher',
            isbn: null,
          }),
        ],
        page: 1,
        limit: 100,
        total: 2,
      })
      .mockResolvedValueOnce({
        rows: [
          makeRequestRow({
            id: 41,
            mediaType: 'comic',
            status: 'completed',
            title: 'Saga #1',
            author: 'Image',
            isbn: null,
            completedRemoteId: 'comic-remote-41',
          }),
        ],
        page: 1,
        limit: 20,
        total: 1,
      });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(null);
    client.listComicRequests.mockResolvedValue([
      { id: 'comic-41', status: 'available', title: 'Saga #1', author: 'Image', remote_id: 'comic-remote-41' },
      { id: 'comic-42', status: 'processing', title: 'https://catalog-source.example.test/leak', author: 'Bearer raw-token' },
      { id: 'comic-other', status: 'available', title: 'Other User Comic', remote_id: 'comic-other' },
    ]);
    repo.updateOpenRequestMirror
      .mockResolvedValueOnce(
        makeRequestRow({
          id: 41,
          mediaType: 'comic',
          status: 'completed',
          title: 'Saga #1',
          author: 'Image',
          isbn: null,
          completedRemoteId: 'comic-remote-41',
        }),
      )
      .mockResolvedValueOnce(
        makeRequestRow({ id: 42, mediaType: 'comic', status: 'processing', title: 'Local Unsafe', author: 'Safe Publisher', isbn: null }),
      );

    await expect(service.refreshComicRequests(USER, { status: 'completed' })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 41, mediaType: 'comic', status: 'completed', completedRemoteId: 'comic-remote-41' })],
    });

    expect(client.listComicRequests).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      limit: 100,
    });
    expect(repo.updateOpenRequestMirror).toHaveBeenCalledWith(
      41,
      { userId: USER.id, mediaType: 'comic' },
      expect.objectContaining({ status: 'available', title: 'Saga #1', author: 'Image', completedRemoteId: 'comic-remote-41' }),
    );
    const unsafeUpdate = repo.updateOpenRequestMirror.mock.calls[1]![2];
    expect(unsafeUpdate).toEqual(expect.objectContaining({ status: 'processing', lastStatusSyncedAt: expect.any(Date) }));
    expect(unsafeUpdate).not.toHaveProperty('title');
    expect(unsafeUpdate).not.toHaveProperty('author');
    expect(repo.updateOpenRequestMirror).toHaveBeenCalledTimes(2);
    expect(repo.findCatalogItem).toHaveBeenCalledWith('comic', 'comic-remote-41');
    expect(catalogSync.syncComics).toHaveBeenCalledTimes(1);
    expect(catalogSync.syncAudiobooks).not.toHaveBeenCalled();
    expect(notification.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.CatalogRequestCompleted,
        title: 'Request completed',
        actionUrl: '/requests',
        meta: { requestId: 41, mediaType: 'comic', status: 'completed' },
      }),
    );
  });

  it('returns only current-user audiobook queue items matched to local mirrors', async () => {
    const { service, repo, client } = makeService();
    repo.listRequestsForUser.mockResolvedValue({
      rows: [
        makeRequestRow({
          id: 31,
          mediaType: 'audiobook',
          upstreamRequestId: 'queue-1',
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: null,
        }),
        makeRequestRow({
          id: 32,
          mediaType: 'audiobook',
          upstreamRequestId: 'queue-2',
          title: 'Local Queue Title',
          author: 'Local Author',
          isbn: null,
        }),
      ],
      page: 1,
      limit: 100,
      total: 2,
    });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listAudiobookRequestQueue.mockResolvedValue([
      { id: 'queue-1', title: 'Provider Dune', author: 'Provider Person', status: 'downloading' },
      { id: 'queue-other-user', title: 'Other User Title', author: 'Other User', status: 'queued' },
      { id: 'queue-2', title: 'catalog-source.example.test/leak', author: 'authorization: bearer secret', status: 'not-real' },
    ]);

    await expect(service.getAudiobookQueue(USER)).resolves.toEqual({
      items: [
        { title: 'Dune', author: 'Frank Herbert', status: 'processing' },
        { title: 'Local Queue Title', author: 'Local Author', status: 'unknown' },
      ],
    });
    expect(repo.listRequestsForUser).toHaveBeenCalledWith(USER.id, { mediaType: 'audiobook', limit: 100 });
    expect(client.listAudiobookRequestQueue).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      limit: 100,
    });
    expect(repo.upsertRequestMirror).not.toHaveBeenCalled();
    expect(repo.updateRequestMirror).not.toHaveBeenCalled();
  });

  it('does not query the upstream queue when the user has no mirrored audiobook request ids', async () => {
    const { service, repo, client } = makeService();
    repo.listRequestsForUser.mockResolvedValue({
      rows: [makeRequestRow({ id: 31, mediaType: 'audiobook', upstreamRequestId: null, title: 'Local Only', isbn: null })],
      page: 1,
      limit: 100,
      total: 1,
    });

    await expect(service.getAudiobookQueue(USER)).resolves.toEqual({ items: [] });
    expect(client.listAudiobookRequestQueue).not.toHaveBeenCalled();
    expect(repo.findSettings).not.toHaveBeenCalled();
  });

  it('caps audiobook queue responses even when upstream returns more rows than requested', async () => {
    const { service, repo, client } = makeService();
    const localRows = Array.from({ length: 101 }, (_, index) =>
      makeRequestRow({
        id: 1000 + index,
        mediaType: 'audiobook',
        upstreamRequestId: `queue-${index}`,
        title: `Queued Title ${index}`,
        author: 'Local Author',
        isbn: null,
      }),
    );

    repo.listRequestsForUser.mockResolvedValue({
      rows: localRows,
      page: 1,
      limit: 100,
      total: localRows.length,
    });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listAudiobookRequestQueue.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        id: `queue-${index}`,
        title: `Upstream Title ${index}`,
        status: 'queued',
      })),
    );

    const page = await service.getAudiobookQueue(USER);

    expect(page.items).toHaveLength(100);
    expect(page.items.at(0)).toEqual({ title: 'Queued Title 0', author: 'Local Author', status: 'processing' });
    expect(page.items.at(-1)).toEqual({ title: 'Queued Title 99', author: 'Local Author', status: 'processing' });
  });

  it('sends audiobook status notifications only for non-terminal to completed or failed transitions', async () => {
    const { service, repo, client, notification } = makeService();
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [
          makeRequestRow({
            id: 41,
            mediaType: 'audiobook',
            upstreamRequestId: 'audio-complete',
            status: 'pending',
            title: 'Completed Soon',
            isbn: null,
          }),
          makeRequestRow({ id: 42, mediaType: 'audiobook', upstreamRequestId: 'audio-fail', status: 'processing', title: 'Failed Soon', isbn: null }),
          makeRequestRow({
            id: 43,
            mediaType: 'audiobook',
            upstreamRequestId: 'audio-already',
            status: 'completed',
            title: 'Already Complete',
            isbn: null,
          }),
          makeRequestRow({
            id: 44,
            mediaType: 'audiobook',
            upstreamRequestId: 'audio-unchanged',
            status: 'pending',
            title: 'Still Pending',
            isbn: null,
          }),
        ],
        page: 1,
        limit: 100,
        total: 4,
      })
      .mockResolvedValueOnce({ rows: [], page: 1, limit: 20, total: 0 });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listAudiobookRequests.mockResolvedValue([
      { id: 'audio-complete', status: 'available', title: 'Completed Soon' },
      { id: 'audio-fail', status: 'error', title: 'Failed Soon' },
      { id: 'audio-already', status: 'available', title: 'Already Complete' },
      { id: 'audio-unchanged', status: 'pending', title: 'Still Pending' },
    ]);
    repo.updateOpenRequestMirror.mockImplementation((id, _scope, data) =>
      Promise.resolve(makeRequestRow({ id, mediaType: 'audiobook', status: data.status ?? 'unknown', isbn: null })),
    );

    await service.refreshAudiobookRequests(USER, {});

    expect(notification.notify).toHaveBeenCalledTimes(2);
    expect(notification.notify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: NotificationType.CatalogRequestCompleted,
        title: 'Request completed',
        message: 'Completed Soon is ready.',
        actionUrl: '/requests',
        scope: { kind: 'user', userId: USER.id },
        meta: expect.objectContaining({ requestId: 41, mediaType: 'audiobook', status: 'completed' }),
      }),
    );
    expect(notification.notify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: NotificationType.CatalogRequestFailed,
        title: 'Request failed',
        message: 'Failed Soon could not be completed.',
        actionUrl: '/requests',
        scope: { kind: 'user', userId: USER.id },
        meta: expect.objectContaining({ requestId: 42, mediaType: 'audiobook', status: 'failed' }),
      }),
    );
  });

  it('continues audiobook sync and returns the local list when notification dispatch fails', async () => {
    const { service, repo, client, notification } = makeService();
    repo.listRequestsForUser
      .mockResolvedValueOnce({
        rows: [
          makeRequestRow({ id: 51, mediaType: 'audiobook', upstreamRequestId: 'audio-first', status: 'pending', title: 'First Audio', isbn: null }),
          makeRequestRow({
            id: 52,
            mediaType: 'audiobook',
            upstreamRequestId: 'audio-second',
            status: 'processing',
            title: 'Second Audio',
            isbn: null,
          }),
        ],
        page: 1,
        limit: 100,
        total: 2,
      })
      .mockResolvedValueOnce({
        rows: [makeRequestRow({ id: 52, mediaType: 'audiobook', status: 'failed', title: 'Second Audio', isbn: null })],
        page: 1,
        limit: 20,
        total: 1,
      });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listAudiobookRequests.mockResolvedValue([
      { id: 'audio-first', status: 'available', title: 'First Audio' },
      { id: 'audio-second', status: 'error', title: 'Second Audio' },
    ]);
    repo.updateOpenRequestMirror
      .mockResolvedValueOnce(makeRequestRow({ id: 51, mediaType: 'audiobook', status: 'completed', title: 'First Audio', isbn: null }))
      .mockResolvedValueOnce(makeRequestRow({ id: 52, mediaType: 'audiobook', status: 'failed', title: 'Second Audio', isbn: null }));
    notification.notify.mockRejectedValueOnce(new Error('notification database unavailable')).mockResolvedValueOnce(undefined);

    await expect(service.refreshAudiobookRequests(USER, {})).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 52, status: 'failed' })],
    });
    expect(repo.updateOpenRequestMirror).toHaveBeenCalledTimes(2);
    expect(notification.notify).toHaveBeenCalledTimes(2);
  });

  it('returns safe 404 when a local request is missing', async () => {
    const { service, repo } = makeService();
    repo.findRequestForUser.mockResolvedValue(null);

    await expect(service.getRequest(USER, 404)).rejects.toThrow(NotFoundException);
    await expect(service.getRequest(USER, 404)).rejects.toThrow('Request is not available.');
  });

  it('refreshes only after local ownership is verified and mirrors upstream status', async () => {
    const { service, repo, client, catalogSync } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ id: 12, upstreamRequestId: 'upstream-12' }));
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(null);
    client.getBookRequest.mockResolvedValue({
      id: 'upstream-12',
      status: 'available',
      title: 'Ready Book',
      author: 'Bea Writer',
      isbn: '9780000000012',
      remote_id: 'remote-book-12',
    });
    repo.updateOpenRequestMirror.mockResolvedValue(
      makeRequestRow({ id: 12, status: 'completed', title: 'Ready Book', author: 'Bea Writer', completedRemoteId: 'remote-book-12' }),
    );

    await expect(service.refreshRequest(USER, 12)).resolves.toMatchObject({ id: 12, status: 'completed', title: 'Ready Book' });
    expect(repo.findRequestForUser).toHaveBeenCalledWith(12, USER.id);
    expect(client.getBookRequest).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'upstream-12',
    });
    expect(repo.updateOpenRequestMirror).toHaveBeenCalledWith(
      12,
      { userId: USER.id, mediaType: 'ebook' },
      expect.objectContaining({
        status: 'available',
        title: 'Ready Book',
        author: 'Bea Writer',
        isbn: '9780000000012',
        completedRemoteId: 'remote-book-12',
      }),
    );
    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-book-12');
    expect(catalogSync.syncEbooks).toHaveBeenCalledTimes(1);
    expect(catalogSync.syncAudiobooks).not.toHaveBeenCalled();
  });

  it('preserves existing mirror fields when refresh receives a partial upstream status response', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ id: 12, upstreamRequestId: 'upstream-12' }));
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.getBookRequest.mockResolvedValue({
      status: 'processing',
    });
    repo.updateOpenRequestMirror.mockResolvedValue(makeRequestRow({ id: 12, status: 'processing' }));

    await service.refreshRequest(USER, 12);

    const update = repo.updateOpenRequestMirror.mock.calls[0]![2];
    expect(update).toEqual(
      expect.objectContaining({
        status: 'processing',
        lastStatusSyncedAt: expect.any(Date),
      }),
    );
    expect(update).not.toHaveProperty('upstreamRequestId');
    expect(update).not.toHaveProperty('title');
    expect(update).not.toHaveProperty('author');
    expect(update).not.toHaveProperty('isbn');
    expect(update).not.toHaveProperty('completedRemoteId');
  });

  it('returns the current ebook row when a refresh loses the open-row claim', async () => {
    const { service, repo, client, catalogSync } = makeService();
    repo.findRequestForUser
      .mockResolvedValueOnce(makeRequestRow({ id: 12, upstreamRequestId: 'upstream-12', status: 'pending' }))
      .mockResolvedValueOnce(makeRequestRow({ id: 12, upstreamRequestId: 'upstream-12', status: 'completed', title: 'Already Ready' }));
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.getBookRequest.mockResolvedValue({
      id: 'upstream-12',
      status: 'processing',
      title: 'Still Processing',
    });
    repo.updateOpenRequestMirror.mockResolvedValue(undefined);

    await expect(service.refreshRequest(USER, 12)).resolves.toMatchObject({ id: 12, status: 'completed', title: 'Already Ready' });
    expect(repo.updateOpenRequestMirror).toHaveBeenCalledWith(
      12,
      { userId: USER.id, mediaType: 'ebook' },
      expect.objectContaining({ status: 'processing', title: 'Still Processing' }),
    );
    expect(repo.updateRequestMirror).not.toHaveBeenCalled();
    expect(catalogSync.syncEbooks).not.toHaveBeenCalled();
  });

  it('does not mirror unsafe upstream metadata during refresh', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ id: 12, upstreamRequestId: 'upstream-12' }));
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.getBookRequest.mockResolvedValue({
      id: 'upstream-12',
      status: 'available',
      title: 'Warehouse API request 123',
      author: 'Catalog source API request 123',
      isbn: 'tok_abcdefghijklmnopqrstuvwxyz123456',
    });
    repo.updateOpenRequestMirror.mockResolvedValue(
      makeRequestRow({ id: 12, status: 'completed', title: 'Library request', author: null, isbn: null }),
    );

    await service.refreshRequest(USER, 12);

    const update = repo.updateOpenRequestMirror.mock.calls[0]![2];
    expect(update).toEqual(
      expect.objectContaining({
        upstreamRequestId: 'upstream-12',
        status: 'available',
        lastStatusSyncedAt: expect.any(Date),
      }),
    );
    expect(update).not.toHaveProperty('title');
    expect(update).not.toHaveProperty('author');
    expect(update).not.toHaveProperty('isbn');
  });

  it('does not call upstream when refresh cannot verify local ownership', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(null);

    await expect(service.refreshRequest(USER, 12)).rejects.toThrow(NotFoundException);
    expect(client.getBookRequest).not.toHaveBeenCalled();
  });

  it('does not call upstream refresh for non-ebook local rows', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ mediaType: 'audiobook', upstreamRequestId: 'audio-upstream-1' }));

    await expect(service.refreshRequest(USER, 12)).rejects.toThrow(NotFoundException);
    expect(client.getBookRequest).not.toHaveBeenCalled();
  });

  it('returns the existing native detail when refresh has no upstream request id', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ upstreamRequestId: null }));

    await expect(service.refreshRequest(USER, 12)).resolves.toMatchObject({ id: 7, title: 'Requested Book' });
    expect(client.getBookRequest).not.toHaveBeenCalled();
  });

  it('cancels upstream after ownership verification and marks the local mirror cancelled', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ id: 13, upstreamRequestId: 'upstream-13' }));
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.cancelBookRequest.mockResolvedValue({ status: 204, payload: null });
    repo.deleteRequestMirror.mockResolvedValue(makeRequestRow({ id: 13, status: 'cancelled' }));

    await expect(service.cancelRequest(USER, 13)).resolves.toMatchObject({ id: 13, status: 'cancelled' });
    expect(client.cancelBookRequest).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'upstream-13',
    });
    expect(repo.deleteRequestMirror).toHaveBeenCalledWith(13, USER.id);
  });

  it('does not call upstream cancel for non-ebook local rows', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ mediaType: 'audiobook', upstreamRequestId: 'audio-upstream-1' }));

    await expect(service.cancelRequest(USER, 13)).rejects.toThrow(NotFoundException);
    expect(client.cancelBookRequest).not.toHaveBeenCalled();
    expect(repo.deleteRequestMirror).not.toHaveBeenCalled();
  });

  it('streams completed ebook requests after local ownership verification', async () => {
    const { service, repo, client } = makeService();
    const binary = {
      status: 200,
      contentType: 'application/epub+zip',
      contentLength: 4,
      contentRange: null,
      acceptRanges: null,
      body: Buffer.from('epub'),
      fileName: 'requested.epub',
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ id: 7, status: 'completed', upstreamRequestId: 'upstream-7' }));
    client.streamBookRequest.mockResolvedValue(binary);

    await expect(service.streamRequest(USER, 7)).resolves.toBe(binary);
    expect(client.streamBookRequest).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'upstream-7',
    });
  });

  it('returns a safe unavailable 404 for request streams that are not completed', async () => {
    const { service, repo, client } = makeService();
    repo.findRequestForUser.mockResolvedValue(makeRequestRow({ status: 'processing', upstreamRequestId: 'upstream-7' }));

    await expect(service.streamRequest(USER, 7)).rejects.toThrow(NotFoundException);
    await expect(service.streamRequest(USER, 7)).rejects.toThrow('Request stream is not available.');
    expect(client.streamBookRequest).not.toHaveBeenCalled();
  });
});
