import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { Buffer } from 'node:buffer';
import { join } from 'path';
import type { FastifyReply } from 'fastify';
import { bookCoverDirPath, bookThumbnailPath, findPreferredBookCoverFileName } from '../../../common/book-cover-storage';
import { imageContentTypeFromPath } from '../../../common/image-content-type';
import { KoboBookAccessService } from './kobo-book-access.service';
import { WarehouseCatalogService } from '../../warehouse/warehouse-catalog.service';
import type { WarehouseBinaryResponse } from '../../warehouse/warehouse-client.service';
import { LIBRARY_MEDIA_UNAVAILABLE_MESSAGE } from '../../warehouse/warehouse-user-facing-messages';
import type { RequestUser } from '../../../common/types/request-user';

@Injectable()
export class KoboThumbnailService {
  private readonly appDataPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly warehouseCatalog?: WarehouseCatalogService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async serveThumbnail(userId: number, bookId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const thumbnailPath = bookThumbnailPath(this.appDataPath, bookId);
    try {
      const { mtimeMs } = await stat(thumbnailPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'max-age=86400');
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      reply.send(createReadStream(thumbnailPath));
    } catch {
      await this.serveCover(bookId, ifNoneMatch, reply);
    }
  }

  async serveCatalogThumbnail(userId: number, catalogItemId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
    if (!this.warehouseCatalog) throw new NotFoundException('No cover image');
    const remoteId = await this.bookAccessService.resolveCatalogEbookRemoteId(userId, catalogItemId);
    const binary = await this.warehouseCatalog.getEbookCover({ id: userId } as RequestUser, remoteId, 'thumbnail');
    return sendCatalogImageResponse(reply, binary, ifNoneMatch);
  }

  async serveCover(bookId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
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
      reply.header('Cache-Control', 'max-age=86400');
      reply.header('ETag', etag);
      reply.type(imageContentTypeFromPath(coverPath));
      reply.send(createReadStream(coverPath));
    } catch {
      throw new NotFoundException('No cover image');
    }
  }
}

function sendCatalogImageResponse(reply: FastifyReply, binary: WarehouseBinaryResponse, ifNoneMatch: string | undefined) {
  const contentType = safeImageContentType(binary.contentType);
  const contentLength = binary.contentLength ?? (Buffer.isBuffer(binary.body) ? binary.body.length : null);
  const etag = binary.contentLength != null ? `"catalog-${binary.contentLength}"` : null;

  if (etag && ifNoneMatch === etag) {
    reply.status(304).send();
    return;
  }

  reply.header('Cache-Control', 'max-age=86400');
  if (etag) reply.header('ETag', etag);
  if (contentLength !== null) reply.header('Content-Length', String(contentLength));
  reply.type(contentType);
  return reply.send(binary.body);
}

function safeImageContentType(contentType: string): string {
  const mediaType = (contentType.trim() || '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (mediaType.startsWith('image/')) return mediaType;
  throw new BadGatewayException(LIBRARY_MEDIA_UNAVAILABLE_MESSAGE);
}
