import { computed, ref } from 'vue'
import { fetchCatalogSourceEbooks } from '../api/catalog-source.api'
import type { WarehouseEbookCatalogPage, WarehouseEbookCatalogQuery } from '@bookorbit/types'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24
const LOAD_ERROR = 'Failed to load Books'

type CatalogSearchQuery = Omit<WarehouseEbookCatalogQuery, 'page'> | string

function initialCatalogPage(query: WarehouseEbookCatalogQuery): WarehouseEbookCatalogPage {
  return {
    items: [],
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
    total: 0,
  }
}

function withDefaultPaging(query: WarehouseEbookCatalogQuery): WarehouseEbookCatalogQuery {
  return {
    ...query,
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
  }
}

export function useCatalogSourceEbooks(initialQuery: WarehouseEbookCatalogQuery = {}) {
  const query = ref<WarehouseEbookCatalogQuery>(withDefaultPaging(initialQuery))
  const page = ref<WarehouseEbookCatalogPage>(initialCatalogPage(query.value))
  const loading = ref(true)
  const error = ref<string | null>(null)
  let requestId = 0

  async function load(nextQuery: WarehouseEbookCatalogQuery): Promise<void> {
    const currentRequestId = ++requestId
    loading.value = true
    error.value = null

    try {
      const nextPage = await fetchCatalogSourceEbooks(nextQuery)
      if (currentRequestId !== requestId) return

      page.value = nextPage
      query.value = {
        ...nextQuery,
        page: nextPage.page,
        limit: nextQuery.limit ?? nextPage.limit,
      }
    } catch {
      if (currentRequestId === requestId) {
        error.value = LOAD_ERROR
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

  async function search(nextQuery: CatalogSearchQuery = {}): Promise<void> {
    const searchQuery = typeof nextQuery === 'string' ? { q: nextQuery } : nextQuery
    await load({
      ...query.value,
      ...searchQuery,
      page: DEFAULT_PAGE,
    })
  }

  async function setPage(nextPage: number): Promise<void> {
    await load({
      ...query.value,
      page: nextPage,
    })
  }

  void refresh()

  return {
    query,
    page,
    items: computed(() => page.value.items),
    total: computed(() => page.value.total),
    currentPage: computed(() => page.value.page),
    limit: computed(() => page.value.limit),
    loading,
    error,
    search,
    setPage,
    refresh,
  }
}
