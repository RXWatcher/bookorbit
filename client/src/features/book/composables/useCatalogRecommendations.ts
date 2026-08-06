import { ref } from 'vue'

import type { DashboardCatalogItem } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useCatalogRecommendations() {
  const recommendations = ref<DashboardCatalogItem[]>([])
  const loading = ref(false)

  async function fetch(bookId: number) {
    loading.value = true
    recommendations.value = []
    try {
      const res = await api(`/api/v1/books/${bookId}/catalog-recommendations`)
      if (!res.ok) return
      recommendations.value = await res.json()
    } catch {
      // catalog recommendations are non-critical, fail silently
    } finally {
      loading.value = false
    }
  }

  return { recommendations, loading, fetch }
}
