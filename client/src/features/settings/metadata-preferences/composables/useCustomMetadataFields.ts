import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { CustomMetadataFieldDefinition, CustomMetadataFieldType } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useActiveCustomFields } from '@/features/book/composables/useActiveCustomFields'

type CreateFieldPayload = {
  label: string
  type: CustomMetadataFieldType
  enabledLibraryIds: number[]
}

type UpdateFieldPayload = {
  label: string
  enabledLibraryIds: number[]
}

export function useCustomMetadataFields() {
  const { refresh: refreshActiveFields } = useActiveCustomFields()
  const fields = ref<CustomMetadataFieldDefinition[]>([])
  const loading = ref(false)
  const creating = ref(false)
  const savingId = ref<number | null>(null)
  const archivingId = ref<number | null>(null)
  const restoringId = ref<number | null>(null)
  const deletingPermanentlyId = ref<number | null>(null)
  const reordering = ref(false)

  const activeFields = computed(() =>
    [...fields.value].filter((f) => !f.archivedAt).sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label)),
  )

  const archivedFields = computed(() =>
    [...fields.value].filter((f) => f.archivedAt).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
  )

  async function loadFields(): Promise<void> {
    loading.value = true
    try {
      const res = await api('/api/v1/custom-metadata/fields?includeArchived=true')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fields.value = (await res.json()) as CustomMetadataFieldDefinition[]
    } catch {
      toast.error('Failed to load custom metadata fields')
    } finally {
      loading.value = false
    }
  }

  async function createField(payload: CreateFieldPayload): Promise<CustomMetadataFieldDefinition | null> {
    creating.value = true
    try {
      const res = await api('/api/v1/custom-metadata/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, displayOrder: fields.value.length }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const created = (await res.json()) as CustomMetadataFieldDefinition
      fields.value.push(created)
      toast.success('Custom metadata field created')
      void refreshActiveFields()
      return created
    } catch {
      toast.error('Failed to create custom metadata field')
      return null
    } finally {
      creating.value = false
    }
  }

  async function saveField(fieldId: number, payload: UpdateFieldPayload): Promise<CustomMetadataFieldDefinition | null> {
    savingId.value = fieldId
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${fieldId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated = (await res.json()) as CustomMetadataFieldDefinition
      fields.value = fields.value.map((item) => (item.id === updated.id ? updated : item))
      toast.success('Custom metadata field saved')
      void refreshActiveFields()
      return updated
    } catch {
      toast.error('Failed to save custom metadata field')
      return null
    } finally {
      savingId.value = null
    }
  }

  async function archiveField(fieldId: number): Promise<boolean> {
    archivingId.value = fieldId
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${fieldId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const now = new Date().toISOString()
      fields.value = fields.value.map((item) => (item.id === fieldId ? { ...item, archivedAt: now } : item))
      toast.success('Custom metadata field archived')
      void refreshActiveFields()
      return true
    } catch {
      toast.error('Failed to archive custom metadata field')
      return false
    } finally {
      archivingId.value = null
    }
  }

  async function restoreField(fieldId: number): Promise<CustomMetadataFieldDefinition | null> {
    restoringId.value = fieldId
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${fieldId}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const restored = fields.value.find((item) => item.id === fieldId)
      fields.value = fields.value.map((item) => (item.id === fieldId ? { ...item, archivedAt: null } : item))
      toast.success('Custom metadata field restored')
      void refreshActiveFields()
      return restored ? { ...restored, archivedAt: null } : null
    } catch {
      toast.error('Failed to restore custom metadata field')
      return null
    } finally {
      restoringId.value = null
    }
  }

  async function deleteFieldPermanently(fieldId: number): Promise<boolean> {
    deletingPermanentlyId.value = fieldId
    try {
      const res = await api(`/api/v1/custom-metadata/fields/${fieldId}/permanent`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fields.value = fields.value.filter((item) => item.id !== fieldId)
      toast.success('Custom metadata field permanently deleted')
      void refreshActiveFields()
      return true
    } catch {
      toast.error('Failed to permanently delete custom metadata field')
      return false
    } finally {
      deletingPermanentlyId.value = null
    }
  }

  async function reorderFields(orderedIds: number[]): Promise<boolean> {
    reordering.value = true
    try {
      const res = await api('/api/v1/custom-metadata/fields/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reordered = (await res.json()) as CustomMetadataFieldDefinition[]
      const archived = fields.value.filter((item) => item.archivedAt)
      fields.value = [...reordered, ...archived]
      void refreshActiveFields()
      return true
    } catch {
      toast.error('Failed to reorder custom metadata fields')
      await loadFields()
      return false
    } finally {
      reordering.value = false
    }
  }

  return {
    fields,
    loading,
    creating,
    savingId,
    archivingId,
    restoringId,
    deletingPermanentlyId,
    reordering,
    activeFields,
    archivedFields,
    loadFields,
    createField,
    saveField,
    archiveField,
    restoreField,
    deleteFieldPermanently,
    reorderFields,
  }
}
