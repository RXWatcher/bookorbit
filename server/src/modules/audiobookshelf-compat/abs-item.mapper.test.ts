import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types';

import { mapAbsCatalogItem, mapAbsLibraryItemsPage, mapAbsLocalBookItem, AbsItemMappingError } from './abs-item.mapper';

describe('abs-item.mapper', () => {
  it('maps local books without placeholder IDs', () => {
    const item = mapAbsLocalBookItem(3, {
      id: 55,
      title: 'Dune',
      authors: ['Frank Herbert'],
      hasCover: true,
    } as any);

    expect(item.id).toBe('bo_l_3_book_55');
    expect(item.coverPath).toBe('/api/items/bo_l_3_book_55/cover');
    expect(JSON.stringify(item)).not.toContain('"0"');
  });

  it('maps warehouse catalog rows without remote IDs', () => {
    const item = mapAbsCatalogItem(CLOUD_AUDIO_LIBRARY_ID, {
      id: 77,
      remoteId: 'upstream-secret',
      title: 'Audio Dune',
      authors: ['Frank Herbert'],
      narrators: ['Simon Vance'],
      durationSeconds: 123,
      hasCover: true,
    } as any);

    expect(item.id).toBe('bo_bw_audio_catalog_77');
    expect(item.coverPath).toBe('/api/items/bo_bw_audio_catalog_77/cover');
    expect(JSON.stringify(item)).not.toContain('upstream-secret');
  });

  it('omits coverPath when the compat route cannot serve a cover', () => {
    const local = mapAbsLocalBookItem(3, {
      id: 56,
      title: 'Children of Dune',
      authors: ['Frank Herbert'],
      hasCover: false,
    } as any);
    const catalog = mapAbsCatalogItem(CLOUD_AUDIO_LIBRARY_ID, {
      id: 78,
      title: 'Audio Dune Messiah',
      authors: ['Frank Herbert'],
      narrators: ['Simon Vance'],
      durationSeconds: 120,
      hasCover: false,
    } as any);

    expect(local.coverPath).toBeNull();
    expect(catalog.coverPath).toBeNull();
  });

  it('rejects unmappable warehouse synthetic ids with a controlled mapper error', () => {
    expect(() =>
      mapAbsLibraryItemsPage(CLOUD_AUDIO_LIBRARY_ID, {
        items: [
          {
            id: 0,
            catalogSource: { mediaType: 'audiobook', remoteId: 'secret' },
            status: 'present',
            title: 'Broken',
            authors: ['A'],
            narrators: [],
            seriesName: null,
            seriesIndex: null,
            files: [],
            publishedYear: null,
            language: null,
            genres: [],
            rating: null,
            readingProgress: null,
            readStatus: null,
            addedAt: new Date(0).toISOString(),
            updatedAt: null,
            metadataScore: null,
            hasCover: false,
            hasMetadataLocks: false,
            lockedFields: [],
            subtitle: null,
            publisher: null,
            pageCount: null,
            isbn13: null,
            hardcoverId: null,
            hardcoverEditionId: null,
            tags: [],
          } as any,
        ],
        total: 1,
        page: 0,
        size: 50,
      }),
    ).toThrow(AbsItemMappingError);
  });

  it('rejects dashboard catalog items rather than deriving ABS ids from remote ids', () => {
    expect(() =>
      mapAbsLibraryItemsPage(CLOUD_AUDIO_LIBRARY_ID, {
        items: [
          {
            type: 'catalog-item',
            mediaType: 'audiobook',
            remoteId: 'remote-secret',
            title: 'Dashboard Audio',
            subtitle: null,
            seriesName: null,
            authors: ['A'],
            narrators: [],
            libraryName: 'Audiobooks',
            formats: ['m4b'],
            durationSeconds: 120,
            hasCover: true,
          },
        ],
        total: 1,
        page: 0,
        size: 50,
      }),
    ).toThrow(AbsItemMappingError);
  });
});
