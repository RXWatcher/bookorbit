import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw, Router } from 'vue-router'
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'
import { registerSourceBackedLibraryNormalizationGuard, routes } from '@/router'
import { canonicalizeUserFacingLibraryUrl, libraryRouteQueryValueForId, parseLibraryFilterRouteId } from '@/features/library/lib/library-route'

type MissingRoute = {
  name: string
  path: string
}

function walkRoutes(records: RouteRecordRaw[], visit: (route: RouteRecordRaw, fullPath: string) => void, parentPath = '') {
  for (const record of records) {
    const segment = record.path ?? ''
    const fullPath = segment.startsWith('/') ? segment : `${parentPath.replace(/\/$/, '')}/${segment}`.replace(/\/+/g, '/')
    visit(record, fullPath || '/')
    if (record.children?.length) {
      walkRoutes(record.children, visit, fullPath || '/')
    }
  }
}

function findRoute(name: string): RouteRecordRaw | undefined
function findRoute(records: RouteRecordRaw[], name: string): RouteRecordRaw | undefined
function findRoute(recordsOrName: RouteRecordRaw[] | string, maybeName?: string): RouteRecordRaw | undefined {
  const records = typeof recordsOrName === 'string' ? routes : recordsOrName
  const name = typeof recordsOrName === 'string' ? recordsOrName : maybeName
  if (!name) return undefined

  for (const record of records) {
    if (record.name === name) return record
    const child = record.children ? findRoute(record.children, name) : undefined
    if (child) return child
  }
  return undefined
}

describe('router title metadata', () => {
  it('requires meta.title on all named non-redirect routes', () => {
    const missing: MissingRoute[] = []

    walkRoutes(routes, (route, fullPath) => {
      if (!route.name || route.redirect) return
      const title = route.meta?.title
      const hasTitle = typeof title === 'string' || typeof title === 'function'
      if (!hasTitle) {
        missing.push({ name: String(route.name), path: fullPath })
      }
    })

    expect(missing).toEqual([])
  })

  it('includes the requests route title', () => {
    const found: Array<{ name: string; path: string; title: unknown }> = []

    walkRoutes(routes, (route, fullPath) => {
      if (route.name === 'requests') {
        found.push({ name: String(route.name), path: fullPath, title: route.meta?.title })
      }
    })

    expect(found).toEqual([{ name: 'requests', path: '/requests', title: 'Requests' }])
  })

  it('includes the native source-backed library item detail route title', () => {
    const found: Array<{ name: string; path: string; title: unknown }> = []

    walkRoutes(routes, (route, fullPath) => {
      if (route.name === 'library-item-detail') {
        found.push({ name: String(route.name), path: fullPath, title: route.meta?.title })
      }
    })

    expect(found).toEqual([{ name: 'library-item-detail', path: '/library/:id/items/:remoteId', title: 'Library Item' }])
  })

  it('uses native library names for source-backed library route titles', () => {
    const route = findRoute('library')
    expect(route?.meta?.title).toEqual(expect.any(Function))

    const resolveTitle = route!.meta!.title as (to: { params: Record<string, string> }) => string

    expect(resolveTitle({ params: { id: String(CLOUD_EBOOK_LIBRARY_ID) } })).toBe('Books')
    expect(resolveTitle({ params: { id: String(CLOUD_AUDIO_LIBRARY_ID) } })).toBe('Audiobooks')
    expect(resolveTitle({ params: { id: String(CLOUD_COMIC_LIBRARY_ID) } })).toBe('Comics')
    expect(resolveTitle({ params: { id: 'ebooks' } })).toBe('Books')
    expect(resolveTitle({ params: { id: 'audiobooks' } })).toBe('Audiobooks')
    expect(resolveTitle({ params: { id: '7' } })).toBe('Library #7')
  })

  it('uses native Audiobooks naming for legacy audiobook catalog redirects', () => {
    expect(findRoute('catalog-audiobooks')?.meta?.title).toBe('Audiobooks')
  })

  it('redirects legacy catalog item detail links to native library item detail routes', () => {
    const route = findRoute('catalog-item-detail')
    expect(route?.redirect).toEqual(expect.any(Function))

    const redirect = route!.redirect as (to: { params: Record<string, string>; query?: Record<string, string>; hash?: string }) => unknown
    expect(redirect({ params: { mediaType: 'ebook', remoteId: 'book 1/with slash' } })).toEqual({
      name: 'library-item-detail',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
      query: undefined,
      hash: undefined,
    })
    expect(redirect({ params: { mediaType: 'ebooks', remoteId: 'book-2' }, query: { from: 'old-link' }, hash: '#details' })).toEqual({
      name: 'library-item-detail',
      params: { id: 'ebooks', remoteId: 'book-2' },
      query: { from: 'old-link' },
      hash: '#details',
    })
    expect(redirect({ params: { mediaType: 'audiobooks', remoteId: 'audio 1/with slash' }, query: {}, hash: '' })).toEqual({
      name: 'library-item-detail',
      params: { id: 'audiobooks', remoteId: 'audio 1/with slash' },
      query: {},
      hash: '',
    })
  })

  it('routes source-backed reading through native library reader URLs', () => {
    const nativeRoute = findRoute('library-reader')
    expect(nativeRoute).toEqual(
      expect.objectContaining({
        path: '/read/library/:id/items/:remoteId',
        meta: expect.objectContaining({ title: 'Read' }),
      }),
    )

    const legacyRoute = findRoute('catalog-reader')
    expect(legacyRoute?.redirect).toEqual(expect.any(Function))

    const redirect = legacyRoute!.redirect as (to: { params: Record<string, string>; query?: Record<string, string>; hash?: string }) => unknown
    expect(redirect({ params: { mediaType: 'audiobook', remoteId: 'audio-1' }, query: { format: 'mp3' }, hash: '#listen' })).toEqual({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio-1' },
      query: { format: 'mp3' },
      hash: '#listen',
    })
  })

  it('normalizes legacy negative source-backed library URLs to friendly aliases', () => {
    const libraryRoute = findRoute('library')
    const itemRoute = findRoute('library-item-detail')
    const readerRoute = findRoute('library-reader')

    expect(libraryRoute?.beforeEnter).toEqual(expect.any(Function))
    expect(itemRoute?.beforeEnter).toEqual(expect.any(Function))
    expect(readerRoute?.beforeEnter).toEqual(expect.any(Function))

    const normalizeLibrary = libraryRoute!.beforeEnter as (to: {
      params: Record<string, string | number>
      query?: Record<string, string>
      hash?: string
    }) => unknown
    const normalizeItem = itemRoute!.beforeEnter as (to: { params: Record<string, string>; query?: Record<string, string>; hash?: string }) => unknown
    const normalizeReader = readerRoute!.beforeEnter as (to: {
      params: Record<string, string>
      query?: Record<string, string>
      hash?: string
    }) => unknown

    expect(normalizeLibrary({ params: { id: String(CLOUD_EBOOK_LIBRARY_ID) }, query: { view: 'grid' }, hash: '#top' })).toEqual({
      name: 'library',
      params: { id: 'ebooks' },
      query: { view: 'grid' },
      hash: '#top',
    })
    expect(normalizeLibrary({ params: { id: CLOUD_EBOOK_LIBRARY_ID }, query: { view: 'grid' } })).toEqual({
      name: 'library',
      params: { id: 'ebooks' },
      query: { view: 'grid' },
      hash: undefined,
    })
    expect(normalizeItem({ params: { id: String(CLOUD_EBOOK_LIBRARY_ID), remoteId: 'book-1' } })).toEqual({
      name: 'library-item-detail',
      params: { id: 'ebooks', remoteId: 'book-1' },
      query: undefined,
      hash: undefined,
    })
    expect(normalizeReader({ params: { id: String(CLOUD_AUDIO_LIBRARY_ID), remoteId: 'audio-1' } })).toEqual({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio-1' },
      query: undefined,
      hash: undefined,
    })
    expect(normalizeItem({ params: { id: String(CLOUD_COMIC_LIBRARY_ID), remoteId: 'comic-1' } })).toEqual({
      name: 'library-item-detail',
      params: { id: 'comics', remoteId: 'comic-1' },
      query: undefined,
      hash: undefined,
    })
    expect(normalizeLibrary({ params: { id: 'ebook' }, query: { view: 'list' } })).toEqual({
      name: 'library',
      params: { id: 'ebooks' },
      query: { view: 'list' },
      hash: undefined,
    })
    expect(normalizeReader({ params: { id: 'audio', remoteId: 'audio-1' } })).toEqual({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio-1' },
      query: undefined,
      hash: undefined,
    })
    expect(normalizeReader({ params: { id: 'comic', remoteId: 'comic-1' } })).toEqual({
      name: 'library-reader',
      params: { id: 'comics', remoteId: 'comic-1' },
      query: undefined,
      hash: undefined,
    })
    expect(normalizeLibrary({ params: { id: 'ebooks' } })).toBeUndefined()
    expect(normalizeLibrary({ params: { id: 'audiobooks' } })).toBeUndefined()
    expect(normalizeLibrary({ params: { id: 'comics' } })).toBeUndefined()
    expect(normalizeLibrary({ params: { id: '7' } })).toBeUndefined()
  })

  it('canonicalizes source-backed library ids in user-facing URLs and query filters', () => {
    expect(canonicalizeUserFacingLibraryUrl('/library/-1?view=grid#top')).toBe('/library/ebooks?view=grid#top')
    expect(canonicalizeUserFacingLibraryUrl('/read/library/-2/items/audio-1')).toBe('/read/library/audiobooks/items/audio-1')
    expect(canonicalizeUserFacingLibraryUrl('/read/library/-3/items/comic-1')).toBe('/read/library/comics/items/comic-1')
    expect(canonicalizeUserFacingLibraryUrl('/series?libraryId=-2&sort=name')).toBe('/series?libraryId=audiobooks&sort=name')
    expect(canonicalizeUserFacingLibraryUrl('/authors?libraryId=-3&sort=name')).toBe('/authors?libraryId=comics&sort=name')
    expect(canonicalizeUserFacingLibraryUrl('/authors?libraryId=ebook')).toBe('/authors?libraryId=ebooks')
    expect(canonicalizeUserFacingLibraryUrl('/library/7?view=grid')).toBe('/library/7?view=grid')

    expect(libraryRouteQueryValueForId(CLOUD_EBOOK_LIBRARY_ID)).toBe('ebooks')
    expect(libraryRouteQueryValueForId(CLOUD_AUDIO_LIBRARY_ID)).toBe('audiobooks')
    expect(libraryRouteQueryValueForId(CLOUD_COMIC_LIBRARY_ID)).toBe('comics')
    expect(libraryRouteQueryValueForId(7)).toBe('7')
    expect(libraryRouteQueryValueForId(null)).toBeUndefined()
    expect(parseLibraryFilterRouteId('ebooks')).toBe(CLOUD_EBOOK_LIBRARY_ID)
    expect(parseLibraryFilterRouteId('audiobooks')).toBe(CLOUD_AUDIO_LIBRARY_ID)
    expect(parseLibraryFilterRouteId('comics')).toBe(CLOUD_COMIC_LIBRARY_ID)
    expect(parseLibraryFilterRouteId('-5')).toBeNull()
  })

  it('registers source-backed library normalization as a global guard for auth redirects', () => {
    const callbacks: Array<Parameters<Router['beforeEach']>[0]> = []
    const router: Pick<Router, 'beforeEach'> = {
      beforeEach(callback) {
        callbacks.push(callback)
        return () => {}
      },
    }

    registerSourceBackedLibraryNormalizationGuard(router)

    expect(callbacks).toHaveLength(1)
    expect(
      callbacks[0]!.call(
        undefined,
        { name: 'library', params: { id: String(CLOUD_EBOOK_LIBRARY_ID) }, query: { view: 'grid' } } as never,
        {} as never,
        () => {},
      ),
    ).toEqual({
      name: 'library',
      params: { id: 'ebooks' },
      query: { view: 'grid' },
      hash: undefined,
    })
  })
})

describe('router redirects', () => {
  it('redirects the legacy Readwise route to the Integrations sub-tab', () => {
    const route = findRoute(routes, 'settings-readwise')
    expect(route?.redirect).toBeTypeOf('function')

    const redirect = route!.redirect as (to: { query: Record<string, unknown> }) => unknown
    expect(redirect({ query: {} })).toEqual({ name: 'settings-integrations', query: { tab: 'readwise' } })
  })
})
