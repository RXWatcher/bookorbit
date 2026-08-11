import { NotFoundException } from '@nestjs/common';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

import type { WarehouseBinaryResponse } from '../warehouse/warehouse-client.service';
import { AbsAssetService } from './abs-asset.service';

describe('AbsAssetService', () => {
  const user = { id: 17, isSuperuser: false } as any;

  it('delegates local covers to bookService.getCoverPath and returns a local descriptor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abs-cover-'));
    const coverDir = join(root, 'book', '55');
    const coverPath = join(coverDir, 'cover.jpg');
    await mkdir(coverDir, { recursive: true });
    await writeFile(coverPath, Buffer.from([1, 2, 3]));

    const libraryService = {
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
    };
    const bookService = {
      getCoverPath: vi.fn().mockResolvedValue(coverPath),
      getDetail: vi.fn().mockResolvedValue({ libraryId: 3 }),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
      getEbookCover: vi.fn(),
      getAudiobookCover: vi.fn(),
      downloadEbook: vi.fn(),
      downloadComic: vi.fn(),
      streamAudiobook: vi.fn(),
      downloadAudiobook: vi.fn(),
      getAudiobook: vi.fn(),
      downloadAudiobookFile: vi.fn(),
    };
    const service = new AbsAssetService(libraryService as never, bookService as never, warehouseCatalogService as never);

    const result = await service.resolveCover(user, 'bo_l_3_book_55');

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 3, user.isSuperuser);
    expect(bookService.getCoverPath).toHaveBeenCalledWith(55, user);
    expect(result).toMatchObject({
      source: 'local',
      contentType: 'image/jpeg',
      contentLength: 3,
      etag: expect.any(String),
      cacheControl: 'private, max-age=86400',
    });
  });

  it('looks up accessible warehouse ebooks before requesting their covers', async () => {
    const warehouseBinary = binaryResponse({ contentType: 'image/png' });
    const libraryService = {
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
    };
    const bookService = {
      getCoverPath: vi.fn(),
      getDetail: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
        id: 77,
        mediaType: 'ebook',
        remoteId: 'remote-secret-77',
      }),
      getEbookCover: vi.fn().mockResolvedValue(warehouseBinary),
      getAudiobookCover: vi.fn(),
      downloadEbook: vi.fn(),
      downloadComic: vi.fn(),
      streamAudiobook: vi.fn(),
      downloadAudiobook: vi.fn(),
      getAudiobook: vi.fn(),
      downloadAudiobookFile: vi.fn(),
    };
    const service = new AbsAssetService(libraryService as never, bookService as never, warehouseCatalogService as never);

    const result = await service.resolveCover(user, 'bo_bw_ebook_catalog_77');

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, CLOUD_EBOOK_LIBRARY_ID, user.isSuperuser);
    expect(warehouseCatalogService.findAccessibleCatalogItemById).toHaveBeenCalledWith(user, 'ebook', 77);
    expect(warehouseCatalogService.getEbookCover).toHaveBeenCalledWith(user, 'remote-secret-77', 'medium');
    expect(result).toBe(warehouseBinary);
  });

  it('forwards range headers for warehouse audiobook downloads and streams', async () => {
    const warehouseBinary = binaryResponse({ status: 206, contentRange: 'bytes 10-99/1000', acceptRanges: 'bytes' });
    const libraryService = {
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AbsAssetService(
      libraryService as never,
      {
        getCoverPath: vi.fn(),
        getDetail: vi.fn(),
      } as never,
      {
        findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
          id: 77,
          mediaType: 'audiobook',
          remoteId: 'remote-secret-77',
        }),
        getEbookCover: vi.fn(),
        getAudiobookCover: vi.fn(),
        downloadEbook: vi.fn(),
        downloadComic: vi.fn(),
        streamAudiobook: vi.fn().mockResolvedValue(warehouseBinary),
        downloadAudiobook: vi.fn().mockResolvedValue(warehouseBinary),
        getAudiobook: vi.fn().mockResolvedValue({
          id: 'remote-secret-77',
          title: 'Audio Dune',
          authors: ['Frank Herbert'],
          narrators: ['Simon Vance'],
          files: [{ id: 'file-1', name: 'Part 1.m4b', format: 'm4b', durationSeconds: 120, sizeBytes: 4096 }],
          chapters: [],
        }),
        downloadAudiobookFile: vi.fn().mockResolvedValue(warehouseBinary),
      } as never,
    );

    await service.resolveDownload(user, 'bo_bw_audio_catalog_77', 'bytes=10-99');
    await service.resolveTrack(user, 'bo_bw_audio_catalog_77', '1', 'bytes=10-99');

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, CLOUD_AUDIO_LIBRARY_ID, user.isSuperuser);
    expect(service['warehouseCatalogService'].downloadAudiobook).toHaveBeenCalledWith(user, 'remote-secret-77', 'bytes=10-99');
    expect(service['warehouseCatalogService'].downloadAudiobookFile).toHaveBeenCalledWith(user, 'remote-secret-77', 'file-1', 'bytes=10-99');
  });

  it('returns hosted track URLs for warehouse audiobook playback without leaking upstream ids', async () => {
    const service = new AbsAssetService(
      {
        verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        getCoverPath: vi.fn(),
        getDetail: vi.fn(),
      } as never,
      {
        findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
          id: 77,
          mediaType: 'audiobook',
          remoteId: 'remote-secret-77',
        }),
        getEbookCover: vi.fn(),
        getAudiobookCover: vi.fn(),
        downloadEbook: vi.fn(),
        downloadComic: vi.fn(),
        streamAudiobook: vi.fn(),
        downloadAudiobook: vi.fn(),
        getAudiobook: vi.fn().mockResolvedValue({
          id: 'remote-secret-77',
          title: 'Audio Dune',
          authors: ['Frank Herbert'],
          narrators: ['Simon Vance'],
          files: [
            { id: 'file-1', name: 'Part 1.m4b', format: 'm4b', durationSeconds: 120, sizeBytes: 4096 },
            { id: 'file-2', name: 'Part 2.m4b', format: 'm4b', durationSeconds: 240, sizeBytes: 8192 },
          ],
          chapters: [],
        }),
        downloadAudiobookFile: vi.fn(),
      } as never,
    );

    const result = await service.resolvePlay(user, 'bo_bw_audio_catalog_77');

    expect(result).toEqual({
      mediaType: 'audiobook',
      audioTracks: [
        {
          index: 1,
          contentUrl: '/api/items/bo_bw_audio_catalog_77/tracks/1/stream',
          mimeType: 'audio/mp4',
        },
        {
          index: 2,
          contentUrl: '/api/items/bo_bw_audio_catalog_77/tracks/2/stream',
          mimeType: 'audio/mp4',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('remote-secret-77');
    expect(JSON.stringify(result)).not.toContain('file-1');
    expect(JSON.stringify(result)).not.toContain('file-2');
  });

  it('returns not found when a filtered warehouse item is requested for assets', async () => {
    const service = new AbsAssetService(
      {
        verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        getCoverPath: vi.fn(),
        getDetail: vi.fn(),
      } as never,
      {
        findAccessibleCatalogItemById: vi.fn().mockResolvedValue(null),
        getEbookCover: vi.fn(),
        getAudiobookCover: vi.fn(),
        downloadEbook: vi.fn(),
        downloadComic: vi.fn(),
        streamAudiobook: vi.fn(),
        downloadAudiobook: vi.fn(),
        getAudiobook: vi.fn(),
        downloadAudiobookFile: vi.fn(),
      } as never,
    );

    await expect(service.resolveCover(user, 'bo_bw_audio_catalog_77')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pipes local suffix ranges as 206 and preserves content-type parameters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abs-download-'));
    const filePath = join(root, 'part.opus');
    await writeFile(filePath, Buffer.from('abcdefghij'));

    const reply = createReplyRecorder();
    const service = new AbsAssetService(
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      {
        getDetail: vi.fn().mockResolvedValue({
          id: 55,
          libraryId: 3,
          files: [{ id: 701, role: 'primary', format: 'opus' }],
        }),
        getFileInfo: vi.fn().mockResolvedValue({
          path: filePath,
          size: 10,
          format: 'opus',
          bookId: 55,
          originalFilename: 'part.opus',
        }),
        resolveDownloadFilename: vi.fn().mockResolvedValue('part.opus'),
      } as never,
      { findAccessibleCatalogItemById: vi.fn() } as never,
    );

    await service.pipeDownload(user, 'bo_l_3_book_55', 'bytes=-5', reply as never);

    expect(reply.statusCode).toBe(206);
    expect(reply.headers['Content-Range']).toBe('bytes 5-9/10');
    expect(reply.headers['Accept-Ranges']).toBe('bytes');
    expect(reply.headers['Content-Length']).toBe('5');
    expect(reply.contentType).toBe('audio/ogg; codecs=opus');
  });

  it('returns 416 for invalid local ranges with safe range headers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abs-download-'));
    const filePath = join(root, 'book.epub');
    await writeFile(filePath, Buffer.from('abcdefghij'));

    const reply = createReplyRecorder();
    const service = new AbsAssetService(
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      {
        getDetail: vi.fn().mockResolvedValue({
          id: 55,
          libraryId: 3,
          files: [{ id: 702, role: 'primary', format: 'epub' }],
        }),
        getFileInfo: vi.fn().mockResolvedValue({
          path: filePath,
          size: 10,
          format: 'epub',
          bookId: 55,
          originalFilename: 'book.epub',
        }),
        resolveDownloadFilename: vi.fn().mockResolvedValue('book.epub'),
      } as never,
      { findAccessibleCatalogItemById: vi.fn() } as never,
    );

    await service.pipeDownload(user, 'bo_l_3_book_55', 'bytes=abc', reply as never);

    expect(reply.statusCode).toBe(416);
    expect(reply.headers['Content-Range']).toBe('bytes */10');
    expect(reply.headers['Accept-Ranges']).toBe('bytes');
    expect(reply.headers['Content-Length']).toBe('0');
  });

  it('returns 416 for suffix ranges against zero-byte local files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'abs-download-'));
    const filePath = join(root, 'empty.opus');
    await writeFile(filePath, Buffer.alloc(0));

    const reply = createReplyRecorder();
    const service = new AbsAssetService(
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      {
        getDetail: vi.fn().mockResolvedValue({
          id: 55,
          libraryId: 3,
          files: [{ id: 703, role: 'primary', format: 'opus' }],
        }),
        getFileInfo: vi.fn().mockResolvedValue({
          path: filePath,
          size: 0,
          format: 'opus',
          bookId: 55,
          originalFilename: 'empty.opus',
        }),
        resolveDownloadFilename: vi.fn().mockResolvedValue('empty.opus'),
      } as never,
      { findAccessibleCatalogItemById: vi.fn() } as never,
    );

    await service.pipeDownload(user, 'bo_l_3_book_55', 'bytes=-5', reply as never);

    expect(reply.statusCode).toBe(416);
    expect(reply.headers['Content-Range']).toBe('bytes */0');
    expect(reply.headers['Accept-Ranges']).toBe('bytes');
    expect(reply.headers['Content-Length']).toBe('0');
  });

  it('pipes warehouse partial responses and preserves content-type parameters', async () => {
    const reply = createReplyRecorder();
    const service = new AbsAssetService(
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      {
        getCoverPath: vi.fn(),
        getDetail: vi.fn(),
      } as never,
      {
        findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
          id: 77,
          mediaType: 'audiobook',
          remoteId: 'remote-secret-77',
        }),
        getAudiobook: vi.fn().mockResolvedValue({
          id: 'remote-secret-77',
          files: [{ id: 'file-1', name: 'Part 1.opus', format: 'opus', durationSeconds: 120, sizeBytes: 4096 }],
        }),
        downloadAudiobookFile: vi.fn().mockResolvedValue(
          binaryResponse({
            status: 206,
            contentType: 'audio/ogg; codecs=opus',
            contentRange: 'bytes 10-99/1000',
            acceptRanges: 'bytes',
            contentLength: 90,
          }),
        ),
      } as never,
    );

    await service.pipeTrack(user, 'bo_bw_audio_catalog_77', '1', 'bytes=10-99', reply as never);

    expect(reply.statusCode).toBe(206);
    expect(reply.headers['Content-Range']).toBe('bytes 10-99/1000');
    expect(reply.headers['Accept-Ranges']).toBe('bytes');
    expect(reply.headers['Content-Length']).toBe('90');
    expect(reply.contentType).toBe('audio/ogg; codecs=opus');
  });

  it('pipes warehouse unsatisfied ranges as 416 with safe headers', async () => {
    const reply = createReplyRecorder();
    const service = new AbsAssetService(
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      {
        getCoverPath: vi.fn(),
        getDetail: vi.fn(),
      } as never,
      {
        findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
          id: 77,
          mediaType: 'audiobook',
          remoteId: 'remote-secret-77',
        }),
        getAudiobook: vi.fn().mockResolvedValue({
          id: 'remote-secret-77',
          files: [{ id: 'file-1', name: 'Part 1.m4b', format: 'm4b', durationSeconds: 120, sizeBytes: 4096 }],
        }),
        downloadAudiobookFile: vi.fn().mockResolvedValue(
          binaryResponse({
            status: 416,
            contentRange: 'bytes */1000',
            acceptRanges: 'bytes',
            contentLength: 0,
          }),
        ),
      } as never,
    );

    await service.pipeTrack(user, 'bo_bw_audio_catalog_77', '1', 'bytes=5000-', reply as never);

    expect(reply.statusCode).toBe(416);
    expect(reply.headers['Content-Range']).toBe('bytes */1000');
    expect(reply.headers['Accept-Ranges']).toBe('bytes');
    expect(reply.headers['Content-Length']).toBe('0');
  });
});

function binaryResponse(overrides: Partial<WarehouseBinaryResponse> = {}): WarehouseBinaryResponse {
  return {
    body: Buffer.from([1, 2, 3]),
    contentType: 'application/octet-stream',
    contentLength: 3,
    status: 200,
    contentRange: null,
    acceptRanges: null,
    ...overrides,
  };
}

function createReplyRecorder() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    contentType: undefined as string | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    header(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    type(value: string) {
      this.contentType = value;
      return this;
    },
    send(value?: unknown) {
      return value;
    },
  };
}
