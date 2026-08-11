import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

import type { DashboardCatalogItem } from '@bookorbit/types'

const push = vi.fn<(to: unknown) => void>()
const fetch = vi.fn<(bookId: number) => Promise<void> | void>()
const recommendations = ref<DashboardCatalogItem[]>([])
const loading = ref(false)

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/features/book/composables/useCatalogRecommendations', () => ({
  useCatalogRecommendations: vi.fn<() => { recommendations: typeof recommendations; loading: typeof loading; fetch: typeof fetch }>(() => ({
    recommendations,
    loading,
    fetch,
  })),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  catalogSourceAudiobookCoverUrl: (remoteId: string) => `/covers/${remoteId}`,
  catalogSourceComicPageImageUrl: (remoteId: string, pageIndex = 0) => `/comic-pages/${remoteId}/${pageIndex}`,
  catalogSourceEbookCoverUrl: (remoteId: string, size: string) => `/ebook-covers/${remoteId}/${size}`,
}))

vi.mock('@/features/warehouse/components/CatalogItemQuickView.vue', () => ({
  default: {
    props: ['item', 'open'],
    template: '<div data-testid="catalog-quick-view" :data-open="String(open)" :data-remote-id="item ? item.remoteId : \'\'" />',
  },
}))

import CatalogRecommendationsRow from '../CatalogRecommendationsRow.vue'

describe('CatalogRecommendationsRow', () => {
  beforeEach(() => {
    push.mockClear()
    fetch.mockClear()
    recommendations.value = []
    loading.value = false
  })

  it('loads and renders source-backed library recommendations', () => {
    recommendations.value = [
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

    const wrapper = mount(CatalogRecommendationsRow, { props: { bookId: 7 } })

    expect(fetch).toHaveBeenCalledWith(7)
    expect(wrapper.text()).toContain('More From Libraries')
    expect(wrapper.text()).toContain('Dune')
    expect(wrapper.text()).toContain('Frank Herbert')
    expect(wrapper.text().toLowerCase()).not.toContain('catalog')
    expect(wrapper.text().toLowerCase()).not.toContain('warehouse')
    expect(wrapper.text().toLowerCase()).not.toContain('upstream')
  })

  it('routes clicked recommendations to native catalog detail', async () => {
    recommendations.value = [
      {
        type: 'catalog-item',
        mediaType: 'audiobook',
        remoteId: 'audio-1',
        title: 'Dune Audio',
        subtitle: null,
        seriesName: null,
        authors: ['Frank Herbert'],
        narrators: ['Simon Vance'],
        libraryName: 'Audio Library',
        formats: ['m4b'],
        hasCover: true,
      },
    ]

    const wrapper = mount(CatalogRecommendationsRow, { props: { bookId: 7 } })
    await wrapper.get('[data-testid="catalog-recommendation-item"]').trigger('click')

    expect(push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'audiobooks', remoteId: 'audio-1' },
    })
  })

  it('opens source-backed recommendations in native quick details without navigating', async () => {
    recommendations.value = [
      {
        type: 'catalog-item',
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        title: 'Dune',
        subtitle: null,
        seriesName: null,
        authors: ['Frank Herbert'],
        narrators: [],
        libraryName: 'Ebook Library',
        formats: ['epub'],
        hasCover: false,
      },
    ]

    const wrapper = mount(CatalogRecommendationsRow, { props: { bookId: 7 } })
    await wrapper.get('[data-testid="catalog-recommendation-quick-view"]').trigger('click')

    expect(push).not.toHaveBeenCalled()
    const quickView = wrapper.get('[data-testid="catalog-quick-view"]')
    expect(quickView.attributes('data-open')).toBe('true')
    expect(quickView.attributes('data-remote-id')).toBe('ebook-1')
  })

  it('renders ebook recommendation covers from the catalog cover proxy', () => {
    recommendations.value = [
      {
        type: 'catalog-item',
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        title: 'Dune',
        subtitle: null,
        seriesName: null,
        authors: ['Frank Herbert'],
        narrators: [],
        libraryName: 'Ebook Library',
        formats: ['epub'],
        hasCover: true,
      },
    ]

    const wrapper = mount(CatalogRecommendationsRow, { props: { bookId: 7 } })

    const image = wrapper.get('img')
    expect(image.attributes('src')).toBe('/ebook-covers/ebook-1/medium')
    expect(image.attributes('alt')).toBe('Dune')
  })

  it('renders comic recommendations as Comic Library items', () => {
    recommendations.value = [
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

    const wrapper = mount(CatalogRecommendationsRow, { props: { bookId: 7 } })

    const image = wrapper.get('img[alt="Saga #1"]')
    expect(image.attributes('src')).toBe('/comic-pages/comic/issue-1/0')
    expect(wrapper.text()).toContain('Comic')
    expect(wrapper.text()).toContain('cbz')
    expect(wrapper.find('[data-testid="catalog-recommendation-media-icon-comic"]').exists()).toBe(true)
  })

  it('renders nothing when idle and empty', () => {
    const wrapper = mount(CatalogRecommendationsRow, { props: { bookId: 7 } })

    expect(wrapper.html()).toBe('<!--v-if-->')
  })
})
