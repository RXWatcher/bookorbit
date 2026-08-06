import { NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { WarehouseAudiobookQueuePage, WarehouseRequestDetail, WarehouseRequestPage } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';

import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { WarehouseRequestController } from './warehouse-request.controller';

const USER = { id: 42 } as RequestUser;

function makeDetail(overrides: Partial<WarehouseRequestDetail> = {}): WarehouseRequestDetail {
  return {
    id: 7,
    mediaType: 'ebook',
    status: 'pending',
    title: 'Requested Book',
    author: 'Ada Writer',
    isbn: '9780000000007',
    completedRemoteId: null,
    requestedAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:05:00.000Z',
    lastStatusSyncedAt: null,
    requestedPayload: { isbn: '9780000000007' },
    ...overrides,
  };
}

function makeController() {
  const service = {
    searchExternalBooks: vi.fn(),
    searchAudiobooks: vi.fn(),
    searchAudiobookCandidates: vi.fn(),
    submitEbookRequest: vi.fn(),
    submitAudiobookRequest: vi.fn(),
    submitComicRequest: vi.fn(),
    listRequests: vi.fn(),
    listAudiobookRequests: vi.fn(),
    listComicRequests: vi.fn(),
    refreshAudiobookRequests: vi.fn(),
    refreshComicRequests: vi.fn(),
    getAudiobookQueue: vi.fn(),
    getRequest: vi.fn(),
    refreshRequest: vi.fn(),
    cancelRequest: vi.fn(),
    streamRequest: vi.fn(),
  };

  return {
    controller: new WarehouseRequestController(service as never),
    service,
  };
}

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnValue('sent'),
  };
}

describe('WarehouseRequestController', () => {
  it('serves native Requests URLs while preserving legacy catalog compatibility', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseRequestController)).toEqual(['catalog/requests', 'requests']);
  });

  it('does not attach admin permission metadata to regular request routes', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.searchEbooks)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.searchAudiobooks)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.searchAudiobookCandidates)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.submitEbookRequest)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.submitAudiobookRequest)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.submitComicRequest)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.listRequests)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.listAudiobookRequests)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.listComicRequests)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.refreshAudiobookRequests)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.refreshComicRequests)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.getAudiobookQueue)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.getRequest)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.refreshRequest)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.cancelRequest)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseRequestController.prototype.streamRequest)).toBeUndefined();
  });

  it('normalizes search query text and delegates ebook search', async () => {
    const { controller, service } = makeController();
    const expected = { results: [{ title: 'Dune', author: 'Frank Herbert' }] };
    service.searchExternalBooks.mockResolvedValue(expected);

    await expect(controller.searchEbooks(USER, '  dune  ')).resolves.toBe(expected);
    expect(service.searchExternalBooks).toHaveBeenCalledWith('dune');
  });

  it('delegates submit with the current user and public DTO only', async () => {
    const { controller, service } = makeController();
    const expected = makeDetail();
    service.submitEbookRequest.mockResolvedValue(expected);

    const result = await controller.submitEbookRequest(USER, { isbn: '9780000000007' });

    expect(service.submitEbookRequest).toHaveBeenCalledWith(USER, { isbn: '9780000000007' });
    expect(result).toBe(expected);
    expect(result).not.toHaveProperty('upstreamRequestId');
  });

  it('normalizes audiobook search query text and delegates discovery routes', async () => {
    const { controller, service } = makeController();
    const expected = { results: [{ title: 'Dune', author: 'Frank Herbert' }] };
    service.searchAudiobooks.mockResolvedValue(expected);
    service.searchAudiobookCandidates.mockResolvedValue(expected);

    await expect(controller.searchAudiobooks(USER, '  dune audio  ')).resolves.toBe(expected);
    await expect(controller.searchAudiobookCandidates(USER, '  dune candidate  ')).resolves.toBe(expected);
    expect(service.searchAudiobooks).toHaveBeenCalledWith('dune audio');
    expect(service.searchAudiobookCandidates).toHaveBeenCalledWith('dune candidate');
  });

  it('delegates audiobook submit with the current user and public DTO only', async () => {
    const { controller, service } = makeController();
    const expected = makeDetail({ mediaType: 'audiobook', title: 'Dune', author: 'Frank Herbert', isbn: null, requestedPayload: { title: 'Dune' } });
    service.submitAudiobookRequest.mockResolvedValue(expected);

    const result = await controller.submitAudiobookRequest(USER, { title: 'Dune', author: 'Frank Herbert' });

    expect(service.submitAudiobookRequest).toHaveBeenCalledWith(USER, { title: 'Dune', author: 'Frank Herbert' });
    expect(result).toBe(expected);
    expect(result).not.toHaveProperty('upstreamRequestId');
  });

  it('normalizes audiobook list and refresh query routes and delegates with the current user', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseRequestPage = { items: [], page: 3, limit: 10, total: 0 };
    service.listAudiobookRequests.mockResolvedValue(expected);
    service.refreshAudiobookRequests.mockResolvedValue(expected);

    await expect(controller.listAudiobookRequests(USER, { status: 'processing', page: '3' as never, limit: '10' as never })).resolves.toBe(expected);
    await expect(controller.refreshAudiobookRequests(USER, { status: 'failed', page: '2' as never, limit: '5' as never })).resolves.toBe(expected);
    expect(service.listAudiobookRequests).toHaveBeenCalledWith(USER, { status: 'processing', page: 3, limit: 10 });
    expect(service.refreshAudiobookRequests).toHaveBeenCalledWith(USER, { status: 'failed', page: 2, limit: 5 });
  });

  it('normalizes comic list and refresh query routes and delegates with the current user', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseRequestPage = { items: [], page: 3, limit: 10, total: 0 };
    service.listComicRequests.mockResolvedValue(expected);
    service.refreshComicRequests.mockResolvedValue(expected);

    await expect(controller.listComicRequests(USER, { status: 'processing', page: '3' as never, limit: '10' as never })).resolves.toBe(expected);
    await expect(controller.refreshComicRequests(USER, { status: 'failed', page: '2' as never, limit: '5' as never })).resolves.toBe(expected);
    expect(service.listComicRequests).toHaveBeenCalledWith(USER, { status: 'processing', page: 3, limit: 10 });
    expect(service.refreshComicRequests).toHaveBeenCalledWith(USER, { status: 'failed', page: 2, limit: 5 });
  });

  it('delegates audiobook queue without persisting local request rows', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseAudiobookQueuePage = { items: [{ title: 'Dune', author: 'Frank Herbert', status: 'processing' }] };
    service.getAudiobookQueue.mockResolvedValue(expected);

    await expect(controller.getAudiobookQueue(USER)).resolves.toBe(expected);
    expect(service.getAudiobookQueue).toHaveBeenCalledWith(USER);
  });

  it('normalizes request list query and delegates with the current user', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseRequestPage = { items: [], page: 2, limit: 25, total: 0 };
    service.listRequests.mockResolvedValue(expected);

    await expect(
      controller.listRequests(USER, { status: 'pending', page: '2' as never, limit: '25' as never, mediaType: 'comic' } as never),
    ).resolves.toBe(expected);
    expect(service.listRequests).toHaveBeenCalledWith(USER, { status: 'pending', page: 2, limit: 25, mediaType: 'comic' });
  });

  it('delegates id routes with parsed numeric ids and current user', async () => {
    const { controller, service } = makeController();
    const expected = makeDetail({ id: 9 });
    service.getRequest.mockResolvedValue(expected);
    service.refreshRequest.mockResolvedValue(expected);
    service.cancelRequest.mockResolvedValue({ ...expected, status: 'cancelled' });

    await expect(controller.getRequest(USER, 9)).resolves.toBe(expected);
    await expect(controller.refreshRequest(USER, 9)).resolves.toBe(expected);
    await expect(controller.cancelRequest(USER, 9)).resolves.toMatchObject({ id: 9, status: 'cancelled' });
    expect(service.getRequest).toHaveBeenCalledWith(USER, 9);
    expect(service.refreshRequest).toHaveBeenCalledWith(USER, 9);
    expect(service.cancelRequest).toHaveBeenCalledWith(USER, 9);
  });

  it('delegates stream route with current user and id', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const body = Buffer.from('epub');
    service.streamRequest.mockResolvedValue({
      status: 200,
      contentType: 'application/epub+zip; charset=utf-8',
      contentLength: 4,
      contentRange: null,
      acceptRanges: 'bytes',
      body,
      fileName: 'Requested Book.epub',
    });

    await expect(controller.streamRequest(USER, 9, reply as never)).resolves.toBe('sent');
    expect(service.streamRequest).toHaveBeenCalledWith(USER, 9);
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '4');
    expect(reply.header).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="Requested Book.epub"; filename*=UTF-8\'\'Requested%20Book.epub',
    );
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.send).toHaveBeenCalledWith(body);
  });

  it('returns safe 404 errors from the service unchanged', async () => {
    const { controller, service } = makeController();
    service.getRequest.mockRejectedValue(new NotFoundException('Request is not available.'));

    await expect(controller.getRequest(USER, 404)).rejects.toThrow(NotFoundException);
    await expect(controller.getRequest(USER, 404)).rejects.toThrow('Request is not available.');
  });
});
