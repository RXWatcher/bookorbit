import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLOUD_AUDIO_LIBRARY_ID,
  CLOUD_COMIC_LIBRARY_ID,
  CLOUD_EBOOK_LIBRARY_ID,
  type DashboardCatalogItem,
  type WarehouseAudiobookDetail,
  type WarehouseComicCatalogItem,
  type WarehouseEbookCatalogItem,
  type WarehouseUserCatalogState,
} from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  route: { params: {} as Record<string, unknown> },
  router: { back: vi.fn<() => void>(), push: vi.fn<(location: unknown) => void>() },
  fetchCatalogSourceEbook: vi.fn<(remoteId: string) => Promise<WarehouseEbookCatalogItem | null>>(),
  fetchCatalogSourceAudiobook: vi.fn<(remoteId: string) => Promise<WarehouseAudiobookDetail | null>>(),
  fetchCatalogSourceComic: vi.fn<(remoteId: string) => Promise<WarehouseComicCatalogItem | null>>(),
  fetchCatalogLibraryItems: vi.fn<() => Promise<{ items: DashboardCatalogItem[]; total: number; page: number; limit: number }>>(),
  useCatalogSourceUserState: vi.fn<() => unknown>(),
  hasPermission: vi.fn<(permission: string) => boolean>(),
  setRouteParams: undefined as undefined | ((params: Record<string, unknown>) => void),
}))

vi.mock('vue-router', async () => {
  const { reactive } = await vi.importActual<typeof import('vue')>('vue')
  const route = reactive(mocks.route)
  mocks.setRouteParams = (params: Record<string, unknown>) => {
    route.params = params
  }

  return {
    useRoute: () => route,
    useRouter: () => mocks.router,
  }
})

vi.mock('@/features/warehouse/api/catalog-source.api', async () => {
  const actual = await vi.importActual<typeof import('@/features/warehouse/api/catalog-source.api')>('@/features/warehouse/api/catalog-source.api')

  return {
    ...actual,
    fetchCatalogSourceEbook: mocks.fetchCatalogSourceEbook,
    fetchCatalogSourceAudiobook: mocks.fetchCatalogSourceAudiobook,
    fetchCatalogSourceComic: mocks.fetchCatalogSourceComic,
    fetchCatalogLibraryItems: mocks.fetchCatalogLibraryItems,
  }
})

vi.mock('@/features/warehouse/composables/useCatalogSourceUserState', () => ({
  useCatalogSourceUserState: mocks.useCatalogSourceUserState,
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}))

vi.mock('@/features/collection/components/AddToCollectionSheet.vue', () => ({
  default: defineComponent({
    name: 'AddToCollectionSheet',
    props: {
      open: { type: Boolean, required: true },
      bookIds: { type: Array, required: true },
      catalogItems: { type: Array, default: () => [] },
    },
    emits: ['update:open'],
    template: '<div data-testid="collections-sheet" :data-open="String(open)" :data-catalog-items="JSON.stringify(catalogItems)" />',
  }),
}))

vi.mock('@/features/email/components/SendBookDialog.vue', () => ({
  default: defineComponent({
    name: 'SendBookDialog',
    props: {
      open: { type: Boolean, required: true },
      bookIds: { type: Array, default: () => [] },
      catalogEbooks: { type: Array, default: () => [] },
      bookTitle: { type: String, default: '' },
    },
    emits: ['update:open'],
    template:
      '<div data-testid="send-dialog" :data-open="String(open)" :data-catalog-ebooks="JSON.stringify(catalogEbooks)" :data-book-title="bookTitle" />',
  }),
}))

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn<(message: string) => void>() } }))

function makeEbook(overrides: Partial<WarehouseEbookCatalogItem> = {}): WarehouseEbookCatalogItem {
  return {
    id: 17,
    remoteId: 'book 1/with slash',
    title: 'The Long Way Home',
    subtitle: null,
    authors: ['Bea Morgan'],
    series: null,
    language: 'en',
    publisher: 'Orbit Press',
    identifiers: { isbn: '9780000000017' },
    format: 'epub',
    hasCover: true,
    syncedAt: '2026-06-01T12:00:00.000Z',
    source: 'catalog-source',
    ...overrides,
  }
}

function makeAudiobook(overrides: Partial<WarehouseAudiobookDetail> = {}): WarehouseAudiobookDetail {
  return {
    id: 42,
    remoteId: 'audio 1/with slash',
    title: 'Signal Fires',
    subtitle: null,
    authors: ['Rae Poe'],
    narrators: ['Mira Vale'],
    series: null,
    language: 'en',
    publisher: 'Orbit Audio',
    identifiers: { asin: 'B000000042' },
    format: 'mp3',
    durationSeconds: 5400,
    hasCover: true,
    syncedAt: '2026-06-01T12:00:00.000Z',
    source: 'catalog-source',
    chapters: [],
    files: [],
    ...overrides,
  }
}

function makeComic(overrides: Partial<WarehouseComicCatalogItem> = {}): WarehouseComicCatalogItem {
  return {
    id: 77,
    mediaType: 'comic',
    remoteId: 'comic 1/with slash',
    title: 'Saga #1',
    subtitle: null,
    authors: ['Brian K. Vaughan'],
    series: 'Saga',
    seriesId: 'saga',
    issueNumber: '1',
    year: 2012,
    language: 'en',
    publisher: 'Image',
    identifiers: {},
    format: 'cbz',
    hasCover: true,
    syncedAt: '2026-06-01T12:00:00.000Z',
    source: 'catalog-source',
    ...overrides,
  }
}

function makeUserState(overrides: Partial<WarehouseUserCatalogState> = {}): WarehouseUserCatalogState {
  return {
    mediaType: 'ebook',
    remoteId: 'book 1/with slash',
    inLibrary: true,
    favorite: false,
    rating: null,
    readStatus: null,
    progressPercent: null,
    positionSeconds: null,
    finishedAt: null,
    updatedAt: '2026-06-03T12:00:00.000Z',
    ...overrides,
  }
}

function makeRelatedItem(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'ebook',
    remoteId: 'related-1',
    title: 'A Short Walk Back',
    subtitle: null,
    seriesName: 'Wayfarers',
    authors: ['Bea Morgan'],
    narrators: [],
    libraryName: 'Books',
    formats: ['epub'],
    hasCover: true,
    ...overrides,
  }
}

describe('CatalogItemDetailView', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.route.params = { mediaType: 'ebook', remoteId: 'book 1/with slash' }
    mocks.router.back.mockReset()
    mocks.router.push.mockReset()
    mocks.fetchCatalogSourceEbook.mockReset()
    mocks.fetchCatalogSourceAudiobook.mockReset()
    mocks.fetchCatalogSourceComic.mockReset()
    mocks.fetchCatalogLibraryItems.mockReset()
    mocks.fetchCatalogLibraryItems.mockResolvedValue({ items: [], total: 0, page: 0, limit: 13 })
    mocks.useCatalogSourceUserState.mockReset()
    mocks.hasPermission.mockReset()
    mocks.hasPermission.mockReturnValue(true)
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState()),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi.fn<() => Promise<WarehouseUserCatalogState>>().mockResolvedValue(makeUserState()),
    })
  })

  it('shows native ebook cover and download actions without audiobook playback', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceEbook).toHaveBeenCalledWith('book 1/with slash')
    expect(wrapper.get('img[alt="The Long Way Home"]').attributes('src')).toBe('/api/v1/libraries/ebooks/items/book%201%2Fwith%20slash/cover/medium')
    expect(wrapper.get('a[href="/api/v1/libraries/ebooks/items/book%201%2Fwith%20slash/download"]').text()).toContain('Download')
    expect(wrapper.text()).toContain('Books')
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/catalog item|warehouse|provider|third-party|upstream/i)
  }, 30_000)

  it('opens native email send for source-backed ebooks with the catalog ref', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const sendButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Send via Email')
    expect(sendButton).toBeTruthy()
    await sendButton!.trigger('click')

    const dialog = wrapper.get('[data-testid="send-dialog"]')
    expect(dialog.attributes('data-open')).toBe('true')
    expect(dialog.attributes('data-catalog-ebooks')).toBe(JSON.stringify([{ remoteId: 'book 1/with slash' }]))
    expect(dialog.attributes('data-book-title')).toBe('The Long Way Home')
  })

  it('lets source-backed detail update favorite, rating, and read status without separate library membership controls', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())
    const save = vi.fn<() => Promise<WarehouseUserCatalogState>>().mockResolvedValue(makeUserState())
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ inLibrary: true, favorite: false, rating: 2, readStatus: 'reading', progressPercent: 42 })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save,
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(wrapper.text()).not.toContain('Add to library')
    expect(wrapper.text()).not.toContain('In library')
    expect(wrapper.text()).not.toContain('In your library')
    expect(wrapper.text()).toContain('42%')

    const favoriteButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Favorite')
    expect(favoriteButton).toBeDefined()
    await favoriteButton!.trigger('click')
    expect(save).toHaveBeenCalledWith({ favorite: true })

    await wrapper.get('[data-testid="catalog-detail-rating-3"]').trigger('click')
    expect(save).toHaveBeenCalledWith({ rating: 3 })

    await wrapper.get('[data-testid="catalog-detail-read-status"]').setValue('read')
    expect(save).toHaveBeenCalledWith({ readStatus: 'read' })
    expect(save).not.toHaveBeenCalledWith(expect.objectContaining({ inLibrary: expect.anything() }))
  })

  it('uses native library copy when a source-backed item is unavailable', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(null)

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(wrapper.text()).toContain('This library item is not available.')
    expect(wrapper.text()).not.toMatch(/catalog item|warehouse|provider|third-party|upstream/i)
  })

  it('loads source-backed details from native library item route params', async () => {
    mocks.route.params = { id: CLOUD_EBOOK_LIBRARY_ID, remoteId: 'book 1/with slash' }
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    mount(CatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceEbook).toHaveBeenCalledWith('book 1/with slash')
    expect(mocks.fetchCatalogSourceAudiobook).not.toHaveBeenCalled()
    expect(mocks.useCatalogSourceUserState).toHaveBeenCalledWith(
      expect.objectContaining({ __v_isRef: true }),
      expect.objectContaining({ __v_isRef: true }),
      {
        autoLoad: false,
      },
    )

    vi.resetModules()
    mocks.route.params = { id: CLOUD_AUDIO_LIBRARY_ID, remoteId: 'audio 1/with slash' }
    mocks.fetchCatalogSourceEbook.mockReset()
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook())
    mocks.useCatalogSourceUserState.mockReset()
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
    })

    const { default: AudiobookCatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    mount(AudiobookCatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceAudiobook).toHaveBeenCalledWith('audio 1/with slash')
    expect(mocks.fetchCatalogSourceEbook).not.toHaveBeenCalled()
    expect(mocks.useCatalogSourceUserState).toHaveBeenCalledWith(
      expect.objectContaining({ __v_isRef: true }),
      expect.objectContaining({ __v_isRef: true }),
      {
        autoLoad: false,
      },
    )
  })

  it('loads source-backed details from friendly native library item route aliases', async () => {
    mocks.route.params = { id: 'ebooks', remoteId: 'book 1/with slash' }
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    mount(CatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceEbook).toHaveBeenCalledWith('book 1/with slash')
    expect(mocks.fetchCatalogSourceAudiobook).not.toHaveBeenCalled()

    vi.resetModules()
    mocks.route.params = { id: 'audiobooks', remoteId: 'audio 1/with slash' }
    mocks.fetchCatalogSourceEbook.mockReset()
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook())
    mocks.useCatalogSourceUserState.mockReset()
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
    })

    const { default: AudiobookCatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    mount(AudiobookCatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceAudiobook).toHaveBeenCalledWith('audio 1/with slash')
    expect(mocks.fetchCatalogSourceEbook).not.toHaveBeenCalled()
  })

  it('loads source-backed comic details from native Comic Library item route params', async () => {
    mocks.route.params = { id: CLOUD_COMIC_LIBRARY_ID, remoteId: 'comic 1/with slash' }
    mocks.fetchCatalogSourceComic.mockResolvedValue(makeComic())
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceComic).toHaveBeenCalledWith('comic 1/with slash')
    expect(mocks.fetchCatalogSourceEbook).not.toHaveBeenCalled()
    expect(mocks.fetchCatalogSourceAudiobook).not.toHaveBeenCalled()
    expect(wrapper.get('img[alt="Saga #1"]').attributes('src')).toBe('/api/v1/libraries/comics/items/comic%201%2Fwith%20slash/pages/0')
    expect(wrapper.get('a[href="/api/v1/libraries/comics/items/comic%201%2Fwith%20slash/download"]').text()).toContain('Download')
    expect(wrapper.text()).toContain('Comics')
    expect(wrapper.text()).not.toMatch(/catalog item|warehouse|provider|third-party|upstream/i)
  })

  it('loads source-backed comic details from friendly Comic Library item route aliases', async () => {
    mocks.route.params = { id: 'comics', remoteId: 'comic 1/with slash' }
    mocks.fetchCatalogSourceComic.mockResolvedValue(makeComic())
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    mount(CatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceComic).toHaveBeenCalledWith('comic 1/with slash')
    expect(mocks.fetchCatalogSourceEbook).not.toHaveBeenCalled()
    expect(mocks.fetchCatalogSourceAudiobook).not.toHaveBeenCalled()
  })

  it('opens source-backed EPUBs in the native reader route', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text().includes('Read'))
    expect(readButton).toBeDefined()

    await readButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
      query: { format: 'epub' },
    })
    expect(wrapper.text()).not.toMatch(/warehouse|provider|third-party|upstream/i)
  })

  it('opens source-backed PDFs in the native reader route', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook({ format: 'pdf' }))

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text().includes('Read'))
    expect(readButton).toBeDefined()

    await readButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
      query: { format: 'pdf' },
    })
  })

  it('opens source-backed ebooks without catalog format metadata in the native reader route', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook({ format: null }))

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text().includes('Read'))
    expect(readButton).toBeDefined()

    await readButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
      query: { format: 'epub' },
    })
  })

  it.each(['cbz', 'cbr', 'cb7'])('opens source-backed %s comics in the native reader route', async (format) => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook({ format }))

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text().includes('Read'))
    expect(readButton).toBeDefined()

    await readButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
      query: { format },
    })
  })

  it.each(['cbz', 'cbr', 'cb7'])('opens source-backed Comic Library %s items in the native reader route', async (format) => {
    mocks.route.params = { id: 'comics', remoteId: 'comic 1/with slash' }
    mocks.fetchCatalogSourceComic.mockResolvedValue(makeComic({ format }))
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text().includes('Read'))
    expect(readButton).toBeDefined()

    await readButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'comics', remoteId: 'comic 1/with slash' },
      query: { format },
    })
  })

  it('opens source-backed comics without catalog format metadata in the native reader route', async () => {
    mocks.route.params = { id: 'comics', remoteId: 'comic 1/with slash' }
    mocks.fetchCatalogSourceComic.mockResolvedValue(makeComic({ format: null }))
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'comic', remoteId: 'comic 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text().includes('Read'))
    expect(readButton).toBeDefined()

    await readButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'comics', remoteId: 'comic 1/with slash' },
      query: { format: 'cbz' },
    })
  })

  it('opens source-backed audiobooks in the native reader route', async () => {
    mocks.route.params = { mediaType: 'audiobook', remoteId: 'audio 1/with slash' }
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook({ format: 'mp3' }))
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const listenButton = wrapper.findAll('button').find((button) => button.text().includes('Listen'))
    expect(listenButton).toBeDefined()

    await listenButton!.trigger('click')

    expect(wrapper.text()).toContain('Audiobooks')
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio 1/with slash' },
      query: { format: 'mp3' },
    })
    expect(wrapper.text()).not.toMatch(/catalog item|warehouse|provider|third-party|upstream/i)
  })

  it('normalizes source-backed audiobook MIME formats for the native reader route', async () => {
    mocks.route.params = { mediaType: 'audiobook', remoteId: 'audio 1/with slash' }
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook({ format: 'audio/mp4' }))
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const listenButton = wrapper.findAll('button').find((button) => button.text().includes('Listen'))
    expect(listenButton).toBeDefined()

    await listenButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio 1/with slash' },
      query: { format: 'm4a' },
    })
  })

  it('opens source-backed audiobooks without catalog format metadata in the native reader route', async () => {
    mocks.route.params = { mediaType: 'audiobook', remoteId: 'audio 1/with slash' }
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook({ format: null }))
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    const listenButton = wrapper.findAll('button').find((button) => button.text().includes('Listen'))
    expect(listenButton).toBeDefined()

    await listenButton!.trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio 1/with slash' },
      query: { format: 'm4b' },
    })
  })

  it('does not expose a separate inline player for source-backed audiobooks', async () => {
    mocks.route.params = { mediaType: 'audiobook', remoteId: 'audio 1/with slash' }
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook({ format: 'mp3' }))
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(wrapper.find('audio').exists()).toBe(false)
  })

  it('opens native collection management for a source-backed ebook', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(wrapper.get('[data-testid="collections-sheet"]').attributes('data-open')).toBe('false')

    const collectionsButton = wrapper.findAll('button').find((button) => button.text().includes('Collections'))
    expect(collectionsButton).toBeDefined()

    await collectionsButton!.trigger('click')

    const sheet = wrapper.get('[data-testid="collections-sheet"]')
    expect(sheet.attributes('data-open')).toBe('true')
    expect(JSON.parse(sheet.attributes('data-catalog-items') ?? '[]')).toEqual([{ mediaType: 'ebook', remoteId: 'book 1/with slash' }])
    expect(wrapper.text()).not.toMatch(/warehouse|provider|third-party|upstream/i)
  })

  it('renders related source-backed library items on native item detail pages', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook({ series: 'Wayfarers', authors: ['Bea Morgan'] }))
    mocks.fetchCatalogLibraryItems.mockResolvedValue({
      items: [makeRelatedItem({ remoteId: 'book 1/with slash', title: 'Duplicate Current Item' }), makeRelatedItem()],
      total: 2,
      page: 0,
      limit: 13,
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogLibraryItems).toHaveBeenCalledWith(
      CLOUD_EBOOK_LIBRARY_ID,
      {
        filter: {
          type: 'group',
          join: 'OR',
          rules: [
            { type: 'rule', field: 'series', operator: 'contains', value: 'Wayfarers' },
            { type: 'rule', field: 'author', operator: 'includesAny', value: ['Bea Morgan'] },
          ],
        },
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: 13 },
      },
      expect.any(AbortSignal),
    )
    expect(wrapper.text()).toContain('More From Libraries')
    expect(wrapper.text()).toContain('A Short Walk Back')
    expect(wrapper.text()).not.toContain('Duplicate Current Item')
    expect(wrapper.text()).not.toMatch(/catalog item|warehouse|provider|third-party|upstream/i)
  })

  it('reloads native item detail when related item navigation reuses the current route component', async () => {
    mocks.fetchCatalogSourceEbook.mockImplementation(async (remoteId) =>
      remoteId === 'related-1'
        ? makeEbook({ remoteId: 'related-1', title: 'The Followup Detail', series: 'Wayfarers', authors: ['Bea Morgan'] })
        : makeEbook({ title: 'The Long Way Home', series: 'Wayfarers', authors: ['Bea Morgan'] }),
    )
    mocks.fetchCatalogLibraryItems.mockResolvedValue({
      items: [makeRelatedItem({ remoteId: 'related-1', title: 'A Short Walk Back' })],
      total: 1,
      page: 0,
      limit: 13,
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('The Long Way Home')

    await wrapper.get('[data-testid="catalog-recommendation-item"]').trigger('click')
    mocks.setRouteParams?.({ id: CLOUD_EBOOK_LIBRARY_ID, remoteId: 'related-1' })

    await flushPromises()

    expect(mocks.fetchCatalogSourceEbook).toHaveBeenCalledWith('related-1')
    expect(wrapper.get('h1').text()).toBe('The Followup Detail')
    expect(wrapper.text()).not.toMatch(/catalog item|warehouse|provider|third-party|upstream/i)
  })

  it('shows native audiobook file download actions from catalog detail files', async () => {
    mocks.route.params = { mediaType: 'audiobook', remoteId: 'audio 1/with slash' }
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(
      makeAudiobook({
        files: [{ id: 'file 2/part', name: 'Part One.mp3', format: 'mp3', durationSeconds: 120, sizeBytes: 4096 }],
      }),
    )
    mocks.useCatalogSourceUserState.mockReturnValue({
      state: ref(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
      saving: ref(false),
      load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      save: vi
        .fn<() => Promise<WarehouseUserCatalogState>>()
        .mockResolvedValue(makeUserState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' })),
    })

    const { default: CatalogItemDetailView } = await import('../CatalogItemDetailView.vue')
    const wrapper = mount(CatalogItemDetailView)

    await flushPromises()

    expect(mocks.fetchCatalogSourceAudiobook).toHaveBeenCalledWith('audio 1/with slash')
    expect(wrapper.text()).toContain('Part One.mp3')
    expect(wrapper.text()).toContain('MP3')
    expect(wrapper.text()).toContain('2 min')
    expect(wrapper.get('a[href="/api/v1/libraries/audiobooks/items/audio%201%2Fwith%20slash/files/file%202%2Fpart/download"]').text()).toContain(
      'Download',
    )
    expect(wrapper.text()).not.toMatch(/warehouse|provider|third-party|upstream/i)
  })
})
