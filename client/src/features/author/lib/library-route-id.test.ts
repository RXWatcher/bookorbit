import { describe, expect, it } from 'vitest'

import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'
import { parseAuthorLibraryRouteId } from './library-route-id'

describe('parseAuthorLibraryRouteId', () => {
  it('accepts filesystem and source-backed library ids from route query strings', () => {
    expect(parseAuthorLibraryRouteId('12')).toBe(12)
    expect(parseAuthorLibraryRouteId(String(CLOUD_EBOOK_LIBRARY_ID))).toBe(CLOUD_EBOOK_LIBRARY_ID)
    expect(parseAuthorLibraryRouteId(String(CLOUD_AUDIO_LIBRARY_ID))).toBe(CLOUD_AUDIO_LIBRARY_ID)
    expect(parseAuthorLibraryRouteId(String(CLOUD_COMIC_LIBRARY_ID))).toBe(CLOUD_COMIC_LIBRARY_ID)
  })

  it('rejects blank, zero, unknown negative, and non-string route values', () => {
    expect(parseAuthorLibraryRouteId('')).toBeNull()
    expect(parseAuthorLibraryRouteId('0')).toBeNull()
    expect(parseAuthorLibraryRouteId('-999')).toBeNull()
    expect(parseAuthorLibraryRouteId(['1'])).toBeNull()
    expect(parseAuthorLibraryRouteId(undefined)).toBeNull()
  })
})
