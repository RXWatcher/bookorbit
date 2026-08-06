import { describe, expect, it } from 'vitest'

import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'
import {
  catalogLibraryIdForMediaType,
  catalogLibraryItemRoute,
  catalogLibraryReaderRoute,
  catalogLibraryRouteParamForMediaType,
} from '../catalog-item-route'

describe('catalog item routes', () => {
  it('maps source-backed ebooks to the native ebook library', () => {
    expect(catalogLibraryIdForMediaType('ebook')).toBe(CLOUD_EBOOK_LIBRARY_ID)
    expect(catalogLibraryRouteParamForMediaType('ebook')).toBe('ebooks')
    expect(catalogLibraryItemRoute('ebook', 'ebook-1')).toEqual({
      name: 'library-item-detail',
      params: { id: 'ebooks', remoteId: 'ebook-1' },
    })
    expect(catalogLibraryReaderRoute('ebook', 'ebook-1')).toEqual({
      name: 'library-reader',
      params: { id: 'ebooks', remoteId: 'ebook-1' },
    })
  })

  it('maps source-backed audiobooks to the native audio library', () => {
    expect(catalogLibraryIdForMediaType('audiobook')).toBe(CLOUD_AUDIO_LIBRARY_ID)
    expect(catalogLibraryRouteParamForMediaType('audiobook')).toBe('audiobooks')
    expect(catalogLibraryItemRoute('audiobook', 'audio-1')).toEqual({
      name: 'library-item-detail',
      params: { id: 'audiobooks', remoteId: 'audio-1' },
    })
    expect(catalogLibraryReaderRoute('audiobook', 'audio-1')).toEqual({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio-1' },
    })
  })

  it('maps source-backed comics to the native comic library', () => {
    expect(catalogLibraryIdForMediaType('comic')).toBe(CLOUD_COMIC_LIBRARY_ID)
    expect(catalogLibraryRouteParamForMediaType('comic')).toBe('comics')
    expect(catalogLibraryItemRoute('comic', 'comic-1')).toEqual({
      name: 'library-item-detail',
      params: { id: 'comics', remoteId: 'comic-1' },
    })
    expect(catalogLibraryReaderRoute('comic', 'comic-1')).toEqual({
      name: 'library-reader',
      params: { id: 'comics', remoteId: 'comic-1' },
    })
  })
})
