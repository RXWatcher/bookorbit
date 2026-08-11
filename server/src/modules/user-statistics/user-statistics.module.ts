import { Module } from '@nestjs/common';

import { LibraryModule } from '../library/library.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { UserStatisticsAggregationJob } from './user-statistics-aggregation.job';
import { UserStatisticsController } from './user-statistics.controller';
import { UserStatisticsRepository } from './user-statistics.repository';
import { UserStatisticsService } from './user-statistics.service';

@Module({
  imports: [LibraryModule, WarehouseModule],
  controllers: [UserStatisticsController],
  providers: [UserStatisticsService, UserStatisticsRepository, UserStatisticsAggregationJob],
})
export class UserStatisticsModule {}
