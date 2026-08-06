import { ref } from 'vue'
import type { AnnotationItem } from '@bookorbit/types'
import { api } from '@/lib/api'

export type Annotation = AnnotationItem

export interface AnnotationPatch {
  note?: string | null
  color?: string
  style?: string
}

interface AnnotationStore {
  load: () => Promise<Annotation[]>
  create: (data: {
    cfi: string
    text: string
    color: string
    style: string
    note?: string | null
    chapterTitle?: string | null
  }) => Promise<Annotation>
  update: (annotationId: number, data: AnnotationPatch) => Promise<Annotation>
  remove: (annotationId: number) => Promise<void>
}

export function useAnnotations(store?: AnnotationStore) {
  const annotations = ref<Annotation[]>([])
  const loadError = ref<string | null>(null)

  async function load(bookId: number) {
    loadError.value = null
    if (store) {
      annotations.value = await store.load()
      return
    }
    const res = await api(`/api/v1/books/${bookId}/annotations`)
    if (!res.ok) {
      loadError.value = 'Failed to load'
      return
    }
    annotations.value = await res.json()
  }

  async function create(
    bookId: number,
    data: { cfi: string; bookFileId?: number; text: string; color: string; style: string; note?: string | null; chapterTitle?: string | null },
  ): Promise<Annotation | null> {
    if (store) {
      const created = await store.create(data)
      annotations.value = [...annotations.value, created]
      return created
    }
    const res = await api(`/api/v1/books/${bookId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return null
    const created: Annotation = await res.json()
    annotations.value = [...annotations.value, created]
    return created
  }

  async function update(bookId: number, id: number, data: AnnotationPatch): Promise<Annotation | null> {
    if (store) {
      const updated = await store.update(id, data)
      annotations.value = annotations.value.map((a) => (a.id === id ? updated : a))
      return updated
    }
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return null

    const updated: Annotation = await res.json()
    annotations.value = annotations.value.map((a) => (a.id === id ? updated : a))
    return updated
  }

  function updateNote(bookId: number, id: number, note: string | null): Promise<Annotation | null> {
    return update(bookId, id, { note })
  }

  async function remove(bookId: number, id: number) {
    if (store) {
      await store.remove(id)
      annotations.value = annotations.value.filter((a) => a.id !== id)
      return
    }
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      annotations.value = annotations.value.filter((a) => a.id !== id)
    }
  }

  return { annotations, loadError, load, create, update, updateNote, remove }
}
