import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogLibraryItemsPage, DashboardCatalogItem } from '@bookorbit/types'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

function makeItem(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'ebook',
    remoteId: 'ebook-1',
    title: 'A Library Ebook',
    subtitle: null,
    seriesName: null,
    authors: ['Ada Author'],
    narrators: [],
    libraryName: 'Ebook Library',
    formats: ['epub'],
    hasCover: true,
    addedAt: '2026-06-02T11:00:00.000Z',
    ...overrides,
  }
}

function mockOkResponse(page: CatalogLibraryItemsPage) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(page),
  })
}

describe('useCatalogLibraryItems', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('posts normal BookQuery bodies for source-backed library items', async () => {
    const { useCatalogLibraryItems } = await import('../useCatalogLibraryItems')
    const libraryId = ref<number | null>(null)
    const q = ref('dune')
    const catalog = useCatalogLibraryItems(libraryId, q)
    catalog.filter.value = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }],
    }
    catalog.sort.value = [{ field: 'title', dir: 'desc' }]

    mockOkResponse({ items: [makeItem()], total: 1, page: 0, limit: 50 })
    libraryId.value = -1
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/libraries/-1/catalog-items/query',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: catalog.filter.value,
          sort: [{ field: 'title', dir: 'desc' }],
          pagination: { page: 0, size: 50 },
          q: 'dune',
        }),
      }),
    )
    expect(catalog.items.value).toEqual([makeItem()])
    expect(catalog.total.value).toBe(1)
    expect(catalog.currentPage.value).toBe(1)
  })

  it('loads immediately when mounted with a source-backed library id', async () => {
    const { useCatalogLibraryItems } = await import('../useCatalogLibraryItems')

    mockOkResponse({ items: [makeItem()], total: 1, page: 0, limit: 50 })
    const catalog = useCatalogLibraryItems(ref(-1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/libraries/-1/catalog-items/query', expect.any(Object))
    expect(catalog.items.value).toEqual([makeItem()])
  })

  it('loads one-based pages into zero-based BookQuery pagination', async () => {
    const { useCatalogLibraryItems } = await import('../useCatalogLibraryItems')
    mockOkResponse({ items: [], total: 90, page: 0, limit: 50 })
    const catalog = useCatalogLibraryItems(ref(-2))

    mockOkResponse({ items: [makeItem({ mediaType: 'audiobook', remoteId: 'audio-1' })], total: 90, page: 1, limit: 50 })
    await catalog.setPage(2)

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect(lastCall).toBeDefined()
    expect(JSON.parse((lastCall![1] as RequestInit).body as string)).toMatchObject({
      pagination: { page: 1, size: 50 },
    })
    expect(catalog.currentPage.value).toBe(2)
  })
})
