import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScrollerConfig } from '@bookorbit/types'

const STORAGE_KEY = 'bookorbit:dashboard:config'

function storedConfig(): { scrollers: ScrollerConfig[]; shelfLayout: string } {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { scrollers: ScrollerConfig[]; shelfLayout: string }
}

describe('useDashboardConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('normalizes legacy object storage into a scroller array', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: [
          {
            id: 99,
            type: 'smart-scope',
            label: 'Unread Favorites',
            enabled: 'false',
            order: 7,
            limit: '12',
            smartScopeId: '42',
          },
        ],
      }),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, shelfLayout } = useDashboardConfig()

    expect(scrollers.value).toEqual([
      {
        id: '99',
        type: 'smart-scope',
        label: 'Unread Favorites',
        enabled: false,
        order: 1,
        limit: 12,
        rows: 1,
        media: 'all',
        smartScopeId: 42,
      },
    ])
    expect(shelfLayout.value).toBe('wide')
  })

  it('clones the default config before applying mutations', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, addScroller } = useDashboardConfig()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
    expect(scrollers.value).not.toBe(DEFAULT_SCROLLERS)
    // Reading and listening lead, then each shelf is split so ebooks and
    // audiobooks get their own rail rather than sharing one jumbled list.
    expect(DEFAULT_SCROLLERS.map((scroller) => [scroller.type, scroller.media, scroller.enabled, scroller.order])).toEqual([
      ['continue-reading', 'ebook', true, 1],
      ['continue-listening', 'audiobook', true, 2],
      ['recently-added', 'ebook', true, 3],
      ['recently-added', 'audiobook', true, 4],
      ['random', 'ebook', true, 5],
      ['random', 'audiobook', true, 6],
      ['catalog-additions', 'all', true, 7],
      ['catalog-discovery', 'all', true, 8],
      ['recently-added', 'comic', false, 9],
      ['want-to-read', 'all', false, 10],
      ['up-next-in-series', 'all', false, 11],
    ])

    addScroller('smart-scope')

    expect(scrollers.value).toHaveLength(12)
    expect(DEFAULT_SCROLLERS).toHaveLength(11)
  })

  it('supports catalog additions as a configurable dashboard shelf', async () => {
    const { DEFAULT_SCROLLERS, SCROLLER_LABELS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers } = useDashboardConfig()

    expect(DEFAULT_SCROLLERS).toContainEqual({
      id: '7',
      type: 'catalog-additions',
      label: 'Library Additions',
      enabled: true,
      order: 7,
      limit: 20,
      rows: 1,
      media: 'all',
    })
    expect((SCROLLER_LABELS as Record<string, string>)['catalog-additions']).toBe('Library Additions')
    expect(DEFAULT_SCROLLERS).toContainEqual({
      id: '8',
      type: 'catalog-discovery',
      label: 'Explore Libraries',
      enabled: true,
      order: 8,
      limit: 20,
      rows: 1,
      media: 'all',
    })
    expect((SCROLLER_LABELS as Record<string, string>)['catalog-discovery']).toBe('Explore Libraries')

    saveScrollers([
      {
        id: 'catalog',
        type: 'catalog-additions',
        label: '   ',
        enabled: true,
        order: 1,
        limit: 12,
      },
    ] as ScrollerConfig[])

    expect(scrollers.value).toEqual([
      {
        id: 'catalog',
        type: 'catalog-additions',
        label: 'Library Additions',
        enabled: true,
        order: 1,
        limit: 12,
        rows: 1,
        media: 'all',
      },
    ])
  })

  it('upgrades legacy default catalog shelf labels to native library labels without changing custom labels', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: '5', type: 'catalog-additions', label: 'Catalog Additions', enabled: true, order: 1, limit: 20 },
        { id: '6', type: 'catalog-discovery', label: 'Explore Catalog', enabled: true, order: 2, limit: 20 },
        { id: '7', type: 'catalog-additions', label: 'Wishlist Drops', enabled: true, order: 3, limit: 20 },
      ]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value).toEqual([
      { id: '5', type: 'catalog-additions', label: 'Library Additions', enabled: true, order: 1, limit: 20, rows: 1, media: 'all' },
      { id: '6', type: 'catalog-discovery', label: 'Explore Libraries', enabled: true, order: 2, limit: 20, rows: 1, media: 'all' },
      { id: '7', type: 'catalog-additions', label: 'Wishlist Drops', enabled: true, order: 3, limit: 20, rows: 1, media: 'all' },
    ])
  })

  it('prunes shelves that reference deleted smart scopes', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
        { id: '2', type: 'smart-scope', label: 'Unread', enabled: true, order: 2, limit: 20, smartScopeId: 41 },
        { id: '3', type: 'smart-scope', label: 'Favorites', enabled: true, order: 3, limit: 20, smartScopeId: 42 },
      ]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, pruneDeletedSmartScopeScrollers } = useDashboardConfig()

    pruneDeletedSmartScopeScrollers([42])

    expect(scrollers.value).toEqual([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 1, media: 'all' },
      { id: '3', type: 'smart-scope', label: 'Favorites', enabled: true, order: 2, limit: 20, rows: 1, media: 'all', smartScopeId: 42 },
    ])

    expect(storedConfig()).toEqual({ scrollers: scrollers.value, shelfLayout: 'wide' })
  })

  it('upgrades an untouched pre-split layout to the split media layout, keeping renamed headings', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: '2', type: 'recently-added', label: 'Fresh Arrivals', enabled: true, order: 1, limit: 20 },
        { id: '3', type: 'random', label: 'Discover Something New', enabled: true, order: 2, limit: 20 },
        { id: '1', type: 'continue-reading', label: 'Continue Reading', enabled: true, order: 3, limit: 20 },
        { id: '5', type: 'continue-listening', label: 'Continue Listening', enabled: true, order: 4, limit: 20 },
        { id: '6', type: 'want-to-read', label: 'Want to Read', enabled: false, order: 5, limit: 20 },
        { id: '4', type: 'up-next-in-series', label: 'Up Next in Series', enabled: false, order: 6, limit: 20 },
        { id: '7', type: 'catalog-additions', label: 'Library Additions', enabled: true, order: 7, limit: 20 },
        { id: '8', type: 'catalog-discovery', label: 'Explore Libraries', enabled: true, order: 8, limit: 20 },
      ]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value.slice(0, 4).map((scroller) => [scroller.type, scroller.media])).toEqual([
      ['continue-reading', 'ebook'],
      ['continue-listening', 'audiobook'],
      ['recently-added', 'ebook'],
      ['recently-added', 'audiobook'],
    ])
    // The heading they had renamed survives the upgrade.
    expect(scrollers.value.filter((scroller) => scroller.type === 'recently-added').every((s) => s.label === 'Fresh Arrivals')).toBe(true)
  })

  it('leaves a customised pre-split layout alone and only backfills media', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: '99', type: 'random', label: 'My Shelf', enabled: true, order: 1, limit: 20 }]))

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value).toEqual([{ id: '99', type: 'random', label: 'My Shelf', enabled: true, order: 1, limit: 20, rows: 1, media: 'all' }])
  })

  it('falls back to defaults when stored JSON is malformed', async () => {
    localStorage.setItem(STORAGE_KEY, '{bad json')

    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
  })

  it('normalizes saveScrollers input and reset clears local storage', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers, reset } = useDashboardConfig()

    const malformedScrollers = [
      {
        id: '  ',
        type: 'recently-added',
        label: '   ',
        enabled: 'sometimes',
        order: 99,
        limit: 'oops',
      },
      {
        id: 17,
        type: 'smart-scope',
        label: '',
        enabled: 'true',
        order: 42,
        limit: 0,
        smartScopeId: 23,
      },
    ] as unknown as ScrollerConfig[]

    saveScrollers(malformedScrollers)

    expect(scrollers.value).toEqual([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 1, media: 'all' },
      { id: '17', type: 'smart-scope', label: 'Smart Scope', enabled: true, order: 2, limit: 20, rows: 1, media: 'all', smartScopeId: 23 },
    ])
    expect(storedConfig()).toEqual({ scrollers: scrollers.value, shelfLayout: 'wide' })

    reset()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('uses the default label for up-next-in-series when a custom label is empty', async () => {
    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers } = useDashboardConfig()

    saveScrollers([
      {
        id: '12',
        type: 'up-next-in-series',
        label: '   ',
        enabled: true,
        order: 1,
        limit: 20,
        rows: 1,
        media: 'all',
      },
    ])

    expect(scrollers.value).toEqual([
      {
        id: '12',
        type: 'up-next-in-series',
        label: 'Up Next in Series',
        enabled: true,
        order: 1,
        limit: 20,
        rows: 1,
        media: 'all',
      },
    ])
  })

  it('persists the two-column shelf layout with the shelf configuration', async () => {
    const { SHELF_LAYOUT, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, shelfLayout, saveShelfSettings } = useDashboardConfig()

    saveShelfSettings(scrollers.value, SHELF_LAYOUT.TWO_COLUMNS)

    expect(shelfLayout.value).toBe(SHELF_LAYOUT.TWO_COLUMNS)
    expect(storedConfig()).toEqual({ scrollers: scrollers.value, shelfLayout: SHELF_LAYOUT.TWO_COLUMNS })
  })

  it('normalizes an unknown stored shelf layout to wide rows', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: [{ id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 }],
        shelfLayout: 'unsupported-layout',
      }),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { shelfLayout } = useDashboardConfig()

    expect(shelfLayout.value).toBe('wide')
  })

  it('preserves and normalizes continue-listening and want-to-read shelves', async () => {
    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers } = useDashboardConfig()

    saveScrollers([
      {
        id: '21',
        type: 'continue-listening',
        label: '',
        enabled: 'true',
        order: 10,
        limit: '9',
      },
      {
        id: '22',
        type: 'want-to-read',
        label: 'Reading Queue',
        enabled: 'false',
        order: 11,
        limit: 12,
      },
    ] as unknown as ScrollerConfig[])

    expect(scrollers.value).toEqual([
      {
        id: '21',
        type: 'continue-listening',
        label: 'Continue Listening',
        enabled: true,
        order: 1,
        limit: 9,
        rows: 1,
        media: 'all',
      },
      {
        id: '22',
        type: 'want-to-read',
        label: 'Reading Queue',
        enabled: false,
        order: 2,
        limit: 12,
        rows: 1,
        media: 'all',
      },
    ])
  })

  it('defaults every shelf to a single row', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, addScroller } = useDashboardConfig()

    expect(DEFAULT_SCROLLERS.map((scroller) => scroller.rows)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])

    addScroller('random')

    expect(scrollers.value.at(-1)?.rows).toBe(1)
  })

  it('backfills a single row for configs stored before multi-row shelves', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: [{ id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 }],
        shelfLayout: 'wide',
      }),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value[0]?.rows).toBe(1)
  })

  it('persists a configured row count and clamps it to the supported range', async () => {
    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers } = useDashboardConfig()

    saveScrollers([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 3, media: 'all' },
      { id: '2', type: 'random', label: 'Discover Something New', enabled: true, order: 2, limit: 20, rows: 9, media: 'all' },
      { id: '3', type: 'continue-reading', label: 'Continue Reading', enabled: true, order: 3, limit: 20, rows: 0, media: 'all' },
    ])

    expect(scrollers.value.map((scroller) => scroller.rows)).toEqual([3, 3, 1])
    expect(storedConfig().scrollers.map((scroller) => scroller.rows)).toEqual([3, 3, 1])
  })

  it('parses a stringified row count the way stored limits are parsed', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: '2' }]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value[0]?.rows).toBe(2)
  })

  it('does not rewrite storage when smart scope prune keeps the same scrollers', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
        { id: '2', type: 'smart-scope', label: 'Unread', enabled: true, order: 2, limit: 20, smartScopeId: 42 },
      ]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, pruneDeletedSmartScopeScrollers } = useDashboardConfig()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    pruneDeletedSmartScopeScrollers([42])

    expect(scrollers.value).toEqual([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 1, media: 'all' },
      { id: '2', type: 'smart-scope', label: 'Unread', enabled: true, order: 2, limit: 20, rows: 1, media: 'all', smartScopeId: 42 },
    ])
    expect(setItemSpy).not.toHaveBeenCalled()

    setItemSpy.mockRestore()
  })
})
