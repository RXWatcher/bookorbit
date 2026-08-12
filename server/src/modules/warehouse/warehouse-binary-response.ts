import { BadGatewayException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { LIBRARY_MEDIA_UNAVAILABLE_MESSAGE } from './warehouse-user-facing-messages';
import type { WarehouseBinaryResponse } from './warehouse-client.service';

const EBOOK_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;
const AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;

/**
 * Sends a proxied or on-disk binary to the client, preserving HTTP Range semantics.
 *
 * Extracted from the warehouse catalog controller so the ABS adapter can serve the same bytes
 * through its own routes. The 206/416 handling is the reason this is shared rather than
 * reimplemented: a partial response whose Content-Range is missing or unsatisfiable has to fail
 * loudly instead of being sent as a truncated 200, which is what breaks seeking in audio clients.
 */

export type BinaryContentKind = 'ebook-cover' | 'audiobook-cover' | 'comic-cover' | 'comic-page' | 'audio' | 'ebook' | 'comic';

const DEFAULT_BINARY_CONTENT_TYPE = 'application/octet-stream';

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

export function sendBinaryResponse(
  reply: FastifyReply,
  binary: WarehouseBinaryResponse,
  expectedContent: BinaryContentKind,
  downloadFallbackName?: string,
) {
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
