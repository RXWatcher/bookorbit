import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { BookMetadataFetchConditions } from '@bookorbit/types'
import { api } from '@/lib/api'

const refreshToken = ref(0)

export function invalidateEligibleCountPreviews() {
  refreshToken.value += 1
}

export function useEligibleCountPreview(conditions: Ref<BookMetadataFetchConditions | null>, libraryId?: number) {
  const count = ref<number | null>(null)
  const loading = ref(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let requestId = 0

  async function fetchCount() {
    const currentRequestId = ++requestId
    const current = conditions.value
    if (!current) {
      count.value = null
      loading.value = false
      return
    }
    loading.value = true
    try {
      const body: { conditions: BookMetadataFetchConditions; libraryId?: number } = { conditions: current }
      if (libraryId !== undefined) body.libraryId = libraryId
      const res = await api('/api/v1/book-metadata-fetch/preview-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data: { count: number } = await res.json()
        if (currentRequestId !== requestId) return
        count.value = data.count
      }
    } finally {
      if (currentRequestId === requestId) loading.value = false
    }
  }

  watch(
    [conditions, refreshToken],
    () => {
      requestId += 1
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(fetchCount, 400)
    },
    { deep: true, immediate: true },
  )

  onScopeDispose(() => {
    requestId += 1
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  return { count, loading }
}
