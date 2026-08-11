<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useElementSize, useWindowSize, watchDebounced } from '@vueuse/core'
import type { BookCard, CoverAspectRatio, JumpBucketKind } from '@bookorbit/types'
import BookCoverCard from './BookCoverCard.vue'
import BookCoverSkeleton from './BookCoverSkeleton.vue'
import CollapsedSeriesCard from './CollapsedSeriesCard.vue'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { isBookPlaceholder, type BookSlot } from '../composables/useBookWindow'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

type BookActionType = 'quick-view' | 'add-to-collection' | 'move-to-library' | 'delete'

const props = withDefaults(
  defineProps<{
    books: BookSlot[]
    coverSize: number
    gridGap: number
    selectionMode?: boolean
    isSelected?: (bookId: number) => boolean
    newBookIds?: Set<number>
    virtualized?: boolean
    squareCoverScale?: number
    railGutter?: boolean
    railGutterKind?: JumpBucketKind | null
    allowMoveToLibrary?: boolean
  }>(),
  {
    selectionMode: false,
    isSelected: undefined,
    newBookIds: () => new Set<number>(),
    virtualized: true,
    squareCoverScale: 1,
    railGutter: false,
    railGutterKind: null,
  },
)

const emit = defineEmits<{
  action: [book: BookCard, action: BookActionType]
  select: [bookId: number, event: MouseEvent]
  'update:book': [updated: BookCard]
  range: [startIndex: number, endIndex: number]
  'first-visible-index': [index: number]
}>()

const containerRef = ref<HTMLElement | null>(null)
const { width: containerWidth } = useElementSize(containerRef)
const { width: windowWidth } = useWindowSize()

function asPositiveInt(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.round(n)
}

function normalizeScale(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 1) return 1
  return n
}

// During a window drag the measured width changes every frame; relayout only
// after it settles so the virtual pool is not reshuffled continuously. The
// first measurement applies immediately to avoid a blank mount.
const settledWidth = ref(0)
watch(
  containerWidth,
  (width) => {
    const rounded = Math.round(Number(width))
    if (!Number.isFinite(rounded) || rounded <= 0) return
    if (settledWidth.value === 0) settledWidth.value = rounded
  },
  { immediate: true },
)
watchDebounced(
  containerWidth,
  (width) => {
    const rounded = Math.round(Number(width))
    if (!Number.isFinite(rounded) || rounded <= 0) return
    settledWidth.value = rounded
  },
  { debounce: 120 },
)

const coverPx = computed(() => asPositiveInt(props.coverSize, 140))
const gapPx = computed(() => asPositiveInt(props.gridGap, 20))
const squareCoverScale = computed(() => normalizeScale(props.squareCoverScale))

const availableWidth = computed(() => {
  if (settledWidth.value > 0) return settledWidth.value

  const direct = Number(containerRef.value?.getBoundingClientRect().width ?? 0)
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct)

  const parent = Number(containerRef.value?.parentElement?.getBoundingClientRect().width ?? 0)
  if (Number.isFinite(parent) && parent > 0) return Math.round(parent)

  const viewport = Number(windowWidth.value)
  if (Number.isFinite(viewport) && viewport > 0) return Math.round(Math.max(viewport - 48, 0))

  return coverPx.value + gapPx.value
})

const targetCellSize = computed(() => coverPx.value + gapPx.value)
const gridItems = computed(() => {
  const cols = Math.floor((availableWidth.value + gapPx.value) / targetCellSize.value)
  return Number.isFinite(cols) && cols > 0 ? cols : 1
})
const itemSecondarySize = computed(() => {
  return Math.max(1, Math.floor((availableWidth.value + gapPx.value) / gridItems.value))
})
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const aspectMultiplier = computed(() => (coverAspectRatio.value === '1/1' ? 1 : 3 / 2))

const cardWidth = computed(() => Math.max(1, itemSecondarySize.value - gapPx.value))
const cardHeight = computed(() => Math.max(1, Math.round(cardWidth.value * aspectMultiplier.value)))

const { gridCardSecondaryLabel, cardInfoMode } = useDisplaySettings()
const labelAreaHeight = computed(() => {
  if (cardInfoMode.value !== 'below-cover') return 0
  const hasSecondary = gridCardSecondaryLabel.value !== 'hidden'
  return hasSecondary ? 40 : 24
})
const showLabel = computed(() => cardInfoMode.value === 'below-cover')

const itemSize = computed(() => cardHeight.value + labelAreaHeight.value + gapPx.value)
const buffer = computed(() => Math.max(itemSize.value * 2, 240))

const scrollerStyle = computed(() => ({
  '--book-grid-gap': `${gapPx.value}px`,
  '--book-grid-height': `${cardHeight.value}px`,
  '--book-grid-label-height': `${labelAreaHeight.value}px`,
}))

// Scroll offset of the viewport into this grid, and the viewport's height.
// Everything the virtual window renders derives from these two numbers plus
// the uniform row geometry above, so no per-item measurement is ever needed.
const scrolledIntoGrid = ref(0)
const viewportHeight = ref(0)

// Browsers cap how tall a single element may be: Blink at 2^25 px, Gecko at
// about 17.9M. A 410k book library at two columns wants roughly 60M px, so
// past the cap the tail of the library simply cannot be scrolled to. Beyond
// this height the scroll surface is compressed and the mapping below trades
// scroll precision for reach. Under it the scale is exactly 1 and every
// formula here reduces to plain row arithmetic.
const MAX_SCROLL_SURFACE_PX = 16_000_000

const rowCount = computed(() => Math.ceil(props.books.length / gridItems.value))
const contentHeight = computed(() => rowCount.value * itemSize.value)
const totalHeight = computed(() => Math.min(contentHeight.value, MAX_SCROLL_SURFACE_PX))
const scrollScale = computed(() => (contentHeight.value > totalHeight.value ? contentHeight.value / totalHeight.value : 1))
const bufferRows = computed(() => Math.max(1, Math.ceil(buffer.value / itemSize.value)))

// Where the viewport sits in content coordinates, which is what rows are laid
// out in. Identical to the scroll offset unless the surface is compressed.
const contentOffset = computed(() => scrolledIntoGrid.value * scrollScale.value)

const firstVisibleRow = computed(() => {
  if (itemSize.value <= 0) return 0
  return Math.max(0, Math.floor(contentOffset.value / itemSize.value))
})
const lastVisibleRow = computed(() => {
  if (itemSize.value <= 0) return 0
  const bottom = contentOffset.value + Math.max(viewportHeight.value, 1) - 1
  return Math.max(firstVisibleRow.value, Math.floor(bottom / itemSize.value))
})

const startRow = computed(() => Math.max(0, firstVisibleRow.value - bufferRows.value))
const endRow = computed(() => Math.min(Math.max(rowCount.value - 1, 0), lastVisibleRow.value + bufferRows.value))

const windowStartIndex = computed(() => startRow.value * gridItems.value)
const windowEndIndex = computed(() => Math.min(props.books.length - 1, (endRow.value + 1) * gridItems.value - 1))

// The only slice of the catalogue that ever reaches the DOM or a v-for. On a
// 410k row library this is a few dozen entries rather than 410k.
const windowSlots = computed(() => {
  if (props.books.length === 0) return []
  return props.books.slice(windowStartIndex.value, windowEndIndex.value + 1)
})
// Places the row holding contentOffset exactly at the viewport top. At scale 1
// this is just startRow * itemSize.
const windowOffset = computed(() => scrolledIntoGrid.value - contentOffset.value + startRow.value * itemSize.value)

const windowStyle = computed(() => ({
  transform: `translateY(${windowOffset.value}px)`,
  gridTemplateColumns: `repeat(${gridItems.value}, ${itemSecondarySize.value}px)`,
}))

const staticGridStyle = computed(() => ({
  gap: `${gapPx.value}px`,
  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${coverPx.value}px), 1fr))`,
}))

const staticVariableWrapStyle = computed(() => ({
  gap: `${gapPx.value}px`,
}))

const useVariableStaticWidths = computed(() => !props.virtualized && squareCoverScale.value > 1)

const staticBooks = computed(() => props.books.filter((slot): slot is BookCard => !isBookPlaceholder(slot)))

function asBook(slot: BookSlot): BookCard {
  return slot as BookCard
}

// Unloaded slots all share one placeholder object, so they cannot be keyed by
// id. Their position is what identifies them. Real ids stay numeric (source
// backed libraries use negative ones), so the string form cannot collide.
function slotKey(slot: BookSlot, index: number): string | number {
  return isBookPlaceholder(slot) ? `placeholder:${index}` : slot.id
}

function staticItemStyle(book: BookCard): { width: string; maxWidth: string } {
  const scale = book.coverAspectRatio === '1/1' ? squareCoverScale.value : 1
  const width = Math.max(1, Math.round(coverPx.value * scale))
  return { width: `${width}px`, maxWidth: '100%' }
}

function staticCoverAspectRatio(book: BookCard): CoverAspectRatio {
  return book.coverAspectRatio ?? coverAspectRatio.value
}

// First visible index from scroll geometry: O(1) and no per-cell DOM reads.
const firstVisibleIndex = ref(0)
let scrollParent: HTMLElement | null = null
let scrollTarget: HTMLElement | Window | null = null
let scrollRafId = 0
let jumpAnchorIndex: number | null = null
let jumpAnchorRowStart: number | null = null
let lastEmittedIndex: number | null = null

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

// Falls back to the window when no ancestor scrolls. Without a viewport the
// virtual window would have no height to fill and would render nothing.
function viewportBounds(): { top: number; height: number } {
  if (scrollParent) {
    const rect = scrollParent.getBoundingClientRect()
    return { top: rect.top, height: rect.height }
  }
  return { top: 0, height: window.innerHeight }
}

function measureViewport() {
  const gridEl = containerRef.value
  if (!gridEl) return
  const { top, height } = viewportBounds()
  scrolledIntoGrid.value = Math.max(0, top - gridEl.getBoundingClientRect().top)
  viewportHeight.value = Math.max(0, height)
}

function emitActiveIndex() {
  if (props.books.length === 0 || itemSize.value <= 0) return
  const cols = gridItems.value
  const row = firstVisibleRow.value
  const rowStart = Math.min(props.books.length - 1, row * cols)
  firstVisibleIndex.value = rowStart

  let active: number
  if (jumpAnchorIndex !== null) {
    const anchorRow = Math.floor(jumpAnchorIndex / cols)
    if (jumpAnchorRowStart === null) {
      if (anchorRow < row || anchorRow > lastVisibleRow.value) return
      jumpAnchorRowStart = rowStart
      active = jumpAnchorIndex
    } else if (rowStart === jumpAnchorRowStart) {
      active = jumpAnchorIndex
    } else {
      jumpAnchorIndex = null
      jumpAnchorRowStart = null
      active = activeIndexForRow(row, rowStart, cols)
    }
  } else {
    active = activeIndexForRow(row, rowStart, cols)
  }

  if (active === lastEmittedIndex) return
  lastEmittedIndex = active
  emit('first-visible-index', active)
}

// At the top boundary the first rail target must stay active. Below it, the
// midpoint represents the section occupying most of the first visible row.
function activeIndexForRow(row: number, rowStart: number, cols: number): number {
  if (row === 0) return 0
  return Math.min(props.books.length - 1, rowStart + Math.floor((cols - 1) / 2))
}

function updateFromScroll() {
  measureViewport()
  emitActiveIndex()
}

function handleScrollParentScroll() {
  if (scrollRafId) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = 0
    updateFromScroll()
  })
}

onMounted(() => {
  if (!props.virtualized) return
  void nextTick(() => {
    scrollParent = findScrollParent(containerRef.value)
    scrollTarget = scrollParent ?? window
    scrollTarget.addEventListener('scroll', handleScrollParentScroll, { passive: true })
    window.addEventListener('resize', handleScrollParentScroll, { passive: true })
    updateFromScroll()
  })
})

onBeforeUnmount(() => {
  scrollTarget?.removeEventListener('scroll', handleScrollParentScroll)
  window.removeEventListener('resize', handleScrollParentScroll)
  scrollTarget = null
  scrollParent = null
  if (scrollRafId) cancelAnimationFrame(scrollRafId)
})

// A relayout changes row height and column count, so the measured offset maps
// to a different row than it did a moment ago.
watch([itemSize, gridItems, () => props.books.length], () => {
  if (!props.virtualized) return
  void nextTick(updateFromScroll)
})

const emitRange = () => {
  if (!props.virtualized || props.books.length === 0) return
  emit('range', windowStartIndex.value, windowEndIndex.value)
}
watch([windowStartIndex, windowEndIndex], emitRange, { immediate: true })

function scrollRowToTop(index: number) {
  const gridEl = containerRef.value
  if (!gridEl || itemSize.value <= 0) return
  const gridTop = gridEl.getBoundingClientRect().top
  const offsetIntoGrid = (Math.floor(index / gridItems.value) * itemSize.value) / scrollScale.value
  if (scrollParent) {
    scrollParent.scrollTop += gridTop - scrollParent.getBoundingClientRect().top + offsetIntoGrid
  } else {
    window.scrollTo({ top: window.scrollY + gridTop + offsetIntoGrid })
  }
  updateFromScroll()
}

// Re-anchor on column-count changes so a relayout keeps the same books in
// view. firstVisibleIndex still holds the pre-relayout value here because it
// only updates from scroll events.
watch(gridItems, (next, prev) => {
  if (!props.virtualized || !prev || next === prev) return
  const anchor = firstVisibleIndex.value
  if (anchor <= 0) return
  void nextTick(() => {
    scrollRowToTop(anchor)
  })
})

function scrollToIndex(index: number) {
  jumpAnchorIndex = index
  jumpAnchorRowStart = null
  scrollRowToTop(index)
}

defineExpose({ scrollToIndex })
</script>

<template>
  <div
    ref="containerRef"
    class="w-full"
    :class="railGutter ? (railGutterKind === 'category' ? 'pr-22' : railGutterKind === 'temporal' ? 'pr-14' : 'pr-10') : ''"
  >
    <div
      v-if="!virtualized && useVariableStaticWidths"
      class="flex w-full flex-wrap content-start items-end"
      :style="staticVariableWrapStyle"
      data-testid="book-grid-static"
    >
      <div
        v-for="book in staticBooks"
        :key="book.id"
        class="min-w-0 shrink-0"
        :class="{ 'book-grid-cell--new': props.newBookIds.has(book.id) }"
        :style="staticItemStyle(book)"
      >
        <CollapsedSeriesCard v-if="book.collapsedSeries" :book="book" :show-label="showLabel" :selection-mode="selectionMode" />
        <BookCoverCard
          v-else
          :book="book"
          :show-label="showLabel"
          :cover-aspect-ratio="staticCoverAspectRatio(book)"
          :selection-mode="selectionMode"
          :selected="isSelected?.(book.id) ?? false"
          :allow-move-to-library="allowMoveToLibrary"
          @action="emit('action', book, $event)"
          @select="emit('select', book.id, $event)"
          @update:book="emit('update:book', $event)"
        />
      </div>
    </div>

    <div v-else-if="!virtualized" class="grid w-full max-w-full items-end" :style="staticGridStyle" data-testid="book-grid-static">
      <div v-for="book in staticBooks" :key="book.id" class="min-w-0" :class="{ 'book-grid-cell--new': props.newBookIds.has(book.id) }">
        <CollapsedSeriesCard v-if="book.collapsedSeries" :book="book" :show-label="showLabel" :selection-mode="selectionMode" />
        <BookCoverCard
          v-else
          :book="book"
          :show-label="showLabel"
          :selection-mode="selectionMode"
          :selected="isSelected?.(book.id) ?? false"
          :allow-move-to-library="allowMoveToLibrary"
          @action="emit('action', book, $event)"
          @select="emit('select', book.id, $event)"
          @update:book="emit('update:book', $event)"
        />
      </div>
    </div>

    <div
      v-else
      class="book-grid-scroller"
      :class="{ 'book-grid-scroller--compressed': scrollScale > 1 }"
      :style="[scrollerStyle, { height: `${totalHeight}px` }]"
      data-testid="book-grid-virtual"
    >
      <div class="book-grid-window" :style="windowStyle">
        <div
          v-for="(item, offset) in windowSlots"
          :key="slotKey(item, windowStartIndex + offset)"
          class="book-grid-cell"
          :class="{ 'book-grid-cell--new': props.newBookIds.has(item.id) }"
        >
          <BookCoverSkeleton v-if="isBookPlaceholder(item)" />
          <CollapsedSeriesCard
            v-else-if="asBook(item).collapsedSeries"
            :book="asBook(item)"
            :show-label="showLabel"
            :selection-mode="selectionMode"
          />
          <BookCoverCard
            v-else
            :book="asBook(item)"
            :show-label="showLabel"
            :selection-mode="selectionMode"
            :selected="isSelected?.(item.id) ?? false"
            :allow-move-to-library="allowMoveToLibrary"
            @action="emit('action', asBook(item), $event)"
            @select="emit('select', item.id, $event)"
            @update:book="emit('update:book', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-grid-scroller {
  position: relative;
  width: 100%;
  max-width: 100%;
  /* clip, not hidden: hidden still creates a scrollable box, so focusing a
     rail button could scroll the row sideways and crop the first column. */
  overflow-x: clip;
  overscroll-behavior-x: none;
}

@media (pointer: coarse) {
  .book-grid-scroller {
    touch-action: pan-y;
  }
}

/* A compressed surface renders buffer rows above its own top edge, which would
   otherwise paint over the toolbar. Only compressed grids pay the clip, so
   card hover effects still overflow freely everywhere else. */
.book-grid-scroller--compressed {
  overflow: clip;
}

.book-grid-window {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  will-change: transform;
}

.book-grid-cell {
  display: grid;
  align-items: end;
  height: calc(var(--book-grid-height) + var(--book-grid-label-height, 0px) + var(--book-grid-gap));
  box-sizing: border-box;
  padding-left: 0;
  padding-right: var(--book-grid-gap);
  padding-bottom: var(--book-grid-gap);
}

.book-grid-cell--new {
  animation: book-enter 0.25s ease-out both;
}

@keyframes book-enter {
  from {
    transform: translateY(4px) scale(0.98);
  }
  to {
    transform: translateY(0) scale(1);
  }
}
</style>
