import { computed, ref } from 'vue'
import { fetchCatalogSourceAudiobooks } from '../api/catalog-source.api'
import type { WarehouseAudiobookCatalogPage, WarehouseAudiobookCatalogQuery } from '@bookorbit/types'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24
const LOAD_ERROR = 'Failed to load Audiobooks'

type CatalogSearchQuery = Omit<WarehouseAudiobookCatalogQuery, 'page'> | string

function initialCatalogPage(query: WarehouseAudiobookCatalogQuery): WarehouseAudiobookCatalogPage {
  return {
    items: [],
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
    total: 0,
  }
}

function withDefaultPaging(query: WarehouseAudiobookCatalogQuery): WarehouseAudiobookCatalogQuery {
  return {
    ...query,
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
  }
}

export function useCatalogSourceAudiobooks(initialQuery: WarehouseAudiobookCatalogQuery = {}) {
  const query = ref<WarehouseAudiobookCatalogQuery>(withDefaultPaging(initialQuery))
  const page = ref<WarehouseAudiobookCatalogPage>(initialCatalogPage(query.value))
  const loading = ref(true)
  const error = ref<string | null>(null)
  let requestId = 0

  async function load(nextQuery: WarehouseAudiobookCatalogQuery): Promise<void> {
    const currentRequestId = ++requestId
    loading.value = true
    error.value = null

    try {
      const nextPage = await fetchCatalogSourceAudiobooks(nextQuery)
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
