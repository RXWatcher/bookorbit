vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

import { NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';

import { KoboThumbnailService } from './kobo-thumbnail.service';

const statMock = vi.mocked(stat);
const readdirMock = vi.mocked(readdir);
const createReadStreamMock = vi.mocked(createReadStream);

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

describe('KoboThumbnailService', () => {
  const bookAccessService = {
    assertBookAccessible: vi.fn(),
    resolveCatalogEbookRemoteId: vi.fn(),
  };
  const warehouseCatalog = {
    getEbookCover: vi.fn(),
  };
  const config = {
    get: vi.fn().mockReturnValue('/app-data'),
  };
  let service: KoboThumbnailService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    service = new KoboThumbnailService(config as never, bookAccessService as never, warehouseCatalog as never);
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    bookAccessService.resolveCatalogEbookRemoteId.mockResolvedValue('remote/book-12');
  });

  it('returns 304 when thumbnail etag matches if-none-match', async () => {
    const reply = makeReply();
    statMock.mockResolvedValueOnce({ mtimeMs: 1234 } as never);

    await service.serveThumbnail(7, 12, '"1234"', reply as never);

    expect(bookAccessService.assertBookAccessible).toHaveBeenCalledWith(7, 12);
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(createReadStreamMock).not.toHaveBeenCalled();
  });

  it('streams thumbnail bytes and sets cache headers', async () => {
    const reply = makeReply();
    const stream = {} as never;
    statMock.mockResolvedValueOnce({ mtimeMs: 5678 } as never);
    createReadStreamMock.mockReturnValue(stream);

    await service.serveThumbnail(7, 12, undefined, reply as never);

    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'max-age=86400');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"5678"');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('falls back to cover serving when thumbnail file lookup fails', async () => {
    const reply = makeReply();
    statMock.mockRejectedValueOnce(new Error('missing thumbnail'));
    const coverSpy = vi.spyOn(service, 'serveCover').mockResolvedValue(undefined);

    await service.serveThumbnail(7, 12, undefined, reply as never);

    expect(coverSpy).toHaveBeenCalledWith(12, undefined, reply);
  });

  it('serveCover uses preferred cover file and returns matching content type', async () => {
    const reply = makeReply();
    const stream = {} as never;
    readdirMock.mockResolvedValueOnce(['cover_extracted.jpg', 'cover_custom.png']);
    statMock.mockResolvedValueOnce({ mtimeMs: 9999 } as never);
    createReadStreamMock.mockReturnValue(stream);

    await service.serveCover(25, undefined, reply as never);

    expect(reply.header).toHaveBeenCalledWith('ETag', '"9999"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('serveCover returns 304 for matching cover etag', async () => {
    const reply = makeReply();
    readdirMock.mockResolvedValueOnce(['cover_extracted.jpg']);
    statMock.mockResolvedValueOnce({ mtimeMs: 2222 } as never);

    await service.serveCover(13, '"2222"', reply as never);

    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
  });

  it('throws NotFoundException when no cover image is available', async () => {
    readdirMock.mockResolvedValueOnce([]);

    await expect(service.serveCover(25, undefined, makeReply() as never)).rejects.toThrow(NotFoundException);
  });

  it('serves catalog ebook covers through user-scoped catalog media with safe image headers', async () => {
    const reply = makeReply();
    const body = Buffer.from('img');
    warehouseCatalog.getEbookCover.mockResolvedValue({
      body,
      contentType: 'image/webp; private=https://example.invalid',
      contentLength: body.length,
      fileName: 'private.webp',
      status: 200,
      contentRange: null,
      acceptRanges: null,
    });

    await service.serveCatalogThumbnail(7, 42, undefined, reply as never);

    expect(warehouseCatalog.getEbookCover).toHaveBeenCalledWith({ id: 7 }, 'remote/book-12', 'thumbnail');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'max-age=86400');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"catalog-3"');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '3');
    expect(reply.type).toHaveBeenCalledWith('image/webp');
    expect(reply.send).toHaveBeenCalledWith(body);
  });

  it('returns 304 for matching catalog cover etags', async () => {
    warehouseCatalog.getEbookCover.mockResolvedValue({
      body: Buffer.from('img'),
      contentType: 'image/jpeg',
      contentLength: 3,
      fileName: null,
      status: 200,
      contentRange: null,
      acceptRanges: null,
    });

    await service.serveCatalogThumbnail(7, 42, '"catalog-3"', makeReply() as never);

    expect(warehouseCatalog.getEbookCover).toHaveBeenCalledWith({ id: 7 }, 'remote/book-12', 'thumbnail');
  });

  it('rejects catalog cover responses that are not images', async () => {
    warehouseCatalog.getEbookCover.mockResolvedValue({
      body: Buffer.from('nope'),
      contentType: 'text/html',
      contentLength: 4,
      fileName: null,
      status: 200,
      contentRange: null,
      acceptRanges: null,
    });

    await expect(service.serveCatalogThumbnail(7, 42, undefined, makeReply() as never)).rejects.toThrow('Library media is temporarily unavailable.');
  });
});
