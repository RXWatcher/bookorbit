import { flushPromises } from '@vue/test-utils'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMetadataFetchConditions } from '@bookorbit/types'
import { invalidateEligibleCountPreviews, useEligibleCountPreview } from './useEligibleCountPreview'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function response(count: number) {
  return {
    ok: true,
    json: async () => ({ count }),
  }
}

function makeConditions(threshold: number): BookMetadataFetchConditions {
  return {
    neverFetched: { enabled: false },
    scoreThreshold: { enabled: true, threshold },
    missingFields: { enabled: false, fields: [] },
  }
}

describe('useEligibleCountPreview', () => {
  let scope: EffectScope

  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  it('ignores stale in-flight count responses after conditions change', async () => {
    const first = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const second = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    apiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const conditions = ref(makeConditions(70))
    const preview = scope.run(() => useEligibleCountPreview(conditions))!

    await vi.advanceTimersByTimeAsync(400)
    expect(apiMock).toHaveBeenCalledTimes(1)

    conditions.value = makeConditions(45)
    await nextTick()
    first.resolve(response(12))
    await flushPromises()

    expect(preview.count.value).toBeNull()

    await vi.advanceTimersByTimeAsync(400)
    second.resolve(response(8))
    await flushPromises()

    expect(preview.count.value).toBe(8)
  })

  it('refreshes all previews when invalidated', async () => {
    apiMock.mockResolvedValue(response(3))
    const conditions = ref(makeConditions(70))

    scope.run(() => useEligibleCountPreview(conditions, 5))
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    invalidateEligibleCountPreviews()
    await nextTick()
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(2)
    const secondCall = apiMock.mock.calls[1]
    expect(secondCall).toBeDefined()
    const [, init] = secondCall as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      libraryId: 5,
      conditions: {
        scoreThreshold: { threshold: 70 },
      },
    })
  })

  it('clears count without fetching when conditions are unavailable', async () => {
    const conditions = ref<BookMetadataFetchConditions | null>(null)
    const preview = scope.run(() => useEligibleCountPreview(conditions))!

    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect(preview.count.value).toBeNull()
    expect(preview.loading.value).toBe(false)
  })
})
