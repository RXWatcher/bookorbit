import { Module } from '@nestjs/common';
import { BookModule } from '../../book/book.module';
import { WarehouseModule } from '../../warehouse/warehouse.module';
import { CbzController } from './cbz.controller';
import { CbzService } from './cbz.service';

@Module({
  imports: [BookModule, WarehouseModule],
  controllers: [CbzController],
  providers: [CbzService],
})
export class CbzModule {}
