import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { BookQuery } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { LoginDto } from '../auth/dto/login.dto';
import { BookQueryPipe } from '../book/pipes/book-query.pipe';
import type { AbsPingResponse, AbsStatusResponse } from './dto';
import { AudiobookshelfCompatService } from './audiobookshelf-compat.service';

const ONE_MINUTE_MS = 60_000;

@Controller()
export class AudiobookshelfCompatController {
  private readonly bookQueryPipe = new BookQueryPipe();

  constructor(private readonly compatService: AudiobookshelfCompatService) {}

  @Get('ping')
  @Public()
  ping(): AbsPingResponse {
    return { success: true };
  }

  @Get('status')
  @Public()
  status(): Promise<AbsStatusResponse> {
    return this.compatService.getStatus();
  }

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginDto, @Req() req: FastifyRequest) {
    return this.compatService.login(body, req.ip);
  }

  @Get('api/libraries')
  listLibraries(@CurrentUser() user: RequestUser) {
    return this.compatService.listLibraries(user);
  }

  @Get('api/libraries/:libraryId/items')
  listLibraryItems(@Param('libraryId') libraryId: string, @Query() query: Record<string, unknown>, @CurrentUser() user: RequestUser) {
    return this.compatService.listLibraryItems(user, libraryId, this.parseBookQuery(query));
  }

  @Get('api/items/:itemId')
  getItem(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser) {
    return this.compatService.getItem(user, itemId);
  }

  @Get('api/items/:itemId/cover')
  getCover(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    return this.compatService.pipeCover(user, itemId, reply);
  }

  @Get('api/items/:itemId/download')
  download(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply, @Headers('range') range?: string) {
    return this.compatService.pipeDownload(user, itemId, range, reply);
  }

  @Post('api/items/:itemId/play')
  @HttpCode(HttpStatus.OK)
  play(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser) {
    return this.compatService.play(user, itemId);
  }

  @Get('api/items/:itemId/tracks/:trackId/stream')
  streamTrack(
    @Param('itemId') itemId: string,
    @Param('trackId') trackId: string,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Headers('range') range?: string,
  ) {
    return this.compatService.pipeTrack(user, itemId, trackId, range, reply);
  }

  @Post('api/items/:itemId/progress')
  postProgress(@Param('itemId') itemId: string, @Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.compatService.updateProgress(user, itemId, body);
  }

  @Patch('api/items/:itemId/progress')
  @HttpCode(HttpStatus.OK)
  patchProgress(@Param('itemId') itemId: string, @Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.compatService.updateProgress(user, itemId, body);
  }

  @Post('api/session/local')
  syncLocalSession(@Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.compatService.syncLocalSession(user, body);
  }

  @Post('api/session/local-all')
  syncLocalSessions(@Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.compatService.syncLocalSessions(user, body);
  }

  private parseBookQuery(query: Record<string, unknown>): BookQuery {
    return this.bookQueryPipe.transform({
      ...query,
      collapseSeries: this.parseBoolean(query.collapseSeries),
      filter: this.parseJsonValue(query.filter),
      sort: this.parseJsonValue(query.sort),
      pagination: this.parsePagination(query),
    });
  }

  private parsePagination(query: Record<string, unknown>) {
    const parsed = this.parseJsonValue(query.pagination);
    if (this.isObjectRecord(parsed)) {
      return {
        page: this.parseNumber(parsed.page),
        size: this.parseNumber(parsed.size),
      };
    }

    return {
      page: this.parseNumber(query.page),
      size: this.parseNumber(query.size ?? query.limit),
    };
  }

  private parseJsonValue(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new BadRequestException('Invalid JSON query parameter');
    }
  }

  private parseBoolean(value: unknown): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }

  private parseNumber(value: unknown): unknown {
    if (typeof value !== 'string' || value.trim() === '') return value;
    return Number(value);
  }

  private isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
