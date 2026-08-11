import { computed, reactive, ref, watch, type Ref } from 'vue'
import type { BookQuery, DashboardCatalogItem, GroupRule, SortSpec } from '@bookorbit/types'
import { fetchCatalogLibraryItems } from '@/features/warehouse/api/catalog-source.api'

const DEFAULT_PAGE_SIZE = 50

export function useCatalogLibraryItems(libraryId: Ref<number | null>, q: Ref<string> = ref('')) {
  const items = ref<DashboardCatalogItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref<string | null>(null)

  const filter = ref<GroupRule | undefined>(undefined)
  const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])
  const pagination = reactive({ page: 0, size: DEFAULT_PAGE_SIZE })

  const currentPage = computed(() => pagination.page + 1)
  const limit = computed(() => pagination.size)

  let activeController: AbortController | null = null

  async function load(reset = false): Promise<void> {
    if (libraryId.value === null) return

    if (reset && activeController) {
      activeController.abort()
    }

    const controller = new AbortController()
    activeController = controller
    loading.value = true
    error.value = null

    if (reset) {
      pagination.page = 0
    }

    try {
      const body: BookQuery = {
        filter: filter.value,
        sort: sort.value,
        pagination: { page: pagination.page, size: pagination.size },
        ...(q.value.trim() ? { q: q.value.trim() } : {}),
      }

      const page = await fetchCatalogLibraryItems(libraryId.value, body, controller.signal)
      if (controller.signal.aborted) return

      items.value = page.items
      total.value = page.total
      pagination.page = page.page
      pagination.size = page.limit
    } catch (e) {
      if (controller.signal.aborted) return
      error.value = e instanceof Error ? e.message : 'Failed to load library items'
    } finally {
      if (!controller.signal.aborted) {
        loading.value = false
        initialized.value = true
      }
    }
  }

  async function refresh(): Promise<void> {
    await load(false)
  }

  async function search(): Promise<void> {
    await load(true)
  }

  async function setPage(nextPage: number): Promise<void> {
    pagination.page = Math.max(0, nextPage - 1)
    await load(false)
  }

  function clear(): void {
    items.value = []
    total.value = 0
    pagination.page = 0
  }

  watch(
    [libraryId, sort] as const,
    () => {
      void load(true)
    },
    { deep: true, immediate: true },
  )

  return { items, total, loading, initialized, error, filter, sort, pagination, currentPage, limit, load, refresh, search, setPage, clear }
}
