import { Module } from '@nestjs/common';

import { WarehouseModule } from '../warehouse/warehouse.module';
import { BookSearchController } from './book-search.controller';
import { BookSearchService } from './book-search.service';
import { BookSearchSettingsService } from './book-search.settings';
import { MeilisearchProvider } from './meilisearch.provider';
import { SearchIndexRepository } from './search-index.repository';
import { SearchIndexerService } from './search-indexer.service';
import { SqlSearchProvider } from './sql-search.provider';

@Module({
  imports: [WarehouseModule],
  controllers: [BookSearchController],
  providers: [BookSearchSettingsService, MeilisearchProvider, SqlSearchProvider, SearchIndexRepository, SearchIndexerService, BookSearchService],
  exports: [BookSearchService],
})
export class BookSearchModule {}
