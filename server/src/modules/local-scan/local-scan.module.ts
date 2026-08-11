import { Module, forwardRef } from '@nestjs/common';

import { WarehouseModule } from '../warehouse/warehouse.module';

import { LocalContentService } from './local-content.service';
import { LocalEnrichService } from './local-enrich.service';
import { LocalScanController } from './local-scan.controller';
import { LocalScanRepository } from './local-scan.repository';
import { LocalScanService } from './local-scan.service';

@Module({
  imports: [forwardRef(() => WarehouseModule)],
  controllers: [LocalScanController],
  providers: [LocalScanService, LocalEnrichService, LocalContentService, LocalScanRepository],
  exports: [LocalScanService, LocalEnrichService, LocalContentService],
})
export class LocalScanModule {}
