import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DashboardCatalogItem,
  WarehouseAudiobookDetail,
  WarehouseComicCatalogItem,
  WarehouseEbookCatalogItem,
  WarehouseUserCatalogState,
} from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn<(location: unknown) => void>() },
  fetchCatalogSourceEbook: vi.fn<(remoteId: string) => Promise<WarehouseEbookCatalogItem | null>>(),
  fetchCatalogSourceAudiobook: vi.fn<(remoteId: string) => Promise<WarehouseAudiobookDetail | null>>(),
  fetchCatalogSourceComic: vi.fn<(remoteId: string) => Promise<WarehouseComicCatalogItem | null>>(),
  fetchCatalogSourceUserState: vi.fn<(mediaType: string, remoteId: string) => Promise<WarehouseUserCatalogState>>(),
  patchCatalogSourceUserState: vi.fn<(mediaType: string, remoteId: string, patch: Record<string, unknown>) => Promise<WarehouseUserCatalogState>>(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => mocks.router,
}))

vi.mock('@/features/warehouse/api/catalog-source.api', async () => {
  const actual = await vi.importActual<typeof import('@/features/warehouse/api/catalog-source.api')>('@/features/warehouse/api/catalog-source.api')

  return {
    ...actual,
    fetchCatalogSourceEbook: mocks.fetchCatalogSourceEbook,
    fetchCatalogSourceAudiobook: mocks.fetchCatalogSourceAudiobook,
    fetchCatalogSourceComic: mocks.fetchCatalogSourceComic,
    fetchCatalogSourceUserState: mocks.fetchCatalogSourceUserState,
    patchCatalogSourceUserState: mocks.patchCatalogSourceUserState,
  }
})

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

const globalStubs = {
  global: {
    stubs: {
      Sheet: { template: '<div data-testid="quick-view-sheet"><slot /></div>' },
      SheetContent: { template: '<aside><slot /></aside>' },
      SheetTitle: { template: '<h2><slot /></h2>' },
      SheetDescription: { template: '<p><slot /></p>' },
      BookCoverSurface: { template: '<div><slot /></div>' },
      BookCoverArtwork: {
        props: ['src', 'alt'],
        template: '<img :src="src" :alt="alt" />',
      },
      Skeleton: { template: '<div data-testid="skeleton" />' },
    },
  },
}

function makeItem(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'ebook',
    remoteId: 'book 1/with slash',
    title: 'The Long Way Home',
    subtitle: null,
    seriesName: null,
    authors: ['Bea Morgan'],
    narrators: [],
    libraryName: 'Books',
    formats: ['epub'],
    language: 'en',
    publisher: 'Orbit Press',
    hasCover: true,
    ...overrides,
  }
}

function makeEbook(overrides: Partial<WarehouseEbookCatalogItem> = {}): WarehouseEbookCatalogItem {
  return {
    id: 17,
    remoteId: 'book 1/with slash',
    title: 'The Long Way Home',
    subtitle: 'A Library Story',
    authors: ['Bea Morgan'],
    series: 'Wayfarers',
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

function makeState(overrides: Partial<WarehouseUserCatalogState> = {}): WarehouseUserCatalogState {
  return {
    mediaType: 'ebook',
    remoteId: 'book 1/with slash',
    inLibrary: true,
    favorite: false,
    rating: 2,
    readStatus: 'reading',
    progressPercent: 42,
    positionSeconds: null,
    finishedAt: null,
    updatedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

describe('CatalogItemQuickView', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.router.push.mockReset()
    mocks.fetchCatalogSourceEbook.mockReset()
    mocks.fetchCatalogSourceAudiobook.mockReset()
    mocks.fetchCatalogSourceComic.mockReset()
    mocks.fetchCatalogSourceUserState.mockReset()
    mocks.patchCatalogSourceUserState.mockReset()
    mocks.fetchCatalogSourceUserState.mockResolvedValue(makeState())
    mocks.patchCatalogSourceUserState.mockImplementation(async (_mediaType, _remoteId, patch) => makeState(patch))
  })

  it('loads a source-backed ebook into a native quick detail sheet', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemQuickView } = await import('../CatalogItemQuickView.vue')
    const wrapper = mount(CatalogItemQuickView, {
      props: { open: true, item: makeItem() },
      ...globalStubs,
    })

    await flushPromises()

    expect(mocks.fetchCatalogSourceEbook).toHaveBeenCalledWith('book 1/with slash')
    expect(wrapper.text()).toContain('Books')
    expect(wrapper.text()).toContain('The Long Way Home')
    expect(wrapper.text()).toContain('Bea Morgan')
    expect(wrapper.text()).toContain('Orbit Press')
    expect(wrapper.text()).not.toMatch(/warehouse|provider|third-party|upstream|catalog item/i)
    expect(wrapper.get('img[alt="The Long Way Home"]').attributes('src')).toBe('/api/v1/libraries/ebooks/items/book%201%2Fwith%20slash/cover/medium')

    await wrapper.get('[data-testid="catalog-quick-view-action-details"]').trigger('click')
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
    })

    await wrapper.get('[data-testid="catalog-quick-view-action-read"]').trigger('click')
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
      query: { format: 'epub' },
    })
  }, 30_000)

  it('lets source-backed ebooks open the native reader without catalog format metadata', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook({ format: null }))

    const { default: CatalogItemQuickView } = await import('../CatalogItemQuickView.vue')
    const wrapper = mount(CatalogItemQuickView, {
      props: { open: true, item: makeItem({ formats: [] }) },
      ...globalStubs,
    })

    await flushPromises()

    await wrapper.get('[data-testid="catalog-quick-view-action-read"]').trigger('click')
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'ebooks', remoteId: 'book 1/with slash' },
      query: { format: 'epub' },
    })
  })

  it('loads a source-backed comic into a native Comic Library quick detail sheet', async () => {
    mocks.fetchCatalogSourceComic.mockResolvedValue(makeComic())
    mocks.fetchCatalogSourceUserState.mockResolvedValue(makeState({ mediaType: 'comic', remoteId: 'comic 1/with slash' }))

    const { default: CatalogItemQuickView } = await import('../CatalogItemQuickView.vue')
    const wrapper = mount(CatalogItemQuickView, {
      props: {
        open: true,
        item: makeItem({
          mediaType: 'comic',
          remoteId: 'comic 1/with slash',
          title: 'Saga #1',
          libraryName: 'Comics',
          formats: ['cbz'],
        }),
      },
      ...globalStubs,
    })

    await flushPromises()

    expect(mocks.fetchCatalogSourceComic).toHaveBeenCalledWith('comic 1/with slash')
    expect(mocks.fetchCatalogSourceEbook).not.toHaveBeenCalled()
    expect(mocks.fetchCatalogSourceAudiobook).not.toHaveBeenCalled()
    expect(mocks.fetchCatalogSourceUserState).toHaveBeenCalledWith('comic', 'comic 1/with slash')
    expect(wrapper.text()).toContain('Comics')
    expect(wrapper.text()).toContain('Saga #1')
    expect(wrapper.get('img[alt="Saga #1"]').attributes('src')).toBe('/api/v1/libraries/comics/items/comic%201%2Fwith%20slash/pages/0')

    await wrapper.get('[data-testid="catalog-quick-view-action-details"]').trigger('click')
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'comics', remoteId: 'comic 1/with slash' },
    })

    await wrapper.get('[data-testid="catalog-quick-view-action-read"]').trigger('click')
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'comics', remoteId: 'comic 1/with slash' },
      query: { format: 'cbz' },
    })
    expect(wrapper.text()).not.toMatch(/warehouse|provider|third-party|upstream|catalog item/i)
  })

  it('lets source-backed audiobooks open the native reader without catalog format metadata', async () => {
    mocks.fetchCatalogSourceAudiobook.mockResolvedValue(makeAudiobook({ format: null }))
    mocks.fetchCatalogSourceUserState.mockResolvedValue(makeState({ mediaType: 'audiobook', remoteId: 'audio 1/with slash' }))

    const { default: CatalogItemQuickView } = await import('../CatalogItemQuickView.vue')
    const wrapper = mount(CatalogItemQuickView, {
      props: {
        open: true,
        item: makeItem({
          mediaType: 'audiobook',
          remoteId: 'audio 1/with slash',
          title: 'Signal Fires',
          libraryName: 'Audiobooks',
          formats: [],
        }),
      },
      ...globalStubs,
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Audiobooks')

    await wrapper.get('[data-testid="catalog-quick-view-action-read"]').trigger('click')
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'library-reader',
      params: { id: 'audiobooks', remoteId: 'audio 1/with slash' },
      query: { format: 'm4b' },
    })
  })

  it('lets source-backed quick details update favorite, rating, and read status without separate library membership controls', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())

    const { default: CatalogItemQuickView } = await import('../CatalogItemQuickView.vue')
    const wrapper = mount(CatalogItemQuickView, {
      props: { open: true, item: makeItem() },
      ...globalStubs,
    })

    await flushPromises()

    expect(mocks.fetchCatalogSourceUserState).toHaveBeenCalledWith('ebook', 'book 1/with slash')
    expect(wrapper.find('[data-testid="catalog-quick-view-action-in-library"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Add to library')
    expect(wrapper.text()).not.toContain('In library')
    expect(wrapper.text()).toContain('42%')
    expect((wrapper.get('[data-testid="catalog-quick-view-read-status"]').element as HTMLSelectElement).value).toBe('reading')
    expect(wrapper.get('[data-testid="catalog-quick-view-rating-2"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="catalog-quick-view-rating-4"]').attributes('aria-label')).toBe('Set rating to 4 stars')

    await wrapper.get('[data-testid="catalog-quick-view-action-favorite"]').trigger('click')
    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('ebook', 'book 1/with slash', { favorite: true })

    await wrapper.get('[data-testid="catalog-quick-view-rating-4"]').trigger('click')
    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('ebook', 'book 1/with slash', { rating: 4 })

    await wrapper.get('[data-testid="catalog-quick-view-read-status"]').setValue('read')
    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('ebook', 'book 1/with slash', { readStatus: 'read' })
    expect(mocks.patchCatalogSourceUserState).not.toHaveBeenCalledWith(
      'ebook',
      'book 1/with slash',
      expect.objectContaining({ inLibrary: expect.anything() }),
    )
  })

  it('surfaces source-backed quick detail state save failures', async () => {
    mocks.fetchCatalogSourceEbook.mockResolvedValue(makeEbook())
    mocks.patchCatalogSourceUserState.mockRejectedValue(new Error('nope'))

    const { default: CatalogItemQuickView } = await import('../CatalogItemQuickView.vue')
    const wrapper = mount(CatalogItemQuickView, {
      props: { open: true, item: makeItem() },
      ...globalStubs,
    })

    await flushPromises()
    await wrapper.get('[data-testid="catalog-quick-view-action-favorite"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to save library item state')
  })
})
