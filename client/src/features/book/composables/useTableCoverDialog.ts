import { ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import { isSourceBackedBook } from '@/features/book/lib/source-backed-book'

export function useTableCoverDialog(isSelectionMode: () => boolean, emitUpdateBook: (updated: BookCard) => void, getBooks: () => BookCard[]) {
  const coverDialogBook = ref<BookCard | null>(null)

  function handleCoverClick(book: BookCard): void {
    if (isSelectionMode()) return
    if (isSourceBackedBook(book)) return
    coverDialogBook.value = book
  }

  function handleCoverDialogUpdateBook(bookId: number, hasCover: boolean): void {
    const book = getBooks().find((b) => b.id === bookId)
    if (!book) return

    emitUpdateBook({ ...book, hasCover })
    if (coverDialogBook.value?.id === bookId) {
      coverDialogBook.value = { ...coverDialogBook.value, hasCover }
    }
  }

  return { coverDialogBook, handleCoverClick, handleCoverDialogUpdateBook }
}
