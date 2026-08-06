<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, BookOpen, Download, Headphones, Library, Loader2, Send, Star } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { CollectionCatalogItemRef, DashboardCatalogItem, GroupRule } from '@bookorbit/types'
import {
  CLOUD_AUDIO_LIBRARY_ID,
  CLOUD_COMIC_LIBRARY_ID,
  CLOUD_EBOOK_LIBRARY_ID,
  Permission,
  getFormatGroup,
  normalizeReaderFormat,
  type WarehouseAudiobookDetail,
  type WarehouseComicCatalogItem,
  type WarehouseEbookCatalogItem,
  type WarehouseMediaType,
  type WarehouseUserCatalogStatePatch,
  type WarehouseUserReadStatus,
} from '@bookorbit/types'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceAudiobookDownloadUrl,
  catalogSourceAudiobookFileDownloadUrl,
  catalogSourceComicDownloadUrl,
  catalogSourceComicPageImageUrl,
  catalogSourceEbookCoverUrl,
  catalogSourceEbookDownloadUrl,
  fetchCatalogLibraryItems,
  fetchCatalogSourceAudiobook,
  fetchCatalogSourceComic,
  fetchCatalogSourceEbook,
} from '@/features/warehouse/api/catalog-source.api'
import { useCatalogSourceUserState } from '@/features/warehouse/composables/useCatalogSourceUserState'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import CatalogRecommendationsRow from '@/features/book/components/detail/CatalogRecommendationsRow.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import { catalogLibraryIdForMediaType, catalogLibraryReaderRoute } from '@/features/warehouse/lib/catalog-item-route'
import {
  catalogAuthorLinks,
  catalogAuthorNames,
  catalogAuthorRoute,
  catalogSeriesLink,
  catalogSeriesName,
  catalogSeriesRoute,
} from '@/features/warehouse/lib/catalog-author-links'
import { parseLibraryRouteId } from '@/features/library/lib/library-route'
import { usePermissions } from '@/features/auth/composables/usePermissions'

type CatalogDetail = WarehouseEbookCatalogItem | WarehouseAudiobookDetail | WarehouseComicCatalogItem
const LIBRARY_ITEM_UNAVAILABLE = 'This library item is not available.'
const RELATED_ITEM_LIMIT = 12

const READ_STATUS_OPTIONS: Array<{ value: WarehouseUserReadStatus; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'want_to_read', label: 'Want to read' },
  { value: 'reading', label: 'Reading' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'rereading', label: 'Rereading' },
  { value: 'read', label: 'Read' },
  { value: 'skimmed', label: 'Skimmed' },
  { value: 'abandoned', label: 'Abandoned' },
]

const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()
const mediaType = computed(() => normalizeMediaType(route.params.mediaType) ?? mediaTypeFromLibraryId(route.params.id))
const userStateMediaType = computed<WarehouseMediaType>(() => mediaType.value ?? 'ebook')
const remoteId = computed(() => String(route.params.remoteId ?? ''))
const userState = useCatalogSourceUserState(userStateMediaType, remoteId, { autoLoad: false })

const detail = ref<CatalogDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const collectionsOpen = ref(false)
const sendBookOpen = ref(false)
const relatedItems = ref<DashboardCatalogItem[]>([])
const relatedLoading = ref(false)

const isAudiobook = computed(() => mediaType.value === 'audiobook')
const isComic = computed(() => mediaType.value === 'comic')
const mediaLabel = computed(() => {
  if (isAudiobook.value) return 'Audiobooks'
  if (isComic.value) return 'Comics'
  return 'Books'
})
const authorLinks = computed(() => catalogAuthorLinks(detail.value))
const authorNames = computed(() => catalogAuthorNames(detail.value))
const seriesLink = computed(() => catalogSeriesLink(detail.value))
const seriesLine = computed(() => catalogSeriesName(detail.value))
const narratorsLine = computed(() => (isAudiobookDetail(detail.value) ? joinNames(detail.value.narrators) : ''))
const formatLabel = computed(() => detail.value?.format?.toUpperCase() ?? null)
const favorite = computed(() => userState.state.value?.favorite ?? false)
const rating = computed(() => userState.state.value?.rating ?? null)
const readStatus = computed(() => userState.state.value?.readStatus ?? null)
const progressPercent = computed(() => userState.state.value?.progressPercent ?? null)
const saving = computed(() => userState.saving.value)
const coverUrl = computed(() => {
  if (!detail.value?.hasCover) return null

  if (isAudiobook.value) return catalogSourceAudiobookCoverUrl(remoteId.value)
  if (isComic.value) return catalogSourceComicPageImageUrl(remoteId.value)
  return catalogSourceEbookCoverUrl(remoteId.value, 'medium')
})
const downloadUrl = computed(() => {
  if (!detail.value) return null

  if (isAudiobook.value) return catalogSourceAudiobookDownloadUrl(remoteId.value)
  if (isComic.value) return catalogSourceComicDownloadUrl(remoteId.value)
  return catalogSourceEbookDownloadUrl(remoteId.value)
})
const readerFormat = computed(() => {
  const format = normalizeReaderFormat(detail.value?.format)
  if (isAudiobook.value) return !format || getFormatGroup(format) === 'audio' ? (format ?? 'm4b') : null
  if (!format) return isComic.value ? 'cbz' : 'epub'
  const group = getFormatGroup(format)
  return group === 'epub' || group === 'pdf' || group === 'cbx' ? format : null
})
const readerActionLabel = computed(() => (isAudiobook.value ? 'Listen' : 'Read'))
const audiobookFiles = computed(() => (isAudiobookDetail(detail.value) ? detail.value.files : []))
const catalogCollectionItems = computed<CollectionCatalogItemRef[]>(() => {
  if (!mediaType.value || !remoteId.value) return []
  return [{ mediaType: mediaType.value, remoteId: remoteId.value }]
})
const catalogEmailEbooks = computed(() => (!isAudiobook.value && !isComic.value && remoteId.value ? [{ remoteId: remoteId.value }] : []))
const canSendViaEmail = computed(() => !isAudiobook.value && !isComic.value && hasPermission(Permission.EmailSend))
let loadRequestId = 0

watch([mediaType, remoteId], () => void loadDetail(), { immediate: true })

async function loadDetail(): Promise<void> {
  const currentRequestId = ++loadRequestId
  const currentMediaType = mediaType.value
  const currentRemoteId = remoteId.value

  if (!currentMediaType || !currentRemoteId) {
    error.value = LIBRARY_ITEM_UNAVAILABLE
    detail.value = null
    relatedItems.value = []
    relatedLoading.value = false
    return
  }

  loading.value = true
  error.value = null
  relatedItems.value = []

  try {
    const item = await fetchCatalogDetail(currentMediaType, currentRemoteId)
    if (currentRequestId !== loadRequestId) return

    if (!item) {
      error.value = LIBRARY_ITEM_UNAVAILABLE
      detail.value = null
      return
    }

    detail.value = item
    await Promise.all([userState.load(), loadRelatedItems(item, currentRequestId, currentMediaType, currentRemoteId)])
  } catch {
    if (currentRequestId === loadRequestId) {
      error.value = LIBRARY_ITEM_UNAVAILABLE
    }
  } finally {
    if (currentRequestId === loadRequestId) {
      loading.value = false
    }
  }
}

async function loadRelatedItems(
  item: CatalogDetail,
  requestId: number,
  currentMediaType: WarehouseMediaType,
  currentRemoteId: string,
): Promise<void> {
  relatedItems.value = []

  const filter = buildRelatedItemsFilter(item)
  if (!filter) return

  relatedLoading.value = true

  try {
    const page = await fetchCatalogLibraryItems(
      catalogLibraryIdForMediaType(currentMediaType),
      {
        filter,
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: RELATED_ITEM_LIMIT + 1 },
      },
      new AbortController().signal,
    )

    if (requestId !== loadRequestId || mediaType.value !== currentMediaType || remoteId.value !== currentRemoteId) return

    relatedItems.value = page.items
      .filter((item) => item.mediaType !== currentMediaType || item.remoteId !== currentRemoteId)
      .slice(0, RELATED_ITEM_LIMIT)
  } catch {
    if (requestId === loadRequestId) {
      relatedItems.value = []
    }
  } finally {
    if (requestId === loadRequestId) {
      relatedLoading.value = false
    }
  }
}

function buildRelatedItemsFilter(item: CatalogDetail): GroupRule | null {
  const rules: GroupRule['rules'] = []
  const series = item.series?.trim()
  const authors = [...new Set(item.authors.map((name) => name.trim()).filter(Boolean))].slice(0, 5)

  if (series) {
    rules.push({ type: 'rule', field: 'series', operator: 'contains', value: series })
  }

  if (authors.length > 0) {
    rules.push({ type: 'rule', field: 'author', operator: 'includesAny', value: authors })
  }

  return rules.length > 0 ? { type: 'group', join: 'OR', rules } : null
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back()
    return
  }

  router.push({ name: 'dashboard' })
}

async function saveLibraryState(patch: WarehouseUserCatalogStatePatch): Promise<void> {
  try {
    await userState.save(patch)
  } catch {
    toast.error('Failed to save library state')
  }
}

function toggleFavorite(): void {
  void saveLibraryState({ favorite: !favorite.value })
}

function setRating(nextRating: number | null): void {
  void saveLibraryState({ rating: nextRating })
}

function setReadStatus(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void saveLibraryState({ readStatus: value ? (value as WarehouseUserReadStatus) : null })
}

function openCollections(): void {
  collectionsOpen.value = true
}

function openSendBook(): void {
  sendBookOpen.value = true
}

function openReader(): void {
  if (!readerFormat.value || !mediaType.value) return
  router.push({ ...catalogLibraryReaderRoute(mediaType.value, remoteId.value), query: { format: readerFormat.value } })
}

function openAuthor(author: { id: number; name: string }): void {
  router.push(catalogAuthorRoute(author, route.fullPath))
}

function openSeries(series: { id: number; name: string }): void {
  router.push(catalogSeriesRoute(series, route.fullPath))
}

function normalizeMediaType(value: unknown): WarehouseMediaType | null {
  return value === 'ebook' || value === 'audiobook' || value === 'comic' ? value : null
}

function mediaTypeFromLibraryId(value: unknown): WarehouseMediaType | null {
  const id = parseLibraryRouteId(value)
  if (id === CLOUD_EBOOK_LIBRARY_ID) return 'ebook'
  if (id === CLOUD_AUDIO_LIBRARY_ID) return 'audiobook'
  if (id === CLOUD_COMIC_LIBRARY_ID) return 'comic'
  return null
}

function fetchCatalogDetail(mediaType: WarehouseMediaType, remoteId: string): Promise<CatalogDetail | null> {
  if (mediaType === 'audiobook') return fetchCatalogSourceAudiobook(remoteId)
  if (mediaType === 'comic') return fetchCatalogSourceComic(remoteId)
  return fetchCatalogSourceEbook(remoteId)
}

function isAudiobookDetail(item: CatalogDetail | null): item is WarehouseAudiobookDetail {
  return !!item && 'narrators' in item
}

function joinNames(names: string[] | null | undefined): string {
  return names?.filter(Boolean).join(', ') ?? ''
}

function audiobookFileDownloadUrl(fileId: string): string {
  return catalogSourceAudiobookFileDownloadUrl(remoteId.value, fileId)
}

function formatFileDuration(durationSeconds: number | null): string | null {
  if (!durationSeconds) return null

  return `${Math.max(1, Math.round(durationSeconds / 60))} min`
}
</script>

<template>
  <main class="h-full overflow-y-auto bg-background">
    <div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <button class="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" @click="goBack">
        <ArrowLeft :size="16" />
        <span>Back</span>
      </button>

      <div v-if="loading" class="flex min-h-72 items-center justify-center text-muted-foreground">
        <Loader2 :size="22" class="animate-spin" />
      </div>

      <div v-else-if="error" class="rounded-md border border-border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
        {{ error }}
      </div>

      <template v-else-if="detail">
        <section class="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div class="w-full max-w-[220px]">
            <img v-if="coverUrl" :src="coverUrl" :alt="detail.title" class="aspect-[2/3] w-full rounded-md object-cover bg-muted" />
            <div v-else class="aspect-[2/3] w-full rounded-md bg-muted flex items-center justify-center text-muted-foreground">
              <Headphones v-if="isAudiobook" :size="42" />
              <BookOpen v-else :size="42" />
            </div>
          </div>

          <div class="min-w-0">
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <span class="rounded border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{{ mediaLabel }}</span>
            </div>

            <h1 class="text-3xl font-semibold leading-tight tracking-normal text-foreground sm:text-4xl">{{ detail.title }}</h1>
            <p v-if="detail.subtitle" class="mt-2 text-lg text-muted-foreground">{{ detail.subtitle }}</p>
            <div v-if="authorLinks.length > 0" class="mt-4 flex flex-wrap gap-x-1 text-sm text-muted-foreground">
              <button
                v-for="(author, index) in authorLinks"
                :key="author.id"
                type="button"
                class="hover:text-foreground hover:underline"
                @click="openAuthor(author)"
              >
                {{ author.name }}<span v-if="index < authorLinks.length - 1">,</span>
              </button>
            </div>
            <p v-else-if="authorNames" class="mt-4 text-sm text-muted-foreground">{{ authorNames }}</p>
            <p v-if="narratorsLine" class="mt-1 text-sm text-muted-foreground">Narrated by {{ narratorsLine }}</p>
            <button
              v-if="seriesLink"
              type="button"
              class="mt-1 text-left text-sm italic text-muted-foreground hover:text-foreground hover:underline"
              @click="openSeries(seriesLink)"
            >
              {{ seriesLine }}
            </button>
            <p v-else-if="seriesLine" class="mt-1 text-sm italic text-muted-foreground">{{ seriesLine }}</p>

            <div class="mt-5 flex flex-wrap gap-2">
              <button
                v-if="readerFormat"
                class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
                @click="openReader"
              >
                <Headphones v-if="isAudiobook" :size="15" />
                <BookOpen v-else :size="15" />
                <span>{{ readerActionLabel }}</span>
              </button>
              <button
                class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                :disabled="saving"
                @click="toggleFavorite"
              >
                <Star :size="15" :class="favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'" />
                <span>{{ favorite ? 'Favorited' : 'Favorite' }}</span>
              </button>
              <button
                class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
                @click="openCollections"
              >
                <Library :size="15" />
                <span>Collections</span>
              </button>
              <button
                v-if="canSendViaEmail"
                class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
                @click="openSendBook"
              >
                <Send :size="15" />
                <span>Send via Email</span>
              </button>
              <a
                v-if="downloadUrl"
                :href="downloadUrl"
                class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Download :size="15" />
                <span>Download</span>
              </a>
            </div>
          </div>
        </section>

        <CatalogRecommendationsRow :items="relatedItems" :loading="relatedLoading" />

        <section v-if="audiobookFiles.length > 0" class="mt-8 border-t border-border pt-6">
          <h2 class="mb-1 text-sm font-semibold text-foreground">Files</h2>
          <ul class="divide-y divide-border">
            <li v-for="file in audiobookFiles" :key="file.id" class="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-foreground">{{ file.name }}</p>
                <p
                  v-if="file.format || formatFileDuration(file.durationSeconds)"
                  class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground"
                >
                  <span v-if="file.format">{{ file.format.toUpperCase() }}</span>
                  <span v-if="formatFileDuration(file.durationSeconds)">{{ formatFileDuration(file.durationSeconds) }}</span>
                </p>
              </div>
              <a
                :href="audiobookFileDownloadUrl(file.id)"
                class="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Download :size="15" />
                <span>Download</span>
              </a>
            </li>
          </ul>
        </section>

        <section class="mt-8 grid gap-6 border-t border-border pt-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <h2 class="mb-3 text-sm font-semibold text-foreground">Details</h2>
            <dl class="grid gap-3 text-sm sm:grid-cols-2">
              <div v-if="formatLabel">
                <dt class="text-muted-foreground">Format</dt>
                <dd class="font-medium text-foreground">{{ formatLabel }}</dd>
              </div>
              <div v-if="detail.publisher">
                <dt class="text-muted-foreground">Publisher</dt>
                <dd class="font-medium text-foreground">{{ detail.publisher }}</dd>
              </div>
              <div v-if="detail.language">
                <dt class="text-muted-foreground">Language</dt>
                <dd class="font-medium text-foreground">{{ detail.language }}</dd>
              </div>
              <div v-if="isAudiobookDetail(detail) && detail.durationSeconds">
                <dt class="text-muted-foreground">Duration</dt>
                <dd class="font-medium text-foreground">{{ Math.round(detail.durationSeconds / 60) }} min</dd>
              </div>
            </dl>
          </div>

          <div>
            <h2 class="mb-3 text-sm font-semibold text-foreground">Your State</h2>
            <div class="space-y-4">
              <div>
                <p class="mb-2 text-xs font-medium uppercase text-muted-foreground">Rating</p>
                <div class="flex items-center gap-1">
                  <button
                    v-for="star in [1, 2, 3, 4, 5]"
                    :key="star"
                    :data-testid="`catalog-detail-rating-${star}`"
                    class="rounded p-1 text-muted-foreground transition-colors hover:text-amber-400 disabled:opacity-60"
                    :disabled="saving"
                    @click="setRating(rating === star ? null : star)"
                  >
                    <Star :size="18" :class="(rating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : ''" />
                  </button>
                </div>
              </div>

              <label class="block">
                <span class="mb-2 block text-xs font-medium uppercase text-muted-foreground">Read status</span>
                <select
                  data-testid="catalog-detail-read-status"
                  class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  :value="readStatus ?? ''"
                  :disabled="saving"
                  @change="setReadStatus"
                >
                  <option value="">Unset</option>
                  <option v-for="option in READ_STATUS_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>

              <div v-if="progressPercent != null">
                <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>{{ Math.round(progressPercent) }}%</span>
                </div>
                <div class="h-2 overflow-hidden rounded bg-muted">
                  <div class="h-full bg-primary" :style="{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <AddToCollectionSheet
          :open="collectionsOpen"
          :book-ids="[]"
          :catalog-items="catalogCollectionItems"
          :selection-payload="{ bookIds: [] }"
          :selected-count="catalogCollectionItems.length"
          @update:open="collectionsOpen = $event"
        />
        <SendBookDialog
          :open="sendBookOpen"
          :book-ids="[]"
          :catalog-ebooks="catalogEmailEbooks"
          :selection-payload="{ bookIds: [] }"
          :selected-count="catalogEmailEbooks.length"
          :book-title="detail.title"
          @update:open="sendBookOpen = $event"
        />
      </template>
    </div>
  </main>
</template>
