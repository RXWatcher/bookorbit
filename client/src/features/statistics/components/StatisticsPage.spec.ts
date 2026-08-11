import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import StatisticsPage from './StatisticsPage.vue'

const useLibrariesMock = vi.fn<(options?: { includeSourceBacked?: boolean }) => void>()
const fetchLibrariesMock = vi.fn<() => void>()

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn<() => void>() }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: (options?: { includeSourceBacked?: boolean }) => {
    useLibrariesMock(options)
    return {
      libraries: ref([
        { id: -1, name: 'Ebook Library' },
        { id: -2, name: 'Audio Library' },
        { id: 1, name: 'Main' },
      ]),
      fetchLibraries: fetchLibrariesMock,
    }
  },
}))

vi.mock('../composables/useStatisticsConfig', () => ({
  useStatisticsConfig: () => ({
    orderedLibraryCharts: ref([]),
    orderedUserCharts: ref([]),
    visibleLibraryCharts: ref([]),
    visibleUserCharts: ref([]),
    libraryChartCount: ref(0),
    userChartCount: ref(0),
    visibleLibraryChartCount: ref(0),
    visibleUserChartCount: ref(0),
    filters: ref({ libraryIds: [], booksOverTimeGranularity: 'monthly', booksOverTimeRange: 'last-5-years' }),
    init: vi.fn<() => void>(),
    toggleVisibility: vi.fn<() => void>(),
    reorder: vi.fn<() => void>(),
    resetToDefaults: vi.fn<() => void>(),
    setLibraryFilter: vi.fn<() => void>(),
  }),
}))

vi.mock('./StatisticsGrid.vue', () => ({
  default: { template: '<div />' },
}))

vi.mock('./StatisticsSummaryCard.vue', () => ({
  default: { template: '<div />' },
}))

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: { template: '<div><slot /></div>' },
}))

describe('StatisticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads source-backed libraries for the statistics library filter', () => {
    mount(StatisticsPage, {
      global: {
        stubs: {
          Popover: { template: '<div><slot /></div>' },
          PopoverContent: { template: '<div><slot /></div>' },
          PopoverTrigger: { template: '<div><slot /></div>' },
          Sheet: { template: '<div><slot /></div>' },
          SheetContent: { template: '<div><slot /></div>' },
          SheetDescription: { template: '<div><slot /></div>' },
          SheetFooter: { template: '<div><slot /></div>' },
          SheetHeader: { template: '<div><slot /></div>' },
          SheetTitle: { template: '<div><slot /></div>' },
          ToggleSwitch: true,
        },
      },
    })

    expect(useLibrariesMock).toHaveBeenCalledWith({ includeSourceBacked: true })
  })
})
