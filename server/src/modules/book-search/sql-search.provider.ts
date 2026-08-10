import { Injectable } from '@nestjs/common';
import type { WarehouseMediaType } from '@bookorbit/types';

import { WarehouseRepository } from '../warehouse/warehouse.repository';
import { catalogDocumentId } from './book-search-document.mapper';
import type { BookSearchPage, BookSearchProvider, BookSearchQuery } from './book-search.types';

@Injectable()
export class SqlSearchProvider implements BookSearchProvider {
  readonly name = 'sql' as const;

  constructor(private readonly warehouseRepository: WarehouseRepository) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async search(query: BookSearchQuery): Promise<BookSearchPage> {
    const page = await this.warehouseRepository.queryUserCatalogItems(query.userId, {
      q: query.q,
      page: query.page,
      limit: query.size,
      mediaTypes: query.mediaTypes as WarehouseMediaType[] | undefined,
    });

    return {
      ids: page.rows.map((row) => catalogDocumentId(row.mediaType, row.remoteId)),
      total: page.total,
      page: page.page,
      size: page.limit,
    };
  }
}
