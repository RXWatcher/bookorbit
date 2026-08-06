vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import { createHash } from 'crypto';
import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import type { MockedFunction } from 'vitest';
import { CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

import { OpdsController } from './opds.controller';

const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockStat = stat as MockedFunction<typeof stat>;

function makeController() {
  const opdsService = {
    generateRootNavigation: vi.fn().mockReturnValue('<root />'),
    generateLibrariesNavigation: vi.fn().mockReturnValue('<libraries />'),
    generateCollectionsNavigation: vi.fn().mockReturnValue('<collections />'),
    generateSmartScopesNavigation: vi.fn().mockReturnValue('<smartScopes />'),
    generateAuthorsNavigation: vi.fn().mockReturnValue('<authors />'),
    generateSeriesNavigation: vi.fn().mockReturnValue('<series />'),
    generateAcquisitionFeed: vi.fn().mockReturnValue('<feed />'),
    generateOpenSearchDescription: vi.fn().mockReturnValue('<search />'),
  } as never;
  const opdsBookService = {
    getAccessibleLibraries: vi.fn().mockResolvedValue([{ id: 1, name: 'Main', bookCount: 10 }]),
    getUserCollections: vi.fn().mockResolvedValue([{ id: 4, name: 'Favorites', bookCount: 2 }]),
    getUserSmartScopes: vi.fn().mockResolvedValue([{ id: 7, name: 'Unread', icon: 'sparkles' }]),
    getDistinctAuthors: vi.fn().mockResolvedValue([{ name: 'Frank Herbert', bookCount: 3 }]),
    getDistinctSeries: vi.fn().mockResolvedValue([
      { name: null, bookCount: 1 },
      { name: 'Dune', bookCount: 2 },
    ]),
    getBooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 1 }], total: 1 }),
    getLibraryBooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 'remote-1' }], total: 1 }),
    getRecentBooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 2 }], total: 1 }),
    getBooksAndCatalogEbooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 1 }, { id: 'remote-1' }], total: 2 }),
    getRecentBooksAndCatalogEbooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 2 }, { id: 'remote-2' }], total: 2 }),
    getRandomBooks: vi.fn().mockResolvedValue([{ id: 3 }]),
    getCatalogEbookPage: vi.fn().mockResolvedValue({ entries: [{ id: 'remote-1' }], total: 1 }),
    validateBookAccess: vi.fn().mockResolvedValue(undefined),
    getBookFiles: vi.fn().mockResolvedValue({
      absolutePath: '/books/library/book.epub',
      format: 'epub',
      title: 'Book Title',
      authorName: 'Author Name',
    }),
  } as never;
  const warehouseCatalogService = {
    isCatalogEnabled: vi.fn().mockResolvedValue(true),
    downloadEbook: vi.fn().mockResolvedValue({
      body: Buffer.from('epub bytes'),
      contentType: 'application/epub+zip',
      contentLength: 10,
      fileName: 'private-warehouse.example-secret.epub',
    }),
    getEbookCover: vi.fn().mockResolvedValue({
      body: Readable.from(Buffer.from('cover bytes')),
      contentType: 'image/jpeg',
      contentLength: 11,
    }),
  } as never;
  const config = {
    get: vi.fn().mockReturnValue('/books'),
  } as never;
  const koreaderService = {
    recordCatalogDocumentHash: vi.fn().mockResolvedValue(undefined),
  } as never;
  const bookService = {
    resolveDownloadFilename: vi.fn().mockResolvedValue('BadTitle - Author.epub'),
  } as never;

  return {
    controller: new OpdsController(opdsService, opdsBookService, config, warehouseCatalogService, koreaderService, bookService),
    opdsService,
    opdsBookService,
    warehouseCatalogService,
    koreaderService,
    bookService,
  };
}

function makeReply() {
  const reply = {
    header: vi.fn(),
    type: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };

  reply.header.mockReturnValue(reply);
  reply.type.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);

  return reply as never;
}

describe('OpdsController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders root navigation feed', () => {
    const { controller, opdsService } = makeController();
    const reply = makeReply();

    controller.root({} as never, reply);

    expect(opdsService.generateRootNavigation).toHaveBeenCalledOnce();
    expect(reply.type).toHaveBeenCalledWith('application/atom+xml;profile=opds-catalog;kind=navigation; charset=utf-8');
    expect(reply.send).toHaveBeenCalledWith('<root />');
  });

  it('renders navigation endpoints with OPDS navigation mime type', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 8, isSuperuser: false } as never;

    await controller.libraries(user, makeReply());
    await controller.collections(user, makeReply());
    await controller.smartScopes(user, makeReply());
    await controller.authors(user, makeReply());
    await controller.series(user, makeReply());

    expect(opdsBookService.getAccessibleLibraries).toHaveBeenCalledWith(8, false);
    expect(opdsBookService.getUserCollections).toHaveBeenCalledWith(8);
    expect(opdsBookService.getUserSmartScopes).toHaveBeenCalledWith(8);
    expect(opdsBookService.getDistinctAuthors).toHaveBeenCalledWith(8, false, undefined);
    expect(opdsBookService.getDistinctSeries).toHaveBeenCalledWith(8, false, undefined);
    expect(opdsService.generateSeriesNavigation).toHaveBeenCalledWith([{ name: 'Dune', bookCount: 2 }]);
  });

  it('catalog clamps pagination and passes parsed filters to the book service', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const reply = makeReply();
    const user = { userId: 7, isSuperuser: true, sortOrder: 'author_desc', coverToken: 'token' } as never;

    await controller.catalog(user, -4, 500, '2', '11', '15', 'Frank Herbert', 'Dune', 'arrakis', reply);

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(
      7,
      'author_desc',
      1,
      100,
      {
        libraryId: 2,
        collectionId: 11,
        smartScopeId: 15,
        author: 'Frank Herbert',
        series: 'Dune',
        q: 'arrakis',
      },
      true,
      undefined,
    );
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Search: arrakis',
      'urn:bookorbit:catalog:author:Frank%20Herbert:collectionId:11:libraryId:2:q:arrakis:series:Dune:smartScopeId:15',
      [{ id: 1 }],
      1,
      1,
      100,
      expect.stringContaining('/api/v1/opds/catalog?'),
      'token',
    );
  });

  it('catalog generates unique feed ids per filter context', async () => {
    const user = { userId: 5, isSuperuser: false, sortOrder: 'recent', coverToken: 'tok' } as never;

    const noFilters = makeController();
    await noFilters.controller.catalog(user, 1, 50, undefined, undefined, undefined, undefined, undefined, undefined, makeReply());
    expect(noFilters.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    const libraryOnly = makeController();
    await libraryOnly.controller.catalog(user, 1, 50, '1', undefined, undefined, undefined, undefined, undefined, makeReply());
    expect(libraryOnly.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:libraryId:1',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    const searchOnly = makeController();
    await searchOnly.controller.catalog(user, 1, 50, undefined, undefined, undefined, undefined, undefined, 'dune', makeReply());
    expect(searchOnly.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:q:dune',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    const multiFilter = makeController();
    await multiFilter.controller.catalog(user, 1, 50, '2', undefined, undefined, 'Frank Herbert', undefined, undefined, makeReply());
    expect(multiFilter.opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      expect.anything(),
      'urn:bookorbit:catalog:author:Frank%20Herbert:libraryId:2',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('catalog merges user-owned catalog ebooks when filters are not local-only', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 5, isSuperuser: false, sortOrder: 'title_asc', coverToken: 'tok' } as never;

    await controller.catalog(user, 2, 25, undefined, undefined, undefined, 'Ada Writer', 'Wayfarers', 'long way', makeReply());

    expect(opdsBookService.getBooksAndCatalogEbooksPage).toHaveBeenCalledWith(
      5,
      'title_asc',
      2,
      25,
      {
        author: 'Ada Writer',
        series: 'Wayfarers',
        q: 'long way',
      },
      false,
      undefined,
    );
    expect(opdsBookService.getBooksPage).not.toHaveBeenCalled();
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Search: long way',
      'urn:bookorbit:catalog:author:Ada%20Writer:q:long%20way:series:Wayfarers',
      [{ id: 1 }, { id: 'remote-1' }],
      2,
      2,
      25,
      expect.stringContaining('/api/v1/opds/catalog?'),
      'tok',
    );
  });

  it('catalog merges source-backed collection items into collection feeds', async () => {
    const { controller, opdsBookService } = makeController();
    const user = { userId: 5, isSuperuser: false, sortOrder: 'title_asc', coverToken: 'tok' } as never;

    await controller.catalog(user, 1, 25, undefined, '11', undefined, undefined, undefined, 'favorites', makeReply());

    expect(opdsBookService.getBooksAndCatalogEbooksPage).toHaveBeenCalledWith(
      5,
      'title_asc',
      1,
      25,
      {
        collectionId: 11,
        q: 'favorites',
      },
      false,
      undefined,
    );
    expect(opdsBookService.getBooksPage).not.toHaveBeenCalled();
  });

  it('catalog keeps local-only filters on the local book query', async () => {
    const { controller, opdsBookService } = makeController();
    const user = { userId: 5, isSuperuser: false, sortOrder: 'recent', coverToken: 'tok' } as never;

    await controller.catalog(user, 1, 50, '1', undefined, undefined, undefined, undefined, 'dune', makeReply());

    expect(opdsBookService.getBooksPage).toHaveBeenCalledOnce();
    expect(opdsBookService.getBooksAndCatalogEbooksPage).not.toHaveBeenCalled();
  });

  it('catalog treats Ebook Library id as a normal library-scoped acquisition feed', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 5, isSuperuser: false, sortOrder: 'title_asc', coverToken: 'tok' } as never;

    await controller.catalog(user, 1, 50, String(CLOUD_EBOOK_LIBRARY_ID), undefined, undefined, undefined, undefined, undefined, makeReply());

    expect(opdsBookService.getLibraryBooksPage).toHaveBeenCalledWith(5, 'title_asc', CLOUD_EBOOK_LIBRARY_ID, 1, 50, undefined, false, undefined);
    expect(opdsBookService.getBooksPage).not.toHaveBeenCalled();
    expect(opdsBookService.getBooksAndCatalogEbooksPage).not.toHaveBeenCalled();
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Catalog',
      'urn:bookorbit:catalog:libraryId:ebooks',
      [{ id: 'remote-1' }],
      1,
      1,
      50,
      '/api/v1/opds/catalog?libraryId=ebooks&page=1&size=50',
      'tok',
    );
  });

  it('catalog accepts the friendly Ebook Library query alias as a normal library-scoped feed', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 5, isSuperuser: false, sortOrder: 'title_asc', coverToken: 'tok' } as never;

    await controller.catalog(user, 1, 50, 'ebooks', undefined, undefined, undefined, undefined, undefined, makeReply());

    expect(opdsBookService.getLibraryBooksPage).toHaveBeenCalledWith(5, 'title_asc', CLOUD_EBOOK_LIBRARY_ID, 1, 50, undefined, false, undefined);
    expect(opdsBookService.getBooksPage).not.toHaveBeenCalled();
    expect(opdsBookService.getBooksAndCatalogEbooksPage).not.toHaveBeenCalled();
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Catalog',
      'urn:bookorbit:catalog:libraryId:ebooks',
      [{ id: 'remote-1' }],
      1,
      1,
      50,
      '/api/v1/opds/catalog?libraryId=ebooks&page=1&size=50',
      'tok',
    );
  });

  it('catalog forwards normal filters into Ebook Library scoped feeds', async () => {
    const { controller, opdsBookService } = makeController();
    const user = { userId: 5, isSuperuser: false, sortOrder: 'title_asc', coverToken: 'tok' } as never;

    await controller.catalog(user, 1, 50, String(CLOUD_EBOOK_LIBRARY_ID), undefined, undefined, 'Ada Writer', 'Wayfarers', 'long way', makeReply());

    expect(opdsBookService.getLibraryBooksPage).toHaveBeenCalledWith(
      5,
      'title_asc',
      CLOUD_EBOOK_LIBRARY_ID,
      1,
      50,
      { author: 'Ada Writer', series: 'Wayfarers', q: 'long way' },
      false,
      undefined,
    );
  });

  it('rejects invalid catalog filter ids and deep pagination windows', async () => {
    const { controller } = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;
    const reply = makeReply();

    await expect(controller.catalog(user, 1, 50, 'abc', undefined, undefined, undefined, undefined, undefined, reply)).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.catalog(user, 1_000_000, 100, undefined, undefined, undefined, undefined, undefined, undefined, reply)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('renders recent and surprise acquisition feeds', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 12, isSuperuser: false, coverToken: 'cover-token' } as never;

    await controller.recent(user, 0, 1000, makeReply());
    await controller.surprise(user, makeReply());

    expect(opdsBookService.getRecentBooksAndCatalogEbooksPage).toHaveBeenCalledWith(12, 1, 100, false, undefined);
    expect(opdsBookService.getRandomBooks).toHaveBeenCalledWith(12, 25, false, undefined);
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Random Books',
      'urn:bookorbit:surprise',
      [{ id: 3 }],
      1,
      1,
      25,
      '/api/v1/opds/surprise',
      'cover-token',
    );
  });

  it('recent falls back to local books when catalog access is disabled', async () => {
    const { controller, opdsBookService, warehouseCatalogService } = makeController();
    const user = { userId: 12, isSuperuser: false, coverToken: 'cover-token' } as never;

    warehouseCatalogService.isCatalogEnabled.mockResolvedValue(false);
    await controller.recent(user, 1, 50, makeReply());

    expect(opdsBookService.getRecentBooksPage).toHaveBeenCalledWith(12, 1, 50, false, undefined);
    expect(opdsBookService.getRecentBooksAndCatalogEbooksPage).not.toHaveBeenCalled();
  });

  it('renders user-owned catalog ebook acquisition feed through OPDS', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const contentFilters = { includeTagIds: [7], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] };
    const user = { userId: 12, isSuperuser: false, coverToken: 'cover-token', contentFilters } as never;

    await controller.catalogEbooks(user, 0, 1000, 'wayfarer', makeReply());

    expect(opdsBookService.getCatalogEbookPage).toHaveBeenCalledWith(12, 1, 100, { q: 'wayfarer' }, 'recent', contentFilters);
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Books',
      'urn:bookorbit:catalog-ebooks:q:wayfarer',
      [{ id: 'remote-1' }],
      1,
      1,
      100,
      '/api/v1/opds/catalog-ebooks?q=wayfarer&page=1&size=100',
      'cover-token',
    );
  });

  it('renders an empty catalog ebook feed when catalog access is disabled', async () => {
    const { controller, opdsBookService, opdsService, warehouseCatalogService } = makeController();
    const user = { userId: 12, isSuperuser: true, coverToken: 'cover-token' } as never;

    warehouseCatalogService.isCatalogEnabled.mockResolvedValue(false);
    await controller.catalogEbooks(user, 1, 50, undefined, makeReply());

    expect(opdsBookService.getCatalogEbookPage).not.toHaveBeenCalled();
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Books',
      'urn:bookorbit:catalog-ebooks',
      [],
      0,
      1,
      50,
      '/api/v1/opds/catalog-ebooks?page=1&size=50',
      'cover-token',
    );
  });

  it('returns OpenSearch description with OPDS search mime type', () => {
    const { controller } = makeController();
    const reply = makeReply();

    controller.searchDescription({} as never, reply);

    expect(reply.type).toHaveBeenCalledWith('application/opensearchdescription+xml; charset=utf-8');
    expect(reply.send).toHaveBeenCalledWith('<search />');
  });

  it('serves the preferred stored cover file for OPDS clients', async () => {
    const { controller, opdsBookService } = makeController();
    const reply = makeReply();
    const stream = { kind: 'stream' };

    mockReaddir.mockResolvedValue(['cover_extracted.jpg', 'cover_custom.png'] as never);
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.cover(42, { userId: 7, isSuperuser: false } as never, reply);

    expect(opdsBookService.validateBookAccess).toHaveBeenCalledWith(42, 7, false, undefined);
    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/covers/42/cover_custom.png');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"1234"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('returns 304 when cover ETag matches If-None-Match', async () => {
    const { controller } = makeController();
    const reply = makeReply();

    mockReaddir.mockResolvedValue(['cover_custom.jpg'] as never);
    mockStat.mockResolvedValue({ mtimeMs: 5000 } as never);

    await controller.cover(42, { userId: 7, isSuperuser: false } as never, reply, '"5000"');

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no cover exists', async () => {
    const { controller } = makeController();
    mockReaddir.mockRejectedValue(new Error('missing dir'));

    await expect(controller.cover(42, { userId: 7, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
  });

  it('serves thumbnail image when available', async () => {
    const { controller } = makeController();
    const reply = makeReply();
    const stream = { kind: 'thumbnail-stream' };

    mockStat.mockResolvedValue({ mtimeMs: 2222 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, reply);

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"2222"');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('returns 304 for thumbnail when ETag matches', async () => {
    const { controller } = makeController();
    const reply = makeReply();

    mockStat.mockResolvedValue({ mtimeMs: 3333 } as never);

    await controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, reply, '"3333"');

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when thumbnail file is missing', async () => {
    const { controller } = makeController();
    mockStat.mockRejectedValue(new Error('missing thumbnail'));

    await expect(controller.thumbnail(42, { userId: 7, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
  });

  it('downloads file with sanitized attachment name', async () => {
    const { controller, opdsBookService } = makeController();
    const reply = makeReply();
    const stream = { kind: 'download-stream' };

    opdsBookService.getBookFiles.mockResolvedValue({
      absolutePath: '/books/library/book.epub',
      format: 'epub',
      title: 'Bad:/Title*',
      authorName: 'Au<th>or',
    });
    mockStat.mockResolvedValue({ size: 12345 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.download(99, 0, { userId: 2, isSuperuser: false } as never, reply);

    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="BadTitle - Author.epub"; filename*=UTF-8\'\'BadTitle%20-%20Author.epub',
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Length', 12345);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('proxies catalog ebook downloads and covers through OPDS authentication', async () => {
    const { controller, warehouseCatalogService, koreaderService } = makeController();
    const reply = makeReply();
    const user = { userId: 12 } as never;

    await controller.downloadCatalogEbook('book 1/with slash', user, reply);
    expect(warehouseCatalogService.downloadEbook).toHaveBeenCalledWith({ id: 12 }, 'book 1/with slash');
    expect(koreaderService.recordCatalogDocumentHash).toHaveBeenCalledWith(
      12,
      'book 1/with slash',
      createHash('md5').update(Buffer.from('epub bytes')).digest('hex'),
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="ebook-download.epub"');
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.header).not.toHaveBeenCalledWith('Content-Disposition', expect.stringMatching(/warehouse|secret|private/i));

    const coverReply = makeReply();
    await controller.catalogEbookCover('book 1/with slash', user, 'thumbnail', coverReply);
    expect(warehouseCatalogService.getEbookCover).toHaveBeenCalledWith({ id: 12 }, 'book 1/with slash', 'thumbnail');
    expect(coverReply.type).toHaveBeenCalledWith('image/jpeg');
  });

  it('uses native library media copy for unsafe catalog ebook metadata', async () => {
    const { controller, warehouseCatalogService } = makeController();
    warehouseCatalogService.downloadEbook.mockResolvedValueOnce({
      body: Buffer.from('partial'),
      contentType: 'application/epub+zip',
      contentLength: 7,
      status: 206,
      contentRange: null,
      acceptRanges: 'bytes',
      fileName: null,
    });

    const result = controller.downloadCatalogEbook('book 1/with slash', { userId: 12 } as never, makeReply(), 'bytes=0-6');

    await expect(result).rejects.toThrow(BadGatewayException);
    await expect(result).rejects.toThrow('Library media is temporarily unavailable.');
  });

  it('does not record KOReader document hashes for partial catalog ebook downloads', async () => {
    const { controller, warehouseCatalogService, koreaderService } = makeController();
    const reply = makeReply();
    const body = Buffer.from('partial');
    warehouseCatalogService.downloadEbook.mockResolvedValueOnce({
      body,
      contentType: 'application/epub+zip',
      contentLength: body.length,
      status: 206,
      contentRange: 'bytes 0-6/100',
      acceptRanges: 'bytes',
      fileName: 'private-title.epub',
    });

    await controller.downloadCatalogEbook('book 1/with slash', { userId: 12 } as never, reply, 'bytes=0-6');

    expect(warehouseCatalogService.downloadEbook).toHaveBeenCalledWith({ id: 12 }, 'book 1/with slash', 'bytes=0-6');
    expect(koreaderService.recordCatalogDocumentHash).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(206);
    expect(reply.header).toHaveBeenCalledWith('Content-Range', 'bytes 0-6/100');
  });

  it('records KOReader document hashes after streamed catalog ebook downloads complete', async () => {
    const { controller, warehouseCatalogService, koreaderService } = makeController();
    const reply = makeReply();
    const chunks = [Buffer.from('streamed '), Buffer.from('ebook bytes')];
    warehouseCatalogService.downloadEbook.mockResolvedValueOnce({
      body: Readable.from(chunks),
      contentType: 'application/epub+zip',
      contentLength: Buffer.concat(chunks).length,
      status: 200,
      fileName: 'private-title.epub',
    });

    await controller.downloadCatalogEbook('book 1/with slash', { userId: 12 } as never, reply);

    expect(koreaderService.recordCatalogDocumentHash).not.toHaveBeenCalled();

    const sentBody = (reply as unknown as { send: ReturnType<typeof vi.fn> }).send.mock.calls[0]?.[0] as Readable;
    const received: Buffer[] = [];
    for await (const chunk of sentBody) {
      received.push(Buffer.from(chunk));
    }

    const bytes = Buffer.concat(chunks);
    expect(Buffer.concat(received)).toEqual(bytes);
    expect(koreaderService.recordCatalogDocumentHash).toHaveBeenCalledWith(12, 'book 1/with slash', createHash('md5').update(bytes).digest('hex'));
  });

  it('throws NotFoundException when requested download file is unavailable', async () => {
    const { controller, opdsBookService } = makeController();
    opdsBookService.getBookFiles.mockResolvedValue(null);

    await expect(controller.download(88, 77, { userId: 2, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
  });
});
