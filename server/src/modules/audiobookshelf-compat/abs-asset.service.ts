import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream, type ReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { LibraryService } from '../library/library.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import type { WarehouseBinaryResponse } from '../warehouse/warehouse-client.service';
import { decodeAbsItemId } from './abs-id-codec';

type LocalBinaryResponse = {
  source: 'local';
  body: ReadStream | Buffer;
  contentType: string;
  contentLength: number | null;
  status: 200 | 206 | 416;
  contentRange?: string | null;
  acceptRanges?: string | null;
  contentDisposition?: string | null;
  etag?: string | null;
  cacheControl?: string | null;
};

type AbsBinaryResponse = WarehouseBinaryResponse | LocalBinaryResponse;
type BinaryContentKind = 'cover' | 'download' | 'audio';

type WarehouseAccessibleItem = {
  id: number;
  mediaType: 'ebook' | 'audiobook' | 'comic';
  remoteId: string;
};

const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream';
const DOWNLOAD_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/epub+zip',
  'application/pdf',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
  'application/x-fictionbook+xml',
  'application/vnd.comicbook+zip',
  'application/vnd.comicbook-rar',
  'application/x-cb7',
]);

const AUDIO_MIME_TYPES: Record<string, string> = {
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

const BOOK_MIME_TYPES: Record<string, string> = {
  epub: 'application/epub+zip',
  kepub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  cbz: 'application/vnd.comicbook+zip',
  cbr: 'application/vnd.comicbook-rar',
  cb7: 'application/x-cb7',
};

@Injectable()
export class AbsAssetService {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
    private readonly warehouseCatalogService: WarehouseCatalogService,
  ) {}

  async pipeCover(user: RequestUser, itemId: string, reply: FastifyReply) {
    return sendBinaryResponse(reply, await this.resolveCover(user, itemId), 'cover');
  }

  async pipeDownload(user: RequestUser, itemId: string, range: string | undefined, reply: FastifyReply) {
    return sendBinaryResponse(reply, await this.resolveDownload(user, itemId, range), 'download');
  }

  play(user: RequestUser, itemId: string) {
    return this.resolvePlay(user, itemId);
  }

  async pipeTrack(user: RequestUser, itemId: string, trackId: string, range: string | undefined, reply: FastifyReply) {
    return sendBinaryResponse(reply, await this.resolveTrack(user, itemId, trackId, range), 'audio');
  }

  async resolveCover(user: RequestUser, itemId: string): Promise<AbsBinaryResponse> {
    const ref = this.decodeItemId(itemId);
    await this.verifyLibraryAccess(user, ref.libraryId);

    if (ref.source === 'local') {
      await this.assertLocalLibraryMatch(user, ref.bookId, ref.libraryId);
      const coverPath = await this.bookService.getCoverPath(ref.bookId, user);
      if (!coverPath) {
        throw new NotFoundException(`No cover for item ${itemId}`);
      }

      const metadata = await stat(coverPath);
      return {
        source: 'local',
        body: createReadStream(coverPath),
        contentType: imageContentTypeFromPath(coverPath),
        contentLength: metadata.size,
        status: 200,
        etag: `"${Math.floor(metadata.mtimeMs)}"`,
        cacheControl: 'private, max-age=86400',
      };
    }

    const item = await this.findWarehouseItem(user, ref.mediaType, ref.catalogItemId);
    switch (item.mediaType) {
      case 'ebook':
        return this.warehouseCatalogService.getEbookCover(user, item.remoteId, 'medium');
      case 'audiobook':
        return this.warehouseCatalogService.getAudiobookCover(user, item.remoteId);
      case 'comic':
        return this.warehouseCatalogService.getComicPageImage(user, item.remoteId, 0);
    }
  }

  async resolveDownload(user: RequestUser, itemId: string, range?: string): Promise<AbsBinaryResponse> {
    const ref = this.decodeItemId(itemId);
    await this.verifyLibraryAccess(user, ref.libraryId);

    if (ref.source === 'local') {
      const detail = await this.bookService.getDetail(ref.bookId, user);
      if (detail.libraryId !== ref.libraryId) {
        throw new NotFoundException(`Book ${ref.bookId} not found`);
      }
      const file = detail.files.find((candidate) => candidate.role === 'primary') ?? detail.files[0];
      if (!file) {
        throw new NotFoundException(`No downloadable file for item ${itemId}`);
      }

      const info = await this.bookService.getFileInfo(file.id, user);
      const downloadName = await this.bookService.resolveDownloadFilename({
        bookId: info.bookId,
        absolutePath: info.path,
        format: info.format === 'unknown' ? null : info.format,
      });

      return this.localFileBinary(info.path, info.size, info.format, range, downloadName);
    }

    const item = await this.findWarehouseItem(user, ref.mediaType, ref.catalogItemId);
    switch (item.mediaType) {
      case 'ebook':
        return range === undefined
          ? this.warehouseCatalogService.downloadEbook(user, item.remoteId)
          : this.warehouseCatalogService.downloadEbook(user, item.remoteId, range);
      case 'comic':
        return range === undefined
          ? this.warehouseCatalogService.downloadComic(user, item.remoteId)
          : this.warehouseCatalogService.downloadComic(user, item.remoteId, range);
      case 'audiobook':
        return range === undefined
          ? this.warehouseCatalogService.downloadAudiobook(user, item.remoteId)
          : this.warehouseCatalogService.downloadAudiobook(user, item.remoteId, range);
    }
  }

  async resolvePlay(user: RequestUser, itemId: string) {
    const ref = this.decodeItemId(itemId);
    await this.verifyLibraryAccess(user, ref.libraryId);
    if (ref.source === 'local' || ref.mediaType !== 'audiobook') {
      throw new NotFoundException(`Playback unavailable for item ${itemId}`);
    }

    const item = await this.findWarehouseItem(user, ref.mediaType, ref.catalogItemId);
    const detail = await this.warehouseCatalogService.getAudiobook(item.remoteId);
    const files = detail?.files ?? [];
    if (files.length === 0) {
      throw new NotFoundException(`No audio tracks for item ${itemId}`);
    }

    return {
      mediaType: 'audiobook' as const,
      audioTracks: files.map((track, index) => ({
        index: index + 1,
        contentUrl: `/api/items/${itemId}/tracks/${index + 1}/stream`,
        mimeType: resolveBookMimeType(track.format),
      })),
    };
  }

  async resolveTrack(user: RequestUser, itemId: string, trackId: string, range?: string): Promise<AbsBinaryResponse> {
    const ref = this.decodeItemId(itemId);
    await this.verifyLibraryAccess(user, ref.libraryId);
    if (ref.source === 'local' || ref.mediaType !== 'audiobook') {
      throw new NotFoundException(`Track ${trackId} not found for item ${itemId}`);
    }

    const trackIndex = parsePositiveInteger(trackId, 'Invalid ABS track ID') - 1;
    const item = await this.findWarehouseItem(user, ref.mediaType, ref.catalogItemId);
    const detail = await this.warehouseCatalogService.getAudiobook(item.remoteId);
    const track = detail?.files[trackIndex];
    if (!track) {
      throw new NotFoundException(`Track ${trackId} not found for item ${itemId}`);
    }

    return range === undefined
      ? this.warehouseCatalogService.downloadAudiobookFile(user, item.remoteId, track.id)
      : this.warehouseCatalogService.downloadAudiobookFile(user, item.remoteId, track.id, range);
  }

  private decodeItemId(itemId: string): ReturnType<typeof decodeAbsItemId> {
    try {
      return decodeAbsItemId(itemId);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid ABS item ID');
    }
  }

  private async findWarehouseItem(
    user: RequestUser,
    mediaType: 'ebook' | 'audiobook' | 'comic',
    catalogItemId: number,
  ): Promise<WarehouseAccessibleItem> {
    const item = await this.warehouseCatalogService.findAccessibleCatalogItemById(user, mediaType, catalogItemId);
    if (!item || item.mediaType !== mediaType) {
      throw new NotFoundException(`Catalog item ${catalogItemId} not found`);
    }

    return item as WarehouseAccessibleItem;
  }

  private async verifyLibraryAccess(user: RequestUser, libraryId: number) {
    await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);
  }

  private async assertLocalLibraryMatch(user: RequestUser, bookId: number, libraryId: number) {
    const detail = await this.bookService.getDetail(bookId, user);
    if (detail.libraryId !== libraryId) {
      throw new NotFoundException(`Book ${bookId} not found`);
    }
  }

  private localFileBinary(path: string, size: number, format: string | null, range: string | undefined, fallbackName: string): LocalBinaryResponse {
    const contentType = resolveBookMimeType(format);

    if (range !== undefined) {
      const byteRange = parseLocalByteRange(range, size);
      if (!byteRange) {
        return {
          source: 'local',
          body: Buffer.alloc(0),
          contentType,
          contentLength: 0,
          status: 416,
          contentRange: `bytes */${size}`,
          acceptRanges: 'bytes',
          contentDisposition: safeContentDisposition(fallbackName),
        };
      }

      const { start, end } = byteRange;
      return {
        source: 'local',
        body: createReadStream(path, { start, end }),
        contentType,
        contentLength: end - start + 1,
        status: 206,
        contentRange: `bytes ${start}-${end}/${size}`,
        acceptRanges: 'bytes',
        contentDisposition: safeContentDisposition(fallbackName),
      };
    }

    return {
      source: 'local',
      body: createReadStream(path),
      contentType,
      contentLength: size,
      status: 200,
      acceptRanges: 'bytes',
      contentDisposition: safeContentDisposition(fallbackName),
    };
  }
}

function sendBinaryResponse(reply: FastifyReply, binary: AbsBinaryResponse, expectedContent: BinaryContentKind) {
  const isLocal = 'source' in binary;
  const contentType = safeContentType(binary.contentType, expectedContent);
  const contentLength = binary.contentLength ?? null;

  if (binary.status === 206) {
    if (!isPartialContentRange(binary.contentRange)) {
      throw mediaUnavailableException();
    }

    reply.status(206);
  }

  if (binary.status === 416) {
    if (!isUnsatisfiedContentRange(binary.contentRange)) {
      throw mediaUnavailableException();
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

  if (isLocal) {
    if (binary.contentDisposition) {
      reply.header('Content-Disposition', binary.contentDisposition);
    }
    if (binary.etag) {
      reply.header('ETag', binary.etag);
    }
    if (binary.cacheControl) {
      reply.header('Cache-Control', binary.cacheControl);
    }
  }

  reply.type(contentType);
  return reply.send(binary.body);
}

function resolveBookMimeType(format: string | null | undefined): string {
  if (!format) return DEFAULT_BINARY_CONTENT_TYPE;
  const normalized = format.toLowerCase();
  return AUDIO_MIME_TYPES[normalized] ?? BOOK_MIME_TYPES[normalized] ?? DEFAULT_BINARY_CONTENT_TYPE;
}

function safeContentType(contentType: string, expectedContent: BinaryContentKind): string {
  const normalized = contentType.trim() || DEFAULT_BINARY_CONTENT_TYPE;
  const mediaType = normalized.split(';', 1)[0]?.trim().toLowerCase() ?? '';

  if (expectedContent === 'cover' && mediaType.startsWith('image/')) {
    return normalized;
  }

  if (expectedContent === 'download' && (DOWNLOAD_CONTENT_TYPES.has(mediaType) || mediaType.startsWith('audio/'))) {
    return normalized;
  }

  if (expectedContent === 'audio' && (mediaType.startsWith('audio/') || mediaType === DEFAULT_BINARY_CONTENT_TYPE)) {
    return normalized;
  }

  throw mediaUnavailableException();
}

function mediaUnavailableException(): BadGatewayException {
  return new BadGatewayException('Media unavailable');
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

function parseLocalByteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  const startToken = match[1] ?? '';
  const endToken = match[2] ?? '';
  if (!startToken && !endToken) {
    return null;
  }

  if (size <= 0) {
    return null;
  }

  if (!startToken) {
    const suffixLength = Number.parseInt(endToken, 10);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const end = size - 1;
    const start = Math.max(size - suffixLength, 0);
    return { start, end };
  }

  const start = Number.parseInt(startToken, 10);
  if (!Number.isInteger(start) || start < 0 || start >= size) {
    return null;
  }

  if (!endToken) {
    return { start, end: size - 1 };
  }

  const requestedEnd = Number.parseInt(endToken, 10);
  if (!Number.isInteger(requestedEnd) || requestedEnd < start) {
    return null;
  }

  return { start, end: Math.min(requestedEnd, size - 1) };
}

function safeContentDisposition(fallback: string): string {
  const displayName = safeDisplayFileName(fallback);
  const asciiName = asciiAttachmentFileName(displayName, basename(fallback) || 'download.bin');
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

function parsePositiveInteger(value: string, message: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new BadRequestException(message);
  }

  return parsed;
}
