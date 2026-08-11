import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useReadingSession } from '../useReadingSession'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('useReadingSession - elapsedMinutes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    apiMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts elapsedMinutes at 0', () => {
    const { elapsedMinutes } = useReadingSession(1, () => ({ percentage: 0 }))
    expect(elapsedMinutes.value).toBe(0)
  })

  it('updates elapsedMinutes after onActivity and elapsed time', async () => {
    const { onActivity, elapsedMinutes } = useReadingSession(1, () => ({ percentage: 10 }))

    onActivity()
    expect(elapsedMinutes.value).toBe(0)

    // Advance 2 minutes
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    onActivity()

    // After the 30-second interval update
    await vi.advanceTimersByTimeAsync(30 * 1000)

    expect(elapsedMinutes.value).toBeGreaterThanOrEqual(2)
  })

  it('resets elapsedMinutes to 0 when session ends', async () => {
    const { onActivity, elapsedMinutes, endSession } = useReadingSession(1, () => ({ percentage: 10 }))

    onActivity()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    onActivity()
    await vi.advanceTimersByTimeAsync(30 * 1000)

    expect(elapsedMinutes.value).toBeGreaterThanOrEqual(1)

    endSession()
    expect(elapsedMinutes.value).toBe(0)
  })

  it('pauses elapsed tracking when visibility is hidden', async () => {
    const { onActivity, elapsedMinutes } = useReadingSession(1, () => ({ percentage: 10 }))

    onActivity()
    await vi.advanceTimersByTimeAsync(60 * 1000)

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    const elapsed1 = elapsedMinutes.value

    // Time passes while hidden
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    // Elapsed should not have increased significantly (only from the interval that ran before pause)
    expect(elapsedMinutes.value).toBeLessThanOrEqual(elapsed1 + 1)

    // Restore visibility
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  it('starts a new session after idle timeout', async () => {
    const { onActivity, elapsedMinutes } = useReadingSession(1, () => ({ percentage: 10 }))

    onActivity()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    onActivity()
    await vi.advanceTimersByTimeAsync(30 * 1000)

    const elapsed = elapsedMinutes.value
    expect(elapsed).toBeGreaterThanOrEqual(1)

    // Wait for idle timeout (5 minutes)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)

    // After idle timeout, session ends, elapsedMinutes resets
    expect(elapsedMinutes.value).toBe(0)

    // New activity starts a new session
    onActivity()
    expect(elapsedMinutes.value).toBe(0)
  })

  it('does not track elapsed time or save sessions when tracking is disabled', async () => {
    const trackingEnabled = ref(false)
    const { onActivity, elapsedMinutes, endSession } = useReadingSession(1, () => ({ percentage: 10 }), { trackingEnabled })

    onActivity()
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    endSession()

    expect(elapsedMinutes.value).toBe(0)
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('uses a custom session saver instead of the local file session endpoint', async () => {
    const saveSession = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const { onActivity, endSession } = useReadingSession(0, () => ({ percentage: 42 }), { saveSession })

    onActivity()
    await vi.advanceTimersByTimeAsync(15 * 1000)
    endSession()

    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 15,
        endProgress: 42,
      }),
      { useBeacon: false },
    )
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/books/files/0/sessions', expect.anything())
  })
})
