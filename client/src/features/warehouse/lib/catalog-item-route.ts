import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, type WarehouseMediaType } from '@bookorbit/types'
import { libraryRouteParamForId, type LibraryRouteParam } from '@/features/library/lib/library-route'

export type CatalogLibraryItemRoute = {
  name: 'library-item-detail'
  params: {
    id: LibraryRouteParam
    remoteId: string
  }
}

export type CatalogLibraryReaderRoute = {
  name: 'library-reader'
  params: {
    id: LibraryRouteParam
    remoteId: string
  }
}

export function catalogLibraryIdForMediaType(mediaType: WarehouseMediaType): number {
  if (mediaType === 'audiobook') return CLOUD_AUDIO_LIBRARY_ID
  if (mediaType === 'comic') return CLOUD_COMIC_LIBRARY_ID
  return CLOUD_EBOOK_LIBRARY_ID
}

export function catalogLibraryRouteParamForMediaType(mediaType: WarehouseMediaType): LibraryRouteParam {
  return libraryRouteParamForId(catalogLibraryIdForMediaType(mediaType))
}

export function catalogLibraryItemRoute(mediaType: WarehouseMediaType, remoteId: string): CatalogLibraryItemRoute {
  return {
    name: 'library-item-detail',
    params: {
      id: catalogLibraryRouteParamForMediaType(mediaType),
      remoteId,
    },
  }
}

export function catalogLibraryReaderRoute(mediaType: WarehouseMediaType, remoteId: string): CatalogLibraryReaderRoute {
  return {
    name: 'library-reader',
    params: {
      id: catalogLibraryRouteParamForMediaType(mediaType),
      remoteId,
    },
  }
}
