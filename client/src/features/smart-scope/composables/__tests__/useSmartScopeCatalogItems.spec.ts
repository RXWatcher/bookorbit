import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import { useSmartScopeCatalogItems } from '../useSmartScopeCatalogItems'

const mockApi = vi.mocked(api)

function mockResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

function mountComposable() {
  const smartScopeId = ref(7)
  const q = ref('dune')
  const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
  let result!: ReturnType<typeof useSmartScopeCatalogItems>

  mount(
    defineComponent({
      setup() {
        result = useSmartScopeCatalogItems(smartScopeId, q, sort, 12)
        return () => null
      },
    }),
  )

  return { result, smartScopeId, q, sort }
}

describe('useSmartScopeCatalogItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads catalog items for the active smart scope on mount', async () => {
    const items = [{ type: 'catalog-item', mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune' }]
    mockApi.mockResolvedValue(mockResponse({ items, total: 1, page: 0, size: 12 }))

    const { result } = mountComposable()

    expect(result.loading.value).toBe(true)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/smart-scopes/7/catalog-items/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: 12 },
        q: 'dune',
      }),
    })
    expect(result.items.value).toEqual(items)
    expect(result.total.value).toBe(1)
    expect(result.error.value).toBe(false)
    expect(result.loading.value).toBe(false)
  })

  it('appends additional catalog result pages and reports hasMore', async () => {
    const first = [{ type: 'catalog-item', mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune' }]
    const second = [{ type: 'catalog-item', mediaType: 'audiobook', remoteId: 'audio-1', title: 'Dune Audio' }]
    mockApi.mockResolvedValueOnce(mockResponse({ items: first, total: 2, page: 0, size: 12 }))

    const { result } = mountComposable()
    await flushPromises()

    expect(result.hasMore.value).toBe(true)

    mockApi.mockResolvedValueOnce(mockResponse({ items: second, total: 2, page: 1, size: 12 }))
    await result.load()

    expect(mockApi).toHaveBeenLastCalledWith('/api/v1/smart-scopes/7/catalog-items/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 1, size: 12 },
        q: 'dune',
      }),
    })
    expect(result.items.value).toEqual([...first, ...second])
    expect(result.hasMore.value).toBe(false)
  })

  it('sets error=true when the response is not ok', async () => {
    mockApi.mockResolvedValue(mockResponse({ items: [] }, false))
    const { result } = mountComposable()

    await flushPromises()

    expect(result.items.value).toEqual([])
    expect(result.total.value).toBe(0)
    expect(result.error.value).toBe(true)
  })
})
