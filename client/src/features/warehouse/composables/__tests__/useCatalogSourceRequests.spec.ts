import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WarehouseEbookExternalSearchPage,
  WarehouseEbookRequestSubmitPayload,
  WarehouseComicRequestSubmitPayload,
  WarehouseRequestDetail,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
} from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  cancelCatalogSourceRequest: vi.fn<(id: number) => Promise<WarehouseRequestDetail>>(),
  submitCatalogSourceComicRequest: vi.fn<(payload: WarehouseComicRequestSubmitPayload) => Promise<WarehouseRequestDetail>>(),
  fetchCatalogSourceRequests: vi.fn<(query: WarehouseRequestListQuery) => Promise<WarehouseRequestPage>>(),
  refreshCatalogSourceComicRequests: vi.fn<(query?: WarehouseRequestListQuery) => Promise<WarehouseRequestPage>>(),
  refreshCatalogSourceRequest: vi.fn<(id: number) => Promise<WarehouseRequestDetail>>(),
  searchCatalogSourceRequestBooks: vi.fn<(q: string) => Promise<WarehouseEbookExternalSearchPage>>(),
  submitCatalogSourceEbookRequest: vi.fn<(payload: WarehouseEbookRequestSubmitPayload) => Promise<WarehouseRequestDetail>>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

function makeRequest(overrides: Partial<WarehouseRequestDetail> = {}): WarehouseRequestDetail {
  return {
    id: 37,
    mediaType: 'ebook',
    status: 'pending',
    title: 'A Psalm for the Wild-Built',
    author: 'Becky Chambers',
    isbn: '9781250236210',
    completedRemoteId: null,
    requestedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    lastStatusSyncedAt: null,
    requestedPayload: {
      isbn: '9781250236210',
      preferredFormat: 'epub',
      searchResult: {
        title: 'A Psalm for the Wild-Built',
        author: 'Becky Chambers',
        isbn: '9781250236210',
      },
    },
    ...overrides,
  }
}

function makeRequestPage(overrides: Partial<WarehouseRequestPage> = {}): WarehouseRequestPage {
  return {
    items: [makeRequest()],
    page: 1,
    limit: 24,
    total: 1,
    ...overrides,
  }
}

function makeSearchPage(): WarehouseEbookExternalSearchPage {
  return {
    results: [
      {
        title: 'A Psalm for the Wild-Built',
        author: 'Becky Chambers',
        isbn: '9781250236210',
      },
    ],
  }
}

function makeResponse(data?: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('catalog-source request api', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../../api/catalog-source.api')
    mocks.api.mockReset()
  })

  it('encodes request search and list query fields while omitting blank fields', async () => {
    const searchPage = makeSearchPage()
    const requestPage = makeRequestPage()
    mocks.api.mockResolvedValueOnce(makeResponse(searchPage)).mockResolvedValueOnce(makeResponse(requestPage))

    const { fetchCatalogSourceRequests, searchCatalogSourceRequestBooks } = await import('../../api/catalog-source.api')

    await expect(searchCatalogSourceRequestBooks('psalm & robot')).resolves.toEqual(searchPage)
    await expect(
      fetchCatalogSourceRequests({
        status: 'pending',
        page: 2,
        limit: 12,
        mediaType: 'ebook',
        ignored: undefined,
        blank: '   ',
        nil: null,
      } as WarehouseRequestListQuery),
    ).resolves.toEqual(requestPage)

    const searchUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(searchUrl.pathname).toBe('/api/v1/catalog/requests/ebooks/search')
    expect(searchUrl.searchParams.get('q')).toBe('psalm & robot')

    const listUrl = new URL(String(mocks.api.mock.calls[1]?.[0]), 'http://bookorbit.test')
    expect(listUrl.pathname).toBe('/api/v1/catalog/requests')
    expect(Object.fromEntries(listUrl.searchParams.entries())).toEqual({
      status: 'pending',
      page: '2',
      limit: '12',
      mediaType: 'ebook',
    })
    expect(listUrl.searchParams.has('ignored')).toBe(false)
    expect(listUrl.searchParams.has('blank')).toBe(false)
    expect(listUrl.searchParams.has('nil')).toBe(false)
  })

  it('loads comic requests from the normal-user comic request route', async () => {
    const requestPage = makeRequestPage({
      items: [makeRequest({ id: 51, mediaType: 'comic', title: 'Saga #1', author: 'Image', completedRemoteId: 'comic-1' })],
    })
    mocks.api.mockResolvedValueOnce(makeResponse(requestPage))

    const { fetchCatalogSourceComicRequests } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceComicRequests({ status: 'completed', page: 3, limit: 10 })).resolves.toEqual(requestPage)

    const listUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(listUrl.pathname).toBe('/api/v1/catalog/requests/comics')
    expect(Object.fromEntries(listUrl.searchParams.entries())).toEqual({
      status: 'completed',
      page: '3',
      limit: '10',
    })
  })

  it('keeps comic media filters on the generic request list route', async () => {
    const requestPage = makeRequestPage({
      items: [makeRequest({ id: 51, mediaType: 'comic', title: 'Saga #1', author: 'Image', completedRemoteId: 'comic-1' })],
    })
    mocks.api.mockResolvedValueOnce(makeResponse(requestPage))

    const { fetchCatalogSourceRequests } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceRequests({ mediaType: 'comic', status: 'pending', page: 2, limit: 10 })).resolves.toEqual(requestPage)

    const listUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(listUrl.pathname).toBe('/api/v1/catalog/requests')
    expect(Object.fromEntries(listUrl.searchParams.entries())).toEqual({
      mediaType: 'comic',
      status: 'pending',
      page: '2',
      limit: '10',
    })
  })

  it('refreshes comic requests through the normal-user comic refresh route', async () => {
    const requestPage = makeRequestPage({
      items: [makeRequest({ id: 51, mediaType: 'comic', title: 'Saga #1', author: 'Image', completedRemoteId: 'comic-1' })],
    })
    mocks.api.mockResolvedValueOnce(makeResponse(requestPage))

    const { refreshCatalogSourceComicRequests } = await import('../../api/catalog-source.api')

    await expect(refreshCatalogSourceComicRequests({ status: 'completed', page: 3, limit: 10 })).resolves.toEqual(requestPage)

    const refreshUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(refreshUrl.pathname).toBe('/api/v1/catalog/requests/comics/refresh')
    expect(Object.fromEntries(refreshUrl.searchParams.entries())).toEqual({
      status: 'completed',
      page: '3',
      limit: '10',
    })
    expect(mocks.api.mock.calls[0]?.[1]).toEqual({ method: 'POST' })
  })

  it('submits comic requests to the normal-user comic request route with only supported fields', async () => {
    const detail = makeRequest({
      id: 52,
      mediaType: 'comic',
      title: 'Saga #1',
      author: 'Image',
      requestedPayload: { seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 },
    })
    mocks.api.mockResolvedValueOnce(makeResponse(detail))

    const { submitCatalogSourceComicRequest } = await import('../../api/catalog-source.api')

    await expect(
      submitCatalogSourceComicRequest({
        seriesTitle: 'Saga',
        issueNumber: '1',
        publisher: 'Image',
        year: 2012,
        ignored: 'nope',
      } as WarehouseComicRequestSubmitPayload & Record<string, unknown>),
    ).resolves.toEqual(detail)

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/catalog/requests/comics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 }),
    })
  })

  it('submits only native ebook request payload fields', async () => {
    const detail = makeRequest()
    const payload: WarehouseEbookRequestSubmitPayload = {
      isbn: '9781250236210',
      preferredFormat: 'epub',
      searchResult: {
        title: 'A Psalm for the Wild-Built',
        author: 'Becky Chambers',
        isbn: '9781250236210',
      },
    }
    mocks.api.mockResolvedValueOnce(makeResponse(detail))

    const { submitCatalogSourceEbookRequest } = await import('../../api/catalog-source.api')

    await expect(submitCatalogSourceEbookRequest(payload)).resolves.toEqual(detail)

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/catalog/requests/ebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(JSON.parse(String(mocks.api.mock.calls[0]?.[1]?.body))).toHaveProperty('preferredFormat', 'epub')
    expect(JSON.parse(String(mocks.api.mock.calls[0]?.[1]?.body))).not.toHaveProperty('preferred_format')
  })

  it('returns null on missing request detail and builds encoded stream URLs', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse(undefined, false, 404))

    const { catalogSourceRequestStreamUrl, fetchCatalogSourceRequest } = await import('../../api/catalog-source.api')

    await expect(fetchCatalogSourceRequest(404)).resolves.toBeNull()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/catalog/requests/404')
    expect(catalogSourceRequestStreamUrl(10.5)).toBe('/api/v1/requests/10.5/stream')
  })
})

describe('useCatalogSourceRequests', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.cancelCatalogSourceRequest.mockReset()
    mocks.submitCatalogSourceComicRequest.mockReset()
    mocks.fetchCatalogSourceRequests.mockReset()
    mocks.refreshCatalogSourceRequest.mockReset()
    mocks.searchCatalogSourceRequestBooks.mockReset()
    mocks.submitCatalogSourceEbookRequest.mockReset()
    vi.doMock('../../api/catalog-source.api', () => ({
      cancelCatalogSourceRequest: mocks.cancelCatalogSourceRequest,
      fetchCatalogSourceRequests: mocks.fetchCatalogSourceRequests,
      refreshCatalogSourceRequest: mocks.refreshCatalogSourceRequest,
      searchCatalogSourceRequestBooks: mocks.searchCatalogSourceRequestBooks,
      submitCatalogSourceComicRequest: mocks.submitCatalogSourceComicRequest,
      submitCatalogSourceEbookRequest: mocks.submitCatalogSourceEbookRequest,
    }))
  })

  it('loads initial page and supports search, submit, refresh, cancel, and pagination', async () => {
    const initialPage = makeRequestPage({ limit: 10 })
    const submitted = makeRequest({ id: 38, title: 'Record of a Spaceborn Few' })
    const refreshed = makeRequest({ id: 37, status: 'processing', lastStatusSyncedAt: '2026-06-02T12:00:00.000Z' })
    const cancelled = makeRequest({ id: 37, status: 'cancelled' })
    const secondPage = makeRequestPage({ page: 2, limit: 10, total: 26, items: [makeRequest({ id: 39, title: 'To Be Taught' })] })
    mocks.fetchCatalogSourceRequests.mockResolvedValueOnce(initialPage).mockResolvedValueOnce(secondPage)
    mocks.searchCatalogSourceRequestBooks.mockResolvedValueOnce(makeSearchPage())
    mocks.submitCatalogSourceEbookRequest.mockResolvedValueOnce(submitted)
    mocks.refreshCatalogSourceRequest.mockResolvedValueOnce(refreshed)
    mocks.cancelCatalogSourceRequest.mockResolvedValueOnce(cancelled)

    const { useCatalogSourceRequests } = await import('../useCatalogSourceRequests')
    const requests = useCatalogSourceRequests({ status: 'pending', limit: 10 })

    expect(requests.loading.value).toBe(true)

    await flushPromises()
    const searchPage = await requests.searchExternal('psalm')
    const submittedRequest = await requests.submit({ isbn: '9780062936028', preferredFormat: 'epub' })
    const refreshedRequest = await requests.refreshRequest(37)
    const cancelledRequest = await requests.cancelRequest(37)

    expect(mocks.fetchCatalogSourceRequests).toHaveBeenNthCalledWith(1, { status: 'pending', page: 1, limit: 10 })
    expect(mocks.searchCatalogSourceRequestBooks).toHaveBeenCalledWith('psalm')
    expect(searchPage).toEqual(makeSearchPage())
    expect(submittedRequest).toEqual(submitted)
    expect(requests.items.value.find((item) => item.id === 37)).toEqual(cancelled)
    expect(requests.items.value).toContainEqual(submitted)
    expect(refreshedRequest).toEqual(refreshed)
    expect(cancelledRequest).toEqual(cancelled)

    await requests.setPage(2)

    expect(mocks.fetchCatalogSourceRequests).toHaveBeenNthCalledWith(2, { status: 'pending', page: 2, limit: 10 })
    expect(requests.page.value).toEqual(secondPage)
    expect(requests.currentPage.value).toBe(2)
    expect(requests.total.value).toBe(26)
    expect(requests.error.value).toBeNull()
    expect(requests.loading.value).toBe(false)
  })

  it('updates the server query for status filters and keeps pagination scoped to that filter', async () => {
    const initialPage = makeRequestPage({ limit: 10 })
    const filteredPage = makeRequestPage({ items: [makeRequest({ id: 41, status: 'failed', title: 'Missing Book' })], limit: 10 })
    const filteredSecondPage = makeRequestPage({
      page: 2,
      limit: 10,
      total: 16,
      items: [makeRequest({ id: 42, status: 'failed', title: 'Still Missing' })],
    })
    mocks.fetchCatalogSourceRequests.mockResolvedValueOnce(initialPage).mockResolvedValueOnce(filteredPage).mockResolvedValueOnce(filteredSecondPage)

    const { useCatalogSourceRequests } = await import('../useCatalogSourceRequests')
    const requests = useCatalogSourceRequests({ limit: 10 })

    await flushPromises()
    await requests.setQuery({ status: 'failed', page: 1, limit: 10 })
    await requests.setPage(2)

    expect(mocks.fetchCatalogSourceRequests).toHaveBeenNthCalledWith(2, { status: 'failed', page: 1, limit: 10 })
    expect(mocks.fetchCatalogSourceRequests).toHaveBeenNthCalledWith(3, { status: 'failed', page: 2, limit: 10 })
    expect(requests.page.value).toEqual(filteredSecondPage)
  })

  it('keeps a submitted request when an older in-flight list load resolves with stale data', async () => {
    const initialLoad = deferred<WarehouseRequestPage>()
    const submitted = makeRequest({ id: 38, title: 'Record of a Spaceborn Few' })
    const stalePage = makeRequestPage({ items: [makeRequest({ id: 37, title: 'Older Request' })] })
    mocks.fetchCatalogSourceRequests.mockReturnValueOnce(initialLoad.promise)
    mocks.submitCatalogSourceEbookRequest.mockResolvedValueOnce(submitted)

    const { useCatalogSourceRequests } = await import('../useCatalogSourceRequests')
    const requests = useCatalogSourceRequests()

    expect(requests.loading.value).toBe(true)

    await requests.submit({ isbn: '9780062936028', preferredFormat: 'epub' })

    expect(requests.items.value).toContainEqual(submitted)

    initialLoad.resolve(stalePage)
    await flushPromises()

    expect(requests.items.value).toContainEqual(submitted)
    expect(requests.page.value).not.toEqual(stalePage)
    expect(requests.loading.value).toBe(false)
  })

  it.each([
    {
      action: 'refreshRequest',
      arrange: (request: WarehouseRequestDetail) => mocks.refreshCatalogSourceRequest.mockResolvedValueOnce(request),
      mutate: (requests: ReturnType<(typeof import('../useCatalogSourceRequests'))['useCatalogSourceRequests']>, request: WarehouseRequestDetail) =>
        requests.refreshRequest(request.id),
    },
    {
      action: 'cancelRequest',
      arrange: (request: WarehouseRequestDetail) => mocks.cancelCatalogSourceRequest.mockResolvedValueOnce(request),
      mutate: (requests: ReturnType<(typeof import('../useCatalogSourceRequests'))['useCatalogSourceRequests']>, request: WarehouseRequestDetail) =>
        requests.cancelRequest(request.id),
    },
  ])('keeps a $action update when an older in-flight list load resolves with stale data', async ({ arrange, mutate }) => {
    const initialLoad = deferred<WarehouseRequestPage>()
    const updated = makeRequest({ id: 37, status: 'processing', updatedAt: '2026-06-02T12:00:00.000Z' })
    const stalePage = makeRequestPage({ items: [makeRequest({ id: 37, status: 'pending' })] })
    mocks.fetchCatalogSourceRequests.mockReturnValueOnce(initialLoad.promise)
    arrange(updated)

    const { useCatalogSourceRequests } = await import('../useCatalogSourceRequests')
    const requests = useCatalogSourceRequests()

    await mutate(requests, updated)

    expect(requests.items.value).toContainEqual(updated)

    initialLoad.resolve(stalePage)
    await flushPromises()

    expect(requests.items.value).toContainEqual(updated)
    expect(requests.page.value).not.toEqual(stalePage)
    expect(requests.loading.value).toBe(false)
  })

  it('preserves stale list data and sets safe errors on failures', async () => {
    const initialPage = makeRequestPage()
    mocks.fetchCatalogSourceRequests.mockResolvedValueOnce(initialPage).mockRejectedValueOnce(new Error('Provider failed'))
    mocks.searchCatalogSourceRequestBooks.mockRejectedValueOnce(new Error('Upstream unavailable'))

    const { useCatalogSourceRequests } = await import('../useCatalogSourceRequests')
    const requests = useCatalogSourceRequests()

    await flushPromises()
    await requests.refresh()

    expect(requests.page.value).toEqual(initialPage)
    expect(requests.error.value).toBe('Failed to load requests')

    await expect(requests.searchExternal('psalm')).rejects.toThrow('Failed to search titles')
    expect(requests.error.value).toBe('Failed to search titles')
    expect(requests.page.value).toEqual(initialPage)
  })

  it('keeps visible copy free from private source wording', async () => {
    const { CATALOG_REQUEST_ERROR_MESSAGES } = await import('../useCatalogSourceRequests')
    const text = Object.values(CATALOG_REQUEST_ERROR_MESSAGES).join('\n')

    expect(text).not.toMatch(/Book Warehouse|upstream|third-party|provider|source|catalog/i)
  })
})

describe('useCatalogSourceComicRequests', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchCatalogSourceRequests.mockReset()
    mocks.submitCatalogSourceComicRequest.mockReset()
    mocks.refreshCatalogSourceComicRequests.mockReset()
    vi.doMock('../../api/catalog-source.api', () => ({
      fetchCatalogSourceComicRequests: mocks.fetchCatalogSourceRequests,
      refreshCatalogSourceComicRequests: mocks.refreshCatalogSourceComicRequests,
      submitCatalogSourceComicRequest: mocks.submitCatalogSourceComicRequest,
    }))
  })

  it('submits a comic request and inserts the safe local row', async () => {
    const initialPage = makeRequestPage({ items: [], total: 0 })
    const submitted = makeRequest({
      id: 53,
      mediaType: 'comic',
      title: 'Saga #1',
      author: 'Image',
      requestedPayload: { seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 },
    })
    mocks.fetchCatalogSourceRequests.mockResolvedValueOnce(initialPage)
    mocks.submitCatalogSourceComicRequest.mockResolvedValueOnce(submitted)

    const { useCatalogSourceComicRequests } = await import('../useCatalogSourceComicRequests')
    const requests = useCatalogSourceComicRequests()

    await flushPromises()
    const result = await requests.submit({ seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 })

    expect(mocks.submitCatalogSourceComicRequest).toHaveBeenCalledWith({ seriesTitle: 'Saga', issueNumber: '1', publisher: 'Image', year: 2012 })
    expect(result).toEqual(submitted)
    expect(requests.items.value).toEqual([submitted])
    expect(requests.total.value).toBe(1)
  })

  it('refreshes comic statuses and replaces the local page', async () => {
    const initialPage = makeRequestPage({
      items: [makeRequest({ id: 53, mediaType: 'comic', title: 'Saga #1', status: 'processing' })],
      total: 1,
    })
    const refreshedPage = makeRequestPage({
      items: [makeRequest({ id: 53, mediaType: 'comic', title: 'Saga #1', status: 'completed', completedRemoteId: 'comic-1' })],
      total: 1,
    })
    mocks.fetchCatalogSourceRequests.mockResolvedValueOnce(initialPage)
    mocks.refreshCatalogSourceComicRequests.mockResolvedValueOnce(refreshedPage)

    const { useCatalogSourceComicRequests } = await import('../useCatalogSourceComicRequests')
    const requests = useCatalogSourceComicRequests({ status: 'processing', page: 2, limit: 12 })

    await flushPromises()
    await expect(requests.refreshStatuses()).resolves.toEqual(refreshedPage)

    expect(mocks.refreshCatalogSourceComicRequests).toHaveBeenCalledWith({ status: 'processing', page: 1, limit: 12 })
    expect(requests.page.value).toEqual(refreshedPage)
    expect(requests.error.value).toBeNull()
  })
})
