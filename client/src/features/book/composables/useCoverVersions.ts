import { ref } from 'vue'

const STORAGE_KEY = 'cover-versions'
type CoverVersionInput = number | string | Date | null | undefined

function load(): Map<number, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    return new Map(JSON.parse(raw) as [number, number][])
  } catch {
    return new Map()
  }
}

function persist(map: Map<number, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...map]))
  } catch {
    // ignore quota errors
  }
}

const versions = ref<Map<number, number>>(load())

function normalizeVersion(value: CoverVersionInput): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) && time > 0 ? time : undefined
  }
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric)
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function versionToken(localVersion: number | undefined, serverVersion: number | undefined): string | undefined {
  if (serverVersion !== undefined && localVersion !== undefined) return `${serverVersion}-${localVersion}`
  if (serverVersion !== undefined) return String(serverVersion)
  if (localVersion !== undefined) return String(localVersion)
  return undefined
}

export function useCoverVersions() {
  function bumpVersion(bookId: number) {
    const next = new Map(versions.value).set(bookId, Date.now())
    versions.value = next
    persist(next)
  }

  function getVersion(bookId: number): number | undefined {
    return versions.value.get(bookId)
  }

  function coverUrl(bookId: number, type: 'thumbnail' | 'cover' = 'thumbnail', sourceVersion?: CoverVersionInput): string {
    const base = `/api/v1/books/${bookId}/${type}`
    const localVersion = versions.value.get(bookId)
    const serverVersion = normalizeVersion(sourceVersion)
    const token = versionToken(localVersion, serverVersion)
    return token ? `${base}?t=${token}` : base
  }

  return { getVersion, bumpVersion, coverUrl }
}
