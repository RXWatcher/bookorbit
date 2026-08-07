import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, type Library } from '@bookorbit/types'
import AppSidebar from '../AppSidebar.vue'

const routerPush = vi.hoisted(() => vi.fn<(to: { name: string; params?: Record<string, string | number> }) => void>())
const currentRoute = vi.hoisted(() => ({
  name: 'dashboard' as string,
  params: {} as Record<string, string>,
}))
const librariesRef = vi.hoisted(() => ({ value: [] as Library[] }))
const reorderLibrariesMock = vi.hoisted(() => vi.fn<(order: { id: number; displayOrder: number }[]) => Promise<void>>().mockResolvedValue(undefined))
const draggableSources = vi.hoisted(() => [] as Array<{ source: unknown; persist: (order: { id: number; displayOrder: number }[]) => Promise<void> }>)

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  useRoute: () => currentRoute,
}))

vi.mock('@/components/ui/sidebar', () => {
  const passthrough = (name: string) =>
    defineComponent({
      name,
      setup(_, { slots }) {
        return () => h('div', { 'data-testid': name }, slots.default?.())
      },
    })

  return {
    Sidebar: passthrough('Sidebar'),
    SidebarContent: passthrough('SidebarContent'),
    SidebarFooter: passthrough('SidebarFooter'),
    SidebarGroup: passthrough('SidebarGroup'),
    SidebarGroupContent: passthrough('SidebarGroupContent'),
    SidebarHeader: passthrough('SidebarHeader'),
    SidebarMenu: passthrough('SidebarMenu'),
    SidebarRail: passthrough('SidebarRail'),
    SidebarSeparator: passthrough('SidebarSeparator'),
    useSidebar: () => ({ isMobile: ref(false), setOpenMobile: vi.fn<(open: boolean) => void>() }),
  }
})

vi.mock('@/components/sidebar/SidebarNavItem.vue', () => ({
  default: defineComponent({
    name: 'SidebarNavItem',
    props: {
      isActive: { type: Boolean, default: false },
      label: { type: String, required: true },
      tooltip: { type: String, default: '' },
    },
    emits: ['click'],
    setup(props, { emit, slots }) {
      return () =>
        h(
          'button',
          {
            'aria-current': props.isActive ? 'page' : undefined,
            'data-active': String(props.isActive),
            title: props.tooltip,
            onClick: () => emit('click'),
          },
          [props.label, slots.badge?.()],
        )
    },
  }),
}))

vi.mock('@/components/sidebar/SidebarSectionHeader.vue', () => ({
  default: defineComponent({
    name: 'SidebarSectionHeader',
    props: { label: { type: String, required: true } },
    emits: ['toggle-reorder'],
    setup(props, { emit }) {
      return () => h('div', [props.label, h('button', { type: 'button', onClick: () => emit('toggle-reorder') }, `reorder-${props.label}`)])
    },
  }),
}))

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: defineComponent({
    name: 'VueDraggable',
    setup(_, { slots }) {
      return () => h('div', slots.default?.())
    },
  }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: vi.fn<(options?: { includeSourceBacked?: boolean }) => unknown>((options?: { includeSourceBacked?: boolean }) => ({
    libraries: options?.includeSourceBacked ? ref(librariesRef.value) : ref([]),
    fetchLibraries: vi.fn<() => void>(),
    refreshLibraries: vi.fn<() => void>(),
    reorderLibraries: reorderLibrariesMock,
  })),
}))

vi.mock('@/features/warehouse/composables/useCatalogSourceEbooks', () => ({
  useCatalogSourceEbooks: () => ({
    total: ref(158641),
    loading: ref(false),
    error: ref(null),
  }),
}))

vi.mock('@/features/warehouse/composables/useCatalogSourceAudiobooks', () => ({
  useCatalogSourceAudiobooks: () => ({
    total: ref(24000),
    loading: ref(false),
    error: ref(null),
  }),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({
    smartScopes: ref([]),
    fetchSmartScopes: vi.fn<() => void>(),
    reorderSmartScopes: vi.fn<() => void>(),
  }),
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({
    collections: ref([]),
    fetchCollections: vi.fn<() => void>(),
    reorderCollections: vi.fn<() => void>(),
  }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: vi.fn<() => boolean>(() => false),
  }),
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  getSocket: vi.fn<() => void>(),
  useScanProgress: () => ({
    subscribeLibrary: vi.fn<() => void>(),
    getProgress: vi.fn<() => null>(() => null),
    progressMap: ref(new Map()),
  }),
}))

vi.mock('@/features/library/composables/useLibraryUploadEvents', () => ({
  useLibraryUploadEvents: () => ({
    onLibraryUploadCompleted: vi.fn<() => () => void>(() => vi.fn<() => void>()),
  }),
}))

vi.mock('@/composables/useDraggableOrder', () => ({
  useDraggableOrder: ({
    source,
    persist,
  }: {
    source: { value: Array<{ id: number }> }
    persist: (order: { id: number; displayOrder: number }[]) => Promise<void>
  }) => {
    draggableSources.push({ source, persist })
    return {
      localItems: source,
      onDragStart: vi.fn<() => void>(),
      onDragEnd: vi.fn<() => void>(),
    }
  },
}))

vi.mock('@/features/library/composables/useLibraryCreationRedirect', () => ({
  useLibraryCreationRedirect: () => ({ handleLibraryCreated: vi.fn<() => void>() }),
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ radius: 'rounded' }),
}))

vi.mock('@/features/settings/composables/useAppInfo', () => ({
  useAppInfo: () => ({
    version: ref('1.0.0'),
    updateAvailable: ref(false),
    latestVersion: ref(null),
    loadAppInfo: vi.fn<() => void>(),
  }),
}))

vi.mock('@/components/sidebar/versionUi', () => ({
  buildSidebarVersionUi: () => computed(() => null),
}))

vi.mock('@/features/smart-scope/components/CreateSmartScopeDialog.vue', () => ({ default: defineComponent({ template: '<div />' }) }))
vi.mock('@/features/collection/components/CreateCollectionDialog.vue', () => ({ default: defineComponent({ template: '<div />' }) }))
vi.mock('@/features/library/components/LibraryCreatorModal.vue', () => ({ default: defineComponent({ template: '<div />' }) }))

function buttonByText(wrapper: ReturnType<typeof mount<typeof AppSidebar>>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === label)
  expect(button).toBeDefined()
  return button!
}

function mountSidebar() {
  return mount(AppSidebar, {
    global: {
      stubs: {
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('AppSidebar catalog navigation', () => {
  beforeEach(() => {
    routerPush.mockClear()
    reorderLibrariesMock.mockClear()
    draggableSources.length = 0
    localStorage.clear()
    currentRoute.name = 'requests'
    currentRoute.params = {}
    librariesRef.value = [
      {
        id: CLOUD_EBOOK_LIBRARY_ID,
        name: 'Ebook Library',
        sourceKind: 'source_backed',
        icon: 'BookOpen',
        displayOrder: -20,
        coverAspectRatio: '2/3',
        watch: false,
        metadataPrecedence: [],
        formatPriority: [],
        allowedFormats: [],
        organizationMode: 'book_per_folder',
        excludePatterns: [],
        readingThreshold: 0.25,
        markAsFinishedPercentComplete: 98,
        fileWriteEnabled: false,
        fileWriteWriteCover: false,
        fileWriteEpubEnabled: false,
        fileWriteEpubMaxFileSizeMb: 100,
        fileWritePdfEnabled: false,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteFb2Enabled: false,
        fileWriteFb2MaxFileSizeMb: 100,
        fileWriteKindleEnabled: false,
        fileWriteKindleMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteAudioEnabled: false,
        fileWriteAudioMaxFileSizeMb: 500,
        fileRenameEnabled: false,
        folders: [],
        bookCount: 158641,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
      {
        id: CLOUD_AUDIO_LIBRARY_ID,
        name: 'Audio Library',
        sourceKind: 'source_backed',
        icon: 'Headphones',
        displayOrder: -10,
        coverAspectRatio: '1/1',
        watch: false,
        metadataPrecedence: [],
        formatPriority: [],
        allowedFormats: [],
        organizationMode: 'book_per_folder',
        excludePatterns: [],
        readingThreshold: 0.25,
        markAsFinishedPercentComplete: 98,
        fileWriteEnabled: false,
        fileWriteWriteCover: false,
        fileWriteEpubEnabled: false,
        fileWriteEpubMaxFileSizeMb: 100,
        fileWritePdfEnabled: false,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteFb2Enabled: false,
        fileWriteFb2MaxFileSizeMb: 100,
        fileWriteKindleEnabled: false,
        fileWriteKindleMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteAudioEnabled: false,
        fileWriteAudioMaxFileSizeMb: 500,
        fileRenameEnabled: false,
        folders: [],
        bookCount: 24000,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
      {
        id: CLOUD_COMIC_LIBRARY_ID,
        name: 'Comic Library',
        sourceKind: 'source_backed',
        icon: 'PanelsTopLeft',
        displayOrder: -5,
        coverAspectRatio: '2/3',
        watch: false,
        metadataPrecedence: [],
        formatPriority: [],
        allowedFormats: [],
        organizationMode: 'book_per_folder',
        excludePatterns: [],
        readingThreshold: 0.25,
        markAsFinishedPercentComplete: 98,
        fileWriteEnabled: false,
        fileWriteWriteCover: false,
        fileWriteEpubEnabled: false,
        fileWriteEpubMaxFileSizeMb: 100,
        fileWritePdfEnabled: false,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteFb2Enabled: false,
        fileWriteFb2MaxFileSizeMb: 100,
        fileWriteKindleEnabled: false,
        fileWriteKindleMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteAudioEnabled: false,
        fileWriteAudioMaxFileSizeMb: 500,
        fileRenameEnabled: false,
        folders: [],
        bookCount: 12000,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
      {
        id: 9,
        name: 'Filesystem Library',
        sourceKind: 'filesystem',
        icon: 'BookCopy',
        displayOrder: 0,
        coverAspectRatio: '2/3',
        watch: false,
        metadataPrecedence: [],
        formatPriority: [],
        allowedFormats: [],
        organizationMode: 'book_per_folder',
        excludePatterns: [],
        readingThreshold: 0.25,
        markAsFinishedPercentComplete: 98,
        fileWriteEnabled: false,
        fileWriteWriteCover: false,
        fileWriteEpubEnabled: false,
        fileWriteEpubMaxFileSizeMb: 100,
        fileWritePdfEnabled: false,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteFb2Enabled: false,
        fileWriteFb2MaxFileSizeMb: 100,
        fileWriteKindleEnabled: false,
        fileWriteKindleMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteAudioEnabled: false,
        fileWriteAudioMaxFileSizeMb: 500,
        fileRenameEnabled: false,
        folders: [],
        bookCount: 4,
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    ]
  })

  it('renders Requests for regular users, navigates there, and marks it active', async () => {
    const wrapper = mountSidebar()
    const requestsButton = wrapper.findAll('button').find((button) => button.text() === 'Requests')

    expect(requestsButton).toBeDefined()
    expect(requestsButton!.attributes('title')).toBe('Requests')
    expect(requestsButton!.attributes('aria-current')).toBe('page')

    await requestsButton!.trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'requests' })
  })

  it('renders source-backed ebook, audiobook, and comic shelves inside the Libraries section for regular users', async () => {
    currentRoute.name = 'library'
    currentRoute.params = { id: 'comics' }
    const [ebooksLibrary, audiobooksLibrary, comicsLibrary, filesystemLibrary] = librariesRef.value as [Library, Library, Library, Library]
    librariesRef.value = [ebooksLibrary, filesystemLibrary, audiobooksLibrary, comicsLibrary]
    const wrapper = mountSidebar()
    const ebooksButton = wrapper.findAll('button').find((button) => button.attributes('title') === 'Ebook Library')
    const audiobooksButton = wrapper.findAll('button').find((button) => button.attributes('title') === 'Audio Library')
    const comicsButton = wrapper.findAll('button').find((button) => button.attributes('title') === 'Comic Library')
    const buttonTitles = wrapper.findAll('button').map((button) => button.attributes('title') ?? button.text())

    expect(ebooksButton).toBeDefined()
    expect(ebooksButton!.attributes('title')).toBe('Ebook Library')
    expect(audiobooksButton).toBeDefined()
    expect(audiobooksButton!.attributes('title')).toBe('Audio Library')
    expect(comicsButton).toBeDefined()
    expect(comicsButton!.attributes('title')).toBe('Comic Library')
    expect(comicsButton!.attributes('aria-current')).toBe('page')
    expect(buttonTitles.indexOf('Ebook Library')).toBeGreaterThan(buttonTitles.indexOf('Requests'))
    expect(buttonTitles.indexOf('Filesystem Library')).toBeGreaterThan(buttonTitles.indexOf('Ebook Library'))
    expect(buttonTitles.indexOf('Audio Library')).toBeGreaterThan(buttonTitles.indexOf('Filesystem Library'))
    expect(buttonTitles.indexOf('Comic Library')).toBeGreaterThan(buttonTitles.indexOf('Audio Library'))
    expect(buttonTitles.filter((label) => ['Ebook Library', 'Filesystem Library', 'Audio Library', 'Comic Library'].includes(label))).toEqual([
      'Ebook Library',
      'Filesystem Library',
      'Audio Library',
      'Comic Library',
    ])
    expect(draggableSources[0]?.source).toEqual(
      expect.objectContaining({
        value: [
          expect.objectContaining({ id: CLOUD_EBOOK_LIBRARY_ID, name: 'Ebook Library' }),
          expect.objectContaining({ id: 9, name: 'Filesystem Library' }),
          expect.objectContaining({ id: CLOUD_AUDIO_LIBRARY_ID, name: 'Audio Library' }),
          expect.objectContaining({ id: CLOUD_COMIC_LIBRARY_ID, name: 'Comic Library' }),
        ],
      }),
    )

    await ebooksButton!.trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'library', params: { id: 'ebooks' } })

    await audiobooksButton!.trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'library', params: { id: 'audiobooks' } })

    await comicsButton!.trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'library', params: { id: 'comics' } })
  })

  it('persists mixed source-backed and filesystem library sidebar order without sending virtual ids to the server', async () => {
    mountSidebar()

    await draggableSources[0]!.persist([
      { id: CLOUD_AUDIO_LIBRARY_ID, displayOrder: 0 },
      { id: 9, displayOrder: 1 },
      { id: CLOUD_EBOOK_LIBRARY_ID, displayOrder: 2 },
      { id: CLOUD_COMIC_LIBRARY_ID, displayOrder: 3 },
    ])

    expect(JSON.parse(localStorage.getItem('bookorbit:sidebar:libraries:order') ?? '[]')).toEqual([
      CLOUD_AUDIO_LIBRARY_ID,
      9,
      CLOUD_EBOOK_LIBRARY_ID,
      CLOUD_COMIC_LIBRARY_ID,
    ])
    expect(reorderLibrariesMock).toHaveBeenCalledWith([{ id: 9, displayOrder: 1 }])
  })

  it('keeps Comic Library active on normal library-owned detail and reader routes', () => {
    currentRoute.name = 'library-item-detail'
    currentRoute.params = { id: 'comics', remoteId: 'comic-1' }

    const detailWrapper = mountSidebar()
    const detailComicsButton = detailWrapper.findAll('button').find((button) => button.attributes('title') === 'Comic Library')

    expect(detailComicsButton).toBeDefined()
    expect(detailComicsButton!.attributes('aria-current')).toBe('page')

    currentRoute.name = 'library-reader'
    currentRoute.params = { id: 'comics', remoteId: 'comic-1' }

    const readerWrapper = mountSidebar()
    const readerComicsButton = readerWrapper.findAll('button').find((button) => button.attributes('title') === 'Comic Library')

    expect(readerComicsButton).toBeDefined()
    expect(readerComicsButton!.attributes('aria-current')).toBe('page')
  })

  it('shows reorder handles for source-backed libraries like filesystem libraries', async () => {
    const wrapper = mountSidebar()

    await buttonByText(wrapper, 'reorder-Libraries').trigger('click')

    expect(wrapper.findAll('.drag-handle')).toHaveLength(4)
  })
})
