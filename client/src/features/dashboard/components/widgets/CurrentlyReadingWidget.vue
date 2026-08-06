<script setup lang="ts">
import { BookOpen, Play } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { FORMAT_TO_GROUP, type CurrentlyReadingCatalogItem, type CurrentlyReadingItem } from '@bookorbit/types'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useCurrentlyReadingWidget } from '../../composables/useCurrentlyReadingWidget'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceComicPageImageUrl,
  catalogSourceEbookCoverUrl,
} from '@/features/warehouse/api/catalog-source.api'
import { catalogLibraryItemRoute, catalogLibraryReaderRoute } from '@/features/warehouse/lib/catalog-item-route'

const { data, loading, error } = useCurrentlyReadingWidget()
const { t } = useI18n()
const router = useRouter()
const { coverUrl } = useCoverVersions()

function isCatalogItem(item: CurrentlyReadingItem): item is CurrentlyReadingCatalogItem {
  return item.type === 'catalog-item'
}

function itemKey(item: CurrentlyReadingItem): string {
  return isCatalogItem(item) ? `${item.mediaType}:${item.remoteId}` : `book:${item.bookId}`
}

function goToBook(item: CurrentlyReadingItem) {
  if (isCatalogItem(item)) {
    void router.push(catalogLibraryItemRoute(item.mediaType, item.remoteId))
    return
  }
  void router.push({ name: 'book-detail', params: { bookId: item.bookId } })
}

function isComic(fileFormat: string | null): boolean {
  return fileFormat != null && FORMAT_TO_GROUP[fileFormat] === 'cbx'
}

function itemIsComic(item: CurrentlyReadingItem): boolean {
  return isCatalogItem(item) ? item.mediaType === 'comic' : isComic(item.fileFormat)
}

function itemCoverUrl(item: CurrentlyReadingItem): string | null {
  if (!item.hasCover) return null
  if (!isCatalogItem(item)) return coverUrl(item.bookId)
  if (item.mediaType === 'audiobook') return catalogSourceAudiobookCoverUrl(item.remoteId)
  if (item.mediaType === 'comic') return catalogSourceComicPageImageUrl(item.remoteId)
  return catalogSourceEbookCoverUrl(item.remoteId, 'medium')
}

function continueReading(item: CurrentlyReadingItem) {
  if (isCatalogItem(item)) {
    void router.push({ ...catalogLibraryReaderRoute(item.mediaType, item.remoteId), query: { format: item.fileFormat ?? 'epub' } })
    return
  }
  if (item.fileId) {
    void router.push({ name: 'reader', params: { bookId: item.bookId, fileId: item.fileId }, query: { format: item.fileFormat ?? 'epub' } })
  } else {
    void router.push({ name: 'book-detail', params: { bookId: item.bookId } })
  }
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <BookOpen :size="16" class="text-primary" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.currentlyReading.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 gap-3">
      <div v-for="n in 2" :key="n" class="flex w-full gap-2.5">
        <div class="h-16 w-11 shrink-0 animate-pulse rounded bg-muted" />
        <div class="flex-1 space-y-2">
          <div class="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div class="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          <div class="mt-1 h-1.5 w-full animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Empty -->
    <div v-else-if="!data || data.books.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <BookOpen :size="16" class="text-muted-foreground" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.currentlyReading.empty') }}</p>
    </div>

    <!-- Books list -->
    <div v-else class="flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
      <div class="flex flex-col gap-2">
        <div
          v-for="book in data.books"
          :key="itemKey(book)"
          class="group/book relative flex min-w-0 cursor-pointer gap-2.5 rounded-lg bg-muted/20 p-1.5 transition-colors hover:bg-muted/40"
          @click="goToBook(book)"
        >
          <!-- Cover thumbnail -->
          <BookCoverSurface
            size="mini"
            class="book-cover-surface--spine-fitted h-14 w-9 shrink-0 overflow-hidden rounded"
            :is-comic="itemIsComic(book)"
          >
            <BookCoverArtwork
              :src="itemCoverUrl(book)"
              :has-cover="book.hasCover"
              :title="book.title"
              :author-line="book.authors.length > 0 ? book.authors.join(', ') : null"
              :is-audio="isCatalogItem(book) && book.mediaType === 'audiobook'"
              :seed="book.title ?? itemKey(book)"
              :alt="book.title ?? t('dashboard.common.bookCover')"
              frame-aspect-ratio="9/14"
              :is-comic="itemIsComic(book)"
            />
          </BookCoverSurface>

          <!-- Info -->
          <div class="flex min-w-0 flex-1 flex-col justify-center">
            <p class="truncate text-xs font-semibold leading-tight">{{ book.title ?? t('dashboard.common.untitled') }}</p>
            <p v-if="book.authors.length > 0" class="truncate text-xs text-muted-foreground">
              {{ book.authors.join(', ') }}
            </p>
            <!-- Progress bar -->
            <div class="mt-1.5 flex items-center gap-1.5">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${Math.round(book.progress)}%` }" />
              </div>
              <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">{{ Math.round(book.progress) }}%</span>
            </div>
          </div>

          <!-- Continue button (hover) -->
          <button
            class="absolute right-2 top-1/3 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow transition-opacity group-hover/book:opacity-100"
            :title="t('dashboard.widgets.currentlyReading.continueReading')"
            @click.stop="continueReading(book)"
          >
            <Play :size="11" class="translate-x-px" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
