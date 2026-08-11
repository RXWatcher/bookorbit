import { computed, onMounted, ref, watch, type Ref } from 'vue'

import type { DashboardCatalogItem, SortSpec } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useSmartScopeCatalogItems(
  smartScopeId: Ref<number>,
  q: Ref<string> = ref(''),
  sort: Ref<SortSpec[]> = ref([{ field: 'title', dir: 'asc' }]),
  size = 20,
  options: { auto?: boolean } = {},
) {
  const items = ref<DashboardCatalogItem[]>([])
  const total = ref(0)
  const page = ref(0)
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref(false)
  const hasMore = computed(() => items.value.length < total.value)
  let requestId = 0

  async function load(reset = false): Promise<void> {
    if (!Number.isInteger(smartScopeId.value) || smartScopeId.value <= 0) {
      clear()
      return
    }
    if (!reset && (loading.value || !hasMore.value)) return

    const currentRequest = ++requestId
    const nextPage = reset ? 0 : page.value
    loading.value = true
    error.value = false
    try {
      const body = {
        sort: sort.value,
        pagination: { page: nextPage, size },
        ...(q.value.trim() ? { q: q.value.trim() } : {}),
      }
      const res = await api(`/api/v1/smart-scopes/${smartScopeId.value}/catalog-items/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (currentRequest !== requestId) return

      const nextItems = Array.isArray(data.items) ? data.items : []
      items.value = reset ? nextItems : [...items.value, ...nextItems]
      total.value = Number.isFinite(data.total) ? data.total : items.value.length
      page.value = Number.isFinite(data.page) ? Number(data.page) + 1 : nextPage + 1
      initialized.value = true
    } catch {
      if (currentRequest === requestId) {
        items.value = reset ? [] : items.value
        total.value = reset ? 0 : total.value
        error.value = true
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
    loading.value = false
    initialized.value = false
    error.value = false
  }

  if (options.auto !== false) {
    onMounted(() => void load(true))
    watch([smartScopeId, q, sort], () => void load(true), { deep: true })
  }

  return { items, total, hasMore, loading, initialized, error, load, clear, refresh: () => load(true) }
}
