import { computed, ref } from 'vue'
import { fetchCatalogSourceComicRequests, refreshCatalogSourceComicRequests, submitCatalogSourceComicRequest } from '../api/catalog-source.api'
import type {
  WarehouseComicRequestSubmitPayload,
  WarehouseRequestDetail,
  WarehouseRequestItem,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
} from '@bookorbit/types'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24

export const CATALOG_COMIC_REQUEST_ERROR_MESSAGES = {
  load: 'Failed to load requests',
  refresh: 'Failed to refresh requests',
  submit: 'Failed to submit request',
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

type UseCatalogSourceComicRequestsOptions = {
  autoLoad?: boolean
}

export function useCatalogSourceComicRequests(initialQuery: WarehouseRequestListQuery = {}, options: UseCatalogSourceComicRequestsOptions = {}) {
  const query = ref<WarehouseRequestListQuery>(withDefaultPaging(initialQuery))
  const page = ref<WarehouseRequestPage>(initialRequestPage(query.value))
  const loading = ref(false)
  const refreshingStatuses = ref(false)
  const error = ref<string | null>(null)
  let requestId = 0
  let mutationVersion = 0

  async function load(nextQuery: WarehouseRequestListQuery): Promise<void> {
    const currentRequestId = ++requestId
    const mutationVersionAtStart = mutationVersion
    loading.value = true
    error.value = null

    try {
      const nextPage = await fetchCatalogSourceComicRequests(nextQuery)
      if (currentRequestId !== requestId || mutationVersionAtStart !== mutationVersion) return

      page.value = nextPage
      query.value = {
        ...nextQuery,
        page: nextPage.page,
        limit: nextQuery.limit ?? nextPage.limit,
      }
    } catch {
      if (currentRequestId === requestId && mutationVersionAtStart === mutationVersion) {
        error.value = CATALOG_COMIC_REQUEST_ERROR_MESSAGES.load
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

  async function setQuery(nextQuery: WarehouseRequestListQuery): Promise<void> {
    await load(withDefaultPaging(nextQuery))
  }

  async function submit(payload: WarehouseComicRequestSubmitPayload): Promise<WarehouseRequestDetail> {
    error.value = null

    try {
      const request = await submitCatalogSourceComicRequest(payload)
      mutationVersion += 1
      page.value = upsertRequestItem(page.value, request)
      return request
    } catch {
      error.value = CATALOG_COMIC_REQUEST_ERROR_MESSAGES.submit
      throw new Error(CATALOG_COMIC_REQUEST_ERROR_MESSAGES.submit)
    }
  }

  async function refreshStatuses(): Promise<WarehouseRequestPage> {
    error.value = null
    refreshingStatuses.value = true

    try {
      const nextPage = await refreshCatalogSourceComicRequests(query.value)
      mutationVersion += 1
      page.value = nextPage
      query.value = {
        ...query.value,
        page: nextPage.page,
        limit: query.value.limit ?? nextPage.limit,
      }
      return nextPage
    } catch {
      error.value = CATALOG_COMIC_REQUEST_ERROR_MESSAGES.refresh
      throw new Error(CATALOG_COMIC_REQUEST_ERROR_MESSAGES.refresh)
    } finally {
      refreshingStatuses.value = false
    }
  }

  async function setPage(nextPage: number): Promise<void> {
    await setQuery({
      ...query.value,
      page: nextPage,
    })
  }

  if (options.autoLoad !== false) {
    void refresh()
  }

  return {
    query,
    page,
    items: computed<WarehouseRequestItem[]>(() => page.value.items),
    total: computed(() => page.value.total),
    currentPage: computed(() => page.value.page),
    limit: computed(() => page.value.limit),
    loading,
    refreshingStatuses,
    error,
    refresh,
    submit,
    refreshStatuses,
    setQuery,
    setPage,
  }
}
