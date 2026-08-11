import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { WarehouseRequestSyncService, type WarehouseRequestSyncSummary } from './warehouse-request-sync.service';

@Injectable()
export class WarehouseRequestSyncJob {
  private readonly logger = new Logger(WarehouseRequestSyncJob.name);
  private syncRunning = false;

  constructor(private readonly requestSync: WarehouseRequestSyncService) {}

  @Cron('*/5 * * * *')
  async runRequestSync(): Promise<void> {
    if (this.syncRunning) {
      return;
    }

    this.syncRunning = true;
    try {
      const summary = await this.requestSync.syncDueRequests();
      if (shouldLogSummary(summary)) {
        this.logger.log(summaryMessage(summary));
      }
    } catch {
      this.logger.error('Warehouse request sync failed');
    } finally {
      this.syncRunning = false;
    }
  }
}

function shouldLogSummary(summary: WarehouseRequestSyncSummary): boolean {
  return summary.updatedCount > 0 || summary.errorCount > 0;
}

function summaryMessage(summary: WarehouseRequestSyncSummary): string {
  return [
    `Warehouse request sync summary: status=${summary.status}`,
    `scanned=${summary.scannedCount}`,
    `updated=${summary.updatedCount}`,
    `notified=${summary.notifiedCount}`,
    `catalogSyncs=${summary.catalogSyncCount}`,
    `errors=${summary.errorCount}`,
  ].join(', ');
}
