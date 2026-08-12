import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, type WarehouseMediaType } from '@bookorbit/types';

/**
 * The source-backed (warehouse) libraries are virtual: they have no `libraries` row and carry
 * negative ids, one per media type. Everything positive is a real filesystem-backed library.
 *
 * This matters to the ABS adapter because `findAccessibleLibraryIds` only knows native libraries,
 * so an access check that consults it alone would reject every warehouse library.
 */
export function isSourceBackedLibraryId(id: number): boolean {
  return id === CLOUD_EBOOK_LIBRARY_ID || id === CLOUD_AUDIO_LIBRARY_ID || id === CLOUD_COMIC_LIBRARY_ID;
}

/** Media type a virtual library holds, or null when the id is not a source-backed library. */
export function mediaTypeForSourceBackedLibrary(id: number): WarehouseMediaType | null {
  if (id === CLOUD_EBOOK_LIBRARY_ID) return 'ebook';
  if (id === CLOUD_AUDIO_LIBRARY_ID) return 'audiobook';
  if (id === CLOUD_COMIC_LIBRARY_ID) return 'comic';
  return null;
}
