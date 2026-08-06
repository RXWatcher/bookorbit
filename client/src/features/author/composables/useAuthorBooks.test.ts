import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { AuthorBooksPage, AuthorLibraryItem, BookCard } from '@bookorbit/types'

vi.mock('../api/author', () => ({
  fetchAuthorBooks: vi.fn<typeof import('../api/author').fetchAuthorBooks>(),
}))

import { fetchAuthorBooks } from '../api/author'
import { useAuthorBooks } from './useAuthorBooks'

const mockFetchAuthorBooks = vi.mocked(fetchAuthorBooks)

function makeBook(id: number): BookCard {
  return { id, title: `Book ${id}` } as BookCard
}

function makePage(items: AuthorLibraryItem[], total = items.length): AuthorBooksPage {
  return { items, total, page: 0, size: 50 }
}

function localBookIds(items: AuthorLibraryItem[]): number[] {
  return items.filter((item): item is BookCard => !('type' in item && item.type === 'catalog-item')).map((item) => item.id)
}

describe('useAuthorBooks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('initializes with empty state', () => {
    const authorId = ref(1)
    const { items, total, loading, error, hasMore, sort, order, libraryId } = useAuthorBooks(authorId)

    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(hasMore.value).toBe(false)
    expect(sort.value).toBe('addedAt')
    expect(order.value).toBe('desc')
    expect(libraryId.value).toBeNull()
  })

  it('does not fetch when authorId is 0', async () => {
    const authorId = ref(0)
    const { load } = useAuthorBooks(authorId)

    await load(true)

    expect(mockFetchAuthorBooks).not.toHaveBeenCalled()
  })

  it('does not fetch when authorId is NaN', async () => {
    const authorId = ref(NaN)
    const { load } = useAuthorBooks(authorId)

    await load(true)

    expect(mockFetchAuthorBooks).not.toHaveBeenCalled()
  })

  it('skips fetch when already loading', async () => {
    const authorId = ref(1)
    let resolveFirst!: (v: AuthorBooksPage) => void
    mockFetchAuthorBooks.mockImplementation(
      () =>
        new Promise<AuthorBooksPage>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const { load } = useAuthorBooks(authorId)
    const firstLoad = load(true)
    const secondLoad = load(true)

    resolveFirst(makePage([makeBook(1)]))
    await Promise.all([firstLoad, secondLoad])

    expect(mockFetchAuthorBooks).toHaveBeenCalledTimes(1)
  })

  it('skips non-reset load when no more items to load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1), makeBook(2)], 2))

    const { load, items, total } = useAuthorBooks(authorId)
    await load(true)

    expect(items.value).toHaveLength(2)
    expect(total.value).toBe(2)

    await load(false)

    expect(mockFetchAuthorBooks).toHaveBeenCalledTimes(1)
  })

  it('loads books and updates items and total on success', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1), makeBook(2)], 5))

    const { load, items, total, hasMore } = useAuthorBooks(authorId)
    await load(true)

    expect(items.value).toHaveLength(2)
    expect(total.value).toBe(5)
    expect(hasMore.value).toBe(true)
  })

  it('resets items and page on reset=true', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 3)).mockResolvedValueOnce(makePage([makeBook(99)], 1))

    const { load, items, total } = useAuthorBooks(authorId)
    await load(true)
    expect(items.value).toHaveLength(1)
    expect(total.value).toBe(3)

    await load(true)

    expect(items.value).toHaveLength(1)
    expect(localBookIds(items.value)).toEqual([99])
    expect(total.value).toBe(1)
  })

  it('appends items on subsequent non-reset load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 2)).mockResolvedValueOnce(makePage([makeBook(2)], 2))

    const { load, items, hasMore } = useAuthorBooks(authorId)
    await load(true)
    expect(hasMore.value).toBe(true)

    await load(false)

    expect(items.value).toHaveLength(2)
    expect(localBookIds(items.value)).toEqual([1, 2])
  })

  it('increments page number after each load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 2)).mockResolvedValueOnce(makePage([makeBook(2)], 2))

    const { load } = useAuthorBooks(authorId)
    await load(true)
    await load()

    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ page: 0 }))
    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(2, 1, expect.objectContaining({ page: 1 }))
  })

  it('sets error on fetch failure', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValue(new Error('network error'))

    const { load, error, items } = useAuthorBooks(authorId)
    await load(true)

    expect(error.value).toBe('network error')
    expect(items.value).toEqual([])
  })

  it('uses fallback error message for non-Error thrown values', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValue('string error')

    const { load, error } = useAuthorBooks(authorId)
    await load(true)

    expect(error.value).toBe('Failed to load books')
  })

  it('clears previous error on new load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValueOnce(new Error('first failure')).mockResolvedValueOnce(makePage([makeBook(1)]))

    const { load, error } = useAuthorBooks(authorId)
    await load(true)
    expect(error.value).toBe('first failure')

    await load(true)
    expect(error.value).toBeNull()
  })

  it('resets loading to false after successful load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([]))

    const { load, loading } = useAuthorBooks(authorId)
    await load(true)

    expect(loading.value).toBe(false)
  })

  it('resets loading to false after failed load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValue(new Error('fail'))

    const { load, loading } = useAuthorBooks(authorId)
    await load(true)

    expect(loading.value).toBe(false)
  })

  it('passes sort, order, and libraryId to fetchAuthorBooks', async () => {
    const authorId = ref(5)
    mockFetchAuthorBooks.mockResolvedValue(makePage([]))

    const { load, sort, order, libraryId } = useAuthorBooks(authorId)
    sort.value = 'title'
    order.value = 'asc'
    libraryId.value = 7

    await load(true)

    expect(mockFetchAuthorBooks).toHaveBeenCalledWith(5, {
      page: 0,
      size: 50,
      sort: 'title',
      order: 'asc',
      libraryId: 7,
    })
  })

  it('passes null libraryId through unchanged', async () => {
    const authorId = ref(3)
    mockFetchAuthorBooks.mockResolvedValue(makePage([]))

    const { load } = useAuthorBooks(authorId)
    await load(true)

    expect(mockFetchAuthorBooks).toHaveBeenCalledWith(3, expect.objectContaining({ libraryId: null }))
  })

  it('hasMore is false when all items are loaded', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1), makeBook(2)], 2))

    const { load, hasMore } = useAuthorBooks(authorId)
    await load(true)

    expect(hasMore.value).toBe(false)
  })

  it('hasMore is true when not all items are loaded', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1)], 10))

    const { load, hasMore } = useAuthorBooks(authorId)
    await load(true)

    expect(hasMore.value).toBe(true)
  })

  it('load(false) default argument behaves same as load(false) explicit', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1)], 5))

    const { load, items } = useAuthorBooks(authorId)
    await load(true)

    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(2)], 5))
    await load()

    expect(items.value).toHaveLength(2)
  })

  it('reset clears items immediately before fetch resolves', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 1))

    const { load, items } = useAuthorBooks(authorId)
    await load(true)
    expect(items.value).toHaveLength(1)

    let resolve!: (v: AuthorBooksPage) => void
    mockFetchAuthorBooks.mockImplementation(
      () =>
        new Promise<AuthorBooksPage>((r) => {
          resolve = r
        }),
    )

    const pending = load(true)
    expect(items.value).toHaveLength(0)

    resolve(makePage([makeBook(99)]))
    await pending
    expect(items.value).toHaveLength(1)
    expect(localBookIds(items.value)).toEqual([99])
  })
})
