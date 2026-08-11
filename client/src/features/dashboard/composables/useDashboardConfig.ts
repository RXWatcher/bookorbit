import { ref } from 'vue'

import { SCROLLER_MEDIA, SCROLLER_TYPES, type ScrollerConfig, type ScrollerMedia, type ScrollerType } from '@bookorbit/types'
import { normalizeShelfRows } from '../lib/shelf-rows'

const STORAGE_KEY = 'bookorbit:dashboard:config'
const MAX_SCROLLERS = 12

export const SHELF_LAYOUT = {
  WIDE: 'wide',
  TWO_COLUMNS: 'two-columns',
} as const

export type DashboardShelfLayout = (typeof SHELF_LAYOUT)[keyof typeof SHELF_LAYOUT]

interface StoredDashboardConfig {
  scrollers: ScrollerConfig[]
  shelfLayout: DashboardShelfLayout
}

export const DEFAULT_SCROLLERS: ScrollerConfig[] = [
  { id: '1', type: 'continue-reading', label: 'Continue Reading', enabled: true, order: 1, limit: 20, rows: 1, media: 'ebook' },
  { id: '5', type: 'continue-listening', label: 'Continue Listening', enabled: true, order: 2, limit: 20, rows: 1, media: 'audiobook' },
  { id: '2', type: 'recently-added', label: 'Recently Added', enabled: true, order: 3, limit: 20, rows: 1, media: 'ebook' },
  { id: '9', type: 'recently-added', label: 'Recently Added', enabled: true, order: 4, limit: 20, rows: 1, media: 'audiobook' },
  { id: '3', type: 'random', label: 'Discover Something New', enabled: true, order: 5, limit: 20, rows: 1, media: 'ebook' },
  { id: '10', type: 'random', label: 'Discover Something New', enabled: true, order: 6, limit: 20, rows: 1, media: 'audiobook' },
  { id: '7', type: 'catalog-additions', label: 'Library Additions', enabled: true, order: 7, limit: 20, rows: 1, media: 'all' },
  { id: '8', type: 'catalog-discovery', label: 'Explore Libraries', enabled: true, order: 8, limit: 20, rows: 1, media: 'all' },
  { id: '11', type: 'recently-added', label: 'Recently Added', enabled: false, order: 9, limit: 20, rows: 1, media: 'comic' },
  { id: '6', type: 'want-to-read', label: 'Want to Read', enabled: false, order: 10, limit: 20, rows: 1, media: 'all' },
  { id: '4', type: 'up-next-in-series', label: 'Up Next in Series', enabled: false, order: 11, limit: 20, rows: 1, media: 'all' },
]

// Persisted-only. Shelf headings and the type selector resolve their text from the active
// locale via useDashboardLabels(); these values just keep stored configs shaped as before.
export const SCROLLER_LABELS: Record<ScrollerType, string> = {
  'continue-reading': 'Continue Reading',
  'continue-listening': 'Continue Listening',
  'want-to-read': 'Want to Read',
  'up-next-in-series': 'Up Next in Series',
  'recently-added': 'Recently Added',
  random: 'Discover Something New',
  'smart-scope': 'Smart Scope',
  'catalog-additions': 'Library Additions',
  'catalog-discovery': 'Explore Libraries',
}

const LEGACY_DEFAULT_SCROLLER_LABELS: Partial<Record<ScrollerType, Set<string>>> = {
  'catalog-additions': new Set(['Catalog Additions']),
  'catalog-discovery': new Set(['Explore Catalog']),
}

const VALID_SCROLLER_TYPES = new Set<ScrollerType>(SCROLLER_TYPES)

function cloneDefaultScrollers(): ScrollerConfig[] {
  return DEFAULT_SCROLLERS.map((scroller) => ({ ...scroller }))
}

function parseStoredScrollers(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null

  const { scrollers } = value as { scrollers?: unknown }
  return Array.isArray(scrollers) ? scrollers : null
}

function normalizeShelfLayout(value: unknown): DashboardShelfLayout {
  return value === SHELF_LAYOUT.TWO_COLUMNS ? SHELF_LAYOUT.TWO_COLUMNS : SHELF_LAYOUT.WIDE
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeSmartScopeId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function normalizeId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function normalizeMedia(value: unknown): ScrollerMedia {
  return typeof value === 'string' && (SCROLLER_MEDIA as readonly string[]).includes(value) ? (value as ScrollerMedia) : 'all'
}

/**
 * Layouts saved before shelves could be narrowed by media had ebooks and
 * audiobooks sharing one rail, which reads as a jumbled list. Such a layout is
 * replaced once with the split arrangement, carrying over any heading the user
 * had renamed so their wording survives the upgrade.
 */
const PRE_SPLIT_DEFAULT_TYPES: ScrollerType[] = [
  'recently-added',
  'random',
  'continue-reading',
  'continue-listening',
  'want-to-read',
  'up-next-in-series',
  'catalog-additions',
  'catalog-discovery',
]

function isPreSplitDefaultLayout(stored: ScrollerConfig[]): boolean {
  if (stored.length !== PRE_SPLIT_DEFAULT_TYPES.length) return false
  const storedTypes = stored.map((scroller) => scroller.type).sort()
  return [...PRE_SPLIT_DEFAULT_TYPES].sort().every((type, index) => storedTypes[index] === type)
}

function migrateToSplitMediaLayout(stored: ScrollerConfig[]): ScrollerConfig[] {
  const renamedByType = new Map<ScrollerType, string>()
  for (const scroller of stored) {
    if (scroller.label && scroller.label !== SCROLLER_LABELS[scroller.type]) renamedByType.set(scroller.type, scroller.label)
  }

  return cloneDefaultScrollers().map((scroller) => {
    const renamed = renamedByType.get(scroller.type)
    return renamed ? { ...scroller, label: renamed } : scroller
  })
}

function normalizeScroller(value: unknown, index: number): ScrollerConfig | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<ScrollerConfig> & { type?: unknown }
  if (typeof raw.type !== 'string' || !VALID_SCROLLER_TYPES.has(raw.type as ScrollerType)) return null

  const type = raw.type as ScrollerType
  const rawLabel = typeof raw.label === 'string' ? raw.label.trim() : ''
  const label = rawLabel.length === 0 || LEGACY_DEFAULT_SCROLLER_LABELS[type]?.has(rawLabel) ? SCROLLER_LABELS[type] : rawLabel
  const smartScopeId = type === 'smart-scope' ? normalizeSmartScopeId(raw.smartScopeId) : undefined

  return {
    id: normalizeId(raw.id, String(index + 1)),
    type,
    label,
    enabled: normalizeBoolean(raw.enabled, true),
    order: index + 1,
    limit: normalizePositiveNumber(raw.limit, 20),
    rows: normalizeShelfRows(raw.rows),
    media: normalizeMedia(raw.media),
    ...(smartScopeId === undefined ? {} : { smartScopeId }),
  }
}

function normalizeScrollers(value: unknown, allowMigration = false): ScrollerConfig[] {
  const storedScrollers = parseStoredScrollers(value)
  if (!storedScrollers) return cloneDefaultScrollers()

  // A layout saved before the split carries no media field. Upgrade it only
  // when the user never changed which shelves they had, so a customised
  // arrangement is kept as it is and simply gains the new field.
  if (allowMigration && storedScrollers.every((scroller) => !scroller || typeof scroller !== 'object' || !('media' in scroller))) {
    const migrated = storedScrollers
      .map((scroller, index) => normalizeScroller(scroller, index))
      .filter((scroller): scroller is ScrollerConfig => scroller !== null)
    if (isPreSplitDefaultLayout(migrated)) return migrateToSplitMediaLayout(migrated)
  }

  const normalized = storedScrollers
    .map((scroller, index) => normalizeScroller(scroller, index))
    .filter((scroller): scroller is ScrollerConfig => scroller !== null)
    .slice(0, MAX_SCROLLERS)
    .map((scroller, index) => ({ ...scroller, order: index + 1 }))

  return normalized.length > 0 ? normalized : cloneDefaultScrollers()
}

function loadConfig(): StoredDashboardConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { scrollers: cloneDefaultScrollers(), shelfLayout: SHELF_LAYOUT.WIDE }

    const parsed: unknown = JSON.parse(raw)
    const shelfLayout =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? normalizeShelfLayout((parsed as { shelfLayout?: unknown }).shelfLayout)
        : SHELF_LAYOUT.WIDE

    return { scrollers: normalizeScrollers(parsed, true), shelfLayout }
  } catch {
    return { scrollers: cloneDefaultScrollers(), shelfLayout: SHELF_LAYOUT.WIDE }
  }
}

function areScrollersEqual(left: ScrollerConfig[], right: ScrollerConfig[]): boolean {
  if (left.length !== right.length) return false
  return left.every((scroller, index) => {
    const other = right[index]
    if (!other) return false
    return (
      scroller.id === other.id &&
      scroller.type === other.type &&
      scroller.label === other.label &&
      scroller.enabled === other.enabled &&
      scroller.order === other.order &&
      scroller.limit === other.limit &&
      scroller.rows === other.rows &&
      scroller.media === other.media &&
      scroller.smartScopeId === other.smartScopeId
    )
  })
}

// Module-level singletons - all callers share the same reactive state
const initialConfig = loadConfig()
const scrollers = ref<ScrollerConfig[]>(initialConfig.scrollers)
const shelfLayout = ref<DashboardShelfLayout>(initialConfig.shelfLayout)

export function useDashboardConfig() {
  function save() {
    scrollers.value = normalizeScrollers(scrollers.value)
    shelfLayout.value = normalizeShelfLayout(shelfLayout.value)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: scrollers.value,
        shelfLayout: shelfLayout.value,
      } satisfies StoredDashboardConfig),
    )
  }

  function saveScrollers(newScrollers: ScrollerConfig[]) {
    scrollers.value = normalizeScrollers(newScrollers)
    save()
  }

  function saveShelfSettings(newScrollers: ScrollerConfig[], newShelfLayout: DashboardShelfLayout) {
    scrollers.value = normalizeScrollers(newScrollers)
    shelfLayout.value = normalizeShelfLayout(newShelfLayout)
    save()
  }

  function addScroller(type: ScrollerType) {
    scrollers.value = normalizeScrollers(scrollers.value)
    if (scrollers.value.length >= MAX_SCROLLERS) return
    const maxId = Math.max(0, ...scrollers.value.map((s) => Number(s.id)))
    scrollers.value.push({
      id: String(maxId + 1),
      type,
      label: SCROLLER_LABELS[type],
      enabled: true,
      order: scrollers.value.length + 1,
      limit: 20,
      media: 'all',
      rows: 1,
    })
    save()
  }

  function pruneDeletedSmartScopeScrollers(validSmartScopeIds: readonly number[]) {
    const validIds = new Set(validSmartScopeIds.filter((id) => Number.isFinite(id) && id > 0))
    const next = scrollers.value
      .filter((scroller) => {
        if (scroller.type !== 'smart-scope') return true
        if (!scroller.smartScopeId) return false
        return validIds.has(scroller.smartScopeId)
      })
      .map((scroller, index) => ({ ...scroller, order: index + 1 }))

    if (areScrollersEqual(scrollers.value, next)) return
    scrollers.value = next
    save()
  }

  function reset() {
    scrollers.value = cloneDefaultScrollers()
    shelfLayout.value = SHELF_LAYOUT.WIDE
    localStorage.removeItem(STORAGE_KEY)
  }

  return { scrollers, shelfLayout, saveScrollers, saveShelfSettings, addScroller, pruneDeletedSmartScopeScrollers, reset, MAX_SCROLLERS }
}
