export type WarehouseMediaType = "ebook" | "audiobook" | "comic";

export type WarehouseUserReadStatus =
  | "unread"
  | "want_to_read"
  | "reading"
  | "on_hold"
  | "rereading"
  | "read"
  | "skimmed"
  | "abandoned";

export type WarehouseConnectionStatus = "untested" | "ok" | "error";

export type WarehouseSourceBackedLibraryIcons = Record<WarehouseMediaType, string>;

export interface WarehouseAdminSettings {
  enabled: boolean;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  syncCadenceMinutes: number;
  sourceBackedLibraryIcons: WarehouseSourceBackedLibraryIcons;
  lastConnectionStatus: WarehouseConnectionStatus;
  lastConnectionCheckedAt: string | null;
  lastConnectionError: string | null;
}

export interface UpsertWarehouseAdminSettingsPayload {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  syncCadenceMinutes?: number;
  sourceBackedLibraryIcons?: Partial<WarehouseSourceBackedLibraryIcons>;
}

export interface WarehouseConnectionTestResult {
  ok: boolean;
  status: number | null;
  message: string;
  checkedAt: string;
}

export interface WarehouseErrorPayload {
  error: string;
}

export interface WarehouseListPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number | null;
  hasNextPage: boolean;
}

export interface WarehouseBookSummary {
  id: string;
  title: string;
  author?: string | null;
  authors?: string[];
  format?: string | null;
  language?: string | null;
  series?: string | null;
  publisher?: string | null;
  coverUrl?: string | null;
  hasCover?: boolean | null;
}

export interface WarehouseAudiobookSummary {
  id: string;
  title: string;
  author?: string | null;
  authors?: string[];
  narrators?: string[];
  series?: string | null;
  duration?: number | null;
  coverUrl?: string | null;
}

export interface WarehouseComicSummary extends WarehouseBookSummary {
  seriesId?: string | null;
  issueNumber?: string | null;
  year?: number | null;
}

export interface WarehouseComicSeriesSummary {
  id: string;
  title: string;
  publisher?: string | null;
  year?: number | null;
}

export interface WarehouseExternalBookSearchResult {
  title: string;
  author?: string | null;
  isbn?: string | null;
}

export interface WarehouseExternalAudiobookSearchResult {
  title: string;
  author?: string | null;
  authors?: string[];
  narrators?: string[];
  asin?: string | null;
  series?: string | null;
  durationSeconds?: number | null;
}

export interface WarehouseEbookExternalSearchQuery {
  q: string;
}

export interface WarehouseEbookExternalSearchPage {
  results: WarehouseExternalBookSearchResult[];
}

export interface WarehouseAudiobookExternalSearchPage {
  results: WarehouseExternalAudiobookSearchResult[];
}

export type WarehouseRequestStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface WarehouseEbookRequestSubmitPayload {
  isbn?: string;
  preferredFormat?: string;
  searchResult?: WarehouseExternalBookSearchResult & Record<string, unknown>;
}

export interface WarehouseAudiobookRequestSubmitPayload {
  title: string;
  author?: string;
}

export interface WarehouseComicRequestSubmitPayload {
  seriesTitle: string;
  issueNumber?: string;
  publisher?: string;
  year?: number;
}

export interface WarehouseRequestListQuery {
  status?: WarehouseRequestStatus;
  page?: number;
  limit?: number;
  mediaType?: WarehouseMediaType;
}

export interface WarehouseRequestSearchResultSummary {
  title?: string;
  author?: string | null;
  authors?: string[];
  isbn?: string | null;
  isbn13?: string | null;
}

export interface WarehouseRequestPayloadSummary {
  isbn?: string;
  preferredFormat?: string;
  title?: string;
  author?: string;
  seriesTitle?: string;
  issueNumber?: string;
  publisher?: string;
  year?: number;
  searchResult?: WarehouseRequestSearchResultSummary;
}

export interface WarehouseRequestItem {
  id: number;
  mediaType: WarehouseMediaType;
  status: WarehouseRequestStatus;
  title: string;
  author: string | null;
  isbn: string | null;
  completedRemoteId: string | null;
  requestedAt: string;
  updatedAt: string;
  lastStatusSyncedAt: string | null;
}

export interface WarehouseRequestDetail extends WarehouseRequestItem {
  requestedPayload: WarehouseRequestPayloadSummary;
}

export interface WarehouseRequestPage {
  items: WarehouseRequestItem[];
  page: number;
  limit: number;
  total: number;
}

export interface WarehouseAudiobookQueueItem {
  title: string;
  author?: string | null;
  status: WarehouseRequestStatus;
}

export interface WarehouseAudiobookQueuePage {
  items: WarehouseAudiobookQueueItem[];
}

export type WarehouseCatalogSort =
  | "title"
  | "author"
  | "series"
  | "syncedAt"
  | "addedAt";

export type WarehouseCatalogOrder = "asc" | "desc";

export type WarehouseAudiobookCatalogSort =
  | WarehouseCatalogSort
  | "narrator"
  | "duration";

export interface WarehouseUserCatalogState {
  mediaType: WarehouseMediaType;
  remoteId: string;
  inLibrary: boolean;
  favorite: boolean;
  rating: number | null;
  readStatus: WarehouseUserReadStatus | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  finishedAt: string | null;
  updatedAt: string | null;
}

export interface WarehouseUserCatalogStatePatch {
  inLibrary?: boolean;
  favorite?: boolean;
  rating?: number | null;
  readStatus?: WarehouseUserReadStatus | null;
  progressPercent?: number | null;
  positionSeconds?: number | null;
}

export interface WarehouseCatalogBookmark {
  id: number;
  mediaType: WarehouseMediaType;
  remoteId: string;
  cfi: string | null;
  title: string;
  positionSeconds: number | null;
  createdAt: string;
}

export interface WarehouseCatalogBookmarkCreatePayload {
  cfi?: string;
  title: string;
  positionSeconds?: number;
}

export interface WarehouseCatalogAnnotation {
  id: number;
  mediaType: WarehouseMediaType;
  remoteId: string;
  cfi: string;
  text: string;
  color: string;
  style: string;
  note: string | null;
  chapterTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseCatalogAnnotationCreatePayload {
  cfi: string;
  text: string;
  color: string;
  style: string;
  note?: string | null;
  chapterTitle?: string | null;
}

export interface WarehouseCatalogAnnotationUpdatePayload {
  note?: string | null;
}

export interface WarehouseEbookCatalogQuery {
  q?: string;
  page?: number;
  limit?: number;
  sort?: WarehouseCatalogSort;
  order?: WarehouseCatalogOrder;
  author?: string;
  series?: string;
  language?: string;
  format?: string;
  genre?: string;
  hasCover?: boolean;
}

export interface WarehouseEbookCatalogItem {
  id: number;
  remoteId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  authorRefs?: WarehouseCatalogAuthorRef[];
  series: string | null;
  seriesRef?: WarehouseCatalogSeriesRef | null;
  language: string | null;
  publisher: string | null;
  identifiers: Record<string, string>;
  format: string | null;
  hasCover: boolean;
  syncedAt: string;
  source: "catalog-source";
}

export interface WarehouseEbookCatalogPage {
  items: WarehouseEbookCatalogItem[];
  page: number;
  limit: number;
  total: number;
}

export type WarehouseEbookDetail = WarehouseEbookCatalogItem;

export type WarehouseComicCatalogQuery = WarehouseEbookCatalogQuery;

export interface WarehouseComicSeriesQuery {
  q?: string;
  page?: number;
  limit?: number;
}

export interface WarehouseComicCatalogItem extends WarehouseEbookCatalogItem {
  mediaType: "comic";
  seriesId?: string | null;
  issueNumber?: string | null;
  year?: number | null;
}

export interface WarehouseComicCatalogPage {
  items: WarehouseComicCatalogItem[];
  page: number;
  limit: number;
  total: number;
}

export type WarehouseComicDetail = WarehouseComicCatalogItem;

export interface WarehouseComicPageItem {
  index: number;
  contentType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
}

export interface WarehouseComicPagesPage {
  items: WarehouseComicPageItem[];
  total: number;
}

export interface WarehouseAudiobookCatalogQuery {
  q?: string;
  page?: number;
  limit?: number;
  sort?: WarehouseAudiobookCatalogSort;
  order?: WarehouseCatalogOrder;
  author?: string;
  narrator?: string;
  series?: string;
  language?: string;
  format?: string;
  genre?: string;
  hasCover?: boolean;
}

export interface WarehouseAudiobookCatalogItem {
  id: number;
  remoteId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  authorRefs?: WarehouseCatalogAuthorRef[];
  narrators: string[];
  series: string | null;
  seriesRef?: WarehouseCatalogSeriesRef | null;
  language: string | null;
  publisher: string | null;
  identifiers: Record<string, string>;
  format: string | null;
  durationSeconds: number | null;
  hasCover: boolean;
  syncedAt: string;
  source: "catalog-source";
}

export interface WarehouseCatalogAuthorRef {
  id: number;
  name: string;
}

export interface WarehouseCatalogSeriesRef {
  id: number;
  name: string;
}

export interface WarehouseAudiobookChapter {
  id?: string;
  title: string;
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number | null;
}

export interface WarehouseAudiobookFile {
  id: string;
  name: string;
  format: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
}

export interface WarehouseAudiobookDetail extends WarehouseAudiobookCatalogItem {
  chapters: WarehouseAudiobookChapter[];
  files: WarehouseAudiobookFile[];
}

export interface WarehouseAudiobookCatalogPage {
  items: WarehouseAudiobookCatalogItem[];
  page: number;
  limit: number;
  total: number;
}

export type WarehouseCatalogDimensionKind =
  | "author"
  | "narrator"
  | "series"
  | "genre";

export interface WarehouseCatalogDimensionItem {
  id: string;
  name: string;
  itemCount: number;
}

export interface WarehouseCatalogDimensionPage {
  items: WarehouseCatalogDimensionItem[];
  total: number;
}

export type WarehouseCatalogSyncRunStatus =
  | "running"
  | "completed"
  | "failed";

export type WarehouseCatalogSyncMediaType =
  | WarehouseMediaType
  | "mixed";

export interface WarehouseCatalogSyncSummary {
  runId: number;
  status: WarehouseCatalogSyncRunStatus;
  mediaType: WarehouseCatalogSyncMediaType;
  fetchedCount: number;
  savedCount: number;
  totalCount: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface WarehouseCatalogSyncState {
  lastRun: WarehouseCatalogSyncSummary | null;
  lastRuns: {
    ebook: WarehouseCatalogSyncSummary | null;
    audiobook: WarehouseCatalogSyncSummary | null;
    comic: WarehouseCatalogSyncSummary | null;
  };
  running: boolean;
}

export interface WarehouseCacheMediaStatus {
  entries: number;
  bytes: number;
}

export interface WarehouseCacheStatus {
  covers: {
    totalEntries: number;
    totalBytes: number;
    byMediaType: Record<WarehouseMediaType, WarehouseCacheMediaStatus>;
  };
}

export interface WarehouseCacheClearResult extends WarehouseCacheStatus {
  cleared: {
    covers: WarehouseCacheMediaStatus;
  };
}
