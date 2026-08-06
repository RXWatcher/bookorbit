import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionCatalogItemsPage, DashboardCatalogItem } from '@bookorbit/types'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

function makeItem(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'ebook',
    remoteId: 'remote-1',
    title: 'Catalog Title',
    subtitle: null,
    seriesName: null,
    authors: [],
    narrators: [],
    libraryName: 'Ebook Library',
    formats: ['epub'],
    hasCover: false,
    ...overrides,
  }
}

function makePage(items: DashboardCatalogItem[], total: number, page = 0): CollectionCatalogItemsPage {
  return { items, total, page, size: 50 }
}

function mockOkResponse(page: CollectionCatalogItemsPage) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(page),
  })
}

describe('useCollectionCatalogItems', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads source-backed collection items with search query', async () => {
    const { useCollectionCatalogItems } = await import('../useCollectionCatalogItems')
    const collectionId = ref(7)
    const q = ref('dune')
    const sort = ref([{ field: 'title' as const, dir: 'desc' as const }])
    const { items, total, hasMore, load } = useCollectionCatalogItems(collectionId, q, sort)

    mockOkResponse(makePage([makeItem({ remoteId: 'dune-1', title: 'Dune' })], 1))
    await load(true)

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/collections/7/catalog-items?page=0&size=50&q=dune&sort=${encodeURIComponent(JSON.stringify(sort.value))}`,
      undefined,
    )
    expect(items.value.map((item) => item.title)).toEqual(['Dune'])
    expect(total.value).toBe(1)
    expect(hasMore.value).toBe(false)
  })

  it('appends additional pages while reporting remaining source-backed collection items', async () => {
    const { useCollectionCatalogItems } = await import('../useCollectionCatalogItems')
    const collectionId = ref(7)
    const { items, hasMore, load } = useCollectionCatalogItems(collectionId)

    mockOkResponse(makePage([makeItem({ remoteId: 'first', title: 'First' })], 2, 0))
    await load(true)

    expect(hasMore.value).toBe(true)

    mockOkResponse(makePage([makeItem({ remoteId: 'second', title: 'Second' })], 2, 1))
    await load()

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/collections/7/catalog-items?page=1&size=50&sort=${encodeURIComponent(JSON.stringify([{ field: 'title', dir: 'asc' }]))}`,
      undefined,
    )
    expect(items.value.map((item) => item.title)).toEqual(['First', 'Second'])
    expect(hasMore.value).toBe(false)
  })

  it('keeps only the latest reset response', async () => {
    const { useCollectionCatalogItems } = await import('../useCollectionCatalogItems')
    const collectionId = ref(7)
    const { items, load } = useCollectionCatalogItems(collectionId)

    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve
      }),
    )

    const first = load(true)
    const second = load(true)

    resolveSecond({
      ok: true,
      json: () => Promise.resolve(makePage([makeItem({ title: 'Second' })], 1)),
    })
    await second

    resolveFirst({
      ok: true,
      json: () => Promise.resolve(makePage([makeItem({ title: 'First' })], 1)),
    })
    await first

    expect(items.value.map((item) => item.title)).toEqual(['Second'])
  })
})
