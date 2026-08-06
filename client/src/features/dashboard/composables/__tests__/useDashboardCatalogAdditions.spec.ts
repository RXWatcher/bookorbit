import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import { fetchDashboardCatalogAdditions, fetchDashboardCatalogDiscovery } from '../../api/dashboard-catalog.api'
import { useDashboardCatalogAdditions } from '../useDashboardCatalogAdditions'
import { useDashboardCatalogDiscovery } from '../useDashboardCatalogDiscovery'

const mockApi = vi.mocked(api)

function mockResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

function mountComposable(limit = 20) {
  let result!: ReturnType<typeof useDashboardCatalogAdditions>
  mount(
    defineComponent({
      setup() {
        result = useDashboardCatalogAdditions(limit)
        return () => null
      },
    }),
  )
  return result
}

function mountDiscoveryComposable(limit = 20) {
  let result!: ReturnType<typeof useDashboardCatalogDiscovery>
  mount(
    defineComponent({
      setup() {
        result = useDashboardCatalogDiscovery(limit)
        return () => null
      },
    }),
  )
  return result
}

describe('useDashboardCatalogAdditions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads catalog additions on mount', async () => {
    const items = [{ type: 'catalog-item', mediaType: 'audiobook', remoteId: 'audio-1', title: 'Dune Audio' }]
    mockApi.mockResolvedValue(mockResponse({ items }))
    const state = mountComposable(12)

    expect(state.loading.value).toBe(true)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/dashboard/catalog-additions?limit=12')
    expect(state.items.value).toEqual(items)
    expect(state.error.value).toBe(false)
    expect(state.loading.value).toBe(false)
  })

  it('sets error=true when the API response is not ok and refresh can recover', async () => {
    const items = [{ type: 'catalog-item', mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune' }]
    mockApi.mockResolvedValueOnce(mockResponse({ items: [] }, false)).mockResolvedValueOnce(mockResponse({ items }, true))
    const state = mountComposable(5)

    await flushPromises()
    expect(state.items.value).toEqual([])
    expect(state.error.value).toBe(true)

    await state.refresh()
    await flushPromises()

    expect(state.error.value).toBe(false)
    expect(state.items.value).toEqual(items)
  })

  it('loads catalog discovery on mount', async () => {
    const items = [{ type: 'catalog-item', mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune' }]
    mockApi.mockResolvedValue(mockResponse({ items }))

    const state = mountDiscoveryComposable(12)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/dashboard/catalog-discovery?limit=12')
    expect(state.items.value).toEqual(items)
    expect(state.error.value).toBe(false)
  })

  it('uses native library wording for dashboard additions and discovery API failures', async () => {
    mockApi.mockResolvedValue(mockResponse({}, false))

    await expect(fetchDashboardCatalogAdditions(12)).rejects.toThrow('Failed to fetch library additions')
    await expect(fetchDashboardCatalogDiscovery(12)).rejects.toThrow('Failed to fetch library discovery')
  })
})
