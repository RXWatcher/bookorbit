import type { BookCard, DashboardCatalogItem } from '@bookorbit/types'
import { isCatalogItem, sortLibraryItems } from '@/features/book/lib/library-item-sort'

export type SmartScopeLibraryItem = BookCard | DashboardCatalogItem

export { isCatalogItem }

export function sortSmartScopeItems(items: SmartScopeLibraryItem[], specs: Parameters<typeof sortLibraryItems>[1]): SmartScopeLibraryItem[] {
  return sortLibraryItems(items, specs)
}
