import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types'

export type LibraryRouteParam = number | 'ebooks' | 'audiobooks' | 'comics'

function canonicalSourceBackedLibraryRouteParam(value: string): 'ebooks' | 'audiobooks' | 'comics' | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === String(CLOUD_EBOOK_LIBRARY_ID) || normalized === 'ebook' || normalized === 'ebooks') return 'ebooks'
  if (normalized === String(CLOUD_AUDIO_LIBRARY_ID) || normalized === 'audio' || normalized === 'audiobook' || normalized === 'audiobooks') {
    return 'audiobooks'
  }
  if (normalized === String(CLOUD_COMIC_LIBRARY_ID) || normalized === 'comic' || normalized === 'comics') return 'comics'
  return null
}

export function libraryRouteParamForId(id: number): LibraryRouteParam {
  if (id === CLOUD_EBOOK_LIBRARY_ID) return 'ebooks'
  if (id === CLOUD_AUDIO_LIBRARY_ID) return 'audiobooks'
  if (id === CLOUD_COMIC_LIBRARY_ID) return 'comics'
  return id
}

export function libraryRouteQueryValueForId(id: number | null): string | undefined {
  if (id === null) return undefined
  return String(libraryRouteParamForId(id))
}

export function libraryRouteForId(id: number): { name: 'library'; params: { id: LibraryRouteParam } } {
  return {
    name: 'library',
    params: { id: libraryRouteParamForId(id) },
  }
}

export function parseLibraryRouteId(value: unknown): number | null {
  const raw = firstText(value)
  if (!raw) return null

  const normalized = raw.toLowerCase()
  if (normalized === 'ebooks' || normalized === 'ebook') return CLOUD_EBOOK_LIBRARY_ID
  if (normalized === 'audiobooks' || normalized === 'audiobook' || normalized === 'audio') return CLOUD_AUDIO_LIBRARY_ID
  if (normalized === 'comics' || normalized === 'comic') return CLOUD_COMIC_LIBRARY_ID

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseLibraryFilterRouteId(value: unknown): number | null {
  const id = parseLibraryRouteId(value)
  if (id === null) return null
  if (id > 0 || id === CLOUD_EBOOK_LIBRARY_ID || id === CLOUD_AUDIO_LIBRARY_ID || id === CLOUD_COMIC_LIBRARY_ID) return id
  return null
}

export function canonicalizeUserFacingLibraryUrl(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return value

  const url = new URL(value, 'http://bookorbit.local')
  const pathSegments = url.pathname.split('/')
  for (let index = 1; index < pathSegments.length; index += 1) {
    if (pathSegments[index - 1] !== 'library') continue
    const canonical = canonicalSourceBackedLibraryRouteParam(pathSegments[index] ?? '')
    if (canonical) pathSegments[index] = canonical
  }

  const libraryId = url.searchParams.get('libraryId')
  if (libraryId !== null) {
    const canonical = canonicalSourceBackedLibraryRouteParam(libraryId)
    if (canonical) url.searchParams.set('libraryId', canonical)
  }

  return `${pathSegments.join('/')}${url.search}${url.hash}`
}

function firstText(value: unknown): string | null {
  if (Array.isArray(value)) return firstText(value[0])
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}
