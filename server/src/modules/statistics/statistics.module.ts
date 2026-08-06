import { Module } from '@nestjs/common';

import { LibraryModule } from '../library/library.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { StatisticsController } from './statistics.controller';
import { StatisticsRepository } from './statistics.repository';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [LibraryModule, WarehouseModule],
  controllers: [StatisticsController],
  providers: [StatisticsService, StatisticsRepository],
})
export class StatisticsModule {}
