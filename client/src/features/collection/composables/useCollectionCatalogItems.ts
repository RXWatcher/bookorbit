import { computed, ref, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { CollectionCatalogItemsPage, DashboardCatalogItem, SortSpec } from '@bookorbit/types'

const PAGE_SIZE = 50

export function useCollectionCatalogItems(
  collectionId: Ref<number>,
  q: Ref<string> = ref(''),
  sort: Ref<SortSpec[]> = ref([{ field: 'title', dir: 'asc' }]),
) {
  const items = ref<DashboardCatalogItem[]>([])
  const total = ref(0)
  const page = ref(0)
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref<string | null>(null)
  const hasMore = computed(() => items.value.length < total.value)
  let requestId = 0

  async function load(reset = false): Promise<void> {
    const id = collectionId.value
    if (!Number.isFinite(id) || id < 1) return
    if (!reset && (loading.value || !hasMore.value)) return

    const currentRequest = ++requestId
    const nextPage = reset ? 0 : page.value
    loading.value = true
    error.value = null

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        size: String(PAGE_SIZE),
      })
      const query = q.value.trim()
      if (query) params.set('q', query)
      if (sort.value.length > 0) params.set('sort', JSON.stringify(sort.value))

      const res = await api(`/api/v1/collections/${id}/catalog-items?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as CollectionCatalogItemsPage
      if (currentRequest !== requestId) return

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      page.value = data.page + 1
      initialized.value = true
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = err instanceof Error ? err.message : 'Failed to load collection titles'
      }
    } finally {
      if (currentRequest === requestId) {
        loading.value = false
      }
    }
  }

  function clear(): void {
    requestId += 1
    items.value = []
    total.value = 0
    page.value = 0
    initialized.value = false
    error.value = null
    loading.value = false
  }

  return {
    items,
    total,
    hasMore,
    loading,
    initialized,
    error,
    load,
    clear,
  }
}
