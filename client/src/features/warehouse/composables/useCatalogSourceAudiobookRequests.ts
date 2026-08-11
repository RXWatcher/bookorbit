import { computed, ref } from 'vue'
import {
  fetchCatalogSourceAudiobookRequestQueue,
  fetchCatalogSourceAudiobookRequests,
  refreshCatalogSourceAudiobookRequests,
  searchCatalogSourceRequestAudiobookCandidates,
  searchCatalogSourceRequestAudiobooks,
  submitCatalogSourceAudiobookRequest,
} from '../api/catalog-source.api'
import type {
  WarehouseAudiobookExternalSearchPage,
  WarehouseAudiobookQueuePage,
  WarehouseAudiobookRequestSubmitPayload,
  WarehouseRequestDetail,
  WarehouseRequestItem,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
} from '@bookorbit/types'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24

export const CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES = {
  load: 'Failed to load requests',
  search: 'Failed to search titles',
  candidates: 'Failed to search candidates',
  submit: 'Failed to submit request',
  refresh: 'Failed to refresh requests',
  queue: 'Failed to load queue',
} as const

function initialRequestPage(query: WarehouseRequestListQuery): WarehouseRequestPage {
  return {
    items: [],
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
    total: 0,
  }
}

function initialQueuePage(): WarehouseAudiobookQueuePage {
  return {
    items: [],
  }
}

function withDefaultPaging(query: WarehouseRequestListQuery): WarehouseRequestListQuery {
  return {
    ...query,
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
  }
}

function replaceRequestItem(items: WarehouseRequestItem[], request: WarehouseRequestDetail): WarehouseRequestItem[] {
  return items.map((item) => (item.id === request.id ? request : item))
}

function upsertRequestItem(page: WarehouseRequestPage, request: WarehouseRequestDetail): WarehouseRequestPage {
  const existing = page.items.some((item) => item.id === request.id)

  return {
    ...page,
    items: existing ? replaceRequestItem(page.items, request) : [request, ...page.items],
    total: existing ? page.total : page.total + 1,
  }
}

type UseCatalogSourceAudiobookRequestsOptions = {
  autoLoad?: boolean
}

export function useCatalogSourceAudiobookRequests(
  initialQuery: WarehouseRequestListQuery = {},
  options: UseCatalogSourceAudiobookRequestsOptions = {},
) {
  const query = ref<WarehouseRequestListQuery>(withDefaultPaging(initialQuery))
  const page = ref<WarehouseRequestPage>(initialRequestPage(query.value))
  const queue = ref<WarehouseAudiobookQueuePage>(initialQueuePage())
  const loading = ref(false)
  const queueLoading = ref(false)
  const refreshingStatuses = ref(false)
  const error = ref<string | null>(null)
  let requestId = 0
  let queueRequestId = 0
  let mutationVersion = 0

  async function load(nextQuery: WarehouseRequestListQuery): Promise<void> {
    const currentRequestId = ++requestId
    const mutationVersionAtStart = mutationVersion
    loading.value = true
    error.value = null

    try {
      const nextPage = await fetchCatalogSourceAudiobookRequests(nextQuery)
      if (currentRequestId !== requestId || mutationVersionAtStart !== mutationVersion) return

      page.value = nextPage
      query.value = {
        ...nextQuery,
        page: nextPage.page,
        limit: nextQuery.limit ?? nextPage.limit,
      }
    } catch {
      if (currentRequestId === requestId && mutationVersionAtStart === mutationVersion) {
        error.value = CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.load
      }
    } finally {
      if (currentRequestId === requestId) {
        loading.value = false
      }
    }
  }

  async function refresh(): Promise<void> {
    await load(query.value)
  }

  async function refreshQueue(): Promise<void> {
    const currentQueueRequestId = ++queueRequestId
    queueLoading.value = true
    error.value = null

    try {
      const nextQueue = await fetchCatalogSourceAudiobookRequestQueue()
      if (currentQueueRequestId !== queueRequestId) return

      queue.value = nextQueue
    } catch {
      if (currentQueueRequestId === queueRequestId) {
        error.value = CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.queue
      }
    } finally {
      if (currentQueueRequestId === queueRequestId) {
        queueLoading.value = false
      }
    }
  }

  async function searchExternal(q: string): Promise<WarehouseAudiobookExternalSearchPage> {
    error.value = null

    try {
      return await searchCatalogSourceRequestAudiobooks(q)
    } catch {
      error.value = CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.search
      throw new Error(CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.search)
    }
  }

  async function searchCandidates(q: string): Promise<WarehouseAudiobookExternalSearchPage> {
    error.value = null

    try {
      return await searchCatalogSourceRequestAudiobookCandidates(q)
    } catch {
      error.value = CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.candidates
      throw new Error(CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.candidates)
    }
  }

  async function submit(payload: WarehouseAudiobookRequestSubmitPayload): Promise<WarehouseRequestDetail> {
    error.value = null

    try {
      const request = await submitCatalogSourceAudiobookRequest(payload)
      mutationVersion += 1
      page.value = upsertRequestItem(page.value, request)
      return request
    } catch {
      error.value = CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.submit
      throw new Error(CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.submit)
    }
  }

  async function refreshStatuses(): Promise<WarehouseRequestPage> {
    error.value = null
    refreshingStatuses.value = true

    try {
      const nextPage = await refreshCatalogSourceAudiobookRequests(query.value)
      mutationVersion += 1
      page.value = nextPage
      query.value = {
        ...query.value,
        page: nextPage.page,
        limit: query.value.limit ?? nextPage.limit,
      }
      await refreshQueue()
      return nextPage
    } catch {
      error.value = CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.refresh
      throw new Error(CATALOG_AUDIOBOOK_REQUEST_ERROR_MESSAGES.refresh)
    } finally {
      refreshingStatuses.value = false
    }
  }

  async function setQuery(nextQuery: WarehouseRequestListQuery): Promise<void> {
    await load(withDefaultPaging(nextQuery))
  }

  async function setPage(nextPage: number): Promise<void> {
    await setQuery({
      ...query.value,
      page: nextPage,
    })
  }

  if (options.autoLoad !== false) {
    void refresh()
    void refreshQueue()
  }

  return {
    query,
    page,
    queue,
    items: computed(() => page.value.items),
    total: computed(() => page.value.total),
    currentPage: computed(() => page.value.page),
    limit: computed(() => page.value.limit),
    queueItems: computed(() => queue.value.items),
    loading,
    queueLoading,
    refreshingStatuses,
    error,
    refresh,
    setQuery,
    setPage,
    searchExternal,
    searchCandidates,
    submit,
    refreshQueue,
    refreshStatuses,
  }
}
