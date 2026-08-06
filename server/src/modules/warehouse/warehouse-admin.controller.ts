import { Body, Controller, Get, Patch, Post } from '@nestjs/common';

import { RequireSuperuser } from '../../common/decorators/require-superuser.decorator';
import { UpsertWarehouseAdminSettingsDto } from './dto';
import { WarehouseCatalogCoverCacheService } from './warehouse-catalog-cover-cache.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseSettingsService } from './warehouse-settings.service';

@RequireSuperuser()
@Controller('admin/warehouse')
export class WarehouseAdminController {
  constructor(
    private readonly settings: WarehouseSettingsService,
    private readonly catalogSync: WarehouseCatalogSyncService,
    private readonly coverCache: WarehouseCatalogCoverCacheService,
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
}
