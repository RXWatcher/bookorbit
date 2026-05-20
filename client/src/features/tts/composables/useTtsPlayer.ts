import { ref, shallowRef } from 'vue'
import type { TtsPlaybackState } from '@bookorbit/types'
import * as ttsApi from '../api/tts.api'
import { useTtsPosition } from './useTtsPosition'
import { useTtsMediaSession } from './useTtsMediaSession'
import { useTtsSleepTimer } from './useTtsSleepTimer'
import { useTtsReadingSession } from './useTtsReadingSession'
import type { TtsCurrentBook, TtsAudioBlock } from '../lib/tts-state'

const PREFETCH_AHEAD = 3
const MIN_SPEED = 0.25
const MAX_SPEED = 4.0
const SPEED_STEP = 0.25

type TextSourceFn = (chapterIndex: number) => Promise<string[]>

const playbackState = ref<TtsPlaybackState>('idle')
const currentBook = ref<TtsCurrentBook | null>(null)
const currentBlockIndex = ref(0)
const currentChapterIndex = ref(0)
const speed = ref(1.0)
const error = ref<string | null>(null)
const isActive = ref(false)
const currentProviderId = ref('')
const currentVoiceId = ref('')

const audioQueue = shallowRef<TtsAudioBlock[]>([])
let currentAudio: HTMLAudioElement | null = null
let getTextBlocks: TextSourceFn | null = null
let chapterBlocks: string[] = []
const pendingPrefetches = new Set<number>()
let objectUrls: string[] = []
let prefetchGeneration = 0

const positionComposable = useTtsPosition()
const mediaSession = useTtsMediaSession()
const readingSession = useTtsReadingSession()

function queueCurrentPositionSave(blockIdx = currentBlockIndex.value) {
  if (!currentBook.value) return
  positionComposable.scheduleSave(currentBook.value.bookFileId, `tts:${currentChapterIndex.value}:${blockIdx}`, currentChapterIndex.value)
}

function flushCurrentPositionSave() {
  queueCurrentPositionSave()
  void positionComposable.flushPendingSave()
}

function pausePlayback() {
  if (currentAudio) currentAudio.pause()
  playbackState.value = 'paused'
  mediaSession.setPlaybackState('paused')
  flushCurrentPositionSave()
}

const sleepTimer = useTtsSleepTimer(pausePlayback)

export function useTtsPlayer() {
  async function startPlayback(
    book: TtsCurrentBook,
    providerId: string,
    voiceId: string,
    spd: number,
    textSource: TextSourceFn,
    startChapter = 0,
    startBlock = 0,
  ) {
    stopPlayback()
    currentBook.value = book
    currentProviderId.value = providerId
    currentVoiceId.value = voiceId
    speed.value = spd
    currentChapterIndex.value = startChapter
    currentBlockIndex.value = Math.max(0, startBlock)
    getTextBlocks = textSource
    isActive.value = true
    playbackState.value = 'loading'
    error.value = null

    mediaSession.setMetadata(book)
    mediaSession.registerHandlers({
      play: resumePlayback,
      pause: pausePlayback,
      previoustrack: prevBlock,
      nexttrack: nextBlock,
      stop: stopPlayback,
    })
    readingSession.startSession()

    try {
      chapterBlocks = await textSource(startChapter)
      if (chapterBlocks.length === 0) {
        await advanceChapter()
      } else {
        await fetchAndPlay(startBlock)
      }
    } catch (err) {
      handleError(err)
    }
  }

  async function fetchAndPlay(blockIdx: number) {
    if (!currentBook.value) return
    playbackState.value = 'loading'
    const text = chapterBlocks[blockIdx]
    if (!text) {
      await advanceChapter()
      return
    }
    try {
      const audioBlob = await fetchAudio(text)
      playAudioBlob(audioBlob, blockIdx)
      prefetchAhead(blockIdx)
    } catch (err) {
      handleError(err)
    }
  }

  async function fetchAudio(text: string): Promise<Blob> {
    const res = await ttsApi.synthesize({
      text,
      voiceId: currentVoiceId.value,
      providerId: currentProviderId.value,
      speed: speed.value,
      format: 'mp3',
    })
    if (!res.ok) throw new Error(`Synthesis failed: ${res.status}`)
    return res.blob()
  }

  function playAudioBlob(blob: Blob, blockIdx: number) {
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    const url = URL.createObjectURL(blob)
    objectUrls.push(url)
    const audio = new Audio(url)
    audio.onended = () => {
      URL.revokeObjectURL(url)
      objectUrls = objectUrls.filter((u) => u !== url)
      void onBlockEnded(blockIdx)
    }
    audio.onerror = () => handleError(new Error('Audio playback error'))
    currentAudio = audio
    currentBlockIndex.value = blockIdx
    playbackState.value = 'playing'
    mediaSession.setPlaybackState('playing')
    void audio.play().catch(handleError)
    queueCurrentPositionSave(blockIdx)
  }

  async function onBlockEnded(blockIdx: number) {
    if (playbackState.value !== 'playing') return
    const next = blockIdx + 1
    if (next < chapterBlocks.length) {
      const prefetched = audioQueue.value.find((b) => b.chapterIndex === currentChapterIndex.value && b.index === next)
      if (prefetched?.audioBlob) {
        playAudioBlob(prefetched.audioBlob, next)
        audioQueue.value = audioQueue.value.filter((b) => !(b.chapterIndex === currentChapterIndex.value && b.index === next))
        prefetchAhead(next)
      } else {
        await fetchAndPlay(next)
      }
    } else {
      await advanceChapter()
    }
  }

  function prefetchAhead(currentIdx: number) {
    const gen = prefetchGeneration
    for (let i = 1; i <= PREFETCH_AHEAD; i++) {
      const idx = currentIdx + i
      if (idx >= chapterBlocks.length) break
      if (pendingPrefetches.has(idx)) continue
      if (audioQueue.value.some((b) => b.chapterIndex === currentChapterIndex.value && b.index === idx)) continue
      pendingPrefetches.add(idx)
      const text = chapterBlocks[idx]
      if (!text) continue
      fetchAudio(text)
        .then((blob) => {
          pendingPrefetches.delete(idx)
          if (prefetchGeneration !== gen) return
          audioQueue.value = [...audioQueue.value, { index: idx, text, chapterIndex: currentChapterIndex.value, audioBlob: blob, audioUrl: null }]
        })
        .catch(() => pendingPrefetches.delete(idx))
    }
  }

  async function advanceChapter() {
    if (!currentBook.value) return
    const next = currentChapterIndex.value + 1
    if (next >= currentBook.value.totalChapters) {
      stopPlayback()
      return
    }
    currentChapterIndex.value = next
    currentBlockIndex.value = 0
    prefetchGeneration++
    audioQueue.value = []
    pendingPrefetches.clear()
    if (!getTextBlocks) return
    chapterBlocks = await getTextBlocks(next)
    if (chapterBlocks.length > 0) {
      await fetchAndPlay(0)
    } else {
      await advanceChapter()
    }
  }

  function resumePlayback() {
    if (currentAudio && playbackState.value === 'paused') {
      void currentAudio.play()
      playbackState.value = 'playing'
      mediaSession.setPlaybackState('playing')
    }
  }

  function stopPlayback() {
    flushCurrentPositionSave()
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    for (const url of objectUrls) URL.revokeObjectURL(url)
    objectUrls = []
    prefetchGeneration++
    audioQueue.value = []
    pendingPrefetches.clear()
    chapterBlocks = []
    getTextBlocks = null
    if (currentBook.value && readingSession.sessionId.value) {
      void readingSession.endSession({
        bookFileId: currentBook.value.bookFileId,
        endedAt: new Date(),
        durationSeconds: 0,
        progressDelta: null,
        endProgress: null,
      })
    }
    mediaSession.clearHandlers()
    mediaSession.setPlaybackState('none')
    isActive.value = false
    playbackState.value = 'idle'
    currentBook.value = null
    currentProviderId.value = ''
    currentVoiceId.value = ''
    error.value = null
  }

  async function nextBlock() {
    if (!isActive.value) return
    flushCurrentPositionSave()
    const next = currentBlockIndex.value + 1
    if (next < chapterBlocks.length) {
      if (currentAudio) currentAudio.pause()
      await fetchAndPlay(next)
    } else {
      await advanceChapter()
    }
  }

  async function prevBlock() {
    if (!isActive.value) return
    flushCurrentPositionSave()
    const prev = Math.max(0, currentBlockIndex.value - 1)
    if (currentAudio) currentAudio.pause()
    await fetchAndPlay(prev)
  }

  function togglePlayPause() {
    if (playbackState.value === 'playing') pausePlayback()
    else if (playbackState.value === 'paused') resumePlayback()
  }

  function setSpeed(newSpeed: number) {
    const nextSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, newSpeed))
    if (nextSpeed === speed.value) return
    speed.value = nextSpeed
    prefetchGeneration++
    audioQueue.value = []
    pendingPrefetches.clear()
  }

  function setVoice(providerId: string, voiceId: string) {
    currentProviderId.value = providerId
    currentVoiceId.value = voiceId
    prefetchGeneration++
    audioQueue.value = []
    pendingPrefetches.clear()
  }

  function increaseSpeed() {
    setSpeed(Math.round((speed.value + SPEED_STEP) * 100) / 100)
  }

  function decreaseSpeed() {
    setSpeed(Math.round((speed.value - SPEED_STEP) * 100) / 100)
  }

  function handleError(err: unknown) {
    flushCurrentPositionSave()
    const message = err instanceof Error ? err.message : 'TTS error'
    error.value = message
    playbackState.value = 'error'
    mediaSession.setPlaybackState('none')
  }

  async function startFromPosition(chapterIndex: number, blockIndex: number) {
    if (!currentBook.value || !getTextBlocks) return
    if (chapterIndex !== currentChapterIndex.value) {
      currentChapterIndex.value = chapterIndex
      chapterBlocks = await getTextBlocks(chapterIndex)
    }
    if (currentAudio) currentAudio.pause()
    await fetchAndPlay(blockIndex)
  }

  return {
    playbackState,
    currentBook,
    currentBlockIndex,
    currentChapterIndex,
    speed,
    currentProviderId,
    currentVoiceId,
    error,
    isActive,
    sleepTimer,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    nextBlock,
    prevBlock,
    togglePlayPause,
    setSpeed,
    setVoice,
    increaseSpeed,
    decreaseSpeed,
    startFromPosition,
  }
}
