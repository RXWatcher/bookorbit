import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WarehouseCacheClearResult, WarehouseCacheMediaStatus, WarehouseCacheStatus, WarehouseMediaType } from '@bookorbit/types';
import { createHash } from 'crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';

import { COVER_PROXY_MAX_IMAGE_BYTES } from '../cover/constants';
import type { WarehouseBinaryResponse } from './warehouse-client.service';

type CoverCacheMetadata = {
  contentType: string;
  contentLength: number;
  sha256: string;
};

const COVER_BYTES_FILE_NAME = 'cover.bin';
const COVER_METADATA_FILE_NAME = 'metadata.json';
const SAFE_SIZE_KEY_PATTERN = /^[a-z0-9_-]{1,64}$/i;
const CACHEABLE_RASTER_CONTENT_TYPES = new Set(['image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class WarehouseCatalogCoverCacheService {
  private readonly rootPath: string;

  constructor(config: ConfigService) {
    const appDataPath = config.get<string>('storage.appDataPath') ?? '/data';
    this.rootPath = join(appDataPath, 'warehouse', 'catalog-covers');
  }

  async readEbookCover(sourceKey: string, remoteId: string, size: string): Promise<WarehouseBinaryResponse | null> {
    return this.readCover('ebook', sourceKey, remoteId, size);
  }

  async writeEbookCover(sourceKey: string, remoteId: string, size: string, response: WarehouseBinaryResponse): Promise<WarehouseBinaryResponse> {
    return this.writeCover('ebook', sourceKey, remoteId, size, response);
  }

  async readComicCover(sourceKey: string, remoteId: string, size: string): Promise<WarehouseBinaryResponse | null> {
    return this.readCover('comic', sourceKey, remoteId, size);
  }

  async writeComicCover(sourceKey: string, remoteId: string, size: string, response: WarehouseBinaryResponse): Promise<WarehouseBinaryResponse> {
    return this.writeCover('comic', sourceKey, remoteId, size, response);
  }

  async readAudiobookCover(sourceKey: string, remoteId: string): Promise<WarehouseBinaryResponse | null> {
    return this.readCover('audiobook', sourceKey, remoteId, 'cover');
  }

  async writeAudiobookCover(sourceKey: string, remoteId: string, response: WarehouseBinaryResponse): Promise<WarehouseBinaryResponse> {
    return this.writeCover('audiobook', sourceKey, remoteId, 'cover', response);
  }

  async getStatus(): Promise<WarehouseCacheStatus> {
    const byMediaType = {
      ebook: await this.mediaStatus('ebook'),
      audiobook: await this.mediaStatus('audiobook'),
      comic: await this.mediaStatus('comic'),
    };

    return {
      covers: {
        totalEntries: byMediaType.ebook.entries + byMediaType.audiobook.entries + byMediaType.comic.entries,
        totalBytes: byMediaType.ebook.bytes + byMediaType.audiobook.bytes + byMediaType.comic.bytes,
        byMediaType,
      },
    };
  }

  async clear(): Promise<WarehouseCacheClearResult> {
    const before = await this.getStatus();
    await rm(this.rootPath, { recursive: true, force: true });
    const after = await this.getStatus();

    return {
      cleared: {
        covers: {
          entries: before.covers.totalEntries,
          bytes: before.covers.totalBytes,
        },
      },
      ...after,
    };
  }

  private async readCover(mediaType: string, sourceKey: string, remoteId: string, size: string): Promise<WarehouseBinaryResponse | null> {
    try {
      const dir = this.coverDir(mediaType, sourceKey, remoteId, size);
      const [metadataBytes, body] = await Promise.all([readFile(join(dir, COVER_METADATA_FILE_NAME)), readFile(join(dir, COVER_BYTES_FILE_NAME))]);
      const metadata = JSON.parse(metadataBytes.toString('utf8')) as Partial<CoverCacheMetadata>;
      const contentType = normalizeImageContentType(metadata.contentType);
      if (!contentType || body.length !== metadata.contentLength || sha256(body) !== metadata.sha256) {
        return null;
      }

      return {
        status: 200,
        contentType,
        contentLength: body.length,
        body,
        fileName: null,
      };
    } catch {
      return null;
    }
  }

  private async writeCover(
    mediaType: string,
    sourceKey: string,
    remoteId: string,
    size: string,
    response: WarehouseBinaryResponse,
  ): Promise<WarehouseBinaryResponse> {
    const contentType = normalizeImageContentType(response.contentType);
    if (!contentType) {
      return response;
    }
    if (response.contentLength === null || response.contentLength > COVER_PROXY_MAX_IMAGE_BYTES) {
      return response;
    }

    const body = await bodyToBoundedBuffer(response.body);
    if (body === 'too-large') {
      return {
        ...response,
        status: 502,
        contentType: 'application/octet-stream',
        contentLength: 0,
        body: Buffer.alloc(0),
        fileName: null,
      };
    }
    if (body === null) {
      return response;
    }

    const dir = this.coverDir(mediaType, sourceKey, remoteId, size);
    await mkdir(dir, { recursive: true });
    const metadata: CoverCacheMetadata = {
      contentType,
      contentLength: body.length,
      sha256: sha256(body),
    };
    try {
      await writeFile(join(dir, COVER_BYTES_FILE_NAME), body);
      await writeFile(join(dir, COVER_METADATA_FILE_NAME), JSON.stringify(metadata));
    } catch {
      return {
        ...response,
        contentType,
        contentLength: body.length,
        body,
        fileName: null,
      };
    }

    return {
      ...response,
      contentType,
      contentLength: body.length,
      body,
      fileName: null,
    };
  }

  private coverDir(mediaType: string, sourceKey: string, remoteId: string, size: string): string {
    const source = createHash('sha256').update(sourceKey).digest('hex');
    const remoteKey = createHash('sha256').update(remoteId).digest('hex');
    const sizeKey = SAFE_SIZE_KEY_PATTERN.test(size) ? size : createHash('sha256').update(size).digest('hex');
    return join(this.rootPath, mediaType, source, remoteKey, sizeKey);
  }

  private async mediaStatus(mediaType: WarehouseMediaType): Promise<WarehouseCacheMediaStatus> {
    return this.scanMediaDir(join(this.rootPath, mediaType));
  }

  private async scanMediaDir(dir: string): Promise<WarehouseCacheMediaStatus> {
    let entries = 0;
    let bytes = 0;

    for (const filePath of await this.metadataPaths(dir)) {
      try {
        const metadata = JSON.parse((await readFile(filePath)).toString('utf8')) as Partial<CoverCacheMetadata>;
        const contentType = normalizeImageContentType(metadata.contentType);
        const bytePath = join(filePath, '..', COVER_BYTES_FILE_NAME);
        const [file, body] = await Promise.all([stat(bytePath), readFile(bytePath)]);
        if (contentType && file.isFile() && body.length === metadata.contentLength && sha256(body) === metadata.sha256) {
          entries += 1;
          bytes += body.length;
        }
      } catch {
        // Deleted between readdir and stat; ignore transient cache changes.
      }
    }

    return { entries, bytes };
  }

  private async metadataPaths(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const paths: string[] = [];
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        paths.push(...(await this.metadataPaths(entryPath)));
      } else if (entry.isFile() && entry.name === COVER_METADATA_FILE_NAME) {
        paths.push(entryPath);
      }
    }

    return paths;
  }
}

function normalizeImageContentType(contentType: unknown): string | null {
  if (typeof contentType !== 'string') {
    return null;
  }

  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (!mediaType || !CACHEABLE_RASTER_CONTENT_TYPES.has(mediaType)) {
    return null;
  }

  return mediaType;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function bodyToBoundedBuffer(body: WarehouseBinaryResponse['body']): Promise<Buffer | 'too-large' | null> {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (!(body instanceof Readable)) {
    return null;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > COVER_PROXY_MAX_IMAGE_BYTES) {
      return 'too-large';
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}
