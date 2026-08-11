import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID } from '@bookorbit/types';
import type { BookCard, DashboardCatalogItem, LibraryBookItem } from '@bookorbit/types';
import type { WarehouseCatalogItemRow } from '../../db/schema';

import { decodeWarehouseBookId } from '../warehouse/warehouse-book-card.mapper';
import { encodeAbsCatalogItemId, encodeAbsLibraryId, encodeAbsLocalBookItemId } from './abs-id-codec';

type AbsItemMediaType = 'book' | 'audiobook' | 'comic';

export type AbsItemMetadata = {
  title: string | null;
  subtitle: string | null;
  authors: string[];
  narrators: string[];
};

export type AbsLibraryItem = {
  id: string;
  libraryId: string;
  mediaType: AbsItemMediaType;
  metadata: AbsItemMetadata;
  coverPath: string | null;
  duration?: number | null;
};

type LocalBookLike = {
  id: number;
  title: string | null;
  subtitle?: string | null;
  authors: string[];
  narrators?: string[];
  hasCover?: boolean | null;
  coverSource?: 'extracted' | 'custom' | null;
};

type CatalogItemLike = Pick<WarehouseCatalogItemRow, 'id' | 'title' | 'subtitle' | 'authors' | 'narrators' | 'durationSeconds' | 'hasCover'>;

type AbsLibraryItemsPageInput = {
  items: LibraryBookItem[];
  total: number;
  page: number;
  size?: number;
  limit?: number;
};

export class AbsItemMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbsItemMappingError';
  }
}

export function mapAbsLocalBookItem(libraryId: number, book: LocalBookLike): AbsLibraryItem {
  const id = encodeAbsLocalBookItemId(libraryId, book.id);

  return {
    id,
    libraryId: encodeAbsLibraryId(libraryId),
    mediaType: 'book',
    metadata: {
      title: book.title,
      subtitle: book.subtitle ?? null,
      authors: book.authors,
      narrators: book.narrators ?? [],
    },
    coverPath: book.hasCover || book.coverSource ? `/api/items/${id}/cover` : null,
  };
}

export function mapAbsCatalogItem(libraryId: number, item: CatalogItemLike): AbsLibraryItem {
  const id = encodeAbsCatalogItemId(libraryId, item.id);

  return {
    id,
    libraryId: encodeAbsLibraryId(libraryId),
    mediaType: mediaTypeForLibrary(libraryId),
    metadata: {
      title: item.title,
      subtitle: item.subtitle ?? null,
      authors: item.authors,
      narrators: item.narrators,
    },
    duration: item.durationSeconds ?? null,
    coverPath: item.hasCover ? `/api/items/${id}/cover` : null,
  };
}

export function mapAbsLibraryItemsPage(libraryId: number, page: AbsLibraryItemsPageInput) {
  return {
    results: page.items.map((item) => {
      if (isWarehouseCatalogBookCard(item)) {
        const decoded = decodeWarehouseBookId(item.id);
        if (!decoded) {
          throw new AbsItemMappingError('Invalid source-backed library item');
        }

        return mapAbsCatalogItem(libraryId, {
          id: decoded.catalogItemId,
          title: item.title ?? '',
          subtitle: item.subtitle ?? null,
          authors: item.authors,
          narrators: item.narrators,
          durationSeconds: item.durationSeconds ?? null,
          hasCover: item.hasCover,
        });
      }

      if (isCatalogLibraryItem(item)) {
        throw new AbsItemMappingError('Catalog dashboard items cannot be mapped to ABS item IDs');
      }

      return mapAbsLocalBookItem(libraryId, item);
    }),
    total: page.total,
    page: page.page,
    limit: page.size ?? page.limit ?? 0,
  };
}

function isCatalogLibraryItem(item: LibraryBookItem): item is DashboardCatalogItem {
  return 'type' in item && item.type === 'catalog-item';
}

function isWarehouseCatalogBookCard(item: LibraryBookItem): item is BookCard & { catalogSource: NonNullable<BookCard['catalogSource']> } {
  return 'catalogSource' in item && item.catalogSource !== null && item.catalogSource !== undefined;
}

function mediaTypeForLibrary(libraryId: number): AbsItemMediaType {
  if (libraryId === CLOUD_AUDIO_LIBRARY_ID) return 'audiobook';
  if (libraryId === CLOUD_COMIC_LIBRARY_ID) return 'comic';
  return 'book';
}
