import type { BookCard, BookFileRef, WarehouseMediaType } from '@bookorbit/types'
import {
  catalogSourceAudiobookCoverUrl,
  catalogSourceAudiobookDownloadUrl,
  catalogSourceComicCoverUrl,
  catalogSourceComicDownloadUrl,
  catalogSourceEbookCoverUrl,
  catalogSourceEbookDownloadUrl,
} from '@/features/warehouse/api/catalog-source.api'
import { catalogLibraryItemRoute, catalogLibraryReaderRoute } from '@/features/warehouse/lib/catalog-item-route'

type CoverUrlFn = (bookId: number, type?: 'thumbnail' | 'cover', sourceVersion?: string | number | Date | null) => string

export function getBookCatalogSource(book: Pick<BookCard, 'catalogSource'>): { mediaType: WarehouseMediaType; remoteId: string } | null {
  return book.catalogSource ?? null
}

export function isSourceBackedBook(book: Pick<BookCard, 'catalogSource'>): boolean {
  return getBookCatalogSource(book) !== null
}

export function bookDetailRoute(book: BookCard) {
  const source = getBookCatalogSource(book)
  if (source) return catalogLibraryItemRoute(source.mediaType, source.remoteId)
  return { name: 'book-detail' as const, params: { bookId: book.id } }
}

export function bookReaderRoute(book: BookCard, file: BookFileRef, mode?: 'peek') {
  const format = file.format ?? defaultFormatForMediaType(getBookCatalogSource(book)?.mediaType)
  const query = mode === 'peek' ? { format, mode } : { format }
  const source = getBookCatalogSource(book)
  if (source) {
    return {
      ...catalogLibraryReaderRoute(source.mediaType, source.remoteId),
      query,
    }
  }

  return {
    name: 'reader' as const,
    params: { bookId: book.id, fileId: file.id },
    query,
  }
}

export function bookCoverUrl(book: BookCard, fallbackCoverUrl: CoverUrlFn, type: 'thumbnail' | 'cover' = 'thumbnail'): string {
  const sourceUrl = sourceBackedBookCoverUrl(book, type)
  if (sourceUrl) return sourceUrl
  return fallbackCoverUrl(book.id, type, book.updatedAt ?? book.addedAt)
}

export function sourceBackedBookCoverUrl(book: BookCard, type: 'thumbnail' | 'cover' = 'thumbnail'): string | null {
  const source = getBookCatalogSource(book)
  if (!source) return null

  if (source.mediaType === 'comic') return catalogSourceComicCoverUrl(source.remoteId, type === 'thumbnail' ? 'thumbnail' : 'original')
  if (source.mediaType === 'audiobook') return catalogSourceAudiobookCoverUrl(source.remoteId)

  return catalogSourceEbookCoverUrl(source.remoteId, type === 'thumbnail' ? 'thumbnail' : 'original')
}

export function bookDownloadUrl(book: BookCard): string | null {
  const source = getBookCatalogSource(book)
  if (!source) return null
  if (source.mediaType === 'comic') return catalogSourceComicDownloadUrl(source.remoteId)
  if (source.mediaType === 'audiobook') return catalogSourceAudiobookDownloadUrl(source.remoteId)
  return catalogSourceEbookDownloadUrl(source.remoteId)
}

function defaultFormatForMediaType(mediaType: WarehouseMediaType | undefined): string {
  if (mediaType === 'audiobook') return 'm4b'
  if (mediaType === 'comic') return 'cbz'
  return 'epub'
}
