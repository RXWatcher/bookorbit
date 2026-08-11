import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

import { decodeAbsItemId, decodeAbsLibraryId, encodeAbsCatalogItemId, encodeAbsLibraryId, encodeAbsLocalBookItemId } from './abs-id-codec';

describe('abs-id-codec', () => {
  it('encodes and decodes local library IDs', () => {
    expect(encodeAbsLibraryId(12)).toBe('lib_l_12');
    expect(decodeAbsLibraryId('lib_l_12')).toEqual({ libraryId: 12, source: 'local' });
  });

  it('encodes and decodes warehouse library aliases without exposing negative IDs', () => {
    expect(encodeAbsLibraryId(CLOUD_EBOOK_LIBRARY_ID)).toBe('lib_bw_ebook');
    expect(encodeAbsLibraryId(CLOUD_AUDIO_LIBRARY_ID)).toBe('lib_bw_audio');
    expect(encodeAbsLibraryId(CLOUD_COMIC_LIBRARY_ID)).toBe('lib_bw_comic');
    expect(decodeAbsLibraryId('lib_bw_audio')).toEqual({ libraryId: CLOUD_AUDIO_LIBRARY_ID, source: 'warehouse', mediaType: 'audiobook' });
    expect(decodeAbsLibraryId('lib_bw_ebook')).toEqual({ libraryId: CLOUD_EBOOK_LIBRARY_ID, source: 'warehouse', mediaType: 'ebook' });
    expect(decodeAbsLibraryId('lib_bw_comic')).toEqual({ libraryId: CLOUD_COMIC_LIBRARY_ID, source: 'warehouse', mediaType: 'comic' });
  });

  it('encodes and decodes local book item IDs', () => {
    expect(encodeAbsLocalBookItemId(12, 345)).toBe('bo_l_12_book_345');
    expect(decodeAbsItemId('bo_l_12_book_345')).toEqual({ libraryId: 12, kind: 'book', bookId: 345, source: 'local' });
  });

  it('encodes and decodes warehouse catalog item IDs', () => {
    expect(encodeAbsCatalogItemId(CLOUD_AUDIO_LIBRARY_ID, 789)).toBe('bo_bw_audio_catalog_789');
    expect(decodeAbsItemId('bo_bw_audio_catalog_789')).toEqual({
      libraryId: CLOUD_AUDIO_LIBRARY_ID,
      kind: 'catalog',
      catalogItemId: 789,
      mediaType: 'audiobook',
      source: 'warehouse',
    });
    expect(encodeAbsCatalogItemId(CLOUD_EBOOK_LIBRARY_ID, 456)).toBe('bo_bw_ebook_catalog_456');
    expect(decodeAbsItemId('bo_bw_ebook_catalog_456')).toEqual({
      libraryId: CLOUD_EBOOK_LIBRARY_ID,
      kind: 'catalog',
      catalogItemId: 456,
      mediaType: 'ebook',
      source: 'warehouse',
    });
  });

  it('rejects placeholder, malformed, and mismatched IDs', () => {
    expect(() => decodeAbsItemId('0')).toThrow('Invalid ABS item ID');
    expect(() => decodeAbsItemId('bo_l_1_book_0')).toThrow('Invalid ABS item ID');
    expect(() => decodeAbsItemId('bo_bw_audio_book_7')).toThrow('Invalid ABS item ID');
    expect(() => decodeAbsLibraryId('lib_-2')).toThrow('Invalid ABS library ID');
  });
});
