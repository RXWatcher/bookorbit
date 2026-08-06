import { mount } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCatalogItem, GroupRule, SortSpec } from '@bookorbit/types'
import CatalogBrowseView from '../CatalogBrowseView.vue'
import CatalogAudiobookBrowseView from '../CatalogAudiobookBrowseView.vue'
import CatalogEbookBrowseView from '../CatalogEbookBrowseView.vue'

const push = vi.fn<(to: unknown) => void>()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/components/ViewHeader.vue', () => ({
  default: defineComponent({
    name: 'ViewHeader',
    props: {
      title: { type: String, required: true },
      total: { type: Number, required: true },
      showTotal: { type: Boolean, default: true },
      searchQuery: { type: String, default: '' },
    },
    emits: ['update:searchQuery', 'update:viewMode'],
    setup(props, { emit, slots }) {
      return () =>
        h('header', [
          h('h1', props.title),
          props.showTotal ? h('span', `${props.total.toLocaleString()} titles`) : null,
          h('button', { 'data-testid': 'mock-list-mode', onClick: () => emit('update:viewMode', 'list') }, 'List'),
          h('input', {
            'aria-label':
              props.title === 'Audiobooks' ? 'Search audio library' : props.title === 'Comics' ? 'Search comic library' : 'Search ebook library',
            value: props.searchQuery,
            onInput: (event: Event) => emit('update:searchQuery', (event.target as HTMLInputElement).value),
          }),
          slots.toolbar?.(),
        ])
    },
  }),
}))

vi.mock('@/features/book/components/BookCoverSurface.vue', () => ({
  default: defineComponent({
    name: 'BookCoverSurface',
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => h('div', { ...attrs, class: ['book-cover-surface', attrs.class] }, slots.default?.())
    },
  }),
}))

vi.mock('@/features/book/components/BookCoverArtwork.vue', () => ({
  default: defineComponent({
    name: 'BookCoverArtwork',
    props: {
      title: { type: String, default: '' },
      src: { type: String, default: '' },
      hasCover: { type: Boolean, default: false },
    },
    setup(props) {
      return () => h('img', { src: props.src, alt: props.title, 'data-has-cover': String(props.hasCover) })
    },
  }),
}))

type CatalogComposable<T> = {
  initialLibraryId: unknown
  current: {
    items: Ref<T[]>
    filter: Ref<GroupRule | undefined>
    sort: Ref<SortSpec[]>
    total: Ref<number>
    currentPage: Ref<number>
    limit: Ref<number>
    loading: Ref<boolean>
    error: Ref<string | null>
    search: ReturnType<typeof vi.fn>
    setPage: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
  }
}

const composables = vi.hoisted(() => ({
  ebooks: null as unknown as CatalogComposable<DashboardCatalogItem>,
  audiobooks: null as unknown as CatalogComposable<DashboardCatalogItem>,
  comics: null as unknown as CatalogComposable<DashboardCatalogItem>,
}))

const displaySettings = vi.hoisted(() => ({
  viewMode: null as unknown as Ref<'grid' | 'list' | 'table'>,
}))

vi.mock('@/composables/useDisplaySettings', async () => {
  const vue = await import('vue')
  displaySettings.viewMode = vue.ref<'grid' | 'list' | 'table'>('grid')
  return {
    useDisplaySettings: () => ({
      portraitCoverSize: vue.ref(130),
      squareCoverSize: vue.ref(150),
      portraitGridGap: vue.ref(28),
      squareGridGap: vue.ref(28),
      viewMode: displaySettings.viewMode,
    }),
  }
})

vi.mock('@/features/book/components/BookFilterBuilder.vue', () => ({
  default: defineComponent({
    name: 'BookFilterBuilder',
    props: { modelValue: { type: Object, default: undefined } },
    emits: ['update:modelValue'],
    setup(_, { emit }) {
      return () =>
        h(
          'button',
          {
            'data-testid': 'mock-add-filter',
            onClick: () =>
              emit('update:modelValue', {
                type: 'group',
                join: 'AND',
                rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Visible' }],
              }),
          },
          'Add filter',
        )
    },
  }),
}))

vi.mock('@/features/warehouse/composables/useCatalogLibraryItems', () => ({
  useCatalogLibraryItems: vi.fn<(libraryId: Ref<number | null>) => CatalogComposable<DashboardCatalogItem>['current']>(
    (libraryId: Ref<number | null>) => {
      const id = libraryId.value
      if (id === -2) {
        composables.audiobooks.initialLibraryId = id
        return composables.audiobooks.current
      }
      if (id === -3) {
        composables.comics.initialLibraryId = id
        return composables.comics.current
      }
      composables.ebooks.initialLibraryId = id
      return composables.ebooks.current
    },
  ),
}))

function makeEbook(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'ebook',
    remoteId: 'ebook-1',
    title: 'A Visible Ebook',
    subtitle: 'A catalog title',
    authors: ['Ada Author'],
    narrators: [],
    libraryName: 'Books',
    seriesName: 'Orbit Cycle',
    language: 'en',
    formats: ['epub'],
    hasCover: true,
    addedAt: '2026-06-03T12:00:00.000Z',
    ...overrides,
  }
}

function makeAudiobook(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'audiobook',
    remoteId: 'audio-1',
    title: 'A Visible Audiobook',
    subtitle: null,
    authors: ['Riley Writer'],
    narrators: ['Noor Narrator'],
    libraryName: 'Audiobooks',
    seriesName: 'Listening Cycle',
    language: 'en',
    formats: ['m4b'],
    durationSeconds: 9000,
    hasCover: true,
    addedAt: '2026-06-03T12:00:00.000Z',
    ...overrides,
  }
}

function makeComic(overrides: Partial<DashboardCatalogItem> = {}): DashboardCatalogItem {
  return {
    type: 'catalog-item',
    mediaType: 'comic',
    remoteId: 'comic-1',
    title: 'A Visible Comic',
    subtitle: null,
    authors: ['Casey Artist'],
    narrators: [],
    libraryName: 'Comics',
    seriesName: 'Panel Cycle',
    language: 'en',
    formats: ['cbz'],
    hasCover: true,
    addedAt: '2026-06-03T12:00:00.000Z',
    ...overrides,
  }
}

function makeComposable<T>(items: T[], overrides: Partial<CatalogComposable<T>['current']> = {}): CatalogComposable<T> {
  return {
    initialLibraryId: null,
    current: {
      items: ref(items) as Ref<T[]>,
      filter: ref(undefined),
      sort: ref([{ field: 'title', dir: 'asc' }] as SortSpec[]),
      total: ref(items.length),
      currentPage: ref(1),
      limit: ref(24),
      loading: ref(false),
      error: ref(null),
      search: vi.fn<() => void>(),
      setPage: vi.fn<() => void>(),
      refresh: vi.fn<() => void>(),
      ...overrides,
    },
  }
}

beforeEach(() => {
  push.mockClear()
  displaySettings.viewMode.value = 'grid'
  composables.ebooks = makeComposable(
    [makeEbook(), makeEbook({ remoteId: 'ebook-2', title: 'Second Ebook', authors: [], subtitle: null, seriesName: null, formats: ['pdf'] })],
    { limit: ref(1) },
  )
  composables.audiobooks = makeComposable([makeAudiobook()])
  composables.comics = makeComposable([makeComic()])
})

describe('catalog browse pages', () => {
  it('renders synced ebooks as a native available ebook library with search and paging', async () => {
    const wrapper = mount(CatalogEbookBrowseView)

    expect(wrapper.text()).toContain('Books')
    expect(wrapper.text()).toContain('A Visible Ebook')
    expect(wrapper.text()).toContain('Ada Author')
    expect(wrapper.text()).toContain('Orbit Cycle')
    expect(wrapper.text()).toContain('EPUB')
    expect(wrapper.text()).toContain('2 titles')
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|provider|third-party|upstream|source/i)
    expect(wrapper.get('[data-testid="catalog-library-grid"]').attributes('style')).toContain('repeat(auto-fill')
    expect(wrapper.get('[data-testid="catalog-browse-item-ebook-1"] .book-cover-surface').attributes('style')).toContain('aspect-ratio: 2/3')

    await wrapper.get('input[aria-label="Search ebook library"]').setValue('visible')
    await new Promise((resolve) => setTimeout(resolve, 320))
    expect(composables.ebooks.current.search).toHaveBeenCalled()

    await wrapper.get('button[aria-label="Next page"]').trigger('click')
    expect(composables.ebooks.current.setPage).toHaveBeenCalledWith(2)

    await wrapper.get('[data-testid="catalog-browse-item-ebook-1"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'library-item-detail', params: { id: 'ebooks', remoteId: 'ebook-1' } })
  })

  it('formats large catalog totals for scanning', () => {
    composables.ebooks = makeComposable([makeEbook()], { total: ref(158641), limit: ref(24) })

    const wrapper = mount(CatalogEbookBrowseView)

    expect(wrapper.text()).toContain('158,641 titles')
  })

  it('keeps the empty state hidden while the first catalog page is loading', () => {
    composables.ebooks = makeComposable([], { loading: ref(true), total: ref(0) })

    const wrapper = mount(CatalogEbookBrowseView)

    expect(wrapper.text()).not.toContain('0 titles')
    expect(wrapper.text()).not.toContain('No ebooks are available yet.')
    expect(wrapper.find('.animate-spin').exists()).toBe(true)
  })

  it('renders synced audiobooks with narrator and duration metadata', async () => {
    const wrapper = mount(CatalogAudiobookBrowseView)

    expect(wrapper.text()).toContain('Audiobooks')
    expect(wrapper.text()).toContain('A Visible Audiobook')
    expect(wrapper.text()).toContain('Riley Writer')
    expect(wrapper.text()).toContain('Narrated by Noor Narrator')
    expect(wrapper.text()).toContain('2h 30m')
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|provider|third-party|upstream|source/i)
    expect(wrapper.get('[data-testid="catalog-library-grid"]').attributes('style')).toContain('repeat(auto-fill')
    expect(wrapper.get('[data-testid="catalog-browse-item-audio-1"] .book-cover-surface').attributes('style')).toContain('aspect-ratio: 1/1')

    await wrapper.get('input[aria-label="Search audio library"]').setValue('listen')
    await new Promise((resolve) => setTimeout(resolve, 320))
    expect(composables.audiobooks.current.search).toHaveBeenCalled()

    await wrapper.get('[data-testid="catalog-browse-item-audio-1"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'library-item-detail', params: { id: 'audiobooks', remoteId: 'audio-1' } })
  })

  it('renders synced comics as a native available comic library', async () => {
    composables.comics = makeComposable([makeComic({ hasCover: false })])

    const wrapper = mount(CatalogBrowseView, {
      props: {
        libraryId: -3,
        mediaType: 'comic',
        title: 'Comics',
        subtitle: 'Browse comics ready to add to your library.',
        searchLabel: 'Search comic library',
        emptyTitle: 'No comics are available yet.',
        emptyDetail: 'New comics will appear here when they are ready.',
      },
    })

    expect(composables.comics.initialLibraryId).toBe(-3)
    expect(wrapper.text()).toContain('Comics')
    expect(wrapper.text()).toContain('A Visible Comic')
    expect(wrapper.text()).toContain('Casey Artist')
    expect(wrapper.text()).toContain('Panel Cycle')
    expect(wrapper.text()).toContain('CBZ')
    expect(wrapper.text()).toContain('1 title')
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|provider|third-party|upstream|source/i)
    expect(wrapper.get('img[alt="A Visible Comic"]').attributes('src')).toBe('/api/v1/libraries/comics/items/comic-1/pages/0')
    expect(wrapper.get('img[alt="A Visible Comic"]').attributes('data-has-cover')).toBe('true')

    await wrapper.get('input[aria-label="Search comic library"]').setValue('panel')
    await new Promise((resolve) => setTimeout(resolve, 320))
    expect(composables.comics.current.search).toHaveBeenCalled()

    await wrapper.get('[data-testid="catalog-browse-item-comic-1"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'library-item-detail', params: { id: 'comics', remoteId: 'comic-1' } })
  })

  it('renders source-backed libraries in list mode when the library view mode is list', async () => {
    displaySettings.viewMode.value = 'list'

    const wrapper = mount(CatalogEbookBrowseView)

    expect(wrapper.find('[data-testid="catalog-library-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="catalog-library-list"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="catalog-list-item-ebook-1"]').text()).toContain('A Visible Ebook')
    expect(wrapper.get('[data-testid="catalog-list-item-ebook-1"]').text()).toContain('Ada Author')
    expect(wrapper.get('[data-testid="catalog-list-item-ebook-1"]').text()).toContain('Orbit Cycle')
    expect(wrapper.get('[data-testid="catalog-list-item-ebook-1"]').text()).toContain('EPUB')

    await wrapper.get('[data-testid="catalog-list-item-ebook-1"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ name: 'library-item-detail', params: { id: 'ebooks', remoteId: 'ebook-1' } })
  })

  it('switches source-backed libraries from grid to list when the view mode changes', async () => {
    const wrapper = mount(CatalogEbookBrowseView)

    expect(wrapper.find('[data-testid="catalog-library-grid"]').exists()).toBe(true)

    await wrapper.get('[data-testid="mock-list-mode"]').trigger('click')

    expect(wrapper.find('[data-testid="catalog-library-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="catalog-library-list"]').exists()).toBe(true)
  })

  it('opens native filter rules for source-backed library pages', async () => {
    const wrapper = mount(CatalogEbookBrowseView)

    const filtersButton = wrapper.findAll('button').find((button) => button.text().includes('Filters'))
    expect(filtersButton).toBeTruthy()
    await filtersButton!.trigger('click')

    expect(wrapper.text()).toContain('Filter rules')
    await wrapper.get('[data-testid="mock-add-filter"]').trigger('click')

    expect(composables.ebooks.current.filter.value).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Visible' }],
    })
    expect(composables.ebooks.current.search).toHaveBeenCalled()
  })

  it('shows a native empty state when a catalog has not populated yet', () => {
    composables.audiobooks = makeComposable([])

    const wrapper = mount(CatalogAudiobookBrowseView)

    expect(wrapper.text()).toContain('No audiobooks are available yet.')
    expect(wrapper.text()).toContain('New audiobooks will appear here when they are ready.')
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|provider|third-party|upstream|source|sync/i)
  })

  it('shows native empty copy for ebook libraries too', () => {
    composables.ebooks = makeComposable([])

    const wrapper = mount(CatalogEbookBrowseView)

    expect(wrapper.text()).toContain('No ebooks are available yet.')
    expect(wrapper.text()).toContain('New ebooks will appear here when they are ready.')
    expect(wrapper.text()).not.toMatch(/Book Warehouse|warehouse|provider|third-party|upstream|source|sync/i)
  })
})
