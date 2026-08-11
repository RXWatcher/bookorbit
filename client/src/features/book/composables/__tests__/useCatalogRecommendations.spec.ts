import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import { useCatalogRecommendations } from '../useCatalogRecommendations'

const mockApi = vi.mocked(api)

function mockResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

describe('useCatalogRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads catalog recommendations for a book', async () => {
    const items = [{ type: 'catalog-item', mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune' }]
    mockApi.mockResolvedValue(mockResponse(items))

    const state = useCatalogRecommendations()
    await state.fetch(7)

    expect(mockApi).toHaveBeenCalledWith('/api/v1/books/7/catalog-recommendations')
    expect(state.recommendations.value).toEqual(items)
    expect(state.loading.value).toBe(false)
  })

  it('fails silently and clears catalog recommendations when unavailable', async () => {
    mockApi.mockResolvedValue(mockResponse([], false))

    const state = useCatalogRecommendations()
    await state.fetch(7)

    expect(state.recommendations.value).toEqual([])
    expect(state.loading.value).toBe(false)
  })
})
