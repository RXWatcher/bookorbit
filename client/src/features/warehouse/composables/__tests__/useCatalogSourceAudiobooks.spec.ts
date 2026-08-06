import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WarehouseAudiobookCatalogItem,
  WarehouseAudiobookCatalogPage,
  WarehouseAudiobookCatalogQuery,
  WarehouseAudiobookDetail,
} from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  fetchCatalogSourceAudiobooks: vi.fn<(query: WarehouseAudiobookCatalogQuery) => Promise<WarehouseAudiobookCatalogPage>>(),
  fetchCatalogSourceAudiobook: vi.fn<(remoteId: string) => Promise<WarehouseAudiobookDetail | null>>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

function makeCatalogItem(overrides: Partial<WarehouseAudiobookCatalogItem> = {}): WarehouseAudiobookCatalogItem {
  return {
    id: 23,
    remoteId: 'audio-23',
    title: 'The Spoken Orbit',
    subtitle: null,
    authors: ['Ada Stone'],
    narrators: ['Robin Miles'],
    series: 'Wayfarers',
    language: 'en',
    publisher: 'Orbit Press',
    identifiers: { asin: 'B000000023' },
    format: 'm4b',
    durationSeconds: 36000,
    hasCover: true,
    syncedAt: '2026-06-01T12:00:00.000Z',
    source: 'catalog-source',
    ...overrides,
  }
}

function makeCatalogDetail(overrides: Partial<WarehouseAudiobookDetail> = {}): WarehouseAudiobookDetail {
  return {
    ...makeCatalogItem(),
    chapters: [],
    files: [],
    ...overrides,
  }
}

function makeCatalogPage(overrides: Partial<WarehouseAudiobookCatalogPage> = {}): WarehouseAudiobookCatalogPage {
  return {
    items: [makeCatalogItem()],
    page: 1,
    limit: 24,
    total: 1,
    ...overrides,
  }
}

function makeResponse(data?: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

describe('catalog-source audiobook api', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../../api/catalog-source.api')
    mocks.api.mockReset()
  })

  it('encodes audiobook query fields including narrator, duration sort, and hasCover', async () => {
    const page = makeCatalogPage()
    mocks.api.mockResolvedValueOnce(makeResponse(page))

    const { fetchCatalogSourceAudiobooks } = await import('../../api/catalog-source.api')

    await expect(
      fetchCatalogSourceAudiobooks({
        q: 'space opera',
        page: 2,
        limit: 48,
        sort: 'duration',
        order: 'desc',
        author: 'Ada Stone',
        narrator: 'Robin Miles',
        series: 'Wayfarers',
        language: 'en',
        format: 'm4b',
        hasCover: false,
      }),
    ).resolves.toEqual(page)

    const requestUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(requestUrl.pathname).toBe('/api/v1/catalog/audiobooks')
    expect(Object.fromEntries(requestUrl.searchParams.entries())).toEqual({
      q: 'space opera',
      page: '2',
      limit: '48',
      sort: 'duration',
      order: 'desc',
      author: 'Ada Stone',
      narrator: 'Robin Miles',
      series: 'Wayfarers',
      language: 'en',
      format: 'm4b',
      hasCover: 'false',
    })
  })

  it('omits undefined, null, and blank audiobook query fields from the API URL', async () => {
    const page = makeCatalogPage()
    mocks.api.mockResolvedValueOnce(makeResponse(page))

    const { fetchCatalogSourceAudiobooks } = await import('../../api/catalog-source.api')
    const query = {
      q: 'covers',
      page: undefined,
      limit: null,
      sort: undefined,
      narrator: '   ',
      author: null,
      hasCover: true,
    } as unknown as WarehouseAudiobookCatalogQuery

    await fetchCatalogSourceAudiobooks(query)

    const requestUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(Object.fromEntries(requestUrl.searchParams.entries())).toEqual({
      q: 'covers',
      hasCover: 'true',
    })
    expect(requestUrl.searchParams.has('page')).toBe(false)
    expect(requestUrl.searchParams.has('limit')).toBe(false)
    expect(requestUrl.searchParams.has('sort')).toBe(false)
    expect(requestUrl.searchParams.has('narrator')).toBe(false)
    expect(requestUrl.searchParams.has('author')).toBe(false)
  })

  it('returns null for missing audiobook details and strips accidental raw payloads', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse(undefined, false, 404))

    const { fetchCatalogSourceAudiobook } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceAudiobook('missing/id')).resolves.toBeNull()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/catalog/audiobooks/missing%2Fid')

    const detail = makeCatalogDetail() as WarehouseAudiobookDetail & { raw?: unknown }
    detail.raw = { apiKey: 'do-not-expose' }
    mocks.api.mockResolvedValueOnce(makeResponse(detail))

    const loaded = await fetchCatalogSourceAudiobook('audio-23')
    expect(loaded).toEqual(makeCatalogDetail())
    expect(loaded).not.toHaveProperty('raw')
  })

  it('uses native library item copy when audiobook details fail to load', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse({ message: 'upstream details failed' }, false, 502))

    const { fetchCatalogSourceAudiobook } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceAudiobook('audio-23')).rejects.toThrow('Failed to load library item')
  })

  it('builds encoded audiobook binary URLs', async () => {
    const {
      catalogSourceAudiobookCoverUrl,
      catalogSourceAudiobookDownloadUrl,
      catalogSourceAudiobookFileDownloadUrl,
      catalogSourceAudiobookStreamUrl,
    } = await import('../../api/catalog-source.api')
    const remoteId = 'audio 1/with slash'
    const fileId = 'file 2/part'

    expect(catalogSourceAudiobookCoverUrl(remoteId)).toBe('/api/v1/libraries/audiobooks/items/audio%201%2Fwith%20slash/cover')
    expect(catalogSourceAudiobookStreamUrl(remoteId)).toBe('/api/v1/libraries/audiobooks/items/audio%201%2Fwith%20slash/stream')
    expect(catalogSourceAudiobookDownloadUrl(remoteId)).toBe('/api/v1/libraries/audiobooks/items/audio%201%2Fwith%20slash/download')
    expect(catalogSourceAudiobookFileDownloadUrl(remoteId, fileId)).toBe(
      '/api/v1/libraries/audiobooks/items/audio%201%2Fwith%20slash/files/file%202%2Fpart/download',
    )
  })
})

describe('useCatalogSourceAudiobooks', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchCatalogSourceAudiobooks.mockReset()
    mocks.fetchCatalogSourceAudiobook.mockReset()
    vi.doMock('../../api/catalog-source.api', () => ({
      fetchCatalogSourceAudiobooks: mocks.fetchCatalogSourceAudiobooks,
      fetchCatalogSourceAudiobook: mocks.fetchCatalogSourceAudiobook,
    }))
  })

  it('loads the first page on creation', async () => {
    const firstPage = makeCatalogPage({ limit: 12 })
    mocks.fetchCatalogSourceAudiobooks.mockResolvedValueOnce(firstPage)

    const { useCatalogSourceAudiobooks } = await import('../useCatalogSourceAudiobooks')
    const catalog = useCatalogSourceAudiobooks({ limit: 12 })

    expect(catalog.loading.value).toBe(true)

    await flushPromises()

    expect(mocks.fetchCatalogSourceAudiobooks).toHaveBeenCalledWith({ page: 1, limit: 12 })
    expect(catalog.page.value).toEqual(firstPage)
    expect(catalog.items.value).toEqual(firstPage.items)
    expect(catalog.error.value).toBeNull()
    expect(catalog.loading.value).toBe(false)
  })

  it('refreshes the current catalog query', async () => {
    const firstPage = makeCatalogPage({ total: 1 })
    const refreshedPage = makeCatalogPage({ total: 2, items: [makeCatalogItem(), makeCatalogItem({ id: 24, remoteId: 'audio-24' })] })
    mocks.fetchCatalogSourceAudiobooks.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(refreshedPage)

    const { useCatalogSourceAudiobooks } = await import('../useCatalogSourceAudiobooks')
    const catalog = useCatalogSourceAudiobooks({ q: 'orbit', limit: 10 })

    await flushPromises()
    await catalog.refresh()

    expect(mocks.fetchCatalogSourceAudiobooks).toHaveBeenNthCalledWith(1, { q: 'orbit', page: 1, limit: 10 })
    expect(mocks.fetchCatalogSourceAudiobooks).toHaveBeenNthCalledWith(2, { q: 'orbit', page: 1, limit: 10 })
    expect(catalog.page.value).toEqual(refreshedPage)
    expect(catalog.total.value).toBe(2)
  })

  it('searches from the first page and supports pagination', async () => {
    mocks.fetchCatalogSourceAudiobooks
      .mockResolvedValueOnce(makeCatalogPage())
      .mockResolvedValueOnce(makeCatalogPage({ page: 1, total: 30 }))
      .mockResolvedValueOnce(makeCatalogPage({ page: 2, total: 30 }))

    const { useCatalogSourceAudiobooks } = await import('../useCatalogSourceAudiobooks')
    const catalog = useCatalogSourceAudiobooks({ limit: 15 })

    await flushPromises()
    await catalog.search({ q: 'moon', narrator: 'Robin Miles', sort: 'duration', hasCover: true })
    await catalog.setPage(2)

    expect(mocks.fetchCatalogSourceAudiobooks).toHaveBeenNthCalledWith(2, {
      q: 'moon',
      narrator: 'Robin Miles',
      sort: 'duration',
      hasCover: true,
      page: 1,
      limit: 15,
    })
    expect(mocks.fetchCatalogSourceAudiobooks).toHaveBeenNthCalledWith(3, {
      q: 'moon',
      narrator: 'Robin Miles',
      sort: 'duration',
      hasCover: true,
      page: 2,
      limit: 15,
    })
    expect(catalog.currentPage.value).toBe(2)
  })

  it('preserves existing page data and sets a safe error on refresh failure', async () => {
    const firstPage = makeCatalogPage()
    mocks.fetchCatalogSourceAudiobooks.mockResolvedValueOnce(firstPage).mockRejectedValueOnce(new Error('Provider failed'))

    const { useCatalogSourceAudiobooks } = await import('../useCatalogSourceAudiobooks')
    const catalog = useCatalogSourceAudiobooks()

    await flushPromises()
    await catalog.refresh()

    expect(catalog.page.value).toEqual(firstPage)
    expect(catalog.error.value).toBe('Failed to load Audiobooks')
    expect(catalog.loading.value).toBe(false)
  })
})
