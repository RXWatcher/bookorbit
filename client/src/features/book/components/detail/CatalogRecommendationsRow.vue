<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, ChevronLeft, ChevronRight, Headphones, Library, PanelRight, PanelsTopLeft } from '@lucide/vue'
import { useRouter } from 'vue-router'

import type { DashboardCatalogItem } from '@bookorbit/types'
import { useCatalogRecommendations } from '@/features/book/composables/useCatalogRecommendations'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceComicPageImageUrl,
  catalogSourceEbookCoverUrl,
} from '@/features/warehouse/api/catalog-source.api'
import CatalogItemQuickView from '@/features/warehouse/components/CatalogItemQuickView.vue'
import { catalogLibraryItemRoute } from '@/features/warehouse/lib/catalog-item-route'

const props = defineProps<{
  bookId?: number
  items?: DashboardCatalogItem[]
  loading?: boolean
}>()

const router = useRouter()
const { recommendations, loading: fetchedLoading, fetch } = useCatalogRecommendations()
const displayedItems = computed(() => props.items ?? recommendations.value)
const activeLoading = computed(() => (props.items === undefined ? fetchedLoading.value : (props.loading ?? false)))
const visible = computed(() => activeLoading.value || displayedItems.value.length > 0)
const quickViewItem = ref<DashboardCatalogItem | null>(null)
const quickViewOpen = ref(false)

function openItem(item: DashboardCatalogItem) {
  router.push(catalogLibraryItemRoute(item.mediaType, item.remoteId))
}

function openQuickView(item: DashboardCatalogItem) {
  quickViewItem.value = item
  quickViewOpen.value = true
}

function coverUrl(item: DashboardCatalogItem): string | null {
  if (!item.hasCover) return null
  if (item.mediaType === 'audiobook') return catalogSourceAudiobookCoverUrl(item.remoteId)
  if (item.mediaType === 'comic') return catalogSourceComicPageImageUrl(item.remoteId)
  return catalogSourceEbookCoverUrl(item.remoteId, 'medium')
}

function creatorsLabel(item: DashboardCatalogItem): string {
  const people = item.authors.length > 0 ? item.authors : item.narrators
  return people.join(', ')
}

function detailLabel(item: DashboardCatalogItem): string {
  if (item.seriesName) return item.seriesName
  if (item.subtitle) return item.subtitle
  if (item.mediaType === 'comic') return 'Comic'
  return item.mediaType === 'audiobook' ? 'Audiobook' : 'Ebook'
}

watch(
  () => props.bookId,
  (id) => {
    if (props.items !== undefined || typeof id !== 'number') return
    fetch(id)
  },
  { immediate: true },
)
</script>

<template>
  <template v-if="visible">
    <div class="mt-8 border-t border-border pt-6">
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Library :size="14" class="text-muted-foreground" />
          <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">More From Libraries</p>
        </div>
        <div class="flex items-center gap-1 text-muted-foreground">
          <ChevronLeft :size="14" />
          <ChevronRight :size="14" />
        </div>
      </div>

      <div v-if="activeLoading" class="flex gap-4 overflow-x-auto pb-2">
        <div v-for="i in 8" :key="i" class="w-[132px] shrink-0">
          <div class="aspect-square w-full animate-shimmer rounded-sm bg-muted" />
          <div class="mt-2 h-3 w-4/5 animate-shimmer rounded bg-muted" />
        </div>
      </div>

      <div v-else class="flex gap-6 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          v-for="(item, index) in displayedItems"
          :key="`${item.mediaType}-${item.remoteId}`"
          class="group/item w-[132px] shrink-0 cursor-pointer text-left outline-none animate-fade-up"
          data-testid="catalog-recommendation-item"
          role="button"
          tabindex="0"
          :style="{ animationDelay: `${index * 40}ms` }"
          @click="openItem(item)"
          @keydown.enter.prevent="openItem(item)"
          @keydown.space.prevent="openItem(item)"
        >
          <div
            class="relative grid aspect-square w-full place-items-center overflow-hidden rounded-sm border border-border bg-muted shadow-sm transition-transform group-hover/item:scale-[1.02] group-focus-visible/item:ring-2 group-focus-visible/item:ring-ring"
          >
            <img v-if="coverUrl(item)" :src="coverUrl(item) ?? undefined" :alt="item.title" class="h-full w-full object-cover" loading="lazy" />
            <component
              :is="item.mediaType === 'audiobook' ? Headphones : item.mediaType === 'comic' ? PanelsTopLeft : BookOpen"
              v-else
              :size="30"
              class="text-muted-foreground/65"
              :data-testid="item.mediaType === 'comic' ? 'catalog-recommendation-media-icon-comic' : undefined"
            />
            <span
              v-if="item.formats.length > 0"
              class="absolute bottom-1.5 right-1.5 rounded border border-border bg-background/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-normal text-foreground shadow-sm"
            >
              {{ item.formats[0] }}
            </span>
          </div>
          <p class="mt-2 line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">{{ item.title }}</p>
          <p v-if="creatorsLabel(item)" class="mt-0.5 truncate text-[11px] text-muted-foreground">{{ creatorsLabel(item) }}</p>
          <p class="mt-0.5 truncate text-[11px] text-muted-foreground/80">{{ detailLabel(item) }}</p>
          <button
            data-testid="catalog-recommendation-quick-view"
            class="mt-2 inline-flex items-center gap-1 rounded border border-border bg-background/80 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
            type="button"
            title="Quick view"
            @click.stop="openQuickView(item)"
            @keydown.enter.stop
            @keydown.space.stop
          >
            <PanelRight :size="12" />
            Details
          </button>
        </div>
      </div>
    </div>

    <CatalogItemQuickView :item="quickViewItem" :open="quickViewOpen" @update:open="quickViewOpen = $event" />
  </template>
</template>
