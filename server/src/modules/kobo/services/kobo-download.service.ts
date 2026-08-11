import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { BadGatewayException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../../common/types/request-user';
import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import type { WarehouseBinaryResponse } from '../../warehouse/warehouse-client.service';
import { LIBRARY_MEDIA_UNAVAILABLE_MESSAGE } from '../../warehouse/warehouse-user-facing-messages';
import { WarehouseCatalogService } from '../../warehouse/warehouse-catalog.service';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KepubConversionService } from './kepub-conversion.service';
import { KoboSettingsService } from './kobo-settings.service';

type Db = NodePgDatabase<typeof schema>;

const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  'kepub.epub': 'application/epub+zip',
  pdf: 'application/pdf',
};

const CATALOG_EBOOK_MIME_TYPES = new Set(['application/epub+zip', 'application/pdf', 'application/octet-stream']);

@Injectable()
export class KoboDownloadService {
  private readonly logger = new Logger(KoboDownloadService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kepubConversionService: KepubConversionService,
    private readonly settingsService: KoboSettingsService,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly warehouseCatalog?: WarehouseCatalogService,
  ) {}

  async streamBook(userId: number, bookId: number, reply: FastifyReply) {
    const book = await this.db.query.books.findFirst({ where: eq(schema.books.id, bookId) });
    if (!book) throw new NotFoundException('Book not found');

    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const file = await this.db.query.bookFiles.findFirst({
      where: and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.id, book.primaryFileId ?? -1)),
    });

    if (!file) throw new NotFoundException('No file found for this book');

    const format = (file.format ?? 'epub').toLowerCase();

    if (format === 'pdf') {
      return this.streamFile(file.absolutePath, file.id, format, reply);
    }

    if (format === 'kepub') {
      return this.streamFile(file.absolutePath, file.id, 'kepub.epub', reply);
    }

    if (format === 'epub') {
      const settings = await this.settingsService.getSettings(userId);
      const limitBytes = settings.kepubConversionLimitMb * 1024 * 1024;
      const withinLimit = !file.sizeBytes || file.sizeBytes <= limitBytes;
      if (settings.convertToKepub && withinLimit) {
        return this.streamKepub(file.absolutePath, file.fileHash ?? 'nohash', bookId, file.id, settings.forceEnableHyphenation, reply);
      }
    }

    return this.streamFile(file.absolutePath, file.id, format, reply);
  }

  async streamCatalogEbook(userId: number, catalogItemId: number, reply: FastifyReply, range?: string) {
    if (!this.warehouseCatalog) throw new NotFoundException('No file found for this book');

    const remoteId = await this.bookAccessService.resolveCatalogEbookRemoteId(userId, catalogItemId);
    const user = { id: userId } as RequestUser;
    const binary =
      range === undefined
        ? await this.warehouseCatalog.downloadEbook(user, remoteId)
        : await this.warehouseCatalog.downloadEbook(user, remoteId, range);

    return this.sendCatalogEbookResponse(catalogItemId, binary, reply);
  }

  private async streamFile(absolutePath: string, fileId: number, format: string, reply: FastifyReply) {
    try {
      const { size } = await stat(absolutePath);
      reply.header('Content-Length', size);
      reply.header('Content-Disposition', `attachment; filename="book-${fileId}.${format}"`);
      reply.type(MIME[format] ?? 'application/octet-stream');
      reply.send(createReadStream(absolutePath));
    } catch {
      throw new NotFoundException('File not found on disk');
    }
  }

  private async streamKepub(sourcePath: string, fileHash: string, bookId: number, fileId: number, hyphenate: boolean, reply: FastifyReply) {
    const start = Date.now();
    try {
      const cachedPath = await this.kepubConversionService.getKepubPath({ sourcePath, fileHash, bookId, hyphenate });
      return this.streamFile(cachedPath, fileId, 'kepub.epub', reply);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[kobo.download] [fail] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - start} errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - kepub conversion failed, falling back to epub`,
      );
      return this.streamFile(sourcePath, fileId, 'epub', reply);
    }
  }

  private sendCatalogEbookResponse(catalogItemId: number, binary: WarehouseBinaryResponse, reply: FastifyReply) {
    const contentType = this.safeCatalogEbookContentType(binary.contentType);
    const contentLength = binary.contentLength ?? (Buffer.isBuffer(binary.body) ? binary.body.length : null);

    if (binary.status === 206) {
      if (!this.isPartialContentRange(binary.contentRange)) throw new BadGatewayException(LIBRARY_MEDIA_UNAVAILABLE_MESSAGE);
      reply.status(206);
    }

    if (binary.status === 416) {
      if (!this.isUnsatisfiedContentRange(binary.contentRange)) throw new BadGatewayException(LIBRARY_MEDIA_UNAVAILABLE_MESSAGE);
      reply.status(416);
    }

    if (contentLength !== null) reply.header('Content-Length', String(contentLength));
    if ((binary.status === 206 || binary.status === 416) && binary.contentRange) reply.header('Content-Range', binary.contentRange);
    if (binary.acceptRanges) reply.header('Accept-Ranges', binary.acceptRanges);
    reply.header('Content-Disposition', `attachment; filename="book-boce_${catalogItemId}.${this.catalogEbookExtension(contentType)}"`);
    reply.type(contentType);
    return reply.send(binary.body);
  }

  private safeCatalogEbookContentType(contentType: string): string {
    const mediaType = (contentType.trim() || 'application/octet-stream').split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (CATALOG_EBOOK_MIME_TYPES.has(mediaType)) return mediaType;
    throw new BadGatewayException(LIBRARY_MEDIA_UNAVAILABLE_MESSAGE);
  }

  private catalogEbookExtension(contentType: string): string {
    if (contentType === 'application/pdf') return 'pdf';
    return 'epub';
  }

  private isPartialContentRange(value: string | null | undefined): value is string {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? '');
    if (!match) return false;

    const start = BigInt(match[1] as string);
    const end = BigInt(match[2] as string);
    if (start > end) return false;

    const total = match[3] as string;
    return total === '*' || end < BigInt(total);
  }

  private isUnsatisfiedContentRange(value: string | null | undefined): value is string {
    return /^bytes \*\/\d+$/i.test(value ?? '');
  }
}
