import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(path: string) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

describe('useCbz', () => {
  beforeEach(() => {
    mocks.api.mockReset()
  })

  it('loads source-backed ebook archive page counts without local book lookups', async () => {
    mocks.api.mockResolvedValueOnce(jsonResponse({ pageCount: 7 }))

    const { useCbz } = await import('./useCbz')
    const comic = useCbz(0, 0, { catalogSource: { remoteId: 'book 1/with slash', format: 'cb7' } })

    await comic.load()

    expect(comic.pageCount.value).toBe(7)
    expect(comic.bookTitle.value).toBe('')
    expect(comic.loading.value).toBe(false)
    expect(comic.pageUrl(3)).toBe('/api/v1/cbz/catalog/ebooks/book%201%2Fwith%20slash/pages/3?format=cb7')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/cbz/catalog/ebooks/book%201%2Fwith%20slash/pages?format=cb7')
  })

  it('loads source-backed Comic Library page counts from native comic page endpoints', async () => {
    mocks.api.mockResolvedValueOnce(jsonResponse({ items: [{ index: 0 }, { index: 1 }], total: 9 }))

    const { useCbz } = await import('./useCbz')
    const comic = useCbz(0, 0, { catalogSource: { mediaType: 'comic', remoteId: 'comic 1/with slash', format: 'cbz' } })

    await comic.load()

    expect(comic.pageCount.value).toBe(9)
    expect(comic.bookTitle.value).toBe('')
    expect(comic.loading.value).toBe(false)
    expect(comic.pageUrl(3)).toBe('/api/v1/libraries/comics/items/comic%201%2Fwith%20slash/pages/3')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/libraries/comics/items/comic%201%2Fwith%20slash/pages')
  })

  it('keeps local comic page count and title loading unchanged', async () => {
    mocks.api.mockResolvedValueOnce(jsonResponse({ pageCount: 4 })).mockResolvedValueOnce(jsonResponse({ title: 'Local Comic' }))

    const { useCbz } = await import('./useCbz')
    const comic = useCbz(12, 34)

    await comic.load()

    expect(comic.pageCount.value).toBe(4)
    expect(comic.bookTitle.value).toBe('Local Comic')
    expect(comic.pageUrl(2)).toBe('/api/v1/cbz/files/12/pages/2')
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/cbz/files/12/pages')
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/34')
  })
})
