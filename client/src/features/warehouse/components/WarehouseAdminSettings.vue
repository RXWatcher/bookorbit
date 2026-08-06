<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { WarehouseCacheStatus, WarehouseCatalogSyncState, WarehouseCatalogSyncSummary } from '@bookorbit/types'
import IconPicker from '@/components/IconPicker.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLibraries } from '@/features/library/composables/useLibraries'
import {
  clearWarehouseCache,
  fetchWarehouseAdminSettings,
  fetchWarehouseCacheStatus,
  fetchWarehouseCatalogSyncState,
  syncWarehouseAll,
  syncWarehouseAudiobooks,
  syncWarehouseComics,
  syncWarehouseEbooks,
  testWarehouseConnection,
  updateWarehouseAdminSettings,
} from '../api/warehouse-admin.api'

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const syncingEbooks = ref(false)
const syncingAudiobooks = ref(false)
const syncingComics = ref(false)
const syncingAll = ref(false)
const clearingCache = ref(false)
const savedSyncEnabled = ref(false)
const { refreshLibraries } = useLibraries({ includeSourceBacked: true })
const MANUAL_SYNC_PROGRESS_POLL_MS = 1500
let manualSyncProgressTimer: ReturnType<typeof setInterval> | null = null
let manualSyncProgressToken = 0

const form = reactive({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  syncCadenceMinutes: 360,
  sourceBackedLibraryIcons: {
    ebook: 'BookOpen',
    audiobook: 'Headphones',
    comic: 'PanelsTopLeft',
  },
  apiKeyConfigured: false,
  apiKeyPreview: null as string | null,
  lastConnectionStatus: 'untested' as 'untested' | 'ok' | 'error',
  lastConnectionError: null as string | null,
})
const syncState = ref<WarehouseCatalogSyncState>({
  lastRun: null,
  lastRuns: {
    ebook: null,
    audiobook: null,
    comic: null,
  },
  running: false,
})
const cacheStatus = ref<WarehouseCacheStatus | null>(null)

const apiKeyPlaceholder = computed(() => {
  if (!form.apiKeyConfigured) return 'Paste API key'
  return `Stored key ${form.apiKeyPreview ?? ''}`.trim()
})

const testConnectionDisabled = computed(() => testing.value || saving.value || !form.apiKeyConfigured)
const manualSyncing = computed(() => syncingAll.value || syncingEbooks.value || syncingAudiobooks.value || syncingComics.value)
const allSyncButtonDisabled = computed(
  () => loading.value || saving.value || manualSyncing.value || syncState.value.running || !savedSyncEnabled.value,
)
const ebookSyncButtonDisabled = computed(
  () => loading.value || saving.value || manualSyncing.value || syncState.value.running || !savedSyncEnabled.value,
)
const audiobookSyncButtonDisabled = computed(
  () => loading.value || saving.value || manualSyncing.value || syncState.value.running || !savedSyncEnabled.value,
)
const comicSyncButtonDisabled = computed(
  () => loading.value || saving.value || manualSyncing.value || syncState.value.running || !savedSyncEnabled.value,
)
const ebookRun = computed(() => syncState.value.lastRuns.ebook)
const audiobookRun = computed(() => syncState.value.lastRuns.audiobook)
const comicRun = computed(() => syncState.value.lastRuns.comic)
const coverCache = computed(() => cacheStatus.value?.covers ?? null)
const coverCacheButtonDisabled = computed(() => loading.value || clearingCache.value || !coverCache.value || coverCache.value.totalEntries === 0)

function syncStatusLabel(run: WarehouseCatalogSyncSummary | null) {
  const status = run?.status
  if (!status) return null

  switch (status) {
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'running':
      return 'Running'
  }

  return null
}

function syncProgressLabel(run: WarehouseCatalogSyncSummary) {
  const synced = run.fetchedCount.toLocaleString()
  const total = run.totalCount == null ? null : run.totalCount.toLocaleString()
  const saved = run.savedCount.toLocaleString()

  return total ? `Synced ${synced} / ${total} · Saved ${saved}` : `Synced ${synced} · Saved ${saved}`
}

function syncFinishedAtLabel(run: WarehouseCatalogSyncSummary | null) {
  const timestamp = run?.finishedAt ?? run?.startedAt
  return timestamp ? formatDateTime(timestamp) : null
}

function applySettings(settings: Awaited<ReturnType<typeof fetchWarehouseAdminSettings>>) {
  form.enabled = settings.enabled
  savedSyncEnabled.value = settings.enabled
  form.baseUrl = settings.baseUrl
  form.syncCadenceMinutes = settings.syncCadenceMinutes
  form.sourceBackedLibraryIcons.ebook = settings.sourceBackedLibraryIcons.ebook
  form.sourceBackedLibraryIcons.audiobook = settings.sourceBackedLibraryIcons.audiobook
  form.sourceBackedLibraryIcons.comic = settings.sourceBackedLibraryIcons.comic
  form.apiKeyConfigured = settings.apiKeyConfigured
  form.apiKeyPreview = settings.apiKeyPreview
  form.lastConnectionStatus = settings.lastConnectionStatus
  form.lastConnectionError = settings.lastConnectionError
}

function applySyncState(state: WarehouseCatalogSyncState) {
  syncState.value = state
}

function applyCacheStatus(status: WarehouseCacheStatus) {
  cacheStatus.value = status
}

function syncStateFromManualSummary(summary: WarehouseCatalogSyncSummary): WarehouseCatalogSyncState {
  return {
    lastRun: summary,
    lastRuns: {
      ebook: summary.mediaType === 'ebook' ? summary : syncState.value.lastRuns.ebook,
      audiobook: summary.mediaType === 'audiobook' ? summary : syncState.value.lastRuns.audiobook,
      comic: summary.mediaType === 'comic' ? summary : syncState.value.lastRuns.comic,
    },
    running: summary.status === 'running',
  }
}

function syncStateFromManualSummaries(summaries: WarehouseCatalogSyncSummary[]): WarehouseCatalogSyncState {
  const nextRuns = { ...syncState.value.lastRuns }

  for (const summary of summaries) {
    if (summary.mediaType === 'ebook' || summary.mediaType === 'audiobook' || summary.mediaType === 'comic') {
      nextRuns[summary.mediaType] = summary
    }
  }

  return {
    lastRun: summaries[summaries.length - 1] ?? syncState.value.lastRun,
    lastRuns: nextRuns,
    running: summaries.some((summary) => summary.status === 'running'),
  }
}

async function loadSyncState() {
  applySyncState(await fetchWarehouseCatalogSyncState())
}

async function loadCacheStatus() {
  applyCacheStatus(await fetchWarehouseCacheStatus())
}

async function refreshSyncStateAfterManualSync(token = manualSyncProgressToken) {
  try {
    const state = await fetchWarehouseCatalogSyncState()
    if (token === manualSyncProgressToken) {
      applySyncState(state)
    }
  } catch {
    // Keep the original sync toast as the primary feedback if the refresh also fails.
  }
}

function startManualSyncProgressPolling() {
  stopManualSyncProgressPolling()
  const token = ++manualSyncProgressToken
  manualSyncProgressTimer = setInterval(() => {
    void refreshSyncStateAfterManualSync(token)
  }, MANUAL_SYNC_PROGRESS_POLL_MS)
}

function stopManualSyncProgressPolling() {
  manualSyncProgressToken += 1
  if (!manualSyncProgressTimer) return

  clearInterval(manualSyncProgressTimer)
  manualSyncProgressTimer = null
}

async function load() {
  try {
    const [settingsResult, syncStateResult, cacheStatusResult] = await Promise.allSettled([
      fetchWarehouseAdminSettings(),
      loadSyncState(),
      loadCacheStatus(),
    ])

    if (settingsResult.status === 'fulfilled') {
      applySettings(settingsResult.value)
    } else {
      throw settingsResult.reason
    }

    if (syncStateResult.status === 'rejected') {
      toast.error(syncStateResult.reason instanceof Error ? syncStateResult.reason.message : 'Failed to load ebook sync status')
    }

    if (cacheStatusResult.status === 'rejected') {
      toast.error(cacheStatusResult.reason instanceof Error ? cacheStatusResult.reason.message : 'Failed to load cache status')
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to load Book Warehouse settings')
  } finally {
    loading.value = false
  }
}

async function handleClearCache() {
  if (coverCacheButtonDisabled.value) return

  clearingCache.value = true

  try {
    const result = await clearWarehouseCache()
    applyCacheStatus(result)
    toast.success(`Cleared ${result.cleared.covers.entries.toLocaleString()} cached covers`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to clear cover cache')
  } finally {
    clearingCache.value = false
  }
}

async function save() {
  saving.value = true

  try {
    const settings = await updateWarehouseAdminSettings({
      enabled: form.enabled,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim() || undefined,
      syncCadenceMinutes: form.syncCadenceMinutes,
      sourceBackedLibraryIcons: {
        ebook: form.sourceBackedLibraryIcons.ebook,
        audiobook: form.sourceBackedLibraryIcons.audiobook,
        comic: form.sourceBackedLibraryIcons.comic,
      },
    })

    applySettings(settings)
    await refreshLibraries()
    form.apiKey = ''
    toast.success('Book Warehouse settings saved')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to save Book Warehouse settings')
  } finally {
    saving.value = false
  }
}

async function handleTestConnection() {
  if (testConnectionDisabled.value) return

  testing.value = true

  try {
    const result = await testWarehouseConnection()
    form.lastConnectionStatus = result.ok ? 'ok' : 'error'
    form.lastConnectionError = result.ok ? null : result.message

    if (result.ok) toast.success(result.message)
    else toast.error(result.message)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to test Book Warehouse connection'
    form.lastConnectionStatus = 'error'
    form.lastConnectionError = message
    toast.error(message)
  } finally {
    testing.value = false
  }
}

async function handleSyncEbooks() {
  if (ebookSyncButtonDisabled.value) return

  syncingEbooks.value = true
  startManualSyncProgressPolling()

  try {
    const summary = await syncWarehouseEbooks()
    stopManualSyncProgressPolling()
    applySyncState(syncStateFromManualSummary(summary))
    await refreshSyncStateAfterManualSync()
    toast.success(successMessageForSync(summary))
  } catch (error) {
    stopManualSyncProgressPolling()
    toast.error(error instanceof Error ? error.message : 'Failed to sync ebooks')
    await refreshSyncStateAfterManualSync()
  } finally {
    stopManualSyncProgressPolling()
    syncingEbooks.value = false
  }
}

async function handleSyncAll() {
  if (allSyncButtonDisabled.value) return

  syncingAll.value = true
  startManualSyncProgressPolling()

  try {
    const summaries = await syncWarehouseAll()
    stopManualSyncProgressPolling()
    applySyncState(syncStateFromManualSummaries(summaries))
    await refreshSyncStateAfterManualSync()
    toast.success(summaries.some((summary) => summary.status === 'running') ? 'Catalog sync started' : 'Catalog sync finished')
  } catch (error) {
    stopManualSyncProgressPolling()
    toast.error(error instanceof Error ? error.message : 'Failed to sync catalog')
    await refreshSyncStateAfterManualSync()
  } finally {
    stopManualSyncProgressPolling()
    syncingAll.value = false
  }
}

function successMessageForSync(summary: WarehouseCatalogSyncSummary) {
  const label = summary.mediaType === 'audiobook' ? 'Audiobook' : summary.mediaType === 'comic' ? 'Comic' : 'Ebook'
  return summary.status === 'running' ? `${label} sync started` : `${label} sync finished`
}

async function handleSyncAudiobooks() {
  if (audiobookSyncButtonDisabled.value) return

  syncingAudiobooks.value = true
  startManualSyncProgressPolling()

  try {
    const summary = await syncWarehouseAudiobooks()
    stopManualSyncProgressPolling()
    applySyncState(syncStateFromManualSummary(summary))
    await refreshSyncStateAfterManualSync()
    toast.success(successMessageForSync(summary))
  } catch (error) {
    stopManualSyncProgressPolling()
    toast.error(error instanceof Error ? error.message : 'Failed to sync audiobooks')
    await refreshSyncStateAfterManualSync()
  } finally {
    stopManualSyncProgressPolling()
    syncingAudiobooks.value = false
  }
}

async function handleSyncComics() {
  if (comicSyncButtonDisabled.value) return

  syncingComics.value = true
  startManualSyncProgressPolling()

  try {
    const summary = await syncWarehouseComics()
    stopManualSyncProgressPolling()
    applySyncState(syncStateFromManualSummary(summary))
    await refreshSyncStateAfterManualSync()
    toast.success(successMessageForSync(summary))
  } catch (error) {
    stopManualSyncProgressPolling()
    toast.error(error instanceof Error ? error.message : 'Failed to sync comics')
    await refreshSyncStateAfterManualSync()
  } finally {
    stopManualSyncProgressPolling()
    syncingComics.value = false
  }
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString()
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const formatted = value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
  return `${formatted} ${units[unitIndex]}`
}

onMounted(load)
onUnmounted(stopManualSyncProgressPolling)
</script>

<template>
  <section class="space-y-4">
    <div class="space-y-1">
      <h2 class="text-base font-semibold text-foreground">Book Warehouse</h2>
      <p class="text-sm text-muted-foreground">Configure Book Warehouse discovery and request fulfillment.</p>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

    <div v-else class="space-y-4 rounded-lg border border-border bg-card px-4 py-4 shadow-xs md:px-5">
      <div class="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground">Enable Book Warehouse</p>
          <p class="text-xs text-muted-foreground">Enable catalog discovery, requests, and automatic refreshes.</p>
        </div>
        <input v-model="form.enabled" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-border" />
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="space-y-2 md:col-span-2">
          <label for="catalog-source-base-url" class="text-sm font-medium text-foreground">Base URL</label>
          <Input id="catalog-source-base-url" v-model="form.baseUrl" type="url" autocomplete="off" placeholder="https://warehouse.example.com" />
        </div>

        <div class="space-y-2">
          <label for="catalog-source-api-key" class="text-sm font-medium text-foreground">API key</label>
          <Input id="catalog-source-api-key" v-model="form.apiKey" type="password" autocomplete="off" :placeholder="apiKeyPlaceholder" />
          <p v-if="form.apiKeyConfigured" class="text-xs text-muted-foreground">A stored key is already configured.</p>
        </div>

        <div class="space-y-2">
          <label for="catalog-source-sync-cadence" class="text-sm font-medium text-foreground">Sync cadence in minutes</label>
          <Input
            id="catalog-source-sync-cadence"
            :model-value="form.syncCadenceMinutes"
            type="number"
            min="15"
            step="1"
            @update:model-value="form.syncCadenceMinutes = Number($event)"
          />
          <p class="text-xs text-muted-foreground">Requests are checked every 5 minutes; catalog data refreshes when older than this cadence.</p>
        </div>
      </div>

      <div class="grid gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 md:grid-cols-3">
        <div class="space-y-2">
          <label class="text-sm font-medium text-foreground">Books icon</label>
          <IconPicker v-model="form.sourceBackedLibraryIcons.ebook" placeholder="Books icon" />
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium text-foreground">Audiobooks icon</label>
          <IconPicker v-model="form.sourceBackedLibraryIcons.audiobook" placeholder="Audiobooks icon" />
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium text-foreground">Comics icon</label>
          <IconPicker v-model="form.sourceBackedLibraryIcons.comic" placeholder="Comics icon" />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span class="font-medium text-foreground">Connection status:</span>
        <span class="capitalize">{{ form.lastConnectionStatus }}</span>
      </div>

      <div class="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div class="min-w-0 space-y-1">
          <p class="text-sm font-medium text-foreground">Populate catalog</p>
          <p class="text-xs text-muted-foreground">Sync ebooks, audiobooks, and comics now.</p>
        </div>

        <Button variant="outline" :disabled="allSyncButtonDisabled" @click="handleSyncAll">
          {{ syncingAll ? 'Syncing all...' : 'Sync all' }}
        </Button>
      </div>

      <div class="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div class="min-w-0 space-y-1">
          <p class="text-sm font-medium text-foreground">Last ebook sync</p>
          <template v-if="ebookRun">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{{ syncStatusLabel(ebookRun) }}</span>
              <span>{{ syncProgressLabel(ebookRun) }}</span>
              <span v-if="syncFinishedAtLabel(ebookRun)">{{ syncFinishedAtLabel(ebookRun) }}</span>
            </div>
            <p v-if="ebookRun.errorMessage" class="text-xs text-destructive">{{ ebookRun.errorMessage }}</p>
          </template>
          <p v-else class="text-xs text-muted-foreground">No ebook sync has run yet.</p>
        </div>

        <Button variant="outline" :disabled="ebookSyncButtonDisabled" @click="handleSyncEbooks">
          {{ syncingEbooks ? 'Syncing...' : 'Sync ebooks' }}
        </Button>
      </div>

      <div class="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div class="min-w-0 space-y-1">
          <p class="text-sm font-medium text-foreground">Last audiobook sync</p>
          <template v-if="audiobookRun">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{{ syncStatusLabel(audiobookRun) }}</span>
              <span>{{ syncProgressLabel(audiobookRun) }}</span>
              <span v-if="syncFinishedAtLabel(audiobookRun)">{{ syncFinishedAtLabel(audiobookRun) }}</span>
            </div>
            <p v-if="audiobookRun.errorMessage" class="text-xs text-destructive">{{ audiobookRun.errorMessage }}</p>
          </template>
          <p v-else class="text-xs text-muted-foreground">No audiobook sync has run yet.</p>
        </div>

        <Button variant="outline" :disabled="audiobookSyncButtonDisabled" @click="handleSyncAudiobooks">
          {{ syncingAudiobooks ? 'Syncing audiobooks...' : 'Sync audiobooks' }}
        </Button>
      </div>

      <div class="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div class="min-w-0 space-y-1">
          <p class="text-sm font-medium text-foreground">Last comic sync</p>
          <template v-if="comicRun">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{{ syncStatusLabel(comicRun) }}</span>
              <span>{{ syncProgressLabel(comicRun) }}</span>
              <span v-if="syncFinishedAtLabel(comicRun)">{{ syncFinishedAtLabel(comicRun) }}</span>
            </div>
            <p v-if="comicRun.errorMessage" class="text-xs text-destructive">{{ comicRun.errorMessage }}</p>
          </template>
          <p v-else class="text-xs text-muted-foreground">No comic sync has run yet.</p>
        </div>

        <Button variant="outline" :disabled="comicSyncButtonDisabled" @click="handleSyncComics">
          {{ syncingComics ? 'Syncing comics...' : 'Sync comics' }}
        </Button>
      </div>

      <div class="flex flex-col gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div class="min-w-0 space-y-1">
          <p class="text-sm font-medium text-foreground">Cover cache</p>
          <template v-if="coverCache">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{{ coverCache.totalEntries.toLocaleString() }} covers</span>
              <span>{{ formatBytes(coverCache.totalBytes) }}</span>
              <span>Ebooks {{ coverCache.byMediaType.ebook.entries.toLocaleString() }}</span>
              <span>Audiobooks {{ coverCache.byMediaType.audiobook.entries.toLocaleString() }}</span>
              <span>Comics {{ coverCache.byMediaType.comic.entries.toLocaleString() }}</span>
            </div>
          </template>
          <p v-else class="text-xs text-muted-foreground">Cache status is unavailable.</p>
        </div>

        <Button variant="outline" :disabled="coverCacheButtonDisabled" @click="handleClearCache">
          {{ clearingCache ? 'Clearing...' : 'Clear cover cache' }}
        </Button>
      </div>

      <p v-if="form.lastConnectionError" class="text-sm text-destructive">{{ form.lastConnectionError }}</p>

      <div class="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button :disabled="saving" @click="save">
          {{ saving ? 'Saving...' : 'Save' }}
        </Button>
        <Button variant="outline" :disabled="testConnectionDisabled" @click="handleTestConnection">
          {{ testing ? 'Testing...' : 'Test connection' }}
        </Button>
      </div>
    </div>
  </section>
</template>
