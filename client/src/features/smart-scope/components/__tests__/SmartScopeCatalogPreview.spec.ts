import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import type { DashboardCatalogItem } from '@bookorbit/types'

const push = vi.fn<(to: unknown) => void>()
const refresh = vi.fn<() => void>()
const items = ref<DashboardCatalogItem[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref(false)

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopeCatalogItems', () => ({
  useSmartScopeCatalogItems: vi.fn<
    () => { items: typeof items; total: typeof total; loading: typeof loading; error: typeof error; refresh: typeof refresh }
  >(() => ({ items, total, loading, error, refresh })),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  catalogSourceAudiobookCoverUrl: (remoteId: string) => `/audiobook-covers/${remoteId}`,
  catalogSourceComicPageImageUrl: (remoteId: string, pageIndex = 0) => `/comic-pages/${remoteId}/${pageIndex}`,
  catalogSourceEbookCoverUrl: (remoteId: string, size: string) => `/ebook-covers/${remoteId}/${size}`,
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
      return () => h('div', { 'data-testid': 'smart-scope-catalog-quick-view-sheet', 'data-open': String(props.open) }, props.item?.title ?? '')
    },
  }),
}))

import SmartScopeCatalogPreview from '../SmartScopeCatalogPreview.vue'

describe('SmartScopeCatalogPreview', () => {
  beforeEach(() => {
    push.mockClear()
    refresh.mockClear()
    items.value = []
    total.value = 0
    loading.value = false
    error.value = false
  })

  it('renders source-backed matches as normal library matches for a smart scope', () => {
    total.value = 1
    items.value = [
      {
        type: 'catalog-item',
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        title: 'Dune',
        subtitle: null,
        seriesName: 'Dune',
        authors: ['Frank Herbert'],
        narrators: [],
        libraryName: 'Ebook Library',
        formats: ['epub'],
        hasCover: false,
      },
    ]

    const wrapper = mount(SmartScopeCatalogPreview, { props: { smartScopeId: 7, q: 'dune', sort: [] } })

    expect(wrapper.text()).toContain('Library Matches')
    expect(wrapper.text()).toContain('1 matching library item')
    expect(wrapper.text()).toContain('Dune')
    expect(wrapper.text()).toContain('Frank Herbert')
    expect(wrapper.text().toLowerCase()).not.toContain('catalog')
    expect(wrapper.text().toLowerCase()).not.toContain('warehouse')
    expect(wrapper.text().toLowerCase()).not.toContain('upstream')
  })

  it('renders ebook cover images through the native catalog cover proxy', () => {
    total.value = 1
    items.value = [
      {
        type: 'catalog-item',
        mediaType: 'ebook',
        remoteId: 'ebook-cover-1',
        title: 'Covered Ebook',
        subtitle: null,
        seriesName: null,
        authors: ['Ada Author'],
        narrators: [],
        libraryName: 'Catalog',
        formats: ['epub'],
        hasCover: true,
      },
    ]

    const wrapper = mount(SmartScopeCatalogPreview, { props: { smartScopeId: 7, q: 'covered', sort: [] } })

    expect(wrapper.get('img[alt="Covered Ebook"]').attributes('src')).toBe('/ebook-covers/ebook-cover-1/medium')
  })

  it('renders comic matches as Comic Library items', () => {
    total.value = 2
    items.value = [
      {
        type: 'catalog-item',
        mediaType: 'comic',
        remoteId: 'comic/issue-1',
        title: 'Saga #1',
        subtitle: null,
        seriesName: null,
        authors: ['Brian K. Vaughan'],
        narrators: [],
        libraryName: 'Comic Library',
        formats: ['cbz'],
        hasCover: true,
      },
      {
        type: 'catalog-item',
        mediaType: 'comic',
        remoteId: 'comic-no-cover',
        title: 'Comic Without Cover',
        subtitle: null,
        seriesName: null,
        authors: ['Fiona Staples'],
        narrators: [],
        libraryName: 'Comic Library',
        formats: [],
        hasCover: false,
      },
    ]

    const wrapper = mount(SmartScopeCatalogPreview, { props: { smartScopeId: 7, q: 'saga', sort: [] } })

    expect(wrapper.get('img[alt="Saga #1"]').attributes('src')).toBe('/comic-pages/comic/issue-1/0')
    expect(wrapper.get('img[alt="Comic Without Cover"]').attributes('src')).toBe('/comic-pages/comic-no-cover/0')
    expect(wrapper.text()).toContain('Comic')
    expect(wrapper.text()).toContain('CBZ')
    expect(wrapper.find('[data-testid="smart-scope-catalog-media-icon-comic"]').exists()).toBe(false)
  })

  it('routes clicked matches to native library item detail', async () => {
    total.value = 1
    items.value = [
      {
        type: 'catalog-item',
        mediaType: 'audiobook',
        remoteId: 'audio-1',
        title: 'Dune Audio',
        subtitle: null,
        seriesName: null,
        authors: ['Frank Herbert'],
        narrators: ['Simon Vance'],
        libraryName: 'Catalog',
        formats: ['m4b'],
        hasCover: true,
      },
    ]

    const wrapper = mount(SmartScopeCatalogPreview, { props: { smartScopeId: 7, q: '', sort: [] } })
    await wrapper.get('[data-testid="smart-scope-catalog-item"]').trigger('click')

    expect(push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'audiobooks', remoteId: 'audio-1' },
    })
  })

  it('opens source-backed matches in native quick details without navigating', async () => {
    total.value = 1
    items.value = [
      {
        type: 'catalog-item',
        mediaType: 'ebook',
        remoteId: 'ebook-quick-1',
        title: 'Quick Scope Match',
        subtitle: null,
        seriesName: 'Quick Series',
        authors: ['Ada Author'],
        narrators: [],
        libraryName: 'Ebook Library',
        formats: ['epub'],
        hasCover: true,
      },
    ]

    const wrapper = mount(SmartScopeCatalogPreview, { props: { smartScopeId: 7, q: '', sort: [] } })
    await wrapper.get('[data-testid="smart-scope-catalog-quick-view"]').trigger('click')

    expect(push).not.toHaveBeenCalled()
    const quickView = wrapper.getComponent({ name: 'CatalogItemQuickView' })
    expect(quickView.props('open')).toBe(true)
    expect(quickView.props('item')).toMatchObject({
      mediaType: 'ebook',
      remoteId: 'ebook-quick-1',
      title: 'Quick Scope Match',
      seriesName: 'Quick Series',
      authors: ['Ada Author'],
      libraryName: 'Ebook Library',
      formats: ['epub'],
      hasCover: true,
    })
  })

  it('renders nothing when there are no catalog matches and no load state', () => {
    const wrapper = mount(SmartScopeCatalogPreview, { props: { smartScopeId: 7, q: '', sort: [] } })

    expect(wrapper.html()).toBe('<!--v-if-->')
  })
})
