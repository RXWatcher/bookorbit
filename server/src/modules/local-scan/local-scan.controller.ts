import { Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { LocalScanService } from './local-scan.service';
import type { LocalScanSummary } from './local-scan.types';

@Controller('local-scan')
@RequirePermission(Permission.ManageLibraries)
export class LocalScanController {
  constructor(private readonly localScanService: LocalScanService) {}

  @Post('scan')
  scanAll(): Promise<LocalScanSummary[]> {
    return this.localScanService.scanAll();
  }

  @Post('roots/:id/scan')
  scanRoot(@Param('id', ParseIntPipe) id: number): Promise<LocalScanSummary> {
    return this.localScanService.scanRoot(id);
  }
}
