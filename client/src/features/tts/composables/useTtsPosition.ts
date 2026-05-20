import { ref } from 'vue'
import * as ttsApi from '../api/tts.api'
import type { TtsPosition } from '../api/tts.api'

const SAVE_DEBOUNCE_MS = 5000

export function useTtsPosition() {
  const savedPosition = ref<TtsPosition | null>(null)
  const hasSavedPosition = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function loadPosition(bookFileId: number) {
    try {
      savedPosition.value = await ttsApi.getPosition(bookFileId)
      hasSavedPosition.value = savedPosition.value !== null
    } catch {
      savedPosition.value = null
      hasSavedPosition.value = false
    }
  }

  function scheduleSave(bookFileId: number, cfi: string, chapterIndex: number | null) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void savePositionNow(bookFileId, cfi, chapterIndex)
    }, SAVE_DEBOUNCE_MS)
  }

  async function savePositionNow(bookFileId: number, cfi: string, chapterIndex: number | null) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      await ttsApi.savePosition(bookFileId, { cfi, chapterIndex })
      savedPosition.value = { cfi, chapterIndex }
      hasSavedPosition.value = true
    } catch {
      // position save failure is non-fatal
    }
  }

  async function clearPosition(bookFileId: number) {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await ttsApi.deletePosition(bookFileId)
    savedPosition.value = null
    hasSavedPosition.value = false
  }

  function cleanup() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  return {
    savedPosition,
    hasSavedPosition,
    loadPosition,
    scheduleSave,
    savePositionNow,
    clearPosition,
    cleanup,
  }
}
