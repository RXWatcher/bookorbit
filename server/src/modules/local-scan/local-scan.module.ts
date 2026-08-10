import { Module } from '@nestjs/common';

import { LocalScanController } from './local-scan.controller';
import { LocalScanRepository } from './local-scan.repository';
import { LocalScanService } from './local-scan.service';

@Module({
  controllers: [LocalScanController],
  providers: [LocalScanService, LocalScanRepository],
  exports: [LocalScanService],
})
export class LocalScanModule {}
