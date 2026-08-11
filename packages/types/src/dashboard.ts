import type { WarehouseCatalogAuthorRef, WarehouseCatalogSeriesRef, WarehouseMediaType, WarehouseUserReadStatus } from "./warehouse";
import type { BookCard } from "./book";

export const SCROLLER_TYPE = {
  RECENTLY_ADDED: "recently-added",
  CONTINUE_READING: "continue-reading",
  CONTINUE_LISTENING: "continue-listening",
  WANT_TO_READ: "want-to-read",
  UP_NEXT_IN_SERIES: "up-next-in-series",
  RANDOM: "random",
  SMART_SCOPE: "smart-scope",
  CATALOG_ADDITIONS: "catalog-additions",
  CATALOG_DISCOVERY: "catalog-discovery",
} as const;

export type ScrollerType = (typeof SCROLLER_TYPE)[keyof typeof SCROLLER_TYPE];
export const SCROLLER_TYPES = Object.values(SCROLLER_TYPE) as ReadonlyArray<ScrollerType>;

export const DASHBOARD_SCROLLER_BATCH_MAX = 8;

// The server rejects a larger per-shelf limit. Shared so the client can size a
// multi-row shelf without guessing the ceiling it will be validated against.
export const DASHBOARD_SCROLLER_MAX_LIMIT = 50;

export interface DashboardScrollerBatchItem {
  id: string;
  type: ScrollerType;
  limit: number;
  smartScopeId?: number;
}

export interface DashboardScrollerBatchRequest {
  items: DashboardScrollerBatchItem[];
}

export interface DashboardScrollerBatchResult {
  id: string;
  books: BookCard[];
  failed: boolean;
}

export interface DashboardScrollerBatchResponse {
  items: DashboardScrollerBatchResult[];
}
export interface ScrollerConfig {
  id: string;
  type: ScrollerType;
  label: string;
  enabled: boolean;
  order: number;
  // Books per row. The shelf fetches `limit * rows`, capped at DASHBOARD_SCROLLER_MAX_LIMIT.
  limit: number;
  rows: number;
  smartScopeId?: number;
}

export interface DashboardCatalogItem {
  type: "catalog-item";
  mediaType: WarehouseMediaType;
  remoteId: string;
  title: string;
  subtitle: string | null;
  seriesName: string | null;
  seriesRef?: WarehouseCatalogSeriesRef | null;
  seriesIndex?: number | null;
  authors: string[];
  authorRefs?: WarehouseCatalogAuthorRef[];
  narrators: string[];
  libraryName: string;
  formats: string[];
  language?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  fileSizeBytes?: number | null;
  metadataScore?: number | null;
  rating?: number | null;
  readingProgress?: number | null;
  readStatus?: WarehouseUserReadStatus | null;
  lastReadAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
  hasCover: boolean;
  addedAt?: string | null;
  updatedAt?: string | null;
}

export interface DashboardCatalogAdditionsData {
  items: DashboardCatalogItem[];
}

export type DashboardScrollerItem = BookCard;

export const WIDGET_TYPE = {
  READING_STREAK: "reading-streak",
  CURRENTLY_READING: "currently-reading",
  READING_GOAL: "reading-goal",
  READING_DNA: "reading-dna",
  MONTHLY_CHALLENGE: "monthly-challenge",
  HIGHLIGHT_OF_THE_DAY: "highlight-of-the-day",
  NEGLECTED_GEMS: "neglected-gems",
  READING_RHYTHM: "reading-rhythm",
  DIVERSITY_SCORE: "diversity-score",
  LIBRARY_OVERVIEW: "library-overview",
  YEAR_PROJECTION: "year-projection",
  LONG_WAIT: "long-wait",
} as const;

export type WidgetType = (typeof WIDGET_TYPE)[keyof typeof WIDGET_TYPE];
export const WIDGET_TYPES = Object.values(WIDGET_TYPE) as ReadonlyArray<WidgetType>;

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  enabled: boolean;
  order: number;
}

export interface DashboardConfig {
  readingGoal?: number;
  widgets?: WidgetConfig[];
}

export interface ReadingGoalWidgetData {
  goalBooks: number | null;
  completedBooks: number;
  year: number;
}

export interface CurrentlyReadingBook {
  type?: "local-book";
  bookId: number;
  title: string | null;
  authors: string[];
  progress: number;
  hasCover: boolean;
  fileId: number | null;
  fileFormat: string | null;
  lastActivityAt?: string | null;
}

export interface CurrentlyReadingCatalogItem {
  type: "catalog-item";
  mediaType: WarehouseMediaType;
  remoteId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  authorRefs?: WarehouseCatalogAuthorRef[];
  narrators: string[];
  seriesName: string | null;
  seriesRef?: WarehouseCatalogSeriesRef | null;
  libraryName: string;
  fileFormat: string | null;
  progress: number;
  positionSeconds: number | null;
  hasCover: boolean;
  lastActivityAt?: string | null;
}

export type CurrentlyReadingItem = CurrentlyReadingBook | CurrentlyReadingCatalogItem;

export interface CurrentlyReadingWidgetData {
  books: CurrentlyReadingItem[];
}

export interface ReadingStreakWidgetData {
  currentStreak: number;
  longestStreak: number;
  lastSevenDays: boolean[];
}

export interface LibraryOverviewWidgetData {
  totalBooks: number;
  totalAuthors: number;
  totalSeries: number;
  totalStorageBytes: number;
  booksAddedThisYear: number;
}

export interface LocalHighlightOfTheDayWidgetData {
  type?: "local-book";
  text: string;
  note: string | null;
  bookTitle: string | null;
  bookId: number;
  hasCover: boolean;
  chapterTitle: string | null;
  createdAt: string;
}

export interface CatalogHighlightOfTheDayWidgetData {
  type: "catalog-item";
  text: string;
  note: string | null;
  bookTitle: string | null;
  bookId: null;
  mediaType: WarehouseMediaType;
  remoteId: string;
  libraryName: string;
  hasCover: boolean;
  chapterTitle: string | null;
  createdAt: string;
}

export type HighlightOfTheDayWidgetData = LocalHighlightOfTheDayWidgetData | CatalogHighlightOfTheDayWidgetData;

export type ChallengeType = "short-read" | "genre-explorer" | "finish-oldest" | "streak-builder" | "new-author" | "page-milestone";

export interface MonthlyChallengeWidgetData {
  challengeType: ChallengeType;
  title: string;
  description: string;
  progress: number;
  target: number;
  completed: boolean;
  month: number;
  year: number;
}

export interface YearProjectionWidgetData {
  projectedBooks: number;
  projectedPages: number;
  projectedHours: number;
  booksCompletedYtd: number;
  daysRemaining: number;
  trend: "up" | "down" | "stable";
}

export interface NeglectedGem {
  type?: "book" | "catalog-item";
  bookId: number;
  mediaType?: WarehouseMediaType;
  remoteId?: string;
  libraryName?: string;
  title: string | null;
  hasCover: boolean;
  rating: number;
  waitingDays: number;
  genre: string | null;
}

export interface NeglectedGemsWidgetData {
  gems: NeglectedGem[];
}

export interface ReadingDnaWidgetData {
  archetype: string;
  lengthScore: number;
  varietyScore: number;
  rhythmScore: number;
  timeScore: number;
  speedScore: number;
  lengthLabel: string;
  varietyLabel: string;
  rhythmLabel: string;
  timeLabel: string;
  speedLabel: string;
  booksAnalyzed: number;
}

export interface LongWaitWidgetData {
  type?: "book" | "catalog-item";
  bookId: number;
  mediaType?: WarehouseMediaType;
  remoteId?: string;
  title: string | null;
  hasCover: boolean;
  addedAt: string;
  waitingDays: number;
  pageCount: number | null;
  genre: string | null;
  fileId: number | null;
  fileFormat: string | null;
}

export interface DiversityScoreWidgetData {
  score: number;
  label: string;
  genreScore: number;
  authorScore: number;
  eraScore: number;
  languageScore: number;
  booksAnalyzed: number;
}

export interface ReadingRhythmDay {
  date: string;
  readingSeconds: number;
}

export interface ReadingRhythmWidgetData {
  days: ReadingRhythmDay[];
  consistencyPercent: number;
  avgSecondsPerDay: number;
  activeDays: number;
  totalDays: number;
}
