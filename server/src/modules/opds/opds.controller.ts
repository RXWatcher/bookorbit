import {
  BadGatewayException,
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { Transform } from 'stream';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';

import { bookCoverDirPath, bookThumbnailPath, findPreferredBookCoverFileName } from '../../common/book-cover-storage';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { Public } from '../../common/decorators/public.decorator';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { OPDS_MIME_ACQ, OPDS_MIME_NAV, OPDS_MIME_SEARCH, fileMimeType } from './opds-xml.helpers';
import { OpdsAuthGuard } from './opds-auth.guard';
import type { OpdsRequestUser } from './opds-auth.guard';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsUser } from './opds-user.decorator';
import { OpdsBookService } from './opds-book.service';
import { OpdsService } from './opds.service';
import { BookService } from '../book/book.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import type { WarehouseBinaryResponse } from '../warehouse/warehouse-client.service';
import { LIBRARY_MEDIA_UNAVAILABLE_MESSAGE } from '../warehouse/warehouse-user-facing-messages';
import { KoreaderService } from '../koreader/koreader.service';
import type { RequestUser } from '../../common/types/request-user';
import { CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

const VALID_CATALOG_EBOOK_COVER_SIZES = new Set(['cover', 'thumbnail', 'medium', 'original']);
const EBOOK_DOWNLOAD_CONTENT_TYPES = new Set([
  'application/epub+zip',
  'application/pdf',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
  'application/x-cbz',
  'application/x-cbr',
  'application/vnd.comicbook+zip',
  'application/vnd.comicbook-rar',
]);

@Controller('opds')
@Public()
@UseGuards(OpdsEnabledGuard, OpdsAuthGuard)
export class OpdsController {
  private readonly appDataPath: string;

  constructor(
    private readonly opdsService: OpdsService,
    private readonly opdsBookService: OpdsBookService,
    private readonly config: ConfigService,
    private readonly warehouseCatalog: WarehouseCatalogService,
    private readonly koreaderService: KoreaderService,
    private readonly bookService: BookService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  private assertPaginationWindow(page: number, size: number): void {
    if (!isOffsetWithinLimit((page - 1) * size)) {
      throw new BadRequestException(`pagination window is too deep; (page - 1) * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  @Get()
  root(@OpdsUser() _user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const xml = this.opdsService.generateRootNavigation();
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('libraries')
  async libraries(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const libs = await this.opdsBookService.getAccessibleLibraries(user.userId, user.isSuperuser);
    const xml = this.opdsService.generateLibrariesNavigation(libs);
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('collections')
  async collections(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const cols = await this.opdsBookService.getUserCollections(user.userId);
    const xml = this.opdsService.generateCollectionsNavigation(cols);
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('smart-scopes')
  async smartScopes(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const items = await this.opdsBookService.getUserSmartScopes(user.userId);
    const xml = this.opdsService.generateSmartScopesNavigation(items);
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('authors')
  async authors(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const items = await this.opdsBookService.getDistinctAuthors(user.userId, user.isSuperuser, user.contentFilters);
    const xml = this.opdsService.generateAuthorsNavigation(items);
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('series')
  async series(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const items = await this.opdsBookService.getDistinctSeries(user.userId, user.isSuperuser, user.contentFilters);
    const xml = this.opdsService.generateSeriesNavigation(items.filter((s): s is { id: number; name: string; bookCount: number } => s.name !== null));
    this.sendXml(reply, xml, OPDS_MIME_NAV);
  }

  @Get('catalog')
  async catalog(
    @OpdsUser() user: OpdsRequestUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Query('libraryId') libraryIdStr?: string,
    @Query('collectionId') collectionIdStr?: string,
    @Query('smartScopeId') smartScopeIdStr?: string,
    @Query('author') author?: string,
    @Query('series') series?: string,
    @Query('q') q?: string,
    @Res() reply?: FastifyReply,
    @Query('seriesId') seriesIdStr?: string,
  ) {
    const clampedSize = Math.min(Math.max(size, 1), 100);
    const clampedPage = Math.max(page, 1);
    this.assertPaginationWindow(clampedPage, clampedSize);

    const filters: Record<string, string | number> = {};
    const libraryId = this.parseOptionalLibraryId(libraryIdStr);
    const collectionId = this.parseOptionalPositiveInt('collectionId', collectionIdStr);
    const smartScopeId = this.parseOptionalPositiveInt('smartScopeId', smartScopeIdStr);
    const seriesId = this.parseOptionalPositiveInt('seriesId', seriesIdStr);

    if (libraryId !== undefined) filters.libraryId = libraryId;
    if (collectionId !== undefined) filters.collectionId = collectionId;
    if (smartScopeId !== undefined) filters.smartScopeId = smartScopeId;
    if (seriesId !== undefined) filters.seriesId = seriesId;
    if (author) filters.author = author;
    if (series) filters.series = series;
    if (q) filters.q = q;

    const includeCatalogEbooks = shouldIncludeCatalogEbooks(filters) && (await this.warehouseCatalog.isCatalogEnabled());
    const { entries, total } = includeCatalogEbooks
      ? await this.opdsBookService.getBooksAndCatalogEbooksPage(
          user.userId,
          user.sortOrder,
          clampedPage,
          clampedSize,
          filters,
          user.isSuperuser,
          user.contentFilters,
        )
      : libraryId === CLOUD_EBOOK_LIBRARY_ID
        ? await this.opdsBookService.getLibraryBooksPage(
            user.userId,
            user.sortOrder,
            libraryId,
            clampedPage,
            clampedSize,
            catalogEbookFilters(filters),
            user.isSuperuser,
            user.contentFilters,
          )
        : await this.opdsBookService.getBooksPage(
            user.userId,
            user.sortOrder,
            clampedPage,
            clampedSize,
            filters,
            user.isSuperuser,
            user.contentFilters,
          );

    const selfParams = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) selfParams.set(k, opdsFilterValue(k, v));
    selfParams.set('page', String(clampedPage));
    selfParams.set('size', String(clampedSize));
    const selfPath = `/api/v1/opds/catalog?${selfParams.toString()}`;

    const filterSuffix = Object.entries(filters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${encodeURIComponent(opdsFilterValue(k, v))}`)
      .join(':');
    const feedId = filterSuffix ? `urn:bookorbit:catalog:${filterSuffix}` : 'urn:bookorbit:catalog';

    const feedTitle = q ? `Search: ${q}` : 'Catalog';
    const xml = this.opdsService.generateAcquisitionFeed(feedTitle, feedId, entries, total, clampedPage, clampedSize, selfPath, user.coverToken);
    this.sendXml(reply!, xml, OPDS_MIME_ACQ);
  }

  @Get('catalog-ebooks')
  async catalogEbooks(
    @OpdsUser() user: OpdsRequestUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Query('q') q: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const clampedSize = Math.min(Math.max(size, 1), 100);
    const clampedPage = Math.max(page, 1);
    this.assertPaginationWindow(clampedPage, clampedSize);

    const trimmedQ = q?.trim();
    const filters = trimmedQ ? { q: trimmedQ } : {};
    const isCatalogEnabled = await this.warehouseCatalog.isCatalogEnabled();
    const { entries, total } = isCatalogEnabled
      ? await this.opdsBookService.getCatalogEbookPage(
          user.userId,
          clampedPage,
          clampedSize,
          filters,
          'recent',
          user.isSuperuser ? undefined : user.contentFilters,
        )
      : { entries: [], total: 0 };

    const selfParams = new URLSearchParams();
    if (trimmedQ) selfParams.set('q', trimmedQ);
    selfParams.set('page', String(clampedPage));
    selfParams.set('size', String(clampedSize));

    const feedId = trimmedQ ? `urn:bookorbit:catalog-ebooks:q:${encodeURIComponent(trimmedQ)}` : 'urn:bookorbit:catalog-ebooks';
    const xml = this.opdsService.generateAcquisitionFeed(
      'Books',
      feedId,
      entries,
      total,
      clampedPage,
      clampedSize,
      `/api/v1/opds/catalog-ebooks?${selfParams.toString()}`,
      user.coverToken,
    );
    this.sendXml(reply, xml, OPDS_MIME_ACQ);
  }

  @Get('recent')
  async recent(
    @OpdsUser() user: OpdsRequestUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Res() reply?: FastifyReply,
  ) {
    const clampedSize = Math.min(Math.max(size, 1), 100);
    const clampedPage = Math.max(page, 1);
    this.assertPaginationWindow(clampedPage, clampedSize);

    const isCatalogEnabled = await this.warehouseCatalog.isCatalogEnabled();
    const { entries, total } = isCatalogEnabled
      ? await this.opdsBookService.getRecentBooksAndCatalogEbooksPage(user.userId, clampedPage, clampedSize, user.isSuperuser, user.contentFilters)
      : await this.opdsBookService.getRecentBooksPage(user.userId, clampedPage, clampedSize, user.isSuperuser, user.contentFilters);
    const selfPath = `/api/v1/opds/recent?page=${clampedPage}&size=${clampedSize}`;
    const xml = this.opdsService.generateAcquisitionFeed(
      'Recent Books',
      'urn:bookorbit:recent',
      entries,
      total,
      clampedPage,
      clampedSize,
      selfPath,
      user.coverToken,
    );
    this.sendXml(reply!, xml, OPDS_MIME_ACQ);
  }

  @Get('surprise')
  async surprise(@OpdsUser() user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const entries = await this.opdsBookService.getRandomBooks(user.userId, 25, user.isSuperuser, user.contentFilters);
    const xml = this.opdsService.generateAcquisitionFeed(
      'Random Books',
      'urn:bookorbit:surprise',
      entries,
      entries.length,
      1,
      25,
      '/api/v1/opds/surprise',
      user.coverToken,
    );
    this.sendXml(reply, xml, OPDS_MIME_ACQ);
  }

  @Get('search.opds')
  searchDescription(@OpdsUser() _user: OpdsRequestUser, @Res() reply: FastifyReply) {
    const xml = this.opdsService.generateOpenSearchDescription();
    reply.type(`${OPDS_MIME_SEARCH}; charset=utf-8`).send(xml);
  }

  @Get('catalog-ebooks/:remoteId/download')
  async downloadCatalogEbook(
    @Param('remoteId') remoteId: string,
    @OpdsUser() user: OpdsRequestUser,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined
        ? await this.warehouseCatalog.downloadEbook(opdsRequestUser(user), remoteId)
        : await this.warehouseCatalog.downloadEbook(opdsRequestUser(user), remoteId, range);
    return sendCatalogBinaryResponse(reply, binary, 'ebook', downloadFileNameForContentType(binary.contentType), {
      onCompleteHash:
        range === undefined && binary.status !== 206 && binary.status !== 416
          ? (documentHash) => this.koreaderService.recordCatalogDocumentHash(user.userId, remoteId, documentHash)
          : undefined,
    });
  }

  @Get('catalog-ebooks/:remoteId/:size')
  async catalogEbookCover(
    @Param('remoteId') remoteId: string,
    @OpdsUser() user: OpdsRequestUser,
    @Param('size') size: string,
    @Res() reply: FastifyReply,
  ) {
    if (!VALID_CATALOG_EBOOK_COVER_SIZES.has(size)) {
      throw new NotFoundException('Cover is not available.');
    }

    const coverSize = size === 'cover' ? 'medium' : size;
    reply.header('Cache-Control', 'private, max-age=86400');
    return sendCatalogBinaryResponse(reply, await this.warehouseCatalog.getEbookCover(opdsRequestUser(user), remoteId, coverSize), 'image');
  }

  @Get(':bookId/cover')
  async cover(
    @Param('bookId', ParseIntPipe) bookId: number,
    @OpdsUser() user: OpdsRequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    await this.opdsBookService.validateBookAccess(bookId, user.userId, user.isSuperuser, user.contentFilters);
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    try {
      const files = await readdir(dir);
      const cover = findPreferredBookCoverFileName(files);
      if (!cover) throw new NotFoundException('No cover');
      const coverPath = join(dir, cover);
      const { mtimeMs } = await stat(coverPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'no-cache');
      reply.header('ETag', etag);
      reply.type(imageContentTypeFromPath(coverPath));
      reply.send(createReadStream(coverPath));
    } catch {
      throw new NotFoundException('No cover');
    }
  }

  @Get(':bookId/thumbnail')
  async thumbnail(
    @Param('bookId', ParseIntPipe) bookId: number,
    @OpdsUser() user: OpdsRequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    await this.opdsBookService.validateBookAccess(bookId, user.userId, user.isSuperuser, user.contentFilters);
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    const thumbnailPath = bookThumbnailPath(this.appDataPath, bookId);
    try {
      const { mtimeMs } = await stat(thumbnailPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'no-cache');
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      reply.send(createReadStream(thumbnailPath));
    } catch {
      throw new NotFoundException('No thumbnail');
    }
  }

  @Get(':bookId/download')
  async download(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Query('fileId', new DefaultValuePipe(0), ParseIntPipe) fileId: number,
    @OpdsUser() user: OpdsRequestUser,
    @Res() reply: FastifyReply,
  ) {
    await this.opdsBookService.validateBookAccess(bookId, user.userId, user.isSuperuser, user.contentFilters);

    const bookFiles = await this.opdsBookService.getBookFiles(bookId, fileId);
    if (!bookFiles) throw new NotFoundException('File not found');

    const { absolutePath, format } = bookFiles;
    const { size: fileSize } = await stat(absolutePath);
    const mime = fileMimeType(format);

    const filename = await this.bookService.resolveDownloadFilename({
      bookId,
      absolutePath,
      format: format === 'unknown' ? null : format,
    });

    reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, 'download'));
    reply.header('Content-Length', fileSize);
    reply.type(mime);
    reply.send(createReadStream(absolutePath));
  }

  private sendXml(reply: FastifyReply, xml: string, mimeType: string) {
    reply.type(`${mimeType}; charset=utf-8`).send(xml);
  }

  private parseOptionalPositiveInt(name: string, value?: string): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    return parsed;
  }

  private parseOptionalLibraryId(value?: string): number | undefined {
    if (value === undefined) return undefined;
    if (value.toLowerCase() === 'ebook' || value.toLowerCase() === 'ebooks') return CLOUD_EBOOK_LIBRARY_ID;
    if (value === String(CLOUD_EBOOK_LIBRARY_ID)) return CLOUD_EBOOK_LIBRARY_ID;
    return this.parseOptionalPositiveInt('libraryId', value);
  }
}

function opdsFilterValue(key: string, value: string | number): string {
  if (key === 'libraryId' && value === CLOUD_EBOOK_LIBRARY_ID) return 'ebooks';
  return String(value);
}

function opdsRequestUser(user: OpdsRequestUser): RequestUser {
  return { id: user.userId } as RequestUser;
}

function shouldIncludeCatalogEbooks(filters: Record<string, string | number>): boolean {
  return filters.libraryId === undefined && filters.smartScopeId === undefined;
}

function catalogEbookFilters(
  filters: Record<string, string | number>,
): { collectionId?: number; author?: string; series?: string; q?: string } | undefined {
  const result: { collectionId?: number; author?: string; series?: string; q?: string } = {};
  if (typeof filters.collectionId === 'number') result.collectionId = filters.collectionId;
  if (typeof filters.author === 'string') result.author = filters.author;
  if (typeof filters.series === 'string') result.series = filters.series;
  if (typeof filters.q === 'string') result.q = filters.q;
  return Object.keys(result).length > 0 ? result : undefined;
}

function sendCatalogBinaryResponse(
  reply: FastifyReply,
  binary: WarehouseBinaryResponse,
  expectedContent: 'ebook' | 'image',
  attachmentName?: string,
  options?: { onCompleteHash?: (documentHash: string) => void | Promise<void> },
) {
  const contentType = safeCatalogContentType(binary.contentType, expectedContent);
  const contentLength = binary.contentLength ?? (Buffer.isBuffer(binary.body) ? binary.body.length : null);

  if (binary.status === 206) {
    if (!isPartialContentRange(binary.contentRange)) throw new BadGatewayException(LIBRARY_MEDIA_UNAVAILABLE_MESSAGE);
    reply.status(206);
  }

  if (binary.status === 416) {
    if (!isUnsatisfiedContentRange(binary.contentRange)) throw new BadGatewayException(LIBRARY_MEDIA_UNAVAILABLE_MESSAGE);
    reply.status(416);
  }

  if (contentLength !== null) {
    reply.header('Content-Length', String(contentLength));
  }

  if ((binary.status === 206 || binary.status === 416) && binary.contentRange) {
    reply.header('Content-Range', binary.contentRange);
  }

  if (binary.acceptRanges) {
    reply.header('Accept-Ranges', binary.acceptRanges);
  }

  if (attachmentName) {
    reply.header('Content-Disposition', `attachment; filename="${safeAttachmentName(attachmentName)}"`);
  }

  reply.type(contentType);
  return reply.send(options?.onCompleteHash ? hashCatalogBody(binary.body, options.onCompleteHash) : binary.body);
}

function hashCatalogBody(body: WarehouseBinaryResponse['body'], onCompleteHash: (documentHash: string) => void | Promise<void>) {
  if (Buffer.isBuffer(body)) {
    const documentHash = createHash('md5').update(body).digest('hex');
    void Promise.resolve(onCompleteHash(documentHash)).catch(() => undefined);
    return body;
  }

  const hash = createHash('md5');
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      const documentHash = hash.digest('hex');
      void Promise.resolve(onCompleteHash(documentHash)).catch(() => undefined);
      callback();
    },
  });

  return body.pipe(hasher);
}

function safeCatalogContentType(contentType: string, expectedContent: 'ebook' | 'image'): string {
  const mediaType = (contentType.trim() || 'application/octet-stream').split(';', 1)[0]?.trim().toLowerCase() ?? 'application/octet-stream';

  if (expectedContent === 'image' && mediaType.startsWith('image/')) {
    return mediaType;
  }

  if (expectedContent === 'ebook' && EBOOK_DOWNLOAD_CONTENT_TYPES.has(mediaType)) {
    return mediaType;
  }

  throw new BadGatewayException(LIBRARY_MEDIA_UNAVAILABLE_MESSAGE);
}

function isPartialContentRange(value: string | null | undefined): value is string {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? '');
  if (!match) return false;

  const start = BigInt(match[1] as string);
  const end = BigInt(match[2] as string);
  if (start > end) return false;

  const total = match[3] as string;
  return total === '*' || end < BigInt(total);
}

function isUnsatisfiedContentRange(value: string | null | undefined): value is string {
  return /^bytes \*\/\d+$/i.test(value ?? '');
}

function downloadFileNameForContentType(contentType: string): string {
  const mediaType = (contentType.trim() || 'application/octet-stream').split(';', 1)[0]?.trim().toLowerCase() ?? 'application/octet-stream';
  switch (mediaType) {
    case 'application/epub+zip':
      return 'ebook-download.epub';
    case 'application/pdf':
      return 'ebook-download.pdf';
    case 'application/x-mobipocket-ebook':
      return 'ebook-download.mobi';
    case 'application/vnd.amazon.ebook':
      return 'ebook-download.azw3';
    case 'application/x-cbz':
    case 'application/vnd.comicbook+zip':
      return 'ebook-download.cbz';
    case 'application/x-cbr':
    case 'application/vnd.comicbook-rar':
      return 'ebook-download.cbr';
    default:
      return 'ebook-download.bin';
  }
}

function safeAttachmentName(value: string): string {
  const safe = Array.from(value, safeAttachmentNameChar).join('').trim();
  return safe || 'download.bin';
}

function safeAttachmentNameChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code < 32 || code === 127 || char === '"' || char === '\\' || '/:*?<>|'.includes(char)) {
    return '';
  }

  return char;
}
