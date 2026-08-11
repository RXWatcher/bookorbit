import { ref } from 'vue'

import type { AppInfoResponse } from '@bookorbit/types'

import { api } from '@/lib/api'

const version = ref('')
const updateAvailable = ref<boolean | null>(null)
const latestVersion = ref<string | null>(null)
const bookDockPath = ref('')
const maxUploadSizeMb = ref(500)
const libraryReadOnly = ref(false)
const isLoading = ref(false)
const error = ref<string | null>(null)
let loadOncePromise: Promise<void> | null = null

export function useAppInfo() {
  async function loadAppInfo() {
    if (isLoading.value) return
    isLoading.value = true
    error.value = null
    try {
      const res = await api('/api/v1/app-info')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AppInfoResponse = await res.json()
      version.value = data.version
      updateAvailable.value = data.updateAvailable
      latestVersion.value = data.latestVersion
      bookDockPath.value = data.bookDockPath ?? ''
      maxUploadSizeMb.value = data.maxUploadSizeMb ?? 500
      libraryReadOnly.value = data.libraryReadOnly ?? false
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load app info'
    } finally {
      isLoading.value = false
    }
  }

  // Components that only need a flag should not each trigger a request, and
  // loadAppInfo no-ops while a load is already running rather than awaiting it.
  function ensureAppInfoLoaded(): Promise<void> {
    loadOncePromise ??= loadAppInfo()
    return loadOncePromise
  }

  return {
    version,
    updateAvailable,
    latestVersion,
    bookDockPath,
    maxUploadSizeMb,
    libraryReadOnly,
    isLoading,
    error,
    loadAppInfo,
    ensureAppInfoLoaded,
  }
}
