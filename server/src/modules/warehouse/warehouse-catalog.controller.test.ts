import { Readable } from 'node:stream';

import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type {
  WarehouseAudiobookCatalogPage,
  WarehouseAudiobookDetail,
  WarehouseCatalogDimensionPage,
  WarehouseComicCatalogPage,
  WarehouseComicDetail,
  WarehouseComicSeriesSummary,
  WarehouseComicSummary,
  WarehouseEbookCatalogPage,
  WarehouseEbookDetail,
  WarehouseListPage,
} from '@bookorbit/types';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { WarehouseCatalogController, WarehouseComicApiController, WarehouseLibraryMediaController } from './warehouse-catalog.controller';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 42,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: null,
    ...overrides,
  };
}

function makeController() {
  const service = {
    listEbooks: vi.fn(),
    getEbook: vi.fn(),
    getEbookCover: vi.fn(),
    downloadEbook: vi.fn(),
    listComics: vi.fn(),
    listComicSeries: vi.fn(),
    searchComicSeries: vi.fn(),
    listComicSeriesItems: vi.fn(),
    getComic: vi.fn(),
    listComicPages: vi.fn(),
    getComicPageImage: vi.fn(),
    downloadComic: vi.fn(),
    listAudiobooks: vi.fn(),
    getAudiobook: vi.fn(),
    getAudiobookCover: vi.fn(),
    streamAudiobook: vi.fn(),
    downloadAudiobook: vi.fn(),
    downloadAudiobookFile: vi.fn(),
    listEbookGenres: vi.fn(),
    listEbooksByGenre: vi.fn(),
    listAudiobookAuthors: vi.fn(),
    listAudiobooksByAuthor: vi.fn(),
    listAudiobookSeries: vi.fn(),
    listAudiobooksBySeries: vi.fn(),
    listAudiobookGenres: vi.fn(),
    listAudiobooksByGenre: vi.fn(),
    listAudiobookNarrators: vi.fn(),
  };
  const requestService = {
    submitComicRequest: vi.fn(),
    listComicRequests: vi.fn(),
  };

  return {
    controller: new WarehouseCatalogController(service as never),
    libraryMediaController: new WarehouseLibraryMediaController(service as never),
    comicApiController: new WarehouseComicApiController(service as never, requestService as never),
    service,
    requestService,
  };
}

describe('WarehouseCatalogController', () => {
  it('does not attach admin permission metadata to cached catalog reads', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listEbooks)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.getEbook)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.downloadEbook)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listComics)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listComicSeries)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.searchComicSeries)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listComicSeriesItems)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.getComic)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listComicPages)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.getComicPageImage)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.downloadComic)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listEbookGenres)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listAudiobooks)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.getAudiobook)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.getAudiobookCover)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.streamAudiobook)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.downloadAudiobook)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.downloadAudiobookFile)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listAudiobookAuthors)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseCatalogController.prototype.listAudiobookNarrators)).toBeUndefined();
  });

  it('does not expose the legacy ABS-style audiobook compatibility route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseCatalogController)).toBe('catalog');
    expect('getAudiobookshelfItem' in WarehouseCatalogController.prototype).toBe(false);
  });

  it('declares comic series routes before comic detail route patterns', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseCatalogController.prototype.listComicSeries)).toBe('comics/series');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseCatalogController.prototype.searchComicSeries)).toBe('comics/series/search');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseCatalogController.prototype.listComicSeriesItems)).toBe('comics/series/:seriesId/items');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseCatalogController.prototype.getComic)).toBe('comics/:remoteId');
  });

  it('declares native library media routes while preserving catalog media compatibility', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController)).toBe('libraries');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.listComicItems)).toBe('comics/items');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.getComicItem)).toBe('comics/items/:remoteId');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.getEbookCover)).toBe('ebooks/items/:remoteId/cover/:size');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.downloadEbook)).toBe('ebooks/items/:remoteId/download');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.listComicPages)).toBe('comics/items/:remoteId/pages');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.getComicPageImage)).toBe(
      'comics/items/:remoteId/pages/:pageIndex',
    );
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.downloadComic)).toBe('comics/items/:remoteId/download');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.getAudiobookCover)).toBe('audiobooks/items/:remoteId/cover');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.streamAudiobook)).toBe('audiobooks/items/:remoteId/stream');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.downloadAudiobook)).toBe(
      'audiobooks/items/:remoteId/download',
    );
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseLibraryMediaController.prototype.downloadAudiobookFile)).toBe(
      'audiobooks/items/:remoteId/files/:fileId/download',
    );
  });

  it('declares normal-user Book Warehouse-compatible comic routes without admin permission metadata', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController)).toBe('comics');
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseComicApiController)).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.listComicItems)).toBe('items');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.getComicItem)).toBe('items/:remoteId');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.listComicPages)).toBe('items/:remoteId/pages');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.getComicPageImage)).toBe('items/:remoteId/pages/:pageIndex');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.downloadComic)).toBe('items/:remoteId/download');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.listComicSeries)).toBe('series');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.searchComicSeries)).toBe('series/search');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.listComicSeriesItems)).toBe('series/:seriesId/items');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.submitComicRequest)).toBe('requests');
    expect(Reflect.getMetadata(PATH_METADATA, WarehouseComicApiController.prototype.listComicRequests)).toBe('requests');
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseComicApiController.prototype.downloadComic)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, WarehouseComicApiController.prototype.submitComicRequest)).toBeUndefined();
  });

  it('normalizes list query params and delegates to the catalog service', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseEbookCatalogPage = {
      items: [],
      page: 2,
      limit: 25,
      total: 0,
    };
    service.listEbooks.mockResolvedValue(expected);

    const result = await controller.listEbooks({
      q: 'dune',
      page: '2',
      limit: '25',
      sort: 'author',
      order: 'asc',
      author: 'Frank Herbert',
      series: 'Dune',
      language: 'en',
      format: 'epub',
      hasCover: 'true',
    });

    expect(service.listEbooks).toHaveBeenCalledWith({
      q: 'dune',
      page: 2,
      limit: 25,
      sort: 'author',
      order: 'asc',
      author: 'Frank Herbert',
      series: 'Dune',
      language: 'en',
      format: 'epub',
      hasCover: true,
    });
    expect(result).toBe(expected);
  });

  it('delegates detail lookups to the catalog service', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseEbookDetail = {
      id: 7,
      remoteId: 'remote-7',
      title: 'Leviathan Wakes',
      subtitle: null,
      authors: ['James S. A. Corey'],
      series: 'The Expanse',
      language: 'en',
      publisher: 'Orbit',
      identifiers: { isbn13: '9780316129084' },
      format: 'epub',
      hasCover: true,
      syncedAt: '2026-06-02T10:00:00.000Z',
      source: 'catalog-source',
    };
    service.getEbook.mockResolvedValue(expected);

    const result = await controller.getEbook('remote-7');

    expect(service.getEbook).toHaveBeenCalledWith('remote-7');
    expect(result).toBe(expected);
    expect(result).not.toHaveProperty('raw');
  });

  it('delegates comic series browsing through native catalog routes', async () => {
    const { controller, service } = makeController();
    const seriesPage: WarehouseListPage<WarehouseComicSeriesSummary> = {
      items: [{ id: 'series-1', title: 'Saga', publisher: 'Image', year: 2012 }],
      page: 1,
      limit: 10,
      total: 1,
      hasNextPage: false,
    };
    const itemPage: WarehouseListPage<WarehouseComicSummary> = {
      items: [{ id: 'comic-1', title: 'Saga #1', seriesId: 'series-1', issueNumber: '1', year: 2012 }],
      page: 2,
      limit: 20,
      total: 1,
      hasNextPage: false,
    };
    service.listComicSeries.mockResolvedValue(seriesPage);
    service.searchComicSeries.mockResolvedValue(seriesPage);
    service.listComicSeriesItems.mockResolvedValue(itemPage);

    await expect(controller.listComicSeries({ page: '1', limit: '10' })).resolves.toBe(seriesPage);
    await expect(controller.searchComicSeries({ q: 'crossed', page: '1', limit: '5' })).resolves.toBe(seriesPage);
    await expect(controller.listComicSeriesItems('series%201', { page: '2', limit: '20' })).resolves.toBe(itemPage);

    expect(service.listComicSeries).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(service.searchComicSeries).toHaveBeenCalledWith({ q: 'crossed', page: 1, limit: 5 });
    expect(service.listComicSeriesItems).toHaveBeenCalledWith('series 1', { page: 2, limit: 20 });
    expect(JSON.stringify(seriesPage)).not.toMatch(/warehouse|upstream|\/media\/|ceph:/i);
  });

  it('delegates native Comic Library item list and detail aliases through safe catalog JSON routes', async () => {
    const { libraryMediaController, service } = makeController();
    const page: WarehouseComicCatalogPage = {
      items: [
        {
          id: 31,
          remoteId: 'comic-1',
          title: 'Saga #1',
          subtitle: null,
          authors: ['Brian K. Vaughan'],
          series: 'Saga',
          seriesIndex: 1,
          language: 'en',
          publisher: 'Image',
          identifiers: {},
          format: 'cbz',
          hasCover: true,
          syncedAt: '2026-06-10T00:00:00.000Z',
          source: 'catalog-source',
        },
      ],
      page: 2,
      limit: 5,
      total: 1,
    };
    const detail: WarehouseComicDetail = {
      id: 31,
      remoteId: 'comic-1',
      title: 'Saga #1',
      subtitle: null,
      authors: ['Brian K. Vaughan'],
      series: 'Saga',
      seriesIndex: 1,
      language: 'en',
      publisher: 'Image',
      identifiers: {},
      format: 'cbz',
      hasCover: true,
      syncedAt: '2026-06-10T00:00:00.000Z',
      source: 'catalog-source',
    };
    service.listComics.mockResolvedValue(page);
    service.getComic.mockResolvedValue(detail);

    await expect(
      libraryMediaController.listComicItems({
        q: 'saga',
        page: '2',
        limit: '5',
        sort: 'title',
        order: 'asc',
        hasCover: 'true',
      }),
    ).resolves.toBe(page);
    await expect(libraryMediaController.getComicItem('comic-1')).resolves.toBe(detail);

    expect(service.listComics).toHaveBeenCalledWith({
      q: 'saga',
      page: 2,
      limit: 5,
      sort: 'title',
      order: 'asc',
      hasCover: true,
    });
    expect(service.getComic).toHaveBeenCalledWith('comic-1');
    expect(JSON.stringify(page)).not.toMatch(/\/media\/|ceph:|storage_path|media_path/i);
    expect(JSON.stringify(detail)).not.toMatch(/\/media\/|ceph:|storage_path|media_path/i);
  });

  it('delegates Book Warehouse-compatible comic item, media, series, and request aliases through normal-user services', async () => {
    const { comicApiController, requestService, service } = makeController();
    const user = makeUser({ id: 7 });
    const reply = makeReply();
    const page: WarehouseComicCatalogPage = {
      items: [{ id: 31, remoteId: 'comic-1', title: 'Saga #1', authors: [], identifiers: {}, syncedAt: '2026-06-10T00:00:00.000Z' }],
      page: 1,
      limit: 5,
      total: 1,
    };
    const detail: WarehouseComicDetail = {
      id: 31,
      remoteId: 'comic-1',
      title: 'Saga #1',
      subtitle: null,
      authors: ['Brian K. Vaughan'],
      series: 'Saga',
      seriesIndex: 1,
      language: 'en',
      publisher: 'Image',
      identifiers: {},
      format: 'cbz',
      hasCover: true,
      syncedAt: '2026-06-10T00:00:00.000Z',
      source: 'catalog-source',
    };
    const seriesPage: WarehouseListPage<WarehouseComicSeriesSummary> = {
      items: [{ id: 'series-1', title: 'Saga', publisher: 'Image', year: 2012 }],
      page: 1,
      limit: 10,
      total: 1,
      hasNextPage: false,
    };
    const requestPage = { items: [], page: 1, limit: 10, total: 0 };
    const requestDetail = { id: 9, mediaType: 'comic', title: 'Saga #1', status: 'pending' };
    service.listComics.mockResolvedValue(page);
    service.getComic.mockResolvedValue(detail);
    service.listComicPages.mockResolvedValue({ items: [{ index: 0, contentType: 'image/jpeg' }], total: 1 });
    service.getComicPageImage.mockResolvedValue({
      status: 206,
      contentType: 'image/jpeg',
      contentLength: 1024,
      contentRange: 'bytes 0-1023/2048',
      acceptRanges: 'bytes',
      body: Buffer.from('page'),
      fileName: null,
    });
    service.downloadComic.mockResolvedValue({
      status: 200,
      contentType: 'application/vnd.comicbook+zip',
      contentLength: 2048,
      body: Buffer.from('comic'),
      fileName: 'Unsafe.cbz',
    });
    service.listComicSeries.mockResolvedValue(seriesPage);
    service.searchComicSeries.mockResolvedValue(seriesPage);
    service.listComicSeriesItems.mockResolvedValue(page);
    requestService.submitComicRequest.mockResolvedValue(requestDetail);
    requestService.listComicRequests.mockResolvedValue(requestPage);

    await expect(comicApiController.listComicItems({ limit: '5', sort: 'title', order: 'asc' })).resolves.toEqual({
      ...page,
      items: [{ id: 'comic-1', remoteId: 'comic-1', title: 'Saga #1', authors: [], identifiers: {}, syncedAt: '2026-06-10T00:00:00.000Z' }],
    });
    await expect(comicApiController.getComicItem('comic-1')).resolves.toEqual({
      id: 'comic-1',
      remoteId: 'comic-1',
      title: 'Saga #1',
      subtitle: null,
      authors: ['Brian K. Vaughan'],
      series: 'Saga',
      seriesIndex: 1,
      language: 'en',
      publisher: 'Image',
      identifiers: {},
      format: 'cbz',
      hasCover: true,
      syncedAt: '2026-06-10T00:00:00.000Z',
    });
    await expect(comicApiController.listComicPages(user, 'comic-1')).resolves.toEqual({ items: [{ index: 0, contentType: 'image/jpeg' }], total: 1 });
    await comicApiController.getComicPageImage(user, 'comic-1', '0', reply as never, 'bytes=0-1023');
    await comicApiController.downloadComic(user, 'comic-1', reply as never);
    await expect(comicApiController.listComicSeries({ limit: '10' })).resolves.toBe(seriesPage);
    await expect(comicApiController.searchComicSeries({ q: 'saga', limit: '10' })).resolves.toBe(seriesPage);
    await expect(comicApiController.listComicSeriesItems('series%201', { limit: '20' })).resolves.toBe(page);
    await expect(
      comicApiController.submitComicRequest(user, { seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 }),
    ).resolves.toBe(requestDetail);
    await expect(comicApiController.listComicRequests(user, { limit: '10' as never })).resolves.toBe(requestPage);

    expect(service.listComics).toHaveBeenCalledWith({ page: undefined, limit: 5, sort: 'title', order: 'asc' });
    expect(service.getComic).toHaveBeenCalledWith('comic-1');
    expect(service.listComicPages).toHaveBeenCalledWith(user, 'comic-1');
    expect(service.getComicPageImage).toHaveBeenCalledWith(user, 'comic-1', 0, 'bytes=0-1023');
    expect(service.downloadComic).toHaveBeenCalledWith(user, 'comic-1');
    expect(service.listComicSeries).toHaveBeenCalledWith({ page: undefined, limit: 10 });
    expect(service.searchComicSeries).toHaveBeenCalledWith({ q: 'saga', page: undefined, limit: 10 });
    expect(service.listComicSeriesItems).toHaveBeenCalledWith('series 1', { page: undefined, limit: 20 });
    expect(requestService.submitComicRequest).toHaveBeenCalledWith(user, { seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 });
    expect(requestService.listComicRequests).toHaveBeenCalledWith(user, { limit: 10 });
    expect(reply.status).toHaveBeenCalledWith(206);
    expect(reply.header).toHaveBeenCalledWith('Content-Range', 'bytes 0-1023/2048');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="comic-download.cbz"; filename*=UTF-8\'\'comic-download.cbz',
    );
    const listJson = JSON.stringify(await comicApiController.listComicItems({ limit: '5', sort: 'title', order: 'asc' }));
    const detailJson = JSON.stringify(await comicApiController.getComicItem('comic-1'));
    expect(JSON.parse(listJson).items[0].id).toBe('comic-1');
    expect(JSON.parse(detailJson).id).toBe('comic-1');
    expect(listJson).not.toMatch(/catalog-source|source|warehouse|upstream|\/media\/|ceph:|storage_path|media_path/i);
    expect(detailJson).not.toMatch(/catalog-source|source|warehouse|upstream|\/media\/|ceph:|storage_path|media_path/i);
  });

  it('forwards Book Warehouse-compatible comic archive and page range requests with safe partial response headers', async () => {
    const { comicApiController, service } = makeController();
    const user = makeUser({ id: 7 });
    const archiveReply = makeReply();
    const pageReply = makeReply();
    service.downloadComic.mockResolvedValue({
      status: 206,
      contentType: 'application/vnd.comicbook+zip',
      contentLength: 1024,
      contentRange: 'bytes 0-1023/4096',
      acceptRanges: 'bytes',
      body: Buffer.from('archive-range'),
      fileName: '/media/private/Saga.cbz',
    });
    service.getComicPageImage.mockResolvedValue({
      status: 206,
      contentType: 'image/jpeg',
      contentLength: 1024,
      contentRange: 'bytes 0-1023/2048',
      acceptRanges: 'bytes',
      body: Buffer.from('page-range'),
      fileName: 'ceph://private/page-0.jpg',
    });

    await comicApiController.downloadComic(user, 'comic-1', archiveReply as never, 'bytes=0-1023');
    await comicApiController.getComicPageImage(user, 'comic-1', '0', pageReply as never, 'bytes=0-1023');

    expect(service.downloadComic).toHaveBeenCalledWith(user, 'comic-1', 'bytes=0-1023');
    expect(service.getComicPageImage).toHaveBeenCalledWith(user, 'comic-1', 0, 'bytes=0-1023');
    expect(archiveReply.status).toHaveBeenCalledWith(206);
    expect(archiveReply.header).toHaveBeenCalledWith('Content-Length', '1024');
    expect(archiveReply.header).toHaveBeenCalledWith('Content-Range', 'bytes 0-1023/4096');
    expect(archiveReply.header).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(archiveReply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="comic-download.cbz"; filename*=UTF-8\'\'comic-download.cbz',
    );
    expect(archiveReply.header).not.toHaveBeenCalledWith('Location', expect.any(String));
    expect(archiveReply.send).toHaveBeenCalledWith(Buffer.from('archive-range'));
    expect(pageReply.status).toHaveBeenCalledWith(206);
    expect(pageReply.header).toHaveBeenCalledWith('Content-Length', '1024');
    expect(pageReply.header).toHaveBeenCalledWith('Content-Range', 'bytes 0-1023/2048');
    expect(pageReply.header).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(pageReply.header).not.toHaveBeenCalledWith('Content-Disposition', expect.any(String));
    expect(pageReply.header).not.toHaveBeenCalledWith('Location', expect.any(String));
    expect(pageReply.send).toHaveBeenCalledWith(Buffer.from('page-range'));
  });

  it('delegates ebook genre routes with local opaque ids', async () => {
    const { controller, service } = makeController();
    const dimensions: WarehouseCatalogDimensionPage = {
      items: [{ id: 'Science%20Fiction', name: 'Science Fiction', itemCount: 2 }],
      total: 1,
    };
    const page: WarehouseEbookCatalogPage = {
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    };
    service.listEbookGenres.mockResolvedValue(dimensions);
    service.listEbooksByGenre.mockResolvedValue(page);

    await expect(controller.listEbookGenres()).resolves.toBe(dimensions);
    await expect(controller.listEbooksByGenre('Science%20Fiction', { page: '2', limit: '5' })).resolves.toBe(page);

    expect(service.listEbookGenres).toHaveBeenCalledTimes(1);
    expect(service.listEbooksByGenre).toHaveBeenCalledWith('Science Fiction', { page: 2, limit: 5 });
    expect(JSON.stringify(dimensions)).not.toContain('warehouse');
    expect(JSON.stringify(dimensions)).not.toContain('remote-');
  });

  it('returns a safe 404 when detail lookups are missing or disabled', async () => {
    const { controller, service } = makeController();
    service.getEbook.mockResolvedValue(null);

    const result = controller.getEbook('missing-remote-id');

    await expect(result).rejects.toThrow(NotFoundException);
    await expect(result).rejects.toThrow('Library item is not available.');
    expect(service.getEbook).toHaveBeenCalledWith('missing-remote-id');
    expect(service.getEbook).toHaveBeenCalledTimes(1);
  });

  it('delegates ebook cover requests for the current user and sends safe image headers', async () => {
    const { controller, service } = makeController();
    const user = makeUser({ id: 7 });
    const reply = makeReply();
    service.getEbookCover.mockResolvedValue({
      status: 200,
      contentType: 'image/webp',
      contentLength: 300,
      body: Buffer.from('img'),
      fileName: null,
    });

    await controller.getEbookCover(user, 'remote-9', 'medium', reply as never);

    expect(service.getEbookCover).toHaveBeenCalledWith(user, 'remote-9', 'medium');
    expect(reply.type).toHaveBeenCalledWith('image/webp');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '300');
    expect(reply.header).not.toHaveBeenCalledWith('Content-Disposition', expect.any(String));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('img'));
  });

  it('normalizes audiobook list query params and delegates to the catalog service', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseAudiobookCatalogPage = {
      items: [],
      page: 2,
      limit: 25,
      total: 0,
    };
    service.listAudiobooks.mockResolvedValue(expected);

    const result = await controller.listAudiobooks({
      q: 'reader',
      page: '2',
      limit: '25',
      sort: 'narrator',
      order: 'desc',
      author: 'N. K. Jemisin',
      narrator: 'Robin Miles',
      series: 'Broken Earth',
      language: 'en',
      format: 'm4b',
      hasCover: '1',
    });

    expect(service.listAudiobooks).toHaveBeenCalledWith({
      q: 'reader',
      page: 2,
      limit: 25,
      sort: 'narrator',
      order: 'desc',
      author: 'N. K. Jemisin',
      narrator: 'Robin Miles',
      series: 'Broken Earth',
      language: 'en',
      format: 'm4b',
      hasCover: true,
    });
    expect(result).toBe(expected);
  });

  it('delegates audiobook dimension routes with local opaque ids', async () => {
    const { controller, service } = makeController();
    const dimensions: WarehouseCatalogDimensionPage = {
      items: [{ id: 'Robin%20Miles', name: 'Robin Miles', itemCount: 2 }],
      total: 1,
    };
    const page: WarehouseAudiobookCatalogPage = {
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    };
    service.listAudiobookAuthors.mockResolvedValue(dimensions);
    service.listAudiobookNarrators.mockResolvedValue(dimensions);
    service.listAudiobookSeries.mockResolvedValue(dimensions);
    service.listAudiobookGenres.mockResolvedValue(dimensions);
    service.listAudiobooksByAuthor.mockResolvedValue(page);
    service.listAudiobooksBySeries.mockResolvedValue(page);
    service.listAudiobooksByGenre.mockResolvedValue(page);

    await expect(controller.listAudiobookAuthors()).resolves.toBe(dimensions);
    await expect(controller.listAudiobookNarrators()).resolves.toBe(dimensions);
    await expect(controller.listAudiobookSeries()).resolves.toBe(dimensions);
    await expect(controller.listAudiobookGenres()).resolves.toBe(dimensions);
    await expect(controller.listAudiobooksByAuthor('Robin%20Miles', { page: '2', limit: '5' })).resolves.toBe(page);
    await expect(controller.listAudiobooksBySeries('Broken%20Earth', { page: '3', limit: '10' })).resolves.toBe(page);
    await expect(controller.listAudiobooksByGenre('Fantasy', { page: '4', limit: '15' })).resolves.toBe(page);

    expect(service.listAudiobookAuthors).toHaveBeenCalledTimes(1);
    expect(service.listAudiobookNarrators).toHaveBeenCalledTimes(1);
    expect(service.listAudiobookSeries).toHaveBeenCalledTimes(1);
    expect(service.listAudiobookGenres).toHaveBeenCalledTimes(1);
    expect(service.listAudiobooksByAuthor).toHaveBeenCalledWith('Robin Miles', { page: 2, limit: 5 });
    expect(service.listAudiobooksBySeries).toHaveBeenCalledWith('Broken Earth', { page: 3, limit: 10 });
    expect(service.listAudiobooksByGenre).toHaveBeenCalledWith('Fantasy', { page: 4, limit: 15 });
    expect(JSON.stringify(dimensions)).not.toContain('warehouse');
    expect(JSON.stringify(dimensions)).not.toContain('remote-');
  });

  it('delegates audiobook detail lookups and returns safe detail', async () => {
    const { controller, service } = makeController();
    const expected: WarehouseAudiobookDetail = {
      id: 7,
      remoteId: 'remote-7',
      title: 'The Fifth Season',
      subtitle: null,
      authors: ['N. K. Jemisin'],
      narrators: ['Robin Miles'],
      series: 'Broken Earth',
      language: 'en',
      publisher: 'Orbit',
      identifiers: { isbn13: '9780316229296' },
      format: 'm4b',
      durationSeconds: 54000,
      hasCover: true,
      syncedAt: '2026-06-02T10:00:00.000Z',
      source: 'catalog-source',
      chapters: [],
      files: [],
    };
    service.getAudiobook.mockResolvedValue(expected);

    const result = await controller.getAudiobook('remote-7');

    expect(service.getAudiobook).toHaveBeenCalledWith('remote-7');
    expect(result).toBe(expected);
    expect(result).not.toHaveProperty('raw');
  });

  it('returns a safe 404 when audiobook detail lookups are missing or disabled', async () => {
    const { controller, service } = makeController();
    service.getAudiobook.mockResolvedValue(null);

    const result = controller.getAudiobook('missing-remote-id');

    await expect(result).rejects.toThrow(NotFoundException);
    await expect(result).rejects.toThrow('Library item is not available.');
    expect(service.getAudiobook).toHaveBeenCalledWith('missing-remote-id');
  });

  it('delegates audiobook binary routes and sends safe headers', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.getAudiobookCover.mockResolvedValue({
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 300,
      body: Buffer.from('img'),
      fileName: null,
    });
    service.streamAudiobook.mockResolvedValue({
      status: 200,
      contentType: 'audio/mpeg',
      contentLength: null,
      body: Readable.from(['mp3']),
      fileName: null,
    });
    service.downloadAudiobook.mockResolvedValue({
      status: 200,
      contentType: '',
      contentLength: 400,
      body: Buffer.from('book'),
      fileName: '../Bad "Name".m4b',
    });
    service.downloadAudiobookFile.mockResolvedValue({
      status: 200,
      contentType: 'audio/mp4',
      contentLength: 400,
      body: Buffer.from('file'),
      fileName: 'file\\\\name.m4b',
    });

    await controller.getAudiobookCover(user, 'remote-1', reply as never);
    await controller.streamAudiobook(user, 'remote-2', reply as never);
    await controller.downloadAudiobook(user, 'remote-3', reply as never);
    await controller.downloadAudiobookFile(user, 'remote-4', 'file-1', reply as never);

    expect(service.getAudiobookCover).toHaveBeenCalledWith(user, 'remote-1');
    expect(service.streamAudiobook).toHaveBeenCalledWith(user, 'remote-2');
    expect(service.downloadAudiobook).toHaveBeenCalledWith(user, 'remote-3');
    expect(service.downloadAudiobookFile).toHaveBeenCalledWith(user, 'remote-4', 'file-1');
    expect(reply.type).toHaveBeenCalledWith('application/octet-stream');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '300');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '400');
    expect(reply.header).not.toHaveBeenCalledWith('Content-Length', '3');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="audiobook-download.bin"; filename*=UTF-8\'\'audiobook-download.bin',
    );
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="audiobook-file.bin"; filename*=UTF-8\'\'audiobook-file.bin',
    );
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('img'));
    expect(reply.send).toHaveBeenCalledWith(expect.any(Readable));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('book'));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('file'));
  });

  it('serves native library item media through the same safe binary response path', async () => {
    const { libraryMediaController, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.getEbookCover.mockResolvedValue({
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    });
    service.downloadEbook.mockResolvedValue({
      status: 200,
      contentType: 'application/epub+zip',
      contentLength: 4,
      body: Buffer.from('epub'),
      fileName: 'Ebook.epub',
    });
    service.getAudiobookCover.mockResolvedValue({
      status: 200,
      contentType: 'image/png',
      contentLength: 4,
      body: Buffer.from('apic'),
      fileName: null,
    });
    service.streamAudiobook.mockResolvedValue({
      status: 200,
      contentType: 'audio/mpeg',
      contentLength: 6,
      body: Buffer.from('stream'),
      fileName: null,
    });
    service.downloadAudiobook.mockResolvedValue({
      status: 200,
      contentType: 'audio/mpeg',
      contentLength: 5,
      body: Buffer.from('audio'),
      fileName: 'Audio.mp3',
    });
    service.downloadAudiobookFile.mockResolvedValue({
      status: 200,
      contentType: 'audio/mpeg',
      contentLength: 6,
      body: Buffer.from('part'),
      fileName: 'Part.mp3',
    });

    await libraryMediaController.getEbookCover(user, 'ebook-1', 'medium', reply as never);
    await libraryMediaController.downloadEbook(user, 'ebook-1', reply as never);
    await libraryMediaController.getAudiobookCover(user, 'audio-1', reply as never);
    await libraryMediaController.streamAudiobook(user, 'audio-1', reply as never);
    await libraryMediaController.downloadAudiobook(user, 'audio-1', reply as never);
    await libraryMediaController.downloadAudiobookFile(user, 'audio-2', 'file-1', reply as never);

    expect(service.getEbookCover).toHaveBeenCalledWith(user, 'ebook-1', 'medium');
    expect(service.downloadEbook).toHaveBeenCalledWith(user, 'ebook-1');
    expect(service.getAudiobookCover).toHaveBeenCalledWith(user, 'audio-1');
    expect(service.streamAudiobook).toHaveBeenCalledWith(user, 'audio-1');
    expect(service.downloadAudiobook).toHaveBeenCalledWith(user, 'audio-1');
    expect(service.downloadAudiobookFile).toHaveBeenCalledWith(user, 'audio-2', 'file-1');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.type).toHaveBeenCalledWith('audio/mpeg');
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('img'));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('epub'));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('apic'));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('stream'));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('audio'));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('part'));
  });

  it('forwards range requests to stream routes and emits safe range response headers', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.streamAudiobook.mockResolvedValue({
      status: 206,
      contentType: 'audio/mpeg',
      contentLength: 13,
      contentRange: 'bytes 100-112/1000',
      acceptRanges: 'bytes',
      body: Buffer.from('partial-audio'),
      fileName: null,
    });

    await controller.streamAudiobook(user, 'remote-2', reply as never, 'bytes=100-112');

    expect(service.streamAudiobook).toHaveBeenCalledWith(user, 'remote-2', 'bytes=100-112');
    expect(reply.status).toHaveBeenCalledWith(206);
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '13');
    expect(reply.header).toHaveBeenCalledWith('Content-Range', 'bytes 100-112/1000');
    expect(reply.header).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(reply.header).not.toHaveBeenCalledWith('Location', expect.any(String));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('partial-audio'));
  });

  it('strips upstream content-type parameters before sending proxied media', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.streamAudiobook.mockResolvedValue({
      status: 200,
      contentType: 'audio/mpeg; source=https://catalog-source.example.test/private; api_key=top-secret-key',
      contentLength: 5,
      body: Buffer.from('audio'),
      fileName: null,
    });

    await controller.streamAudiobook(user, 'remote-2', reply as never);

    expect(reply.type).toHaveBeenCalledWith('audio/mpeg');
    expect(reply.type).not.toHaveBeenCalledWith(expect.stringContaining('catalog-source.example.test'));
    expect(reply.type).not.toHaveBeenCalledWith(expect.stringContaining('top-secret-key'));
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('audio'));
  });

  it('rejects partial-content responses without valid content-range metadata', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.streamAudiobook.mockResolvedValue({
      status: 206,
      contentType: 'audio/mpeg',
      contentLength: 13,
      contentRange: null,
      acceptRanges: 'bytes',
      body: Buffer.from('partial-audio'),
      fileName: null,
    });

    await expect(controller.streamAudiobook(user, 'remote-2', reply as never, 'bytes=100-112')).rejects.toThrow(BadGatewayException);
    await expect(controller.streamAudiobook(user, 'remote-2', reply as never, 'bytes=100-112')).rejects.toThrow(
      'Library media is temporarily unavailable.',
    );
    expect(reply.status).not.toHaveBeenCalledWith(206);
  });

  it('emits safe unsatisfied range responses without upstream body or headers', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.streamAudiobook.mockResolvedValue({
      status: 416,
      contentType: 'audio/mpeg',
      contentLength: 0,
      contentRange: 'bytes */1000',
      acceptRanges: 'bytes',
      body: Buffer.alloc(0),
      fileName: null,
    });

    await controller.streamAudiobook(user, 'remote-2', reply as never, 'bytes=1000-1200');

    expect(reply.status).toHaveBeenCalledWith(416);
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '0');
    expect(reply.header).toHaveBeenCalledWith('Content-Range', 'bytes */1000');
    expect(reply.header).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(reply.header).not.toHaveBeenCalledWith('Location', expect.any(String));
    expect(reply.send).toHaveBeenCalledWith(Buffer.alloc(0));
  });

  it('delegates ebook download and sends safe attachment headers', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.downloadEbook.mockResolvedValue({
      status: 200,
      contentType: 'application/epub+zip',
      contentLength: 400,
      body: Buffer.from('book'),
      fileName: '../Unsafe Book.epub',
    });

    await controller.downloadEbook(user, 'remote-3', reply as never);

    expect(service.downloadEbook).toHaveBeenCalledWith(user, 'remote-3');
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '400');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="ebook-download.bin"; filename*=UTF-8\'\'ebook-download.bin',
    );
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('book'));
  });

  it('rejects unexpected proxied content types with safe native errors', async () => {
    const { controller, service } = makeController();
    const user = makeUser({ id: 7 });
    service.getAudiobookCover.mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      contentLength: 25,
      body: Buffer.from('{"error":"upstream leak"}'),
      fileName: null,
    });
    service.getEbookCover.mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      contentLength: 25,
      body: Buffer.from('{"error":"source leak"}'),
      fileName: null,
    });
    service.streamAudiobook.mockResolvedValue({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      contentLength: 17,
      body: Buffer.from('<h1>Bad</h1>'),
      fileName: null,
    });
    service.downloadEbook.mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      contentLength: 25,
      body: Buffer.from('{"error":"source leak"}'),
      fileName: null,
    });

    await expect(controller.getAudiobookCover(user, 'remote-1', makeReply() as never)).rejects.toThrow(BadGatewayException);
    await expect(controller.getAudiobookCover(user, 'remote-1', makeReply() as never)).rejects.toThrow('Library media is temporarily unavailable.');
    await expect(controller.getEbookCover(makeUser(), 'remote-1', 'medium', makeReply() as never)).rejects.toThrow(BadGatewayException);
    await expect(controller.getEbookCover(makeUser(), 'remote-1', 'medium', makeReply() as never)).rejects.toThrow(
      'Library media is temporarily unavailable.',
    );
    await expect(controller.streamAudiobook(user, 'remote-2', makeReply() as never)).rejects.toThrow(BadGatewayException);
    await expect(controller.streamAudiobook(user, 'remote-2', makeReply() as never)).rejects.toThrow('Library media is temporarily unavailable.');
    await expect(controller.downloadEbook(makeUser(), 'remote-3', makeReply() as never)).rejects.toThrow(BadGatewayException);
    await expect(controller.downloadEbook(makeUser(), 'remote-3', makeReply() as never)).rejects.toThrow('Library media is temporarily unavailable.');
  });

  it('does not reflect upstream filenames into download headers', async () => {
    const { controller, service } = makeController();
    const reply = makeReply();
    const user = makeUser({ id: 7 });
    service.downloadAudiobook.mockResolvedValue({
      status: 200,
      contentType: 'audio/mp4',
      contentLength: 999,
      body: Buffer.from('song'),
      fileName: 'https://catalog-source.example.test/Café "Orbit" top-secret-key.m4b',
    });

    await controller.downloadAudiobook(user, 'remote-3', reply as never);

    expect(reply.header).toHaveBeenCalledWith('Content-Length', '999');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="audiobook-download.bin"; filename*=UTF-8\'\'audiobook-download.bin',
    );
    const disposition = reply.header.mock.calls.find(([name]) => name === 'Content-Disposition')?.[1] as string;
    expect(disposition).not.toContain('catalog-source.example.test');
    expect(disposition).not.toContain('top-secret-key');
    expect(disposition).not.toContain('Caf');
  });

  it('keeps audiobook binary error copy native and safe', async () => {
    const { controller, service } = makeController();
    const user = makeUser({ id: 7 });
    service.getAudiobookCover.mockRejectedValue(new NotFoundException('Library item is not available.'));

    await expect(controller.getAudiobookCover(user, 'missing-remote-id', makeReply() as never)).rejects.toThrow('Library item is not available.');
    await expect(controller.getAudiobookCover(user, 'missing-remote-id', makeReply() as never)).rejects.not.toThrow('source');
    await expect(controller.getAudiobookCover(user, 'missing-remote-id', makeReply() as never)).rejects.not.toThrow('api key');
  });
});

function makeReply() {
  return {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}
