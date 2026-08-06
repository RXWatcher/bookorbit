import { parseLibraryFilterRouteId } from '@/features/library/lib/library-route'

export function parseAuthorLibraryRouteId(value: unknown): number | null {
  if (Array.isArray(value)) return null
  return parseLibraryFilterRouteId(value)
}
