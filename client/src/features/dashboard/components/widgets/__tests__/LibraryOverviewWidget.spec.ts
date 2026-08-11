import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { CLOUD_EBOOK_LIBRARY_ID, type Library, type LibraryOverviewWidgetData } from '@bookorbit/types'

const libraries = ref<Library[]>([])
const overview = ref<LibraryOverviewWidgetData | null>(null)
const routerPush = vi.fn<(to: unknown) => void>()
const useLibrariesMock = vi.fn<(options?: { includeSourceBacked?: boolean }) => unknown>()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: (options?: { includeSourceBacked?: boolean }) => {
    useLibrariesMock(options)
    return { libraries }
  },
}))

vi.mock('@/features/dashboard/composables/useLibraryOverviewWidget', () => ({
  useLibraryOverviewWidget: () => ({
    data: overview,
    loading: ref(false),
    error: ref(false),
  }),
}))

vi.mock('@lucide/vue', () => ({
  BookCopy: iconStub('BookCopy'),
  HardDrive: iconStub('HardDrive'),
  Library: iconStub('Library'),
  Users: iconStub('Users'),
}))

function iconStub(name: string) {
  return defineComponent({
    name,
    setup() {
      return () => h('svg')
    },
  })
}

function makeLibrary(id: number): Library {
  return {
    id,
    name: id === CLOUD_EBOOK_LIBRARY_ID ? 'Ebook Library' : 'Local Library',
    sourceKind: id < 0 ? 'source_backed' : 'filesystem',
  } as Library
}

function makeOverview(overrides: Partial<LibraryOverviewWidgetData> = {}): LibraryOverviewWidgetData {
  return {
    totalBooks: 12,
    totalAuthors: 3,
    totalSeries: 2,
    totalStorageBytes: 0,
    booksAddedThisYear: 0,
    ...overrides,
  }
}

const { default: LibraryOverviewWidget } = await import('../LibraryOverviewWidget.vue')

describe('LibraryOverviewWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    libraries.value = []
    overview.value = makeOverview()
  })

  it('opens the first source-backed library from the Books tile when no filesystem libraries exist', async () => {
    libraries.value = [makeLibrary(CLOUD_EBOOK_LIBRARY_ID)]

    const wrapper = mount(LibraryOverviewWidget)
    const booksTile = wrapper.findAll('[data-testid="library-overview-stat"]').find((tile) => tile.text().includes('Books'))

    expect(useLibrariesMock).toHaveBeenCalledWith({ includeSourceBacked: true })
    expect(booksTile).toBeTruthy()

    await booksTile!.trigger('click')

    expect(routerPush).toHaveBeenCalledWith({ name: 'library', params: { id: 'ebooks' } })
  })
})
