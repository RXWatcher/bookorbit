import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { extname, join, resolve, sep } from 'path';
import { Readable } from 'stream';
import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LocalScanRepository } from './local-scan.repository';

export interface LocalBinaryResponse {
  status: number;
  contentType: string;
  contentLength: number | null;
  contentRange?: string | null;
  acceptRanges?: string | null;
  body: NodeJS.ReadableStream;
  fileName: string | null;
}

const CONTENT_TYPES: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  cbz: 'application/vnd.comicbook+zip',
  cbr: 'application/vnd.comicbook-rar',
  cb7: 'application/x-cb7',
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const COVER_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png'];
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).replace('.', '').toLowerCase()] ?? 'application/octet-stream';
}

@Injectable()
export class LocalContentService {
  private readonly logger = new Logger(LocalContentService.name);

  constructor(private readonly repository: LocalScanRepository) {}

  /** A stored local_path reaches the filesystem, so it is normalised and confined to a
   *  configured root before any read. A path outside every root is treated as absent. */
  private async assertWithinRoots(path: string): Promise<string> {
    const resolved = resolve(path);
    const roots = await this.repository.findAllRootPaths();

    const contained = roots.some((root) => {
      const base = resolve(root);
      return resolved === base || resolved.startsWith(base.endsWith(sep) ? base : base + sep);
    });

    if (!contained) {
      this.logger.warn(`[local_content.resolve] [fail] path="${sanitizeLogValue(resolved)}" - path escapes every configured scan root`);
      throw new NotFoundException('Local file is not available.');
    }

    return resolved;
  }

  private async openFile(path: string, range?: string): Promise<LocalBinaryResponse> {
    let size: number;
    try {
      const stats = await stat(path);
      if (!stats.isFile()) throw new Error('not a file');
      size = stats.size;
    } catch {
      // The mount is a hard runtime dependency for local items. Warehouse items are
      // unaffected, so this is reported as the local file being unavailable.
      throw new BadGatewayException('Local file could not be read. The media mount may be unavailable.');
    }

    const fileName = path.split(sep).pop() ?? null;
    const contentType = contentTypeFor(path);

    const parsed = range ? RANGE_PATTERN.exec(range) : null;
    if (!parsed) {
      return {
        status: 200,
        contentType,
        contentLength: size,
        acceptRanges: 'bytes',
        body: createReadStream(path),
        fileName,
      };
    }

    const startRaw = parsed[1];
    const endRaw = parsed[2];

    let start: number;
    let end: number;
    if (startRaw === '') {
      // A suffix range asks for the final N bytes.
      const suffix = Number(endRaw);
      if (!Number.isFinite(suffix) || suffix <= 0) return this.openFile(path);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(startRaw);
      end = endRaw === '' ? size - 1 : Number(endRaw);
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return {
        status: 416,
        contentType,
        contentLength: 0,
        contentRange: `bytes */${size}`,
        acceptRanges: 'bytes',
        body: Readable.from([]),
        fileName,
      };
    }

    end = Math.min(end, size - 1);

    return {
      status: 206,
      contentType,
      contentLength: end - start + 1,
      contentRange: `bytes ${start}-${end}/${size}`,
      acceptRanges: 'bytes',
      body: createReadStream(path, { start, end }),
      fileName,
    };
  }

  /** Null when the item is warehouse sourced, which keeps the branch in one place. */
  findLocalPath(mediaType: Parameters<LocalScanRepository['findLocalItemPath']>[0], remoteId: string): Promise<string | null> {
    return this.repository.findLocalItemPath(mediaType, remoteId);
  }

  async getFile(localPath: string, range?: string): Promise<LocalBinaryResponse> {
    const safePath = await this.assertWithinRoots(localPath);
    return this.openFile(safePath, range);
  }

  /** Covers are the sibling cover.jpg Calibre writes, not an embedded resource. */
  async getCover(localPath: string): Promise<LocalBinaryResponse> {
    const safePath = await this.assertWithinRoots(localPath);
    const bookDir = safePath.split(sep).slice(0, -1).join(sep);

    for (const name of COVER_NAMES) {
      const candidate = join(bookDir, name);
      try {
        const stats = await stat(candidate);
        if (stats.isFile()) return this.openFile(candidate);
      } catch {
        continue;
      }
    }

    throw new NotFoundException('Local cover is not available.');
  }
}
