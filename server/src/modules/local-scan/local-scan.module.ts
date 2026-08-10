import { Module } from '@nestjs/common';

import { LocalEnrichService } from './local-enrich.service';
import { LocalScanController } from './local-scan.controller';
import { LocalScanRepository } from './local-scan.repository';
import { LocalScanService } from './local-scan.service';

@Module({
  controllers: [LocalScanController],
  providers: [LocalScanService, LocalEnrichService, LocalScanRepository],
  exports: [LocalScanService, LocalEnrichService],
})
export class LocalScanModule {}
