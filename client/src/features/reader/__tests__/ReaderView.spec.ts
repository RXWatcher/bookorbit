import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'

const mockRoute: {
  name: string
  params: Record<string, string>
  query: Record<string, string>
} = {
  name: 'library-reader',
  params: { id: String(CLOUD_EBOOK_LIBRARY_ID), remoteId: 'remote-7' },
  query: { format: 'pdf' },
}

const readerMocks = vi.hoisted(() => ({
  openFromUrl: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  fetchCatalogSourceAnnotations: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  fetchCatalogSourceBookmarks: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  createCatalogSourceAnnotation: vi.fn<() => Promise<never>>(),
  createCatalogSourceBookmark: vi.fn<() => Promise<never>>(),
  deleteCatalogSourceAnnotation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  deleteCatalogSourceBookmark: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  updateCatalogSourceAnnotation: vi.fn<() => Promise<never>>(),
  bookmarksLoad: vi.fn<() => Promise<void>>(),
  annotationsLoad: vi.fn<() => Promise<void>>(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    back: vi.fn<() => void>(),
    replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: { info: vi.fn<() => void>() },
}))

vi.mock('../pdf-v4/PdfV4ReaderView.vue', () => ({
  // defineAsyncComponent only unwraps `default` when the resolved module is
  // marked as ESM; without this Vue treats the namespace object as the
  // component and probes it for internal flags that the mock cannot provide.
  __esModule: true,
  default: defineComponent({
    name: 'PdfV4ReaderView',
    setup(_, { attrs }) {
      return () => h('div', { 'data-testid': 'pdf-reader', ...attrs })
    },
  }),
}))

vi.mock('../cbz/CbzReaderView.vue', () => ({
  default: defineComponent({
    name: 'CbzReaderView',
    props: {
      catalogSource: { type: Object, default: undefined },
      settingsStorageKey: { type: String, default: undefined },
      readerRouteName: { type: String, default: undefined },
    },
    setup(props) {
      return () =>
        h('div', {
          'data-testid': 'cbz-reader',
          'data-catalog-source': JSON.stringify(props.catalogSource ?? null),
          'data-settings-storage-key': props.settingsStorageKey,
          'data-reader-route-name': props.readerRouteName,
        })
    },
  }),
}))

vi.mock('../audiobook/AudiobookReaderView.vue', () => ({
  default: defineComponent({
    name: 'AudiobookReaderView',
    props: {
      catalogMediaType: { type: String, default: undefined },
      catalogRemoteId: { type: String, default: undefined },
      catalogFormat: { type: String, default: undefined },
    },
    setup(props) {
      return () =>
        h('div', {
          'data-testid': 'audio-reader',
          'data-catalog-media-type': props.catalogMediaType,
          'data-catalog-remote-id': props.catalogRemoteId,
          'data-catalog-format': props.catalogFormat,
        })
    },
  }),
}))

function readerStub(name: string) {
  return defineComponent({
    name,
    setup() {
      return () => h('div')
    },
  })
}

vi.mock('../epub/components/ReaderHeader.vue', () => ({ default: readerStub('ReaderHeader') }))
vi.mock('../epub/components/ReaderFooter.vue', () => ({ default: readerStub('ReaderFooter') }))
vi.mock('../epub/components/ReaderSidebar.vue', () => ({ default: readerStub('ReaderSidebar') }))
vi.mock('../epub/components/ReaderSettingsPanel.vue', () => ({ default: readerStub('ReaderSettingsPanel') }))
vi.mock('../epub/components/SelectionPopup.vue', () => ({ default: readerStub('SelectionPopup') }))
vi.mock('../epub/components/ReaderSearchPanel.vue', () => ({ default: readerStub('ReaderSearchPanel') }))
vi.mock('../epub/components/NoteDialog.vue', () => ({ default: readerStub('NoteDialog') }))
vi.mock('../epub/components/DictionaryPopover.vue', () => ({ default: readerStub('DictionaryPopover') }))
vi.mock('../epub/components/TranslationPopover.vue', () => ({ default: readerStub('TranslationPopover') }))
vi.mock('../epub/components/TranslationSheet.vue', () => ({ default: readerStub('TranslationSheet') }))
vi.mock('../epub/components/KeyboardShortcutsModal.vue', () => ({ default: readerStub('KeyboardShortcutsModal') }))

vi.mock('../epub/composables/useFoliate', () => ({
  useFoliate: () => ({
    loading: ref(false),
    error: ref(null),
    open: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    openFromUrl: readerMocks.openFromUrl,
    goTo: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    goToFraction: vi.fn<() => void>(),
    goToSection: vi.fn<() => void>(),
    getSectionFractions: () => [],
    getChapters: () => [],
    getLocationContext: vi.fn<() => Promise<{ chapterTitle: null; fraction: null }>>().mockResolvedValue({ chapterTitle: null, fraction: null }),
    getRenderer: () => null,
    addAnnotation: vi.fn<() => void>(),
    addAnnotations: vi.fn<() => void>(),
    deleteAnnotation: vi.fn<() => void>(),
    setAnnotationClickHandler: vi.fn<() => void>(),
    setTextSelectedHandler: vi.fn<() => void>(),
    view: ref(null),
    bookLanguage: ref(null),
  }),
}))

vi.mock('../shared/composables/useReaderProgress', () => ({
  useReaderProgress: () => ({
    cfi: ref(null),
    chapterTitle: ref(''),
    sectionIndex: ref(0),
    totalSections: ref(0),
    fraction: ref(0),
    locationTotal: ref(0),
    footerMode: ref('percentage'),
    pageNumber: ref(null),
    percentage: ref(0),
    cycleFooterMode: vi.fn<() => void>(),
    updateHeadsFeet: vi.fn<() => void>(),
    onRelocate: vi.fn<() => void>(),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    save: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('../shared/composables/useReadingSession', () => ({
  useReadingSession: () => ({
    onActivity: vi.fn<() => void>(),
    elapsedMinutes: ref(0),
  }),
}))

vi.mock('../epub/composables/useReaderState', () => ({
  useReaderState: () => ({
    state: ref({}),
    activeMode: ref({ bg: '#fff' }),
    isDark: ref(false),
    applyToRenderer: vi.fn<() => void>(),
    setFontSize: vi.fn<() => void>(),
    setLineHeight: vi.fn<() => void>(),
    setFontFamily: vi.fn<() => void>(),
    setMaxColumnCount: vi.fn<() => void>(),
    setGap: vi.fn<() => void>(),
    setMaxInlineSize: vi.fn<() => void>(),
    setMaxBlockSize: vi.fn<() => void>(),
    setJustify: vi.fn<() => void>(),
    setHyphenate: vi.fn<() => void>(),
    setIsDark: vi.fn<() => void>(),
    setThemeName: vi.fn<() => void>(),
    setFlow: vi.fn<() => void>(),
    setFontFaceCSS: vi.fn<() => void>(),
  }),
}))

vi.mock('../shared/composables/useReaderSettings', () => ({
  useReaderSettings: () => ({
    effective: ref({ footerDisplayMode: 'percentage', overrideBookFormatting: false }),
    isCustomized: ref(false),
    bookDelta: ref({}),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    updateBookSettings: vi.fn<() => void>(),
  }),
}))

vi.mock('../epub/composables/useCustomFonts', () => ({
  useCustomFonts: () => ({
    fonts: ref([]),
    serverFonts: ref([]),
    fetchFonts: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    fetchAllFonts: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ensureCssFamilyLoaded: vi.fn<(family: string) => Promise<void>>().mockResolvedValue(undefined),
    generateFontFaceCSS: () => '',
  }),
}))

vi.mock('../shared/composables/useVisibility', () => ({
  useVisibility: () => ({
    headerVisible: ref(true),
    footerVisible: ref(true),
    handleMiddleTap: vi.fn<() => void>(),
    setVisibilityLock: vi.fn<() => void>(),
  }),
}))

vi.mock('../shared/composables/useWakeLock', () => ({
  useWakeLock: vi.fn<() => void>(),
}))

vi.mock('../epub/composables/useBookmarks', () => ({
  useBookmarks: (store?: {
    load?: () => Promise<unknown[]>
    create?: (payload: unknown) => Promise<unknown>
    remove?: (id: number) => Promise<void>
  }) => {
    const bookmarks = ref<unknown[]>([])
    readerMocks.bookmarksLoad.mockImplementation(async () => {
      bookmarks.value = store?.load ? await store.load() : []
    })

    return {
      bookmarks,
      isCurrentCfiBookmarked: ref(false),
      load: readerMocks.bookmarksLoad,
      toggle: vi.fn<(_bookId: number, cfi: string, title: string) => Promise<void>>(async (_bookId, cfi, title) => {
        if (store?.create) bookmarks.value = [...bookmarks.value, await store.create({ cfi, title })]
      }),
      setCfi: vi.fn<() => void>(),
      remove: vi.fn<(_bookId: number, id: number) => Promise<void>>(async (_bookId, id) => {
        if (store?.remove) await store.remove(id)
      }),
    }
  },
}))

vi.mock('../epub/composables/useAnnotations', () => ({
  useAnnotations: (store?: {
    load?: () => Promise<unknown[]>
    create?: (payload: unknown) => Promise<unknown>
    updateNote?: (id: number, note: string | null) => Promise<unknown>
    remove?: (id: number) => Promise<void>
  }) => {
    const annotations = ref<unknown[]>([])
    readerMocks.annotationsLoad.mockImplementation(async () => {
      annotations.value = store?.load ? await store.load() : []
    })

    return {
      annotations,
      load: readerMocks.annotationsLoad,
      create: vi.fn<(_bookId: number, payload: unknown) => Promise<unknown | null>>(async (_bookId, payload) => {
        if (!store?.create) return null
        const created = await store.create(payload)
        annotations.value = [...annotations.value, created]
        return created
      }),
      updateNote: vi.fn<(_bookId: number, id: number, note: string | null) => Promise<void>>(async (_bookId, id, note) => {
        await store?.updateNote?.(id, note)
      }),
      remove: vi.fn<(_bookId: number, id: number) => Promise<void>>(async (_bookId, id) => {
        if (store?.remove) await store.remove(id)
      }),
    }
  },
}))

vi.mock('../epub/composables/useToc', () => ({
  useToc: () => ({
    chapters: ref([]),
    expandedHrefs: ref(new Set()),
    activeHref: ref(''),
    setChapters: vi.fn<() => void>(),
    setActiveHref: vi.fn<() => void>(),
    toggleExpand: vi.fn<() => void>(),
  }),
}))

vi.mock('../epub/composables/useSearch', () => ({
  useSearch: () => ({
    results: ref([]),
    isSearching: ref(false),
    search: vi.fn<() => void>(),
    clear: vi.fn<() => void>(),
  }),
}))

vi.mock('../epub/composables/useReaderSelection', () => ({
  useReaderSelection: () => ({
    visible: ref(false),
    text: ref(''),
    cfi: ref(null),
    position: ref({ x: 0, y: 0 }),
    showBelow: ref(false),
    overlappingAnnotationId: ref(null),
    showNoteDialog: ref(false),
    noteText: ref(''),
    show: vi.fn<() => void>(),
    openNoteDialog: vi.fn<() => void>(),
    dismiss: vi.fn<() => void>(),
  }),
}))

vi.mock('../epub/composables/useReaderKeyboardShortcuts', () => ({
  useReaderKeyboardShortcuts: () => ({
    showHelpModal: ref(false),
  }),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  catalogSourceEbookDownloadUrl: (remoteId: string) => `/api/v1/catalog/ebooks/${remoteId}/download`,
  catalogSourceComicDownloadUrl: (remoteId: string) => `/api/v1/libraries/comics/items/${remoteId}/download`,
  createCatalogSourceAnnotation: readerMocks.createCatalogSourceAnnotation,
  createCatalogSourceBookmark: readerMocks.createCatalogSourceBookmark,
  deleteCatalogSourceAnnotation: readerMocks.deleteCatalogSourceAnnotation,
  deleteCatalogSourceBookmark: readerMocks.deleteCatalogSourceBookmark,
  fetchCatalogSourceAnnotations: readerMocks.fetchCatalogSourceAnnotations,
  fetchCatalogSourceBookmarks: readerMocks.fetchCatalogSourceBookmarks,
  fetchCatalogSourceUserState: vi.fn<() => Promise<{ readStatus: null; progressPercent: number }>>().mockResolvedValue({
    readStatus: null,
    progressPercent: 0,
  }),
  patchCatalogSourceUserState: vi.fn<() => Promise<{ readStatus: 'reading' }>>().mockResolvedValue({ readStatus: 'reading' }),
  saveCatalogSourceReadingSession: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  updateCatalogSourceAnnotation: vi.fn<() => Promise<never>>(),
}))

const { default: ReaderView } = await import('../ReaderView.vue')

describe('ReaderView catalog reader gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoute.name = 'library-reader'
    mockRoute.params = { id: String(CLOUD_EBOOK_LIBRARY_ID), remoteId: 'remote-7' }
    mockRoute.query = { format: 'pdf' }
  })

  it('opens catalog PDFs as reader items', async () => {
    const wrapper = mount(ReaderView)
    await flushPromises()

    expect(wrapper.find('[data-testid="pdf-reader"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })

  it('opens catalog PDFs from friendly native library reader aliases', async () => {
    mockRoute.params = { id: 'ebooks', remoteId: 'remote-7' }

    const wrapper = mount(ReaderView)
    await flushPromises()

    expect(wrapper.find('[data-testid="pdf-reader"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })

  it('loads catalog EPUB bookmarks and annotations from warehouse stores', async () => {
    mockRoute.query = { format: 'epub' }
    readerMocks.fetchCatalogSourceBookmarks.mockResolvedValue([
      {
        id: 17,
        mediaType: 'ebook',
        remoteId: 'remote-7',
        cfi: 'epubcfi(/6/2)',
        title: 'Chapter One',
        positionSeconds: null,
        createdAt: '2026-06-01T12:00:00.000Z',
      },
    ])
    readerMocks.fetchCatalogSourceAnnotations.mockResolvedValue([
      {
        id: 31,
        mediaType: 'ebook',
        remoteId: 'remote-7',
        cfi: 'epubcfi(/6/4)',
        text: 'Highlighted text',
        color: '#FACC15',
        style: 'highlight',
        note: null,
        chapterTitle: 'Chapter One',
        createdAt: '2026-06-01T12:01:00.000Z',
        updatedAt: '2026-06-01T12:01:00.000Z',
      },
    ])

    const wrapper = mount(ReaderView)
    await flushPromises()

    expect(readerMocks.openFromUrl).toHaveBeenCalledWith('/api/v1/catalog/ebooks/remote-7/download', 'epub', 'remote-7', null, undefined)
    expect(readerMocks.fetchCatalogSourceBookmarks).toHaveBeenCalledWith('ebook', 'remote-7')
    expect(readerMocks.fetchCatalogSourceAnnotations).toHaveBeenCalledWith('ebook', 'remote-7')
    expect(readerMocks.bookmarksLoad).toHaveBeenCalledWith(0)
    expect(readerMocks.annotationsLoad).toHaveBeenCalledWith(0)
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })

  it('opens catalog comic archives as reader items', async () => {
    mockRoute.query = { format: 'cbz' }

    const wrapper = mount(ReaderView)
    await flushPromises()

    const comicReader = wrapper.get('[data-testid="cbz-reader"]')
    expect(comicReader.attributes('data-catalog-source')).toBe(JSON.stringify({ mediaType: 'ebook', remoteId: 'remote-7', format: 'cbz' }))
    expect(comicReader.attributes('data-settings-storage-key')).toBe('reader:catalog:ebook:remote-7:cbz')
    expect(comicReader.attributes('data-reader-route-name')).toBe('library-reader')
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })

  it('opens catalog comic archives from the Comic Library reader route', async () => {
    mockRoute.params = { id: String(CLOUD_COMIC_LIBRARY_ID), remoteId: 'comic-7' }
    mockRoute.query = { format: 'cb7' }

    const wrapper = mount(ReaderView)
    await flushPromises()

    const comicReader = wrapper.get('[data-testid="cbz-reader"]')
    expect(comicReader.attributes('data-catalog-source')).toBe(JSON.stringify({ mediaType: 'comic', remoteId: 'comic-7', format: 'cb7' }))
    expect(comicReader.attributes('data-settings-storage-key')).toBe('reader:catalog:comic:comic-7:cbz')
    expect(comicReader.attributes('data-reader-route-name')).toBe('library-reader')
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })

  it('opens catalog comic archives from friendly Comic Library reader aliases', async () => {
    mockRoute.params = { id: 'comics', remoteId: 'comic-7' }
    mockRoute.query = { format: 'cbr' }

    const wrapper = mount(ReaderView)
    await flushPromises()

    const comicReader = wrapper.get('[data-testid="cbz-reader"]')
    expect(comicReader.attributes('data-catalog-source')).toBe(JSON.stringify({ mediaType: 'comic', remoteId: 'comic-7', format: 'cbr' }))
    expect(comicReader.attributes('data-settings-storage-key')).toBe('reader:catalog:comic:comic-7:cbz')
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })

  it('opens catalog audiobooks as reader items', async () => {
    mockRoute.params = { id: String(CLOUD_AUDIO_LIBRARY_ID), remoteId: 'audio-7' }
    mockRoute.query = { format: 'mp3' }

    const wrapper = mount(ReaderView)
    await flushPromises()

    const audioReader = wrapper.get('[data-testid="audio-reader"]')
    expect(audioReader.attributes('data-catalog-media-type')).toBe('audiobook')
    expect(audioReader.attributes('data-catalog-remote-id')).toBe('audio-7')
    expect(audioReader.attributes('data-catalog-format')).toBe('mp3')
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })

  it('opens catalog audiobooks from friendly native library reader aliases', async () => {
    mockRoute.params = { id: 'audiobooks', remoteId: 'audio-7' }
    mockRoute.query = { format: 'mp3' }

    const wrapper = mount(ReaderView)
    await flushPromises()

    const audioReader = wrapper.get('[data-testid="audio-reader"]')
    expect(audioReader.attributes('data-catalog-media-type')).toBe('audiobook')
    expect(audioReader.attributes('data-catalog-remote-id')).toBe('audio-7')
    expect(audioReader.attributes('data-catalog-format')).toBe('mp3')
    expect(wrapper.text()).not.toContain('Reader unavailable')
  })
})
