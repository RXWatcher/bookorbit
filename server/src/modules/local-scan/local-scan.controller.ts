import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { LocalScanService } from './local-scan.service';

@Controller('local-scan')
@RequirePermission(Permission.ManageLibraries)
export class LocalScanController {
  constructor(private readonly localScanService: LocalScanService) {}

  @Get('roots')
  getStatuses() {
    return this.localScanService.getStatuses();
  }

  // A full walk takes minutes (about 4 for the audiobook root), which no HTTP client or
  // reverse proxy will wait for, so the run is detached and its outcome is polled from
  // GET roots instead.
  @Post('scan')
  @HttpCode(HttpStatus.ACCEPTED)
  scanAll(): { started: true } {
    this.localScanService.runAllInBackground();
    return { started: true };
  }

  @Post('roots/:id/scan')
  @HttpCode(HttpStatus.ACCEPTED)
  async scanRoot(@Param('id', ParseIntPipe) id: number): Promise<{ started: true; rootId: number }> {
    await this.localScanService.assertScannable(id);
    this.localScanService.runInBackground(id);
    return { started: true, rootId: id };
  }
}
