<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useFoliate, type RelocateDetail } from './epub/composables/useFoliate'
import { useReaderProgress } from './shared/composables/useReaderProgress'
import { useReadingSession } from './shared/composables/useReadingSession'
import { useReaderState } from './epub/composables/useReaderState'
import { useReaderSettings } from './shared/composables/useReaderSettings'
import { useCustomFonts } from './epub/composables/useCustomFonts'
import { useVisibility } from './shared/composables/useVisibility'
import { useWakeLock } from './shared/composables/useWakeLock'
import { useBookmarks } from './epub/composables/useBookmarks'
import { useAnnotations } from './epub/composables/useAnnotations'
import { useToc } from './epub/composables/useToc'
import { useSearch, type FoliateView } from './epub/composables/useSearch'
import { useReaderSelection } from './epub/composables/useReaderSelection'
import { useReaderKeyboardShortcuts } from './epub/composables/useReaderKeyboardShortcuts'
import { useFoliateTts } from '@/features/tts/composables/useFoliateTts'
import { useTtsPlayer } from '@/features/tts/composables/useTtsPlayer'
import { useTtsMiniPlayerUi } from '@/features/tts/composables/useTtsMiniPlayerUi'
import { useTtsPreferences } from '@/features/tts/composables/useTtsPreferences'
import { useTtsPosition } from '@/features/tts/composables/useTtsPosition'
import { getVoices } from '@/features/tts/api/tts.api'
import TtsResumePrompt from '@/features/tts/components/TtsResumePrompt.vue'
import ReaderHeader from './epub/components/ReaderHeader.vue'
import ReaderFooter from './epub/components/ReaderFooter.vue'
import ReaderSidebar from './epub/components/ReaderSidebar.vue'
import ReaderSettingsPanel from './epub/components/ReaderSettingsPanel.vue'
import SelectionPopup from './epub/components/SelectionPopup.vue'
import ReaderSearchPanel from './epub/components/ReaderSearchPanel.vue'
import NoteDialog from './epub/components/NoteDialog.vue'
import DictionaryPopover from './epub/components/DictionaryPopover.vue'
import TranslationPopover from './epub/components/TranslationPopover.vue'
import TranslationSheet from './epub/components/TranslationSheet.vue'
import KeyboardShortcutsModal from './epub/components/KeyboardShortcutsModal.vue'
import PdfV4ReaderView from './pdf-v4/PdfV4ReaderView.vue'
import CbzReaderView from './cbz/CbzReaderView.vue'
import AudiobookReaderView from './audiobook/AudiobookReaderView.vue'
import type { ReaderState } from './epub/composables/useReaderState'
import type { FoliateLocationContext, FoliateRenderer } from './epub/composables/useFoliate'
import type { BookDetail, EpubReaderSettings } from '@bookorbit/types'
import { getFormatGroup } from '@bookorbit/types'
import { api } from '@/lib/api'

const route = useRoute()
const router = useRouter()
const bookId = Number(route.params.bookId)
const fileId = Number(route.params.fileId)
const fileFormat = (route.query.format as string) || 'epub'
const normalizedFileFormat = fileFormat.toLowerCase()
const isAudioFormat = getFormatGroup(fileFormat) === 'audio'
const isPdfFormat = fileFormat === 'pdf'
const isComicFormat = fileFormat === 'cbz' || fileFormat === 'cbr' || fileFormat === 'cb7'
const isPeekMode = computed(() => {
  const mode = route.query.mode
  return (Array.isArray(mode) ? mode[0] : mode) === 'peek'
})
const trackingEnabled = computed(() => !isPeekMode.value)
const isTtsAvailable = normalizedFileFormat === 'epub'

const containerRef = ref<HTMLElement | null>(null)
const showSidebar = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const showTapZones = ref(false)
const searchInitialQuery = ref('')
const isFullscreen = ref(false)
const sectionFractions = ref<number[]>([])
const sidebarLocationMetaByCfi = ref<Record<string, { chapterTitle: string | null; percentage: number | null }>>({})
let sidebarLocationResolveSeq = 0

const bookSettings = useReaderSettings(fileId, fileFormat)
// False when overrideBookFormatting is off and the book has no per-book delta.
// Prevents injecting any CSS so the book renders with its own embedded styles.
const shouldApplyStyles = ref(true)

const readerState = useReaderState()
const {
  state,
  activeMode,
  isDark,
  applyToRenderer,
  setFontSize,
  setLineHeight,
  setFontFamily,
  setMaxColumnCount,
  setGap,
  setMaxInlineSize,
  setMaxBlockSize,
  setJustify,
  setHyphenate,
  setIsDark,
  setThemeName,
  setFlow,
  setFontFaceCSS,
} = readerState

const customFonts = useCustomFonts()

const { onActivity, elapsedMinutes } = useReadingSession(
  fileId,
  () => ({
    percentage: progress.percentage.value,
    cfi: progress.cfi.value,
    pageNumber: progress.pageNumber.value,
  }),
  { trackingEnabled },
)

const progress = useReaderProgress(bookId, fileId, elapsedMinutes, 0, { trackingEnabled })
const { cfi, chapterTitle, sectionIndex, totalSections, fraction, locationTotal, footerMode, cycleFooterMode, updateHeadsFeet } = progress

const visibility = useVisibility()
const { headerVisible, footerVisible, isPinned, handleMiddleTap, hideOverlays, setVisibilityLock } = visibility

useWakeLock()

const bookmarks = useBookmarks()
const annotations = useAnnotations()

const toc = useToc()
const { chapters, expandedHrefs, activeHref, setChapters, toggleExpand } = toc

const search = useSearch()
const { results: searchResults, isSearching, search: doSearch, clear: clearSearch } = search

const selection = useReaderSelection()

function closeAnyPanel() {
  if (showTapZones.value) {
    showTapZones.value = false
  } else if (showSearch.value) {
    closeSearch()
  } else if (showSidebar.value) {
    showSidebar.value = false
  } else if (showSettings.value) {
    showSettings.value = false
  } else {
    handleMiddleTap()
  }
}

const { showHelpModal } = useReaderKeyboardShortcuts({
  toggleSidebar: () => {
    showSidebar.value = !showSidebar.value
  },
  toggleSearch: () => {
    showSearch.value = !showSearch.value
  },
  toggleBookmark: () => {
    bookmarks.toggle(bookId, cfi.value ?? '', chapterTitle.value)
  },
  toggleFullscreen,
  cycleFooterMode,
  closePanel: closeAnyPanel,
  goToStart: () => navigateToFraction(0),
  goToEnd: () => navigateToFraction(1),
})

function toggleHelpModal() {
  showHelpModal.value = !showHelpModal.value
}

async function startTrackedReading() {
  const query = { ...route.query }
  delete query.mode
  await router.replace({ name: 'reader', params: route.params, query })
  await nextTick()
  await progress.save()
  onActivity()
}

const chapterStartFraction = computed(() => {
  const fracs = sectionFractions.value
  const idx = sectionIndex.value
  return fracs[idx] ?? 0
})

const chapterEndFraction = computed(() => {
  const fracs = sectionFractions.value
  const idx = sectionIndex.value
  return fracs[idx + 1] ?? 1
})

const showDictionary = ref(false)
const dictionaryWord = ref('')
const dictionaryPosition = ref({ x: 0, y: 0, showBelow: false })

const showTranslation = ref(false)
const translationText = ref('')
const translationPosition = ref({ x: 0, y: 0, showBelow: false })
const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

function handleDefine() {
  dictionaryWord.value = selection.text.value
  dictionaryPosition.value = {
    x: selection.position.value.x,
    y: selection.position.value.y,
    showBelow: selection.showBelow.value,
  }
  selection.dismiss()
  showDictionary.value = true
}

function handleTranslate() {
  translationText.value = selection.text.value
  translationPosition.value = {
    x: selection.position.value.x,
    y: selection.position.value.y,
    showBelow: selection.showBelow.value,
  }
  selection.dismiss()
  showTranslation.value = true
}

const bookMeta = ref<BookDetail | null>(null)

const {
  foliateReady,
  setFoliateSource,
  clearFoliateSource,
  getServerTextBlocks,
  getVisibleRange,
  clearStartAnchor,
  advanceHighlight,
  retreatHighlight,
  syncHighlightAtBlockStart,
  syncHighlightToBlockIndex,
  showResumeHighlightFromCfi,
  showResumeHighlightFromBlock,
  clearHighlight,
  startFromRange: startFoliateFromRange,
} = useFoliateTts()
const { startPlayback, isActive, currentBook, currentBlockIndex, currentChapterIndex, playbackState } = useTtsPlayer()
const { setExpanded: setMiniPlayerExpanded, setReaderFooterVisible } = useTtsMiniPlayerUi()
const { loadBookPreferences, loadUserPreferences, defaultProviderId, defaultVoiceId, defaultSpeed } = useTtsPreferences()
const ttsPosition = useTtsPosition()

const isTtsActive = computed(() => isActive.value && currentBook.value?.bookFileId === fileId)
const isNavigationLocked = computed(() => isTtsActive.value && playbackState.value === 'playing')
const isOverlayFooterVisible = computed(() => footerVisible.value && !showTapZones.value)
const showTtsResumePrompt = ref(false)
const clearingSavedTtsPosition = ref(false)
const syncedHighlightChapterIndex = ref<number | null>(null)
const syncedHighlightBlockIndex = ref<number | null>(null)
const preferVisibleRangeForTtsSync = ref(false)
const pendingTtsChapterNavigation = ref<number | null>(null)
const isTtsRelocating = ref(false)
const lastNavigationBlockedToastAt = ref(0)

function withTtsRelocation(fn: () => void | Promise<void>) {
  isTtsRelocating.value = true
  const res = fn()
  if (res instanceof Promise) {
    void res.finally(() => {
      setTimeout(() => {
        isTtsRelocating.value = false
      }, 150)
    })
  } else {
    setTimeout(() => {
      isTtsRelocating.value = false
    }, 150)
  }
}

function ensureTtsAvailable(): boolean {
  if (isTtsAvailable) return true
  toast.error('TTS currently supports EPUB files only')
  return false
}

function applySavedTtsResumeHighlight() {
  if (!isTtsAvailable) return
  if (!foliateReady.value || isTtsActive.value) return
  const saved = ttsPosition.savedPosition.value
  if (!saved?.cfi) return

  // Clear any stale TTS marker before applying the current saved one.
  clearHighlight()

  if (showResumeHighlightFromCfi(saved.cfi)) return

  const match = /^tts:(\d+):(\d+)$/.exec(saved.cfi)
  if (!match) return
  const savedChapterIdx = parseInt(match[1]!, 10)
  const savedBlockIdx = parseInt(match[2]!, 10)
  void showResumeHighlightFromBlock(savedChapterIdx, savedBlockIdx, sectionIndex.value)
}

function onChapterLoadHandler(doc: Document, viewEl: HTMLElement) {
  setFoliateSource(doc, viewEl, () => {})
}

function syncFoliateHighlightToCurrentBlock() {
  if (currentChapterIndex.value !== sectionIndex.value) {
    clearHighlight()
    return
  }

  const blockIdx = currentBlockIndex.value
  const preferVisibleRange = preferVisibleRangeForTtsSync.value
  if (blockIdx === 0) {
    syncHighlightAtBlockStart(preferVisibleRange)
  } else {
    syncHighlightToBlockIndex(blockIdx, preferVisibleRange)
  }
  syncedHighlightChapterIndex.value = currentChapterIndex.value
  syncedHighlightBlockIndex.value = blockIdx
}

watch([isTtsActive, foliateReady], ([active, ready]) => {
  if (!active) {
    syncedHighlightChapterIndex.value = null
    syncedHighlightBlockIndex.value = null
    pendingTtsChapterNavigation.value = null
    return
  }
  if (!ready) {
    syncedHighlightChapterIndex.value = null
    syncedHighlightBlockIndex.value = null
    return
  }
  withTtsRelocation(() => {
    syncFoliateHighlightToCurrentBlock()
  })
})

watch([foliateReady, isTtsActive, sectionIndex, () => ttsPosition.savedPosition.value?.cfi], ([ready, active, , savedCfi], previous) => {
  if (!ready || active || !savedCfi) return
  // On explicit TTS stop/close, keep the current sentence highlight in place
  // instead of immediately re-resolving from persisted state.
  const wasActive = previous?.[1] ?? false
  if (wasActive && !active) return
  applySavedTtsResumeHighlight()
})

// Keep Foliate overlay in lockstep with TTS block changes.
watch([currentChapterIndex, currentBlockIndex], ([chapterIdx, blockIdx]) => {
  if (!isTtsActive.value || !foliateReady.value) return

  withTtsRelocation(async () => {
    // Keep the visual reader chapter aligned with the TTS chapter before
    // syncing sentence highlight; otherwise chapter rollover can jump to the
    // start of the previous chapter and scroll backwards.
    if (sectionIndex.value !== chapterIdx) {
      if (pendingTtsChapterNavigation.value !== chapterIdx) {
        pendingTtsChapterNavigation.value = chapterIdx
        syncedHighlightChapterIndex.value = null
        syncedHighlightBlockIndex.value = null
        await goToSection(chapterIdx)
      }
      return
    }
    pendingTtsChapterNavigation.value = null

    const syncedChapter = syncedHighlightChapterIndex.value
    const syncedBlock = syncedHighlightBlockIndex.value
    if (syncedChapter === null || syncedBlock === null || syncedChapter !== chapterIdx) {
      syncFoliateHighlightToCurrentBlock()
      return
    }

    const delta = blockIdx - syncedBlock
    if (delta === 1) {
      advanceHighlight()
    } else if (delta === -1) {
      retreatHighlight()
    } else if (delta !== 0) {
      syncFoliateHighlightToCurrentBlock()
      return
    }
    syncedHighlightBlockIndex.value = blockIdx
  })
})

async function resolveProviderAndVoice(providerId: string) {
  let voiceId = defaultVoiceId.value ?? ''
  const effectivePrefs = await loadBookPreferences(bookId)
  const resolvedProviderId = effectivePrefs.providerId ?? providerId
  voiceId = effectivePrefs.voiceId ?? voiceId
  if (!voiceId.trim()) {
    const voices = await getVoices(resolvedProviderId)
    voiceId = voices[0]?.id ?? ''
  }
  return { providerId: resolvedProviderId, voiceId, speed: effectivePrefs.speed ?? defaultSpeed.value ?? 1.0 }
}

async function resolveStartBlockByText(chapterIdx: number, snippet: string): Promise<number> {
  if (!snippet) return 0
  try {
    const blocks = await getServerTextBlocks(fileId, chapterIdx)
    const norm = snippet.toLowerCase().slice(0, 40)
    const idx = blocks.findIndex((b) => b.toLowerCase().includes(norm) || norm.includes(b.toLowerCase().slice(0, 30)))
    return idx >= 0 ? idx : 0
  } catch {
    return 0
  }
}

async function buildTtsBook(): Promise<{
  bookId: number
  bookFileId: number
  title: string
  author: string | null
  coverUrl: string | null
  totalChapters: number
} | null> {
  if (!bookMeta.value) {
    toast.error('Book metadata not loaded yet')
    return null
  }
  return {
    bookId,
    bookFileId: fileId,
    title: bookMeta.value.title ?? chapterTitle.value ?? 'Book',
    author: bookMeta.value.authors?.[0]?.name ?? null,
    coverUrl: bookMeta.value.coverSource ? `/api/v1/books/${bookId}/cover` : null,
    totalChapters: totalSections.value,
  }
}

async function handleStartTts() {
  if (!ensureTtsAvailable()) return

  showSettings.value = false
  showTapZones.value = false
  hideOverlays(true)

  if (isTtsActive.value) {
    setMiniPlayerExpanded(true)
    return
  }

  await ttsPosition.loadPosition(fileId)
  if (ttsPosition.savedPosition.value?.cfi) {
    showTtsResumePrompt.value = true
    await nextTick()
    applySavedTtsResumeHighlight()
    return
  }

  await handlePlayFromCurrentPage()
}

async function handleReadFromHere() {
  if (!ensureTtsAvailable()) return
  const selectedSnippet = selection.text.value.trim()
  const range = selection.selectionRange.value
  selection.dismiss()
  const book = await buildTtsBook()
  if (!book) return
  try {
    clearStartAnchor()
    // For explicit "read from here", sync should follow the resolved
    // sentence index instead of snapping to viewport start.
    preferVisibleRangeForTtsSync.value = false
    const baseProviderId = defaultProviderId.value ?? 'edge'
    const { providerId, voiceId, speed } = await resolveProviderAndVoice(baseProviderId)
    if (!voiceId.trim()) {
      toast.error('No TTS voices are available for the selected provider')
      return
    }
    const chapterIdx = sectionIndex.value
    let startBlock = 0
    if (selectedSnippet) {
      startBlock = await resolveStartBlockByText(chapterIdx, selectedSnippet)
    } else if (range) {
      // Fallback for edge cases where selection text is empty.
      const fallbackSnippet = range.toString().trim() || startFoliateFromRange(range) || ''
      startBlock = await resolveStartBlockByText(chapterIdx, fallbackSnippet)
    }
    await startPlayback(book, providerId, voiceId, speed, (chapterIndex) => getServerTextBlocks(fileId, chapterIndex), chapterIdx, startBlock)
  } catch {
    toast.error('Failed to start TTS playback')
  }
}

async function handleResumeTts() {
  if (!ensureTtsAvailable()) return
  showTtsResumePrompt.value = false
  const saved = ttsPosition.savedPosition.value
  if (!saved) {
    await handleStartTts()
    return
  }
  const match = /^tts:(\d+):(\d+)$/.exec(saved.cfi)
  const chapterIdx = match ? parseInt(match[1]!, 10) : (saved.chapterIndex ?? sectionIndex.value)
  const blockIdx = match ? parseInt(match[2]!, 10) : 0
  const book = await buildTtsBook()
  if (!book) return
  try {
    // Resume should anchor highlight to saved block index, not current viewport.
    clearStartAnchor()
    preferVisibleRangeForTtsSync.value = false
    const baseProviderId = defaultProviderId.value ?? 'edge'
    const { providerId, voiceId, speed } = await resolveProviderAndVoice(baseProviderId)
    if (!voiceId.trim()) {
      toast.error('No TTS voices are available for the selected provider')
      return
    }
    await startPlayback(book, providerId, voiceId, speed, (chapterIndex) => getServerTextBlocks(fileId, chapterIndex), chapterIdx, blockIdx)
  } catch {
    toast.error('Failed to resume TTS playback')
  }
}

function dismissResumePrompt() {
  showTtsResumePrompt.value = false
  clearStartAnchor()
  clearHighlight()
}

async function handleClearSavedTtsPosition() {
  if (clearingSavedTtsPosition.value) return
  clearingSavedTtsPosition.value = true
  try {
    await ttsPosition.clearPosition(fileId)
    showTtsResumePrompt.value = false
    clearStartAnchor()
    clearHighlight()
  } catch {
    toast.error('Failed to clear saved TTS position')
  } finally {
    clearingSavedTtsPosition.value = false
  }
}

async function handlePlayFromCurrentPage() {
  if (!ensureTtsAvailable()) return
  showTtsResumePrompt.value = false
  const book = await buildTtsBook()
  if (!book) return
  try {
    clearStartAnchor()
    preferVisibleRangeForTtsSync.value = true
    const baseProviderId = defaultProviderId.value ?? 'edge'
    const { providerId, voiceId, speed } = await resolveProviderAndVoice(baseProviderId)
    if (!voiceId.trim()) {
      toast.error('No TTS voices are available for the selected provider')
      return
    }
    const chapterIdx = sectionIndex.value
    let startBlock = 0
    // Use the range cached from the last relocate event — it is the most reliable
    // source of the currently visible position (same technique as Flutter).
    const visibleRange = getVisibleRange()
    if (visibleRange) {
      const foliateText = startFoliateFromRange(visibleRange)
      if (foliateText) {
        startBlock = await resolveStartBlockByText(chapterIdx, foliateText)
      }
    }
    await startPlayback(book, providerId, voiceId, speed, (chapterIndex) => getServerTextBlocks(fileId, chapterIndex), chapterIdx, startBlock)
  } catch {
    toast.error('Failed to start TTS playback')
  }
}

function onRelocateHandler(detail: RelocateDetail) {
  progress.onRelocate(detail)
  onActivity()
  bookmarks.setCfi(detail?.cfi ?? null)
  toc.setActiveHref(detail?.tocItem?.href ?? '')
  const renderer = getRenderer()
  if (renderer) {
    updateHeadsFeet(renderer, activeMode.value)
  }
}

function onApplyStylesHandler(renderer: FoliateRenderer) {
  if (shouldApplyStyles.value) {
    applyToRenderer(renderer)
  }
}

function onMiddleTapHandler() {
  handleMiddleTap()
}

function canRunManualNavigation(): boolean {
  if (!isNavigationLocked.value) return true

  const now = Date.now()
  if (now - lastNavigationBlockedToastAt.value >= 1200) {
    lastNavigationBlockedToastAt.value = now
    toast.info('Pause TTS playback to navigate pages.')
  }

  return false
}

function handleBlockedPageInteraction() {
  canRunManualNavigation()
}

const {
  loading,
  error,
  open,
  goTo,
  goToFraction,
  goToSection,
  getSectionFractions,
  getChapters,
  getLocationContext,
  getRenderer,
  addAnnotation,
  addAnnotations,
  deleteAnnotation,
  setTextSelectedHandler,
  view: foliateView,
  bookLanguage,
} = useFoliate(() => containerRef.value, onRelocateHandler, onApplyStylesHandler, onMiddleTapHandler, onChapterLoadHandler, canRunManualNavigation)

setTextSelectedHandler(selection.show)

onMounted(async () => {
  const onFullscreenChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
  onUnmounted(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    clearFoliateSource()
  })

  // Specialized readers own their own progress/settings/loading lifecycle.
  if (isAudioFormat || isPdfFormat || isComicFormat) return

  void Promise.all([
    api(`/api/v1/books/${bookId}`)
      .then((r) => r.json() as Promise<BookDetail>)
      .then((b) => {
        bookMeta.value = b
      })
      .catch(() => {}),
    ...(isTtsAvailable ? [loadUserPreferences().catch(() => {})] : []),
  ])

  await customFonts.fetchFonts()
  setFontFaceCSS(customFonts.generateFontFaceCSS())

  await progress.load()

  await bookSettings.load()
  const effective = bookSettings.effective.value as EpubReaderSettings
  if (effective.footerDisplayMode !== undefined) {
    footerMode.value = effective.footerDisplayMode
  }
  if (effective.overrideBookFormatting) {
    shouldApplyStyles.value = true
    seedState(effective)
  } else if (bookSettings.isCustomized.value) {
    shouldApplyStyles.value = true
    seedState(bookSettings.bookDelta.value as Partial<ReaderState>)
  } else {
    shouldApplyStyles.value = false
  }

  const hadProgress = progress.percentage.value > 0
  await open(bookId, fileId, fileFormat, progress.cfi.value, hadProgress ? progress.percentage.value / 100 : undefined)
  setChapters(getChapters())
  sectionFractions.value = getSectionFractions()
  await bookmarks.load(bookId)
  await annotations.load(bookId)
  if (annotations.annotations.value.length > 0) {
    addAnnotations(annotations.annotations.value.map((a) => ({ cfi: a.cfi, color: a.color, style: a.style })))
  }
  void hydrateSidebarLocationMeta()

  if (isTtsAvailable) {
    // Load saved TTS position and show its marker immediately on open.
    await ttsPosition.loadPosition(fileId)
    if (ttsPosition.hasSavedPosition.value) {
      await nextTick()
      applySavedTtsResumeHighlight()
    }
  }
})

const epubSetters: Record<string, (v: unknown) => void> = {
  fontSize: (v) => setFontSize(v as number),
  lineHeight: (v) => setLineHeight(v as number),
  fontFamily: (v) => setFontFamily(v as string | null),
  maxColumnCount: (v) => setMaxColumnCount(v as number),
  gap: (v) => setGap(v as number),
  maxInlineSize: (v) => setMaxInlineSize(v as number),
  maxBlockSize: (v) => setMaxBlockSize(v as number),
  justify: (v) => setJustify(v as boolean),
  hyphenate: (v) => setHyphenate(v as boolean),
  isDark: (v) => setIsDark(v as boolean),
  themeName: (v) => setThemeName(v as string),
  flow: (v) => setFlow(v as 'paginated' | 'scrolled'),
}

// Applies settings to reactive refs (and renderer if open) without touching the delta.
// Used for initial seeding on mount.
function seedState(partial: Partial<ReaderState>) {
  for (const [key, value] of Object.entries(partial)) {
    epubSetters[key]?.(value)
  }
  const renderer = getRenderer()
  if (renderer) applyToRenderer(renderer)
}

// Applies a user-initiated change: updates reactive refs AND saves the changed field to delta.
// Also enables style injection from this point forward (user has opted in by changing something).
function applyUpdate(partial: Partial<ReaderState>) {
  shouldApplyStyles.value = true
  seedState(partial)
  bookSettings.updateBookSettings(partial)
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    document.documentElement.requestFullscreen?.()
  }
}

watch(
  () => footerMode.value,
  (mode) => {
    bookSettings.updateBookSettings({ footerDisplayMode: mode })
    const renderer = getRenderer()
    if (renderer) {
      updateHeadsFeet(renderer, activeMode.value)
    }
  },
)

function setSettingsOpen(open: boolean) {
  showSettings.value = open
}

watch(showSettings, (open) => {
  setVisibilityLock(open)
})

watch(
  () => isNavigationLocked.value,
  (locked) => {
    if (!locked) return
    selection.dismiss()
    showDictionary.value = false
    showTranslation.value = false
  },
)

watch(
  () => isOverlayFooterVisible.value,
  (visible) => {
    setReaderFooterVisible(visible)
  },
  { immediate: true },
)

watch(
  () => customFonts.fonts.value,
  () => {
    setFontFaceCSS(customFonts.generateFontFaceCSS())
    const renderer = getRenderer()
    if (renderer && shouldApplyStyles.value) applyToRenderer(renderer)
  },
)

async function handleHighlight(color: string, style: string, note?: string) {
  const annotationCfi = selection.cfi.value
  if (!selection.text.value || !annotationCfi) return
  const created = await annotations.create(bookId, {
    cfi: annotationCfi,
    text: selection.text.value,
    color,
    style,
    note: note ?? null,
    chapterTitle: chapterTitle.value || null,
  })
  if (created) {
    addAnnotation(created.cfi, created.color, created.style)
  }
  selection.dismiss()
}

async function handleSaveNote(note: string) {
  await handleHighlight('#FACC15', 'highlight', note)
  selection.showNoteDialog.value = false
  selection.noteText.value = ''
}

function handleDeleteAnnotation(id: number) {
  const ann = annotations.annotations.value.find((a) => a.id === id)
  if (ann) {
    deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
  selection.dismiss()
}

function handleSidebarDeleteAnnotation(id: number) {
  const ann = annotations.annotations.value.find((a) => a.id === id)
  if (ann) {
    deleteAnnotation(ann.cfi)
    annotations.remove(bookId, id)
  }
}

function handleSidebarDeleteBookmark(id: number) {
  bookmarks.remove(bookId, id)
}

function getSidebarCfiTargets(): string[] {
  const targets = new Set<string>()
  for (const bm of bookmarks.bookmarks.value) {
    if (bm.cfi) targets.add(bm.cfi)
  }
  for (const ann of annotations.annotations.value) {
    if (ann.cfi) targets.add(ann.cfi)
  }
  return Array.from(targets)
}

function pruneSidebarLocationMeta(targets: string[]) {
  const targetSet = new Set(targets)
  const next: Record<string, { chapterTitle: string | null; percentage: number | null }> = {}
  for (const [cfiKey, meta] of Object.entries(sidebarLocationMetaByCfi.value)) {
    if (targetSet.has(cfiKey)) {
      next[cfiKey] = meta
    }
  }
  if (Object.keys(next).length === Object.keys(sidebarLocationMetaByCfi.value).length) return
  sidebarLocationMetaByCfi.value = next
}

function toSidebarLocationMeta(context: FoliateLocationContext): { chapterTitle: string | null; percentage: number | null } {
  const percentage =
    typeof context.fraction === 'number' && Number.isFinite(context.fraction) ? Math.max(0, Math.min(100, Math.round(context.fraction * 100))) : null
  return { chapterTitle: context.chapterTitle, percentage }
}

async function hydrateSidebarLocationMeta() {
  const targets = getSidebarCfiTargets()
  pruneSidebarLocationMeta(targets)
  if (targets.length === 0) return

  const unresolved = targets.filter((target) => !sidebarLocationMetaByCfi.value[target])
  if (unresolved.length === 0) return

  const requestSeq = ++sidebarLocationResolveSeq
  const entries = await Promise.all(
    unresolved.map(async (target) => {
      try {
        const context = await getLocationContext(target)
        return [target, toSidebarLocationMeta(context)] as const
      } catch {
        return [target, { chapterTitle: null, percentage: null }] as const
      }
    }),
  )

  if (requestSeq !== sidebarLocationResolveSeq) return
  sidebarLocationMetaByCfi.value = { ...sidebarLocationMetaByCfi.value, ...Object.fromEntries(entries) }
}

function onSearchQuery(q: string) {
  if (!foliateView.value) return
  doSearch(foliateView.value as FoliateView, q)
}

async function openSearchWithText(text: string) {
  selection.dismiss()
  searchInitialQuery.value = text
  showSearch.value = true
  await nextTick()
  onSearchQuery(text)
}

function onSearchClear() {
  clearSearch(foliateView.value as FoliateView | null)
}

function navigateToTarget(target: string | number) {
  if (!canRunManualNavigation()) return
  goTo(target)
}

function navigateToFraction(targetFraction: number) {
  if (!canRunManualNavigation()) return
  goToFraction(targetFraction)
}

function navigateToSection(targetSection: number) {
  if (!canRunManualNavigation()) return
  goToSection(targetSection)
}

function navigateSearch(cfiTarget: string) {
  navigateToTarget(cfiTarget)
}

async function navigateFromSidebar(cfiTarget: string) {
  const goToPromise = goTo(cfiTarget)
  if (!goToPromise) return
  const navigated = await Promise.resolve(goToPromise)
    .then(() => true)
    .catch(() => false)
  if (!navigated) return
  showSidebar.value = false
}

function navigateChapterFromSidebar(href: string) {
  goTo(href)
  showSidebar.value = false
}

function closeSearch() {
  onSearchClear()
  searchInitialQuery.value = ''
  showSearch.value = false
}

watch(showSidebar, (open) => {
  if (open) {
    void hydrateSidebarLocationMeta()
  }
})

watch(
  () => [bookmarks.bookmarks.value.map((bm) => bm.cfi).join('|'), annotations.annotations.value.map((ann) => ann.cfi).join('|')],
  () => {
    if (showSidebar.value) {
      void hydrateSidebarLocationMeta()
    }
  },
)

onUnmounted(() => {
  setReaderFooterVisible(false)
})
</script>

<template>
  <PdfV4ReaderView v-if="isPdfFormat" :bookId="bookId" :fileId="fileId" :peek-mode="isPeekMode" />
  <CbzReaderView v-else-if="isComicFormat" :bookId="bookId" :fileId="fileId" :peek-mode="isPeekMode" />
  <AudiobookReaderView v-else-if="isAudioFormat" :bookId="bookId" :fileId="fileId" :peek-mode="isPeekMode" />
  <div
    v-else
    class="fixed inset-0 overflow-hidden"
    :style="
      shouldApplyStyles ? { background: activeMode.bg, colorScheme: isDark ? 'dark' : 'light' } : { background: '#ffffff', colorScheme: 'light' }
    "
  >
    <ReaderHeader
      :chapterTitle="chapterTitle"
      :isBookmarked="bookmarks.isCurrentCfiBookmarked.value"
      :settings-open="showSettings"
      :footerMode="footerMode"
      :peek-mode="isPeekMode"
      :isTtsActive="isTtsActive"
      :isTtsAvailable="isTtsAvailable"
      :isPinned="isPinned"
      :showTapZones="showTapZones"
      class="transition-all duration-300"
      :class="headerVisible && !showTapZones ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
      @back="router.back()"
      @toggleSidebar="showSidebar = !showSidebar"
      @toggleSearch="showSearch = !showSearch"
      @toggleBookmark="bookmarks.toggle(bookId, cfi ?? '', chapterTitle)"
      @update:settings-open="setSettingsOpen"
      @toggleFullscreen="toggleFullscreen"
      @toggleHelp="toggleHelpModal"
      @cycleFooterMode="cycleFooterMode"
      @startReading="startTrackedReading"
      @startTts="handleStartTts"
      @togglePin="handleMiddleTap"
      @toggleTapZones="showTapZones = !showTapZones"
    >
      <template #settingsPanel>
        <ReaderSettingsPanel :state="state" :customFonts="customFonts" @update="applyUpdate" />
      </template>
    </ReaderHeader>

    <Transition name="bookmark-fade">
      <div v-if="bookmarks.isCurrentCfiBookmarked.value" class="absolute left-8 z-30 pointer-events-none" aria-hidden="true">
        <div class="w-7 h-14 bg-primary" style="clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)" />
      </div>
    </Transition>

    <div class="absolute inset-0">
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-10 bg-background">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p class="text-sm text-muted-foreground">Loading book…</p>
        </div>
      </div>

      <div v-if="error && !loading" class="absolute inset-0 flex items-center justify-center z-10 p-8 bg-background">
        <div class="text-center max-w-sm">
          <p class="text-sm font-medium mb-2 text-foreground">Failed to load book</p>
          <p class="text-xs text-muted-foreground">{{ error }}</p>
        </div>
      </div>

      <div ref="containerRef" class="absolute inset-0" />
      <div
        v-if="isNavigationLocked"
        class="absolute inset-0 z-[40] touch-none"
        @pointerdown.stop.prevent="handleBlockedPageInteraction"
        @touchstart.stop.prevent="handleBlockedPageInteraction"
        @click.stop.prevent="handleBlockedPageInteraction"
      />

      <!-- Tap/Click Zones Reference Overlay -->
      <Transition name="fade">
        <div v-if="showTapZones" class="absolute inset-0 z-20 pointer-events-none flex select-none">
          <!-- Floating Exit Button -->
          <button
            class="absolute top-4 right-4 z-50 px-3.5 py-2 rounded-xl bg-background/90 text-foreground border border-border/80 shadow-lg hover:bg-background pointer-events-auto flex items-center gap-2 text-xs font-semibold cursor-pointer transition-all duration-200 active:scale-95 animate-pulse"
            @click="showTapZones = false"
            title="Close Guide"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="lucide lucide-x text-primary"
            >
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
            <span>Exit Guide</span>
          </button>

          <!-- Mobile Guide -->
          <div v-if="isMobile" class="w-full h-full flex flex-col items-center justify-center bg-primary/[0.24] backdrop-blur-[4px] p-6 text-center">
            <div
              class="flex flex-col items-center gap-4 p-6 max-w-sm rounded-2xl bg-background/90 border border-border/70 shadow-2xl text-muted-foreground"
            >
              <div class="flex gap-4 items-center">
                <span class="p-3 rounded-full bg-primary/10 text-primary">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-touchpad"
                  >
                    <rect width="20" height="20" x="2" y="2" rx="2" />
                    <path d="M12 14v4" />
                    <path d="M10 16h4" />
                    <circle cx="12" cy="8" r="2" />
                  </svg>
                </span>
                <span class="p-3 rounded-full bg-primary/10 text-primary">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-hand"
                  >
                    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
                    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4.5" />
                    <path
                      d="M6 14.5V11a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v7.5A8.5 8.5 0 0 0 10.5 27h3A8.5 8.5 0 0 0 22 18.5V14a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v.5"
                    />
                  </svg>
                </span>
              </div>
              <div>
                <h3 class="text-sm font-semibold tracking-wide uppercase text-foreground mb-1">Mobile Interactions</h3>
                <p class="text-xs text-muted-foreground mb-4">Optimized for handheld touch reading</p>
                <div class="space-y-3 text-left">
                  <div class="flex items-start gap-2.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                    <div>
                      <p class="text-xs font-medium text-foreground">Tap Anywhere</p>
                      <p class="text-[10px] text-muted-foreground">Toggles the header and footer overlays</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-2.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                    <div>
                      <p class="text-xs font-medium text-foreground">Swipe Left / Right</p>
                      <p class="text-[10px] text-muted-foreground">Turns pages smoothly forward or backward</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Desktop Guide -->
          <div v-else class="w-full h-full flex flex-col">
            <!-- Top Zone (64px) -->
            <div
              class="h-16 w-full flex items-center justify-center border-b-2 border-dashed border-primary/40 bg-primary/[0.18] backdrop-blur-[3px] shrink-0"
            >
              <div
                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/90 border border-border/70 shadow-md text-muted-foreground text-center animate-pulse"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="lucide lucide-menu text-primary"
                >
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
                <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Toggle Header</span>
                <span class="text-[10px] text-muted-foreground">Click top edge (y &lt; 64px)</span>
              </div>
            </div>

            <!-- Central Content Area -->
            <div class="flex-1 w-full flex min-h-0">
              <!-- Left Zone (30%) -->
              <div class="w-[30%] h-full flex flex-col items-center justify-center border-r-2 border-dashed border-primary/40 bg-primary/[0.08]">
                <div
                  class="flex flex-col items-center gap-2 p-4 mx-2 rounded-xl bg-background/90 border border-border/70 shadow-md text-muted-foreground animate-pulse text-center"
                >
                  <span class="p-2 rounded-full bg-primary/10 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="lucide lucide-chevron-left"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </span>
                  <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Previous Page</span>
                  <span class="text-[10px] text-muted-foreground max-w-[120px]">Click left 30%</span>
                </div>
              </div>

              <!-- Middle Zone (40%) -->
              <div class="w-[40%] h-full flex flex-col items-center justify-center border-r-2 border-dashed border-primary/40 bg-transparent">
                <div
                  class="flex flex-col items-center gap-2 p-4 mx-2 rounded-xl bg-background/90 border border-border/70 text-muted-foreground text-center shadow-md animate-pulse"
                >
                  <span class="p-2 rounded-full bg-primary/10 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="lucide lucide-menu"
                    >
                      <line x1="4" x2="20" y1="12" y2="12" />
                      <line x1="4" x2="20" y1="6" y2="6" />
                      <line x1="4" x2="20" y1="18" y2="18" />
                    </svg>
                  </span>
                  <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Toggle Header & Footer</span>
                  <span class="text-[10px] text-muted-foreground max-w-[120px]">Click center 40%</span>
                </div>
              </div>

              <!-- Right Zone (30%) -->
              <div class="w-[30%] h-full flex flex-col items-center justify-center bg-primary/[0.08]">
                <div
                  class="flex flex-col items-center gap-2 p-4 mx-2 rounded-xl bg-background/90 border border-border/70 shadow-md text-muted-foreground animate-pulse text-center"
                >
                  <span class="p-2 rounded-full bg-primary/10 text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="lucide lucide-chevron-right"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                  <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Next Page</span>
                  <span class="text-[10px] text-muted-foreground max-w-[120px]">Click right 30%</span>
                </div>
              </div>
            </div>

            <!-- Bottom Zone (64px) -->
            <div
              class="h-16 w-full flex items-center justify-center border-t-2 border-dashed border-primary/40 bg-primary/[0.18] backdrop-blur-[3px] shrink-0"
            >
              <div
                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/90 border border-border/70 shadow-md text-muted-foreground text-center animate-pulse"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="lucide lucide-menu text-primary"
                >
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
                <span class="text-xs font-semibold tracking-wide uppercase text-foreground">Toggle Footer</span>
                <span class="text-[10px] text-muted-foreground">Click bottom edge (y &gt; height - 64px)</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <ReaderFooter
      :fraction="fraction"
      :sectionIndex="sectionIndex"
      :totalSections="totalSections"
      :sectionFractions="sectionFractions"
      :chapterStartFraction="chapterStartFraction"
      :chapterEndFraction="chapterEndFraction"
      :locationTotal="locationTotal"
      :navigationLocked="isNavigationLocked"
      class="transition-all duration-300"
      :class="footerVisible && !showTapZones ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'"
      @prevSection="navigateToSection(sectionIndex - 1)"
      @nextSection="navigateToSection(sectionIndex + 1)"
      @seek="navigateToFraction($event)"
    />

    <ReaderSidebar
      v-if="showSidebar"
      :chapters="chapters"
      :bookmarks="bookmarks.bookmarks.value"
      :annotations="annotations.annotations.value"
      :currentCfi="cfi"
      :locationMetaByCfi="sidebarLocationMetaByCfi"
      :activeHref="activeHref"
      :expandedHrefs="expandedHrefs"
      :navigationLocked="isNavigationLocked"
      @close="showSidebar = false"
      @navigateChapter="navigateChapterFromSidebar"
      @navigateBookmark="navigateFromSidebar"
      @navigateAnnotation="navigateFromSidebar"
      @deleteBookmark="handleSidebarDeleteBookmark"
      @deleteAnnotation="handleSidebarDeleteAnnotation"
      @toggleExpand="toggleExpand"
    />

    <ReaderSearchPanel
      v-if="showSearch"
      :results="searchResults"
      :isSearching="isSearching"
      :initialQuery="searchInitialQuery"
      :navigationLocked="isNavigationLocked"
      @search="onSearchQuery"
      @clear="onSearchClear"
      @navigate="navigateSearch($event)"
      @close="closeSearch"
    />

    <NoteDialog
      v-if="selection.showNoteDialog.value"
      :selectedText="selection.text.value"
      :modelValue="selection.noteText.value"
      @update:modelValue="selection.noteText.value = $event"
      @save="handleSaveNote"
      @cancel="selection.showNoteDialog.value = false"
    />

    <SelectionPopup
      :visible="selection.visible.value"
      :position="selection.position.value"
      :showBelow="selection.showBelow.value"
      :selectedText="selection.text.value"
      :overlappingAnnotationId="selection.overlappingAnnotationId.value"
      :isTtsAvailable="isTtsAvailable"
      @copy="selection.dismiss()"
      @highlight="handleHighlight"
      @search="() => openSearchWithText(selection.text.value)"
      @translate="handleTranslate"
      @define="handleDefine"
      @note="selection.openNoteDialog()"
      @deleteAnnotation="handleDeleteAnnotation"
      @dismiss="selection.dismiss()"
      @readFromHere="handleReadFromHere"
    />

    <Teleport to="body">
      <Transition name="tts-resume-fade">
        <div v-if="showTtsResumePrompt && !isTtsActive" class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
          <TtsResumePrompt
            :chapterIndex="ttsPosition.savedPosition.value?.chapterIndex ?? null"
            :clearing="clearingSavedTtsPosition"
            @resume="handleResumeTts"
            @playFromHere="handlePlayFromCurrentPage"
            @clearSavedPosition="handleClearSavedTtsPosition"
            @cancel="dismissResumePrompt"
          />
        </div>
      </Transition>
    </Teleport>

    <DictionaryPopover
      v-if="showDictionary"
      :word="dictionaryWord"
      :position="dictionaryPosition"
      :lang="bookLanguage"
      @close="showDictionary = false"
    />

    <TranslationPopover
      v-if="showTranslation && !isMobile"
      :text="translationText"
      :position="translationPosition"
      @close="showTranslation = false"
    />

    <TranslationSheet v-if="showTranslation && isMobile" :text="translationText" @close="showTranslation = false" />

    <KeyboardShortcutsModal v-if="showHelpModal" @close="showHelpModal = false" />
  </div>
</template>

<style scoped>
.bookmark-fade-enter-active,
.bookmark-fade-leave-active {
  transition: opacity 0.2s ease;
}
.bookmark-fade-enter-from,
.bookmark-fade-leave-to {
  opacity: 0;
}
.tts-resume-fade-enter-active,
.tts-resume-fade-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.tts-resume-fade-enter-from,
.tts-resume-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
