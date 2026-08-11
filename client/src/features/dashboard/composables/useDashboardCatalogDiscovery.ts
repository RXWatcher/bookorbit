import { onMounted, ref } from 'vue'

import type { DashboardCatalogItem } from '@bookorbit/types'
import { fetchDashboardCatalogDiscovery } from '../api/dashboard-catalog.api'

export function useDashboardCatalogDiscovery(limit = 20) {
  const items = ref<DashboardCatalogItem[]>([])
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      const data = await fetchDashboardCatalogDiscovery(limit)
      items.value = data.items
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { items, loading, error, refresh: load }
}
