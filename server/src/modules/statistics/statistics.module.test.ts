import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { StatisticsController } from './statistics.controller';
import { StatisticsModule } from './statistics.module';
import { StatisticsRepository } from './statistics.repository';
import { StatisticsService } from './statistics.service';
import { LibraryModule } from '../library/library.module';
import { WarehouseModule } from '../warehouse/warehouse.module';

describe('StatisticsModule', () => {
  it('registers controller and providers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, StatisticsModule)).toEqual([LibraryModule, WarehouseModule]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, StatisticsModule)).toEqual([StatisticsController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StatisticsModule)).toEqual([StatisticsService, StatisticsRepository]);
  });
});
