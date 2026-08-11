import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/types/request-user';
import { CbzService } from './cbz.service';

@Controller('cbz')
export class CbzController {
  constructor(private readonly cbzService: CbzService) {}

  @Get('files/:fileId/pages')
  async getPageCount(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser) {
    return { pageCount: await this.cbzService.getPageCount(fileId, user) };
  }

  @Get('files/:fileId/pages/:pageIndex')
  async getPage(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Param('pageIndex', ParseIntPipe) pageIndex: number,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    const { stream, mimeType } = await this.cbzService.streamPage(fileId, pageIndex, user);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.type(mimeType);
    reply.send(stream);
  }

  @Get('catalog/ebooks/:remoteId/pages')
  async getCatalogPageCount(@Param('remoteId') remoteId: string, @Query('format') format: string, @CurrentUser() user: RequestUser) {
    return { pageCount: await this.cbzService.getCatalogPageCount(remoteId, format ?? '', user) };
  }

  @Get('catalog/ebooks/:remoteId/pages/:pageIndex')
  async getCatalogPage(
    @Param('remoteId') remoteId: string,
    @Param('pageIndex', ParseIntPipe) pageIndex: number,
    @Query('format') format: string,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    const { stream, mimeType } = await this.cbzService.streamCatalogPage(remoteId, format ?? '', pageIndex, user);
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.type(mimeType);
    reply.send(stream);
  }
}
