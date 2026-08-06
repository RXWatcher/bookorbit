<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, ExternalLink, FolderPlus, Headphones, Star } from '@lucide/vue'
import type {
  CollectionCatalogItemRef,
  DashboardCatalogItem,
  WarehouseAudiobookDetail,
  WarehouseComicCatalogItem,
  WarehouseEbookCatalogItem,
  WarehouseMediaType,
  WarehouseUserCatalogStatePatch,
  WarehouseUserReadStatus,
} from '@bookorbit/types'
import { getFormatGroup, normalizeReaderFormat } from '@bookorbit/types'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceComicPageImageUrl,
  catalogSourceEbookCoverUrl,
  fetchCatalogSourceAudiobook,
  fetchCatalogSourceComic,
  fetchCatalogSourceEbook,
} from '@/features/warehouse/api/catalog-source.api'
import { useCatalogSourceUserState } from '@/features/warehouse/composables/useCatalogSourceUserState'
import {
  catalogAuthorLinks,
  catalogAuthorNames,
  catalogAuthorRoute,
  catalogSeriesLink,
  catalogSeriesName,
  catalogSeriesRoute,
} from '@/features/warehouse/lib/catalog-author-links'
import { catalogLibraryItemRoute, catalogLibraryReaderRoute } from '@/features/warehouse/lib/catalog-item-route'

type CatalogDetail = WarehouseEbookCatalogItem | WarehouseAudiobookDetail | WarehouseComicCatalogItem
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

const props = defineProps<{
  item: DashboardCatalogItem | null
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const router = useRouter()
const detail = ref<CatalogDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const collectionsOpen = ref(false)
let loadRequestId = 0

const mediaType = computed<WarehouseMediaType | null>(() => props.item?.mediaType ?? null)
const userStateMediaType = computed<WarehouseMediaType>(() => mediaType.value ?? 'ebook')
const remoteId = computed(() => props.item?.remoteId ?? '')
const userState = useCatalogSourceUserState(userStateMediaType, remoteId, { autoLoad: false })
const isAudiobook = computed(() => mediaType.value === 'audiobook')
const isComic = computed(() => mediaType.value === 'comic')
const mediaLabel = computed(() => props.item?.libraryName ?? (isAudiobook.value ? 'Audiobooks' : isComic.value ? 'Comics' : 'Books'))
const displayTitle = computed(() => detail.value?.title ?? props.item?.title ?? 'Library item')
const subtitle = computed(() => detail.value?.subtitle ?? props.item?.subtitle ?? null)
const authorLinks = computed(() => catalogAuthorLinks(detail.value ?? props.item))
const authorsLine = computed(() => catalogAuthorNames(detail.value ?? props.item))
const narratorsLine = computed(() => (isAudiobookDetail(detail.value) ? joinNames(detail.value.narrators) : joinNames(props.item?.narrators)))
const seriesLink = computed(() => catalogSeriesLink(detail.value ?? props.item))
const seriesLine = computed(() => catalogSeriesName(detail.value ?? props.item))
const publisher = computed(() => detail.value?.publisher ?? props.item?.publisher ?? null)
const language = computed(() => detail.value?.language ?? props.item?.language ?? null)
const format = computed(() => detail.value?.format ?? props.item?.formats[0] ?? null)
const durationSeconds = computed(() => (isAudiobookDetail(detail.value) ? detail.value.durationSeconds : (props.item?.durationSeconds ?? null)))
const hasCover = computed(() => detail.value?.hasCover ?? props.item?.hasCover ?? false)
const coverUrl = computed(() => {
  if (!props.item || !hasCover.value) return null
  if (isAudiobook.value) return catalogSourceAudiobookCoverUrl(props.item.remoteId)
  if (isComic.value) return catalogSourceComicPageImageUrl(props.item.remoteId)
  return catalogSourceEbookCoverUrl(props.item.remoteId, 'medium')
})
const readerFormat = computed(() => {
  const normalized = normalizeReaderFormat(format.value)
  if (!normalized) {
    if (isAudiobook.value) return 'm4b'
    if (isComic.value) return 'cbz'
    return 'epub'
  }
  const group = getFormatGroup(normalized)
  if (isAudiobook.value) return group === 'audio' ? normalized : null
  return group === 'epub' || group === 'pdf' || group === 'cbx' ? normalized : null
})
const readerActionLabel = computed(() => (isAudiobook.value ? 'Listen' : 'Read'))
const catalogCollectionItems = computed<CollectionCatalogItemRef[]>(() =>
  props.item ? [{ mediaType: props.item.mediaType, remoteId: props.item.remoteId }] : [],
)
const favorite = computed(() => userState.state.value?.favorite ?? false)
const rating = computed(() => userState.state.value?.rating ?? null)
const readStatus = computed(() => userState.state.value?.readStatus ?? null)
const progressPercent = computed(() => userState.state.value?.progressPercent ?? null)
const saving = computed(() => userState.saving.value)
const stateError = computed(() => userState.error.value)

watch([() => props.open, mediaType, remoteId], () => void loadDetail(), { immediate: true })

async function loadDetail(): Promise<void> {
  const currentItem = props.item
  if (!props.open || !currentItem) {
    detail.value = null
    error.value = null
    loading.value = false
    collectionsOpen.value = false
    return
  }

  const requestId = ++loadRequestId
  loading.value = true
  error.value = null

  try {
    const detailPromise = fetchCatalogDetail(currentItem.mediaType, currentItem.remoteId)
    const statePromise = userState.load()
    const next = await detailPromise
    await statePromise
    if (requestId !== loadRequestId) return

    if (!next) {
      detail.value = null
      error.value = 'This library item is not available.'
      return
    }

    detail.value = next
  } catch {
    if (requestId === loadRequestId) {
      detail.value = null
      error.value = 'This library item is not available.'
    }
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

function openDetails(): void {
  if (!props.item) return
  router.push(catalogLibraryItemRoute(props.item.mediaType, props.item.remoteId))
  emit('update:open', false)
}

function openReader(): void {
  if (!props.item || !readerFormat.value) return
  router.push({ ...catalogLibraryReaderRoute(props.item.mediaType, props.item.remoteId), query: { format: readerFormat.value } })
  emit('update:open', false)
}

function openAuthor(author: { id: number; name: string }): void {
  router.push(catalogAuthorRoute(author))
  emit('update:open', false)
}

function openSeries(series: { id: number; name: string }): void {
  router.push(catalogSeriesRoute(series))
  emit('update:open', false)
}

function openCollections(): void {
  collectionsOpen.value = true
}

async function saveLibraryState(patch: WarehouseUserCatalogStatePatch): Promise<void> {
  try {
    await userState.save(patch)
  } catch {
    // The composable exposes the save error; keep the quick view open and optimistic state reverted.
  }
}

function toggleFavorite(): void {
  void saveLibraryState({ favorite: !favorite.value })
}

function setRating(nextRating: number | null): void {
  void saveLibraryState({ rating: rating.value === nextRating ? null : nextRating })
}

function setReadStatus(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void saveLibraryState({ readStatus: value ? (value as WarehouseUserReadStatus) : null })
}

function updateOpen(value: boolean): void {
  emit('update:open', value)
}

function isAudiobookDetail(item: CatalogDetail | null): item is WarehouseAudiobookDetail {
  return !!item && 'narrators' in item
}

function fetchCatalogDetail(mediaType: WarehouseMediaType, remoteId: string): Promise<CatalogDetail | null> {
  if (mediaType === 'audiobook') return fetchCatalogSourceAudiobook(remoteId)
  if (mediaType === 'comic') return fetchCatalogSourceComic(remoteId)
  return fetchCatalogSourceEbook(remoteId)
}

function joinNames(names: string[] | null | undefined): string {
  return names?.filter(Boolean).join(', ') ?? ''
}

function durationLabel(seconds: number | null | undefined): string | null {
  if (!seconds) return null
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}
</script>

<template>
  <Sheet :open="open" @update:open="updateOpen">
    <SheetContent side="right" class="sm:max-w-100 p-0 overflow-hidden">
      <SheetTitle class="sr-only">{{ displayTitle ? `Quick view for ${displayTitle}` : 'Library item quick view' }}</SheetTitle>
      <SheetDescription class="sr-only">Preview library item details and actions.</SheetDescription>

      <div class="flex h-full flex-col">
        <div class="border-b p-5 pt-10">
          <div v-if="loading" class="flex gap-4">
            <Skeleton class="h-36 w-24 shrink-0 rounded" />
            <div class="flex-1 space-y-2 pt-1">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-3 w-3/4" />
              <Skeleton class="h-3 w-1/2" />
            </div>
          </div>

          <div v-else-if="error" class="rounded-md border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
            {{ error }}
          </div>

          <div v-else class="flex gap-4">
            <BookCoverSurface
              class="book-cover-surface--spine-fitted relative h-36 w-24 shrink-0 overflow-hidden rounded-sm"
              :disable-spine="isAudiobook"
              :display-mode="isAudiobook ? 'fill-crop' : undefined"
              :style="{ aspectRatio: isAudiobook ? '1/1' : '2/3' }"
            >
              <BookCoverArtwork
                :src="coverUrl"
                :has-cover="hasCover"
                :title="displayTitle"
                :author-line="authorsLine || narratorsLine"
                :is-audio="isAudiobook"
                :seed="displayTitle || remoteId"
                :alt="displayTitle"
                :frame-aspect-ratio="isAudiobook ? '1/1' : '2/3'"
                :spine="!isAudiobook"
                :mode="isAudiobook ? 'fill-crop' : undefined"
              />
            </BookCoverSurface>

            <div class="min-w-0 flex-1">
              <div class="mb-2 flex flex-wrap items-center gap-1.5">
                <span class="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {{ mediaLabel }}
                </span>
                <span v-if="format" class="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {{ format }}
                </span>
              </div>
              <h2 class="line-clamp-3 text-base font-semibold leading-snug text-foreground">{{ displayTitle }}</h2>
              <p v-if="subtitle" class="mt-1 line-clamp-2 text-xs text-muted-foreground">{{ subtitle }}</p>
              <div v-if="authorLinks.length > 0" class="mt-2 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
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
              <p v-else-if="authorsLine" class="mt-2 line-clamp-2 text-xs text-muted-foreground">{{ authorsLine }}</p>
              <p v-if="narratorsLine" class="mt-1 line-clamp-1 text-xs text-muted-foreground">Narrated by {{ narratorsLine }}</p>
            </div>
          </div>
        </div>

        <div v-if="!loading && !error && item" class="flex-1 overflow-y-auto p-5">
          <div class="grid grid-cols-2 gap-2">
            <button
              v-if="readerFormat"
              type="button"
              data-testid="catalog-quick-view-action-read"
              class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
              @click="openReader"
            >
              <Headphones v-if="isAudiobook" :size="15" />
              <BookOpen v-else :size="15" />
              {{ readerActionLabel }}
            </button>
            <button
              type="button"
              data-testid="catalog-quick-view-action-details"
              class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
              @click="openDetails"
            >
              <ExternalLink :size="15" />
              Details
            </button>
            <button
              type="button"
              data-testid="catalog-quick-view-action-favorite"
              class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              :disabled="saving"
              @click="toggleFavorite"
            >
              <Star :size="15" :class="favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'" />
              {{ favorite ? 'Favorited' : 'Favorite' }}
            </button>
            <button
              type="button"
              class="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
              @click="openCollections"
            >
              <FolderPlus :size="15" />
              Collections
            </button>
          </div>

          <section class="mt-6 rounded-md border border-border/70 bg-muted/20 p-3">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your State</h3>
            <p v-if="stateError" class="mb-3 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {{ stateError }}
            </p>
            <div class="space-y-4">
              <div>
                <p class="mb-2 text-xs font-medium uppercase text-muted-foreground">Rating</p>
                <div class="flex items-center gap-1">
                  <button
                    v-for="star in [1, 2, 3, 4, 5]"
                    :key="star"
                    type="button"
                    :data-testid="`catalog-quick-view-rating-${star}`"
                    class="rounded p-1 text-muted-foreground transition-colors hover:text-amber-400 disabled:opacity-60"
                    :disabled="saving"
                    :aria-label="rating === star ? `Clear ${star} star rating` : `Set rating to ${star} stars`"
                    :aria-pressed="rating === star"
                    @click="setRating(star)"
                  >
                    <Star :size="18" :class="(rating ?? 0) >= star ? 'fill-amber-400 text-amber-400' : ''" />
                  </button>
                </div>
              </div>

              <label class="block">
                <span class="mb-2 block text-xs font-medium uppercase text-muted-foreground">Read status</span>
                <select
                  data-testid="catalog-quick-view-read-status"
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
                <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }" />
                </div>
              </div>
            </div>
          </section>

          <section class="mt-6 space-y-3 text-sm">
            <div v-if="seriesLine">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Series</p>
              <button v-if="seriesLink" type="button" class="mt-1 text-left text-foreground hover:underline" @click="openSeries(seriesLink)">
                {{ seriesLine }}
              </button>
              <p v-else class="mt-1 text-foreground">{{ seriesLine }}</p>
            </div>
            <div v-if="publisher">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Publisher</p>
              <p class="mt-1 text-foreground">{{ publisher }}</p>
            </div>
            <div v-if="language">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Language</p>
              <p class="mt-1 uppercase text-foreground">{{ language }}</p>
            </div>
            <div v-if="durationLabel(durationSeconds)">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duration</p>
              <p class="mt-1 text-foreground">{{ durationLabel(durationSeconds) }}</p>
            </div>
          </section>
        </div>
      </div>

      <AddToCollectionSheet
        :open="collectionsOpen"
        :selection-payload="{ bookIds: [] }"
        :selected-count="catalogCollectionItems.length"
        @update:open="collectionsOpen = $event"
      />
    </SheetContent>
  </Sheet>
</template>
