import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInfiniteScrollSentinel } from '../useInfiniteScrollSentinel'

const observeMock = vi.fn<(element: Element) => void>()
const unobserveMock = vi.fn<(element: Element) => void>()
const disconnectMock = vi.fn<() => void>()

class MockIntersectionObserver {
  observe = observeMock
  unobserve = unobserveMock
  disconnect = disconnectMock

  constructor() {}
}

describe('useInfiniteScrollSentinel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  it('observes a sentinel that appears after mount', async () => {
    const showSentinel = ref(false)
    const loadMore = vi.fn<() => void>()

    const Harness = defineComponent({
      setup() {
        const { sentinel } = useInfiniteScrollSentinel({
          hasMore: ref(true),
          loading: ref(false),
          loadMore,
        })

        return () => (showSentinel.value ? h('div', { ref: sentinel, 'data-testid': 'sentinel' }) : h('div'))
      },
    })

    mount(Harness)
    expect(observeMock).not.toHaveBeenCalled()

    showSentinel.value = true
    await nextTick()
    await nextTick()

    expect(observeMock).toHaveBeenCalledTimes(1)
    expect(observeMock.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement)
  })
})
