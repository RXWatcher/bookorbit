import { Buffer } from 'node:buffer';

import { BadGatewayException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type {
  WarehouseAudiobookCatalogQuery,
  WarehouseAudiobookCatalogSort,
  WarehouseCatalogOrder,
  WarehouseCatalogSort,
  WarehouseComicCatalogItem,
  WarehouseComicCatalogPage,
  WarehouseComicCatalogQuery,
  WarehouseComicSeriesQuery,
  WarehouseEbookCatalogQuery,
  WarehouseRequestListQuery,
  WarehouseRequestStatus,
} from '@bookorbit/types';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ListWarehouseRequestsDto, SubmitWarehouseComicRequestDto } from './dto/warehouse-request.dto';
import { WarehouseCatalogService } from './warehouse-catalog.service';
import type { WarehouseBinaryResponse } from './warehouse-client.service';
import { WarehouseRequestService } from './warehouse-request.service';
import { LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE, LIBRARY_MEDIA_UNAVAILABLE_MESSAGE } from './warehouse-user-facing-messages';

type CatalogQueryValue = string | number | boolean | undefined;
type RawEbookCatalogQuery = Partial<Record<keyof WarehouseEbookCatalogQuery, CatalogQueryValue>>;
type RawComicCatalogQuery = Partial<Record<keyof WarehouseComicCatalogQuery, CatalogQueryValue>>;
type RawComicSeriesQuery = Partial<Record<keyof WarehouseComicSeriesQuery, CatalogQueryValue>>;
type RawAudiobookCatalogQuery = Partial<Record<keyof WarehouseAudiobookCatalogQuery, CatalogQueryValue>>;
type RawComicRequestQuery = Partial<Record<keyof WarehouseRequestListQuery, CatalogQueryValue>>;
type BinaryContentKind = 'ebook-cover' | 'audiobook-cover' | 'comic-cover' | 'comic-page' | 'audio' | 'ebook' | 'comic';
type PublicComicCatalogItem = Omit<WarehouseComicCatalogItem, 'id' | 'source'> & { id: string };
type PublicComicCatalogPage = Omit<WarehouseComicCatalogPage, 'items'> & { items: PublicComicCatalogItem[] };

const VALID_SORTS: WarehouseCatalogSort[] = ['title', 'author', 'series', 'syncedAt', 'addedAt'];
const VALID_AUDIOBOOK_SORTS: WarehouseAudiobookCatalogSort[] = ['title', 'author', 'series', 'syncedAt', 'addedAt', 'narrator', 'duration'];
const VALID_ORDERS: WarehouseCatalogOrder[] = ['asc', 'desc'];
const VALID_REQUEST_STATUSES: WarehouseRequestStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'unknown'];
const VALID_EBOOK_COVER_SIZES = new Set(['thumbnail', 'medium', 'original']);
const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream';
const EBOOK_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;
const AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;
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
]);
const DOWNLOAD_CONTENT_TYPES = new Set(['application/octet-stream', 'application/zip', 'application/x-zip-compressed']);
const COMIC_DOWNLOAD_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.comicbook+zip',
  'application/x-cbz',
  'application/vnd.comicbook-rar',
  'application/x-cbr',
]);

@Controller('catalog')
export class WarehouseCatalogController {
  constructor(private readonly catalog: WarehouseCatalogService) {}

  @Get('ebooks')
  listEbooks(@Query() query: RawEbookCatalogQuery) {
    return this.catalog.listEbooks(normalizeEbookQuery(query));
  }

  @Get('ebooks/genres')
  listEbookGenres() {
    return this.catalog.listEbookGenres();
  }

  @Get('ebooks/genres/:id')
  listEbooksByGenre(@Param('id') id: string, @Query() query: RawEbookCatalogQuery) {
    return this.catalog.listEbooksByGenre(decodeDimensionId(id), normalizeEbookQuery(query));
  }

  @Get('ebooks/:remoteId')
  async getEbook(@Param('remoteId') remoteId: string) {
    const ebook = await this.catalog.getEbook(remoteId);
    if (!ebook) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }

    return ebook;
  }

  @Get('ebooks/:remoteId/cover/:size')
  async getEbookCover(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Param('size') size: string,
    @Res() reply: FastifyReply,
  ) {
    if (!VALID_EBOOK_COVER_SIZES.has(size)) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }

    reply.header('Cache-Control', 'private, max-age=86400');
    return sendBinaryResponse(reply, await this.catalog.getEbookCover(user, remoteId, size), 'ebook-cover');
  }

  @Get('ebooks/:remoteId/download')
  async downloadEbook(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary = range === undefined ? await this.catalog.downloadEbook(user, remoteId) : await this.catalog.downloadEbook(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'ebook', 'ebook-download.bin');
  }

  @Get('comics')
  listComics(@Query() query: RawComicCatalogQuery) {
    return this.catalog.listComics(normalizeEbookQuery(query));
  }

  @Get('comics/series')
  listComicSeries(@Query() query: RawComicSeriesQuery) {
    return this.catalog.listComicSeries(normalizeComicSeriesPageQuery(query));
  }

  @Get('comics/series/search')
  searchComicSeries(@Query() query: RawComicSeriesQuery) {
    return this.catalog.searchComicSeries(normalizeComicSeriesQuery(query));
  }

  @Get('comics/series/:seriesId/items')
  listComicSeriesItems(@Param('seriesId') seriesId: string, @Query() query: RawComicSeriesQuery) {
    return this.catalog.listComicSeriesItems(decodeDimensionId(seriesId), normalizeComicSeriesPageQuery(query));
  }

  @Get('comics/:remoteId')
  async getComic(@Param('remoteId') remoteId: string) {
    const comic = await this.catalog.getComic(remoteId);
    if (!comic) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }

    return comic;
  }

  @Get('comics/:remoteId/pages')
  listComicPages(@CurrentUser() user: RequestUser, @Param('remoteId') remoteId: string) {
    return this.catalog.listComicPages(user, remoteId);
  }

  @Get('comics/:remoteId/pages/:pageIndex')
  async getComicPageImage(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Param('pageIndex') pageIndex: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined
        ? await this.catalog.getComicPageImage(user, remoteId, comicPageIndex(pageIndex))
        : await this.catalog.getComicPageImage(user, remoteId, comicPageIndex(pageIndex), range);
    return sendBinaryResponse(reply, binary, 'comic-page');
  }

  @Get('comics/:remoteId/download')
  async downloadComic(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary = range === undefined ? await this.catalog.downloadComic(user, remoteId) : await this.catalog.downloadComic(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'comic', 'comic-download.cbz');
  }

  @Get('audiobooks')
  listAudiobooks(@Query() query: RawAudiobookCatalogQuery) {
    return this.catalog.listAudiobooks(normalizeAudiobookQuery(query));
  }

  @Get('audiobooks/authors')
  listAudiobookAuthors() {
    return this.catalog.listAudiobookAuthors();
  }

  @Get('audiobooks/authors/:id')
  listAudiobooksByAuthor(@Param('id') id: string, @Query() query: RawAudiobookCatalogQuery) {
    return this.catalog.listAudiobooksByAuthor(decodeDimensionId(id), normalizeAudiobookQuery(query));
  }

  @Get('audiobooks/series')
  listAudiobookSeries() {
    return this.catalog.listAudiobookSeries();
  }

  @Get('audiobooks/series/:id')
  listAudiobooksBySeries(@Param('id') id: string, @Query() query: RawAudiobookCatalogQuery) {
    return this.catalog.listAudiobooksBySeries(decodeDimensionId(id), normalizeAudiobookQuery(query));
  }

  @Get('audiobooks/genres')
  listAudiobookGenres() {
    return this.catalog.listAudiobookGenres();
  }

  @Get('audiobooks/genres/:id')
  listAudiobooksByGenre(@Param('id') id: string, @Query() query: RawAudiobookCatalogQuery) {
    return this.catalog.listAudiobooksByGenre(decodeDimensionId(id), normalizeAudiobookQuery(query));
  }

  @Get('audiobooks/narrators')
  listAudiobookNarrators() {
    return this.catalog.listAudiobookNarrators();
  }

  @Get('audiobooks/:remoteId')
  async getAudiobook(@Param('remoteId') remoteId: string) {
    const audiobook = await this.catalog.getAudiobook(remoteId);
    if (!audiobook) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }

    return audiobook;
  }

  @Get('audiobooks/:remoteId/cover')
  async getAudiobookCover(@CurrentUser() user: RequestUser, @Param('remoteId') remoteId: string, @Res() reply: FastifyReply) {
    return sendBinaryResponse(reply, await this.catalog.getAudiobookCover(user, remoteId), 'audiobook-cover');
  }

  @Get('audiobooks/:remoteId/stream')
  async streamAudiobook(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined ? await this.catalog.streamAudiobook(user, remoteId) : await this.catalog.streamAudiobook(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'audio');
  }

  @Get('audiobooks/:remoteId/download')
  async downloadAudiobook(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined ? await this.catalog.downloadAudiobook(user, remoteId) : await this.catalog.downloadAudiobook(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'audio', 'audiobook-download.bin');
  }

  @Get('audiobooks/:remoteId/files/:fileId/download')
  async downloadAudiobookFile(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Param('fileId') fileId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined
        ? await this.catalog.downloadAudiobookFile(user, remoteId, fileId)
        : await this.catalog.downloadAudiobookFile(user, remoteId, fileId, range);
    return sendBinaryResponse(reply, binary, 'audio', 'audiobook-file.bin');
  }
}

@Controller('libraries')
export class WarehouseLibraryMediaController {
  constructor(private readonly catalog: WarehouseCatalogService) {}

  @Get('comics/items')
  listComicItems(@Query() query: RawComicCatalogQuery) {
    return this.catalog.listComics(normalizeEbookQuery(query));
  }

  @Get('comics/items/:remoteId')
  async getComicItem(@Param('remoteId') remoteId: string) {
    const comic = await this.catalog.getComic(remoteId);
    if (!comic) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }

    return comic;
  }

  @Get('ebooks/items/:remoteId/cover/:size')
  async getEbookCover(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Param('size') size: string,
    @Res() reply: FastifyReply,
  ) {
    if (!VALID_EBOOK_COVER_SIZES.has(size)) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }

    reply.header('Cache-Control', 'private, max-age=86400');
    return sendBinaryResponse(reply, await this.catalog.getEbookCover(user, remoteId, size), 'ebook-cover');
  }

  @Get('ebooks/items/:remoteId/download')
  async downloadEbook(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary = range === undefined ? await this.catalog.downloadEbook(user, remoteId) : await this.catalog.downloadEbook(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'ebook', 'ebook-download.bin');
  }

  @Get('comics/items/:remoteId/pages')
  listComicPages(@CurrentUser() user: RequestUser, @Param('remoteId') remoteId: string) {
    return this.catalog.listComicPages(user, remoteId);
  }

  @Get('comics/items/:remoteId/cover')
  async getComicCover(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Query('size') size?: string,
  ) {
    const binary = await this.catalog.getComicCover(user, remoteId, size === 'original' ? 'original' : 'thumbnail');
    return sendBinaryResponse(reply, binary, 'comic-cover');
  }

  @Get('comics/items/:remoteId/pages/:pageIndex')
  async getComicPageImage(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Param('pageIndex') pageIndex: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined
        ? await this.catalog.getComicPageImage(user, remoteId, comicPageIndex(pageIndex))
        : await this.catalog.getComicPageImage(user, remoteId, comicPageIndex(pageIndex), range);
    return sendBinaryResponse(reply, binary, 'comic-page');
  }

  @Get('comics/items/:remoteId/download')
  async downloadComic(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary = range === undefined ? await this.catalog.downloadComic(user, remoteId) : await this.catalog.downloadComic(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'comic', 'comic-download.cbz');
  }

  @Get('audiobooks/items/:remoteId/cover')
  async getAudiobookCover(@CurrentUser() user: RequestUser, @Param('remoteId') remoteId: string, @Res() reply: FastifyReply) {
    return sendBinaryResponse(reply, await this.catalog.getAudiobookCover(user, remoteId), 'audiobook-cover');
  }

  @Get('audiobooks/items/:remoteId/stream')
  async streamAudiobook(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined ? await this.catalog.streamAudiobook(user, remoteId) : await this.catalog.streamAudiobook(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'audio');
  }

  @Get('audiobooks/items/:remoteId/download')
  async downloadAudiobook(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined ? await this.catalog.downloadAudiobook(user, remoteId) : await this.catalog.downloadAudiobook(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'audio', 'audiobook-download.bin');
  }

  @Get('audiobooks/items/:remoteId/files/:fileId/download')
  async downloadAudiobookFile(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Param('fileId') fileId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined
        ? await this.catalog.downloadAudiobookFile(user, remoteId, fileId)
        : await this.catalog.downloadAudiobookFile(user, remoteId, fileId, range);
    return sendBinaryResponse(reply, binary, 'audio', 'audiobook-file.bin');
  }
}

@Controller('comics')
export class WarehouseComicApiController {
  constructor(
    private readonly catalog: WarehouseCatalogService,
    private readonly requests: WarehouseRequestService,
  ) {}

  @Get('items')
  async listComicItems(@Query() query: RawComicCatalogQuery): Promise<PublicComicCatalogPage> {
    return publicComicCatalogPage(await this.catalog.listComics(normalizeEbookQuery(query)));
  }

  @Get('items/:remoteId')
  async getComicItem(@Param('remoteId') remoteId: string) {
    const comic = await this.catalog.getComic(remoteId);
    if (!comic) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }

    return publicComicCatalogItem(comic);
  }

  @Get('items/:remoteId/pages')
  listComicPages(@CurrentUser() user: RequestUser, @Param('remoteId') remoteId: string) {
    return this.catalog.listComicPages(user, remoteId);
  }

  @Get('items/:remoteId/pages/:pageIndex')
  async getComicPageImage(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Param('pageIndex') pageIndex: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary =
      range === undefined
        ? await this.catalog.getComicPageImage(user, remoteId, comicPageIndex(pageIndex))
        : await this.catalog.getComicPageImage(user, remoteId, comicPageIndex(pageIndex), range);
    return sendBinaryResponse(reply, binary, 'comic-page');
  }

  @Get('items/:remoteId/download')
  async downloadComic(
    @CurrentUser() user: RequestUser,
    @Param('remoteId') remoteId: string,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    const binary = range === undefined ? await this.catalog.downloadComic(user, remoteId) : await this.catalog.downloadComic(user, remoteId, range);
    return sendBinaryResponse(reply, binary, 'comic', 'comic-download.cbz');
  }

  @Get('series')
  listComicSeries(@Query() query: RawComicSeriesQuery) {
    return this.catalog.listComicSeries(normalizeComicSeriesPageQuery(query));
  }

  @Get('series/search')
  searchComicSeries(@Query() query: RawComicSeriesQuery) {
    return this.catalog.searchComicSeries(normalizeComicSeriesQuery(query));
  }

  @Get('series/:seriesId/items')
  listComicSeriesItems(@Param('seriesId') seriesId: string, @Query() query: RawComicSeriesQuery) {
    return this.catalog.listComicSeriesItems(decodeDimensionId(seriesId), normalizeComicSeriesPageQuery(query));
  }

  @Post('requests')
  submitComicRequest(@CurrentUser() user: RequestUser, @Body() dto: SubmitWarehouseComicRequestDto) {
    return this.requests.submitComicRequest(user, dto);
  }

  @Get('requests')
  listComicRequests(@CurrentUser() user: RequestUser, @Query() query: ListWarehouseRequestsDto) {
    return this.requests.listComicRequests(user, normalizeComicRequestQuery(query as RawComicRequestQuery));
  }
}

function normalizeEbookQuery(query: RawEbookCatalogQuery): WarehouseEbookCatalogQuery {
  return {
    q: stringValue(query.q),
    page: numberValue(query.page),
    limit: numberValue(query.limit),
    sort: enumValue(query.sort, VALID_SORTS),
    order: enumValue(query.order, VALID_ORDERS),
    author: stringValue(query.author),
    series: stringValue(query.series),
    language: stringValue(query.language),
    format: stringValue(query.format),
    genre: stringValue(query.genre),
    hasCover: booleanValue(query.hasCover),
  };
}

function normalizeAudiobookQuery(query: RawAudiobookCatalogQuery): WarehouseAudiobookCatalogQuery {
  return {
    q: stringValue(query.q),
    page: numberValue(query.page),
    limit: numberValue(query.limit),
    sort: enumValue(query.sort, VALID_AUDIOBOOK_SORTS),
    order: enumValue(query.order, VALID_ORDERS),
    author: stringValue(query.author),
    narrator: stringValue(query.narrator),
    series: stringValue(query.series),
    language: stringValue(query.language),
    format: stringValue(query.format),
    genre: stringValue(query.genre),
    hasCover: booleanValue(query.hasCover),
  };
}

function normalizeComicRequestQuery(query: RawComicRequestQuery): WarehouseRequestListQuery {
  return {
    status: enumValue(query.status, VALID_REQUEST_STATUSES),
    page: numberValue(query.page),
    limit: numberValue(query.limit),
  };
}

function publicComicCatalogPage(page: WarehouseComicCatalogPage): PublicComicCatalogPage {
  return {
    ...page,
    items: page.items.map((item) => publicComicCatalogItem(item)),
  };
}

function publicComicCatalogItem(item: WarehouseComicCatalogItem): PublicComicCatalogItem {
  const safeItem: Partial<WarehouseComicCatalogItem> = { ...item };
  delete safeItem.source;
  return {
    ...safeItem,
    id: item.remoteId,
  } as PublicComicCatalogItem;
}

function normalizeComicSeriesQuery(query: RawComicSeriesQuery): WarehouseComicSeriesQuery {
  return {
    q: stringValue(query.q),
    ...normalizeComicSeriesPageQuery(query),
  };
}

function normalizeComicSeriesPageQuery(query: RawComicSeriesQuery): Omit<WarehouseComicSeriesQuery, 'q'> {
  return {
    page: numberValue(query.page),
    limit: numberValue(query.limit),
  };
}

function comicPageIndex(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function stringValue(value: CatalogQueryValue): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberValue(value: CatalogQueryValue): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: CatalogQueryValue): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return undefined;
}

function enumValue<T extends string>(value: CatalogQueryValue, validValues: readonly T[]): T | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return validValues.includes(value as T) ? (value as T) : undefined;
}

function decodeDimensionId(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function sendBinaryResponse(reply: FastifyReply, binary: WarehouseBinaryResponse, expectedContent: BinaryContentKind, downloadFallbackName?: string) {
  const contentType = safeContentType(binary.contentType, expectedContent);
  const contentLength = binary.contentLength ?? (Buffer.isBuffer(binary.body) ? binary.body.length : null);

  if (binary.status === 206) {
    if (!isPartialContentRange(binary.contentRange)) {
      throw mediaUnavailableException(expectedContent);
    }

    reply.status(206);
  }

  if (binary.status === 416) {
    if (!isUnsatisfiedContentRange(binary.contentRange)) {
      throw mediaUnavailableException(expectedContent);
    }

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

  if (downloadFallbackName) {
    reply.header('Content-Disposition', safeContentDisposition(downloadFallbackName));
  }

  reply.type(contentType);
  return reply.send(binary.body);
}

function safeContentType(contentType: string, expectedContent: BinaryContentKind): string {
  const normalized = contentType.trim() || DEFAULT_BINARY_CONTENT_TYPE;
  const mediaType = normalized.split(';', 1)[0]?.trim().toLowerCase() ?? '';

  if (
    (expectedContent === 'ebook-cover' || expectedContent === 'audiobook-cover' || expectedContent === 'comic-cover') &&
    mediaType.startsWith('image/')
  ) {
    return mediaType;
  }

  if (expectedContent === 'comic-page' && mediaType.startsWith('image/')) {
    return mediaType;
  }

  if (expectedContent === 'ebook' && EBOOK_DOWNLOAD_CONTENT_TYPES.has(mediaType)) {
    return mediaType;
  }

  if (expectedContent === 'comic' && COMIC_DOWNLOAD_CONTENT_TYPES.has(mediaType)) {
    return mediaType;
  }

  if (expectedContent === 'audio' && (mediaType.startsWith('audio/') || DOWNLOAD_CONTENT_TYPES.has(mediaType))) {
    return mediaType;
  }

  throw mediaUnavailableException(expectedContent);
}

function mediaUnavailableException(expectedContent: BinaryContentKind): BadGatewayException {
  return new BadGatewayException(
    expectedContent === 'ebook' || expectedContent === 'ebook-cover'
      ? EBOOK_MEDIA_UNAVAILABLE_MESSAGE
      : expectedContent === 'comic' || expectedContent === 'comic-page'
        ? LIBRARY_MEDIA_UNAVAILABLE_MESSAGE
        : AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE,
  );
}

function isPartialContentRange(value: string | null | undefined): value is string {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? '');
  if (!match) {
    return false;
  }

  const start = BigInt(match[1] as string);
  const end = BigInt(match[2] as string);
  if (start > end) {
    return false;
  }

  const total = match[3] as string;
  return total === '*' || end < BigInt(total);
}

function isUnsatisfiedContentRange(value: string | null | undefined): value is string {
  return /^bytes \*\/\d+$/i.test(value ?? '');
}

function safeContentDisposition(fallback: string): string {
  const displayName = safeDisplayFileName(fallback);
  const asciiName = asciiAttachmentFileName(displayName, fallback);

  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987Value(displayName)}`;
}

function safeDisplayFileName(fileName: string): string {
  const safe = Array.from(fileName, safeDisplayFileNameChar)
    .join('')
    .replace(/_+/g, '_')
    .replace(/\.+/g, '.')
    .replace(/^[.\s_]+/, '')
    .trim();

  return safe || 'download.bin';
}

function safeDisplayFileNameChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code < 32 || code === 127) {
    return '_';
  }

  if (char === '"') {
    return '';
  }

  if (char === '\\' || char === '/' || ':*?<>|'.includes(char)) {
    return '_';
  }

  return char;
}

function asciiAttachmentFileName(fileName: string, fallback: string): string {
  const safe = Array.from(fileName.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''), asciiAttachmentFileNameChar)
    .join('')
    .replace(/_+/g, '_')
    .trim();

  return safe || fallback;
}

function asciiAttachmentFileNameChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code < 32 || code >= 127 || char === '"' || char === '\\') {
    return '_';
  }

  return char;
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
