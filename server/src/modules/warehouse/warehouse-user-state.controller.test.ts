import { BadRequestException } from '@nestjs/common';
import type { WarehouseUserCatalogState } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';

import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { WarehouseUserStateController } from './warehouse-user-state.controller';

const USER = { id: 42 } as RequestUser;

function makeState(overrides: Partial<WarehouseUserCatalogState> = {}): WarehouseUserCatalogState {
  return {
    mediaType: 'ebook',
    remoteId: 'remote-7',
    inLibrary: false,
    favorite: false,
    rating: null,
    readStatus: null,
    progressPercent: null,
    positionSeconds: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeController() {
  const service = {
    getState: vi.fn(),
    patchState: vi.fn(),
    getBookmarks: vi.fn(),
    createBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
    saveReadingSession: vi.fn(),
  };

  return {
    controller: new WarehouseUserStateController(service as never),
    service,
  };
}

describe('WarehouseUserStateController', () => {
  it('does not attach admin permission metadata to regular state routes', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseUserStateController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseUserStateController.prototype.getState)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseUserStateController.prototype.patchState)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseUserStateController.prototype.getBookmarks)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseUserStateController.prototype.createBookmark)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseUserStateController.prototype.deleteBookmark)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseUserStateController.prototype.saveReadingSession)).toBeUndefined();
  });

  it('delegates GET with the current user and normalized params', async () => {
    const { controller, service } = makeController();
    const expected = makeState();
    service.getState.mockResolvedValue(expected);

    await expect(controller.getState(USER, ' ebook ', ' remote-7 ')).resolves.toBe(expected);
    expect(service.getState).toHaveBeenCalledWith(USER, 'ebook', 'remote-7');
  });

  it('delegates PATCH with the current user, normalized params, and sanitized patch object', async () => {
    const { controller, service } = makeController();
    const expected = makeState({ favorite: true, updatedAt: '2026-06-03T14:15:16.000Z' });
    service.patchState.mockResolvedValue(expected);

    await expect(
      controller.patchState(USER, ' audiobook ', ' audio-9 ', {
        favorite: true,
        rating: 4,
        apiKey: 'do-not-pass',
        baseUrl: 'https://example.test',
        upstreamRequestId: 'request-9',
        rawPayload: { secret: true },
        raw: { secret: true },
      } as never),
    ).resolves.toBe(expected);
    expect(service.patchState).toHaveBeenCalledWith(USER, 'audiobook', 'audio-9', { favorite: true, rating: 4 });
  });

  it.each([
    ['null body', null],
    ['primitive body', 'favorite'],
    ['array body', []],
    ['omitted body', undefined],
  ])('rejects malformed PATCH body: %s', async (_label, patch) => {
    const { controller, service } = makeController();

    await expect(controller.patchState(USER, 'ebook', 'remote-7', patch as never)).rejects.toThrow(BadRequestException);
    await expect(controller.patchState(USER, 'ebook', 'remote-7', patch as never)).rejects.toThrow('State update must be an object.');
    expect(service.patchState).not.toHaveBeenCalled();
  });

  it('controller response contains no secret, upstream, or raw fields', async () => {
    const { controller, service } = makeController();
    service.patchState.mockResolvedValue(makeState({ favorite: true }));

    const response = await controller.patchState(USER, 'ebook', 'remote-7', { favorite: true });

    expect(response).not.toHaveProperty('apiKey');
    expect(response).not.toHaveProperty('baseUrl');
    expect(response).not.toHaveProperty('upstreamRequestId');
    expect(response).not.toHaveProperty('rawPayload');
    expect(response).not.toHaveProperty('raw');
  });

  it('delegates catalog reading session saves with the current user and normalized params', async () => {
    const { controller, service } = makeController();
    const payload = {
      sessionId: 'session-1',
      startedAt: '2026-06-15T12:00:00.000Z',
      endedAt: '2026-06-15T12:01:00.000Z',
      durationSeconds: 60,
      progressDelta: 2,
      endProgress: 12,
    };

    await expect(controller.saveReadingSession(USER, ' ebook ', ' remote-7 ', payload)).resolves.toBeUndefined();
    expect(service.saveReadingSession).toHaveBeenCalledWith(USER, 'ebook', 'remote-7', payload);
  });

  it('delegates catalog bookmark list with the current user and normalized params', async () => {
    const { controller, service } = makeController();
    const expected = [{ id: 17, mediaType: 'ebook', remoteId: 'remote-7', title: 'Chapter 2' }];
    service.getBookmarks.mockResolvedValue(expected);

    await expect(controller.getBookmarks(USER, ' ebook ', ' remote-7 ')).resolves.toBe(expected);
    expect(service.getBookmarks).toHaveBeenCalledWith(USER, 'ebook', 'remote-7');
  });

  it('delegates catalog bookmark creation with an allowlisted body', async () => {
    const { controller, service } = makeController();
    const expected = { id: 18, mediaType: 'ebook', remoteId: 'remote-7', title: 'Chapter 3' };
    service.createBookmark.mockResolvedValue(expected);

    await expect(
      controller.createBookmark(USER, ' ebook ', ' remote-7 ', {
        cfi: 'epubcfi(/6/10)',
        title: 'Chapter 3',
        positionSeconds: 12,
        apiKey: 'do-not-pass',
        baseUrl: 'https://example.test',
        upstreamRequestId: 'request-9',
        rawPayload: { secret: true },
      } as never),
    ).resolves.toBe(expected);
    expect(service.createBookmark).toHaveBeenCalledWith(USER, 'ebook', 'remote-7', {
      cfi: 'epubcfi(/6/10)',
      title: 'Chapter 3',
      positionSeconds: 12,
    });
  });

  it('delegates catalog bookmark deletion with the current user and normalized params', async () => {
    const { controller, service } = makeController();
    service.deleteBookmark.mockResolvedValue(undefined);

    await expect(controller.deleteBookmark(USER, ' ebook ', ' remote-7 ', 17)).resolves.toBeUndefined();
    expect(service.deleteBookmark).toHaveBeenCalledWith(USER, 'ebook', 'remote-7', 17);
  });
});
