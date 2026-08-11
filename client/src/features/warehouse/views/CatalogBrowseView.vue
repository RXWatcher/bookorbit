<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowUpDown,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Filter,
  Headphones,
  Loader2,
  MoreVertical,
  PanelRight,
  PanelsTopLeft,
  Play,
  RefreshCw,
  X,
} from '@lucide/vue'
import type { DashboardCatalogItem, RuleField, RuleOperator, WarehouseMediaType } from '@bookorbit/types'
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'
import ViewHeader from '@/components/ViewHeader.vue'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useViewSearch } from '@/features/book/composables/useViewSearch'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceComicPageImageUrl,
  catalogSourceEbookCoverUrl,
} from '@/features/warehouse/api/catalog-source.api'
import { useCatalogLibraryItems } from '@/features/warehouse/composables/useCatalogLibraryItems'
import {
  catalogAuthorLinks,
  catalogAuthorNames,
  catalogAuthorRoute,
  catalogSeriesLink,
  catalogSeriesName,
  catalogSeriesRoute,
} from '@/features/warehouse/lib/catalog-author-links'
import { catalogLibraryItemRoute } from '@/features/warehouse/lib/catalog-item-route'

type CatalogBrowseItem = DashboardCatalogItem
const numberFormatter = new Intl.NumberFormat()
const CATALOG_LIBRARY_FILTER_FIELDS: RuleField[] = ['title', 'author', 'series', 'publisher', 'language', 'format', 'cover']
const CATALOG_TEXT_OPERATORS: RuleOperator[] = ['contains', 'startsWith', 'endsWith', 'eq', 'isEmpty', 'isNotEmpty']
const CATALOG_LIBRARY_FILTER_OPERATORS: Partial<Record<RuleField, RuleOperator[]>> = {
  title: CATALOG_TEXT_OPERATORS,
  publisher: CATALOG_TEXT_OPERATORS,
  series: CATALOG_TEXT_OPERATORS,
  language: CATALOG_TEXT_OPERATORS,
  format: CATALOG_TEXT_OPERATORS,
  author: ['includesAny', 'includesAll', 'isEmpty', 'isNotEmpty'],
  cover: ['isMissing', 'isPresent'],
}

const props = defineProps<{
  libraryId?: number
  mediaType: WarehouseMediaType
  title: string
  subtitle: string
  searchLabel: string
  emptyTitle: string
  emptyDetail: string
}>()

const router = useRouter()
const { searchQuery, debouncedQuery } = useViewSearch()
const { portraitCoverSize, squareCoverSize, portraitGridGap, squareGridGap, viewMode } = useDisplaySettings()
const sourceBackedLibraryId = computed(() => {
  if (props.libraryId != null) return props.libraryId
  if (props.mediaType === 'audiobook') return CLOUD_AUDIO_LIBRARY_ID
  if (props.mediaType === 'comic') return CLOUD_COMIC_LIBRARY_ID
  return CLOUD_EBOOK_LIBRARY_ID
})
const catalog = useCatalogLibraryItems(sourceBackedLibraryId, debouncedQuery)
const sortOrder = computed<'asc' | 'desc'>(() => (catalog.sort.value[0]?.dir === 'desc' ? 'desc' : 'asc'))

const totalPages = computed(() => Math.max(1, Math.ceil(catalog.total.value / catalog.limit.value)))
const canGoPrevious = computed(() => catalog.currentPage.value > 1)
const canGoNext = computed(() => catalog.currentPage.value < totalPages.value)
const icon = computed(() => (props.mediaType === 'audiobook' ? Headphones : props.mediaType === 'comic' ? PanelsTopLeft : BookOpen))
const headerIcon = computed(() => (props.mediaType === 'audiobook' ? 'Headphones' : props.mediaType === 'comic' ? 'PanelsTopLeft' : 'BookOpen'))
const coverSize = computed(() => (props.mediaType === 'audiobook' ? squareCoverSize.value : portraitCoverSize.value))
const gridGap = computed(() => (props.mediaType === 'audiobook' ? squareGridGap.value : portraitGridGap.value))
const coverAspectRatio = computed(() => (props.mediaType === 'audiobook' ? '1/1' : '2/3'))
const libraryKind = computed(() => (props.mediaType === 'audiobook' ? 'audiobook' : props.mediaType === 'comic' ? 'comic' : 'ebook'))
const catalogViewMode = computed<'grid' | 'list'>(() => (viewMode.value === 'list' ? 'list' : 'grid'))
const filterOpen = ref(false)
const showFilterPanel = computed(() => filterOpen.value || activeFilterCount.value > 0)
const gridStyle = computed(() => ({
  gap: `${gridGap.value}px`,
  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${coverSize.value}px), 1fr))`,
}))
const activeFilterCount = computed(() => catalog.filter.value?.rules?.length ?? 0)

watch(debouncedQuery, () => {
  void catalog.search()
})

watch(catalog.filter, () => void catalog.search(), { deep: true })

function isAudiobook(item: CatalogBrowseItem): boolean {
  return item.mediaType === 'audiobook'
}

function creatorsLabel(item: CatalogBrowseItem): string {
  return catalogAuthorNames(item)
}

function detailLabel(item: CatalogBrowseItem): string | null {
  const series = catalogSeriesName(item)
  if (series) return series
  if (item.subtitle) return item.subtitle
  return null
}

function narratorLabel(item: CatalogBrowseItem): string | null {
  if (!isAudiobook(item)) return null
  const narrators = item.narrators.filter(Boolean).join(', ')
  return narrators ? `Narrated by ${narrators}` : null
}

function durationLabel(item: CatalogBrowseItem): string | null {
  if (!isAudiobook(item) || !item.durationSeconds) return null
  const totalMinutes = Math.max(1, Math.round(item.durationSeconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function formatLabel(item: CatalogBrowseItem): string | null {
  return primaryFormat(item)?.toUpperCase() ?? null
}

function coverUrl(item: CatalogBrowseItem): string {
  if (props.mediaType === 'audiobook') return catalogSourceAudiobookCoverUrl(item.remoteId)
  if (props.mediaType === 'comic') return catalogSourceComicPageImageUrl(item.remoteId)
  return catalogSourceEbookCoverUrl(item.remoteId, 'medium')
}

function shouldLoadCover(item: CatalogBrowseItem): boolean {
  return props.mediaType === 'comic' || item.hasCover
}

function coverAuthorLine(item: CatalogBrowseItem): string | null {
  const creators = creatorsLabel(item)
  return creators || narratorLabel(item)
}

function formatColor(item: CatalogBrowseItem): string {
  return `${getFormatColor(primaryFormat(item) ?? '')}cc`
}

function openItem(item: CatalogBrowseItem): void {
  router.push(catalogLibraryItemRoute(props.mediaType, item.remoteId))
}

function openAuthor(author: { id: number; name: string }): void {
  router.push(catalogAuthorRoute(author))
}

function openSeries(series: { id: number; name: string }): void {
  router.push(catalogSeriesRoute(series))
}

function toggleSortOrder(): void {
  const nextOrder = sortOrder.value === 'asc' ? 'desc' : 'asc'
  catalog.sort.value = [{ field: 'title', dir: nextOrder }]
}

function goToPreviousPage(): void {
  if (canGoPrevious.value) void catalog.setPage(catalog.currentPage.value - 1)
}

function goToNextPage(): void {
  if (canGoNext.value) void catalog.setPage(catalog.currentPage.value + 1)
}

function primaryFormat(item: CatalogBrowseItem): string | null {
  return item.formats[0] ?? null
}

function toggleFilterPanel(): void {
  filterOpen.value = !filterOpen.value
}

function clearFilters(): void {
  catalog.filter.value = undefined
  filterOpen.value = false
}
</script>

<template>
  <section class="flex h-full flex-col bg-background">
    <ViewHeader
      :title="title"
      :icon="headerIcon"
      :total="catalog.loading.value ? 0 : catalog.total.value"
      :show-total="!catalog.loading.value || catalog.total.value > 0"
      :cover-size="coverSize"
      :grid-gap="gridGap"
      :view-mode="catalogViewMode"
      :searchable="true"
      :search-query="searchQuery"
      :show-selection="false"
      :show-view-mode-toggle="true"
      :allowed-view-modes="['grid', 'list']"
      :mobile-search-in-menu="false"
      :mobile-display-in-menu="true"
      :cover-size-min="100"
      :cover-size-max="320"
      :cover-size-step="10"
      :grid-gap-min="4"
      :grid-gap-max="56"
      :grid-gap-step="4"
      :cover-shape="props.mediaType === 'audiobook' ? 'square' : undefined"
      @update:cover-size="props.mediaType === 'audiobook' ? (squareCoverSize = $event) : (portraitCoverSize = $event)"
      @update:grid-gap="props.mediaType === 'audiobook' ? (squareGridGap = $event) : (portraitGridGap = $event)"
      @update:view-mode="viewMode = $event"
      @update:search-query="searchQuery = $event"
    >
      <template #toolbar>
        <button
          class="hidden h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
          :class="activeFilterCount > 0 ? 'border-primary/40 bg-primary/8 text-primary' : ''"
          type="button"
          @click="toggleFilterPanel"
        >
          <Filter :size="13" />
          <span>Filters</span>
          <span v-if="activeFilterCount > 0" class="text-xs">{{ activeFilterCount }}</span>
        </button>
        <button
          class="hidden h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
          type="button"
          @click="toggleSortOrder"
        >
          <ArrowUpDown :size="13" />
          <span>Title {{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
        </button>
      </template>
    </ViewHeader>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-2 sm:px-6 lg:px-8">
      <div v-if="showFilterPanel" class="mb-4 rounded-md border border-border bg-muted/20 p-3">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-medium text-muted-foreground">Filter rules</span>
          <div class="flex items-center gap-1.5">
            <button
              v-if="activeFilterCount > 0"
              class="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              type="button"
              @click="clearFilters"
            >
              <X :size="12" />
              Clear
            </button>
            <button
              class="h-7 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              type="button"
              @click="filterOpen = false"
            >
              Close
            </button>
          </div>
        </div>
        <BookFilterBuilder
          v-model="catalog.filter.value"
          :allowed-fields="CATALOG_LIBRARY_FILTER_FIELDS"
          :allowed-operators="CATALOG_LIBRARY_FILTER_OPERATORS"
        />
      </div>

      <div v-if="catalog.loading.value" class="flex min-h-72 items-center justify-center text-muted-foreground">
        <Loader2 :size="24" class="animate-spin" />
      </div>

      <div v-else-if="catalog.error.value" class="rounded-md border border-border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
        <div class="flex flex-wrap items-center gap-3">
          <span>{{ catalog.error.value }}</span>
          <button class="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" type="button" @click="catalog.refresh">
            <RefreshCw :size="14" />
            Retry
          </button>
        </div>
      </div>

      <section
        v-else-if="catalog.items.value.length === 0"
        class="flex min-h-72 flex-col items-center justify-center rounded-md border border-dashed border-border px-4 text-center"
      >
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-muted">
          <component :is="icon" :size="22" class="text-muted-foreground" />
        </div>
        <h2 class="text-base font-semibold text-foreground">{{ emptyTitle }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ emptyDetail }}</p>
      </section>

      <section
        v-else-if="catalogViewMode === 'grid'"
        class="grid w-full max-w-full items-start"
        :style="gridStyle"
        data-testid="catalog-library-grid"
      >
        <div
          v-for="item in catalog.items.value"
          :key="item.remoteId"
          class="group flex min-w-0 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :data-testid="`catalog-browse-item-${item.remoteId}`"
          role="button"
          tabindex="0"
          @click="openItem(item)"
          @keydown.enter.prevent="openItem(item)"
          @keydown.space.prevent="openItem(item)"
        >
          <BookCoverSurface
            class="relative w-full overflow-hidden rounded-sm transition-[box-shadow,transform,ring] duration-200 will-change-transform group-hover:scale-[1.02]"
            :interactive="true"
            :disable-spine="props.mediaType === 'audiobook'"
            :display-mode="props.mediaType === 'audiobook' ? 'fill-crop' : undefined"
            :style="{ aspectRatio: coverAspectRatio }"
          >
            <BookCoverArtwork
              :src="coverUrl(item)"
              :has-cover="shouldLoadCover(item)"
              :title="item.title"
              :author-line="coverAuthorLine(item)"
              :is-audio="props.mediaType === 'audiobook'"
              :seed="item.title || item.remoteId"
              :alt="item.title"
              :frame-aspect-ratio="coverAspectRatio"
              :spine="props.mediaType !== 'audiobook'"
              :mode="props.mediaType === 'audiobook' ? 'fill-crop' : undefined"
            />

            <span
              v-if="formatLabel(item)"
              class="absolute bottom-2 right-2 z-10 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-lg transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0"
              :style="{ backgroundColor: formatColor(item) }"
            >
              {{ formatLabel(item) }}
            </span>

            <div
              class="absolute inset-0 z-20 flex flex-col justify-between bg-gradient-to-b from-black/15 via-black/20 to-black/80 p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              <div class="flex items-start justify-end">
                <span
                  class="inline-flex size-9 items-center justify-center rounded-md bg-black/70 text-white shadow-lg ring-1 ring-white/15 backdrop-blur"
                  :aria-label="`${libraryKind} item`"
                >
                  <PanelRight :size="18" />
                </span>
              </div>

              <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span
                  class="inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl ring-1 ring-white/25"
                >
                  <Play v-if="isAudiobook(item)" :size="30" class="translate-x-0.5 fill-current" data-testid="catalog-audiobook-hover-play" />
                  <component :is="icon" v-else :size="30" />
                </span>
              </div>

              <div class="relative z-10 flex items-end gap-2">
                <div class="min-w-0 flex-1">
                  <h2 class="line-clamp-2 text-sm font-semibold leading-tight text-white drop-shadow">{{ item.title }}</h2>
                  <p v-if="creatorsLabel(item)" class="mt-1 line-clamp-1 text-xs font-medium text-white/80 drop-shadow">{{ creatorsLabel(item) }}</p>
                </div>

                <span
                  class="mb-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/15 backdrop-blur"
                >
                  <MoreVertical :size="18" />
                </span>
              </div>
            </div>
          </BookCoverSurface>

          <div class="mt-2 min-w-0">
            <h2 class="line-clamp-1 text-sm font-semibold leading-snug text-foreground">{{ item.title }}</h2>
            <div v-if="catalogAuthorLinks(item).length > 0" class="mt-0.5 flex min-w-0 flex-wrap gap-x-1 text-xs text-muted-foreground">
              <button
                v-for="(author, index) in catalogAuthorLinks(item)"
                :key="author.id"
                type="button"
                class="min-w-0 truncate hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                @click.stop="openAuthor(author)"
              >
                {{ author.name }}<span v-if="index < catalogAuthorLinks(item).length - 1">,</span>
              </button>
            </div>
            <p v-else-if="creatorsLabel(item)" class="mt-0.5 truncate text-xs text-muted-foreground">{{ creatorsLabel(item) }}</p>
            <p v-if="narratorLabel(item)" class="mt-0.5 truncate text-xs text-muted-foreground">{{ narratorLabel(item) }}</p>
            <p v-if="durationLabel(item)" class="mt-0.5 truncate text-xs text-muted-foreground">{{ durationLabel(item) }}</p>
            <button
              v-if="catalogSeriesLink(item)"
              type="button"
              class="mt-0.5 max-w-full truncate text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @click.stop="openSeries(catalogSeriesLink(item)!)"
            >
              {{ catalogSeriesName(item) }}
            </button>
            <p v-else-if="detailLabel(item)" class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{{ detailLabel(item) }}</p>
          </div>
        </div>
      </section>

      <section v-else class="flex flex-col divide-y divide-border" data-testid="catalog-library-list">
        <div
          v-for="item in catalog.items.value"
          :key="item.remoteId"
          class="group flex min-w-0 cursor-pointer gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :data-testid="`catalog-list-item-${item.remoteId}`"
          role="button"
          tabindex="0"
          @click="openItem(item)"
          @keydown.enter.prevent="openItem(item)"
          @keydown.space.prevent="openItem(item)"
        >
          <BookCoverSurface
            size="mini"
            class="book-cover-surface--spine-fitted h-20 shrink-0 overflow-hidden rounded-sm"
            :disable-spine="props.mediaType === 'audiobook'"
            :display-mode="props.mediaType === 'audiobook' ? 'fill-crop' : undefined"
            :style="{ aspectRatio: coverAspectRatio }"
          >
            <BookCoverArtwork
              :src="coverUrl(item)"
              :has-cover="shouldLoadCover(item)"
              :title="item.title"
              :author-line="coverAuthorLine(item)"
              :is-audio="props.mediaType === 'audiobook'"
              :seed="item.title || item.remoteId"
              :alt="item.title"
              :frame-aspect-ratio="coverAspectRatio"
              :spine="props.mediaType !== 'audiobook'"
              :mode="props.mediaType === 'audiobook' ? 'fill-crop' : undefined"
            />
          </BookCoverSurface>

          <div class="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <h2 class="truncate text-sm font-semibold leading-snug text-foreground">{{ item.title }}</h2>
            <div v-if="catalogAuthorLinks(item).length > 0" class="flex min-w-0 flex-wrap gap-x-1 text-xs text-muted-foreground">
              <button
                v-for="(author, index) in catalogAuthorLinks(item)"
                :key="author.id"
                type="button"
                class="min-w-0 truncate hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                @click.stop="openAuthor(author)"
              >
                {{ author.name }}<span v-if="index < catalogAuthorLinks(item).length - 1">,</span>
              </button>
            </div>
            <p v-else-if="creatorsLabel(item)" class="truncate text-xs text-muted-foreground">{{ creatorsLabel(item) }}</p>
            <p v-if="narratorLabel(item)" class="truncate text-xs text-muted-foreground">{{ narratorLabel(item) }}</p>
            <button
              v-if="catalogSeriesLink(item)"
              type="button"
              class="max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @click.stop="openSeries(catalogSeriesLink(item)!)"
            >
              {{ catalogSeriesName(item) }}
            </button>
            <p v-else-if="detailLabel(item)" class="truncate text-xs text-muted-foreground">{{ detailLabel(item) }}</p>
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                v-if="formatLabel(item)"
                class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
                :style="{ backgroundColor: formatColor(item) }"
              >
                {{ formatLabel(item) }}
              </span>
              <span
                v-if="item.language"
                class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {{ item.language }}
              </span>
              <span v-if="durationLabel(item)" class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {{ durationLabel(item) }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div v-if="!catalog.loading.value && catalog.items.value.length > 0" class="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm font-medium text-muted-foreground">
          Page {{ catalog.currentPage.value }} of {{ totalPages }} · {{ numberFormatter.format(catalog.total.value) }}
          {{ catalog.total.value === 1 ? libraryKind : `${libraryKind}s` }}
        </p>
        <div class="flex items-center gap-2">
          <button
            class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            aria-label="Previous page"
            :disabled="!canGoPrevious || catalog.loading.value"
            @click="goToPreviousPage"
          >
            <ChevronLeft :size="16" />
            Previous
          </button>
          <button
            class="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            aria-label="Next page"
            :disabled="!canGoNext || catalog.loading.value"
            @click="goToNextPage"
          >
            Next
            <ChevronRight :size="16" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
