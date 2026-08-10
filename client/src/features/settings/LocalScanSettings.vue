<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderSearch, Loader2, RefreshCw, Sparkles } from '@lucide/vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

type ScanSummary = {
  scanned?: number
  matched?: number
  inserted?: number
  unkeyed?: number
  deduped?: number
  reconciled?: number
  unreadableDirs?: number
}

type ScanRoot = {
  id: number
  mediaType: string
  absolutePath: string
  enabled: boolean
  lastScanStatus: 'idle' | 'running' | 'completed' | 'failed'
  lastScanStartedAt: string | null
  lastScanFinishedAt: string | null
  lastScanError: string | null
  lastScanSummary: ScanSummary | null
}

const { t } = useI18n()

const roots = ref<ScanRoot[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const anyRunning = computed(() => roots.value.some((root) => root.lastScanStatus === 'running'))

async function loadRoots() {
  try {
    const response = await fetch('/api/v1/local-scan/roots', { credentials: 'include' })
    if (!response.ok) throw new Error(String(response.status))
    roots.value = (await response.json()) as ScanRoot[]
    error.value = null
  } catch {
    error.value = t('settings.admin.localScan.loadFailed')
  } finally {
    loading.value = false
  }
}

async function post(path: string, key: string) {
  busy.value = key
  try {
    const response = await fetch(`/api/v1/local-scan/${path}`, { method: 'POST', credentials: 'include' })
    if (!response.ok) throw new Error(String(response.status))
    await loadRoots()
  } catch {
    error.value = t('settings.admin.localScan.actionFailed')
  } finally {
    busy.value = null
  }
}

function scanAll() {
  void post('scan', 'scan-all')
}

function enrich() {
  void post('enrich', 'enrich')
}

function scanRoot(id: number) {
  void post(`roots/${id}/scan`, `root-${id}`)
}

function statusClass(status: ScanRoot['lastScanStatus']) {
  if (status === 'running') return 'text-primary'
  if (status === 'failed') return 'text-destructive'
  if (status === 'completed') return 'text-foreground'
  return 'text-muted-foreground'
}

function formatWhen(value: string | null) {
  if (!value) return t('settings.admin.localScan.never')
  return new Date(value).toLocaleString()
}

onMounted(() => {
  void loadRoots()
  timer = setInterval(() => {
    if (anyRunning.value || busy.value) void loadRoots()
  }, 5000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div>
    <SettingsPageHeader v-if="!embedded" :title="t('settings.admin.localScan.title')" :subtitle="t('settings.admin.localScan.subtitle')" />
    <p v-else class="mb-5 text-sm text-muted-foreground">{{ t('settings.admin.localScan.subtitle') }}</p>

    <div v-if="error" class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ error }}
    </div>

    <div class="mb-6 flex flex-wrap gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        :disabled="busy !== null"
        @click="scanAll"
      >
        <Loader2 v-if="busy === 'scan-all'" class="size-4 animate-spin" />
        <FolderSearch v-else class="size-4" />
        {{ t('settings.admin.localScan.scanAll') }}
      </button>

      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        :disabled="busy !== null"
        @click="enrich"
      >
        <Loader2 v-if="busy === 'enrich'" class="size-4 animate-spin" />
        <Sparkles v-else class="size-4" />
        {{ t('settings.admin.localScan.enrich') }}
      </button>
    </div>

    <p class="mb-4 text-sm text-muted-foreground">{{ t('settings.admin.localScan.enrichHint') }}</p>

    <div v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</div>

    <div v-else class="space-y-4">
      <div v-for="root in roots" :key="root.id" class="rounded-lg border border-border bg-card p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium capitalize">{{ root.mediaType }}</span>
              <span v-if="!root.enabled" class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {{ t('settings.admin.localScan.disabled') }}
              </span>
              <span class="text-xs" :class="statusClass(root.lastScanStatus)">{{ root.lastScanStatus }}</span>
            </div>
            <p class="mt-1 truncate text-xs text-muted-foreground" :title="root.absolutePath">{{ root.absolutePath }}</p>
          </div>

          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            :disabled="busy !== null || !root.enabled || root.lastScanStatus === 'running'"
            @click="scanRoot(root.id)"
          >
            <Loader2 v-if="busy === `root-${root.id}`" class="size-4 animate-spin" />
            <RefreshCw v-else class="size-4" />
            {{ t('settings.admin.localScan.scan') }}
          </button>
        </div>

        <dl v-if="root.lastScanSummary" class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div v-for="field in ['scanned', 'matched', 'inserted', 'deduped']" :key="field" class="flex justify-between gap-2">
            <dt class="text-muted-foreground">{{ t(`settings.admin.localScan.summary.${field}`) }}</dt>
            <dd class="font-medium tabular-nums">{{ root.lastScanSummary[field as keyof ScanSummary] ?? 0 }}</dd>
          </div>
        </dl>

        <p v-if="root.lastScanSummary?.unkeyed" class="mt-2 text-xs text-amber-600 dark:text-amber-500">
          {{ t('settings.admin.localScan.unkeyedWarning', { count: root.lastScanSummary.unkeyed }) }}
        </p>

        <p v-if="root.lastScanError" class="mt-2 text-xs text-destructive">{{ root.lastScanError }}</p>

        <p class="mt-2 text-xs text-muted-foreground">
          {{ t('settings.admin.localScan.lastRun', { when: formatWhen(root.lastScanFinishedAt) }) }}
        </p>
      </div>
    </div>
  </div>
</template>
