import { computed, ref } from 'vue'
import {
  cancelCatalogSourceRequest,
  fetchCatalogSourceRequests,
  refreshCatalogSourceRequest,
  searchCatalogSourceRequestBooks,
  submitCatalogSourceEbookRequest,
} from '../api/catalog-source.api'
import type {
  WarehouseEbookExternalSearchPage,
  WarehouseEbookRequestSubmitPayload,
  WarehouseRequestDetail,
  WarehouseRequestItem,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
} from '@bookorbit/types'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24

export const CATALOG_REQUEST_ERROR_MESSAGES = {
  load: 'Failed to load requests',
  search: 'Failed to search titles',
  submit: 'Failed to submit request',
  refresh: 'Failed to refresh request',
  cancel: 'Failed to cancel request',
} as const

function initialRequestPage(query: WarehouseRequestListQuery): WarehouseRequestPage {
  return {
    items: [],
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
    total: 0,
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

type UseCatalogSourceRequestsOptions = {
  autoLoad?: boolean
}

export function useCatalogSourceRequests(initialQuery: WarehouseRequestListQuery = {}, options: UseCatalogSourceRequestsOptions = {}) {
  const query = ref<WarehouseRequestListQuery>(withDefaultPaging(initialQuery))
  const page = ref<WarehouseRequestPage>(initialRequestPage(query.value))
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestId = 0
  let mutationVersion = 0

  async function load(nextQuery: WarehouseRequestListQuery): Promise<void> {
    const currentRequestId = ++requestId
    const mutationVersionAtStart = mutationVersion
    loading.value = true
    error.value = null

    try {
      const nextPage = await fetchCatalogSourceRequests(nextQuery)
      if (currentRequestId !== requestId || mutationVersionAtStart !== mutationVersion) return

      page.value = nextPage
      query.value = {
        ...nextQuery,
        page: nextPage.page,
        limit: nextQuery.limit ?? nextPage.limit,
      }
    } catch {
      if (currentRequestId === requestId && mutationVersionAtStart === mutationVersion) {
        error.value = CATALOG_REQUEST_ERROR_MESSAGES.load
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

  async function searchExternal(q: string): Promise<WarehouseEbookExternalSearchPage> {
    error.value = null

    try {
      return await searchCatalogSourceRequestBooks(q)
    } catch {
      error.value = CATALOG_REQUEST_ERROR_MESSAGES.search
      throw new Error(CATALOG_REQUEST_ERROR_MESSAGES.search)
    }
  }

  async function submit(payload: WarehouseEbookRequestSubmitPayload): Promise<WarehouseRequestDetail> {
    error.value = null

    try {
      const request = await submitCatalogSourceEbookRequest(payload)
      mutationVersion += 1
      page.value = upsertRequestItem(page.value, request)
      return request
    } catch {
      error.value = CATALOG_REQUEST_ERROR_MESSAGES.submit
      throw new Error(CATALOG_REQUEST_ERROR_MESSAGES.submit)
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

  async function refreshRequest(id: number): Promise<WarehouseRequestDetail> {
    error.value = null

    try {
      const request = await refreshCatalogSourceRequest(id)
      mutationVersion += 1
      page.value = upsertRequestItem(page.value, request)
      return request
    } catch {
      error.value = CATALOG_REQUEST_ERROR_MESSAGES.refresh
      throw new Error(CATALOG_REQUEST_ERROR_MESSAGES.refresh)
    }
  }

  async function cancelRequest(id: number): Promise<WarehouseRequestDetail> {
    error.value = null

    try {
      const request = await cancelCatalogSourceRequest(id)
      mutationVersion += 1
      page.value = upsertRequestItem(page.value, request)
      return request
    } catch {
      error.value = CATALOG_REQUEST_ERROR_MESSAGES.cancel
      throw new Error(CATALOG_REQUEST_ERROR_MESSAGES.cancel)
    }
  }

  if (options.autoLoad !== false) {
    void refresh()
  }

  return {
    query,
    page,
    items: computed(() => page.value.items),
    total: computed(() => page.value.total),
    currentPage: computed(() => page.value.page),
    limit: computed(() => page.value.limit),
    loading,
    error,
    refresh,
    searchExternal,
    submit,
    setQuery,
    setPage,
    refreshRequest,
    cancelRequest,
  }
}
