import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookDetail, BookMetadataRefreshPreviewFields, BookMetadataRefreshPreviewResponse } from '@bookorbit/types'
import { useCoverVersions } from './useCoverVersions'
import { useRefreshingBooks } from './useRefreshingBooks'
import { toast } from 'vue-sonner'

export type MetadataRefreshPreview = BookMetadataRefreshPreviewFields
export type MetadataRefreshPreviewResult = BookMetadataRefreshPreviewResponse

export function useRefreshMetadata() {
  const refreshing = ref(false)
  const { bumpVersion } = useCoverVersions()
  const { markRefreshing, clearRefreshing } = useRefreshingBooks()

  async function callRefresh<T>(bookId: number, preview: boolean): Promise<T | null> {
    refreshing.value = true
    if (!preview) markRefreshing([bookId])
    try {
      const url = `/api/v1/books/${bookId}/refresh-metadata${preview ? '?preview=true' : ''}`
      const res = await api(url, { method: 'POST' })
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    } finally {
      if (!preview) clearRefreshing([bookId])
      refreshing.value = false
    }
  }

  async function refreshAndSave(bookId: number): Promise<BookDetail | null> {
    return callRefresh<BookDetail>(bookId, false)
  }

  async function previewRefresh(bookId: number): Promise<MetadataRefreshPreviewResult | null> {
    return callRefresh<MetadataRefreshPreviewResult>(bookId, true)
  }

  async function refreshWithFeedback(bookId: number): Promise<BookDetail | null> {
    const updated = await refreshAndSave(bookId)
    if (updated) {
      bumpVersion(bookId)
      toast.success('Metadata refreshed')
      return updated
    } else {
      toast.error('Metadata refresh failed')
      return null
    }
  }

  return { refreshing, refreshAndSave, previewRefresh, refreshWithFeedback }
}
