import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { ReadingSessionModule } from '../reading-session/reading-session.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { AbsAssetService } from './abs-asset.service';
import { AudiobookshelfCompatController } from './audiobookshelf-compat.controller';
import { AudiobookshelfCompatService } from './audiobookshelf-compat.service';

@Module({
  imports: [AuthModule, LibraryModule, BookModule, WarehouseModule, ReadingSessionModule],
  controllers: [AudiobookshelfCompatController],
  providers: [AudiobookshelfCompatService, AbsAssetService],
})
export class AudiobookshelfCompatModule {}
