import type { BookCard, DashboardCatalogItem, SortField, SortSpec } from '@bookorbit/types'

export type LibrarySortableItem = BookCard | DashboardCatalogItem

export function isCatalogItem(item: LibrarySortableItem): item is DashboardCatalogItem {
  return 'type' in item && item.type === 'catalog-item'
}

function primaryFormat(item: LibrarySortableItem): string | null {
  if (isCatalogItem(item)) return item.formats[0] ?? null
  return item.files.find((file) => file.role === 'primary')?.format ?? item.files[0]?.format ?? null
}

function stableItemToken(item: LibrarySortableItem): string {
  return isCatalogItem(item) ? `${item.mediaType}:${item.remoteId}` : `book:${item.id}`
}

function stableHash(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function getLibraryItemSortValue(item: LibrarySortableItem, field: SortField): string | number | null {
  switch (field) {
    case 'title':
      return item.title?.toLowerCase() ?? null
    case 'author': {
      const people = item.authors.length > 0 ? item.authors : item.narrators
      return people[0]?.toLowerCase() ?? null
    }
    case 'series':
      return item.seriesName?.toLowerCase() ?? null
    case 'seriesIndex':
      return item.seriesIndex ?? null
    case 'addedAt':
      return item.addedAt ?? null
    case 'updatedAt':
      return item.updatedAt ?? null
    case 'publishedYear':
      return item.publishedYear ?? null
    case 'pageCount':
      return item.pageCount ?? null
    case 'rating':
      return item.rating ?? null
    case 'publisher':
      return item.publisher?.toLowerCase() ?? null
    case 'fileSize':
      return isCatalogItem(item)
        ? (item.fileSizeBytes ?? null)
        : (item.files.find((file) => file.role === 'primary')?.sizeBytes ?? item.files[0]?.sizeBytes ?? null)
    case 'format':
      return primaryFormat(item)?.toLowerCase() ?? null
    case 'readProgress':
      return item.readingProgress ?? null
    case 'readStatus':
      return isCatalogItem(item) ? (item.readStatus ?? null) : (item.readStatus?.status ?? null)
    case 'lastReadAt':
      return isCatalogItem(item) ? (item.lastReadAt ?? null) : (item.readStatus?.updatedAt ?? null)
    case 'startedAt':
      return isCatalogItem(item) ? null : (item.readStatus?.startedAt ?? null)
    case 'finishedAt':
      return isCatalogItem(item) ? (item.finishedAt ?? null) : (item.readStatus?.finishedAt ?? null)
    case 'language':
      return item.language?.toLowerCase() ?? null
    case 'metadataScore':
      return item.metadataScore ?? null
    case 'random':
      return stableHash(stableItemToken(item))
    default:
      return null
  }
}

export function sortLibraryItems<T extends LibrarySortableItem>(items: T[], specs: SortSpec[]): T[] {
  return [...items].sort((a, b) => {
    for (const spec of specs) {
      const av = getLibraryItemSortValue(a, spec.field)
      const bv = getLibraryItemSortValue(b, spec.field)
      if (av === null && bv === null) continue
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      if (cmp !== 0) return spec.dir === 'asc' ? cmp : -cmp
    }
    return stableItemToken(a).localeCompare(stableItemToken(b))
  })
}
