import { ref, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { Library } from '@bookorbit/types'

type LibraryCache = {
  libraries: Ref<Library[]>
  loading: Ref<boolean>
  loaded: Ref<boolean>
  fetchPromise: Promise<void> | null
}

const filesystemCache = createCache()
const fullCache = createCache()

function createCache(): LibraryCache {
  return {
    libraries: ref<Library[]>([]),
    loading: ref(false),
    loaded: ref(false),
    fetchPromise: null,
  }
}

export function resetLibraries(): void {
  for (const cache of [filesystemCache, fullCache]) {
    cache.libraries.value = []
    cache.loading.value = false
    cache.loaded.value = false
    cache.fetchPromise = null
  }
}

export function useLibraries(options: { includeSourceBacked?: boolean } = {}) {
  const includeSourceBacked = options.includeSourceBacked === true
  const cache = includeSourceBacked ? fullCache : filesystemCache

  async function fetchLibraries(): Promise<void> {
    if (cache.loaded.value) return
    return refreshLibraries()
  }

  async function refreshLibraries(): Promise<void> {
    if (cache.fetchPromise) return cache.fetchPromise
    cache.loading.value = true
    const url = includeSourceBacked ? '/api/v1/libraries' : '/api/v1/libraries?includeSourceBacked=false'
    cache.fetchPromise = api(url)
      .then(async (res) => {
        if (!res.ok) return
        cache.libraries.value = await res.json()
        cache.loaded.value = true
      })
      .finally(() => {
        cache.fetchPromise = null
        cache.loading.value = false
      })
    return cache.fetchPromise
  }

  async function reorderLibraries(order: { id: number; displayOrder: number }[]): Promise<void> {
    const res = await api('/api/v1/libraries/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!res.ok) throw new Error('Failed to reorder libraries')
  }

  return {
    libraries: cache.libraries,
    loading: cache.loading,
    loaded: cache.loaded,
    fetchLibraries,
    refreshLibraries,
    reorderLibraries,
  }
}
