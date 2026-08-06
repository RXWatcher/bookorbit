import type { DashboardCatalogAdditionsData } from '@bookorbit/types'
import { api } from '@/lib/api'

export async function fetchDashboardCatalogAdditions(limit: number): Promise<DashboardCatalogAdditionsData> {
  const params = new URLSearchParams({ limit: String(limit) })
  const res = await api(`/api/v1/dashboard/catalog-additions?${params}`)
  if (!res.ok) throw new Error('Failed to fetch library additions')
  return res.json()
}

export async function fetchDashboardCatalogDiscovery(limit: number): Promise<DashboardCatalogAdditionsData> {
  const params = new URLSearchParams({ limit: String(limit) })
  const res = await api(`/api/v1/dashboard/catalog-discovery?${params}`)
  if (!res.ok) throw new Error('Failed to fetch library discovery')
  return res.json()
}
