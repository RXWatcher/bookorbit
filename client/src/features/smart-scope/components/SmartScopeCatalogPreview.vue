<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { ExternalLink, Library, RefreshCw } from '@lucide/vue'
import { useRouter } from 'vue-router'

import type { DashboardCatalogItem, SortSpec } from '@bookorbit/types'
import CatalogBookCoverCard from '@/features/book/components/CatalogBookCoverCard.vue'
import CatalogItemQuickView from '@/features/warehouse/components/CatalogItemQuickView.vue'
import { catalogLibraryItemRoute } from '@/features/warehouse/lib/catalog-item-route'
import { useSmartScopeCatalogItems } from '@/features/smart-scope/composables/useSmartScopeCatalogItems'

const props = defineProps<{
  smartScopeId: number
  q: string
  sort: SortSpec[]
}>()

const router = useRouter()
const { items, total, loading, error, refresh } = useSmartScopeCatalogItems(toRef(props, 'smartScopeId'), toRef(props, 'q'), toRef(props, 'sort'), 20)
const quickViewItem = ref<DashboardCatalogItem | null>(null)
const quickViewOpen = ref(false)

const visible = computed(() => loading.value || error.value || items.value.length > 0)

function openItem(item: DashboardCatalogItem) {
  router.push(catalogLibraryItemRoute(item.mediaType, item.remoteId))
}

function openQuickView(item: DashboardCatalogItem) {
  quickViewItem.value = item
  quickViewOpen.value = true
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
</script>

<template>
  <section v-if="visible" class="mb-4 overflow-hidden rounded-lg border border-border/70 bg-card/55">
    <div class="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60">
          <Library :size="14" class="text-foreground" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold text-foreground">Library Matches</h2>
          <p v-if="!loading && !error" class="text-[11px] text-muted-foreground">
            {{ total.toLocaleString() }} matching library item{{ total === 1 ? '' : 's' }}
          </p>
        </div>
      </div>
      <button
        v-if="error"
        class="flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        type="button"
        @click="refresh"
      >
        <RefreshCw :size="12" />
        Retry
      </button>
    </div>

    <div v-if="loading" class="flex gap-3 overflow-hidden px-3 py-3">
      <div v-for="n in 6" :key="n" class="w-[132px] shrink-0">
        <div class="aspect-square w-full animate-pulse rounded-md bg-muted" />
        <div class="mt-2 h-3 w-4/5 animate-pulse rounded bg-muted" />
        <div class="mt-1 h-3 w-3/5 animate-pulse rounded bg-muted" />
      </div>
    </div>

    <div v-else-if="error" class="px-3 py-4 text-sm text-muted-foreground">Could not load library matches.</div>

    <div v-else class="flex gap-3 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        v-for="item in items"
        :key="`${item.mediaType}-${item.remoteId}`"
        class="group/item w-[132px] shrink-0 text-left outline-none"
        data-testid="smart-scope-catalog-item"
        role="button"
        tabindex="0"
        @click="openItem(item)"
        @keydown.enter.prevent="openItem(item)"
        @keydown.space.prevent="openItem(item)"
      >
        <div
          class="relative transition-transform group-hover/item:-translate-y-0.5 group-focus-visible/item:ring-2 group-focus-visible/item:ring-ring"
        >
          <CatalogBookCoverCard :item="item" :poster-only="true" :show-actions="false" />
          <button
            type="button"
            data-testid="smart-scope-catalog-quick-view"
            class="absolute left-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Details"
            title="Details"
            @click.stop="openQuickView(item)"
          >
            <ExternalLink :size="13" />
          </button>
        </div>
        <p class="mt-2 line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">{{ item.title }}</p>
        <p v-if="creatorsLabel(item)" class="mt-0.5 truncate text-[11px] text-muted-foreground">{{ creatorsLabel(item) }}</p>
        <p class="mt-0.5 truncate text-[11px] text-muted-foreground/80">{{ detailLabel(item) }}</p>
      </div>
    </div>
    <CatalogItemQuickView :item="quickViewItem" :open="quickViewOpen" @update:open="quickViewOpen = $event" />
  </section>
</template>
