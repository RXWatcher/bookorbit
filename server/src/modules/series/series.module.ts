import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { SeriesController } from './series.controller';
import { SeriesRepository } from './series.repository';
import { SeriesService } from './series.service';

@Module({
  imports: [BookModule, LibraryModule, WarehouseModule],
  controllers: [SeriesController],
  providers: [SeriesService, SeriesRepository],
  exports: [SeriesService],
})
export class SeriesModule {}
