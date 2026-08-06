import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useWakeLock } from '../useWakeLock'

function mountWithWakeLock() {
  const wrapper = mount(
    defineComponent({
      setup() {
        useWakeLock()
        return {}
      },
      template: '<div />',
    }),
  )
  return wrapper
}

describe('useWakeLock', () => {
  let releaseFn: ReturnType<typeof vi.fn>
  let addEventListenerSpy: ReturnType<typeof vi.fn>
  let requestFn: ReturnType<typeof vi.fn>
  let docAddEventListenerSpy: ReturnType<typeof vi.spyOn>
  let docRemoveEventListenerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    releaseFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    addEventListenerSpy = vi.fn<(type: string, listener: EventListenerOrEventListenerObject) => void>()
    requestFn = vi.fn<() => Promise<{ release: typeof releaseFn; addEventListener: typeof addEventListenerSpy }>>().mockResolvedValue({
      release: releaseFn,
      addEventListener: addEventListenerSpy,
    })

    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: requestFn },
      writable: true,
      configurable: true,
    })

    docAddEventListenerSpy = vi.spyOn(document, 'addEventListener')
    docRemoveEventListenerSpy = vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('acquires wake lock on mount', async () => {
    mountWithWakeLock()

    await vi.waitFor(() => {
      expect(requestFn).toHaveBeenCalledWith('screen')
    })
  })

  it('registers visibilitychange listener on mount', () => {
    mountWithWakeLock()

    expect(docAddEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  it('releases wake lock on unmount', async () => {
    const wrapper = mountWithWakeLock()
    await vi.waitFor(() => expect(requestFn).toHaveBeenCalled())

    wrapper.unmount()

    expect(releaseFn).toHaveBeenCalled()
    expect(docRemoveEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  it('handles missing wakeLock API gracefully', () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    expect(() => mountWithWakeLock()).not.toThrow()
  })

  it('handles rejected wake lock request gracefully', async () => {
    requestFn.mockRejectedValueOnce(new Error('Not allowed'))

    expect(() => mountWithWakeLock()).not.toThrow()
    await vi.waitFor(() => expect(requestFn).toHaveBeenCalled())
  })
})
