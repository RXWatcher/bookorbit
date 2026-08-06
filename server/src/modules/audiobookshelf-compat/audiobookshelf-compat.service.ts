import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { isAudioFormat } from '@bookorbit/types';
import type { BookQuery, WarehouseMediaType, WarehouseUserReadStatus } from '@bookorbit/types';

import { AuthService } from '../auth/auth.service';
import { BookService } from '../book/book.service';
import type { BookDetailDto, BookFileDto } from '../book/dto/book-detail.dto';
import type { SaveProgressDto } from '../book/dto/save-progress.dto';
import type { UpsertAudioProgressDto } from '../book/dto/upsert-audio-progress.dto';
import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import type { SaveReadingSessionDto } from '../reading-session/dto/save-reading-session.dto';
import { ReadingSessionService } from '../reading-session/reading-session.service';
import type { WarehouseCatalogItemRow } from '../../db/schema';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { WarehouseUserStateService } from '../warehouse/warehouse-user-state.service';
import { AbsAssetService } from './abs-asset.service';
import { decodeAbsItemId, decodeAbsLibraryId } from './abs-id-codec';
import { AbsItemMappingError, mapAbsCatalogItem, mapAbsLibraryItemsPage, mapAbsLocalBookItem } from './abs-item.mapper';
import { mapAbsLoginResponse } from './abs-auth.mapper';
import { mapAbsLibrary } from './abs-library.mapper';
import { mapAbsProgressPayload, mapAbsSessionPayload, type AbsNormalizedProgressUpdate, type AbsNormalizedSession } from './abs-progress.mapper';
import type { AbsStatusResponse } from './dto';

type AbsLibraryItemsPage = {
  results: unknown[];
  total: number;
  page: number;
  limit: number;
};

type AbsBatchErrorCode = 'invalid_item' | 'invalid_payload' | 'not_found' | 'sync_failed';

type AbsSessionSyncResult =
  | { success: true; result: { skipped: true } | { itemId: string; sessionId: string } }
  | { success: false; itemId: string | null; error: AbsBatchErrorCode };

@Injectable()
export class AudiobookshelfCompatService {
  constructor(
    private readonly authService: AuthService,
    private readonly libraryService: LibraryService,
    private readonly bookService: BookService,
    private readonly warehouseCatalogService: WarehouseCatalogService,
    private readonly absAssetService: AbsAssetService,
    private readonly readingSessionService?: ReadingSessionService,
    private readonly warehouseUserStateService?: WarehouseUserStateService,
  ) {}

  getStatus(): Promise<AbsStatusResponse> {
    return Promise.resolve({
      server: 'BookOrbit',
      version: process.env.npm_package_version ?? '0.0.0',
      language: 'en-us',
      authMethods: ['local'],
    });
  }

  async login(body: { username?: string; password?: string }, ip?: string) {
    const username = body.username?.trim() ?? '';
    const password = body.password ?? '';

    if (!username || !password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const authResult = await this.authService.login({ username, password }, this.createNoopCookieReply(), ip);

    return mapAbsLoginResponse(authResult.user, authResult.accessToken);
  }

  async listLibraries(user: RequestUser) {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    return libraries.map((library) =>
      mapAbsLibrary({
        id: library.id,
        name: library.name,
        coverAspectRatio: library.coverAspectRatio as Parameters<typeof mapAbsLibrary>[0]['coverAspectRatio'],
      }),
    );
  }

  async listLibraryItems(user: RequestUser, absLibraryId: string, query: BookQuery): Promise<AbsLibraryItemsPage> {
    const decoded = this.decodeLibraryId(absLibraryId);
    await this.libraryService.verifyUserAccess(user.id, decoded.libraryId, user.isSuperuser);

    const page =
      decoded.source === 'warehouse'
        ? await this.libraryService.querySourceBackedLibraryBooks(user, decoded.libraryId, query)
        : await this.bookService.queryForLibrary(user, decoded.libraryId, query);

    try {
      return mapAbsLibraryItemsPage(decoded.libraryId, page);
    } catch (error) {
      if (error instanceof AbsItemMappingError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async getItem(user: RequestUser, absItemId: string) {
    const ref = this.decodeItemId(absItemId);
    await this.libraryService.verifyUserAccess(user.id, ref.libraryId, user.isSuperuser);

    if (ref.source === 'local') {
      await this.bookService.verifyBookAccess(ref.bookId, user);
      const book = await this.bookService.getDetail(ref.bookId, user);
      if (book.libraryId !== ref.libraryId) {
        throw new NotFoundException(`Book ${ref.bookId} not found`);
      }

      return mapAbsLocalBookItem(ref.libraryId, {
        id: book.id,
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors.map((author) => author.name),
        narrators: book.audioMetadata?.narrators.map((narrator) => narrator.name) ?? [],
        coverSource: book.coverSource,
      });
    }

    const item = await this.warehouseCatalogService.findAccessibleCatalogItemById(user, ref.mediaType, ref.catalogItemId);
    if (!item || item.mediaType !== ref.mediaType) {
      throw new NotFoundException(`Catalog item ${ref.catalogItemId} not found`);
    }

    return mapAbsCatalogItem(ref.libraryId, item);
  }

  pipeCover(user: RequestUser, itemId: string, reply: FastifyReply) {
    return this.absAssetService.pipeCover(user, itemId, reply);
  }

  pipeDownload(user: RequestUser, itemId: string, range: string | undefined, reply: FastifyReply) {
    return this.absAssetService.pipeDownload(user, itemId, range, reply);
  }

  play(user: RequestUser, itemId: string) {
    return this.absAssetService.play(user, itemId);
  }

  pipeTrack(user: RequestUser, itemId: string, trackId: string, range: string | undefined, reply: FastifyReply) {
    return this.absAssetService.pipeTrack(user, itemId, trackId, range, reply);
  }

  async updateProgress(user: RequestUser, itemId: string, payload: unknown) {
    const progress = mapAbsProgressPayload(itemId, payload);
    const ref = this.decodeItemId(progress.itemId);
    await this.verifyLibraryAccess(user, ref.libraryId);

    if (ref.source === 'local') {
      await this.saveLocalProgress(user, ref.bookId, ref.libraryId, progress);
    } else {
      await this.saveWarehouseProgress(user, ref.mediaType, ref.catalogItemId, progress);
    }

    return {
      success: true,
      result: {
        itemId: progress.itemId,
        progress: progress.progressPercent,
        positionSeconds: progress.positionSeconds ?? null,
        isFinished: progress.isFinished,
      },
    };
  }

  async syncLocalSession(user: RequestUser, payload: unknown): Promise<AbsSessionSyncResult> {
    const session = mapAbsSessionPayload(payload);
    if (!session) {
      return { success: true, result: { skipped: true } };
    }

    await this.saveSession(user, session);
    return {
      success: true,
      result: {
        itemId: session.itemId,
        sessionId: session.sessionId,
      },
    };
  }

  async syncLocalSessions(user: RequestUser, payload: unknown) {
    const entries = this.readSessionEntries(payload);
    const results: AbsSessionSyncResult[] = [];

    for (const entry of entries) {
      try {
        results.push(await this.syncLocalSession(user, entry));
      } catch (error) {
        results.push({
          success: false,
          itemId: this.readBestEffortItemId(entry),
          error: this.classifyBatchSyncError(error),
        });
      }
    }

    return {
      success: results.every((result) => result.success),
      results,
    };
  }

  private createNoopCookieReply(): FastifyReply {
    return {
      setCookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as FastifyReply;
  }

  private decodeLibraryId(absLibraryId: string): ReturnType<typeof decodeAbsLibraryId> {
    try {
      return decodeAbsLibraryId(absLibraryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid ABS library ID';
      throw new BadRequestException(message);
    }
  }

  private decodeItemId(absItemId: string): ReturnType<typeof decodeAbsItemId> {
    try {
      return decodeAbsItemId(absItemId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid ABS item ID';
      throw new BadRequestException(message);
    }
  }

  private async verifyLibraryAccess(user: RequestUser, libraryId: number): Promise<void> {
    await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);
  }

  private async getLocalDetail(user: RequestUser, bookId: number, libraryId: number): Promise<BookDetailDto> {
    await this.bookService.verifyBookAccess(bookId, user);
    const detail = await this.bookService.getDetail(bookId, user);
    if (detail.libraryId !== libraryId) {
      throw new NotFoundException(`Book ${bookId} not found`);
    }
    return detail;
  }

  private async saveLocalProgress(user: RequestUser, bookId: number, libraryId: number, progress: AbsNormalizedProgressUpdate): Promise<void> {
    const detail = await this.getLocalDetail(user, bookId, libraryId);
    const audioFile = this.pickAudioFile(detail);
    if (audioFile || detail.audioMetadata) {
      if (!audioFile) {
        throw new NotFoundException(`No playable audio file for item ${progress.itemId}`);
      }
      const dto: UpsertAudioProgressDto = {
        currentFileId: audioFile.id,
        percentage: progress.progressPercent,
        positionSeconds: progress.positionSeconds ?? 0,
      };
      await this.bookService.saveAudioProgress(user.id, bookId, dto, user);
      return;
    }

    const file = this.pickReadableFile(detail, progress.itemId);
    const dto: SaveProgressDto = {
      percentage: progress.progressPercent,
      positionSeconds: progress.positionSeconds,
    };
    await this.bookService.saveProgress(user.id, file.id, dto, user);
  }

  private async saveWarehouseProgress(
    user: RequestUser,
    mediaType: WarehouseMediaType,
    catalogItemId: number,
    progress: AbsNormalizedProgressUpdate,
  ): Promise<void> {
    const stateService = this.requireWarehouseUserStateService();
    const item = await this.findWarehouseItem(user, mediaType, catalogItemId);
    const readStatus = this.readStatusForProgress(progress.progressPercent, progress.isFinished);
    await stateService.patchState(user, item.mediaType, item.remoteId, {
      progressPercent: progress.progressPercent,
      ...(progress.positionSeconds !== undefined ? { positionSeconds: progress.positionSeconds } : {}),
      ...(readStatus ? { readStatus } : {}),
    });
  }

  private async saveSession(user: RequestUser, session: AbsNormalizedSession): Promise<void> {
    const ref = this.decodeItemId(session.itemId);
    await this.verifyLibraryAccess(user, ref.libraryId);
    const dto: SaveReadingSessionDto = {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationSeconds: session.durationSeconds,
      progressDelta: session.progressDelta,
      endProgress: session.endProgress,
    };

    if (ref.source === 'local') {
      const detail = await this.getLocalDetail(user, ref.bookId, ref.libraryId);
      const file = this.pickAudioFile(detail) ?? this.pickReadableFile(detail, session.itemId);
      await this.requireReadingSessionService().save(file.id, dto, user);
      return;
    }

    const item = await this.findWarehouseItem(user, ref.mediaType, ref.catalogItemId);
    await this.requireWarehouseUserStateService().saveReadingSession(user, item.mediaType, item.remoteId, dto);
  }

  private async findWarehouseItem(user: RequestUser, mediaType: WarehouseMediaType, catalogItemId: number): Promise<WarehouseCatalogItemRow> {
    const item = await this.warehouseCatalogService.findAccessibleCatalogItemById(user, mediaType, catalogItemId);
    if (!item || item.mediaType !== mediaType) {
      throw new NotFoundException(`Catalog item ${catalogItemId} not found`);
    }
    return item;
  }

  private pickAudioFile(detail: BookDetailDto): BookFileDto | null {
    const audioFiles = detail.files.filter((file) => Boolean(file.format && isAudioFormat(file.format)));
    return audioFiles.find((file) => file.role === 'primary') ?? audioFiles[0] ?? null;
  }

  private pickReadableFile(detail: BookDetailDto, itemId: string): BookFileDto {
    const nonAudioFiles = detail.files.filter((file) => !file.format || !isAudioFormat(file.format));
    const file =
      nonAudioFiles.find((candidate) => candidate.role === 'primary') ??
      detail.files.find((candidate) => candidate.role === 'primary') ??
      nonAudioFiles[0] ??
      detail.files[0];
    if (!file) {
      throw new NotFoundException(`No readable file for item ${itemId}`);
    }
    return file;
  }

  private readStatusForProgress(progressPercent: number, isFinished: boolean): WarehouseUserReadStatus | null {
    if (isFinished || progressPercent >= 100) return 'read';
    if (progressPercent > 0) return 'reading';
    return null;
  }

  private readSessionEntries(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (typeof payload !== 'object' || payload === null) {
      throw new BadRequestException('sessions must be an array.');
    }
    const body = payload as Record<string, unknown>;
    const entries = body.sessions ?? body.localSessions ?? body.items;
    if (!Array.isArray(entries)) {
      throw new BadRequestException('sessions must be an array.');
    }
    return entries;
  }

  private readBestEffortItemId(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const body = payload as Record<string, unknown>;
    const value = body.itemId ?? body.id ?? body.mediaItemId ?? body.libraryItemId;
    if (typeof value !== 'string' || value.trim() === '') return null;

    const candidate = value.trim();
    try {
      decodeAbsItemId(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  private classifyBatchSyncError(error: unknown): AbsBatchErrorCode {
    if (error instanceof NotFoundException) return 'not_found';
    if (error instanceof BadRequestException) {
      const message = error.message;
      if (message.includes('ABS item id') || message.includes('ABS item ID')) return 'invalid_item';
      return 'invalid_payload';
    }
    return 'sync_failed';
  }

  private requireReadingSessionService(): ReadingSessionService {
    if (!this.readingSessionService) {
      throw new BadRequestException('Reading session sync is unavailable.');
    }
    return this.readingSessionService;
  }

  private requireWarehouseUserStateService(): WarehouseUserStateService {
    if (!this.warehouseUserStateService) {
      throw new BadRequestException('Warehouse user state sync is unavailable.');
    }
    return this.warehouseUserStateService;
  }
}
