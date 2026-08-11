import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import type { NeglectedGemsWidgetData } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  push: vi.fn<(to: unknown) => void>(),
  setStatus: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  patchCatalogSourceUserState: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
  data: { __v_isRef: true, value: null as NeglectedGemsWidgetData | null },
  loading: { __v_isRef: true, value: false },
  error: { __v_isRef: true, value: false },
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/features/dashboard/composables/useNeglectedGemsWidget', () => ({
  useNeglectedGemsWidget: () => ({
    data: mocks.data,
    loading: mocks.loading,
    error: mocks.error,
  }),
}))

vi.mock('@/features/book/composables/useBookStatus', () => ({
  useBookStatus: () => ({
    setStatus: mocks.setStatus,
  }),
}))

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (bookId: number) => `/book-covers/${bookId}`,
  }),
}))

vi.mock('@/features/warehouse/api/catalog-source.api', () => ({
  catalogSourceAudiobookCoverUrl: (remoteId: string) => `/audio-covers/${remoteId}`,
  catalogSourceComicCoverUrl: (remoteId: string) => `/comic-covers/${remoteId}`,
  catalogSourceEbookCoverUrl: (remoteId: string, size: string) => `/ebook-covers/${remoteId}/${size}`,
  patchCatalogSourceUserState: mocks.patchCatalogSourceUserState,
}))

vi.mock('@/features/warehouse/components/CatalogItemQuickView.vue', () => ({
  default: {
    props: ['item', 'open'],
    template:
      '<div data-testid="catalog-quick-view" :data-open="String(open)" :data-remote-id="item ? item.remoteId : \'\'" :data-library-name="item ? item.libraryName : \'\'" />',
  },
}))

import NeglectedGemsWidget from '../NeglectedGemsWidget.vue'

describe('NeglectedGemsWidget', () => {
  beforeEach(() => {
    mocks.push.mockClear()
    mocks.setStatus.mockClear()
    mocks.patchCatalogSourceUserState.mockClear()
    mocks.data.value = null
    mocks.loading.value = false
    mocks.error.value = false
  })

  it('renders source-backed gems without integration wording and uses catalog covers', () => {
    mocks.data.value = {
      gems: [
        {
          type: 'catalog-item',
          bookId: 901,
          mediaType: 'ebook',
          remoteId: 'ebook-901',
          title: 'Cloud Gem',
          hasCover: true,
          rating: 5,
          waitingDays: 44,
          genre: 'Mystery',
        },
      ],
    }

    const wrapper = mount(NeglectedGemsWidget)

    expect(wrapper.text()).toContain('Cloud Gem')
    expect(wrapper.text().toLowerCase()).not.toContain('warehouse')
    expect(wrapper.text().toLowerCase()).not.toContain('source')
    expect(wrapper.get('img').attributes('src')).toBe('/ebook-covers/ebook-901/medium')
  })

  it('routes source-backed gems to native catalog item detail', async () => {
    mocks.data.value = {
      gems: [
        {
          type: 'catalog-item',
          bookId: 901,
          mediaType: 'ebook',
          remoteId: 'ebook-901',
          title: 'Cloud Gem',
          hasCover: true,
          rating: 5,
          waitingDays: 44,
          genre: 'Mystery',
        },
      ],
    }

    const wrapper = mount(NeglectedGemsWidget)
    await wrapper.get('[data-testid="neglected-gem-cover"]').trigger('click')

    expect(mocks.push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'ebooks', remoteId: 'ebook-901' },
    })
  })

  it('opens source-backed gems in native quick details without navigating', async () => {
    mocks.data.value = {
      gems: [
        {
          type: 'catalog-item',
          bookId: 901,
          mediaType: 'ebook',
          remoteId: 'ebook-901',
          libraryName: 'Ebook Library',
          title: 'Cloud Gem',
          hasCover: true,
          rating: 5,
          waitingDays: 44,
          genre: 'Mystery',
        },
      ],
    }

    const wrapper = mount(NeglectedGemsWidget)
    await wrapper.get('[data-testid="neglected-gem-quick-view"]').trigger('click')

    expect(mocks.push).not.toHaveBeenCalled()
    const quickView = wrapper.get('[data-testid="catalog-quick-view"]')
    expect(quickView.attributes('data-open')).toBe('true')
    expect(quickView.attributes('data-remote-id')).toBe('ebook-901')
  })

  it('queues source-backed gems through catalog user state', async () => {
    mocks.data.value = {
      gems: [
        {
          type: 'catalog-item',
          bookId: 901,
          mediaType: 'ebook',
          remoteId: 'ebook-901',
          title: 'Cloud Gem',
          hasCover: true,
          rating: 5,
          waitingDays: 44,
          genre: 'Mystery',
        },
      ],
    }

    const wrapper = mount(NeglectedGemsWidget)
    await wrapper.get('[data-testid="neglected-gem-queue"]').trigger('click')
    await flushPromises()

    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('ebook', 'ebook-901', { readStatus: 'want_to_read' })
    expect(mocks.setStatus).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Queued')
  })

  it('treats comic gems as normal Comic Library items', async () => {
    mocks.data.value = {
      gems: [
        {
          type: 'catalog-item',
          bookId: 901,
          mediaType: 'comic',
          remoteId: 'comic-901',
          title: 'Cloud Comic Gem',
          hasCover: true,
          rating: 5,
          waitingDays: 44,
          genre: 'Comics',
        },
      ],
    }

    const wrapper = mount(NeglectedGemsWidget)

    expect(wrapper.get('img').attributes('src')).toBe('/comic-covers/comic-901')

    await wrapper.get('[data-testid="neglected-gem-cover"]').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({
      name: 'library-item-detail',
      params: { id: 'comics', remoteId: 'comic-901' },
    })

    await wrapper.get('[data-testid="neglected-gem-queue"]').trigger('click')
    await flushPromises()
    expect(mocks.patchCatalogSourceUserState).toHaveBeenCalledWith('comic', 'comic-901', { readStatus: 'want_to_read' })
    expect(mocks.setStatus).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="neglected-gem-quick-view"]').trigger('click')
    const quickView = wrapper.get('[data-testid="catalog-quick-view"]')
    expect(quickView.attributes('data-open')).toBe('true')
    expect(quickView.attributes('data-remote-id')).toBe('comic-901')
    expect(quickView.attributes('data-library-name')).toBe('Comics')
  })
})
