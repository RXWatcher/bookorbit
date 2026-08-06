import { ref } from 'vue'
import { api } from '@/lib/api'

export interface AudioBookmark {
  id: number
  bookId: number
  title: string
  positionSeconds: number
  createdAt: string
}

export interface AudioBookmarksOptions {
  loadBookmarks?: () => Promise<AudioBookmark[]>
  addBookmark?: (positionSeconds: number, title: string) => Promise<AudioBookmark | null>
  removeBookmark?: (bookmarkId: number) => Promise<void>
}

export function useAudioBookmarks(bookId: number, options: AudioBookmarksOptions = {}) {
  const bookmarks = ref<AudioBookmark[]>([])

  async function load() {
    if (options.loadBookmarks) {
      bookmarks.value = (await options.loadBookmarks()).sort((a, b) => a.positionSeconds - b.positionSeconds)
      return
    }
    const res = await api(`/api/v1/books/${bookId}/bookmarks`)
    if (!res.ok) return
    const data: { id: number; bookId: number; title: string; positionSeconds: number | null; createdAt: string }[] = await res.json()
    bookmarks.value = data.filter((b): b is AudioBookmark => b.positionSeconds != null).sort((a, b) => a.positionSeconds - b.positionSeconds)
  }

  async function add(positionSeconds: number, title: string): Promise<AudioBookmark | null> {
    if (options.addBookmark) {
      const created = await options.addBookmark(positionSeconds, title)
      if (!created) return null
      bookmarks.value = [...bookmarks.value, created].sort((a, b) => a.positionSeconds - b.positionSeconds)
      return created
    }
    const res = await api(`/api/v1/books/${bookId}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionSeconds, title }),
    })
    if (!res.ok) return null
    const created: AudioBookmark = await res.json()
    bookmarks.value = [...bookmarks.value, created].sort((a, b) => a.positionSeconds - b.positionSeconds)
    return created
  }

  async function remove(bookmarkId: number) {
    if (options.removeBookmark) {
      await options.removeBookmark(bookmarkId)
      bookmarks.value = bookmarks.value.filter((b) => b.id !== bookmarkId)
      return
    }
    const res = await api(`/api/v1/books/${bookId}/bookmarks/${bookmarkId}`, { method: 'DELETE' })
    if (res.ok) {
      bookmarks.value = bookmarks.value.filter((b) => b.id !== bookmarkId)
    }
  }

  return { bookmarks, load, add, remove }
}
