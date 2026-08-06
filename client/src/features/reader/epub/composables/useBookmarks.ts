import { computed, ref } from 'vue'
import { api } from '@/lib/api'

export interface Bookmark {
  id: number
  bookId: number
  cfi: string
  title: string
  createdAt: string
}

interface BookmarkStore {
  load: () => Promise<Bookmark[]>
  create: (bookmark: { cfi: string; title: string }) => Promise<Bookmark>
  remove: (bookmarkId: number) => Promise<void>
}

export function useBookmarks(store?: BookmarkStore) {
  const bookmarks = ref<Bookmark[]>([])
  const currentCfi = ref<string | null>(null)
  const loadError = ref<string | null>(null)

  const isCurrentCfiBookmarked = computed(() => {
    if (!currentCfi.value) return false
    return bookmarks.value.some((b) => b.cfi === currentCfi.value)
  })

  function setCfi(cfi: string | null) {
    currentCfi.value = cfi
  }

  async function load(bookId: number) {
    loadError.value = null
    if (store) {
      bookmarks.value = await store.load()
      return
    }
    const res = await api(`/api/v1/books/${bookId}/bookmarks`)
    if (!res.ok) {
      loadError.value = 'Failed to load'
      return
    }
    bookmarks.value = await res.json()
  }

  async function toggle(bookId: number, cfi: string, title: string) {
    const existing = bookmarks.value.find((b) => b.cfi === cfi)
    if (existing) {
      await remove(bookId, existing.id)
    } else {
      if (store) {
        const created = await store.create({ cfi, title })
        bookmarks.value = [...bookmarks.value, created]
        return
      }
      const res = await api(`/api/v1/books/${bookId}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cfi, title }),
      })
      if (res.ok) {
        const created: Bookmark = await res.json()
        bookmarks.value = [...bookmarks.value, created]
      }
    }
  }

  async function remove(bookId: number, bookmarkId: number) {
    if (store) {
      await store.remove(bookmarkId)
      bookmarks.value = bookmarks.value.filter((b) => b.id !== bookmarkId)
      return
    }
    const res = await api(`/api/v1/books/${bookId}/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      bookmarks.value = bookmarks.value.filter((b) => b.id !== bookmarkId)
    }
  }

  return {
    bookmarks,
    isCurrentCfiBookmarked,
    currentCfi,
    loadError,
    setCfi,
    load,
    toggle,
    remove,
  }
}
