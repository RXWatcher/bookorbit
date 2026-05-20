import { ref } from 'vue'
import * as ttsApi from '../api/tts.api'

interface FoliateTTSInstance {
  start(): string | null
  resume(): string | null
  prev(paused?: boolean): string | null
  next(paused?: boolean): string | null
  from(range: Range): string | null
  setMark(mark: string): void
}

interface FoliateContent {
  index: number
  doc?: Document
  overlayer?: {
    add(key: string, range: Range, draw: (rects: DOMRectList, opts: unknown) => Element, options: unknown): void
    remove(key: string): void
  }
}

interface FoliateRenderer extends EventTarget {
  getContents?: () => FoliateContent[]
  scrollToAnchor?: (anchor: Range, select?: boolean) => Promise<void>
}

interface FoliateViewElement extends HTMLElement {
  tts?: FoliateTTSInstance
  renderer?: FoliateRenderer
  initTTS?: (granularity?: string, highlight?: (range: Range) => void) => Promise<void>
  resolveCFI?: (cfi: string) => { index?: number; anchor?: (doc: Document) => Range } | undefined
}

const TTS_HIGHLIGHT_KEY = '__tts_highlight__'
const TTS_HIGHLIGHT_COLOR = '#4FC3F7'

const foliateReady = ref(false)
let ttsInstance: FoliateTTSInstance | null = null
let rendererRef: FoliateRenderer | null = null
let foliateViewRef: FoliateViewElement | null = null
let cachedVisibleRange: Range | null = null
let startAnchorRange: Range | null = null
let highlightedRange: Range | null = null
let relocateCleanup: (() => void) | null = null

function createSvgElement(tag: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', tag)
}

function drawHighlight(rects: DOMRectList, options?: { color?: string }): Element {
  const g = createSvgElement('g')
  g.setAttribute('fill', options?.color ?? 'red')
  ;(g as SVGGElement).style.opacity = 'var(--overlayer-highlight-opacity, .3)'
  ;(g as SVGGElement).style.mixBlendMode = 'var(--overlayer-highlight-blend-mode, normal)'
  for (const { left, top, height, width } of rects) {
    const rect = createSvgElement('rect')
    rect.setAttribute('x', String(left))
    rect.setAttribute('y', String(top))
    rect.setAttribute('height', String(height))
    rect.setAttribute('width', String(width))
    g.append(rect)
  }
  return g
}

function getContentForRange(range: Range): FoliateContent | null {
  const contents = rendererRef?.getContents?.()
  if (!contents?.length) return null
  const rangeDoc = range.commonAncestorContainer.ownerDocument
  return contents.find((content) => content.doc === rangeDoc) ?? contents[0] ?? null
}

function getOverlayer() {
  return rendererRef?.getContents?.()[0]?.overlayer ?? null
}

function applyHighlight(range: Range) {
  try {
    const content = getContentForRange(range)
    const overlayer = content?.overlayer ?? getOverlayer()
    if (!overlayer) return
    const ctor = overlayer.constructor as
      | {
          ttsPlayback?: (rects: DOMRectList, options?: { color?: string }) => Element
          highlight?: (rects: DOMRectList, options?: { color?: string }) => Element
        }
      | undefined
    const draw = ctor?.ttsPlayback ?? ctor?.highlight ?? drawHighlight
    overlayer.remove(TTS_HIGHLIGHT_KEY)
    overlayer.add(TTS_HIGHLIGHT_KEY, range, draw as (rects: DOMRectList, opts: unknown) => Element, {
      color: TTS_HIGHLIGHT_COLOR,
    })
  } catch {
    // Overlayer may not be attached yet on first sentence; safe to ignore
  }
}

function clearHighlight() {
  try {
    const contents = rendererRef?.getContents?.() ?? []
    for (const content of contents) content.overlayer?.remove(TTS_HIGHLIGHT_KEY)
  } catch {
    // Ignore — overlayer may have been torn down already
  }
}

function ssmlToPlainText(ssml: string): string {
  return ssml
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
}

export function useFoliateTts() {
  function setFoliateSource(_doc: Document, viewEl: HTMLElement, highlightCallback: (range: Range) => void) {
    ttsInstance = null
    foliateReady.value = false
    cachedVisibleRange = null
    startAnchorRange = null

    // Remove previous relocate listener
    relocateCleanup?.()
    const onRelocate = (evt: Event) => {
      const range = (evt as CustomEvent).detail?.range as Range | undefined
      if (range) cachedVisibleRange = range
    }
    viewEl.addEventListener('relocate', onRelocate)
    relocateCleanup = () => viewEl.removeEventListener('relocate', onRelocate)

    const setup = async () => {
      try {
        const foliateView = viewEl as FoliateViewElement
        foliateViewRef = foliateView
        rendererRef = foliateView.renderer ?? null

        // Force recreation so initTTS does not reuse a stale callback for the same doc.
        foliateView.tts = undefined
        await foliateView.initTTS?.('sentence', (range: Range) => {
          highlightedRange = range.cloneRange()
          applyHighlight(range)
          highlightCallback(range)
        })

        const tts = foliateView.tts
        if (!tts) throw new Error('Failed to initialize foliate TTS')
        foliateView.tts = tts
        ttsInstance = tts
        foliateReady.value = true
      } catch {
        foliateReady.value = false
      }
    }
    void setup()
  }

  function clearFoliateSource() {
    clearHighlight()
    relocateCleanup?.()
    relocateCleanup = null
    ttsInstance = null
    rendererRef = null
    foliateViewRef = null
    cachedVisibleRange = null
    startAnchorRange = null
    highlightedRange = null
    foliateReady.value = false
  }

  function getVisibleRange(): Range | null {
    return cachedVisibleRange
  }

  function clearStartAnchor() {
    startAnchorRange = null
  }

  function getFirstBlock(): string | null {
    if (!ttsInstance) return null
    const ssml = ttsInstance.start()
    return ssml ? ssmlToPlainText(ssml) : null
  }

  function getNextBlock(): string | null {
    if (!ttsInstance) return null
    const ssml = ttsInstance.next()
    return ssml ? ssmlToPlainText(ssml) : null
  }

  function getPrevBlock(): string | null {
    if (!ttsInstance) return null
    const ssml = ttsInstance.prev()
    return ssml ? ssmlToPlainText(ssml) : null
  }

  function startFromRange(range: Range): string | null {
    if (!ttsInstance) return null
    const anchoredRange = range.cloneRange()
    // Keep a dedicated one-shot anchor for highlight sync used by
    // "read/play from here", separate from relocate-driven visible range.
    startAnchorRange = anchoredRange.cloneRange()
    cachedVisibleRange = anchoredRange.cloneRange()
    const ssml = ttsInstance.from(anchoredRange)
    return ssml ? ssmlToPlainText(ssml) : null
  }

  function setMark(mark: string) {
    ttsInstance?.setMark(mark)
  }

  function ensureHighlightVisible() {
    if (!rendererRef || !highlightedRange) return
    try {
      void rendererRef.scrollToAnchor?.(highlightedRange.cloneRange(), true)
    } catch {
      // Ignore — range can become stale while chapter is being redrawn.
    }
  }

  function advanceHighlight() {
    if (!ttsInstance) return
    ttsInstance.next(true)
    ensureHighlightVisible()
  }

  function retreatHighlight() {
    if (!ttsInstance) return
    ttsInstance.prev(true)
    ensureHighlightVisible()
  }

  function resetHighlightToStart() {
    if (!ttsInstance) return
    ttsInstance.start()
    // Mark names are block-local and start from "0"; this highlights the first
    // sentence in the active block without advancing to the next block.
    ttsInstance.setMark('0')
  }

  function resetHighlightToVisibleRange() {
    if (!ttsInstance) return
    const range = startAnchorRange ?? cachedVisibleRange
    if (!range) {
      resetHighlightToStart()
      return
    }
    try {
      ttsInstance.from(range.cloneRange())
      ttsInstance.setMark('0')
      // Consume the anchor after first successful alignment.
      startAnchorRange = null
    } catch {
      // Fallback for stale ranges (e.g. doc replaced before a relocate update).
      resetHighlightToStart()
    }
  }

  function syncHighlightAtBlockStart(preferVisibleRange = false) {
    if (!ttsInstance) return
    if (preferVisibleRange && cachedVisibleRange) {
      resetHighlightToVisibleRange()
      return
    }
    resetHighlightToStart()
  }

  function syncHighlightToBlockIndex(blockIndex: number, preferVisibleRange = false) {
    if (!ttsInstance) return
    if (blockIndex <= 0 || (preferVisibleRange && cachedVisibleRange)) {
      syncHighlightAtBlockStart(preferVisibleRange)
      return
    }
    resetHighlightToStart()
    for (let i = 0; i < blockIndex; i++) {
      ttsInstance.next(true)
    }
  }

  function showResumeHighlightFromCfi(cfi: string): boolean {
    if (!ttsInstance || !foliateViewRef || !cfi || /^tts:\d+:\d+$/.test(cfi)) return false
    const resolved = foliateViewRef.resolveCFI?.(cfi)
    const index = resolved?.index
    const anchor = resolved?.anchor
    if (typeof index !== 'number' || typeof anchor !== 'function') return false
    const content = rendererRef?.getContents?.()?.find((x) => x.index === index)
    if (!content?.doc) return false
    try {
      const range = anchor(content.doc)
      startAnchorRange = range.cloneRange()
      syncHighlightAtBlockStart(true)
      return true
    } catch {
      return false
    }
  }

  function showResumeHighlightFromBlock(chapterIndex: number, blockIndex: number, currentChapterIndex: number): boolean {
    if (!ttsInstance) return false
    if (chapterIndex !== currentChapterIndex) return false
    syncHighlightToBlockIndex(Math.max(0, blockIndex), false)
    return true
  }

  async function getServerTextBlocks(bookFileId: number, chapterIndex: number): Promise<string[]> {
    const chapterText = await ttsApi.getChapterText(bookFileId, chapterIndex)
    return chapterText.sentences.map((s) => s.text)
  }

  return {
    foliateReady,
    setFoliateSource,
    clearFoliateSource,
    getVisibleRange,
    clearStartAnchor,
    getFirstBlock,
    getNextBlock,
    getPrevBlock,
    startFromRange,
    setMark,
    advanceHighlight,
    retreatHighlight,
    resetHighlightToStart,
    syncHighlightAtBlockStart,
    syncHighlightToBlockIndex,
    showResumeHighlightFromCfi,
    showResumeHighlightFromBlock,
    clearHighlight,
    getServerTextBlocks,
  }
}
