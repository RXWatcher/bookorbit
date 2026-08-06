import { onUnmounted, ref, type Ref } from 'vue'
import type { BookCard, ScanBooksAddedEvent } from '@bookorbit/types'
import { getSocket } from './useScanProgress'

const HARD_MAX_WAIT_MS = 1000
const EWMA_ALPHA = 0.35
const FAST_ENTER_GAP_MS = 250
const SLOW_ENTER_GAP_MS = 600
const MODE_SWITCH_STREAK = 2

const FAST_POLICY = { maxWaitMs: 800, maxBatchSize: 12 } as const
const SLOW_POLICY = { maxWaitMs: 200, maxBatchSize: 1 } as const
const ANIMATION_DURATION_MS = 400
const ANIMATE_BATCH_LIMIT = 6

export function useLiveScanBooks(libraryId: Ref<number | null>, existingBooks: Ref<BookCard[]>, total?: Ref<number>) {
  const newBookIds = ref(new Set<number>())

  let buffer: BookCard[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushDeadlineAt: number | null = null
  let bufferStartedAt: number | null = null
  let handler: ((event: ScanBooksAddedEvent) => void) | null = null
  let mode: 'fast' | 'slow' = 'slow'
  let lastEventAt: number | null = null
  let avgGapMs: number | null = null
  let fastSignalStreak = 0
  let slowSignalStreak = 0

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushDeadlineAt = null
    bufferStartedAt = null
    if (buffer.length === 0) return

    const batch = buffer
    buffer = []

    const batchById = new Map(batch.map((b) => [b.id, b]))
    const existingIdSet = new Set(existingBooks.value.map((b) => b.id))

    const newBooks = batch.filter((b) => !existingIdSet.has(b.id))
    const hasUpdates = batch.some((b) => existingIdSet.has(b.id))

    if (newBooks.length === 0 && !hasUpdates) return

    let updated = existingBooks.value
    if (hasUpdates) {
      updated = existingBooks.value.map((b) => batchById.get(b.id) ?? b)
    }

    existingBooks.value = newBooks.length > 0 ? [...newBooks, ...updated] : updated
    if (newBooks.length > 0 && total) total.value += newBooks.length

    if (newBooks.length > 0 && newBooks.length <= ANIMATE_BATCH_LIMIT) {
      const ids = new Set(newBooks.map((b) => b.id))
      newBookIds.value = new Set([...newBookIds.value, ...ids])
      setTimeout(() => {
        const current = new Set(newBookIds.value)
        for (const id of ids) current.delete(id)
        newBookIds.value = current
      }, ANIMATION_DURATION_MS)
    }
  }

  function currentPolicy() {
    return mode === 'fast' ? FAST_POLICY : SLOW_POLICY
  }

  function updateMode(now: number) {
    if (lastEventAt === null) {
      lastEventAt = now
      return
    }

    const gapMs = now - lastEventAt
    lastEventAt = now
    avgGapMs = avgGapMs === null ? gapMs : avgGapMs * (1 - EWMA_ALPHA) + gapMs * EWMA_ALPHA

    if (avgGapMs <= FAST_ENTER_GAP_MS) {
      fastSignalStreak += 1
      slowSignalStreak = 0
    } else if (avgGapMs >= SLOW_ENTER_GAP_MS) {
      slowSignalStreak += 1
      fastSignalStreak = 0
    } else {
      fastSignalStreak = 0
      slowSignalStreak = 0
    }

    if (mode === 'slow' && fastSignalStreak >= MODE_SWITCH_STREAK) {
      mode = 'fast'
      fastSignalStreak = 0
      slowSignalStreak = 0
      return
    }

    if (mode === 'fast' && slowSignalStreak >= MODE_SWITCH_STREAK) {
      mode = 'slow'
      fastSignalStreak = 0
      slowSignalStreak = 0
    }
  }

  function scheduleFlush(now: number) {
    if (buffer.length === 0) return
    if (bufferStartedAt === null) {
      bufferStartedAt = now
    }
    const elapsedMs = now - bufferStartedAt
    const hardRemainingMs = HARD_MAX_WAIT_MS - elapsedMs
    if (hardRemainingMs <= 0) {
      flush()
      return
    }

    const waitMs = Math.min(currentPolicy().maxWaitMs, hardRemainingMs)
    const desiredDeadline = now + waitMs

    if (!flushTimer) {
      flushDeadlineAt = desiredDeadline
      flushTimer = setTimeout(flush, waitMs)
      return
    }

    if (flushDeadlineAt === null || desiredDeadline < flushDeadlineAt) {
      clearTimeout(flushTimer)
      flushDeadlineAt = desiredDeadline
      flushTimer = setTimeout(flush, waitMs)
    }
  }

  function onBooksAdded(event: ScanBooksAddedEvent) {
    if (event.libraryId !== libraryId.value) return
    const now = Date.now()
    updateMode(now)
    if (buffer.length === 0) {
      bufferStartedAt = now
    }
    buffer.push(...event.books)

    if (buffer.length >= currentPolicy().maxBatchSize) {
      flush()
      return
    }
    scheduleFlush(now)
  }

  function start() {
    if (handler) return
    handler = onBooksAdded
    getSocket().on('scan:books:added', handler)
  }

  function stop() {
    if (handler) {
      getSocket().off('scan:books:added', handler)
      handler = null
    }
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushDeadlineAt = null
    bufferStartedAt = null
    buffer = []
    newBookIds.value = new Set()
    mode = 'slow'
    lastEventAt = null
    avgGapMs = null
    fastSignalStreak = 0
    slowSignalStreak = 0
  }

  onUnmounted(stop)

  return { newBookIds, start, stop }
}
