import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WarehouseAudiobookExternalSearchPage,
  WarehouseAudiobookQueuePage,
  WarehouseAudiobookRequestSubmitPayload,
  WarehouseRequestDetail,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
} from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  fetchCatalogSourceAudiobookRequestQueue: vi.fn<() => Promise<WarehouseAudiobookQueuePage>>(),
  fetchCatalogSourceAudiobookRequests: vi.fn<(query: WarehouseRequestListQuery) => Promise<WarehouseRequestPage>>(),
  refreshCatalogSourceAudiobookRequests: vi.fn<(query?: WarehouseRequestListQuery) => Promise<WarehouseRequestPage>>(),
  searchCatalogSourceRequestAudiobookCandidates: vi.fn<(q: string) => Promise<WarehouseAudiobookExternalSearchPage>>(),
  searchCatalogSourceRequestAudiobooks: vi.fn<(q: string) => Promise<WarehouseAudiobookExternalSearchPage>>(),
  submitCatalogSourceAudiobookRequest: vi.fn<(payload: WarehouseAudiobookRequestSubmitPayload) => Promise<WarehouseRequestDetail>>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

function makeRequest(overrides: Partial<WarehouseRequestDetail> = {}): WarehouseRequestDetail {
  return {
    id: 37,
    mediaType: 'audiobook',
    status: 'pending',
    title: 'Murderbot Diaries',
    author: 'Martha Wells',
    isbn: null,
    completedRemoteId: null,
    requestedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    lastStatusSyncedAt: null,
    requestedPayload: {
      title: 'Murderbot Diaries',
      author: 'Martha Wells',
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

function makeSearchPage(): WarehouseAudiobookExternalSearchPage {
  return {
    results: [
      {
        title: 'Murderbot Diaries',
        author: 'Martha Wells',
        authors: ['Martha Wells'],
        narrators: ['Kevin R. Free'],
        asin: 'B076XSGP65',
        series: 'The Murderbot Diaries',
        durationSeconds: 56160,
      },
    ],
  }
}

function makeQueuePage(overrides: Partial<WarehouseAudiobookQueuePage> = {}): WarehouseAudiobookQueuePage {
  return {
    items: [
      {
        title: 'Murderbot Diaries',
        author: 'Martha Wells',
        status: 'processing',
      },
    ],
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('catalog-source audiobook request api', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../../api/catalog-source.api')
    mocks.api.mockReset()
  })

  it('encodes audiobook request query fields while omitting blank fields', async () => {
    const searchPage = makeSearchPage()
    const candidatePage = makeSearchPage()
    const requestPage = makeRequestPage()
    const refreshedPage = makeRequestPage({ page: 3 })
    const queuePage = makeQueuePage()
    mocks.api
      .mockResolvedValueOnce(makeResponse(searchPage))
      .mockResolvedValueOnce(makeResponse(candidatePage))
      .mockResolvedValueOnce(makeResponse(requestPage))
      .mockResolvedValueOnce(makeResponse(refreshedPage))
      .mockResolvedValueOnce(makeResponse(queuePage))

    const {
      fetchCatalogSourceAudiobookRequestQueue,
      fetchCatalogSourceAudiobookRequests,
      refreshCatalogSourceAudiobookRequests,
      searchCatalogSourceRequestAudiobookCandidates,
      searchCatalogSourceRequestAudiobooks,
    } = await import('../../api/catalog-source.api')

    await expect(searchCatalogSourceRequestAudiobooks('murderbot & tea')).resolves.toEqual(searchPage)
    await expect(searchCatalogSourceRequestAudiobookCandidates('space opera')).resolves.toEqual(candidatePage)
    await expect(
      fetchCatalogSourceAudiobookRequests({
        status: 'pending',
        page: 2,
        limit: 12,
        ignored: undefined,
        blank: '   ',
        nil: null,
      } as WarehouseRequestListQuery),
    ).resolves.toEqual(requestPage)
    await expect(
      refreshCatalogSourceAudiobookRequests({
        status: 'completed',
        page: 3,
        limit: 6,
        blank: '',
      } as WarehouseRequestListQuery),
    ).resolves.toEqual(refreshedPage)
    await expect(fetchCatalogSourceAudiobookRequestQueue()).resolves.toEqual(queuePage)

    const searchUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(searchUrl.pathname).toBe('/api/v1/catalog/requests/audiobooks/search')
    expect(searchUrl.searchParams.get('q')).toBe('murderbot & tea')

    const candidatesUrl = new URL(String(mocks.api.mock.calls[1]?.[0]), 'http://bookorbit.test')
    expect(candidatesUrl.pathname).toBe('/api/v1/catalog/requests/audiobooks/candidates')
    expect(candidatesUrl.searchParams.get('q')).toBe('space opera')

    const listUrl = new URL(String(mocks.api.mock.calls[2]?.[0]), 'http://bookorbit.test')
    expect(listUrl.pathname).toBe('/api/v1/catalog/requests/audiobooks')
    expect(Object.fromEntries(listUrl.searchParams.entries())).toEqual({
      status: 'pending',
      page: '2',
      limit: '12',
    })

    const refreshUrl = new URL(String(mocks.api.mock.calls[3]?.[0]), 'http://bookorbit.test')
    expect(refreshUrl.pathname).toBe('/api/v1/catalog/requests/audiobooks/refresh')
    expect(Object.fromEntries(refreshUrl.searchParams.entries())).toEqual({
      status: 'completed',
      page: '3',
      limit: '6',
    })

    expect(mocks.api.mock.calls[4]?.[0]).toBe('/api/v1/catalog/requests/audiobooks/queue')
  })

  it('submits only audiobook request title and optional author fields', async () => {
    const detail = makeRequest()
    const payload = {
      title: 'Murderbot Diaries',
      author: 'Martha Wells',
      warehouse: 'hidden',
      provider: 'hidden',
      source: 'hidden',
      vendor: 'hidden',
    } as WarehouseAudiobookRequestSubmitPayload & Record<string, unknown>
    mocks.api.mockResolvedValueOnce(makeResponse(detail))

    const { submitCatalogSourceAudiobookRequest } = await import('../../api/catalog-source.api')

    await expect(submitCatalogSourceAudiobookRequest(payload)).resolves.toEqual(detail)

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/catalog/requests/audiobooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Murderbot Diaries',
        author: 'Martha Wells',
      }),
    })
  })

  it('omits blank audiobook search and list query values', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse(makeSearchPage())).mockResolvedValueOnce(makeResponse(makeRequestPage()))

    const { fetchCatalogSourceAudiobookRequests, searchCatalogSourceRequestAudiobooks } = await import('../../api/catalog-source.api')

    await searchCatalogSourceRequestAudiobooks('   ')
    await fetchCatalogSourceAudiobookRequests({ status: '   ', page: undefined, limit: null } as unknown as WarehouseRequestListQuery)

    const searchUrl = new URL(String(mocks.api.mock.calls[0]?.[0]), 'http://bookorbit.test')
    expect(searchUrl.pathname).toBe('/api/v1/catalog/requests/audiobooks/search')
    expect([...searchUrl.searchParams.entries()]).toEqual([])

    const listUrl = new URL(String(mocks.api.mock.calls[1]?.[0]), 'http://bookorbit.test')
    expect(listUrl.pathname).toBe('/api/v1/catalog/requests/audiobooks')
    expect([...listUrl.searchParams.entries()]).toEqual([])
  })

  it.each([
    {
      arrange: async () => (await import('../../api/catalog-source.api')).fetchCatalogSourceAudiobookRequests({}),
      fallback: 'Failed to load requests',
    },
    {
      arrange: async () => (await import('../../api/catalog-source.api')).searchCatalogSourceRequestAudiobooks('murderbot'),
      fallback: 'Failed to search titles',
    },
    {
      arrange: async () => (await import('../../api/catalog-source.api')).searchCatalogSourceRequestAudiobookCandidates('murderbot'),
      fallback: 'Failed to search candidates',
    },
    {
      arrange: async () => (await import('../../api/catalog-source.api')).submitCatalogSourceAudiobookRequest({ title: 'Murderbot' }),
      fallback: 'Failed to submit request',
    },
    {
      arrange: async () => (await import('../../api/catalog-source.api')).refreshCatalogSourceAudiobookRequests(),
      fallback: 'Failed to refresh requests',
    },
    {
      arrange: async () => (await import('../../api/catalog-source.api')).fetchCatalogSourceAudiobookRequestQueue(),
      fallback: 'Failed to load queue',
    },
  ])('throws safe fallback error $fallback', async ({ arrange, fallback }) => {
    mocks.api.mockResolvedValueOnce(makeResponse({ message: 'Private failure detail' }, false, 500))

    await expect(arrange()).rejects.toThrow(fallback)
  })
})

describe('useCatalogSourceAudiobookRequests', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.fetchCatalogSourceAudiobookRequestQueue.mockReset()
    mocks.fetchCatalogSourceAudiobookRequests.mockReset()
    mocks.refreshCatalogSourceAudiobookRequests.mockReset()
    mocks.searchCatalogSourceRequestAudiobookCandidates.mockReset()
    mocks.searchCatalogSourceRequestAudiobooks.mockReset()
    mocks.submitCatalogSourceAudiobookRequest.mockReset()
    vi.doMock('../../api/catalog-source.api', () => ({
      fetchCatalogSourceAudiobookRequestQueue: mocks.fetchCatalogSourceAudiobookRequestQueue,
      fetchCatalogSourceAudiobookRequests: mocks.fetchCatalogSourceAudiobookRequests,
      refreshCatalogSourceAudiobookRequests: mocks.refreshCatalogSourceAudiobookRequests,
      searchCatalogSourceRequestAudiobookCandidates: mocks.searchCatalogSourceRequestAudiobookCandidates,
      searchCatalogSourceRequestAudiobooks: mocks.searchCatalogSourceRequestAudiobooks,
      submitCatalogSourceAudiobookRequest: mocks.submitCatalogSourceAudiobookRequest,
    }))
  })

  it('loads initial request page and queue, then supports search, submit, status refresh, queue refresh, and pagination', async () => {
    const initialPage = makeRequestPage({ limit: 10 })
    const initialQueue = makeQueuePage()
    const submitted = makeRequest({ id: 38, title: 'System Collapse' })
    const statusesPage = makeRequestPage({
      items: [makeRequest({ id: 37, status: 'processing', lastStatusSyncedAt: '2026-06-02T12:00:00.000Z' }), submitted],
      total: 2,
    })
    const refreshedQueue = makeQueuePage({ items: [{ title: 'System Collapse', author: 'Martha Wells', status: 'pending' }] })
    const manualQueue = makeQueuePage({ items: [{ title: 'Network Effect', author: 'Martha Wells', status: 'processing' }] })
    const secondPage = makeRequestPage({ page: 2, limit: 10, total: 26, items: [makeRequest({ id: 39, title: 'Network Effect' })] })
    mocks.fetchCatalogSourceAudiobookRequests.mockResolvedValueOnce(initialPage).mockResolvedValueOnce(secondPage)
    mocks.fetchCatalogSourceAudiobookRequestQueue
      .mockResolvedValueOnce(initialQueue)
      .mockResolvedValueOnce(refreshedQueue)
      .mockResolvedValueOnce(manualQueue)
    mocks.searchCatalogSourceRequestAudiobooks.mockResolvedValueOnce(makeSearchPage())
    mocks.searchCatalogSourceRequestAudiobookCandidates.mockResolvedValueOnce(makeSearchPage())
    mocks.submitCatalogSourceAudiobookRequest.mockResolvedValueOnce(submitted)
    mocks.refreshCatalogSourceAudiobookRequests.mockResolvedValueOnce(statusesPage)

    const { useCatalogSourceAudiobookRequests } = await import('../useCatalogSourceAudiobookRequests')
    const requests = useCatalogSourceAudiobookRequests({ status: 'pending', limit: 10 })

    expect(requests.loading.value).toBe(true)
    expect(requests.queueLoading.value).toBe(true)

    await flushPromises()
    const searchPage = await requests.searchExternal('murderbot')
    const candidatePage = await requests.searchCandidates('system collapse')
    const submittedRequest = await requests.submit({ title: 'System Collapse', author: 'Martha Wells' })
    await requests.refreshStatuses()
    await requests.refreshQueue()

    expect(mocks.fetchCatalogSourceAudiobookRequests).toHaveBeenNthCalledWith(1, { status: 'pending', page: 1, limit: 10 })
    expect(mocks.fetchCatalogSourceAudiobookRequestQueue).toHaveBeenNthCalledWith(1)
    expect(mocks.searchCatalogSourceRequestAudiobooks).toHaveBeenCalledWith('murderbot')
    expect(mocks.searchCatalogSourceRequestAudiobookCandidates).toHaveBeenCalledWith('system collapse')
    expect(searchPage).toEqual(makeSearchPage())
    expect(candidatePage).toEqual(makeSearchPage())
    expect(submittedRequest).toEqual(submitted)
    expect(requests.items.value).toContainEqual(statusesPage.items[0])
    expect(requests.items.value).toContainEqual(submitted)
    expect(mocks.refreshCatalogSourceAudiobookRequests).toHaveBeenCalledWith({ status: 'pending', page: 1, limit: 10 })
    expect(requests.queue.value).toEqual(manualQueue)

    await requests.setPage(2)

    expect(mocks.fetchCatalogSourceAudiobookRequests).toHaveBeenNthCalledWith(2, { status: 'pending', page: 2, limit: 10 })
    expect(requests.page.value).toEqual(secondPage)
    expect(requests.currentPage.value).toBe(2)
    expect(requests.total.value).toBe(26)
    expect(requests.error.value).toBeNull()
    expect(requests.loading.value).toBe(false)
    expect(requests.queueLoading.value).toBe(false)
  })

  it('updates the server query for status filters and keeps pagination scoped to that filter', async () => {
    const initialPage = makeRequestPage({ limit: 10 })
    const filteredPage = makeRequestPage({ items: [makeRequest({ id: 41, status: 'completed', title: 'Ready Audio' })], limit: 10 })
    const filteredSecondPage = makeRequestPage({
      page: 2,
      limit: 10,
      total: 16,
      items: [makeRequest({ id: 42, status: 'completed', title: 'More Ready Audio' })],
    })
    mocks.fetchCatalogSourceAudiobookRequests
      .mockResolvedValueOnce(initialPage)
      .mockResolvedValueOnce(filteredPage)
      .mockResolvedValueOnce(filteredSecondPage)
    mocks.fetchCatalogSourceAudiobookRequestQueue.mockResolvedValue(makeQueuePage())

    const { useCatalogSourceAudiobookRequests } = await import('../useCatalogSourceAudiobookRequests')
    const requests = useCatalogSourceAudiobookRequests({ limit: 10 })

    await flushPromises()
    await requests.setQuery({ status: 'completed', page: 1, limit: 10 })
    await requests.setPage(2)

    expect(mocks.fetchCatalogSourceAudiobookRequests).toHaveBeenNthCalledWith(2, { status: 'completed', page: 1, limit: 10 })
    expect(mocks.fetchCatalogSourceAudiobookRequests).toHaveBeenNthCalledWith(3, { status: 'completed', page: 2, limit: 10 })
    expect(requests.page.value).toEqual(filteredSecondPage)
  })

  it('preserves stale list and queue data and sets safe errors on failures', async () => {
    const initialPage = makeRequestPage()
    const initialQueue = makeQueuePage()
    mocks.fetchCatalogSourceAudiobookRequests.mockResolvedValueOnce(initialPage).mockRejectedValueOnce(new Error('Private list failure'))
    mocks.fetchCatalogSourceAudiobookRequestQueue.mockResolvedValueOnce(initialQueue).mockRejectedValueOnce(new Error('Private queue failure'))
    mocks.searchCatalogSourceRequestAudiobooks.mockRejectedValueOnce(new Error('Private catalog failure'))
    mocks.searchCatalogSourceRequestAudiobookCandidates.mockRejectedValueOnce(new Error('Private candidate failure'))
    mocks.submitCatalogSourceAudiobookRequest.mockRejectedValueOnce(new Error('Private submit failure'))
    mocks.refreshCatalogSourceAudiobookRequests.mockRejectedValueOnce(new Error('Private refresh failure'))

    const { useCatalogSourceAudiobookRequests } = await import('../useCatalogSourceAudiobookRequests')
    const requests = useCatalogSourceAudiobookRequests()

    await flushPromises()
    await requests.refresh()

    expect(requests.page.value).toEqual(initialPage)
    expect(requests.error.value).toBe('Failed to load requests')

    await requests.refreshQueue()

    expect(requests.queue.value).toEqual(initialQueue)
    expect(requests.error.value).toBe('Failed to load queue')

    await expect(requests.searchExternal('murderbot')).rejects.toThrow('Failed to search titles')
    expect(requests.error.value).toBe('Failed to search titles')
    expect(requests.page.value).toEqual(initialPage)

    await expect(requests.searchCandidates('murderbot')).rejects.toThrow('Failed to search candidates')
    expect(requests.error.value).toBe('Failed to search candidates')

    await expect(requests.submit({ title: 'Murderbot' })).rejects.toThrow('Failed to submit request')
    expect(requests.error.value).toBe('Failed to submit request')
    expect(requests.page.value).toEqual(initialPage)

    await expect(requests.refreshStatuses()).rejects.toThrow('Failed to refresh requests')
    expect(requests.error.value).toBe('Failed to refresh requests')
    expect(requests.queue.value).toEqual(initialQueue)
  })

  it('keeps a submitted request when an older in-flight list load resolves with stale data', async () => {
    const initialLoad = deferred<WarehouseRequestPage>()
    const submitted = makeRequest({ id: 38, title: 'System Collapse' })
    const stalePage = makeRequestPage({ items: [makeRequest({ id: 37, title: 'Older Request' })] })
    mocks.fetchCatalogSourceAudiobookRequests.mockReturnValueOnce(initialLoad.promise)
    mocks.fetchCatalogSourceAudiobookRequestQueue.mockResolvedValueOnce(makeQueuePage())
    mocks.submitCatalogSourceAudiobookRequest.mockResolvedValueOnce(submitted)

    const { useCatalogSourceAudiobookRequests } = await import('../useCatalogSourceAudiobookRequests')
    const requests = useCatalogSourceAudiobookRequests()

    expect(requests.loading.value).toBe(true)

    await requests.submit({ title: 'System Collapse', author: 'Martha Wells' })

    expect(requests.items.value).toContainEqual(submitted)

    initialLoad.resolve(stalePage)
    await flushPromises()

    expect(requests.items.value).toContainEqual(submitted)
    expect(requests.page.value).not.toEqual(stalePage)
    expect(requests.loading.value).toBe(false)
  })

  it('keeps a status refresh when an older in-flight list load resolves with stale data', async () => {
    const initialLoad = deferred<WarehouseRequestPage>()
    const updatedPage = makeRequestPage({ items: [makeRequest({ id: 37, status: 'processing' })] })
    const stalePage = makeRequestPage({ items: [makeRequest({ id: 37, status: 'pending' })] })
    mocks.fetchCatalogSourceAudiobookRequests.mockReturnValueOnce(initialLoad.promise)
    mocks.fetchCatalogSourceAudiobookRequestQueue.mockResolvedValue(makeQueuePage())
    mocks.refreshCatalogSourceAudiobookRequests.mockResolvedValueOnce(updatedPage)

    const { useCatalogSourceAudiobookRequests } = await import('../useCatalogSourceAudiobookRequests')
    const requests = useCatalogSourceAudiobookRequests()

    await requests.refreshStatuses()

    expect(requests.page.value).toEqual(updatedPage)

    initialLoad.resolve(stalePage)
    await flushPromises()

    expect(requests.page.value).toEqual(updatedPage)
    expect(requests.page.value).not.toEqual(stalePage)
    expect(requests.loading.value).toBe(false)
  })

  it('keeps successful status refresh results when the follow-up queue refresh fails', async () => {
    const initialPage = makeRequestPage()
    const initialQueue = makeQueuePage()
    const updatedPage = makeRequestPage({ items: [makeRequest({ id: 37, status: 'completed' })] })
    mocks.fetchCatalogSourceAudiobookRequests.mockResolvedValueOnce(initialPage)
    mocks.fetchCatalogSourceAudiobookRequestQueue.mockResolvedValueOnce(initialQueue).mockRejectedValueOnce(new Error('Private queue failure'))
    mocks.refreshCatalogSourceAudiobookRequests.mockResolvedValueOnce(updatedPage)

    const { useCatalogSourceAudiobookRequests } = await import('../useCatalogSourceAudiobookRequests')
    const requests = useCatalogSourceAudiobookRequests()

    await flushPromises()

    await expect(requests.refreshStatuses()).resolves.toEqual(updatedPage)
    expect(requests.page.value).toEqual(updatedPage)
    expect(requests.queue.value).toEqual(initialQueue)
    expect(requests.error.value).toBe('Failed to load queue')
  })

  it('keeps visible copy free from private source wording', async () => {
    const { CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES } = await import('../useCatalogSourceAudiobookRequests')
    const text = Object.values(CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES).join('\n')

    expect(text).not.toMatch(/Book Warehouse|warehouse|upstream|third-party|provider|source|vendor|catalog/i)
  })
})
