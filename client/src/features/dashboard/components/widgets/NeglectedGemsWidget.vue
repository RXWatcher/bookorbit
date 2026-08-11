<script setup lang="ts">
import { Gem, Star, BookMarked, Check } from '@lucide/vue'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { DashboardCatalogItem, NeglectedGem, WarehouseMediaType } from '@bookorbit/types'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useBookStatus } from '@/features/book/composables/useBookStatus'
import { useNeglectedGemsWidget } from '../../composables/useNeglectedGemsWidget'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceComicCoverUrl,
  catalogSourceEbookCoverUrl,
  patchCatalogSourceUserState,
} from '@/features/warehouse/api/catalog-source.api'
import CatalogItemQuickView from '@/features/warehouse/components/CatalogItemQuickView.vue'
import { catalogLibraryItemRoute } from '@/features/warehouse/lib/catalog-item-route'

const { data, loading, error } = useNeglectedGemsWidget()
const { t } = useI18n()
const router = useRouter()
const { setStatus } = useBookStatus()
const { coverUrl } = useCoverVersions()

const displayIndex = ref(0)
const currentGem = computed(() => data.value?.gems[displayIndex.value] ?? null)
const queuedKeys = ref<Set<string>>(new Set())
const quickViewOpen = ref(false)
const quickViewItem = ref<DashboardCatalogItem | null>(null)

function isCatalogGem(gem: NeglectedGem | null): gem is NeglectedGem & { mediaType: WarehouseMediaType; remoteId: string } {
  return gem?.type === 'catalog-item' && !!gem.mediaType && !!gem.remoteId
}

function libraryNameForMediaType(mediaType: WarehouseMediaType): string {
  if (mediaType === 'audiobook') return 'Audiobooks'
  if (mediaType === 'comic') return 'Comics'
  return 'Books'
}

function queueKey(gem: NeglectedGem): string {
  return isCatalogGem(gem) ? `${gem.mediaType}:${gem.remoteId}` : `book:${gem.bookId}`
}

function gemCoverUrl(gem: NeglectedGem): string | null {
  if (!gem.hasCover) return null
  if (!isCatalogGem(gem)) return coverUrl(gem.bookId)
  if (gem.mediaType === 'audiobook') return catalogSourceAudiobookCoverUrl(gem.remoteId)
  if (gem.mediaType === 'comic') return catalogSourceComicCoverUrl(gem.remoteId)
  return catalogSourceEbookCoverUrl(gem.remoteId, 'medium')
}

function toQuickViewItem(gem: NeglectedGem & { mediaType: WarehouseMediaType; remoteId: string }): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: gem.mediaType,
    remoteId: gem.remoteId,
    title: gem.title ?? 'Untitled',
    subtitle: null,
    seriesName: null,
    authors: [],
    narrators: [],
    libraryName: gem.libraryName ?? libraryNameForMediaType(gem.mediaType),
    formats: [],
    hasCover: gem.hasCover,
  }
}

function handleShuffle() {
  if (!data.value || data.value.gems.length <= 1) return
  displayIndex.value = (displayIndex.value + 1) % data.value.gems.length
}

function goToBook() {
  if (!currentGem.value) return
  if (isCatalogGem(currentGem.value)) {
    void router.push(catalogLibraryItemRoute(currentGem.value.mediaType, currentGem.value.remoteId))
    return
  }
  void router.push({ name: 'book-detail', params: { bookId: currentGem.value.bookId } })
}

function openQuickView() {
  if (!isCatalogGem(currentGem.value)) return
  quickViewItem.value = toQuickViewItem(currentGem.value)
  quickViewOpen.value = true
}

async function addToQueue() {
  if (!currentGem.value) return
  const key = queueKey(currentGem.value)
  if (isCatalogGem(currentGem.value)) {
    await patchCatalogSourceUserState(currentGem.value.mediaType, currentGem.value.remoteId, { readStatus: 'want_to_read' })
  } else {
    await setStatus(currentGem.value.bookId, 'want_to_read')
  }
  queuedKeys.value = new Set([...queuedKeys.value, key])
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <Gem :size="16" class="text-primary" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.neglectedGems.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-16 w-12 animate-pulse rounded bg-muted" />
      <div class="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Empty -->
    <div v-else-if="!data || data.gems.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Gem :size="16" class="text-muted-foreground" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.neglectedGems.empty') }}</p>
    </div>

    <!-- Gem -->
    <div v-else-if="currentGem" class="flex flex-1 flex-col items-center justify-center gap-2">
      <BookCoverSurface
        tag="button"
        type="button"
        data-testid="neglected-gem-cover"
        size="mini"
        class="book-cover-surface--spine-fitted h-19 w-13 cursor-pointer overflow-hidden rounded transition-opacity hover:opacity-80"
        @click="goToBook"
      >
        <BookCoverArtwork
          :src="gemCoverUrl(currentGem)"
          :has-cover="currentGem.hasCover"
          :title="currentGem.title"
          :author-line="null"
          :is-audio="currentGem.mediaType === 'audiobook'"
          :seed="currentGem.title ?? String(currentGem.bookId)"
          :alt="currentGem.title ?? t('dashboard.common.cover')"
          frame-aspect-ratio="13/19"
        />
      </BookCoverSurface>
      <button class="max-w-full cursor-pointer truncate text-center text-xs font-semibold hover:underline" @click="goToBook">
        {{ currentGem.title ?? t('dashboard.common.untitled') }}
      </button>
      <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Star :size="12" class="fill-amber-400 text-amber-400" />
        <span>{{ t('dashboard.widgets.neglectedGems.rating', { rating: currentGem.rating }) }}</span>
        <span>&middot;</span>
        <span>{{ t('dashboard.widgets.neglectedGems.daysWaiting', { count: currentGem.waitingDays }) }}</span>
      </div>

      <!-- Actions -->
      <div class="mt-1 flex items-center gap-1.5">
        <button
          data-testid="neglected-gem-queue"
          class="flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-[11px] transition-colors"
          :class="
            queuedKeys.has(queueKey(currentGem)) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'text-muted-foreground hover:bg-muted'
          "
          :disabled="queuedKeys.has(queueKey(currentGem))"
          @click="addToQueue"
        >
          <component :is="queuedKeys.has(queueKey(currentGem)) ? Check : BookMarked" :size="11" />
          {{ queuedKeys.has(queueKey(currentGem)) ? t('dashboard.widgets.neglectedGems.queued') : t('dashboard.widgets.neglectedGems.addToQueue') }}
        </button>
        <button
          v-if="isCatalogGem(currentGem)"
          data-testid="neglected-gem-quick-view"
          class="rounded-md border border-input px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
          @click="openQuickView"
        >
          Details
        </button>
        <button
          v-if="data.gems.length > 1"
          class="rounded-md border border-input px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
          @click="handleShuffle"
        >
          {{ t('dashboard.widgets.neglectedGems.shuffle') }}
        </button>
      </div>
    </div>
    <CatalogItemQuickView :item="quickViewItem" :open="quickViewOpen" @update:open="quickViewOpen = $event" />
  </div>
</template>
