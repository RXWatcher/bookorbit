import { onMounted, ref } from 'vue'

import type { DashboardScrollerItem, ScrollerType } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useBookProgressRefresh } from '@/features/book/composables/useBookProgressRefresh'

/** Scroller types the server serves from a dedicated route rather than from
 *  /dashboard/scrollers/:type, which rejects them by design. */
const DEDICATED_SCROLLER_ROUTES: Partial<Record<ScrollerType, string>> = {
  'catalog-additions': '/api/v1/dashboard/catalog-additions',
  'catalog-discovery': '/api/v1/dashboard/catalog-discovery',
}

export function useDashboardScroller(type: ScrollerType, limit = 20, smartScopeId?: number) {
  const books = ref<DashboardScrollerItem[]>([])
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (type === 'smart-scope' && smartScopeId) params.set('smartScopeId', String(smartScopeId))
      // The two catalog shelves have their OWN endpoints and are deliberately
      // refused on the generic one — the server's own test asserts it:
      // "Library discovery is loaded through the library discovery endpoint".
      // Routing them through /scrollers/ made every dashboard load 400 twice
      // and left the page rendering its "your library is empty" state while
      // the warehouse held hundreds of thousands of items.
      const url = DEDICATED_SCROLLER_ROUTES[type] ?? `/api/v1/dashboard/scrollers/${type}`
      const res = await api(`${url}?${params}`)
      if (!res.ok) throw new Error()
      books.value = await res.json()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  useBookProgressRefresh(load)
  onMounted(load)
  return { books, loading, error, refresh: load }
}
