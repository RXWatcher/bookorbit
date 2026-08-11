import { Buffer } from 'node:buffer';

import { BadGatewayException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { WarehouseMediaType, WarehouseRequestListQuery, WarehouseRequestStatus } from '@bookorbit/types';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import {
  ListWarehouseRequestsDto,
  SubmitWarehouseAudiobookRequestDto,
  SubmitWarehouseComicRequestDto,
  SubmitWarehouseEbookRequestDto,
} from './dto/warehouse-request.dto';
import type { WarehouseBinaryResponse } from './warehouse-client.service';
import { WarehouseRequestService } from './warehouse-request.service';
import { LIBRARY_MEDIA_UNAVAILABLE_MESSAGE } from './warehouse-user-facing-messages';

type RequestQueryValue = string | number | undefined;

const VALID_REQUEST_STATUSES: WarehouseRequestStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'unknown'];
const VALID_REQUEST_MEDIA_TYPES: WarehouseMediaType[] = ['ebook', 'audiobook', 'comic'];
const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream';
const EBOOK_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;
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

@Controller(['catalog/requests', 'requests'])
export class WarehouseRequestController {
  constructor(private readonly requests: WarehouseRequestService) {}

  @Get('ebooks/search')
  searchEbooks(@CurrentUser() _user: RequestUser, @Query('q') q: string | undefined) {
    return this.requests.searchExternalBooks(stringValue(q) ?? '');
  }

  @Get('audiobooks/search')
  searchAudiobooks(@CurrentUser() _user: RequestUser, @Query('q') q: string | undefined) {
    return this.requests.searchAudiobooks(stringValue(q) ?? '');
  }

  @Get('audiobooks/candidates')
  searchAudiobookCandidates(@CurrentUser() _user: RequestUser, @Query('q') q: string | undefined) {
    return this.requests.searchAudiobookCandidates(stringValue(q) ?? '');
  }

  @Post('ebooks')
  submitEbookRequest(@CurrentUser() user: RequestUser, @Body() dto: SubmitWarehouseEbookRequestDto) {
    return this.requests.submitEbookRequest(user, dto);
  }

  @Post('audiobooks')
  submitAudiobookRequest(@CurrentUser() user: RequestUser, @Body() dto: SubmitWarehouseAudiobookRequestDto) {
    return this.requests.submitAudiobookRequest(user, dto);
  }

  @Post('comics')
  submitComicRequest(@CurrentUser() user: RequestUser, @Body() dto: SubmitWarehouseComicRequestDto) {
    return this.requests.submitComicRequest(user, dto);
  }

  @Get('audiobooks')
  listAudiobookRequests(@CurrentUser() user: RequestUser, @Query() query: ListWarehouseRequestsDto) {
    return this.requests.listAudiobookRequests(user, normalizeRequestQuery(query as Record<string, RequestQueryValue>));
  }

  @Get('comics')
  listComicRequests(@CurrentUser() user: RequestUser, @Query() query: ListWarehouseRequestsDto) {
    return this.requests.listComicRequests(user, normalizeRequestQuery(query as Record<string, RequestQueryValue>));
  }

  @Post('comics/refresh')
  refreshComicRequests(@CurrentUser() user: RequestUser, @Query() query: ListWarehouseRequestsDto) {
    return this.requests.refreshComicRequests(user, normalizeRequestQuery(query as Record<string, RequestQueryValue>));
  }

  @Post('audiobooks/refresh')
  refreshAudiobookRequests(@CurrentUser() user: RequestUser, @Query() query: ListWarehouseRequestsDto) {
    return this.requests.refreshAudiobookRequests(user, normalizeRequestQuery(query as Record<string, RequestQueryValue>));
  }

  @Get('audiobooks/queue')
  getAudiobookQueue(@CurrentUser() user: RequestUser) {
    return this.requests.getAudiobookQueue(user);
  }

  @Get()
  listRequests(@CurrentUser() user: RequestUser, @Query() query: ListWarehouseRequestsDto) {
    return this.requests.listRequests(user, normalizeRequestQuery(query as Record<string, RequestQueryValue>));
  }

  @Get(':id')
  getRequest(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.requests.getRequest(user, id);
  }

  @Post(':id/refresh')
  refreshRequest(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.requests.refreshRequest(user, id);
  }

  @Delete(':id')
  cancelRequest(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.requests.cancelRequest(user, id);
  }

  @Get(':id/stream')
  async streamRequest(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    return sendEbookBinaryResponse(reply, await this.requests.streamRequest(user, id));
  }
}

function normalizeRequestQuery(query: Record<string, RequestQueryValue>): WarehouseRequestListQuery {
  return {
    mediaType: enumValue(query.mediaType, VALID_REQUEST_MEDIA_TYPES),
    status: enumValue(query.status, VALID_REQUEST_STATUSES),
    page: numberValue(query.page),
    limit: numberValue(query.limit),
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberValue(value: RequestQueryValue): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  const trimmed = stringValue(value);
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function enumValue<T extends string>(value: RequestQueryValue, validValues: readonly T[]): T | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return validValues.includes(value as T) ? (value as T) : undefined;
}

function sendEbookBinaryResponse(reply: FastifyReply, binary: WarehouseBinaryResponse) {
  const contentType = safeEbookContentType(binary.contentType);
  const contentLength = binary.contentLength ?? (Buffer.isBuffer(binary.body) ? binary.body.length : null);

  if (binary.status === 206) {
    if (!isPartialContentRange(binary.contentRange)) {
      throw new BadGatewayException(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }

    reply.status(206);
  }

  if (binary.status === 416) {
    if (!isUnsatisfiedContentRange(binary.contentRange)) {
      throw new BadGatewayException(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
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

  reply.header('Content-Disposition', safeContentDisposition(binary.fileName ?? 'request-download.bin'));
  reply.type(contentType);
  return reply.send(binary.body);
}

function safeEbookContentType(contentType: string): string {
  const normalized = contentType.trim() || DEFAULT_BINARY_CONTENT_TYPE;
  const mediaType = normalized.split(';', 1)[0]?.trim().toLowerCase() ?? '';

  if (EBOOK_DOWNLOAD_CONTENT_TYPES.has(mediaType)) {
    return mediaType;
  }

  throw new BadGatewayException(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
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
