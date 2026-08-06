import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import type { WarehouseMediaType } from '@bookorbit/types';

type AbsWarehouseMediaAlias = 'ebook' | 'audio' | 'comic';

export type DecodedAbsLibraryId = { libraryId: number; source: 'local' } | { libraryId: number; source: 'warehouse'; mediaType: WarehouseMediaType };

export type DecodedAbsItemId =
  | { libraryId: number; source: 'local'; kind: 'book'; bookId: number }
  | { libraryId: number; source: 'warehouse'; kind: 'catalog'; catalogItemId: number; mediaType: WarehouseMediaType };

const MEDIA_ALIAS_BY_LIBRARY_ID = new Map<number, AbsWarehouseMediaAlias>([
  [CLOUD_EBOOK_LIBRARY_ID, 'ebook'],
  [CLOUD_AUDIO_LIBRARY_ID, 'audio'],
  [CLOUD_COMIC_LIBRARY_ID, 'comic'],
]);

const LIBRARY_ID_BY_MEDIA_ALIAS = new Map<AbsWarehouseMediaAlias, number>([
  ['ebook', CLOUD_EBOOK_LIBRARY_ID],
  ['audio', CLOUD_AUDIO_LIBRARY_ID],
  ['comic', CLOUD_COMIC_LIBRARY_ID],
]);

const MEDIA_TYPE_BY_ALIAS: Record<AbsWarehouseMediaAlias, WarehouseMediaType> = {
  ebook: 'ebook',
  audio: 'audiobook',
  comic: 'comic',
};

export function encodeAbsLibraryId(libraryId: number): string {
  const alias = MEDIA_ALIAS_BY_LIBRARY_ID.get(libraryId);
  if (alias) return `lib_bw_${alias}`;
  if (!Number.isInteger(libraryId) || libraryId <= 0) throw new Error('Invalid ABS library ID');
  return `lib_l_${libraryId}`;
}

export function decodeAbsLibraryId(value: string): DecodedAbsLibraryId {
  const localMatch = /^lib_l_([1-9]\d*)$/.exec(value);
  if (localMatch) return { libraryId: Number(localMatch[1]), source: 'local' };

  const warehouseMatch = /^lib_bw_(ebook|audio|comic)$/.exec(value);
  if (warehouseMatch) {
    const alias = warehouseMatch[1] as AbsWarehouseMediaAlias;
    return { libraryId: LIBRARY_ID_BY_MEDIA_ALIAS.get(alias)!, source: 'warehouse', mediaType: MEDIA_TYPE_BY_ALIAS[alias] };
  }

  throw new Error('Invalid ABS library ID');
}

export function encodeAbsLocalBookItemId(libraryId: number, bookId: number): string {
  if (!Number.isInteger(libraryId) || libraryId <= 0 || !Number.isInteger(bookId) || bookId <= 0) throw new Error('Invalid ABS item ID');
  return `bo_l_${libraryId}_book_${bookId}`;
}

export function encodeAbsCatalogItemId(libraryId: number, catalogItemId: number): string {
  const alias = MEDIA_ALIAS_BY_LIBRARY_ID.get(libraryId);
  if (!alias || !Number.isInteger(catalogItemId) || catalogItemId <= 0) throw new Error('Invalid ABS item ID');
  return `bo_bw_${alias}_catalog_${catalogItemId}`;
}

export function decodeAbsItemId(value: string): DecodedAbsItemId {
  const localMatch = /^bo_l_([1-9]\d*)_book_([1-9]\d*)$/.exec(value);
  if (localMatch) return { libraryId: Number(localMatch[1]), source: 'local', kind: 'book', bookId: Number(localMatch[2]) };

  const catalogMatch = /^bo_bw_(ebook|audio|comic)_catalog_([1-9]\d*)$/.exec(value);
  if (catalogMatch) {
    const alias = catalogMatch[1] as AbsWarehouseMediaAlias;
    return {
      libraryId: LIBRARY_ID_BY_MEDIA_ALIAS.get(alias)!,
      source: 'warehouse',
      kind: 'catalog',
      catalogItemId: Number(catalogMatch[2]),
      mediaType: MEDIA_TYPE_BY_ALIAS[alias],
    };
  }

  throw new Error('Invalid ABS item ID');
}
