import { api } from '@/lib/api'
import type {
  WarehouseAudiobookCatalogPage,
  WarehouseAudiobookCatalogQuery,
  WarehouseAudiobookDetail,
  WarehouseAudiobookExternalSearchPage,
  WarehouseAudiobookQueuePage,
  WarehouseAudiobookRequestSubmitPayload,
  WarehouseCatalogAnnotation,
  WarehouseCatalogAnnotationCreatePayload,
  WarehouseCatalogAnnotationUpdatePayload,
  WarehouseCatalogBookmark,
  WarehouseCatalogBookmarkCreatePayload,
  WarehouseComicCatalogItem,
  WarehouseEbookCatalogItem,
  WarehouseEbookCatalogPage,
  WarehouseEbookCatalogQuery,
  WarehouseEbookExternalSearchPage,
  WarehouseEbookRequestSubmitPayload,
  WarehouseComicRequestSubmitPayload,
  WarehouseMediaType,
  WarehouseRequestDetail,
  WarehouseRequestListQuery,
  WarehouseRequestPage,
  WarehouseUserCatalogState,
  WarehouseUserCatalogStatePatch,
  BookQuery,
  CatalogLibraryItemsPage,
} from '@bookorbit/types'

const CATALOG_EBOOKS_PATH = '/api/v1/catalog/ebooks'
const CATALOG_AUDIOBOOKS_PATH = '/api/v1/catalog/audiobooks'
const CATALOG_COMICS_PATH = '/api/v1/catalog/comics'
const CATALOG_REQUESTS_PATH = '/api/v1/catalog/requests'
const CATALOG_ITEMS_PATH = '/api/v1/catalog/items'
const REQUESTS_PATH = '/api/v1/requests'
const LIBRARY_EBOOKS_PATH = '/api/v1/libraries/ebooks/items'
const LIBRARY_AUDIOBOOKS_PATH = '/api/v1/libraries/audiobooks/items'
const LIBRARY_COMICS_PATH = '/api/v1/libraries/comics/items'
const CATALOG_REQUEST_EBOOKS_PATH = `${CATALOG_REQUESTS_PATH}/ebooks`
const CATALOG_REQUEST_AUDIOBOOKS_PATH = `${CATALOG_REQUESTS_PATH}/audiobooks`
const CATALOG_REQUEST_COMICS_PATH = `${CATALOG_REQUESTS_PATH}/comics`
const LIBRARY_ITEM_LOAD_ERROR = 'Failed to load library item'
const USER_STATE_PATCH_FIELDS = ['inLibrary', 'favorite', 'rating', 'readStatus', 'progressPercent', 'positionSeconds'] as const
const BOOKMARK_CREATE_FIELDS = ['cfi', 'title', 'positionSeconds'] as const
const ANNOTATION_CREATE_FIELDS = ['cfi', 'text', 'color', 'style', 'note', 'chapterTitle'] as const
const ANNOTATION_UPDATE_FIELDS = ['note'] as const

export type CatalogReadingSessionPayload = {
  sessionId: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  progressDelta: number | null
  endProgress: number
}

async function expectJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>

  throw new Error(fallbackMessage)
}

function appendQueryParam(params: URLSearchParams, key: string, value: string | number | boolean | null | undefined): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && value.trim() === '') return

  params.set(key, String(value))
}

function catalogEbooksUrl(query: WarehouseEbookCatalogQuery): string {
  const params = new URLSearchParams()

  appendQueryParam(params, 'q', query.q)
  appendQueryParam(params, 'page', query.page)
  appendQueryParam(params, 'limit', query.limit)
  appendQueryParam(params, 'sort', query.sort)
  appendQueryParam(params, 'order', query.order)
  appendQueryParam(params, 'author', query.author)
  appendQueryParam(params, 'series', query.series)
  appendQueryParam(params, 'language', query.language)
  appendQueryParam(params, 'format', query.format)
  appendQueryParam(params, 'hasCover', query.hasCover)

  const queryString = params.toString()
  return queryString ? `${CATALOG_EBOOKS_PATH}?${queryString}` : CATALOG_EBOOKS_PATH
}

function catalogAudiobooksUrl(query: WarehouseAudiobookCatalogQuery): string {
  const params = new URLSearchParams()

  appendQueryParam(params, 'q', query.q)
  appendQueryParam(params, 'page', query.page)
  appendQueryParam(params, 'limit', query.limit)
  appendQueryParam(params, 'sort', query.sort)
  appendQueryParam(params, 'order', query.order)
  appendQueryParam(params, 'author', query.author)
  appendQueryParam(params, 'narrator', query.narrator)
  appendQueryParam(params, 'series', query.series)
  appendQueryParam(params, 'language', query.language)
  appendQueryParam(params, 'format', query.format)
  appendQueryParam(params, 'hasCover', query.hasCover)

  const queryString = params.toString()
  return queryString ? `${CATALOG_AUDIOBOOKS_PATH}?${queryString}` : CATALOG_AUDIOBOOKS_PATH
}

function catalogRequestsUrl(query: WarehouseRequestListQuery): string {
  const params = new URLSearchParams()

  appendQueryParam(params, 'status', query.status)
  appendQueryParam(params, 'page', query.page)
  appendQueryParam(params, 'limit', query.limit)
  appendQueryParam(params, 'mediaType', query.mediaType)

  const queryString = params.toString()
  return queryString ? `${CATALOG_REQUESTS_PATH}?${queryString}` : CATALOG_REQUESTS_PATH
}

function catalogAudiobookRequestsUrl(path: string, query: WarehouseRequestListQuery = {}): string {
  const params = new URLSearchParams()

  appendQueryParam(params, 'status', query.status)
  appendQueryParam(params, 'page', query.page)
  appendQueryParam(params, 'limit', query.limit)

  const queryString = params.toString()
  return queryString ? `${path}?${queryString}` : path
}

function toCatalogItem(item: WarehouseEbookCatalogItem & { raw?: unknown }): WarehouseEbookCatalogItem {
  const { raw: _raw, ...catalogItem } = item
  return catalogItem
}

function toCatalogAudiobookDetail(item: WarehouseAudiobookDetail & { raw?: unknown }): WarehouseAudiobookDetail {
  const { raw: _raw, ...catalogItem } = item
  return catalogItem
}

function toCatalogComicItem(item: WarehouseComicCatalogItem & { raw?: unknown }): WarehouseComicCatalogItem {
  const { raw: _raw, ...catalogItem } = item
  return catalogItem
}

function toCatalogUserState(item: WarehouseUserCatalogState & Record<string, unknown>): WarehouseUserCatalogState {
  return {
    mediaType: item.mediaType,
    remoteId: item.remoteId,
    inLibrary: item.inLibrary,
    favorite: item.favorite,
    rating: item.rating,
    readStatus: item.readStatus,
    progressPercent: item.progressPercent,
    positionSeconds: item.positionSeconds,
    finishedAt: item.finishedAt,
    updatedAt: item.updatedAt,
  }
}

function toCatalogBookmark(item: WarehouseCatalogBookmark & Record<string, unknown>): WarehouseCatalogBookmark {
  return {
    id: item.id,
    mediaType: item.mediaType,
    remoteId: item.remoteId,
    cfi: item.cfi,
    title: item.title,
    positionSeconds: item.positionSeconds,
    createdAt: item.createdAt,
  }
}

function toCatalogAnnotation(item: WarehouseCatalogAnnotation & Record<string, unknown>): WarehouseCatalogAnnotation {
  return {
    id: item.id,
    mediaType: item.mediaType,
    remoteId: item.remoteId,
    cfi: item.cfi,
    text: item.text,
    color: item.color,
    style: item.style,
    note: item.note,
    chapterTitle: item.chapterTitle,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function toCatalogUserStatePatch(patch: WarehouseUserCatalogStatePatch): WarehouseUserCatalogStatePatch {
  return Object.fromEntries(
    USER_STATE_PATCH_FIELDS.filter((field) => patch[field] !== undefined).map((field) => [field, patch[field]]),
  ) as WarehouseUserCatalogStatePatch
}

function toCatalogBookmarkCreatePayload(payload: WarehouseCatalogBookmarkCreatePayload): WarehouseCatalogBookmarkCreatePayload {
  const safePayload: WarehouseCatalogBookmarkCreatePayload = { title: payload.title }

  for (const field of BOOKMARK_CREATE_FIELDS) {
    if (field === 'title' || payload[field] === undefined) continue
    safePayload[field] = payload[field] as never
  }

  return safePayload
}

function toCatalogAnnotationCreatePayload(payload: WarehouseCatalogAnnotationCreatePayload): WarehouseCatalogAnnotationCreatePayload {
  const safePayload: WarehouseCatalogAnnotationCreatePayload = {
    cfi: payload.cfi,
    text: payload.text,
    color: payload.color,
    style: payload.style,
  }

  for (const field of ANNOTATION_CREATE_FIELDS) {
    if (field === 'cfi' || field === 'text' || field === 'color' || field === 'style' || payload[field] === undefined) continue
    safePayload[field] = payload[field] as never
  }

  return safePayload
}

function toCatalogAnnotationUpdatePayload(payload: WarehouseCatalogAnnotationUpdatePayload): WarehouseCatalogAnnotationUpdatePayload {
  return Object.fromEntries(
    ANNOTATION_UPDATE_FIELDS.filter((field) => payload[field] !== undefined).map((field) => [field, payload[field]]),
  ) as WarehouseCatalogAnnotationUpdatePayload
}

function catalogAudiobookPath(remoteId: string): string {
  return `${CATALOG_AUDIOBOOKS_PATH}/${encodeURIComponent(remoteId)}`
}

function catalogEbookPath(remoteId: string): string {
  return `${CATALOG_EBOOKS_PATH}/${encodeURIComponent(remoteId)}`
}

function catalogComicPath(remoteId: string): string {
  return `${CATALOG_COMICS_PATH}/${encodeURIComponent(remoteId)}`
}

function catalogRequestPath(id: number): string {
  return `${CATALOG_REQUESTS_PATH}/${encodeURIComponent(id)}`
}

function catalogUserStatePath(mediaType: WarehouseMediaType, remoteId: string): string {
  return `${CATALOG_ITEMS_PATH}/${encodeURIComponent(mediaType)}/${encodeURIComponent(remoteId)}/state`
}

function catalogReadingSessionsPath(mediaType: WarehouseMediaType, remoteId: string): string {
  return `${CATALOG_ITEMS_PATH}/${encodeURIComponent(mediaType)}/${encodeURIComponent(remoteId)}/sessions`
}

function catalogBookmarksPath(mediaType: WarehouseMediaType, remoteId: string): string {
  return `${CATALOG_ITEMS_PATH}/${encodeURIComponent(mediaType)}/${encodeURIComponent(remoteId)}/bookmarks`
}

function catalogAnnotationsPath(mediaType: WarehouseMediaType, remoteId: string): string {
  return `${CATALOG_ITEMS_PATH}/${encodeURIComponent(mediaType)}/${encodeURIComponent(remoteId)}/annotations`
}

export async function fetchCatalogSourceEbooks(query: WarehouseEbookCatalogQuery): Promise<WarehouseEbookCatalogPage> {
  return expectJson<WarehouseEbookCatalogPage>(await api(catalogEbooksUrl(query)), 'Failed to load ebook catalog')
}

export async function fetchCatalogSourceEbook(remoteId: string): Promise<WarehouseEbookCatalogItem | null> {
  const response = await api(catalogEbookPath(remoteId))
  if (response.status === 404) return null

  return toCatalogItem(await expectJson<WarehouseEbookCatalogItem & { raw?: unknown }>(response, LIBRARY_ITEM_LOAD_ERROR))
}

export async function fetchCatalogSourceAudiobooks(query: WarehouseAudiobookCatalogQuery): Promise<WarehouseAudiobookCatalogPage> {
  return expectJson<WarehouseAudiobookCatalogPage>(await api(catalogAudiobooksUrl(query)), 'Failed to load audiobook catalog')
}

export async function fetchCatalogSourceAudiobook(remoteId: string): Promise<WarehouseAudiobookDetail | null> {
  const response = await api(catalogAudiobookPath(remoteId))
  if (response.status === 404) return null

  return toCatalogAudiobookDetail(await expectJson<WarehouseAudiobookDetail & { raw?: unknown }>(response, LIBRARY_ITEM_LOAD_ERROR))
}

export async function fetchCatalogSourceComic(remoteId: string): Promise<WarehouseComicCatalogItem | null> {
  const response = await api(catalogComicPath(remoteId))
  if (response.status === 404) return null

  return toCatalogComicItem(await expectJson<WarehouseComicCatalogItem & { raw?: unknown }>(response, LIBRARY_ITEM_LOAD_ERROR))
}

export async function fetchCatalogLibraryItems(libraryId: number, query: BookQuery, signal?: AbortSignal): Promise<CatalogLibraryItemsPage> {
  return expectJson<CatalogLibraryItemsPage>(
    await api(`/api/v1/libraries/${encodeURIComponent(libraryId)}/catalog-items/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal,
    }),
    'Failed to load library items',
  )
}

export async function searchCatalogSourceRequestBooks(q: string): Promise<WarehouseEbookExternalSearchPage> {
  const params = new URLSearchParams()
  appendQueryParam(params, 'q', q)
  const queryString = params.toString()
  const path = queryString ? `${CATALOG_REQUEST_EBOOKS_PATH}/search?${queryString}` : `${CATALOG_REQUEST_EBOOKS_PATH}/search`

  return expectJson<WarehouseEbookExternalSearchPage>(await api(path), 'Failed to search titles')
}

export async function searchCatalogSourceRequestAudiobooks(q: string): Promise<WarehouseAudiobookExternalSearchPage> {
  const params = new URLSearchParams()
  appendQueryParam(params, 'q', q)
  const queryString = params.toString()
  const path = queryString ? `${CATALOG_REQUEST_AUDIOBOOKS_PATH}/search?${queryString}` : `${CATALOG_REQUEST_AUDIOBOOKS_PATH}/search`

  return expectJson<WarehouseAudiobookExternalSearchPage>(await api(path), 'Failed to search titles')
}

export async function searchCatalogSourceRequestAudiobookCandidates(q: string): Promise<WarehouseAudiobookExternalSearchPage> {
  const params = new URLSearchParams()
  appendQueryParam(params, 'q', q)
  const queryString = params.toString()
  const path = queryString ? `${CATALOG_REQUEST_AUDIOBOOKS_PATH}/candidates?${queryString}` : `${CATALOG_REQUEST_AUDIOBOOKS_PATH}/candidates`

  return expectJson<WarehouseAudiobookExternalSearchPage>(await api(path), 'Failed to search candidates')
}

export async function submitCatalogSourceEbookRequest(payload: WarehouseEbookRequestSubmitPayload): Promise<WarehouseRequestDetail> {
  return expectJson<WarehouseRequestDetail>(
    await api(CATALOG_REQUEST_EBOOKS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'Failed to submit request',
  )
}

export async function submitCatalogSourceAudiobookRequest(payload: WarehouseAudiobookRequestSubmitPayload): Promise<WarehouseRequestDetail> {
  const body: WarehouseAudiobookRequestSubmitPayload = {
    title: payload.title,
    ...(payload.author === undefined ? {} : { author: payload.author }),
  }

  return expectJson<WarehouseRequestDetail>(
    await api(CATALOG_REQUEST_AUDIOBOOKS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'Failed to submit request',
  )
}

export async function fetchCatalogSourceRequests(query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
  return expectJson<WarehouseRequestPage>(await api(catalogRequestsUrl(query)), 'Failed to load requests')
}

export async function fetchCatalogSourceAudiobookRequests(query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
  return expectJson<WarehouseRequestPage>(await api(catalogAudiobookRequestsUrl(CATALOG_REQUEST_AUDIOBOOKS_PATH, query)), 'Failed to load requests')
}

export async function fetchCatalogSourceComicRequests(query: WarehouseRequestListQuery): Promise<WarehouseRequestPage> {
  return expectJson<WarehouseRequestPage>(await api(catalogAudiobookRequestsUrl(CATALOG_REQUEST_COMICS_PATH, query)), 'Failed to load requests')
}

export async function refreshCatalogSourceComicRequests(query: WarehouseRequestListQuery = {}): Promise<WarehouseRequestPage> {
  return expectJson<WarehouseRequestPage>(
    await api(catalogAudiobookRequestsUrl(`${CATALOG_REQUEST_COMICS_PATH}/refresh`, query), { method: 'POST' }),
    'Failed to refresh requests',
  )
}

export async function submitCatalogSourceComicRequest(payload: WarehouseComicRequestSubmitPayload): Promise<WarehouseRequestDetail> {
  const body: WarehouseComicRequestSubmitPayload = {
    seriesTitle: payload.seriesTitle,
    ...(payload.issueNumber === undefined ? {} : { issueNumber: payload.issueNumber }),
    ...(payload.publisher === undefined ? {} : { publisher: payload.publisher }),
    ...(payload.year === undefined ? {} : { year: payload.year }),
  }

  return expectJson<WarehouseRequestDetail>(
    await api(CATALOG_REQUEST_COMICS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'Failed to submit request',
  )
}

export async function refreshCatalogSourceAudiobookRequests(query: WarehouseRequestListQuery = {}): Promise<WarehouseRequestPage> {
  return expectJson<WarehouseRequestPage>(
    await api(catalogAudiobookRequestsUrl(`${CATALOG_REQUEST_AUDIOBOOKS_PATH}/refresh`, query), { method: 'POST' }),
    'Failed to refresh requests',
  )
}

export async function fetchCatalogSourceAudiobookRequestQueue(): Promise<WarehouseAudiobookQueuePage> {
  return expectJson<WarehouseAudiobookQueuePage>(await api(`${CATALOG_REQUEST_AUDIOBOOKS_PATH}/queue`), 'Failed to load queue')
}

export async function fetchCatalogSourceRequest(id: number): Promise<WarehouseRequestDetail | null> {
  const response = await api(catalogRequestPath(id))
  if (response.status === 404) return null

  return expectJson<WarehouseRequestDetail>(response, 'Failed to load requests')
}

export async function refreshCatalogSourceRequest(id: number): Promise<WarehouseRequestDetail> {
  return expectJson<WarehouseRequestDetail>(await api(`${catalogRequestPath(id)}/refresh`, { method: 'POST' }), 'Failed to refresh request')
}

export async function cancelCatalogSourceRequest(id: number): Promise<WarehouseRequestDetail> {
  return expectJson<WarehouseRequestDetail>(await api(catalogRequestPath(id), { method: 'DELETE' }), 'Failed to cancel request')
}

export async function fetchCatalogSourceUserState(mediaType: WarehouseMediaType, remoteId: string): Promise<WarehouseUserCatalogState> {
  return toCatalogUserState(
    await expectJson<WarehouseUserCatalogState & Record<string, unknown>>(
      await api(catalogUserStatePath(mediaType, remoteId)),
      'Failed to load library item state',
    ),
  )
}

export async function patchCatalogSourceUserState(
  mediaType: WarehouseMediaType,
  remoteId: string,
  patch: WarehouseUserCatalogStatePatch,
): Promise<WarehouseUserCatalogState> {
  return toCatalogUserState(
    await expectJson<WarehouseUserCatalogState & Record<string, unknown>>(
      await api(catalogUserStatePath(mediaType, remoteId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toCatalogUserStatePatch(patch)),
      }),
      'Failed to save library item state',
    ),
  )
}

export async function saveCatalogSourceReadingSession(
  mediaType: WarehouseMediaType,
  remoteId: string,
  payload: CatalogReadingSessionPayload,
  options: { useBeacon?: boolean } = {},
): Promise<void> {
  const url = catalogReadingSessionsPath(mediaType, remoteId)
  const body = JSON.stringify(payload)

  if (options.useBeacon && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    return
  }

  const response = await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  if (!response.ok) throw new Error('Failed to save reading session')
}

export async function fetchCatalogSourceBookmarks(mediaType: WarehouseMediaType, remoteId: string): Promise<WarehouseCatalogBookmark[]> {
  const response = await expectJson<Array<WarehouseCatalogBookmark & Record<string, unknown>>>(
    await api(catalogBookmarksPath(mediaType, remoteId)),
    'Failed to load bookmarks',
  )
  return response.map(toCatalogBookmark)
}

export async function createCatalogSourceBookmark(
  mediaType: WarehouseMediaType,
  remoteId: string,
  payload: WarehouseCatalogBookmarkCreatePayload,
): Promise<WarehouseCatalogBookmark> {
  return toCatalogBookmark(
    await expectJson<WarehouseCatalogBookmark & Record<string, unknown>>(
      await api(catalogBookmarksPath(mediaType, remoteId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toCatalogBookmarkCreatePayload(payload)),
      }),
      'Failed to save bookmark',
    ),
  )
}

export async function deleteCatalogSourceBookmark(mediaType: WarehouseMediaType, remoteId: string, bookmarkId: number): Promise<void> {
  const response = await api(`${catalogBookmarksPath(mediaType, remoteId)}/${encodeURIComponent(bookmarkId)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete bookmark')
}

export async function fetchCatalogSourceAnnotations(mediaType: WarehouseMediaType, remoteId: string): Promise<WarehouseCatalogAnnotation[]> {
  const response = await expectJson<Array<WarehouseCatalogAnnotation & Record<string, unknown>>>(
    await api(catalogAnnotationsPath(mediaType, remoteId)),
    'Failed to load annotations',
  )
  return response.map(toCatalogAnnotation)
}

export async function createCatalogSourceAnnotation(
  mediaType: WarehouseMediaType,
  remoteId: string,
  payload: WarehouseCatalogAnnotationCreatePayload,
): Promise<WarehouseCatalogAnnotation> {
  return toCatalogAnnotation(
    await expectJson<WarehouseCatalogAnnotation & Record<string, unknown>>(
      await api(catalogAnnotationsPath(mediaType, remoteId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toCatalogAnnotationCreatePayload(payload)),
      }),
      'Failed to save annotation',
    ),
  )
}

export async function updateCatalogSourceAnnotation(
  mediaType: WarehouseMediaType,
  remoteId: string,
  annotationId: number,
  payload: WarehouseCatalogAnnotationUpdatePayload,
): Promise<WarehouseCatalogAnnotation> {
  return toCatalogAnnotation(
    await expectJson<WarehouseCatalogAnnotation & Record<string, unknown>>(
      await api(`${catalogAnnotationsPath(mediaType, remoteId)}/${encodeURIComponent(annotationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toCatalogAnnotationUpdatePayload(payload)),
      }),
      'Failed to save annotation',
    ),
  )
}

export async function deleteCatalogSourceAnnotation(mediaType: WarehouseMediaType, remoteId: string, annotationId: number): Promise<void> {
  const response = await api(`${catalogAnnotationsPath(mediaType, remoteId)}/${encodeURIComponent(annotationId)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete annotation')
}

export function catalogSourceAudiobookCoverUrl(remoteId: string): string {
  return `${LIBRARY_AUDIOBOOKS_PATH}/${encodeURIComponent(remoteId)}/cover`
}

export function catalogSourceEbookCoverUrl(remoteId: string, size: 'thumbnail' | 'medium' | 'original' = 'medium'): string {
  return `${LIBRARY_EBOOKS_PATH}/${encodeURIComponent(remoteId)}/cover/${encodeURIComponent(size)}`
}

/**
 * The cover is page one downscaled and cached server side. Pointing a grid at the raw
 * page endpoint pulls the full print resolution image, which is megabytes per tile.
 */
export function catalogSourceComicCoverUrl(remoteId: string, size: 'thumbnail' | 'original' = 'thumbnail'): string {
  return `${LIBRARY_COMICS_PATH}/${encodeURIComponent(remoteId)}/cover?size=${size}`
}

export function catalogSourceComicPageImageUrl(remoteId: string, pageIndex = 0): string {
  return `${LIBRARY_COMICS_PATH}/${encodeURIComponent(remoteId)}/pages/${encodeURIComponent(pageIndex)}`
}

export function catalogSourceEbookDownloadUrl(remoteId: string): string {
  return `${LIBRARY_EBOOKS_PATH}/${encodeURIComponent(remoteId)}/download`
}

export function catalogSourceComicDownloadUrl(remoteId: string): string {
  return `${LIBRARY_COMICS_PATH}/${encodeURIComponent(remoteId)}/download`
}

export function catalogSourceAudiobookStreamUrl(remoteId: string): string {
  return `${LIBRARY_AUDIOBOOKS_PATH}/${encodeURIComponent(remoteId)}/stream`
}

export function catalogSourceAudiobookDownloadUrl(remoteId: string): string {
  return `${LIBRARY_AUDIOBOOKS_PATH}/${encodeURIComponent(remoteId)}/download`
}

export function catalogSourceAudiobookFileDownloadUrl(remoteId: string, fileId: string): string {
  return `${LIBRARY_AUDIOBOOKS_PATH}/${encodeURIComponent(remoteId)}/files/${encodeURIComponent(fileId)}/download`
}

export function catalogSourceRequestStreamUrl(id: number): string {
  return `${REQUESTS_PATH}/${encodeURIComponent(id)}/stream`
}
