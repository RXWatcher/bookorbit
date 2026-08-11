<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpen, Check, CheckSquare, Download, Eye, ExternalLink, FolderPlus, MoreVertical, PanelRight, Play, Square, Star } from '@lucide/vue'

import type { DashboardCatalogItem, ReadStatus } from '@bookorbit/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { STATUS_COLORS, STATUS_ICONS, STATUS_OPTIONS } from '../composables/useBookStatus'
import { getFormatColor } from '../lib/format-colors'
import BookCoverArtwork from './BookCoverArtwork.vue'
import BookCoverSurface from './BookCoverSurface.vue'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceComicPageImageUrl,
  catalogSourceEbookCoverUrl,
} from '@/features/warehouse/api/catalog-source.api'

const props = withDefaults(
  defineProps<{
    item: DashboardCatalogItem
    selectionMode?: boolean
    selected?: boolean
    showActions?: boolean
    canDownload?: boolean
    posterOnly?: boolean
  }>(),
  {
    selectionMode: false,
    selected: false,
    showActions: true,
    canDownload: false,
    posterOnly: false,
  },
)

const emit = defineEmits<{
  'card-click': [item: DashboardCatalogItem]
  select: [item: DashboardCatalogItem, event: MouseEvent]
  'quick-view': [item: DashboardCatalogItem]
  read: [item: DashboardCatalogItem, mode?: 'peek']
  download: [item: DashboardCatalogItem]
  details: [item: DashboardCatalogItem]
  'add-to-collection': [item: DashboardCatalogItem]
  'set-status': [item: DashboardCatalogItem, status: ReadStatus]
}>()

const displaySettings = useDisplaySettings()
const cardOverlays = displaySettings.cardOverlays ?? ref(['format', 'rating', 'read-status'])

const coverAspectRatio = computed(() => (props.item.mediaType === 'audiobook' ? '1/1' : '2/3'))
const creatorsLabel = computed(() => {
  const people = props.item.authors.length > 0 ? props.item.authors : props.item.narrators
  return people.filter(Boolean).join(', ')
})
const primaryFormat = computed(() => props.item.formats[0] ?? null)
const badgeFormat = computed(
  () => primaryFormat.value ?? (props.item.mediaType === 'audiobook' ? 'audio' : props.item.mediaType === 'comic' ? 'cbz' : 'epub'),
)
const readStatus = computed(() => props.item.readStatus ?? null)
const showReadBadge = computed(() => cardOverlays.value.includes('read-status') && readStatus.value !== null)
const showRatingBadge = computed(() => cardOverlays.value.includes('rating') && props.item.rating !== null && props.item.rating !== undefined)
const showFormatBadge = computed(() => cardOverlays.value.includes('format'))

function coverUrl(item: DashboardCatalogItem): string | null {
  if (item.mediaType === 'comic') return catalogSourceComicPageImageUrl(item.remoteId)
  if (!item.hasCover) return null
  if (item.mediaType === 'audiobook') return catalogSourceAudiobookCoverUrl(item.remoteId)
  return catalogSourceEbookCoverUrl(item.remoteId, 'medium')
}

function shouldLoadCover(item: DashboardCatalogItem): boolean {
  return item.mediaType === 'comic' || item.hasCover
}

function formatLabel(item: DashboardCatalogItem): string {
  if (item.formats.length > 0) return item.formats[0]!.toUpperCase()
  if (item.mediaType === 'audiobook') return 'AUDIO'
  if (item.mediaType === 'comic') return 'CBZ'
  return 'EPUB'
}

function formatBadgeColor(): string {
  return `${getFormatColor(badgeFormat.value)}cc`
}

function handleCardClick() {
  emit('card-click', props.item)
}
</script>

<template>
  <div
    class="group/catalog-card relative w-full cursor-pointer text-left [container-type:inline-size] outline-none"
    data-testid="catalog-book-cover-card"
    role="button"
    tabindex="0"
    @click="handleCardClick"
    @keydown.enter.prevent="handleCardClick"
    @keydown.space.prevent="handleCardClick"
  >
    <BookCoverSurface
      class="relative w-full overflow-hidden rounded-sm transition-transform duration-200 will-change-transform group-hover/catalog-card:scale-[1.02]"
      :interactive="true"
      :disable-spine="item.mediaType === 'audiobook'"
      :display-mode="item.mediaType === 'audiobook' ? 'fill-crop' : undefined"
      :style="{ aspectRatio: coverAspectRatio }"
    >
      <BookCoverArtwork
        :src="coverUrl(item)"
        :has-cover="shouldLoadCover(item)"
        :title="item.title"
        :author-line="creatorsLabel"
        :is-audio="item.mediaType === 'audiobook'"
        :seed="item.title || item.remoteId"
        :alt="item.title"
        :frame-aspect-ratio="coverAspectRatio"
        :spine="item.mediaType !== 'audiobook'"
        :mode="item.mediaType === 'audiobook' ? 'fill-crop' : undefined"
      />

      <div data-testid="cover-overlay-frame" class="absolute inset-0 z-10 overflow-hidden rounded-[inherit]">
        <div
          v-if="showReadBadge"
          class="pointer-events-none absolute left-1.5 top-1.5 z-10 flex items-center justify-center rounded-full bg-black/60 p-1 transition-opacity duration-150 group-hover/catalog-card:opacity-0"
        >
          <component :is="STATUS_ICONS[readStatus!]" :size="12" :class="STATUS_COLORS[readStatus!]" />
        </div>

        <div
          v-if="showRatingBadge"
          class="pointer-events-none absolute bottom-1.5 left-1.5 z-10 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 transition-opacity duration-150 group-hover/catalog-card:opacity-0"
        >
          <Star class="size-3 text-emerald-400" />
          <span class="text-[9px] font-bold leading-none text-white">{{ Math.round(item.rating!) }}</span>
        </div>

        <div
          v-if="showFormatBadge"
          class="pointer-events-none absolute bottom-1.5 right-1.5 z-10 transition-opacity duration-150 group-hover/catalog-card:opacity-0"
        >
          <span
            class="rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-widest text-white"
            :style="{ backgroundColor: formatBadgeColor() }"
          >
            {{ formatLabel(item) }}
          </span>
        </div>

        <div
          v-if="selectionMode"
          class="pointer-events-none absolute inset-0 z-30 rounded-sm"
          :class="selected ? 'bg-primary/20 ring-2 ring-inset ring-primary' : ''"
        >
          <button
            type="button"
            class="pointer-events-auto absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded transition-colors"
            :class="selected ? 'bg-primary' : 'border border-white/50 bg-black/40'"
            :aria-pressed="selected"
            :data-testid="`source-backed-library-select-${item.remoteId}`"
            @click.stop="emit('select', item, $event)"
          >
            <CheckSquare v-if="selected" class="text-primary-foreground" :size="12" />
            <Square v-else class="text-white" :size="12" />
          </button>
        </div>

        <div
          v-if="!selectionMode && !posterOnly"
          class="pointer-events-none absolute inset-0 z-20 flex flex-col bg-gradient-to-b from-black/15 via-black/20 to-black/85 p-2 opacity-0 transition-opacity duration-150 group-hover/catalog-card:pointer-events-auto group-hover/catalog-card:opacity-100 group-focus-visible/catalog-card:pointer-events-auto group-focus-visible/catalog-card:opacity-100"
        >
          <div class="flex shrink-0 justify-end">
            <button
              class="rounded-[2.5cqi] bg-black/50 p-[3cqi] text-white transition-colors hover:bg-black/30"
              :data-testid="`source-backed-library-panel-view-${item.remoteId}`"
              @click.stop="emit('quick-view', item)"
            >
              <PanelRight class="size-[12cqi]" />
            </button>
          </div>

          <div class="flex flex-1 items-center justify-center">
            <button
              class="flex size-[clamp(2.75rem,22cqi,4rem)] scale-75 items-center justify-center rounded-full bg-primary text-white shadow-2xl transition-all duration-300 hover:scale-110 active:scale-90 group-hover/catalog-card:scale-100"
              @click.stop="emit('read', item)"
            >
              <component
                :is="item.mediaType === 'audiobook' ? Play : BookOpen"
                class="size-[clamp(1.35rem,11cqi,2rem)]"
                :class="{ 'ml-[clamp(0.15rem,1.5cqi,0.3rem)] fill-current': item.mediaType === 'audiobook' }"
              />
            </button>
          </div>

          <div class="shrink-0 pr-10">
            <p class="line-clamp-2 min-w-0 flex-1 text-xs font-semibold leading-tight text-white">{{ item.title }}</p>
            <button
              v-if="creatorsLabel"
              class="block w-full truncate text-left text-[10px] text-white/70 hover:underline"
              @click.stop="emit('details', item)"
            >
              {{ creatorsLabel }}
            </button>
          </div>

          <div v-if="showActions" class="absolute bottom-2 right-2 z-20">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="rounded-md bg-black/40 px-0.75 py-1.5 text-white transition-colors hover:bg-white/30"
                  title="Actions"
                  :data-testid="`source-backed-library-actions-${item.remoteId}`"
                  @click.stop
                >
                  <MoreVertical class="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" @click.stop>
                <DropdownMenuItem @click="emit('read', item)">
                  <BookOpen class="size-4 mr-2" />
                  Read
                </DropdownMenuItem>
                <DropdownMenuItem @click="emit('read', item, 'peek')">
                  <Eye class="size-4 mr-2" />
                  Peek
                </DropdownMenuItem>
                <DropdownMenuItem v-if="canDownload" @click="emit('download', item)">
                  <Download class="size-4 mr-2" />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem @click="emit('details', item)">
                  <ExternalLink class="size-4 mr-2" />
                  Book Details
                </DropdownMenuItem>
                <DropdownMenuItem @click="emit('add-to-collection', item)">
                  <FolderPlus class="size-4 mr-2" />
                  Add to Collection
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <component
                      :is="STATUS_ICONS[item.readStatus ?? 'unread']"
                      class="size-4 mr-2"
                      :class="STATUS_COLORS[item.readStatus ?? 'unread']"
                    />
                    Set Status
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="emit('set-status', item, opt.value)">
                      <component :is="STATUS_ICONS[opt.value]" class="size-4 mr-2" :class="STATUS_COLORS[opt.value]" />
                      {{ opt.label }}
                      <Check v-if="item.readStatus === opt.value" class="size-3 ml-auto text-primary" />
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </BookCoverSurface>
  </div>
</template>
