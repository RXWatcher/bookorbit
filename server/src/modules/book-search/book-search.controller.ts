import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, Put } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BookSearchService } from './book-search.service';
import { BookSearchSettingsService } from './book-search.settings';
import { UpdateBookSearchSettingsDto } from './dto/update-book-search-settings.dto';
import { MeilisearchClient } from './meilisearch.client';
import { SearchIndexerService } from './search-indexer.service';

@Controller('book-search')
@RequirePermission(Permission.ManageAppSettings)
export class BookSearchController {
  private readonly logger = new Logger(BookSearchController.name);

  constructor(
    private readonly settings: BookSearchSettingsService,
    private readonly indexer: SearchIndexerService,
    private readonly bookSearch: BookSearchService,
  ) {}

  @Get('settings')
  async getSettings() {
    const settings = await this.settings.get();
    return { ...settings, lastProvider: this.bookSearch.lastProvider() };
  }

  @Put('settings')
  async updateSettings(@Body() dto: UpdateBookSearchSettingsDto) {
    await this.settings.save(dto);
    const settings = await this.settings.get();
    return { ...settings, lastProvider: this.bookSearch.lastProvider() };
  }

  @Post('test')
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const startedAt = Date.now();
    const config = await this.settings.get();

    if (!config.url || !config.hasApiKey) {
      return { ok: false, message: 'Meilisearch is not configured' };
    }

    const apiKey = await this.settings.getApiKey();
    if (!apiKey) {
      return { ok: false, message: 'Meilisearch API key could not be decrypted' };
    }

    const client = new MeilisearchClient({ url: config.url, apiKey });
    const ok = await client.health();

    this.logger.log(`[book_search.test_connection] [end] durationMs=${Date.now() - startedAt} ok=${ok} - connection test completed`);

    return ok ? { ok: true, message: 'Connected' } : { ok: false, message: 'Meilisearch did not respond to a health check' };
  }

  // A full rebuild reindexes upward of 400,000 documents and takes minutes, which no HTTP
  // client or reverse proxy will wait for, so the run is detached and answers immediately.
  @Post('rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  rebuild(): { started: true } {
    this.indexer.rebuildInBackground();
    return { started: true };
  }
}
