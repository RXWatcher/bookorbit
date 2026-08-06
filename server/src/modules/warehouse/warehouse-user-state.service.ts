import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  WarehouseCatalogAnnotation,
  WarehouseCatalogAnnotationCreatePayload,
  WarehouseCatalogAnnotationUpdatePayload,
  WarehouseCatalogBookmark,
  WarehouseCatalogBookmarkCreatePayload,
  WarehouseMediaType,
  WarehouseUserCatalogState,
  WarehouseUserCatalogStatePatch,
  WarehouseUserReadStatus,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { SaveReadingSessionDto } from '../reading-session/dto/save-reading-session.dto';
import { ACHIEVEMENT_EVENT_BACKFILL, AchievementEventsService } from '../achievement/achievement-events.service';
import {
  WarehouseRepository,
  type WarehouseCatalogAnnotationRow,
  type WarehouseCatalogBookmarkRow,
  type WarehouseUserCatalogStateRow,
  type WarehouseUserStatePatch,
} from './warehouse.repository';
import { LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE } from './warehouse-user-facing-messages';

type RawWarehouseUserCatalogStatePatch = WarehouseUserCatalogStatePatch & Record<string, unknown>;

const VALID_MEDIA_TYPES: WarehouseMediaType[] = ['ebook', 'audiobook', 'comic'];
const VALID_READ_STATUSES: WarehouseUserReadStatus[] = ['unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned'];
const VALID_ANNOTATION_STYLES = ['highlight', 'underline', 'strikethrough', 'squiggly'] as const;
const BOOKMARK_CONFLICT_MESSAGE = 'Bookmark already exists.';

@Injectable()
export class WarehouseUserStateService {
  constructor(
    private readonly repository: WarehouseRepository,
    @Optional() private readonly achievementEvents?: AchievementEventsService,
  ) {}

  async getState(user: RequestUser, mediaType: string, remoteId: string): Promise<WarehouseUserCatalogState> {
    const scope = validateScope(mediaType, remoteId);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    return mapUserCatalogState(await this.repository.getUserCatalogState(user.id, scope.mediaType, scope.remoteId));
  }

  async patchState(
    user: RequestUser,
    mediaType: string,
    remoteId: string,
    patch: WarehouseUserCatalogStatePatch,
  ): Promise<WarehouseUserCatalogState> {
    const scope = validateScope(mediaType, remoteId);
    const safePatch = validatePatch(patch);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    const previousState =
      safePatch.readStatus !== undefined ? await this.repository.getUserCatalogState(user.id, scope.mediaType, scope.remoteId) : null;
    const state = await this.repository.upsertUserCatalogState(user.id, scope.mediaType, scope.remoteId, safePatch);
    if (safePatch.readStatus === 'read' && previousState?.readStatus !== 'read') {
      this.achievementEvents?.emit(ACHIEVEMENT_EVENT_BACKFILL, { userId: user.id });
    }
    return mapUserCatalogState(state);
  }

  async getBookmarks(user: RequestUser, mediaType: string, remoteId: string): Promise<WarehouseCatalogBookmark[]> {
    const scope = validateScope(mediaType, remoteId);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    return (await this.repository.findCatalogBookmarks(user.id, scope.mediaType, scope.remoteId)).map(mapCatalogBookmark);
  }

  async createBookmark(
    user: RequestUser,
    mediaType: string,
    remoteId: string,
    payload: WarehouseCatalogBookmarkCreatePayload,
  ): Promise<WarehouseCatalogBookmark> {
    const scope = validateScope(mediaType, remoteId);
    const bookmark = validateBookmarkPayload(payload);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    const existing = await this.repository.findExistingCatalogBookmarkByLocation(user.id, scope.mediaType, scope.remoteId, {
      cfi: bookmark.cfi,
      positionSeconds: bookmark.positionSeconds,
    });
    if (existing) return mapCatalogBookmark(existing);

    const row = await this.repository.createCatalogBookmark(user.id, scope.mediaType, scope.remoteId, bookmark);
    if (!row) {
      const concurrent = await this.repository.findExistingCatalogBookmarkByLocation(user.id, scope.mediaType, scope.remoteId, {
        cfi: bookmark.cfi,
        positionSeconds: bookmark.positionSeconds,
      });
      if (concurrent) return mapCatalogBookmark(concurrent);
      throw new ConflictException(BOOKMARK_CONFLICT_MESSAGE);
    }

    return mapCatalogBookmark(row);
  }

  async deleteBookmark(user: RequestUser, mediaType: string, remoteId: string, bookmarkId: number): Promise<void> {
    const scope = validateScope(mediaType, remoteId);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    const deleted = await this.repository.deleteCatalogBookmark(user.id, scope.mediaType, scope.remoteId, bookmarkId);
    if (!deleted) {
      throw new NotFoundException(`Bookmark ${bookmarkId} not found for library item.`);
    }
  }

  async getAnnotations(user: RequestUser, mediaType: string, remoteId: string): Promise<WarehouseCatalogAnnotation[]> {
    const scope = validateEbookScope(mediaType, remoteId);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    return (await this.repository.findCatalogAnnotations(user.id, scope.mediaType, scope.remoteId)).map(mapCatalogAnnotation);
  }

  async createAnnotation(
    user: RequestUser,
    mediaType: string,
    remoteId: string,
    payload: WarehouseCatalogAnnotationCreatePayload,
  ): Promise<WarehouseCatalogAnnotation> {
    const scope = validateEbookScope(mediaType, remoteId);
    const annotation = validateAnnotationPayload(payload);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    return mapCatalogAnnotation(await this.repository.createCatalogAnnotation(user.id, scope.mediaType, scope.remoteId, annotation));
  }

  async updateAnnotation(
    user: RequestUser,
    mediaType: string,
    remoteId: string,
    annotationId: number,
    payload: WarehouseCatalogAnnotationUpdatePayload,
  ): Promise<WarehouseCatalogAnnotation> {
    const scope = validateEbookScope(mediaType, remoteId);
    const note = validateAnnotationUpdatePayload(payload);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    const row = await this.repository.updateCatalogAnnotationNote(user.id, scope.mediaType, scope.remoteId, annotationId, note);
    if (!row) {
      throw new NotFoundException(`Annotation ${annotationId} not found for library item.`);
    }
    return mapCatalogAnnotation(row);
  }

  async deleteAnnotation(user: RequestUser, mediaType: string, remoteId: string, annotationId: number): Promise<void> {
    const scope = validateEbookScope(mediaType, remoteId);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    const deleted = await this.repository.deleteCatalogAnnotation(user.id, scope.mediaType, scope.remoteId, annotationId);
    if (!deleted) {
      throw new NotFoundException(`Annotation ${annotationId} not found for library item.`);
    }
  }

  async saveReadingSession(user: RequestUser, mediaType: string, remoteId: string, payload: SaveReadingSessionDto): Promise<void> {
    const scope = validateScope(mediaType, remoteId);
    const session = validateReadingSessionPayload(payload);

    await this.ensureCatalogItem(scope.mediaType, scope.remoteId);

    const wallClockSeconds = Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000);
    await this.repository.saveCatalogReadingSession(
      user.id,
      scope.mediaType,
      scope.remoteId,
      session.sessionId,
      session.startedAt,
      session.endedAt,
      Math.min(session.durationSeconds, wallClockSeconds),
      session.progressDelta,
      session.endProgress,
    );
  }

  private async ensureCatalogItem(mediaType: WarehouseMediaType, remoteId: string): Promise<void> {
    const item = await this.repository.findCatalogItem(mediaType, remoteId);
    if (!item) {
      throw new NotFoundException(LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE);
    }
  }
}

function validateReadingSessionPayload(payload: SaveReadingSessionDto): {
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
} {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new BadRequestException('Reading session must be an object.');
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0 || payload.sessionId.length > 64) {
    throw new BadRequestException('sessionId must be a non-empty string up to 64 characters.');
  }

  const startedAt = new Date(payload.startedAt);
  const endedAt = new Date(payload.endedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new BadRequestException('Invalid reading session timestamps');
  }
  if (endedAt.getTime() < startedAt.getTime()) {
    throw new BadRequestException('endedAt must be greater than or equal to startedAt');
  }

  if (!Number.isInteger(payload.durationSeconds) || payload.durationSeconds < 0) {
    throw new BadRequestException('durationSeconds must be a nonnegative integer.');
  }

  return {
    sessionId: payload.sessionId,
    startedAt,
    endedAt,
    durationSeconds: payload.durationSeconds,
    progressDelta: nullableNumber(payload.progressDelta, 'progressDelta'),
    endProgress: nullableNumberInRange(payload.endProgress ?? null, 'endProgress', 0, 100),
  };
}

function validateScope(mediaType: string, remoteId: string): { mediaType: WarehouseMediaType; remoteId: string } {
  const normalizedMediaType = mediaType.trim();
  if (!VALID_MEDIA_TYPES.includes(normalizedMediaType as WarehouseMediaType)) {
    throw new BadRequestException('mediaType must be ebook, audiobook, or comic.');
  }

  const normalizedRemoteId = remoteId.trim();
  if (!normalizedRemoteId) {
    throw new BadRequestException('remoteId is required.');
  }

  return {
    mediaType: normalizedMediaType as WarehouseMediaType,
    remoteId: normalizedRemoteId,
  };
}

function validateEbookScope(mediaType: string, remoteId: string): { mediaType: 'ebook'; remoteId: string } {
  const scope = validateScope(mediaType, remoteId);
  if (scope.mediaType !== 'ebook') {
    throw new BadRequestException('Annotations are only supported for ebook library items.');
  }
  return { mediaType: 'ebook', remoteId: scope.remoteId };
}

function validatePatch(patch: unknown): WarehouseUserStatePatch {
  if (!isPatchObject(patch)) {
    throw new BadRequestException('State update must be an object.');
  }

  const safePatch: WarehouseUserStatePatch = {};

  if ('inLibrary' in patch) {
    if (typeof patch.inLibrary !== 'boolean') {
      throw new BadRequestException('inLibrary must be a boolean.');
    }
    safePatch.inLibrary = patch.inLibrary;
  }

  if ('favorite' in patch) {
    if (typeof patch.favorite !== 'boolean') {
      throw new BadRequestException('favorite must be a boolean.');
    }
    safePatch.favorite = patch.favorite;
  }

  if ('rating' in patch) {
    safePatch.rating = nullableNumberInRange(patch.rating, 'rating', 1, 5);
    if (safePatch.rating !== null && !Number.isInteger(safePatch.rating)) {
      throw new BadRequestException('rating must be an integer.');
    }
  }

  if ('readStatus' in patch) {
    if (patch.readStatus !== null && !VALID_READ_STATUSES.includes(patch.readStatus as WarehouseUserReadStatus)) {
      throw new BadRequestException('readStatus must be a valid read status.');
    }
    safePatch.readStatus = patch.readStatus;
  }

  if ('progressPercent' in patch) {
    safePatch.progressPercent = nullableNumberInRange(patch.progressPercent, 'progressPercent', 0, 100);
  }

  if ('positionSeconds' in patch) {
    safePatch.positionSeconds = nullableNonnegativeNumber(patch.positionSeconds, 'positionSeconds');
  }

  return safePatch;
}

function validateBookmarkPayload(payload: unknown): Required<Pick<WarehouseCatalogBookmarkCreatePayload, 'title'>> & {
  cfi: string | null;
  positionSeconds: number | null;
} {
  if (!isBookmarkPayloadObject(payload)) {
    throw new BadRequestException('Bookmark must be an object.');
  }

  if (typeof payload.title !== 'string' || payload.title.length === 0 || payload.title.length > 500) {
    throw new BadRequestException('title must be a non-empty string up to 500 characters.');
  }

  let cfi: string | null = null;
  if ('cfi' in payload && payload.cfi !== undefined) {
    if (typeof payload.cfi !== 'string' || payload.cfi.length === 0 || payload.cfi.length > 2000) {
      throw new BadRequestException('cfi must be a non-empty string up to 2000 characters.');
    }
    cfi = payload.cfi;
  }

  let positionSeconds: number | null = null;
  if ('positionSeconds' in payload && payload.positionSeconds !== undefined) {
    positionSeconds = nullableNonnegativeNumber(payload.positionSeconds, 'positionSeconds');
  }

  if (cfi === null && positionSeconds === null) {
    throw new BadRequestException('Either cfi or positionSeconds must be provided.');
  }

  return { cfi, title: payload.title, positionSeconds };
}

function validateAnnotationPayload(payload: unknown): Required<Pick<WarehouseCatalogAnnotationCreatePayload, 'cfi' | 'text' | 'color' | 'style'>> & {
  note: string | null;
  chapterTitle: string | null;
} {
  if (!isAnnotationPayloadObject(payload)) {
    throw new BadRequestException('Annotation must be an object.');
  }

  const cfi = nonemptyString(payload.cfi, 'cfi', 2000);
  const text = nonemptyString(payload.text, 'text', 20_000);
  const color = nonemptyString(payload.color, 'color', 32);
  const style = nonemptyString(payload.style, 'style', 32);
  if (!VALID_ANNOTATION_STYLES.includes(style as (typeof VALID_ANNOTATION_STYLES)[number])) {
    throw new BadRequestException('style must be a valid annotation style.');
  }

  return {
    cfi,
    text,
    color,
    style,
    note: nullableString(payload.note, 'note', 20_000),
    chapterTitle: nullableString(payload.chapterTitle, 'chapterTitle', 500),
  };
}

function validateAnnotationUpdatePayload(payload: unknown): string | null {
  if (!isAnnotationUpdatePayloadObject(payload)) {
    throw new BadRequestException('Annotation update must be an object.');
  }
  if (!('note' in payload)) {
    throw new BadRequestException('note is required.');
  }
  return nullableString(payload.note, 'note', 20_000);
}

function nullableNumberInRange(value: number | null | undefined, field: string, min: number, max: number): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new BadRequestException(`${field} must be between ${min} and ${max}.`);
  }

  return value;
}

function nullableNumber(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`${field} must be a number.`);
  }
  return value;
}

function isPatchObject(patch: unknown): patch is RawWarehouseUserCatalogStatePatch {
  return typeof patch === 'object' && patch !== null && !Array.isArray(patch);
}

function isBookmarkPayloadObject(payload: unknown): payload is WarehouseCatalogBookmarkCreatePayload & Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

function isAnnotationPayloadObject(payload: unknown): payload is WarehouseCatalogAnnotationCreatePayload & Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

function isAnnotationUpdatePayloadObject(payload: unknown): payload is WarehouseCatalogAnnotationUpdatePayload & Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

function nonemptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new BadRequestException(`${field} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value;
}

function nullableString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new BadRequestException(`${field} must be a string up to ${maxLength} characters.`);
  }
  return value;
}

function nullableNonnegativeNumber(value: number | null | undefined, field: string): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BadRequestException(`${field} must be greater than or equal to 0.`);
  }

  return value;
}

function mapUserCatalogState(row: WarehouseUserCatalogStateRow): WarehouseUserCatalogState {
  return {
    mediaType: row.mediaType,
    remoteId: row.remoteId,
    inLibrary: row.inLibrary,
    favorite: row.favorite,
    rating: row.rating,
    readStatus: row.readStatus,
    progressPercent: row.progressPercent,
    positionSeconds: row.positionSeconds,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

function mapCatalogBookmark(row: WarehouseCatalogBookmarkRow): WarehouseCatalogBookmark {
  return {
    id: row.id,
    mediaType: row.mediaType,
    remoteId: row.remoteId,
    cfi: row.cfi ?? null,
    title: row.title,
    positionSeconds: row.positionSeconds ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapCatalogAnnotation(row: WarehouseCatalogAnnotationRow): WarehouseCatalogAnnotation {
  return {
    id: row.id,
    mediaType: row.mediaType,
    remoteId: row.remoteId,
    cfi: row.cfi,
    text: row.text,
    color: row.color,
    style: row.style,
    note: row.note ?? null,
    chapterTitle: row.chapterTitle ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
