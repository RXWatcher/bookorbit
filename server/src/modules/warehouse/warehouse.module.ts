import { Module, forwardRef } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { NotificationModule } from '../notification/notification.module';
import { WarehouseAdminController } from './warehouse-admin.controller';
import { WarehouseCatalogController, WarehouseComicApiController, WarehouseLibraryMediaController } from './warehouse-catalog.controller';
import { WarehouseCatalogCoverCacheService } from './warehouse-catalog-cover-cache.service';
import { WarehouseCatalogService } from './warehouse-catalog.service';
import { WarehouseCatalogSyncService } from './warehouse-catalog-sync.service';
import { WarehouseClientService } from './warehouse-client.service';
import { WarehouseRequestController } from './warehouse-request.controller';
import { WarehouseRequestService } from './warehouse-request.service';
import { WarehouseRequestSyncJob } from './warehouse-request-sync.job';
import { WarehouseRequestSyncService } from './warehouse-request-sync.service';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseSecretService } from './warehouse-secret.service';
import { WarehouseSettingsService } from './warehouse-settings.service';
import { WarehouseUserStateController } from './warehouse-user-state.controller';
import { WarehouseUserStateService } from './warehouse-user-state.service';

import { LocalScanModule } from '../local-scan/local-scan.module';

@Module({
  imports: [forwardRef(() => LocalScanModule), NotificationModule, AchievementModule],
  controllers: [
    WarehouseAdminController,
    WarehouseCatalogController,
    WarehouseLibraryMediaController,
    WarehouseComicApiController,
    WarehouseRequestController,
    WarehouseUserStateController,
  ],
  providers: [
    WarehouseClientService,
    WarehouseRepository,
    WarehouseSecretService,
    WarehouseSettingsService,
    WarehouseCatalogCoverCacheService,
    WarehouseCatalogSyncService,
    WarehouseCatalogService,
    WarehouseRequestService,
    WarehouseRequestSyncJob,
    WarehouseRequestSyncService,
    WarehouseUserStateService,
  ],
  exports: [
    WarehouseClientService,
    WarehouseRepository,
    WarehouseSettingsService,
    WarehouseCatalogCoverCacheService,
    WarehouseCatalogSyncService,
    WarehouseCatalogService,
    WarehouseRequestService,
    WarehouseRequestSyncService,
    WarehouseUserStateService,
  ],
})
export class WarehouseModule {}
