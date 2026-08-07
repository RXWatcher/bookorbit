import { ref, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { Library } from '@bookorbit/types'

/**
 * Two caches, not one.
 *
 * Source-backed (Book Warehouse) libraries are virtual and only returned when
 * includeSourceBacked is set, so callers that want filesystem libraries only
 * must not share a cache with callers that want everything — the dashboard
 * once read the filesystem-only list and reported "your library is empty" over
 * a 348k-item catalogue.
 *
 * Everything else here is upstream v2.5.0's: a generation counter so a
 * response that arrives after resetLibraries() cannot overwrite fresh state,
 * and an `error` ref so a failed load is visible instead of silently rendering
 * an empty list.
 */
type LibraryCache = {
  libraries: Ref<Library[]>
  loading: Ref<boolean>
  loaded: Ref<boolean>
  error: Ref<string | null>
  fetchPromise: Promise<void> | null
  generation: number
}

function createCache(): LibraryCache {
  return {
    libraries: ref<Library[]>([]),
    loading: ref(false),
    loaded: ref(false),
    error: ref<string | null>(null),
    fetchPromise: null,
    generation: 0,
  }
}

const filesystemCache = createCache()
const fullCache = createCache()

export function resetLibraries(): void {
  for (const cache of [filesystemCache, fullCache]) {
    cache.generation += 1
    cache.libraries.value = []
    cache.loading.value = false
    cache.loaded.value = false
    cache.error.value = null
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
    cache.error.value = null
    const generation = cache.generation
    const url = includeSourceBacked ? '/api/v1/libraries' : '/api/v1/libraries?includeSourceBacked=false'
    cache.fetchPromise = (async () => {
      try {
        const res = await api(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: unknown = await res.json()
        if (!Array.isArray(data)) throw new Error('Invalid library response')
        if (generation !== cache.generation) return
        cache.libraries.value = data as Library[]
        cache.loaded.value = true
      } catch (cause: unknown) {
        if (generation !== cache.generation) return
        cache.error.value = cause instanceof Error ? cause.message : 'Failed to load libraries'
      } finally {
        if (generation === cache.generation) {
          cache.fetchPromise = null
          cache.loading.value = false
        }
      }
    })()
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
    error: cache.error,
    fetchLibraries,
    refreshLibraries,
    reorderLibraries,
  }
}
