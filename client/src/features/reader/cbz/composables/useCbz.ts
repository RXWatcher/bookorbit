import { ref } from 'vue'
import { api } from '@/lib/api'

export interface CbzCatalogSource {
  mediaType?: 'ebook' | 'comic'
  remoteId: string
  format: string
}

export interface UseCbzOptions {
  catalogSource?: CbzCatalogSource
}

function catalogPagesPath(source: CbzCatalogSource): string {
  if (source.mediaType === 'comic') {
    return `/api/v1/libraries/comics/items/${encodeURIComponent(source.remoteId)}/pages`
  }

  const params = new URLSearchParams({ format: source.format })
  return `/api/v1/cbz/catalog/ebooks/${encodeURIComponent(source.remoteId)}/pages?${params.toString()}`
}

function catalogPagePath(source: CbzCatalogSource, pageIndex: number): string {
  if (source.mediaType === 'comic') {
    return `/api/v1/libraries/comics/items/${encodeURIComponent(source.remoteId)}/pages/${pageIndex}`
  }

  const params = new URLSearchParams({ format: source.format })
  return `/api/v1/cbz/catalog/ebooks/${encodeURIComponent(source.remoteId)}/pages/${pageIndex}?${params.toString()}`
}

export function useCbz(fileId: number, bookId: number, options: UseCbzOptions = {}) {
  const pageCount = ref(0)
  const bookTitle = ref('')
  const loading = ref(true)
  const error = ref<string | null>(null)

  function pageUrl(n: number): string {
    if (options.catalogSource) return catalogPagePath(options.catalogSource, n)
    return `/api/v1/cbz/files/${fileId}/pages/${n}`
  }

  async function load(): Promise<void> {
    if (options.catalogSource) {
      const pagesRes = await api(catalogPagesPath(options.catalogSource))
      if (!pagesRes.ok) {
        error.value = 'Failed to load comic'
        loading.value = false
        return
      }
      const pagesData = await pagesRes.json()
      pageCount.value = pagesData.pageCount ?? pagesData.total ?? 0
      loading.value = false
      return
    }

    const [pagesRes, bookRes] = await Promise.all([api(`/api/v1/cbz/files/${fileId}/pages`), api(`/api/v1/books/${bookId}`)])
    if (!pagesRes.ok) {
      error.value = 'Failed to load comic'
      loading.value = false
      return
    }
    const [pagesData, bookData] = await Promise.all([pagesRes.json(), bookRes.ok ? bookRes.json() : null])
    pageCount.value = pagesData.pageCount
    bookTitle.value = bookData?.title ?? ''
    loading.value = false
  }

  return { pageCount, bookTitle, loading, error, pageUrl, load }
}
