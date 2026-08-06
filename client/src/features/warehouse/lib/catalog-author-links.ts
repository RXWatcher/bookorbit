import type { RouteLocationRaw } from 'vue-router'
import type { WarehouseCatalogAuthorRef, WarehouseCatalogSeriesRef } from '@bookorbit/types'

type CatalogAuthorSource = {
  authors?: string[]
  authorRefs?: WarehouseCatalogAuthorRef[]
}

type CatalogSeriesSource = {
  series?: string | null
  seriesName?: string | null
  seriesRef?: WarehouseCatalogSeriesRef | null
}

export function catalogAuthorLinks(source: CatalogAuthorSource | null | undefined): WarehouseCatalogAuthorRef[] {
  if (!source) return []

  const refs = source.authorRefs?.filter((author) => Number.isFinite(author.id) && author.name.trim()) ?? []
  return dedupeAuthorRefs(refs)
}

export function catalogAuthorNames(source: CatalogAuthorSource | null | undefined): string {
  const linkedNames = catalogAuthorLinks(source).map((author) => author.name)
  const names = linkedNames.length > 0 ? linkedNames : dedupeAuthorNames(source?.authors ?? [])
  return names.join(', ')
}

export function catalogAuthorRoute(author: WarehouseCatalogAuthorRef, from?: string): RouteLocationRaw {
  return {
    name: 'author-detail',
    params: { id: author.id },
    query: from ? { from } : undefined,
  }
}

export function catalogSeriesLink(source: CatalogSeriesSource | null | undefined): WarehouseCatalogSeriesRef | null {
  const ref = source?.seriesRef
  if (ref && Number.isFinite(ref.id) && ref.name.trim()) return { id: ref.id, name: ref.name.trim() }
  return null
}

export function catalogSeriesName(source: CatalogSeriesSource | null | undefined): string | null {
  const linked = catalogSeriesLink(source)
  if (linked) return linked.name

  const name = source?.seriesName ?? source?.series ?? null
  const trimmed = name?.trim()
  return trimmed || null
}

export function catalogSeriesRoute(series: WarehouseCatalogSeriesRef, from?: string): RouteLocationRaw {
  return {
    name: 'series-detail',
    params: { seriesId: series.id },
    query: from ? { from } : undefined,
  }
}

function dedupeAuthorRefs(refs: WarehouseCatalogAuthorRef[]): WarehouseCatalogAuthorRef[] {
  const seen = new Set<string>()
  const result: WarehouseCatalogAuthorRef[] = []

  for (const author of refs) {
    const name = author.name.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    result.push({ id: author.id, name })
  }

  return result
}

function dedupeAuthorNames(names: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const name of names.map((value) => value.trim()).filter(Boolean)) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }

  return result
}
