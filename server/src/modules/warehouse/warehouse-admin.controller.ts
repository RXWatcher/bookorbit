import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';

import { RequireSuperuser } from '../../common/decorators/require-superuser.decorator';
import { UpsertWarehouseAdminSettingsDto } from './dto';
import { WarehouseCatalogCoverCacheService } from './warehouse-catalog-cover-cache.service';
import { WarehouseCatalogService } from './warehouse-catalog.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseSettingsService } from './warehouse-settings.service';

@RequireSuperuser()
@Controller('admin/warehouse')
export class WarehouseAdminController {
  constructor(
    private readonly settings: WarehouseSettingsService,
    private readonly catalogSync: WarehouseCatalogSyncService,
    private readonly coverCache: WarehouseCatalogCoverCacheService,
    private readonly catalog: WarehouseCatalogService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.getAdminSettings();
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpsertWarehouseAdminSettingsDto) {
    return this.settings.upsertAdminSettings(dto);
  }

  @Post('test-connection')
  testConnection() {
    return this.settings.testConnection();
  }

  @Get('catalog-sync')
  getCatalogSyncState() {
    return this.catalogSync.getSyncState();
  }

  @Get('cache-status')
  getCacheStatus() {
    return this.coverCache.getStatus();
  }

  @Post('cache/clear')
  clearCache() {
    return this.coverCache.clear();
  }

  @Post('catalog-sync/ebooks')
  syncEbooks() {
    return this.catalogSync.syncEbooks();
  }

  @Post('catalog-sync/audiobooks')
  syncAudiobooks() {
    return this.catalogSync.syncAudiobooks();
  }

  @Post('catalog-sync/comics')
  syncComics() {
    return this.catalogSync.syncComics();
  }

  @Post('catalog-sync/all')
  syncAll() {
    return this.catalogSync.syncAll();
  }

  /**
   * Backfill warehouse detail (genres, narrators, chapters) for audiobooks
   * that have none.
   *
   * Bounded per call and resumable, so it is driven by repeated calls rather
   * than one long request — the catalogue is ~184,000 audiobooks and the
   * warehouse also serves live reads.
   *
   * Check `stalled` in the response: true means details were fetched but no
   * item gained a genre or narrator, which has happened before and means
   * something is silently dropping the data. Stop and investigate rather than
   * calling again.
   */
  @Post('catalog-detail-backfill/audiobooks')
  backfillAudiobookDetails(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.catalog.backfillAudiobookDetails(Math.min(Math.max(limit, 1), 500));
  }

  /** The ebook counterpart. Same contract, including `stalled`. */
  @Post('catalog-detail-backfill/ebooks')
  backfillEbookDetails(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.catalog.backfillEbookDetails(Math.min(Math.max(limit, 1), 500));
  }
}
