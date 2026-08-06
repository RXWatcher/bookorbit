import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WarehouseEbookCatalogItem, WarehouseEbookCatalogPage, WarehouseEbookCatalogQuery } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  fetchCatalogSourceEbooks: vi.fn<() => Promise<WarehouseEbookCatalogPage>>(),
  fetchCatalogSourceEbook: vi.fn<() => Promise<WarehouseEbookCatalogItem | null>>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

function makeCatalogItem(overrides: Partial<WarehouseEbookCatalogItem> = {}): WarehouseEbookCatalogItem {
  return {
    id: 17,
    remoteId: 'remote-17',
    title: 'The Long Way Home',
    subtitle: null,
    authors: ['Bea Morgan'],
    series: null,
    language: 'en',
    publisher: 'Orbit Press',
    identifiers: { isbn: '9780000000017' },
    format: 'epub',
    hasCover: true,
    syncedAt: '2026-06-01T12:00:00.000Z',
    source: 'catalog-source',
    ...overrides,
  }
}

function makeCatalogPage(overrides: Partial<WarehouseEbookCatalogPage> = {}): WarehouseEbookCatalogPage {
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

describe('catalog-source api', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../../api/catalog-source.api')
    mocks.api.mockReset()
  })

  it('encodes multiple query fields and boolean hasCover', async () => {
    const page = makeCatalogPage()
    mocks.api.mockResolvedValueOnce(makeResponse(page))

    const { fetchCatalogSourceEbooks } = await import('../../api/catalog-source.api')

    await expect(
      fetchCatalogSourceEbooks({
        q: 'space opera',
        page: 2,
        limit: 48,
        sort: 'series',
        order: 'desc',
        author: 'Ada Stone',
        series: 'Wayfarers',
        language: 'en',
        format: 'epub',
        hasCover: false,
      }),
    ).resolves.toEqual(page)

    const requestUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(requestUrl.pathname).toBe('/api/v1/catalog/ebooks')
    expect(Object.fromEntries(requestUrl.searchParams.entries())).toEqual({
      q: 'space opera',
      page: '2',
      limit: '48',
      sort: 'series',
      order: 'desc',
      author: 'Ada Stone',
      series: 'Wayfarers',
      language: 'en',
      format: 'epub',
      hasCover: 'false',
    })
  })

  it('omits undefined and null query fields from the API URL', async () => {
    const page = makeCatalogPage()
    mocks.api.mockResolvedValueOnce(makeResponse(page))

    const { fetchCatalogSourceEbooks } = await import('../../api/catalog-source.api')
    const query = {
      q: 'covers',
      page: undefined,
      limit: null,
      sort: undefined,
      author: null,
      hasCover: true,
    } as unknown as WarehouseEbookCatalogQuery

    await fetchCatalogSourceEbooks(query)

    const requestUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(Object.fromEntries(requestUrl.searchParams.entries())).toEqual({
      q: 'covers',
      hasCover: 'true',
    })
    expect(requestUrl.searchParams.has('page')).toBe(false)
    expect(requestUrl.searchParams.has('limit')).toBe(false)
    expect(requestUrl.searchParams.has('sort')).toBe(false)
    expect(requestUrl.searchParams.has('author')).toBe(false)
  })

  it('throws a native catalog error for non-ok list responses', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse({ message: 'Warehouse source failed' }, false, 503))

    const { fetchCatalogSourceEbooks } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceEbooks({ q: 'nebula' })).rejects.toThrow('Failed to load ebook catalog')
  })

  it('returns null for missing catalog ebook details', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse(undefined, false, 404))

    const { fetchCatalogSourceEbook } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceEbook('missing/id')).resolves.toBeNull()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/catalog/ebooks/missing%2Fid')
  })

  it('uses native library item copy when ebook details fail to load', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse({ message: 'upstream details failed' }, false, 502))

    const { fetchCatalogSourceEbook } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceEbook('book-23')).rejects.toThrow('Failed to load library item')
  })

  it('builds encoded ebook media URLs', async () => {
    const { catalogSourceEbookCoverUrl, catalogSourceEbookDownloadUrl } = await import('../../api/catalog-source.api')
    const remoteId = 'book 1/with slash'

    expect(catalogSourceEbookCoverUrl(remoteId, 'medium')).toBe('/api/v1/libraries/ebooks/items/book%201%2Fwith%20slash/cover/medium')
    expect(catalogSourceEbookDownloadUrl(remoteId)).toBe('/api/v1/libraries/ebooks/items/book%201%2Fwith%20slash/download')
  })
})

describe('useCatalogSourceEbooks', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchCatalogSourceEbooks.mockReset()
    mocks.fetchCatalogSourceEbook.mockReset()
    vi.doMock('../../api/catalog-source.api', () => ({
      fetchCatalogSourceEbooks: mocks.fetchCatalogSourceEbooks,
      fetchCatalogSourceEbook: mocks.fetchCatalogSourceEbook,
    }))
  })

  it('loads the first page on creation', async () => {
    const firstPage = makeCatalogPage({ limit: 12 })
    mocks.fetchCatalogSourceEbooks.mockResolvedValueOnce(firstPage)

    const { useCatalogSourceEbooks } = await import('../useCatalogSourceEbooks')
    const catalog = useCatalogSourceEbooks({ limit: 12 })

    expect(catalog.loading.value).toBe(true)

    await flushPromises()

    expect(mocks.fetchCatalogSourceEbooks).toHaveBeenCalledWith({ page: 1, limit: 12 })
    expect(catalog.page.value).toEqual(firstPage)
    expect(catalog.items.value).toEqual(firstPage.items)
    expect(catalog.error.value).toBeNull()
    expect(catalog.loading.value).toBe(false)
  })

  it('refreshes the current catalog query', async () => {
    const firstPage = makeCatalogPage({ total: 1 })
    const refreshedPage = makeCatalogPage({ total: 2, items: [makeCatalogItem(), makeCatalogItem({ id: 18, remoteId: 'remote-18' })] })
    mocks.fetchCatalogSourceEbooks.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(refreshedPage)

    const { useCatalogSourceEbooks } = await import('../useCatalogSourceEbooks')
    const catalog = useCatalogSourceEbooks({ q: 'orbit', limit: 10 })

    await flushPromises()
    await catalog.refresh()

    expect(mocks.fetchCatalogSourceEbooks).toHaveBeenNthCalledWith(1, { q: 'orbit', page: 1, limit: 10 })
    expect(mocks.fetchCatalogSourceEbooks).toHaveBeenNthCalledWith(2, { q: 'orbit', page: 1, limit: 10 })
    expect(catalog.page.value).toEqual(refreshedPage)
    expect(catalog.total.value).toBe(2)
  })

  it('searches from the first page and supports pagination', async () => {
    mocks.fetchCatalogSourceEbooks
      .mockResolvedValueOnce(makeCatalogPage())
      .mockResolvedValueOnce(makeCatalogPage({ page: 1, total: 30 }))
      .mockResolvedValueOnce(makeCatalogPage({ page: 2, total: 30 }))

    const { useCatalogSourceEbooks } = await import('../useCatalogSourceEbooks')
    const catalog = useCatalogSourceEbooks({ limit: 15 })

    await flushPromises()
    await catalog.search({ q: 'moon', author: 'Ada Stone', hasCover: true })
    await catalog.setPage(2)

    expect(mocks.fetchCatalogSourceEbooks).toHaveBeenNthCalledWith(2, {
      q: 'moon',
      author: 'Ada Stone',
      hasCover: true,
      page: 1,
      limit: 15,
    })
    expect(mocks.fetchCatalogSourceEbooks).toHaveBeenNthCalledWith(3, {
      q: 'moon',
      author: 'Ada Stone',
      hasCover: true,
      page: 2,
      limit: 15,
    })
    expect(catalog.currentPage.value).toBe(2)
  })

  it('preserves existing page data and sets a safe error on refresh failure', async () => {
    const firstPage = makeCatalogPage()
    mocks.fetchCatalogSourceEbooks.mockResolvedValueOnce(firstPage).mockRejectedValueOnce(new Error('Warehouse source failed'))

    const { useCatalogSourceEbooks } = await import('../useCatalogSourceEbooks')
    const catalog = useCatalogSourceEbooks()

    await flushPromises()
    await catalog.refresh()

    expect(catalog.page.value).toEqual(firstPage)
    expect(catalog.error.value).toBe('Failed to load Books')
    expect(catalog.loading.value).toBe(false)
  })
})
