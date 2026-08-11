import { onMounted, ref } from 'vue'

import {
  DASHBOARD_SCROLLER_BATCH_MAX,
  type DashboardCatalogAdditionsData,
  type DashboardScrollerBatchRequest,
  type DashboardScrollerBatchResponse,
  type DashboardScrollerBatchResult,
  type DashboardScrollerItem,
  type ScrollerMedia,
  type ScrollerType,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { useBookProgressRefresh } from '@/features/book/composables/useBookProgressRefresh'

type PendingScrollerRequest = {
  item: DashboardScrollerBatchRequest['items'][number]
  resolve: (result: DashboardScrollerBatchResult) => void
  reject: (reason?: unknown) => void
}

const pendingRequests: PendingScrollerRequest[] = []
let batchScheduled = false
let requestSequence = 0

function scheduleBatch(): void {
  if (batchScheduled) return
  batchScheduled = true
  queueMicrotask(() => void flushBatch())
}

async function flushBatch(): Promise<void> {
  batchScheduled = false
  const batch = pendingRequests.splice(0, DASHBOARD_SCROLLER_BATCH_MAX)
  if (batch.length === 0) return
  if (pendingRequests.length > 0) scheduleBatch()

  try {
    const body: DashboardScrollerBatchRequest = { items: batch.map((request) => request.item) }
    const response = await api('/api/v1/dashboard/scrollers/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error('Dashboard scroller batch failed')

    const payload: DashboardScrollerBatchResponse = await response.json()
    const resultsById = new Map(payload.items.map((item) => [item.id, item]))
    for (const request of batch) {
      const result = resultsById.get(request.item.id)
      if (result) request.resolve(result)
      else request.reject(new Error('Dashboard scroller batch result missing'))
    }
  } catch (error) {
    for (const request of batch) request.reject(error)
  }
}

function requestScroller(
  type: ScrollerType,
  limit: number,
  smartScopeId?: number,
  media: ScrollerMedia = 'all',
): Promise<DashboardScrollerBatchResult> {
  return new Promise((resolve, reject) => {
    requestSequence += 1
    pendingRequests.push({
      item: {
        id: String(requestSequence),
        type,
        limit,
        ...(media === 'all' ? {} : { media }),
        ...(type === 'smart-scope' && smartScopeId ? { smartScopeId } : {}),
      },
      resolve,
      reject,
    })
    scheduleBatch()
  })
}

/** Scroller types the server serves from a dedicated route rather than from
 *  the batch endpoint, which rejects them by design. */
const DEDICATED_SCROLLER_ROUTES: Partial<Record<ScrollerType, string>> = {
  'catalog-additions': '/api/v1/dashboard/catalog-additions',
  'catalog-discovery': '/api/v1/dashboard/catalog-discovery',
}

async function loadDedicated(
  url: string,
  type: ScrollerType,
  limit: number,
  smartScopeId?: number,
  media: ScrollerMedia = 'all',
): Promise<DashboardScrollerItem[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (type === 'smart-scope' && smartScopeId) params.set('smartScopeId', String(smartScopeId))
  if (media !== 'all') params.set('media', media)
  const res = await api(`${url}?${params}`)
  if (!res.ok) throw new Error('Dashboard scroller request failed')
  // These two routes answer with an { items } envelope rather than a bare
  // array. Assigning the envelope straight to the shelf left every card
  // undefined, which is what blanked the dashboard.
  const payload = (await res.json()) as DashboardCatalogAdditionsData | DashboardScrollerItem[]
  return Array.isArray(payload) ? payload : (payload?.items ?? [])
}

export function useDashboardScroller(type: ScrollerType, limit = 20, smartScopeId?: number, media: ScrollerMedia = 'all') {
  const books = ref<DashboardScrollerItem[]>([])
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      // The two catalog shelves have their OWN endpoints and are deliberately
      // refused by the generic scroller path — the server's own test asserts
      // it: "Library discovery is loaded through the library discovery
      // endpoint". Routing them through the shared path made every dashboard
      // load fail twice and left the page rendering its "your library is
      // empty" state while the warehouse held hundreds of thousands of items.
      const dedicated = DEDICATED_SCROLLER_ROUTES[type]
      if (dedicated) {
        books.value = await loadDedicated(dedicated, type, limit, smartScopeId, media)
        return
      }

      const result = await requestScroller(type, limit, smartScopeId, media)
      books.value = result.books
      error.value = result.failed
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
