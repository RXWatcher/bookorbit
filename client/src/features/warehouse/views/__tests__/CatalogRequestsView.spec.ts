import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type WarehouseAudiobookQueueItem,
  type WarehouseRequestDetail,
  type WarehouseRequestItem,
  type WarehouseRequestListQuery,
} from '@bookorbit/types'
import CatalogRequestsView from '../CatalogRequestsView.vue'
import { visibleRequestCopySnapshot } from '@/features/warehouse/lib/catalog-request-ui'

const push = vi.fn<(to: unknown) => void>()
const resolve = vi.fn<(to: { params?: { id?: number | string; remoteId?: string } }) => { href: string }>((to) => ({
  href: `/library/${encodeURIComponent(String(to.params?.id ?? ''))}/items/${encodeURIComponent(String(to.params?.remoteId ?? ''))}`,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push, resolve }),
}))

type RequestComposable = {
  initialQuery: WarehouseRequestListQuery | null
  current: {
    query: Ref<WarehouseRequestListQuery>
    items: Ref<WarehouseRequestItem[]>
    total: Ref<number>
    currentPage: Ref<number>
    limit: Ref<number>
    loading: Ref<boolean>
    error: Ref<string | null>
    refresh: ReturnType<typeof vi.fn>
    setQuery: ReturnType<typeof vi.fn>
    setPage: ReturnType<typeof vi.fn>
    refreshRequest: ReturnType<typeof vi.fn>
    cancelRequest: ReturnType<typeof vi.fn>
  }
}

type AudiobookComposable = {
  initialQuery: WarehouseRequestListQuery | null
  current: {
    query: Ref<WarehouseRequestListQuery>
    items: Ref<WarehouseRequestItem[]>
    total: Ref<number>
    currentPage: Ref<number>
    limit: Ref<number>
    queueItems: Ref<WarehouseAudiobookQueueItem[]>
    loading: Ref<boolean>
    queueLoading: Ref<boolean>
    refreshingStatuses: Ref<boolean>
    error: Ref<string | null>
    refresh: ReturnType<typeof vi.fn>
    setQuery: ReturnType<typeof vi.fn>
    setPage: ReturnType<typeof vi.fn>
    refreshQueue: ReturnType<typeof vi.fn>
    refreshStatuses: ReturnType<typeof vi.fn>
  }
}

type ComicComposable = {
  initialQuery: WarehouseRequestListQuery | null
  current: {
    query: Ref<WarehouseRequestListQuery>
    items: Ref<WarehouseRequestItem[]>
    total: Ref<number>
    currentPage: Ref<number>
    limit: Ref<number>
    loading: Ref<boolean>
    error: Ref<string | null>
    refresh: ReturnType<typeof vi.fn>
    refreshingStatuses: Ref<boolean>
    refreshStatuses: ReturnType<typeof vi.fn>
    setQuery: ReturnType<typeof vi.fn>
    setPage: ReturnType<typeof vi.fn>
  }
}

const composables = vi.hoisted(() => ({
  ebook: null as unknown as RequestComposable,
  audiobook: null as unknown as AudiobookComposable,
  comic: null as unknown as ComicComposable,
}))

vi.mock('@/features/warehouse/composables/useCatalogSourceRequests', () => ({
  useCatalogSourceRequests: vi.fn<(query: WarehouseRequestListQuery) => RequestComposable['current']>((query) => {
    composables.ebook.initialQuery = query
    return composables.ebook.current
  }),
}))

vi.mock('@/features/warehouse/composables/useCatalogSourceAudiobookRequests', () => ({
  useCatalogSourceAudiobookRequests: vi.fn<(query: WarehouseRequestListQuery) => AudiobookComposable['current']>((query) => {
    composables.audiobook.initialQuery = query
    return composables.audiobook.current
  }),
}))

vi.mock('@/features/warehouse/composables/useCatalogSourceComicRequests', () => ({
  useCatalogSourceComicRequests: vi.fn<(query: WarehouseRequestListQuery) => ComicComposable['current']>((query) => {
    composables.comic.initialQuery = query
    return composables.comic.current
  }),
}))

vi.mock('@/features/warehouse/components/CatalogEbookRequestDialog.vue', () => ({
  default: defineComponent({
    name: 'CatalogEbookRequestDialog',
    props: { open: { type: Boolean, required: true } },
    emits: ['close', 'submitted'],
    setup(props, { emit }) {
      return () =>
        props.open
          ? h('div', { 'data-testid': 'ebook-dialog' }, [
              h('button', { onClick: () => emit('submitted', makeRequest({ id: 901, title: 'Submitted Book' })) }, 'Submit ebook'),
              h('button', { onClick: () => emit('close') }, 'Close ebook'),
            ])
          : null
    },
  }),
}))

vi.mock('@/features/warehouse/components/CatalogAudiobookRequestDialog.vue', () => ({
  default: defineComponent({
    name: 'CatalogAudiobookRequestDialog',
    props: { open: { type: Boolean, required: true } },
    emits: ['close', 'submitted'],
    setup(props, { emit }) {
      return () =>
        props.open
          ? h('div', { 'data-testid': 'audiobook-dialog' }, [
              h(
                'button',
                { onClick: () => emit('submitted', makeRequest({ id: 902, mediaType: 'audiobook', title: 'Submitted Audio' })) },
                'Submit audio',
              ),
              h('button', { onClick: () => emit('close') }, 'Close audio'),
            ])
          : null
    },
  }),
}))

vi.mock('@/features/warehouse/components/CatalogComicRequestDialog.vue', () => ({
  default: defineComponent({
    name: 'CatalogComicRequestDialog',
    props: { open: { type: Boolean, required: true } },
    emits: ['close', 'submitted'],
    setup(props, { emit }) {
      return () =>
        props.open
          ? h('div', { 'data-testid': 'comic-dialog' }, [
              h(
                'button',
                { onClick: () => emit('submitted', makeRequest({ id: 903, mediaType: 'comic', title: 'Submitted Comic' })) },
                'Submit comic',
              ),
              h('button', { onClick: () => emit('close') }, 'Close comic'),
            ])
          : null
    },
  }),
}))

vi.mock('@/features/warehouse/components/CatalogItemQuickView.vue', () => ({
  default: defineComponent({
    name: 'CatalogItemQuickView',
    props: {
      item: { type: Object, default: null },
      open: { type: Boolean, default: false },
    },
    emits: ['update:open'],
    setup(props) {
      return () => h('div', { 'data-testid': 'request-catalog-quick-view', 'data-open': String(props.open) }, props.item?.title ?? '')
    },
  }),
}))

function makeRequest(overrides: Partial<WarehouseRequestDetail> = {}): WarehouseRequestDetail {
  return {
    id: 1,
    mediaType: 'ebook',
    status: 'pending',
    title: 'A Book Request',
    author: 'Ada Author',
    isbn: '9780000000001',
    completedRemoteId: null,
    requestedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
    lastStatusSyncedAt: null,
    requestedPayload: {},
    ...overrides,
  }
}

function makeEbookComposable(items: WarehouseRequestItem[], overrides: Partial<RequestComposable['current']> = {}): RequestComposable {
  const page = ref(1)
  const limit = ref(24)
  const rows = ref(items)
  const query = ref<WarehouseRequestListQuery>({ page: 1, limit: 24 })
  return {
    initialQuery: null,
    current: {
      query,
      items: rows,
      total: ref(items.length),
      currentPage: page,
      limit,
      loading: ref(false),
      error: ref(null),
      refresh: vi.fn<() => void>(),
      setQuery: vi.fn<(nextQuery: WarehouseRequestListQuery) => void>((nextQuery: WarehouseRequestListQuery) => {
        query.value = nextQuery
        page.value = nextQuery.page ?? page.value
        limit.value = nextQuery.limit ?? limit.value
      }),
      setPage: vi.fn<(nextPage: number) => void>((nextPage: number) => {
        page.value = nextPage
      }),
      refreshRequest: vi.fn<() => void>(),
      cancelRequest: vi.fn<() => void>(),
      ...overrides,
    },
  }
}

function makeAudiobookComposable(items: WarehouseRequestItem[], queueItems: WarehouseAudiobookQueueItem[] = []): AudiobookComposable {
  const page = ref(1)
  const limit = ref(24)
  const query = ref<WarehouseRequestListQuery>({ page: 1, limit: 24 })
  return {
    initialQuery: null,
    current: {
      query,
      items: ref(items),
      total: ref(items.length),
      currentPage: page,
      limit,
      queueItems: ref(queueItems),
      loading: ref(false),
      queueLoading: ref(false),
      refreshingStatuses: ref(false),
      error: ref(null),
      refresh: vi.fn<() => void>(),
      setQuery: vi.fn<(nextQuery: WarehouseRequestListQuery) => void>((nextQuery: WarehouseRequestListQuery) => {
        query.value = nextQuery
        page.value = nextQuery.page ?? page.value
        limit.value = nextQuery.limit ?? limit.value
      }),
      setPage: vi.fn<(nextPage: number) => void>((nextPage: number) => {
        page.value = nextPage
      }),
      refreshQueue: vi.fn<() => void>(),
      refreshStatuses: vi.fn<() => void>(),
    },
  }
}

function makeComicComposable(items: WarehouseRequestItem[], overrides: Partial<ComicComposable['current']> = {}): ComicComposable {
  const page = ref(1)
  const limit = ref(24)
  const rows = ref(items)
  const query = ref<WarehouseRequestListQuery>({ page: 1, limit: 24 })
  return {
    initialQuery: null,
    current: {
      query,
      items: rows,
      total: ref(items.length),
      currentPage: page,
      limit,
      loading: ref(false),
      error: ref(null),
      refresh: vi.fn<() => void>(),
      refreshingStatuses: ref(false),
      refreshStatuses: vi.fn<() => void>(),
      setQuery: vi.fn<(nextQuery: WarehouseRequestListQuery) => void>((nextQuery: WarehouseRequestListQuery) => {
        query.value = nextQuery
        page.value = nextQuery.page ?? page.value
        limit.value = nextQuery.limit ?? limit.value
      }),
      setPage: vi.fn<(nextPage: number) => void>((nextPage: number) => {
        page.value = nextPage
      }),
      ...overrides,
    },
  }
}

function mountView() {
  return mount(CatalogRequestsView)
}

function buttonByText(wrapper: ReturnType<typeof mountView>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === label)
  expect(button).toBeDefined()
  return button!
}

async function showAudiobooks(wrapper: ReturnType<typeof mountView>) {
  await buttonByText(wrapper, 'Audiobooks').trigger('click')
  await flushPromises()
}

async function showComics(wrapper: ReturnType<typeof mountView>) {
  await buttonByText(wrapper, 'Comics').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  push.mockClear()
  resolve.mockClear()
  composables.ebook = makeEbookComposable([
    makeRequest({ id: 1, title: 'Pending Book', author: 'Jane Writer', status: 'pending' }),
    makeRequest({ id: 2, title: 'Finished Book', author: 'Riley Reader', status: 'completed', completedRemoteId: 'book 1/with slash' }),
    makeRequest({ id: 3, title: 'Failed Book', author: null, status: 'failed' }),
  ])
  composables.audiobook = makeAudiobookComposable(
    [
      makeRequest({ id: 11, mediaType: 'audiobook', title: 'Audio Pending', author: 'Narrator One', status: 'processing' }),
      makeRequest({
        id: 12,
        mediaType: 'audiobook',
        title: 'Audio Done',
        author: null,
        status: 'completed',
        completedRemoteId: 'audio 1/with slash',
      }),
    ],
    [
      { title: 'Queued Audio', author: 'Queue Author', status: 'pending' },
      { title: 'Queue Complete', author: null, status: 'completed' },
    ],
  )
  composables.comic = makeComicComposable([
    makeRequest({
      id: 31,
      mediaType: 'comic',
      title: 'Comic Done',
      author: 'Panel Publisher',
      status: 'completed',
      completedRemoteId: 'comic 1/with slash',
    }),
  ])
})

describe('CatalogRequestsView', () => {
  it('renders ebook rows, native status labels, and cancel only for cancellable ebook rows', () => {
    const wrapper = mountView()

    expect(composables.ebook.initialQuery).toEqual({ page: 1, limit: 24 })
    expect(wrapper.text()).toContain('Requests')
    expect(wrapper.text()).toContain('Pending Book')
    expect(wrapper.text()).toContain('Jane Writer')
    expect(wrapper.text()).toContain('Book')
    expect(wrapper.text()).toContain('Requested')
    expect(wrapper.text()).toContain('Finished Book')
    expect(wrapper.text()).toContain('Completed')

    const pendingRow = wrapper.get('[data-testid="request-row-1"]')
    const completedRow = wrapper.get('[data-testid="request-row-2"]')
    expect(pendingRow.text()).toContain('Refresh')
    expect(pendingRow.text()).toContain('Cancel')
    expect(completedRow.text()).toContain('Refresh')
    expect(completedRow.text()).not.toContain('Cancel')
  })

  it('renders audiobook rows, queue items, and no audiobook cancel or stream buttons', async () => {
    const wrapper = mountView()

    expect(composables.audiobook.current.setQuery).not.toHaveBeenCalled()
    expect(composables.audiobook.current.refreshQueue).not.toHaveBeenCalled()

    await showAudiobooks(wrapper)

    expect(composables.audiobook.initialQuery).toEqual({ page: 1, limit: 24 })
    expect(composables.audiobook.current.setQuery).toHaveBeenCalledWith({ page: 1, limit: 24, status: undefined })
    expect(composables.audiobook.current.refreshQueue).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Audio Pending')
    expect(wrapper.text()).toContain('Audiobook')
    expect(wrapper.text()).toContain('Processing')
    expect(wrapper.text()).toContain('Queue')
    expect(wrapper.text()).toContain('Queued Audio')
    expect(wrapper.text()).toContain('Queue Author')
    expect(wrapper.text()).not.toMatch(/\\bCancel\\b/)
    expect(wrapper.text()).not.toMatch(/\\bStream\\b/i)
  })

  it('renders comic request rows through the Comics tab without ebook-only actions', async () => {
    const wrapper = mountView()

    expect(composables.comic.initialQuery).toEqual({ page: 1, limit: 24 })
    expect(composables.comic.current.setQuery).not.toHaveBeenCalled()

    await showComics(wrapper)

    expect(composables.comic.current.setQuery).toHaveBeenCalledWith({ page: 1, limit: 24, status: undefined })
    expect(wrapper.text()).toContain('Comic Done')
    expect(wrapper.text()).toContain('Comic')
    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.get('[data-testid="request-open-item-31"]').attributes('href')).toBe('/library/comics/items/comic%201%2Fwith%20slash')
    expect(wrapper.get('[data-testid="request-download-31"]').attributes('href')).toBe(
      '/api/v1/libraries/comics/items/comic%201%2Fwith%20slash/download',
    )
    expect(wrapper.get('[data-testid="request-row-31"]').text()).not.toMatch(/\\bCancel\\b|\\bRefresh\\b/)
  })

  it('routes completed requests with completed items to native library details', async () => {
    const wrapper = mountView()

    const ebookLink = wrapper.get('[data-testid="request-open-item-2"]')
    expect(ebookLink.text()).toBe('Open item')
    expect(ebookLink.attributes('href')).toBe('/library/ebooks/items/book%201%2Fwith%20slash')

    await ebookLink.trigger('click')
    expect(push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
    })
    expect(wrapper.find('[data-testid="request-open-item-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="request-open-item-3"]').exists()).toBe(false)

    await showAudiobooks(wrapper)
    const audiobookLink = wrapper.get('[data-testid="request-open-item-12"]')
    expect(audiobookLink.attributes('href')).toBe('/library/audiobooks/items/audio%201%2Fwith%20slash')

    await audiobookLink.trigger('click')
    expect(push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'audiobooks', remoteId: 'audio 1/with slash' },
    })

    await showComics(wrapper)
    const comicLink = wrapper.get('[data-testid="request-open-item-31"]')
    expect(comicLink.attributes('href')).toBe('/library/comics/items/comic%201%2Fwith%20slash')

    await comicLink.trigger('click')
    expect(push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'comics', remoteId: 'comic 1/with slash' },
    })
  })

  it('opens completed request items in native quick details without navigating', async () => {
    const wrapper = mountView()

    await wrapper.get('[data-testid="request-quick-view-2"]').trigger('click')

    expect(push).not.toHaveBeenCalled()
    const quickView = wrapper.getComponent({ name: 'CatalogItemQuickView' })
    expect(quickView.props('open')).toBe(true)
    expect(quickView.props('item')).toMatchObject({
      mediaType: 'ebook',
      remoteId: 'book 1/with slash',
      title: 'Finished Book',
      authors: ['Riley Reader'],
      libraryName: 'Books',
      formats: [],
      hasCover: false,
    })

    await showAudiobooks(wrapper)
    await wrapper.get('[data-testid="request-quick-view-12"]').trigger('click')

    expect(push).not.toHaveBeenCalled()
    expect(quickView.props('item')).toMatchObject({
      mediaType: 'audiobook',
      remoteId: 'audio 1/with slash',
      title: 'Audio Done',
      authors: [],
      narrators: [],
      libraryName: 'Audiobooks',
    })

    await showComics(wrapper)
    await wrapper.get('[data-testid="request-quick-view-31"]').trigger('click')

    expect(push).not.toHaveBeenCalled()
    expect(quickView.props('item')).toMatchObject({
      mediaType: 'comic',
      remoteId: 'comic 1/with slash',
      title: 'Comic Done',
      authors: [],
      narrators: [],
      libraryName: 'Comics',
    })
  })

  it('shows native ebook request downloads without implying audiobook stream support', async () => {
    const wrapper = mountView()

    const ebookDownload = wrapper.get('[data-testid="request-download-2"]')
    expect(ebookDownload.text()).toBe('Download')
    expect(ebookDownload.attributes('href')).toBe('/api/v1/requests/2/stream')
    expect(wrapper.find('[data-testid="request-download-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="request-download-3"]').exists()).toBe(false)

    await showAudiobooks(wrapper)

    expect(wrapper.find('[data-testid="request-download-12"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/\bStream\b/i)
  })

  it('preserves native modified-click behavior for completed item links', async () => {
    const wrapper = mountView()
    const link = wrapper.get('[data-testid="request-open-item-2"]')
    link.element.addEventListener('click', (event) => event.preventDefault(), { capture: true, once: true })

    await link.trigger('click', { metaKey: true })

    expect(push).not.toHaveBeenCalled()
  })

  it('does not render a catalog item link for completed requests without a completed item', () => {
    composables.ebook = makeEbookComposable([makeRequest({ id: 21, status: 'completed', completedRemoteId: null })])

    const wrapper = mountView()

    expect(wrapper.get('[data-testid="request-row-21"]').text()).not.toContain('Open item')
    expect(wrapper.find('[data-testid="request-open-item-21"]').exists()).toBe(false)
  })

  it('opens request dialogs and refreshes the matching request lists', async () => {
    const wrapper = mountView()

    await buttonByText(wrapper, 'Request Book').trigger('click')
    expect(wrapper.find('[data-testid="ebook-dialog"]').exists()).toBe(true)
    await wrapper.get('[data-testid="ebook-dialog"] button').trigger('click')
    expect(composables.ebook.current.refresh).toHaveBeenCalledTimes(1)

    await buttonByText(wrapper, 'Request Audiobook').trigger('click')
    await showAudiobooks(wrapper)
    expect(wrapper.find('[data-testid="audiobook-dialog"]').exists()).toBe(true)
    await wrapper.get('[data-testid="audiobook-dialog"] button').trigger('click')
    expect(composables.audiobook.current.setQuery).toHaveBeenLastCalledWith({ page: 1, limit: 24, status: undefined })
    expect(composables.audiobook.current.refreshQueue).toHaveBeenCalledTimes(2)

    await buttonByText(wrapper, 'Refresh statuses').trigger('click')
    expect(composables.audiobook.current.refreshStatuses).toHaveBeenCalledTimes(1)

    await buttonByText(wrapper, 'Request Comic').trigger('click')
    await showComics(wrapper)
    expect(wrapper.find('[data-testid="comic-dialog"]').exists()).toBe(true)
    await wrapper.get('[data-testid="comic-dialog"] button').trigger('click')
    expect(composables.comic.current.setQuery).toHaveBeenLastCalledWith({ page: 1, limit: 24, status: undefined })
  })

  it('refreshes comic request statuses from the Comics tab', async () => {
    const wrapper = mountView()

    await showComics(wrapper)
    await buttonByText(wrapper, 'Refresh statuses').trigger('click')

    expect(composables.comic.current.refreshStatuses).toHaveBeenCalledTimes(1)
  })

  it('loads native status filters server-side and paginates through the active composable', async () => {
    const ebook = composables.ebook as RequestComposable
    ebook.current.total = computed(() => 72)
    const wrapper = mountView()

    await buttonByText(wrapper, 'Failed').trigger('click')
    expect(ebook.current.setQuery).toHaveBeenCalledWith({ status: 'failed', page: 1, limit: 24 })

    await buttonByText(wrapper, 'Next').trigger('click')
    expect(ebook.current.setPage).toHaveBeenCalledWith(2)
    await flushPromises()
    await buttonByText(wrapper, 'Previous').trigger('click')
    expect(ebook.current.setPage).toHaveBeenCalledWith(1)

    await showAudiobooks(wrapper)
    const audiobook = composables.audiobook as AudiobookComposable
    expect(audiobook.current.setQuery).toHaveBeenCalledWith({ status: 'failed', page: 1, limit: 24 })
    audiobook.current.total.value = 49
    audiobook.current.currentPage.value = 1
    await flushPromises()
    await buttonByText(wrapper, 'Next').trigger('click')
    expect(audiobook.current.setPage).toHaveBeenCalledWith(2)

    await showComics(wrapper)
    const comic = composables.comic as ComicComposable
    expect(comic.current.setQuery).toHaveBeenCalledWith({ status: 'failed', page: 1, limit: 24 })
    comic.current.total.value = 49
    comic.current.currentPage.value = 1
    await flushPromises()
    await buttonByText(wrapper, 'Next').trigger('click')
    expect(comic.current.setPage).toHaveBeenCalledWith(2)
  })

  it('reapplies the selected status filter when returning to an already loaded media tab', async () => {
    const wrapper = mountView()

    await showAudiobooks(wrapper)
    composables.audiobook.current.setQuery.mockClear()
    await buttonByText(wrapper, 'Books').trigger('click')

    await buttonByText(wrapper, 'Failed').trigger('click')
    expect(composables.ebook.current.setQuery).toHaveBeenCalledWith({ status: 'failed', page: 1, limit: 24 })

    await showAudiobooks(wrapper)
    expect(composables.audiobook.current.setQuery).toHaveBeenCalledWith({ status: 'failed', page: 1, limit: 24 })

    await showComics(wrapper)
    expect(composables.comic.current.setQuery).toHaveBeenCalledWith({ status: 'failed', page: 1, limit: 24 })

    composables.ebook.current.setQuery.mockClear()
    await buttonByText(wrapper, 'Completed').trigger('click')
    expect(composables.comic.current.setQuery).toHaveBeenCalledWith({ status: 'completed', page: 1, limit: 24 })

    await buttonByText(wrapper, 'Books').trigger('click')
    expect(composables.ebook.current.setQuery).toHaveBeenCalledWith({ status: 'completed', page: 1, limit: 24 })
  })

  it('surfaces row action failures without leaking private details', async () => {
    const ebook = composables.ebook as RequestComposable
    ebook.current.refreshRequest.mockImplementationOnce(async () => {
      ebook.current.error.value = 'Failed to refresh request'
      throw new Error('Private refresh failure')
    })
    ebook.current.cancelRequest.mockImplementationOnce(async () => {
      ebook.current.error.value = 'Failed to cancel request'
      throw new Error('Private cancel failure')
    })
    const wrapper = mountView()

    await wrapper.get('[data-testid="request-row-1"]').findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to refresh request')
    expect(wrapper.text()).not.toContain('Private refresh failure')

    ebook.current.error.value = null
    await flushPromises()
    await wrapper.get('[data-testid="request-row-1"]').findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to cancel request')
    expect(wrapper.text()).not.toContain('Private cancel failure')
  })

  it('surfaces audiobook status refresh failures without unhandled promises', async () => {
    const audiobook = composables.audiobook as AudiobookComposable
    audiobook.current.refreshStatuses.mockImplementationOnce(async () => {
      audiobook.current.error.value = 'Failed to refresh requests'
      throw new Error('Private status refresh failure')
    })
    const wrapper = mountView()

    await showAudiobooks(wrapper)
    await buttonByText(wrapper, 'Refresh statuses').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to refresh requests')
    expect(wrapper.text()).not.toContain('Private status refresh failure')
  })

  it('surfaces comic status refresh failures without leaking private details', async () => {
    const comic = composables.comic as ComicComposable
    comic.current.refreshStatuses.mockImplementationOnce(async () => {
      comic.current.error.value = 'Failed to refresh requests'
      throw new Error('Private comic status refresh failure')
    })
    const wrapper = mountView()

    await showComics(wrapper)
    await buttonByText(wrapper, 'Refresh statuses').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to refresh requests')
    expect(wrapper.text()).not.toContain('Private comic status refresh failure')
  })

  it('renders loading states before empty request and queue states', async () => {
    composables.ebook = makeEbookComposable([], { total: ref(0), loading: ref(true) })
    composables.audiobook = makeAudiobookComposable([], [])
    composables.audiobook.current.queueLoading.value = true
    const wrapper = mountView()

    expect(wrapper.text()).toContain('Loading requests')
    expect(wrapper.text()).not.toContain('No requests yet')

    await showAudiobooks(wrapper)
    expect(wrapper.text()).toContain('Loading queue')
  })

  it('renders empty and error states for requests and queue', async () => {
    composables.ebook = makeEbookComposable([], { total: ref(0) })
    const wrapper = mountView()
    expect(wrapper.text()).toContain('No requests yet')

    composables.audiobook.current.error.value = 'Failed to load requests'
    await showAudiobooks(wrapper)
    expect(wrapper.text()).toContain('Failed to load requests')

    composables.audiobook.current.error.value = 'Failed to load queue'
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to load queue')

    composables.audiobook.current.error.value = null
    composables.audiobook.current.setQuery.mockImplementationOnce((nextQuery: WarehouseRequestListQuery) => {
      composables.audiobook.current.query.value = nextQuery
      composables.audiobook.current.items.value = []
      composables.audiobook.current.total.value = 0
    })
    await buttonByText(wrapper, 'Failed').trigger('click')
    expect(wrapper.text()).toContain('No requests match this filter')
  })

  it('does not render banned wording in visible request copy', () => {
    const wrapper = mountView()
    const visibleCopy = [...visibleRequestCopySnapshot(), wrapper.text()].join(' ')

    expect(visibleCopy).not.toMatch(/book warehouse|warehouse|third-party|upstream|provider|source|vendor/i)
  })
})
