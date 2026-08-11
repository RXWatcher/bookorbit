import { api } from '@/lib/api'
import type {
  UpsertWarehouseAdminSettingsPayload,
  WarehouseCacheClearResult,
  WarehouseCacheStatus,
  WarehouseAdminSettings,
  WarehouseCatalogSyncState,
  WarehouseCatalogSyncSummary,
  WarehouseConnectionTestResult,
} from '@bookorbit/types'

async function expectJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>

  const payload = await response.json().catch(() => ({}))
  const message =
    payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string' ? payload.message : fallbackMessage

  throw new Error(message)
}

export async function fetchWarehouseAdminSettings(): Promise<WarehouseAdminSettings> {
  return expectJson<WarehouseAdminSettings>(await api('/api/v1/admin/warehouse/settings'), 'Failed to load Book Warehouse settings')
}

export async function updateWarehouseAdminSettings(payload: UpsertWarehouseAdminSettingsPayload): Promise<WarehouseAdminSettings> {
  return expectJson<WarehouseAdminSettings>(
    await api('/api/v1/admin/warehouse/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'Failed to save Book Warehouse settings',
  )
}

export async function testWarehouseConnection(): Promise<WarehouseConnectionTestResult> {
  return expectJson<WarehouseConnectionTestResult>(
    await api('/api/v1/admin/warehouse/test-connection', { method: 'POST' }),
    'Failed to test Book Warehouse connection',
  )
}

export async function fetchWarehouseCatalogSyncState(): Promise<WarehouseCatalogSyncState> {
  return expectJson<WarehouseCatalogSyncState>(await api('/api/v1/admin/warehouse/catalog-sync'), 'Failed to load ebook sync status')
}

export async function fetchWarehouseCacheStatus(): Promise<WarehouseCacheStatus> {
  return expectJson<WarehouseCacheStatus>(await api('/api/v1/admin/warehouse/cache-status'), 'Failed to load cache status')
}

export async function clearWarehouseCache(): Promise<WarehouseCacheClearResult> {
  return expectJson<WarehouseCacheClearResult>(await api('/api/v1/admin/warehouse/cache/clear', { method: 'POST' }), 'Failed to clear cover cache')
}

export async function syncWarehouseEbooks(): Promise<WarehouseCatalogSyncSummary> {
  return expectJson<WarehouseCatalogSyncSummary>(
    await api('/api/v1/admin/warehouse/catalog-sync/ebooks', { method: 'POST' }),
    'Failed to sync ebooks',
  )
}

export async function syncWarehouseAudiobooks(): Promise<WarehouseCatalogSyncSummary> {
  return expectJson<WarehouseCatalogSyncSummary>(
    await api('/api/v1/admin/warehouse/catalog-sync/audiobooks', { method: 'POST' }),
    'Failed to sync audiobooks',
  )
}

export async function syncWarehouseComics(): Promise<WarehouseCatalogSyncSummary> {
  return expectJson<WarehouseCatalogSyncSummary>(
    await api('/api/v1/admin/warehouse/catalog-sync/comics', { method: 'POST' }),
    'Failed to sync comics',
  )
}

export async function syncWarehouseAll(): Promise<WarehouseCatalogSyncSummary[]> {
  return expectJson<WarehouseCatalogSyncSummary[]>(
    await api('/api/v1/admin/warehouse/catalog-sync/all', { method: 'POST' }),
    'Failed to sync catalog',
  )
}
