import { ref } from 'vue'
import * as ttsApi from '../api/tts.api'

interface FoliateTTSInstance {
  start(): string | null
  prev(paused?: boolean): string | null
  next(paused?: boolean): string | null
  from(range: Range): string | null
  setMark(mark: string): void
}

interface FoliateViewElement extends HTMLElement {
  initTTS?: (granularity?: string, highlight?: (range: Range) => void) => Promise<void>
  tts?: FoliateTTSInstance
}

const foliateReady = ref(false)
let ttsInstance: FoliateTTSInstance | null = null

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

    const loadTts = async () => {
      try {
        const foliateView = viewEl as FoliateViewElement
        if (!foliateView.initTTS) return
        await foliateView.initTTS('sentence', highlightCallback)
        ttsInstance = foliateView.tts ?? null
        foliateReady.value = ttsInstance !== null
      } catch {
        foliateReady.value = false
      }
    }
    void loadTts()
  }

  function clearFoliateSource() {
    ttsInstance = null
    foliateReady.value = false
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
    const ssml = ttsInstance.from(range)
    return ssml ? ssmlToPlainText(ssml) : null
  }

  function setMark(mark: string) {
    ttsInstance?.setMark(mark)
  }

  async function getServerTextBlocks(bookFileId: number, chapterIndex: number): Promise<string[]> {
    const chapterText = await ttsApi.getChapterText(bookFileId, chapterIndex)
    return chapterText.sentences.map((s) => s.text)
  }

  return {
    foliateReady,
    setFoliateSource,
    clearFoliateSource,
    getFirstBlock,
    getNextBlock,
    getPrevBlock,
    startFromRange,
    setMark,
    getServerTextBlocks,
  }
}
