import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import type {
  WarehouseCatalogAnnotationCreatePayload,
  WarehouseCatalogAnnotationUpdatePayload,
  WarehouseCatalogBookmarkCreatePayload,
  WarehouseUserCatalogStatePatch,
} from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import type { SaveReadingSessionDto } from '../reading-session/dto/save-reading-session.dto';
import { WarehouseUserStateService } from './warehouse-user-state.service';

type RawWarehouseUserCatalogStatePatch = WarehouseUserCatalogStatePatch & Record<string, unknown>;

@Controller('catalog/items')
export class WarehouseUserStateController {
  constructor(private readonly userState: WarehouseUserStateService) {}

  @Get(':mediaType/:remoteId/state')
  getState(@CurrentUser() user: RequestUser, @Param('mediaType') mediaType: string, @Param('remoteId') remoteId: string) {
    return this.userState.getState(user, normalizeParam(mediaType), normalizeParam(remoteId));
  }

  @Patch(':mediaType/:remoteId/state')
  async patchState(
    @CurrentUser() user: RequestUser,
    @Param('mediaType') mediaType: string,
    @Param('remoteId') remoteId: string,
    @Body() patch: unknown,
  ) {
    return this.userState.patchState(user, normalizeParam(mediaType), normalizeParam(remoteId), sanitizePatch(patch));
  }

  @Post(':mediaType/:remoteId/sessions')
  @HttpCode(204)
  async saveReadingSession(
    @CurrentUser() user: RequestUser,
    @Param('mediaType') mediaType: string,
    @Param('remoteId') remoteId: string,
    @Body() payload: SaveReadingSessionDto,
  ) {
    await this.userState.saveReadingSession(user, normalizeParam(mediaType), normalizeParam(remoteId), payload);
  }

  @Get(':mediaType/:remoteId/bookmarks')
  getBookmarks(@CurrentUser() user: RequestUser, @Param('mediaType') mediaType: string, @Param('remoteId') remoteId: string) {
    return this.userState.getBookmarks(user, normalizeParam(mediaType), normalizeParam(remoteId));
  }

  @Post(':mediaType/:remoteId/bookmarks')
  createBookmark(
    @CurrentUser() user: RequestUser,
    @Param('mediaType') mediaType: string,
    @Param('remoteId') remoteId: string,
    @Body() payload: unknown,
  ) {
    return this.userState.createBookmark(user, normalizeParam(mediaType), normalizeParam(remoteId), sanitizeBookmarkPayload(payload));
  }

  @Delete(':mediaType/:remoteId/bookmarks/:bookmarkId')
  async deleteBookmark(
    @CurrentUser() user: RequestUser,
    @Param('mediaType') mediaType: string,
    @Param('remoteId') remoteId: string,
    @Param('bookmarkId', ParseIntPipe) bookmarkId: number,
  ) {
    await this.userState.deleteBookmark(user, normalizeParam(mediaType), normalizeParam(remoteId), bookmarkId);
  }

  @Get(':mediaType/:remoteId/annotations')
  getAnnotations(@CurrentUser() user: RequestUser, @Param('mediaType') mediaType: string, @Param('remoteId') remoteId: string) {
    return this.userState.getAnnotations(user, normalizeParam(mediaType), normalizeParam(remoteId));
  }

  @Post(':mediaType/:remoteId/annotations')
  createAnnotation(
    @CurrentUser() user: RequestUser,
    @Param('mediaType') mediaType: string,
    @Param('remoteId') remoteId: string,
    @Body() payload: unknown,
  ) {
    return this.userState.createAnnotation(user, normalizeParam(mediaType), normalizeParam(remoteId), sanitizeAnnotationPayload(payload));
  }

  @Patch(':mediaType/:remoteId/annotations/:annotationId')
  updateAnnotation(
    @CurrentUser() user: RequestUser,
    @Param('mediaType') mediaType: string,
    @Param('remoteId') remoteId: string,
    @Param('annotationId', ParseIntPipe) annotationId: number,
    @Body() payload: unknown,
  ) {
    return this.userState.updateAnnotation(
      user,
      normalizeParam(mediaType),
      normalizeParam(remoteId),
      annotationId,
      sanitizeAnnotationUpdatePayload(payload),
    );
  }

  @Delete(':mediaType/:remoteId/annotations/:annotationId')
  async deleteAnnotation(
    @CurrentUser() user: RequestUser,
    @Param('mediaType') mediaType: string,
    @Param('remoteId') remoteId: string,
    @Param('annotationId', ParseIntPipe) annotationId: number,
  ) {
    await this.userState.deleteAnnotation(user, normalizeParam(mediaType), normalizeParam(remoteId), annotationId);
  }
}

function normalizeParam(value: string): string {
  return value.trim();
}

function sanitizePatch(patch: unknown): WarehouseUserCatalogStatePatch {
  if (!isPatchObject(patch)) {
    throw new BadRequestException('State update must be an object.');
  }

  const safePatch: WarehouseUserCatalogStatePatch = {};

  if ('inLibrary' in patch) safePatch.inLibrary = patch.inLibrary;
  if ('favorite' in patch) safePatch.favorite = patch.favorite;
  if ('rating' in patch) safePatch.rating = patch.rating;
  if ('readStatus' in patch) safePatch.readStatus = patch.readStatus;
  if ('progressPercent' in patch) safePatch.progressPercent = patch.progressPercent;
  if ('positionSeconds' in patch) safePatch.positionSeconds = patch.positionSeconds;

  return safePatch;
}

function isPatchObject(patch: unknown): patch is RawWarehouseUserCatalogStatePatch {
  return typeof patch === 'object' && patch !== null && !Array.isArray(patch);
}

function sanitizeBookmarkPayload(payload: unknown): WarehouseCatalogBookmarkCreatePayload {
  if (!isBookmarkPayloadObject(payload)) {
    throw new BadRequestException('Bookmark must be an object.');
  }

  const safePayload: WarehouseCatalogBookmarkCreatePayload = { title: payload.title };

  if ('cfi' in payload) safePayload.cfi = payload.cfi;
  if ('positionSeconds' in payload) safePayload.positionSeconds = payload.positionSeconds;

  return safePayload;
}

function isBookmarkPayloadObject(payload: unknown): payload is WarehouseCatalogBookmarkCreatePayload & Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

function sanitizeAnnotationPayload(payload: unknown): WarehouseCatalogAnnotationCreatePayload {
  if (!isAnnotationPayloadObject(payload)) {
    throw new BadRequestException('Annotation must be an object.');
  }

  const safePayload: WarehouseCatalogAnnotationCreatePayload = {
    cfi: payload.cfi,
    text: payload.text,
    color: payload.color,
    style: payload.style,
  };

  if ('note' in payload) safePayload.note = payload.note;
  if ('chapterTitle' in payload) safePayload.chapterTitle = payload.chapterTitle;

  return safePayload;
}

function sanitizeAnnotationUpdatePayload(payload: unknown): WarehouseCatalogAnnotationUpdatePayload {
  if (!isAnnotationUpdatePayloadObject(payload)) {
    throw new BadRequestException('Annotation update must be an object.');
  }

  const safePayload: WarehouseCatalogAnnotationUpdatePayload = {};
  if ('note' in payload) safePayload.note = payload.note;
  return safePayload;
}

function isAnnotationPayloadObject(payload: unknown): payload is WarehouseCatalogAnnotationCreatePayload & Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

function isAnnotationUpdatePayloadObject(payload: unknown): payload is WarehouseCatalogAnnotationUpdatePayload & Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}
