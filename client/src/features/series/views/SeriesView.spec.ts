import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { CompletionStatus, SeriesListSort, SortDirection } from '../types/series'
import SeriesView from './SeriesView.vue'
import SeriesFilters from '../components/SeriesFilters.vue'

class MockIntersectionObserver {
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn<() => void>()
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => [])
}

const mocks = vi.hoisted(() => ({
  route: { params: {} as Record<string, string>, query: {} as Record<string, unknown>, fullPath: '/series' },
  routerPush: vi.fn<(to: unknown) => Promise<void>>(),
  routerReplace: vi.fn<(to: unknown) => Promise<void>>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
  load: vi.fn<(reset?: boolean) => Promise<void>>(),
  q: null as unknown as { value: string },
  sort: null as unknown as { value: SeriesListSort },
  order: null as unknown as { value: SortDirection },
  libraryId: null as unknown as { value: number | null },
  completionStatus: null as unknown as { value: CompletionStatus | null },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.routerPush, replace: mocks.routerReplace }),
}))

vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => ({ viewMode: ref('grid') }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]), fetchLibraries: mocks.fetchLibraries }),
}))

vi.mock('../composables/useSeriesList', () => ({
  useSeriesList: () => ({
    items: ref([]),
    total: ref(0),
    loading: ref(false),
    error: ref(null),
    hasMore: ref(false),
    q: mocks.q,
    sort: mocks.sort,
    order: mocks.order,
    libraryId: mocks.libraryId,
    completionStatus: mocks.completionStatus,
    load: mocks.load,
  }),
}))

vi.mock('@/services/storage', () => ({
  storage: {
    get: (_key: string, fallback: unknown) => fallback,
    set: vi.fn<(key: string, value: unknown) => void>(),
    remove: vi.fn<(key: string) => void>(),
  },
}))

async function mountView() {
  const wrapper = shallowMount(SeriesView)
  await flushPromises()
  return wrapper
}

describe('SeriesView filters panel placement', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    mocks.route.query = {}
    mocks.routerPush.mockResolvedValue()
    mocks.routerReplace.mockResolvedValue()
    mocks.fetchLibraries.mockResolvedValue()
    mocks.load.mockResolvedValue()
    mocks.q = ref('')
    mocks.sort = ref('name')
    mocks.order = ref('asc')
    mocks.libraryId = ref(null)
    mocks.completionStatus = ref(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders the desktop filters panel outside the scrolling <main> so it stays anchored when scrolled', async () => {
    // An active filter from the route opens the panel on mount (activeFilterCount > 0).
    mocks.route.query = { libraryId: '5' }
    const wrapper = await mountView()

    const main = wrapper.find('main')
    expect(main.exists()).toBe(true)

    const filters = wrapper.findComponent(SeriesFilters)
    expect(filters.exists()).toBe(true)
    // Regression guard for #326: the panel must NOT live inside the scroll container.
    expect(filters.element.closest('main')).toBeNull()
  })

  it('does not render the desktop filters panel when no filter is active', async () => {
    mocks.route.query = {}
    const wrapper = await mountView()

    expect(wrapper.findComponent(SeriesFilters).exists()).toBe(false)
  })
})
