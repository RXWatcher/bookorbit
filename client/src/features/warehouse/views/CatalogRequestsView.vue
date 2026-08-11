<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { DashboardCatalogItem, WarehouseRequestItem, WarehouseRequestStatus } from '@bookorbit/types'
import CatalogAudiobookRequestDialog from '@/features/warehouse/components/CatalogAudiobookRequestDialog.vue'
import CatalogComicRequestDialog from '@/features/warehouse/components/CatalogComicRequestDialog.vue'
import CatalogEbookRequestDialog from '@/features/warehouse/components/CatalogEbookRequestDialog.vue'
import CatalogItemQuickView from '@/features/warehouse/components/CatalogItemQuickView.vue'
import { useCatalogSourceAudiobookRequests } from '@/features/warehouse/composables/useCatalogSourceAudiobookRequests'
import { useCatalogSourceComicRequests } from '@/features/warehouse/composables/useCatalogSourceComicRequests'
import { useCatalogSourceRequests } from '@/features/warehouse/composables/useCatalogSourceRequests'
import { catalogSourceComicDownloadUrl, catalogSourceRequestStreamUrl } from '@/features/warehouse/api/catalog-source.api'
import { catalogLibraryItemRoute, type CatalogLibraryItemRoute } from '@/features/warehouse/lib/catalog-item-route'
import {
  formatRequestDate,
  REQUEST_MEDIA_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONE,
  requestDisplayAuthor,
  requestDisplayTitle,
} from '@/features/warehouse/lib/catalog-request-ui'

type MediaTab = 'ebook' | 'audiobook' | 'comic'
type StatusFilter = WarehouseRequestStatus | 'all'
type CatalogItemRoute = CatalogLibraryItemRoute

const PAGE_LIMIT = 24
const TERMINAL_STATUSES = new Set<WarehouseRequestStatus>(['completed', 'failed', 'cancelled'])

const mediaTabs: Array<{ value: MediaTab; label: string }> = [
  { value: 'ebook', label: 'Books' },
  { value: 'audiobook', label: 'Audiobooks' },
  { value: 'comic', label: 'Comics' },
]

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: REQUEST_STATUS_LABELS.pending },
  { value: 'processing', label: REQUEST_STATUS_LABELS.processing },
  { value: 'completed', label: REQUEST_STATUS_LABELS.completed },
  { value: 'failed', label: REQUEST_STATUS_LABELS.failed },
  { value: 'cancelled', label: REQUEST_STATUS_LABELS.cancelled },
]

const ebookRequests = useCatalogSourceRequests({ page: 1, limit: PAGE_LIMIT })
const audiobookRequests = useCatalogSourceAudiobookRequests({ page: 1, limit: PAGE_LIMIT }, { autoLoad: false })
const comicRequests = useCatalogSourceComicRequests({ page: 1, limit: PAGE_LIMIT }, { autoLoad: false })
const router = useRouter()

const activeMedia = ref<MediaTab>('ebook')
const activeStatus = ref<StatusFilter>('all')
const ebookDialogOpen = ref(false)
const audiobookDialogOpen = ref(false)
const comicDialogOpen = ref(false)
const audiobookLoaded = ref(false)
const comicLoaded = ref(false)
const pendingEbookActionIds = ref<Set<number>>(new Set())
const quickViewItem = ref<DashboardCatalogItem | null>(null)
const quickViewOpen = ref(false)

const activeRequests = computed(() => {
  if (activeMedia.value === 'audiobook') return audiobookRequests
  if (activeMedia.value === 'comic') return comicRequests
  return ebookRequests
})
const activeItems = computed(() => activeRequests.value.items.value)
const showPagination = computed(() => activeRequests.value.total.value > activeRequests.value.limit.value)
const hasPreviousPage = computed(() => activeRequests.value.currentPage.value > 1)
const hasNextPage = computed(() => activeRequests.value.currentPage.value * activeRequests.value.limit.value < activeRequests.value.total.value)
const requestLoading = computed(() => activeRequests.value.loading.value)
const requestError = computed(() => {
  const error = activeRequests.value.error.value
  return error && error !== 'Failed to load queue' ? error : null
})
const queueError = computed(() => {
  const error = audiobookRequests.error.value
  return error === 'Failed to load queue' ? error : null
})
const queueLoading = computed(() => audiobookRequests.queueLoading.value)
const refreshingStatuses = computed(() => {
  if (activeMedia.value === 'comic') return comicRequests.refreshingStatuses.value
  return audiobookRequests.refreshingStatuses.value
})
const emptyMessage = computed(() => {
  if (activeItems.value.length === 0 && activeStatus.value === 'all') return 'No requests yet'
  if (activeItems.value.length === 0) return 'No requests match this filter'
  return null
})

function requestQuery(status: StatusFilter = activeStatus.value) {
  return {
    status: status === 'all' ? undefined : status,
    page: 1,
    limit: PAGE_LIMIT,
  }
}

function mediaQueryMatchesStatus(media: MediaTab): boolean {
  const query = media === 'audiobook' ? audiobookRequests.query.value : media === 'comic' ? comicRequests.query.value : ebookRequests.query.value
  const expectedStatus = activeStatus.value === 'all' ? undefined : activeStatus.value

  return query.status === expectedStatus && query.page === 1 && query.limit === PAGE_LIMIT
}

async function applyStatusQueryForMedia(media: MediaTab, force = false): Promise<void> {
  if (!force && mediaQueryMatchesStatus(media)) return

  if (media === 'ebook') {
    await ebookRequests.setQuery(requestQuery())
    return
  }

  if (media === 'comic') {
    await comicRequests.setQuery(requestQuery())
    return
  }

  await audiobookRequests.setQuery(requestQuery())
}

async function switchMedia(media: MediaTab) {
  activeMedia.value = media

  if (media === 'audiobook') {
    const firstAudiobookLoad = !audiobookLoaded.value
    audiobookLoaded.value = true
    await Promise.all([
      applyStatusQueryForMedia('audiobook', firstAudiobookLoad),
      firstAudiobookLoad ? audiobookRequests.refreshQueue() : Promise.resolve(),
    ])
    return
  }

  if (media === 'comic') {
    const firstComicLoad = !comicLoaded.value
    comicLoaded.value = true
    await applyStatusQueryForMedia('comic', firstComicLoad)
    return
  }

  await applyStatusQueryForMedia('ebook')
}

async function setStatusFilter(status: StatusFilter) {
  activeStatus.value = status

  if (activeMedia.value === 'ebook') {
    await ebookRequests.setQuery(requestQuery(status))
    return
  }

  if (activeMedia.value === 'comic') {
    comicLoaded.value = true
    await comicRequests.setQuery(requestQuery(status))
    return
  }

  audiobookLoaded.value = true
  await audiobookRequests.setQuery(requestQuery(status))
}

function statusToneClass(status: WarehouseRequestStatus): string {
  const tone = REQUEST_STATUS_TONE[status]
  if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200'
  if (tone === 'success')
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200'
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200'
  if (tone === 'muted') return 'border-muted bg-muted/60 text-muted-foreground'
  return 'border-border bg-background text-foreground'
}

function canCancelRequest(request: WarehouseRequestItem): boolean {
  return request.mediaType === 'ebook' && !TERMINAL_STATUSES.has(request.status)
}

function canDownloadRequest(request: WarehouseRequestItem): boolean {
  return request.status === 'completed' && (request.mediaType === 'ebook' || (request.mediaType === 'comic' && !!request.completedRemoteId))
}

function requestDownloadHref(request: WarehouseRequestItem): string | null {
  if (!canDownloadRequest(request)) return null
  if (request.mediaType === 'comic') return request.completedRemoteId ? catalogSourceComicDownloadUrl(request.completedRemoteId) : null
  return catalogSourceRequestStreamUrl(request.id)
}

function completedItemRoute(request: WarehouseRequestItem): CatalogItemRoute | null {
  if (request.status !== 'completed' || !request.completedRemoteId) return null

  return catalogLibraryItemRoute(request.mediaType, request.completedRemoteId)
}

function completedItemHref(request: WarehouseRequestItem): string | null {
  const route = completedItemRoute(request)
  return route ? router.resolve(route).href : null
}

function completedItemLibraryName(request: WarehouseRequestItem): string {
  if (request.mediaType === 'audiobook') return 'Audiobooks'
  if (request.mediaType === 'comic') return 'Comics'
  return 'Books'
}

function completedItemQuickViewItem(request: WarehouseRequestItem): DashboardCatalogItem | null {
  if (request.status !== 'completed' || !request.completedRemoteId) return null

  const author = requestDisplayAuthor(request)
  return {
    type: 'catalog-item',
    mediaType: request.mediaType,
    remoteId: request.completedRemoteId,
    title: requestDisplayTitle(request),
    subtitle: null,
    seriesName: null,
    authors: request.mediaType === 'ebook' && author ? [author] : [],
    narrators: [],
    libraryName: completedItemLibraryName(request),
    formats: [],
    hasCover: false,
  }
}

function openCompletedQuickView(request: WarehouseRequestItem): void {
  quickViewItem.value = completedItemQuickViewItem(request)
  quickViewOpen.value = !!quickViewItem.value
}

function openCompletedItem(request: WarehouseRequestItem, event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  const route = completedItemRoute(request)
  if (route) {
    event.preventDefault()
    void router.push(route)
  }
}

function setEbookActionPending(id: number, pending: boolean) {
  const next = new Set(pendingEbookActionIds.value)
  if (pending) {
    next.add(id)
  } else {
    next.delete(id)
  }
  pendingEbookActionIds.value = next
}

function isEbookActionPending(id: number): boolean {
  return pendingEbookActionIds.value.has(id)
}

async function runEbookRowAction(id: number, action: () => Promise<unknown>): Promise<void> {
  setEbookActionPending(id, true)
  try {
    await action()
  } catch {
    return
  } finally {
    setEbookActionPending(id, false)
  }
}

function refreshRow(request: WarehouseRequestItem) {
  if (request.mediaType === 'ebook') {
    void runEbookRowAction(request.id, () => ebookRequests.refreshRequest(request.id))
  }
}

function cancelRow(request: WarehouseRequestItem) {
  if (canCancelRequest(request)) {
    void runEbookRowAction(request.id, () => ebookRequests.cancelRequest(request.id))
  }
}

async function previousPage() {
  if (hasPreviousPage.value) {
    await activeRequests.value.setPage(activeRequests.value.currentPage.value - 1)
  }
}

async function nextPage() {
  if (hasNextPage.value) {
    await activeRequests.value.setPage(activeRequests.value.currentPage.value + 1)
  }
}

function handleEbookSubmitted() {
  ebookDialogOpen.value = false
  void ebookRequests.refresh()
}

async function handleAudiobookSubmitted() {
  audiobookDialogOpen.value = false
  audiobookLoaded.value = true
  await Promise.all([audiobookRequests.setQuery(requestQuery()), audiobookRequests.refreshQueue()])
}

async function handleComicSubmitted() {
  comicDialogOpen.value = false
  comicLoaded.value = true
  await comicRequests.setQuery(requestQuery())
}

async function refreshAudiobookStatuses(): Promise<void> {
  try {
    await audiobookRequests.refreshStatuses()
  } catch {
    return
  }
}

async function refreshActiveStatuses(): Promise<void> {
  if (activeMedia.value === 'comic') {
    try {
      await comicRequests.refreshStatuses()
    } catch {
      return
    }
    return
  }

  await refreshAudiobookStatuses()
}
</script>

<template>
  <section class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-normal text-foreground">Requests</h1>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-xs hover:bg-muted"
          @click="ebookDialogOpen = true"
        >
          Request Book
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
          @click="audiobookDialogOpen = true"
        >
          Request Audiobook
        </button>
        <button
          type="button"
          class="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-xs hover:bg-muted"
          @click="comicDialogOpen = true"
        >
          Request Comic
        </button>
      </div>
    </header>

    <div class="flex flex-col gap-3">
      <div class="inline-flex w-fit rounded-md border border-border bg-muted/40 p-1">
        <button
          v-for="tab in mediaTabs"
          :key="tab.value"
          type="button"
          class="rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          :class="activeMedia === tab.value ? 'bg-background text-foreground shadow-xs' : ''"
          @click="switchMedia(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="filter in statusFilters"
          :key="filter.value"
          type="button"
          class="rounded-md border px-3 py-1.5 text-sm font-medium transition"
          :class="
            activeStatus === filter.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:bg-muted'
          "
          @click="setStatusFilter(filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </div>

    <div v-if="activeMedia === 'audiobook' || activeMedia === 'comic'" class="flex justify-start">
      <button
        type="button"
        class="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="refreshingStatuses"
        @click="refreshActiveStatuses"
      >
        Refresh statuses
      </button>
    </div>

    <div
      v-if="requestError"
      class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200"
    >
      {{ requestError }}
    </div>

    <div v-else class="overflow-hidden rounded-md border border-border bg-card">
      <div v-if="requestLoading" class="px-4 py-10 text-center text-sm text-muted-foreground">Loading requests</div>
      <div v-else-if="activeItems.length > 0" class="divide-y divide-border">
        <article
          v-for="request in activeItems"
          :key="request.id"
          :data-testid="`request-row-${request.id}`"
          class="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
        >
          <div class="min-w-0 space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold text-foreground">{{ requestDisplayTitle(request) }}</h2>
              <span class="rounded-full border px-2 py-0.5 text-xs font-medium" :class="statusToneClass(request.status)">
                {{ REQUEST_STATUS_LABELS[request.status] }}
              </span>
              <span class="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {{ REQUEST_MEDIA_LABELS[request.mediaType] }}
              </span>
            </div>
            <p v-if="requestDisplayAuthor(request)" class="text-sm text-muted-foreground">{{ requestDisplayAuthor(request) }}</p>
            <dl class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <div class="flex gap-1">
                <dt>Requested</dt>
                <dd>{{ formatRequestDate(request.requestedAt) }}</dd>
              </div>
              <div class="flex gap-1">
                <dt>Updated</dt>
                <dd>{{ formatRequestDate(request.updatedAt) }}</dd>
              </div>
            </dl>
          </div>

          <div class="flex flex-wrap gap-2">
            <a
              v-if="completedItemRoute(request)"
              :data-testid="`request-open-item-${request.id}`"
              :href="completedItemHref(request) ?? undefined"
              class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
              @click="openCompletedItem(request, $event)"
            >
              Open item
            </a>
            <button
              v-if="completedItemQuickViewItem(request)"
              type="button"
              :data-testid="`request-quick-view-${request.id}`"
              class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
              @click="openCompletedQuickView(request)"
            >
              Details
            </button>
            <a
              v-if="requestDownloadHref(request)"
              :data-testid="`request-download-${request.id}`"
              :href="requestDownloadHref(request) ?? undefined"
              class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Download
            </a>
            <button
              v-if="request.mediaType === 'ebook'"
              type="button"
              class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isEbookActionPending(request.id)"
              @click="refreshRow(request)"
            >
              Refresh
            </button>
            <button
              v-if="canCancelRequest(request)"
              type="button"
              class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isEbookActionPending(request.id)"
              @click="cancelRow(request)"
            >
              Cancel
            </button>
          </div>
        </article>
      </div>
      <div v-else class="px-4 py-10 text-center text-sm text-muted-foreground">
        {{ emptyMessage }}
      </div>
    </div>

    <nav v-if="showPagination" class="flex items-center justify-between gap-3">
      <button
        type="button"
        class="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!hasPreviousPage || requestLoading"
        @click="previousPage"
      >
        Previous
      </button>
      <span class="text-sm text-muted-foreground">Page {{ activeRequests.currentPage.value }}</span>
      <button
        type="button"
        class="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!hasNextPage || requestLoading"
        @click="nextPage"
      >
        Next
      </button>
    </nav>

    <section v-if="activeMedia === 'audiobook'" class="space-y-3">
      <h2 class="text-lg font-semibold text-foreground">Queue</h2>
      <div
        v-if="queueError"
        class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200"
      >
        {{ queueError }}
      </div>
      <div v-else-if="queueLoading" class="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        Loading queue
      </div>
      <div v-else-if="audiobookRequests.queueItems.value.length > 0" class="overflow-hidden rounded-md border border-border bg-card">
        <div
          v-for="item in audiobookRequests.queueItems.value"
          :key="`${item.title}-${item.author ?? ''}`"
          class="flex flex-col gap-2 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p class="font-medium text-foreground">{{ item.title }}</p>
            <p v-if="item.author" class="text-sm text-muted-foreground">{{ item.author }}</p>
          </div>
          <span class="w-fit rounded-full border px-2 py-0.5 text-xs font-medium" :class="statusToneClass(item.status)">
            {{ REQUEST_STATUS_LABELS[item.status] }}
          </span>
        </div>
      </div>
    </section>

    <CatalogEbookRequestDialog :open="ebookDialogOpen" @close="ebookDialogOpen = false" @submitted="handleEbookSubmitted" />
    <CatalogAudiobookRequestDialog :open="audiobookDialogOpen" @close="audiobookDialogOpen = false" @submitted="handleAudiobookSubmitted" />
    <CatalogComicRequestDialog :open="comicDialogOpen" @close="comicDialogOpen = false" @submitted="handleComicSubmitted" />
    <CatalogItemQuickView :item="quickViewItem" :open="quickViewOpen" @update:open="quickViewOpen = $event" />
  </section>
</template>
