import { Inject, Injectable } from '@nestjs/common';
import type {
  AcquisitionLagPoint,
  BooksAddedDataPoint,
  ChordDiagramData,
  ContentFilterRules,
  FormatDistributionItem,
  FormatShareOverTimeItem,
  GenreDistributionItem,
  LanguageDistributionItem,
  JumpBucketKind,
  JumpBucketsResponse,
  LargestBookItem,
  LibraryIntegrityGauge,
  LibraryMetadataCompletenessItem,
  LibraryOverviewWidgetData,
  LongWaitWidgetData,
  MetadataFreshnessGauge,
  MetadataScoreDistribution,
  NeglectedGemsWidgetData,
  PageCountDistributionItem,
  PublicationDecadeItem,
  PublicationYearPoint,
  StatisticsSummary,
  StatisticsResult,
  StatisticsDateRange,
  StatisticsGranularity,
  StorageByFormatItem,
  TopAuthorItem,
  TopSeriesItem,
  UserCompletionTimelinePoint,
  UserProgressFunnel,
  UserStatisticsSummary,
  GroupRule,
  Rule,
  SortField,
  SortSpec,
  WarehouseAudiobookCatalogQuery,
  WarehouseCatalogDimensionKind,
  WarehouseCatalogSyncMediaType,
  WarehouseComicCatalogQuery,
  WarehouseEbookCatalogQuery,
  WarehouseMediaType,
  WarehouseRequestListQuery,
  WarehouseRequestStatus,
  WarehouseUserReadStatus,
} from '@bookorbit/types';
import {
  CLOUD_AUDIO_LIBRARY_ID,
  CLOUD_COMIC_LIBRARY_ID,
  CLOUD_EBOOK_LIBRARY_ID,
  DEFAULT_FORMAT_PRIORITY,
  isContentFilterEmpty,
  jumpBucketKindForSort,
} from '@bookorbit/types';
import { SQL, SQLWrapper, and, asc, desc, eq, getTableColumns, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, not, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import type {
  NewWarehouseCatalogDetailRow,
  NewWarehouseCatalogItemAuthorRow,
  NewWarehouseCatalogItemRow,
  NewWarehouseAnnotationRow,
  NewWarehouseBookmarkRow,
  NewWarehouseRequestRow,
  NewWarehouseUserStateRow,
  NewWarehouseSettingRow,
  WarehouseBookmarkRow,
  WarehouseAnnotationRow,
  WarehouseCatalogItemRow,
  WarehouseCatalogSyncRunRow,
  WarehouseRequestRow,
  WarehouseUserItemRow,
  WarehouseUserStateRow,
} from '../../db/schema';
import { catalogAuthorCanonicalName, catalogAuthorRefs } from './catalog-link-refs';
import { normalizeWarehouseRequestStatus } from './warehouse-request.mapper';

type Db = NodePgDatabase<typeof schema>;

/** Caps how many ANDed ILIKE clauses one query can build. */
const MAX_SEARCH_WORDS = 8;
type WarehouseConnectionStatus = 'untested' | 'ok' | 'error';
type SyncCounts = { fetchedCount: number; savedCount: number };
type SyncTimings = Record<string, number>;
type CatalogSeriesItemsPage = {
  rows: UserOwnedCatalogItemRow[];
  total: number;
  page: number;
  size: number;
};
export type WarehouseLibraryMetadataCompletenessRow = Pick<LibraryMetadataCompletenessItem, 'libraryId' | 'libraryName'> & {
  total: number;
  hasTitle: number;
  hasCover: number;
  hasAuthor: number;
  hasGenre: number;
  hasTag: number;
  hasDescription: number;
  hasPublisher: number;
  hasYear: number;
  hasLanguage: number;
  hasPageCount: number;
  hasRating: number;
  hasSeries: number;
  hasIsbn: number;
};
export type UserOwnedCatalogItemRow = WarehouseCatalogItemRow & {
  userAddedAt?: Date | null;
  rating?: number | null;
  readingProgress?: number | null;
  readStatus?: WarehouseUserReadStatus | null;
  publishedYear?: number | null;
  pageCount?: number | null;
  fileSizeBytes?: number | null;
  metadataScore?: number | null;
  lastReadAt?: Date | null;
  finishedAt?: Date | null;
};
/**
 * A catalogue list row without raw_payload.
 *
 * The list mappers read scalar columns only, but the queries used to select every column,
 * which pulled the whole upstream payload for each row on every page. For audiobooks that
 * jsonb carries the entire files array with per-file tags and descriptions, so a page of 50
 * transferred and parsed megabytes of jsonb that was then discarded.
 */
export type CatalogListRow = Omit<UserOwnedCatalogItemRow, 'rawPayload'>;

type CatalogPage = {
  rows: UserOwnedCatalogItemRow[];
  total: number;
  page: number;
  limit: number;
};

/** The list endpoints return rows without raw_payload; queryUserCatalogItems still needs it. */
type CatalogListPage = {
  rows: CatalogListRow[];
  total: number;
  page: number;
  limit: number;
};

/** Every catalogue column except raw_payload. Kept in one place so the three list queries
 *  cannot drift apart. */
const catalogListColumns = {
  id: schema.warehouseCatalogItems.id,
  mediaType: schema.warehouseCatalogItems.mediaType,
  remoteId: schema.warehouseCatalogItems.remoteId,
  title: schema.warehouseCatalogItems.title,
  subtitle: schema.warehouseCatalogItems.subtitle,
  sortTitle: schema.warehouseCatalogItems.sortTitle,
  authors: schema.warehouseCatalogItems.authors,
  narrators: schema.warehouseCatalogItems.narrators,
  series: schema.warehouseCatalogItems.series,
  seriesIndex: schema.warehouseCatalogItems.seriesIndex,
  genres: schema.warehouseCatalogItems.genres,
  tags: schema.warehouseCatalogItems.tags,
  language: schema.warehouseCatalogItems.language,
  publisher: schema.warehouseCatalogItems.publisher,
  identifiers: schema.warehouseCatalogItems.identifiers,
  format: schema.warehouseCatalogItems.format,
  durationSeconds: schema.warehouseCatalogItems.durationSeconds,
  fileSizeBytes: schema.warehouseCatalogItems.fileSizeBytes,
  metadataScore: schema.warehouseCatalogItems.metadataScore,
  publishedYear: schema.warehouseCatalogItems.publishedYear,
  hasCover: schema.warehouseCatalogItems.hasCover,
  source: schema.warehouseCatalogItems.source,
  localPath: schema.warehouseCatalogItems.localPath,
  upstreamCreatedAt: schema.warehouseCatalogItems.upstreamCreatedAt,
  upstreamUpdatedAt: schema.warehouseCatalogItems.upstreamUpdatedAt,
  syncedAt: schema.warehouseCatalogItems.syncedAt,
  createdAt: schema.warehouseCatalogItems.createdAt,
  updatedAt: schema.warehouseCatalogItems.updatedAt,
} as const;
type CatalogDimensionRow = {
  name: string;
  itemCount: number;
};
type CatalogLibraryOverviewRow = {
  total_books?: unknown;
  total_authors?: unknown;
  total_series?: unknown;
  books_added_this_year?: unknown;
};
type CatalogStatisticsSummaryRow = CatalogLibraryOverviewRow & {
  total_publishers?: unknown;
  total_genres?: unknown;
  total_languages?: unknown;
};
type CatalogUserStatisticsSummaryRow = {
  tracked_books?: unknown;
  started_books?: unknown;
  in_progress_books?: unknown;
  completed_books?: unknown;
  mean_progress_percent?: unknown;
};
type CatalogUserProgressFunnelRow = {
  started?: unknown;
  reached25?: unknown;
  reached50?: unknown;
  reached75?: unknown;
  completed?: unknown;
};
type CatalogStatisticsDimensionValues = {
  authors: string[];
  series: string[];
  publishers: string[];
  genres: string[];
  languages: string[];
};
export type CatalogDiversityData = {
  uniqueGenresRead: number;
  totalGenresInLibrary: number;
  uniqueAuthorsRead: number;
  totalBooksRead: number;
  publicationYears: number[];
  uniqueLanguages: number;
  genresRead: string[];
  genresInLibrary: string[];
  authorsRead: string[];
  languagesRead: string[];
};
export type CatalogYearProjectionData = {
  booksCompletedYtd: number;
  pagesReadLast30Days: number;
  hoursReadLast30Days: number;
  booksCompletedLast30Days: number;
};
export type CatalogReadingDnaData = {
  avgPageCount: number;
  uniqueGenres: number;
  totalBooks: number;
  readingDaysRatio: number;
  peakHour: number;
  avgPagesPerHour: number | null;
  genresRead: string[];
  readingDays: string[];
  lookbackDays: number;
  hourBuckets: { hour: number; totalSeconds: number }[];
  pagesReadForSpeed: number;
  secondsReadForSpeed: number;
};
export type CatalogChallengePatternData = {
  avgPageCount: number;
  uniqueGenresLast6Months: number;
  staleInProgressCount: number;
  currentStreak: number;
  maxStreakThisMonth: number;
  topAuthorBookCount: number;
  totalBooksRead: number;
  pagesThisMonth: number;
  shortBooksCompleted: number;
  newGenresRead: number;
  oldestInProgressFinished: boolean;
  newAuthorsRead: number;
  pagesReadThisMonth: number;
  genresLast6Months: string[];
  genresReadThisMonth: string[];
  authorsReadThisMonth: string[];
  readingDaysThisMonth: string[];
};
export type CatalogHighlightAnnotationRow = {
  text: string;
  note: string | null;
  bookTitle: string;
  mediaType: WarehouseMediaType;
  remoteId: string;
  hasCover: boolean;
  chapterTitle: string | null;
  createdAt: Date;
};
export type CatalogAuthorSummaryRow = {
  id: number;
  name: string;
  sortName: string | null;
  description: string | null;
  bookCount: number;
  lastAddedAt: string | null;
};
export type CatalogAuthorSummaryPage = {
  rows: CatalogAuthorSummaryRow[];
  total: number;
  page: number;
  size: number;
};
export type CatalogSeriesSummaryRow = {
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
};
export type CatalogSeriesSummaryPage = {
  rows: CatalogSeriesSummaryRow[];
  total: number;
  page: number;
  size: number;
};
type UserCatalogItemsQuery = {
  filter?: GroupRule;
  includeAllCatalogItems?: boolean;
  mediaType?: WarehouseMediaType;
  mediaTypes?: WarehouseMediaType[];
  q?: string;
  sort?: SortSpec[];
  page?: number;
  limit?: number;
  contentFilters?: ContentFilterRules;
};
type JumpBucketRawRow = {
  bucket: string | null;
  item_index: number | string;
  total: number | string;
};
type IlikeExpression = Parameters<typeof ilike>[0];
type RequestPage = {
  rows: WarehouseRequestRow[];
  total: number;
  page: number;
  limit: number;
};
type RequestMirrorCreate = Omit<NewWarehouseRequestRow, 'id' | 'userId' | 'mediaType' | 'status' | 'requestedPayload'> & {
  userId: number;
  mediaType?: WarehouseMediaType;
  status?: WarehouseRequestStatus | string | null;
  requestedPayload?: Record<string, unknown> | null;
};
type RequestMirrorUpsert = RequestMirrorCreate & { id?: number };
type RequestMirrorScope = {
  userId: number;
  mediaType?: WarehouseMediaType;
};
type RequestMirrorUpdate = Partial<Pick<NewWarehouseRequestRow, 'completedRemoteId' | 'lastStatusSyncedAt' | 'title' | 'author' | 'isbn'>> & {
  mediaType?: WarehouseMediaType;
  upstreamRequestId?: string | null;
  status?: WarehouseRequestStatus | string | null;
  requestedPayload?: Record<string, unknown> | null;
};
export type RequestSyncCandidateQuery = { mediaType?: WarehouseMediaType; staleBefore?: Date; limit?: number };
export type WarehouseUserStatePatch = {
  inLibrary?: boolean;
  favorite?: boolean;
  rating?: number | null;
  readStatus?: WarehouseUserReadStatus | null;
  progressPercent?: number | null;
  positionSeconds?: number | null;
};
export type WarehouseUserCatalogStateRow = {
  mediaType: WarehouseMediaType;
  remoteId: string;
  inLibrary: boolean;
  favorite: boolean;
  rating: number | null;
  readStatus: WarehouseUserReadStatus | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  finishedAt: Date | null;
  updatedAt: Date | null;
};
export type WarehouseCurrentlyReadingCatalogRow = WarehouseCatalogItemRow & {
  readStatus: WarehouseUserReadStatus | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  lastActivityAt: Date | null;
};
export type WarehouseUserCatalogItemRow = UserOwnedCatalogItemRow & {
  userItemUpdatedAt: Date;
};
export type WarehouseUpNextInSeriesCatalogRow = WarehouseCatalogItemRow & {
  previousCompletionUpdatedAt: Date | null;
};
type NormalizedWarehouseUserStatePatch = Partial<
  Pick<NewWarehouseUserStateRow, 'favorite' | 'rating' | 'readStatus' | 'progressPercent' | 'positionSeconds' | 'finishedAt'>
>;
export type WarehouseCatalogBookmarkRow = WarehouseBookmarkRow;
export type WarehouseCatalogAnnotationRow = WarehouseAnnotationRow;

const PROFILE_KEY = 'default';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_READING_SESSION_SECONDS = 10;
const AUDIOBOOK_VIRTUAL_PAGES_PER_HOUR = 30;
const REQUEST_SYNC_CANDIDATE_STATUSES: WarehouseRequestStatus[] = ['pending', 'processing', 'unknown'];

@Injectable()
export class WarehouseRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findSettings() {
    return this.db.query.warehouseSettings.findFirst({ where: eq(schema.warehouseSettings.profileKey, PROFILE_KEY) });
  }

  async upsertSettings(data: Omit<NewWarehouseSettingRow, 'profileKey'>): Promise<void> {
    await this.db
      .insert(schema.warehouseSettings)
      .values({ profileKey: PROFILE_KEY, ...data })
      .onConflictDoUpdate({ target: schema.warehouseSettings.profileKey, set: data });
  }

  async updateConnectionStatus(status: WarehouseConnectionStatus, checkedAt: Date, error: string | null): Promise<void> {
    await this.db
      .update(schema.warehouseSettings)
      .set({
        lastConnectionStatus: status,
        lastConnectionCheckedAt: checkedAt,
        lastConnectionError: error,
      })
      .where(eq(schema.warehouseSettings.profileKey, PROFILE_KEY));
  }

  async createSyncRun(mediaType: WarehouseCatalogSyncMediaType, timings?: SyncTimings): Promise<WarehouseCatalogSyncRunRow> {
    const [row] = await this.db
      .insert(schema.warehouseCatalogSyncRuns)
      .values({ mediaType, status: 'running', ...(timings ? { timings } : {}) })
      .returning();

    return row;
  }

  async completeSyncRun(id: number, counts: SyncCounts, timings?: SyncTimings): Promise<void> {
    await this.db
      .update(schema.warehouseCatalogSyncRuns)
      .set({
        status: 'completed',
        finishedAt: new Date(),
        fetchedCount: counts.fetchedCount,
        savedCount: counts.savedCount,
        timings: timings ?? {},
      })
      .where(eq(schema.warehouseCatalogSyncRuns.id, id));
  }

  async updateSyncRunProgress(id: number, counts: SyncCounts, timings?: SyncTimings): Promise<void> {
    await this.db
      .update(schema.warehouseCatalogSyncRuns)
      .set({
        fetchedCount: counts.fetchedCount,
        savedCount: counts.savedCount,
        ...(timings ? { timings } : {}),
      })
      .where(eq(schema.warehouseCatalogSyncRuns.id, id));
  }

  async failSyncRun(id: number, errorMessage: string, counts?: SyncCounts, timings?: SyncTimings): Promise<void> {
    await this.db
      .update(schema.warehouseCatalogSyncRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: sanitizeSyncErrorMessage(errorMessage),
        ...(counts ? { fetchedCount: counts.fetchedCount, savedCount: counts.savedCount } : {}),
        ...(timings ? { timings } : {}),
      })
      .where(eq(schema.warehouseCatalogSyncRuns.id, id));
  }

  findLatestSyncRun(mediaType?: WarehouseCatalogSyncMediaType) {
    return this.db.query.warehouseCatalogSyncRuns.findFirst({
      where: mediaType ? eq(schema.warehouseCatalogSyncRuns.mediaType, mediaType) : undefined,
      orderBy: (t, { desc }) => [desc(t.startedAt), desc(t.id)],
    });
  }

  findRunningSyncRun() {
    return this.db.query.warehouseCatalogSyncRuns.findFirst({
      where: eq(schema.warehouseCatalogSyncRuns.status, 'running'),
      orderBy: (t, { desc }) => [desc(t.startedAt), desc(t.id)],
    });
  }

  listRunningSyncRuns() {
    return this.db.query.warehouseCatalogSyncRuns.findMany({
      where: eq(schema.warehouseCatalogSyncRuns.status, 'running'),
      orderBy: (t, { desc }) => [desc(t.startedAt), desc(t.id)],
    });
  }

  async upsertCatalogItems(items: Array<Omit<NewWarehouseCatalogItemRow, 'id' | 'createdAt' | 'updatedAt'>>): Promise<number> {
    if (items.length === 0) {
      return 0;
    }

    await this.db
      .insert(schema.warehouseCatalogItems)
      .values(items)
      .onConflictDoUpdate({
        target: [schema.warehouseCatalogItems.mediaType, schema.warehouseCatalogItems.remoteId],
        set: {
          title: sql`excluded.title`,
          subtitle: sql`excluded.subtitle`,
          sortTitle: sql`excluded.sort_title`,
          authors: sql`excluded.authors`,
          narrators: sql`excluded.narrators`,
          series: sql`excluded.series`,
          seriesIndex: sql`excluded.series_index`,
          genres: sql`excluded.genres`,
          tags: sql`excluded.tags`,
          language: sql`excluded.language`,
          publisher: sql`excluded.publisher`,
          identifiers: sql`excluded.identifiers`,
          format: sql`excluded.format`,
          durationSeconds: sql`excluded.duration_seconds`,
          hasCover: sql`excluded.has_cover`,
          upstreamCreatedAt: sql`excluded.upstream_created_at`,
          upstreamUpdatedAt: sql`excluded.upstream_updated_at`,
          rawPayload: sql`excluded.raw_payload`,
          syncedAt: sql`excluded.synced_at`,
          updatedAt: new Date(),
        },
      });

    await this.refreshCatalogItemAuthors(items);

    return items.length;
  }

  private async refreshCatalogItemAuthors(items: Array<Omit<NewWarehouseCatalogItemRow, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const authorRows = catalogItemAuthorRows(items);
    const itemKeys = items.map((item) => sql`(${item.mediaType}::warehouse_media_type, ${item.remoteId})`);

    await this.db.execute(sql`
      delete from ${schema.warehouseCatalogItemAuthors}
      where (${schema.warehouseCatalogItemAuthors.mediaType}, ${schema.warehouseCatalogItemAuthors.remoteId})
        in (${sql.join(itemKeys, sql`, `)})
    `);

    if (authorRows.length === 0) {
      return;
    }

    await this.db.insert(schema.warehouseCatalogItemAuthors).values(authorRows).onConflictDoNothing();
  }

  findCatalogItem(mediaType: WarehouseMediaType, remoteId: string) {
    return this.db.query.warehouseCatalogItems.findFirst({
      where: and(eq(schema.warehouseCatalogItems.mediaType, mediaType), eq(schema.warehouseCatalogItems.remoteId, remoteId)),
    });
  }

  async upsertCatalogDetail(data: Omit<NewWarehouseCatalogDetailRow, 'id' | 'fetchedAt'>): Promise<void> {
    await this.db
      .insert(schema.warehouseCatalogDetails)
      .values(data)
      .onConflictDoUpdate({
        target: [schema.warehouseCatalogDetails.mediaType, schema.warehouseCatalogDetails.remoteId],
        set: {
          rawPayload: sql`excluded.raw_payload`,
          fetchedAt: new Date(),
        },
      });
  }

  /**
   * Write back the facets that only the warehouse's DETAIL response carries.
   *
   * The sync stores the warehouse's list projection, and that projection has
   * no genres or narrators — so mapWarehouseAudiobookCatalogItemRow, which
   * reads both, has always mapped them to empty arrays. Every row in the
   * catalogue therefore has `genres: []` and `narrators: []`, which is why
   * genre browsing, narrator search and the genre statistics all return
   * nothing despite the indexes built for them.
   *
   * Called when a detail is fetched, so the item is corrected in place rather
   * than waiting for a full re-sync.
   */
  async updateCatalogItemFacets(
    mediaType: WarehouseMediaType,
    remoteId: string,
    facets: Pick<NewWarehouseCatalogItemRow, 'genres' | 'narrators'>,
  ): Promise<void> {
    await this.db
      .update(schema.warehouseCatalogItems)
      .set({ genres: facets.genres, narrators: facets.narrators, updatedAt: new Date() })
      .where(and(eq(schema.warehouseCatalogItems.mediaType, mediaType), eq(schema.warehouseCatalogItems.remoteId, remoteId)));
  }

  /**
   * Remote ids for one media type that have no cached detail yet.
   *
   * The backfill's resume point. There is no cursor or progress row: "has no
   * detail" IS the queue, so an interrupted run simply picks up where it
   * stopped and a finished one returns nothing.
   */
  async listRemoteIdsWithoutDetail(mediaType: WarehouseMediaType, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ remoteId: schema.warehouseCatalogItems.remoteId })
      .from(schema.warehouseCatalogItems)
      .where(
        and(
          eq(schema.warehouseCatalogItems.mediaType, mediaType),
          sql`not exists (
            select 1 from ${schema.warehouseCatalogDetails} d
            where d.media_type = ${schema.warehouseCatalogItems.mediaType}
              and d.remote_id = ${schema.warehouseCatalogItems.remoteId}
          )`,
        ),
      )
      .limit(limit);

    return rows.map((row) => row.remoteId);
  }

  /** How many items of this type carry at least one genre or narrator. The
   *  backfill's own check that it actually wrote something. */
  async countItemsWithFacets(mediaType: WarehouseMediaType): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.warehouseCatalogItems)
      .where(
        and(
          eq(schema.warehouseCatalogItems.mediaType, mediaType),
          sql`(jsonb_array_length(${schema.warehouseCatalogItems.genres}) > 0
               or jsonb_array_length(${schema.warehouseCatalogItems.narrators}) > 0)`,
        ),
      );

    return row?.total ?? 0;
  }

  /**
   * Recompute metadata_score for rows that have none.
   *
   * Called after a catalog sync, because an upsert leaves the column null for
   * new rows and stale for changed ones. Scoped to `is null` so it is cheap on
   * a normal sync and only expensive the first time.
   *
   * It reuses catalogMetadataScoreExpression rather than restating the 19
   * weighted terms: two copies of that formula would drift, and the whole
   * reason the column exists is that the formula is expensive to evaluate —
   * not that it is wrong.
   */
  async refreshMetadataScores(): Promise<number> {
    const result = await this.db.execute(sql`
      update ${schema.warehouseCatalogItems} as target
      set metadata_score = computed.score
      from (
        select ${schema.warehouseCatalogItems.id} as id, ${catalogMetadataScoreExpression()} as score
        from ${schema.warehouseCatalogItems}
        left join ${schema.warehouseCatalogDetails}
          on ${schema.warehouseCatalogDetails.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseCatalogDetails.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        where ${schema.warehouseCatalogItems.metadataScore} is null
      ) as computed
      where target.id = computed.id
    `);

    return result.rowCount ?? 0;
  }

  findCatalogDetail(mediaType: WarehouseMediaType, remoteId: string) {
    return this.db.query.warehouseCatalogDetails.findFirst({
      where: and(eq(schema.warehouseCatalogDetails.mediaType, mediaType), eq(schema.warehouseCatalogDetails.remoteId, remoteId)),
    });
  }

  async getUserCatalogState(userId: number, mediaType: WarehouseMediaType, remoteId: string): Promise<WarehouseUserCatalogStateRow> {
    const [item, state] = await Promise.all([
      this.db.query.warehouseUserItems.findFirst({ where: buildUserItemScopeWhere(userId, mediaType, remoteId) }),
      this.db.query.warehouseUserState.findFirst({ where: buildUserStateScopeWhere(userId, mediaType, remoteId) }),
    ]);

    return buildUserCatalogStateRow(mediaType, remoteId, item, state);
  }

  async upsertUserCatalogState(
    userId: number,
    mediaType: WarehouseMediaType,
    remoteId: string,
    patch: WarehouseUserStatePatch,
  ): Promise<WarehouseUserCatalogStateRow> {
    if (patch.inLibrary === true) {
      await this.db
        .insert(schema.warehouseUserItems)
        .values({ userId, mediaType, remoteId })
        .onConflictDoUpdate({
          target: [schema.warehouseUserItems.userId, schema.warehouseUserItems.mediaType, schema.warehouseUserItems.remoteId],
          set: { updatedAt: new Date() },
        });
    } else if (patch.inLibrary === false) {
      await this.db.delete(schema.warehouseUserItems).where(buildUserItemScopeWhere(userId, mediaType, remoteId));
    }

    const stateValues = normalizeWarehouseUserStatePatch(patch);

    if (Object.keys(stateValues).length > 0) {
      const setValues: NormalizedWarehouseUserStatePatch & { updatedAt: Date } = { ...stateValues, updatedAt: new Date() };
      if (patch.readStatus !== undefined && isCompletedWarehouseReadStatus(patch.readStatus)) {
        setValues.finishedAt = sql`coalesce(${schema.warehouseUserState.finishedAt}, ${stateValues.finishedAt})` as unknown as Date;
      }

      await this.db
        .insert(schema.warehouseUserState)
        .values({ userId, mediaType, remoteId, ...stateValues })
        .onConflictDoUpdate({
          target: [schema.warehouseUserState.userId, schema.warehouseUserState.mediaType, schema.warehouseUserState.remoteId],
          set: setValues,
        });
    }

    return this.getUserCatalogState(userId, mediaType, remoteId);
  }

  async findCatalogBookmarks(userId: number, mediaType: WarehouseMediaType, remoteId: string): Promise<WarehouseCatalogBookmarkRow[]> {
    return this.db
      .select()
      .from(schema.warehouseBookmarks)
      .where(
        and(
          eq(schema.warehouseBookmarks.userId, userId),
          eq(schema.warehouseBookmarks.mediaType, mediaType),
          eq(schema.warehouseBookmarks.remoteId, remoteId),
        ),
      )
      .orderBy(asc(schema.warehouseBookmarks.createdAt), asc(schema.warehouseBookmarks.id));
  }

  async findExistingCatalogBookmarkByLocation(
    userId: number,
    mediaType: WarehouseMediaType,
    remoteId: string,
    data: Pick<NewWarehouseBookmarkRow, 'cfi' | 'positionSeconds'>,
  ): Promise<WarehouseCatalogBookmarkRow | null> {
    if (data.cfi != null) {
      const [row] = await this.db
        .select()
        .from(schema.warehouseBookmarks)
        .where(
          and(
            eq(schema.warehouseBookmarks.userId, userId),
            eq(schema.warehouseBookmarks.mediaType, mediaType),
            eq(schema.warehouseBookmarks.remoteId, remoteId),
            eq(schema.warehouseBookmarks.cfi, data.cfi),
          ),
        )
        .orderBy(asc(schema.warehouseBookmarks.createdAt), asc(schema.warehouseBookmarks.id))
        .limit(1);
      return row ?? null;
    }

    if (data.positionSeconds != null) {
      const [row] = await this.db
        .select()
        .from(schema.warehouseBookmarks)
        .where(
          and(
            eq(schema.warehouseBookmarks.userId, userId),
            eq(schema.warehouseBookmarks.mediaType, mediaType),
            eq(schema.warehouseBookmarks.remoteId, remoteId),
            eq(schema.warehouseBookmarks.positionSeconds, data.positionSeconds),
            isNull(schema.warehouseBookmarks.cfi),
          ),
        )
        .orderBy(asc(schema.warehouseBookmarks.createdAt), asc(schema.warehouseBookmarks.id))
        .limit(1);
      return row ?? null;
    }

    return null;
  }

  async createCatalogBookmark(
    userId: number,
    mediaType: WarehouseMediaType,
    remoteId: string,
    data: Pick<NewWarehouseBookmarkRow, 'cfi' | 'title' | 'positionSeconds'>,
  ): Promise<WarehouseCatalogBookmarkRow | null> {
    const [row] = await this.db
      .insert(schema.warehouseBookmarks)
      .values({ userId, mediaType, remoteId, cfi: data.cfi ?? null, title: data.title, positionSeconds: data.positionSeconds ?? null })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async deleteCatalogBookmark(userId: number, mediaType: WarehouseMediaType, remoteId: string, bookmarkId: number): Promise<boolean> {
    const rows = await this.db
      .delete(schema.warehouseBookmarks)
      .where(
        and(
          eq(schema.warehouseBookmarks.id, bookmarkId),
          eq(schema.warehouseBookmarks.userId, userId),
          eq(schema.warehouseBookmarks.mediaType, mediaType),
          eq(schema.warehouseBookmarks.remoteId, remoteId),
        ),
      )
      .returning({ id: schema.warehouseBookmarks.id });
    return rows.length > 0;
  }

  async findCatalogAnnotations(userId: number, mediaType: WarehouseMediaType, remoteId: string): Promise<WarehouseCatalogAnnotationRow[]> {
    return this.db
      .select()
      .from(schema.warehouseAnnotations)
      .where(
        and(
          eq(schema.warehouseAnnotations.userId, userId),
          eq(schema.warehouseAnnotations.mediaType, mediaType),
          eq(schema.warehouseAnnotations.remoteId, remoteId),
        ),
      )
      .orderBy(asc(schema.warehouseAnnotations.createdAt), asc(schema.warehouseAnnotations.id));
  }

  async createCatalogAnnotation(
    userId: number,
    mediaType: WarehouseMediaType,
    remoteId: string,
    data: Pick<NewWarehouseAnnotationRow, 'cfi' | 'text' | 'color' | 'style' | 'note' | 'chapterTitle'>,
  ): Promise<WarehouseCatalogAnnotationRow> {
    const [row] = await this.db
      .insert(schema.warehouseAnnotations)
      .values({
        userId,
        mediaType,
        remoteId,
        cfi: data.cfi,
        text: data.text,
        color: data.color,
        style: data.style,
        note: data.note ?? null,
        chapterTitle: data.chapterTitle ?? null,
      })
      .returning();
    return row!;
  }

  async saveCatalogReadingSession(
    userId: number,
    mediaType: WarehouseMediaType,
    remoteId: string,
    sessionId: string,
    startedAt: Date,
    endedAt: Date,
    durationSeconds: number,
    progressDelta: number | null,
    endProgress: number | null,
  ): Promise<{ kind: 'saved' } | { kind: 'skipped'; reason: 'duration_below_minimum' | 'duplicate_session_id' }> {
    if (durationSeconds < MIN_READING_SESSION_SECONDS) {
      return { kind: 'skipped', reason: 'duration_below_minimum' };
    }

    const inserted = await this.db
      .insert(schema.warehouseReadingSessions)
      .values({ userId, mediaType, remoteId, sessionId, startedAt, endedAt, durationSeconds, progressDelta, endProgress })
      .onConflictDoNothing({ target: [schema.warehouseReadingSessions.userId, schema.warehouseReadingSessions.sessionId] })
      .returning({ id: schema.warehouseReadingSessions.id });

    if (inserted.length === 0) {
      return { kind: 'skipped', reason: 'duplicate_session_id' };
    }

    return { kind: 'saved' };
  }

  async updateCatalogAnnotationNote(
    userId: number,
    mediaType: WarehouseMediaType,
    remoteId: string,
    annotationId: number,
    note: string | null,
  ): Promise<WarehouseCatalogAnnotationRow | null> {
    const [row] = await this.db
      .update(schema.warehouseAnnotations)
      .set({ note, updatedAt: new Date() })
      .where(
        and(
          eq(schema.warehouseAnnotations.id, annotationId),
          eq(schema.warehouseAnnotations.userId, userId),
          eq(schema.warehouseAnnotations.mediaType, mediaType),
          eq(schema.warehouseAnnotations.remoteId, remoteId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async deleteCatalogAnnotation(userId: number, mediaType: WarehouseMediaType, remoteId: string, annotationId: number): Promise<boolean> {
    const rows = await this.db
      .delete(schema.warehouseAnnotations)
      .where(
        and(
          eq(schema.warehouseAnnotations.id, annotationId),
          eq(schema.warehouseAnnotations.userId, userId),
          eq(schema.warehouseAnnotations.mediaType, mediaType),
          eq(schema.warehouseAnnotations.remoteId, remoteId),
        ),
      )
      .returning({ id: schema.warehouseAnnotations.id });
    return rows.length > 0;
  }

  async countUserCatalogAnnotations(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<number> {
    if (mediaTypes?.length === 0) return 0;

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.warehouseAnnotations)
      .innerJoin(
        schema.warehouseUserItems,
        and(
          eq(schema.warehouseUserItems.userId, userId),
          eq(schema.warehouseUserItems.mediaType, schema.warehouseAnnotations.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseAnnotations.remoteId),
        ),
      )
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseCatalogItems.mediaType, schema.warehouseAnnotations.mediaType),
          eq(schema.warehouseCatalogItems.remoteId, schema.warehouseAnnotations.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseAnnotations.userId, userId),
          ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      );

    return row?.count ?? 0;
  }

  async getUserCatalogAnnotationByOffset(
    userId: number,
    offset: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogHighlightAnnotationRow | null> {
    if (mediaTypes?.length === 0) return null;

    const rows = await this.db
      .select({
        text: schema.warehouseAnnotations.text,
        note: schema.warehouseAnnotations.note,
        bookTitle: schema.warehouseCatalogItems.title,
        mediaType: schema.warehouseCatalogItems.mediaType,
        remoteId: schema.warehouseCatalogItems.remoteId,
        hasCover: schema.warehouseCatalogItems.hasCover,
        chapterTitle: schema.warehouseAnnotations.chapterTitle,
        createdAt: schema.warehouseAnnotations.createdAt,
      })
      .from(schema.warehouseAnnotations)
      .innerJoin(
        schema.warehouseUserItems,
        and(
          eq(schema.warehouseUserItems.userId, userId),
          eq(schema.warehouseUserItems.mediaType, schema.warehouseAnnotations.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseAnnotations.remoteId),
        ),
      )
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseCatalogItems.mediaType, schema.warehouseAnnotations.mediaType),
          eq(schema.warehouseCatalogItems.remoteId, schema.warehouseAnnotations.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseAnnotations.userId, userId),
          ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      )
      .orderBy(asc(schema.warehouseAnnotations.id))
      .limit(1)
      .offset(offset);

    return rows[0] ?? null;
  }

  async listUserCatalogItems(userId: number, mediaType: WarehouseMediaType, limit = MAX_LIMIT): Promise<WarehouseCatalogItemRow[]> {
    return this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseUserItems)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
        ),
      )
      .where(and(eq(schema.warehouseUserItems.userId, userId), eq(schema.warehouseUserItems.mediaType, mediaType)))
      .orderBy(desc(schema.warehouseUserItems.updatedAt))
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async findUserCatalogItemById(userId: number, mediaType: WarehouseMediaType, catalogItemId: number): Promise<WarehouseCatalogItemRow | null> {
    const rows = await this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseUserItems)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseUserItems.userId, userId),
          eq(schema.warehouseUserItems.mediaType, mediaType),
          eq(schema.warehouseCatalogItems.id, catalogItemId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findCatalogItemById(mediaType: WarehouseMediaType, catalogItemId: number): Promise<WarehouseCatalogItemRow | null> {
    const rows = await this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseCatalogItems)
      .where(and(eq(schema.warehouseCatalogItems.mediaType, mediaType), eq(schema.warehouseCatalogItems.id, catalogItemId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async findAccessibleCatalogItemById(
    mediaType: WarehouseMediaType,
    catalogItemId: number,
    contentFilters?: ContentFilterRules,
  ): Promise<WarehouseCatalogItemRow | null> {
    const rows = await this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseCatalogItems)
      .where(
        and(
          eq(schema.warehouseCatalogItems.mediaType, mediaType),
          eq(schema.warehouseCatalogItems.id, catalogItemId),
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async listRecentUserCatalogItems(
    userId: number,
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseUserCatalogItemRow[]> {
    if (mediaTypes?.length === 0) return [];

    return this.db
      .select({ ...getTableColumns(schema.warehouseCatalogItems), userItemUpdatedAt: schema.warehouseUserItems.updatedAt })
      .from(schema.warehouseUserItems)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseUserItems.userId, userId),
          mediaTypes ? inArray(schema.warehouseUserItems.mediaType, mediaTypes) : undefined,
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      )
      .orderBy(desc(schema.warehouseUserItems.updatedAt))
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async listRecentCatalogItems(
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseCatalogItemRow[]> {
    if (mediaTypes?.length === 0) return [];

    return this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseCatalogItems)
      .where(
        and(
          mediaTypes ? inArray(schema.warehouseCatalogItems.mediaType, mediaTypes) : undefined,
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      )
      .orderBy(sql`${schema.warehouseCatalogItems.upstreamCreatedAt} desc nulls last`, desc(schema.warehouseCatalogItems.id))
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async listCurrentlyReadingUserCatalogItems(
    userId: number,
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseCurrentlyReadingCatalogRow[]> {
    return this.db
      .select({
        ...getTableColumns(schema.warehouseCatalogItems),
        readStatus: schema.warehouseUserState.readStatus,
        progressPercent: schema.warehouseUserState.progressPercent,
        positionSeconds: schema.warehouseUserState.positionSeconds,
        lastActivityAt: schema.warehouseUserState.updatedAt,
      })
      .from(schema.warehouseUserState)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseUserState.mediaType, schema.warehouseCatalogItems.mediaType),
          eq(schema.warehouseUserState.remoteId, schema.warehouseCatalogItems.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseUserState.userId, userId),
          mediaTypes && mediaTypes.length > 0 ? inArray(schema.warehouseCatalogItems.mediaType, mediaTypes) : undefined,
          or(
            inArray(schema.warehouseUserState.readStatus, ['reading', 'rereading']),
            and(gt(schema.warehouseUserState.progressPercent, 0), lt(schema.warehouseUserState.progressPercent, 100)),
          ),
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      )
      .orderBy(desc(schema.warehouseUserState.updatedAt))
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async listUserCatalogReadingActivityDays(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<string[]> {
    if (mediaTypes?.length === 0) return [];

    const clauses: SQL[] = [
      eq(schema.warehouseUserState.userId, userId),
      ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
      or(
        inArray(schema.warehouseUserState.readStatus, ['reading', 'rereading', 'read', 'skimmed']),
        gt(schema.warehouseUserState.progressPercent, 0),
        gt(schema.warehouseUserState.positionSeconds, 0),
      )!,
      ...buildCatalogContentFilterClauses(contentFilters),
    ];

    const result = await this.db.execute(sql`
      select distinct to_char((${schema.warehouseUserState.updatedAt} at time zone 'UTC'), 'YYYY-MM-DD') as day
      from ${schema.warehouseUserState}
      inner join ${schema.warehouseUserItems}
        on ${schema.warehouseUserItems.userId} = ${schema.warehouseUserState.userId}
        and ${schema.warehouseUserItems.mediaType} = ${schema.warehouseUserState.mediaType}
        and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseUserState.remoteId}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseUserState.mediaType}
        and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseUserState.remoteId}
      where ${and(...clauses)}
      order by day desc
    `);

    return ((result as unknown as { rows?: Array<{ day?: unknown }> }).rows ?? [])
      .map((row) => (typeof row.day === 'string' ? row.day : null))
      .filter((day): day is string => day !== null);
  }

  async getUserCatalogReadingDnaData(
    userId: number,
    since: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogReadingDnaData> {
    if (mediaTypes?.length === 0) return emptyCatalogReadingDnaData();

    const lookbackDays = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (1000 * 60 * 60 * 24)));
    const clauses: SQL[] = [
      eq(schema.warehouseUserState.userId, userId),
      ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
      or(
        inArray(schema.warehouseUserState.readStatus, ['reading', 'rereading', 'read', 'skimmed']),
        gt(schema.warehouseUserState.progressPercent, 0),
        gt(schema.warehouseUserState.positionSeconds, 0),
      )!,
      ...buildCatalogContentFilterClauses(contentFilters),
    ];

    const result = await this.db.execute(sql`
      with activity_items as (
        select
          ${schema.warehouseUserState.mediaType} as media_type,
          ${schema.warehouseUserState.remoteId} as remote_id,
          ${schema.warehouseUserState.readStatus} as read_status,
          ${schema.warehouseUserState.updatedAt} as updated_at,
          ${schema.warehouseUserState.progressPercent} as progress_percent,
          ${schema.warehouseUserState.positionSeconds} as position_seconds,
          ${schema.warehouseCatalogItems.genres} as genres,
          ${schema.warehouseCatalogItems.durationSeconds} as duration_seconds,
          ${schema.warehouseCatalogItems.rawPayload} as raw_payload,
          case
            when ${schema.warehouseCatalogItems.mediaType} = 'ebook'
              and coalesce(
                ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
                ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
                ${schema.warehouseCatalogItems.rawPayload}->>'pages'
              ) ~ '^[0-9]+$'
              then coalesce(
                ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
                ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
                ${schema.warehouseCatalogItems.rawPayload}->>'pages'
              )::int
            when ${schema.warehouseCatalogItems.mediaType} = 'audiobook'
              and coalesce(${schema.warehouseCatalogItems.durationSeconds}, 0) > 0
              then round((${schema.warehouseCatalogItems.durationSeconds}::numeric / 3600) * ${AUDIOBOOK_VIRTUAL_PAGES_PER_HOUR})::int
            else 0
          end as page_count
        from ${schema.warehouseUserState}
        inner join ${schema.warehouseUserItems}
          on ${schema.warehouseUserItems.userId} = ${userId}
         and ${schema.warehouseUserItems.mediaType} = ${schema.warehouseUserState.mediaType}
         and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseUserState.remoteId}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseUserState.mediaType}
         and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseUserState.remoteId}
        where ${and(...clauses)!}
      ),
      read_items as (
        select *
        from activity_items
        where read_status = 'read'
      ),
      activity_days as (
        select distinct to_char((updated_at at time zone 'UTC'), 'YYYY-MM-DD') as day
        from activity_items
        where updated_at >= ${since}
      ),
      activity_hours as (
        select extract(hour from updated_at)::int as hour, count(*)::int as total_seconds
        from activity_items
        where updated_at >= ${since}
        group by extract(hour from updated_at)
      )
      select
        coalesce(avg(nullif(read_items.page_count, 0)), 0)::int as avg_page_count,
        (
          select count(distinct lower(nullif(trim(genre_value.name), '')))::int
          from read_items
          cross join lateral jsonb_array_elements_text(read_items.genres) as genre_value(name)
          where nullif(trim(genre_value.name), '') is not null
        ) as unique_genres,
        (
          select coalesce(
            jsonb_agg(distinct lower(nullif(trim(genre_value.name), ''))) filter (where nullif(trim(genre_value.name), '') is not null),
            '[]'::jsonb
          )
          from read_items
          cross join lateral jsonb_array_elements_text(read_items.genres) as genre_value(name)
        ) as genres_read,
        count(distinct read_items.media_type::text || ':' || read_items.remote_id)::int as total_books,
        (
          select coalesce(jsonb_agg(day order by day), '[]'::jsonb)
          from activity_days
        ) as reading_days,
        ${lookbackDays}::int as lookback_days,
        coalesce((select hour from activity_hours order by total_seconds desc limit 1), 12)::int as peak_hour,
        (
          select coalesce(
            jsonb_agg(jsonb_build_object('hour', hour, 'totalSeconds', total_seconds) order by total_seconds desc),
            '[]'::jsonb
          )
          from activity_hours
        ) as hour_buckets,
        0::real as pages_read_for_speed,
        0::real as seconds_read_for_speed
      from read_items
    `);

    return catalogReadingDnaDataRow(result);
  }

  async getUserCatalogChallengePatternData(
    userId: number,
    monthStart: Date,
    sixMonthsAgo: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogChallengePatternData> {
    if (mediaTypes?.length === 0) return emptyCatalogChallengePatternData();

    const clauses: SQL[] = [
      eq(schema.warehouseUserState.userId, userId),
      ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];

    const result = await this.db.execute(sql`
      with user_items as (
        select
          ${schema.warehouseUserState.mediaType} as media_type,
          ${schema.warehouseUserState.remoteId} as remote_id,
          ${schema.warehouseUserState.readStatus} as read_status,
          ${schema.warehouseUserState.finishedAt} as finished_at,
          ${schema.warehouseUserState.updatedAt} as updated_at,
          ${schema.warehouseCatalogItems.authors} as authors,
          ${schema.warehouseCatalogItems.genres} as genres,
          ${schema.warehouseCatalogItems.durationSeconds} as duration_seconds,
          ${schema.warehouseCatalogItems.rawPayload} as raw_payload,
          case
            when ${schema.warehouseCatalogItems.mediaType} = 'ebook'
              and coalesce(
                ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
                ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
                ${schema.warehouseCatalogItems.rawPayload}->>'pages'
              ) ~ '^[0-9]+$'
              then coalesce(
                ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
                ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
                ${schema.warehouseCatalogItems.rawPayload}->>'pages'
              )::int
            when ${schema.warehouseCatalogItems.mediaType} = 'audiobook'
              and coalesce(${schema.warehouseCatalogItems.durationSeconds}, 0) > 0
              then round((${schema.warehouseCatalogItems.durationSeconds}::numeric / 3600) * ${AUDIOBOOK_VIRTUAL_PAGES_PER_HOUR})::int
            else 0
          end as page_count
        from ${schema.warehouseUserState}
        inner join ${schema.warehouseUserItems}
          on ${schema.warehouseUserItems.userId} = ${userId}
         and ${schema.warehouseUserItems.mediaType} = ${schema.warehouseUserState.mediaType}
         and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseUserState.remoteId}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseUserState.mediaType}
         and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseUserState.remoteId}
        where ${and(...clauses)!}
      ),
      read_items as (
        select *
        from user_items
        where read_status = ${'read'}
      ),
      completed_items as (
        select *
        from user_items
        where read_status in (${'read'}, ${'skimmed'}) and finished_at is not null
      ),
      completed_last_6_months as (
        select *
        from completed_items
        where finished_at >= ${sixMonthsAgo}
      ),
      completed_this_month as (
        select *
        from completed_items
        where finished_at >= ${monthStart}
      ),
      activity_days_this_month as (
        select distinct to_char((updated_at at time zone 'UTC'), 'YYYY-MM-DD') as day
        from user_items
        where updated_at >= ${monthStart}
          and (
            read_status in (${'reading'}, ${'rereading'}, ${'read'}, ${'skimmed'})
            or coalesce(page_count, 0) > 0
          )
      ),
      author_counts as (
        select ${catalogAuthorCanonicalNameSql(sql`author_value.name`)} as author_name, count(*)::int as book_count
        from read_items
        cross join lateral jsonb_array_elements_text(read_items.authors) as author_value(name)
        where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null
        group by ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}
      )
      select
        (select coalesce(avg(nullif(page_count, 0)), 0)::int from read_items) as avg_page_count,
        (
          select count(distinct lower(nullif(trim(genre_value.name), '')))::int
          from completed_last_6_months
          cross join lateral jsonb_array_elements_text(completed_last_6_months.genres) as genre_value(name)
          where nullif(trim(genre_value.name), '') is not null
        ) as unique_genres_last_6_months,
        (
          select coalesce(
            jsonb_agg(distinct lower(nullif(trim(genre_value.name), ''))) filter (where nullif(trim(genre_value.name), '') is not null),
            '[]'::jsonb
          )
          from completed_last_6_months
          cross join lateral jsonb_array_elements_text(completed_last_6_months.genres) as genre_value(name)
        ) as genres_last_6_months,
        (
          select count(*)::int
          from user_items
          where read_status in (${'reading'}, ${'rereading'}) and updated_at < ${sixMonthsAgo}
        ) as stale_in_progress_count,
        (select coalesce(max(book_count), 0)::int from author_counts) as top_author_book_count,
        (select count(distinct media_type::text || ':' || remote_id)::int from read_items) as total_books_read,
        (select coalesce(sum(page_count), 0)::int from completed_this_month) as pages_this_month,
        (select count(*)::int from completed_this_month where page_count > 0 and page_count < 200) as short_books_completed,
        (
          select count(distinct lower(nullif(trim(genre_value.name), '')))::int
          from completed_this_month
          cross join lateral jsonb_array_elements_text(completed_this_month.genres) as genre_value(name)
          where nullif(trim(genre_value.name), '') is not null
        ) as new_genres_read,
        (
          select coalesce(
            jsonb_agg(distinct lower(nullif(trim(genre_value.name), ''))) filter (where nullif(trim(genre_value.name), '') is not null),
            '[]'::jsonb
          )
          from completed_this_month
          cross join lateral jsonb_array_elements_text(completed_this_month.genres) as genre_value(name)
        ) as genres_read_this_month,
        exists(select 1 from completed_this_month) as oldest_in_progress_finished,
        (
          select count(distinct ${catalogAuthorCanonicalNameSql(sql`author_value.name`)})::int
          from completed_this_month
          cross join lateral jsonb_array_elements_text(completed_this_month.authors) as author_value(name)
          where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null
        ) as new_authors_read,
        (
          select coalesce(
            jsonb_agg(distinct ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}) filter (where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null),
            '[]'::jsonb
          )
          from completed_this_month
          cross join lateral jsonb_array_elements_text(completed_this_month.authors) as author_value(name)
        ) as authors_read_this_month,
        (
          select coalesce(jsonb_agg(day order by day), '[]'::jsonb)
          from activity_days_this_month
        ) as reading_days_this_month
    `);

    return catalogChallengePatternDataRow(result);
  }

  async getUserCatalogNeglectedGems(
    userId: number,
    today: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<NeglectedGemsWidgetData> {
    if (mediaTypes?.length === 0) return emptyCatalogNeglectedGemsData();

    const clauses: SQL[] = [
      eq(schema.warehouseUserItems.userId, userId),
      eq(schema.warehouseUserState.userId, userId),
      ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
      gte(schema.warehouseUserState.rating, 4),
      or(isNull(schema.warehouseUserState.readStatus), sql`${schema.warehouseUserState.readStatus} not in (${'read'}, ${'skimmed'})`)!,
      ...buildCatalogContentFilterClauses(contentFilters),
    ];

    const result = await this.db.execute(sql`
      select
        ${schema.warehouseCatalogItems.id} as id,
        ${schema.warehouseCatalogItems.mediaType} as media_type,
        ${schema.warehouseCatalogItems.remoteId} as remote_id,
        ${schema.warehouseCatalogItems.title} as title,
        ${schema.warehouseCatalogItems.hasCover} as has_cover,
        ${schema.warehouseUserState.rating} as rating,
        ${schema.warehouseUserItems.addedAt} as added_at,
        genre_value.name as genre
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseUserState}
        on ${schema.warehouseUserState.userId} = ${schema.warehouseUserItems.userId}
       and ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseUserItems.remoteId}
      left join lateral (
        select nullif(trim(value), '') as name
        from jsonb_array_elements_text(${schema.warehouseCatalogItems.genres}) as genre_item(value)
        where nullif(trim(value), '') is not null
        limit 1
      ) genre_value on true
      where ${and(...clauses)!}
      order by ${schema.warehouseUserItems.addedAt} asc, ${schema.warehouseCatalogItems.id} desc
      limit 5
    `);

    return catalogNeglectedGemsRows(result, today);
  }

  async getUserCatalogLongWait(
    userId: number,
    today: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<LongWaitWidgetData | null> {
    if (mediaTypes?.length === 0) return null;

    const clauses: SQL[] = [
      eq(schema.warehouseUserItems.userId, userId),
      ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
      or(isNull(schema.warehouseUserState.readStatus), eq(schema.warehouseUserState.readStatus, 'unread'))!,
      or(isNull(schema.warehouseUserState.progressPercent), lte(schema.warehouseUserState.progressPercent, 0))!,
      or(isNull(schema.warehouseUserState.positionSeconds), lte(schema.warehouseUserState.positionSeconds, 0))!,
      ...buildCatalogContentFilterClauses(contentFilters),
    ];

    const result = await this.db.execute(sql`
      select
        ${schema.warehouseCatalogItems.id} as id,
        ${schema.warehouseCatalogItems.mediaType} as media_type,
        ${schema.warehouseCatalogItems.remoteId} as remote_id,
        ${schema.warehouseCatalogItems.title} as title,
        ${schema.warehouseCatalogItems.hasCover} as has_cover,
        ${schema.warehouseUserItems.addedAt} as added_at,
        case
          when ${schema.warehouseCatalogItems.mediaType} = 'ebook'
            and coalesce(
              ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
              ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
              ${schema.warehouseCatalogItems.rawPayload}->>'pages'
            ) ~ '^[0-9]+$'
            then coalesce(
              ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
              ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
              ${schema.warehouseCatalogItems.rawPayload}->>'pages'
            )::int
          else null
        end as page_count,
        genre_value.name as genre,
        ${schema.warehouseCatalogItems.format} as format,
        ${schema.warehouseUserState.readStatus} as read_status,
        ${schema.warehouseUserState.progressPercent} as progress_percent,
        ${schema.warehouseUserState.positionSeconds} as position_seconds
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseUserItems.remoteId}
      left join ${schema.warehouseUserState}
        on ${schema.warehouseUserState.userId} = ${schema.warehouseUserItems.userId}
       and ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
      left join lateral (
        select nullif(trim(value), '') as name
        from jsonb_array_elements_text(${schema.warehouseCatalogItems.genres}) as genre_item(value)
        where nullif(trim(value), '') is not null
        limit 1
      ) genre_value on true
      where ${and(...clauses)!}
      order by ${schema.warehouseUserItems.addedAt} asc, ${schema.warehouseCatalogItems.id} desc
      limit 1
    `);

    return catalogLongWaitRow(result, today);
  }

  async countCompletedUserCatalogItemsThisYear(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<number> {
    if (mediaTypes?.length === 0) return 0;

    const result = await this.db.execute(sql`
      select count(distinct (${schema.warehouseUserState.mediaType}::text || ':' || ${schema.warehouseUserState.remoteId}))::int as count
      from ${schema.warehouseUserState}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserState.mediaType} = ${schema.warehouseCatalogItems.mediaType}
        and ${schema.warehouseUserState.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      inner join ${schema.warehouseUserItems}
        on ${schema.warehouseUserItems.userId} = ${userId}
        and ${schema.warehouseUserItems.mediaType} = ${schema.warehouseUserState.mediaType}
        and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseUserState.remoteId}
      where ${and(
        eq(schema.warehouseUserState.userId, userId),
        ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
        inArray(schema.warehouseUserState.readStatus, ['read', 'skimmed']),
        isNotNull(schema.warehouseUserState.finishedAt),
        gte(schema.warehouseUserState.finishedAt, sql`date_trunc('year', current_date)`),
        ...buildCatalogContentFilterClauses(contentFilters),
      )}
    `);
    const [row] = (result as unknown as { rows?: Array<{ count?: unknown }> }).rows ?? [];
    return Number(row?.count ?? 0);
  }

  async getUserCatalogYearProjectionData(
    userId: number,
    yearStart: Date,
    thirtyDaysAgo: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogYearProjectionData> {
    if (mediaTypes?.length === 0) return emptyCatalogYearProjectionData();

    const clauses: SQL[] = [
      eq(schema.warehouseUserState.userId, userId),
      inArray(schema.warehouseUserState.readStatus, ['read', 'skimmed']),
      isNotNull(schema.warehouseUserState.finishedAt),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      with completed_items as (
        select
          ${schema.warehouseUserState.mediaType} as media_type,
          ${schema.warehouseUserState.remoteId} as remote_id,
          ${schema.warehouseUserState.finishedAt} as finished_at,
          ${schema.warehouseCatalogItems.durationSeconds} as duration_seconds,
          ${schema.warehouseCatalogItems.rawPayload} as raw_payload,
          case
            when ${schema.warehouseCatalogItems.mediaType} = 'ebook'
              and coalesce(
                ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
                ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
                ${schema.warehouseCatalogItems.rawPayload}->>'pages'
              ) ~ '^[0-9]+$'
              then coalesce(
                ${schema.warehouseCatalogItems.rawPayload}->>'pageCount',
                ${schema.warehouseCatalogItems.rawPayload}->>'page_count',
                ${schema.warehouseCatalogItems.rawPayload}->>'pages'
              )::int
            else 0
          end as page_count
        from ${schema.warehouseUserState}
        inner join ${schema.warehouseUserItems}
          on ${schema.warehouseUserItems.userId} = ${userId}
         and ${schema.warehouseUserItems.mediaType} = ${schema.warehouseUserState.mediaType}
         and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseUserState.remoteId}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseUserState.mediaType}
         and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseUserState.remoteId}
        where ${and(...clauses)!}
      )
      select
        count(distinct case when finished_at >= ${yearStart} then media_type::text || ':' || remote_id end)::int as books_completed_ytd,
        coalesce(sum(case when finished_at >= ${thirtyDaysAgo} then page_count else 0 end), 0)::int as pages_read_last_30_days,
        coalesce(sum(case when finished_at >= ${thirtyDaysAgo} and media_type = 'audiobook' then coalesce(duration_seconds, 0) else 0 end), 0)::real / 3600 as hours_read_last_30_days,
        count(distinct case when finished_at >= ${thirtyDaysAgo} then media_type::text || ':' || remote_id end)::int as books_completed_last_30_days
      from completed_items
    `);

    return catalogYearProjectionDataRow(result);
  }

  async listRandomUserCatalogItems(
    userId: number,
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
    options: { onlyUnstarted?: boolean } = {},
  ): Promise<WarehouseCatalogItemRow[]> {
    if (mediaTypes?.length === 0) return [];

    const query = this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseUserItems)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
        ),
      );
    const scopedQuery = options.onlyUnstarted
      ? query.leftJoin(
          schema.warehouseUserState,
          and(
            eq(schema.warehouseUserState.userId, userId),
            eq(schema.warehouseUserState.mediaType, schema.warehouseUserItems.mediaType),
            eq(schema.warehouseUserState.remoteId, schema.warehouseUserItems.remoteId),
          ),
        )
      : query;

    return scopedQuery
      .where(
        and(
          eq(schema.warehouseUserItems.userId, userId),
          ...(options.onlyUnstarted ? [buildRandomCatalogCandidateWhere()] : []),
          ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      )
      .orderBy(sql`random()`)
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async listRandomCatalogItems(
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseCatalogItemRow[]> {
    if (mediaTypes?.length === 0) return [];

    return this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseCatalogItems)
      .where(
        and(
          mediaTypes ? inArray(schema.warehouseCatalogItems.mediaType, mediaTypes) : undefined,
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      )
      .orderBy(sql`random()`)
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async countRandomUserCatalogItems(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<number> {
    if (mediaTypes?.length === 0) return 0;

    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.warehouseUserItems)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
        ),
      )
      .leftJoin(
        schema.warehouseUserState,
        and(
          eq(schema.warehouseUserState.userId, userId),
          eq(schema.warehouseUserState.mediaType, schema.warehouseUserItems.mediaType),
          eq(schema.warehouseUserState.remoteId, schema.warehouseUserItems.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseUserItems.userId, userId),
          buildRandomCatalogCandidateWhere(),
          ...(mediaTypes ? [inArray(schema.warehouseUserItems.mediaType, mediaTypes)] : []),
          ...buildCatalogContentFilterClauses(contentFilters),
        ),
      );

    return Number(row?.total ?? 0);
  }

  async listUpNextInSeriesUserCatalogItems(
    userId: number,
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseUpNextInSeriesCatalogRow[]> {
    if (mediaTypes?.length === 0) return [];

    const cfClauses = buildCatalogContentFilterClauses(contentFilters);
    const filterSql = cfClauses.length > 0 ? sql`and ${sql.join(cfClauses, sql` and `)}` : sql``;
    const mediaTypeSql =
      mediaTypes && mediaTypes.length > 0
        ? sql`and ${schema.warehouseUserItems.mediaType} in (${sql.join(
            mediaTypes.map((mediaType) => sql`${mediaType}`),
            sql`, `,
          )})`
        : sql``;
    const clampedLimit = clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT);

    const rows = await this.db.execute<WarehouseUpNextInSeriesCatalogRow>(sql`
      with scoped_series_items as (
        select
          ${schema.warehouseCatalogItems.id} as id,
          ${schema.warehouseCatalogItems.mediaType} as "mediaType",
          ${schema.warehouseCatalogItems.remoteId} as "remoteId",
          ${schema.warehouseCatalogItems.title} as title,
          ${schema.warehouseCatalogItems.subtitle} as subtitle,
          ${schema.warehouseCatalogItems.sortTitle} as "sortTitle",
          ${schema.warehouseCatalogItems.authors} as authors,
          ${schema.warehouseCatalogItems.narrators} as narrators,
          ${schema.warehouseCatalogItems.series} as series,
          ${schema.warehouseCatalogItems.seriesIndex} as "seriesIndex",
          ${schema.warehouseCatalogItems.genres} as genres,
          ${schema.warehouseCatalogItems.tags} as tags,
          ${schema.warehouseCatalogItems.language} as language,
          ${schema.warehouseCatalogItems.publisher} as publisher,
          ${schema.warehouseCatalogItems.identifiers} as identifiers,
          ${schema.warehouseCatalogItems.format} as format,
          ${schema.warehouseCatalogItems.durationSeconds} as "durationSeconds",
          ${schema.warehouseCatalogItems.hasCover} as "hasCover",
          ${schema.warehouseCatalogItems.upstreamCreatedAt} as "upstreamCreatedAt",
          ${schema.warehouseCatalogItems.upstreamUpdatedAt} as "upstreamUpdatedAt",
          ${schema.warehouseCatalogItems.rawPayload} as "rawPayload",
          ${schema.warehouseCatalogItems.syncedAt} as "syncedAt",
          ${schema.warehouseCatalogItems.createdAt} as "createdAt",
          ${schema.warehouseCatalogItems.updatedAt} as "updatedAt",
          lower(btrim(${schema.warehouseCatalogItems.series})) as normalized_series_name,
          coalesce(${schema.warehouseUserState.progressPercent}, 0) as current_progress,
          case
            when ${schema.warehouseUserState.readStatus} in ('read', 'skimmed') or coalesce(${schema.warehouseUserState.progressPercent}, 0) >= 100
              then true
            else false
          end as is_completed,
          case
            when ${schema.warehouseUserState.readStatus} in ('read', 'skimmed') or coalesce(${schema.warehouseUserState.progressPercent}, 0) >= 100
              then greatest(
                coalesce(${schema.warehouseUserState.finishedAt}, to_timestamp(0)),
                coalesce(${schema.warehouseUserState.updatedAt}, to_timestamp(0))
              )
            else null
          end as completion_updated_at
        from ${schema.warehouseUserItems}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
          and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        left join ${schema.warehouseUserState}
          on ${schema.warehouseUserState.userId} = ${userId}
          and ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
          and ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
        where ${schema.warehouseUserItems.userId} = ${userId}
          ${mediaTypeSql}
          and ${schema.warehouseCatalogItems.series} is not null
          and btrim(${schema.warehouseCatalogItems.series}) != ''
          and ${schema.warehouseCatalogItems.seriesIndex} is not null
          ${filterSql}
      ),
      ordered_series as (
        select
          ssi.*,
          lag(ssi.is_completed) over (
            partition by ssi."mediaType", ssi.normalized_series_name
            order by ssi."seriesIndex" asc, ssi."createdAt" asc, ssi.id asc
          ) as previous_is_completed,
          lag(ssi.completion_updated_at) over (
            partition by ssi."mediaType", ssi.normalized_series_name
            order by ssi."seriesIndex" asc, ssi."createdAt" asc, ssi.id asc
          ) as previous_completion_updated_at
        from scoped_series_items ssi
      ),
      next_candidates as (
        select distinct on (os."mediaType", os.normalized_series_name)
          os.*
        from ordered_series os
        where os.previous_is_completed = true
          and os.is_completed = false
          and os.current_progress = 0
        order by os."mediaType", os.normalized_series_name, os."seriesIndex" asc, os."createdAt" asc, os.id asc
      )
      select
        nc.id,
        nc."mediaType",
        nc."remoteId",
        nc.title,
        nc.subtitle,
        nc."sortTitle",
        nc.authors,
        nc.narrators,
        nc.series,
        nc."seriesIndex",
        nc.genres,
        nc.tags,
        nc.language,
        nc.publisher,
        nc.identifiers,
        nc.format,
        nc."durationSeconds",
        nc."hasCover",
        nc."upstreamCreatedAt",
        nc."upstreamUpdatedAt",
        nc."rawPayload",
        nc."syncedAt",
        nc."createdAt",
        nc."updatedAt",
        nc.previous_completion_updated_at as "previousCompletionUpdatedAt"
      from next_candidates nc
      order by nc.previous_completion_updated_at desc nulls last, nc.id desc
      limit ${clampedLimit}
    `);

    return rows.rows;
  }

  async searchUserCatalogItems(
    userId: number,
    q: string,
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseCatalogItemRow[]> {
    if (mediaTypes?.length === 0) return [];

    const term = q.trim();
    if (term.length === 0) {
      return [];
    }

    const contentFilterClauses = buildCatalogContentFilterClauses(contentFilters);

    return this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseUserItems)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
          eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseUserItems.userId, userId),
          mediaTypes ? inArray(schema.warehouseUserItems.mediaType, mediaTypes) : undefined,
          buildCatalogSearchWhere(term),
          ...contentFilterClauses,
        ),
      )
      .orderBy(asc(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`))
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async searchCatalogItems(
    q: string,
    limit = MAX_LIMIT,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseCatalogItemRow[]> {
    const term = q.trim();
    if (term.length === 0 || mediaTypes?.length === 0) {
      return [];
    }

    const contentFilterClauses = buildCatalogContentFilterClauses(contentFilters);

    return this.db
      .select(getTableColumns(schema.warehouseCatalogItems))
      .from(schema.warehouseCatalogItems)
      .where(
        and(
          mediaTypes ? inArray(schema.warehouseCatalogItems.mediaType, mediaTypes) : undefined,
          buildCatalogSearchWhere(term),
          ...contentFilterClauses,
        ),
      )
      .orderBy(asc(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`))
      .limit(clampNumber(limit, MAX_LIMIT, 1, MAX_LIMIT));
  }

  async queryUserCatalogItems(userId: number, query: UserCatalogItemsQuery): Promise<CatalogPage> {
    const page = clampNumber(query.page, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampNumber(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const smartScopeWhere = query.filter ? buildCatalogSmartScopeWhere(query.filter, userId) : undefined;
    const includeAllCatalogItems = query.includeAllCatalogItems === true;
    const mediaTypes = query.mediaTypes?.length ? query.mediaTypes : undefined;

    if (smartScopeWhere === null || query.mediaTypes?.length === 0) {
      return { rows: [], total: 0, page, limit };
    }

    const q = query.q?.trim();
    const contentFilterClauses = buildCatalogContentFilterClauses(query.contentFilters);
    const where = and(
      includeAllCatalogItems ? undefined : eq(schema.warehouseUserItems.userId, userId),
      query.mediaType ? eq(schema.warehouseCatalogItems.mediaType, query.mediaType) : undefined,
      mediaTypes ? inArray(schema.warehouseCatalogItems.mediaType, mediaTypes) : undefined,
      smartScopeWhere,
      q ? buildCatalogSearchWhere(q) : undefined,
      ...contentFilterClauses,
    );
    const orderBy = buildCatalogUserItemsOrder(query.sort);

    const selectFields = {
      ...getTableColumns(schema.warehouseCatalogItems),
      userAddedAt: schema.warehouseUserItems.addedAt,
      rating: schema.warehouseUserState.rating,
      readingProgress: schema.warehouseUserState.progressPercent,
      readStatus: schema.warehouseUserState.readStatus,
      publishedYear: catalogPublishedYearExpression(),
      pageCount: catalogPageCountExpression(),
      fileSizeBytes: catalogFileSizeExpression(),
      metadataScore: catalogMetadataScoreExpression(),
      lastReadAt: schema.warehouseUserState.updatedAt,
      finishedAt: schema.warehouseUserState.finishedAt,
    };

    const rowsQuery = includeAllCatalogItems
      ? this.db
          .select(selectFields)
          .from(schema.warehouseCatalogItems)
          .leftJoin(schema.warehouseUserItems, buildUserCatalogJoin(userId))
          .leftJoin(
            schema.warehouseUserState,
            and(
              eq(schema.warehouseUserState.userId, userId),
              eq(schema.warehouseUserState.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseUserState.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .leftJoin(
            schema.warehouseCatalogDetails,
            and(
              eq(schema.warehouseCatalogDetails.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseCatalogDetails.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(page * limit)
      : this.db
          .select(selectFields)
          .from(schema.warehouseUserItems)
          .innerJoin(
            schema.warehouseCatalogItems,
            and(
              eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .leftJoin(
            schema.warehouseUserState,
            and(
              eq(schema.warehouseUserState.userId, schema.warehouseUserItems.userId),
              eq(schema.warehouseUserState.mediaType, schema.warehouseUserItems.mediaType),
              eq(schema.warehouseUserState.remoteId, schema.warehouseUserItems.remoteId),
            ),
          )
          .leftJoin(
            schema.warehouseCatalogDetails,
            and(
              eq(schema.warehouseCatalogDetails.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseCatalogDetails.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(page * limit);

    const totalQuery = includeAllCatalogItems
      ? this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(schema.warehouseCatalogItems)
          .leftJoin(
            schema.warehouseUserState,
            and(
              eq(schema.warehouseUserState.userId, userId),
              eq(schema.warehouseUserState.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseUserState.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .leftJoin(
            schema.warehouseCatalogDetails,
            and(
              eq(schema.warehouseCatalogDetails.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseCatalogDetails.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .where(where)
      : this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(schema.warehouseUserItems)
          .innerJoin(
            schema.warehouseCatalogItems,
            and(
              eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .leftJoin(
            schema.warehouseUserState,
            and(
              eq(schema.warehouseUserState.userId, schema.warehouseUserItems.userId),
              eq(schema.warehouseUserState.mediaType, schema.warehouseUserItems.mediaType),
              eq(schema.warehouseUserState.remoteId, schema.warehouseUserItems.remoteId),
            ),
          )
          .leftJoin(
            schema.warehouseCatalogDetails,
            and(
              eq(schema.warehouseCatalogDetails.mediaType, schema.warehouseCatalogItems.mediaType),
              eq(schema.warehouseCatalogDetails.remoteId, schema.warehouseCatalogItems.remoteId),
            ),
          )
          .where(where);

    // Independent of each other, so the page and its count go to the database together.
    const [rows, totalRows] = await Promise.all([rowsQuery, totalQuery]);

    return {
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    };
  }

  async queryUserCatalogJumpBuckets(userId: number, query: UserCatalogItemsQuery): Promise<JumpBucketsResponse> {
    const smartScopeWhere = query.filter ? buildCatalogSmartScopeWhere(query.filter, userId) : undefined;
    const includeAllCatalogItems = query.includeAllCatalogItems === true;
    const mediaTypes = query.mediaTypes?.length ? query.mediaTypes : undefined;

    const kind = jumpBucketKindForSort(query.sort ?? []) ?? 'letter';

    if (smartScopeWhere === null || query.mediaTypes?.length === 0) {
      return { buckets: [], total: 0, kind, granularity: null };
    }

    const q = query.q?.trim();
    const contentFilterClauses = buildCatalogContentFilterClauses(query.contentFilters);
    const where = and(
      includeAllCatalogItems ? undefined : eq(schema.warehouseUserItems.userId, userId),
      query.mediaType ? eq(schema.warehouseCatalogItems.mediaType, query.mediaType) : undefined,
      mediaTypes ? inArray(schema.warehouseCatalogItems.mediaType, mediaTypes) : undefined,
      smartScopeWhere,
      q ? buildCatalogSearchWhere(q) : undefined,
      ...contentFilterClauses,
    );
    const orderBy = buildCatalogUserItemsOrder(query.sort);
    const primaryField = (query.sort?.[0] ?? { field: 'title' as const }).field;
    const bucketExpr = buildCatalogJumpBucketExpr(primaryField);

    if (!bucketExpr) return { buckets: [], total: 0, kind, granularity: null };

    const result = includeAllCatalogItems
      ? await this.db.execute<JumpBucketRawRow>(sql`
          WITH ordered AS (
            SELECT
              ${bucketExpr} AS bucket,
              (ROW_NUMBER() OVER (ORDER BY ${orderBy}) - 1) AS item_index
            FROM ${schema.warehouseCatalogItems}
            LEFT JOIN ${schema.warehouseUserItems} ON ${buildUserCatalogJoin(userId)}
            LEFT JOIN ${schema.warehouseUserState} ON ${buildCatalogUserStateJoin(userId)}
            LEFT JOIN ${schema.warehouseCatalogDetails}
              ON ${schema.warehouseCatalogDetails.mediaType} = ${schema.warehouseCatalogItems.mediaType}
              AND ${schema.warehouseCatalogDetails.remoteId} = ${schema.warehouseCatalogItems.remoteId}
            WHERE ${where}
          )
          SELECT bucket, min(item_index)::int AS item_index, (SELECT count(*) FROM ordered)::int AS total
          FROM ordered
          WHERE bucket IS NOT NULL
          GROUP BY bucket
          ORDER BY min(item_index)
        `)
      : await this.db.execute<JumpBucketRawRow>(sql`
          WITH ordered AS (
            SELECT
              ${bucketExpr} AS bucket,
              (ROW_NUMBER() OVER (ORDER BY ${orderBy}) - 1) AS item_index
            FROM ${schema.warehouseUserItems}
            INNER JOIN ${schema.warehouseCatalogItems}
              ON ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
              AND ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
            LEFT JOIN ${schema.warehouseUserState}
              ON ${schema.warehouseUserState.userId} = ${schema.warehouseUserItems.userId}
              AND ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
              AND ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
            LEFT JOIN ${schema.warehouseCatalogDetails}
              ON ${schema.warehouseCatalogDetails.mediaType} = ${schema.warehouseCatalogItems.mediaType}
              AND ${schema.warehouseCatalogDetails.remoteId} = ${schema.warehouseCatalogItems.remoteId}
            WHERE ${where}
          )
          SELECT bucket, min(item_index)::int AS item_index, (SELECT count(*) FROM ordered)::int AS total
          FROM ordered
          WHERE bucket IS NOT NULL
          GROUP BY bucket
          ORDER BY min(item_index)
        `);

    return mapCatalogJumpBucketRows(result.rows, kind);
  }

  async createRequestMirror(data: RequestMirrorCreate): Promise<WarehouseRequestRow> {
    const [row] = await this.db.insert(schema.warehouseRequests).values(normalizeRequestMirrorInsert(data)).returning();

    return row;
  }

  async upsertRequestMirror(data: RequestMirrorUpsert): Promise<WarehouseRequestRow | undefined> {
    const mediaType = data.mediaType ?? 'ebook';
    const scope = { userId: data.userId, mediaType };

    if (data.upstreamRequestId) {
      const existing = await this.findRequestByUpstreamId(data.upstreamRequestId, scope);

      if (existing) {
        return this.updateRequestMirror(existing.id, scope, data);
      }
    }

    if (data.id) {
      return this.updateRequestMirror(data.id, scope, data);
    }

    return this.createRequestMirror(data);
  }

  async listRequestsForUser(userId: number, query: WarehouseRequestListQuery): Promise<RequestPage> {
    const { page, limit } = clampPageLimit(query.page, query.limit);
    const where = buildRequestWhere(userId, query);

    const rows = await this.db
      .select()
      .from(schema.warehouseRequests)
      .where(where)
      .orderBy(desc(schema.warehouseRequests.createdAt), desc(schema.warehouseRequests.id))
      .limit(limit)
      .offset((page - 1) * limit);

    const totalRows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.warehouseRequests)
      .where(where);

    return {
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    };
  }

  async listRequestMirrorsForSync(query: RequestSyncCandidateQuery): Promise<WarehouseRequestRow[]> {
    const { limit } = clampPageLimit(undefined, query.limit);

    return this.db
      .select()
      .from(schema.warehouseRequests)
      .where(buildRequestSyncCandidateWhere(query))
      .orderBy(sql`${schema.warehouseRequests.lastStatusSyncedAt} asc nulls first`, asc(schema.warehouseRequests.id))
      .limit(limit);
  }

  findRequestForUser(id: number, userId: number) {
    return this.db.query.warehouseRequests.findFirst({
      where: and(eq(schema.warehouseRequests.id, id), eq(schema.warehouseRequests.userId, userId)),
    });
  }

  findRequestByUpstreamId(upstreamRequestId: string, scope: RequestMirrorScope) {
    return this.db.query.warehouseRequests.findFirst({
      where: and(
        eq(schema.warehouseRequests.upstreamRequestId, upstreamRequestId),
        eq(schema.warehouseRequests.userId, scope.userId),
        eq(schema.warehouseRequests.mediaType, scope.mediaType ?? 'ebook'),
      ),
    });
  }

  async updateRequestMirror(id: number, scope: RequestMirrorScope, data: RequestMirrorUpdate): Promise<WarehouseRequestRow | undefined> {
    const [row] = await this.db
      .update(schema.warehouseRequests)
      .set(normalizeRequestMirrorUpdate(data))
      .where(
        and(
          eq(schema.warehouseRequests.id, id),
          eq(schema.warehouseRequests.userId, scope.userId),
          eq(schema.warehouseRequests.mediaType, scope.mediaType ?? 'ebook'),
        ),
      )
      .returning();

    return row;
  }

  async updateOpenRequestMirror(id: number, scope: RequestMirrorScope, data: RequestMirrorUpdate): Promise<WarehouseRequestRow | undefined> {
    const [row] = await this.db
      .update(schema.warehouseRequests)
      .set(normalizeRequestMirrorUpdate(data))
      .where(
        and(
          eq(schema.warehouseRequests.id, id),
          eq(schema.warehouseRequests.userId, scope.userId),
          eq(schema.warehouseRequests.mediaType, scope.mediaType ?? 'ebook'),
          inArray(schema.warehouseRequests.status, REQUEST_SYNC_CANDIDATE_STATUSES),
        ),
      )
      .returning();

    return row;
  }

  async deleteRequestMirror(id: number, userId: number): Promise<WarehouseRequestRow | undefined> {
    const [row] = await this.db
      .update(schema.warehouseRequests)
      .set({ status: 'cancelled' })
      .where(and(eq(schema.warehouseRequests.id, id), eq(schema.warehouseRequests.userId, userId)))
      .returning();

    return row;
  }

  async listEbookCatalog(query: WarehouseEbookCatalogQuery): Promise<CatalogListPage> {
    const { page, limit } = clampPageLimit(query.page, query.limit);
    const where = buildEbookCatalogWhere(query);
    const orderBy = buildEbookCatalogOrder(query.sort, query.order);

    // The page and its count are independent, so they run together rather than in series.
    const [rows, totalRows] = await Promise.all([
      this.db
        .select(catalogListColumns)
        .from(schema.warehouseCatalogItems)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.warehouseCatalogItems)
        .where(where),
    ]);

    return {
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    };
  }

  async listComicCatalog(query: WarehouseComicCatalogQuery): Promise<CatalogListPage> {
    const { page, limit } = clampPageLimit(query.page, query.limit);
    const where = buildComicCatalogWhere(query);
    const orderBy = buildEbookCatalogOrder(query.sort, query.order);

    // The page and its count are independent, so they run together rather than in series.
    const [rows, totalRows] = await Promise.all([
      this.db
        .select(catalogListColumns)
        .from(schema.warehouseCatalogItems)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.warehouseCatalogItems)
        .where(where),
    ]);

    return {
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    };
  }

  async listAudiobookCatalog(query: WarehouseAudiobookCatalogQuery): Promise<CatalogListPage> {
    const { page, limit } = clampPageLimit(query.page, query.limit);
    const where = buildAudiobookCatalogWhere(query);
    const orderBy = buildAudiobookCatalogOrder(query.sort, query.order);

    // The page and its count are independent, so they run together rather than in series.
    const [rows, totalRows] = await Promise.all([
      this.db
        .select(catalogListColumns)
        .from(schema.warehouseCatalogItems)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.warehouseCatalogItems)
        .where(where),
    ]);

    return {
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    };
  }

  async listAudiobookCatalogDimensions(
    kind: Extract<WarehouseCatalogDimensionKind, 'author' | 'narrator' | 'series' | 'genre'>,
  ): Promise<CatalogDimensionRow[]> {
    const field = catalogDimensionField(kind);
    const result = await this.db.execute(sql`
      select value.name, count(*)::int as item_count
      from ${schema.warehouseCatalogItems}
      cross join lateral ${field} as value(name)
      where ${schema.warehouseCatalogItems.mediaType} = ${'audiobook'}
        and nullif(trim(value.name), '') is not null
      group by value.name
      order by lower(value.name) asc
      limit 100
    `);

    return ((result as unknown as { rows?: Array<{ name?: unknown; item_count?: unknown }> }).rows ?? [])
      .map((row) => ({
        name: typeof row.name === 'string' ? row.name.trim() : '',
        itemCount: typeof row.item_count === 'number' ? row.item_count : Number(row.item_count ?? 0),
      }))
      .filter((row) => row.name.length > 0);
  }

  async listEbookCatalogDimensions(kind: Extract<WarehouseCatalogDimensionKind, 'genre'>): Promise<CatalogDimensionRow[]> {
    const field = catalogDimensionField(kind);
    const result = await this.db.execute(sql`
      select value.name, count(*)::int as item_count
      from ${schema.warehouseCatalogItems}
      cross join lateral ${field} as value(name)
      where ${schema.warehouseCatalogItems.mediaType} = ${'ebook'}
        and nullif(trim(value.name), '') is not null
      group by value.name
      order by lower(value.name) asc
      limit 100
    `);

    return dimensionRows(result);
  }

  async getCatalogLibraryOverview(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<LibraryOverviewWidgetData> {
    if (mediaTypes?.length === 0) {
      return emptyLibraryOverview();
    }

    const clauses = buildCatalogContentFilterClauses(contentFilters);
    if (mediaTypes) {
      clauses.unshift(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));
    }
    const where = clauses.length > 0 ? and(...clauses)! : sql`true`;
    const result = await this.db.execute(sql`
      select
        count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as total_books,
        count(distinct ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}) filter (where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null)::int as total_authors,
        count(distinct lower(nullif(trim(${schema.warehouseCatalogItems.series}), ''))) filter (where nullif(trim(${schema.warehouseCatalogItems.series}), '') is not null)::int as total_series,
        count(
          distinct case
            when coalesce(${schema.warehouseCatalogItems.upstreamCreatedAt}, ${schema.warehouseCatalogItems.createdAt}) >= date_trunc('year', current_date)
            then (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId})
          end
        )::int as books_added_this_year
      from ${schema.warehouseCatalogItems}
      left join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.authors}) as author_value(name) on true
      where ${where}
    `);
    const row = catalogLibraryOverviewRow(result);

    return {
      totalBooks: Number(row.total_books ?? 0),
      totalAuthors: Number(row.total_authors ?? 0),
      totalSeries: Number(row.total_series ?? 0),
      totalStorageBytes: 0,
      booksAddedThisYear: Number(row.books_added_this_year ?? 0),
    };
  }

  async getUserCatalogLibraryOverview(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<LibraryOverviewWidgetData> {
    if (mediaTypes?.length === 0) {
      return emptyLibraryOverview();
    }

    const clauses: SQL[] = [eq(schema.warehouseUserItems.userId, userId), ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) {
      clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));
    }

    const result = await this.db.execute(sql`
      select
        count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as total_books,
        count(distinct ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}) filter (where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null)::int as total_authors,
        count(distinct lower(nullif(trim(${schema.warehouseCatalogItems.series}), ''))) filter (where nullif(trim(${schema.warehouseCatalogItems.series}), '') is not null)::int as total_series,
        count(
          distinct case
            when ${schema.warehouseUserItems.addedAt} >= date_trunc('year', current_date)
            then (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId})
          end
        )::int as books_added_this_year
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      left join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.authors}) as author_value(name) on true
      where ${and(...clauses)!}
    `);
    const row = catalogLibraryOverviewRow(result);

    return {
      totalBooks: Number(row.total_books ?? 0),
      totalAuthors: Number(row.total_authors ?? 0),
      totalSeries: Number(row.total_series ?? 0),
      totalStorageBytes: 0,
      booksAddedThisYear: Number(row.books_added_this_year ?? 0),
    };
  }

  async getUserCatalogStatisticsSummary(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<StatisticsSummary> {
    if (mediaTypes?.length === 0) {
      return emptyStatisticsSummary();
    }

    const clauses: SQL[] = [eq(schema.warehouseUserItems.userId, userId), ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) {
      clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));
    }

    const result = await this.db.execute(sql`
      select
        count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as total_books,
        count(distinct ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}) filter (where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null)::int as total_authors,
        count(distinct lower(nullif(trim(${schema.warehouseCatalogItems.series}), ''))) filter (where nullif(trim(${schema.warehouseCatalogItems.series}), '') is not null)::int as total_series,
        count(distinct lower(nullif(trim(${schema.warehouseCatalogItems.publisher}), ''))) filter (where nullif(trim(${schema.warehouseCatalogItems.publisher}), '') is not null)::int as total_publishers,
        count(distinct lower(nullif(trim(genre_value.name), ''))) filter (where nullif(trim(genre_value.name), '') is not null)::int as total_genres,
        count(distinct lower(nullif(trim(${schema.warehouseCatalogItems.language}), ''))) filter (where nullif(trim(${schema.warehouseCatalogItems.language}), '') is not null)::int as total_languages,
        count(
          distinct case
            when ${schema.warehouseUserItems.addedAt} >= date_trunc('year', current_date)
            then (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId})
          end
        )::int as books_added_this_year
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      left join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.authors}) as author_value(name) on true
      left join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.genres}) as genre_value(name) on true
      where ${and(...clauses)!}
    `);
    const row = catalogStatisticsSummaryRow(result);

    return {
      totalBooks: Number(row.total_books ?? 0),
      totalAuthors: Number(row.total_authors ?? 0),
      totalSeries: Number(row.total_series ?? 0),
      totalPublishers: Number(row.total_publishers ?? 0),
      totalStorageBytes: 0,
      totalGenres: Number(row.total_genres ?? 0),
      totalLanguages: Number(row.total_languages ?? 0),
      publicationYearMin: null,
      publicationYearMax: null,
      booksAddedThisYear: Number(row.books_added_this_year ?? 0),
    };
  }

  async getUserCatalogStatisticsDimensionValues(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogStatisticsDimensionValues> {
    if (mediaTypes?.length === 0) {
      return emptyCatalogStatisticsDimensionValues();
    }

    const clauses: SQL[] = [eq(schema.warehouseUserItems.userId, userId), ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) {
      clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));
    }

    const result = await this.db.execute(sql`
      select
        coalesce(
          jsonb_agg(distinct nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '')) filter (where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null),
          '[]'::jsonb
        ) as authors,
        coalesce(
          jsonb_agg(distinct nullif(trim(${schema.warehouseCatalogItems.series}), '')) filter (where nullif(trim(${schema.warehouseCatalogItems.series}), '') is not null),
          '[]'::jsonb
        ) as series,
        coalesce(
          jsonb_agg(distinct nullif(trim(${schema.warehouseCatalogItems.publisher}), '')) filter (where nullif(trim(${schema.warehouseCatalogItems.publisher}), '') is not null),
          '[]'::jsonb
        ) as publishers,
        coalesce(
          jsonb_agg(distinct nullif(trim(genre_value.name), '')) filter (where nullif(trim(genre_value.name), '') is not null),
          '[]'::jsonb
        ) as genres,
        coalesce(
          jsonb_agg(distinct nullif(trim(${schema.warehouseCatalogItems.language}), '')) filter (where nullif(trim(${schema.warehouseCatalogItems.language}), '') is not null),
          '[]'::jsonb
        ) as languages
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      left join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.authors}) as author_value(name) on true
      left join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.genres}) as genre_value(name) on true
      where ${and(...clauses)!}
    `);

    return catalogStatisticsDimensionValues(result);
  }

  async getUserCatalogDiversityData(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogDiversityData> {
    if (mediaTypes?.length === 0) {
      return emptyCatalogDiversityData();
    }

    const clauses: SQL[] = [eq(schema.warehouseUserItems.userId, userId), ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) {
      clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));
    }

    const result = await this.db.execute(sql`
      with owned_items as (
        select
          ${schema.warehouseUserItems.mediaType} as media_type,
          ${schema.warehouseUserItems.remoteId} as remote_id,
          ${schema.warehouseCatalogItems.authors} as authors,
          ${schema.warehouseCatalogItems.genres} as genres,
          ${schema.warehouseCatalogItems.language} as language,
          ${schema.warehouseCatalogItems.rawPayload} as raw_payload
        from ${schema.warehouseUserItems}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        where ${and(...clauses)!}
      ),
      read_items as (
        select owned_items.*
        from owned_items
        inner join ${schema.warehouseUserState}
          on ${schema.warehouseUserState.userId} = ${userId}
         and ${schema.warehouseUserState.mediaType} = owned_items.media_type
         and ${schema.warehouseUserState.remoteId} = owned_items.remote_id
        where ${eq(schema.warehouseUserState.readStatus, 'read')}
      ),
      read_publication_years as (
        select case
          when coalesce(
            raw_payload->>'publishedYear',
            raw_payload->>'published_year',
            raw_payload->>'publicationYear',
            raw_payload->>'publication_year'
          ) ~ '^[0-9]{4}$'
            then coalesce(
              raw_payload->>'publishedYear',
              raw_payload->>'published_year',
              raw_payload->>'publicationYear',
              raw_payload->>'publication_year'
            )::int
          when coalesce(
            raw_payload->>'publishedDate',
            raw_payload->>'published_date',
            raw_payload->>'releaseDate',
            raw_payload->>'release_date'
          ) ~ '^[0-9]{4}'
            then substring(coalesce(
              raw_payload->>'publishedDate',
              raw_payload->>'published_date',
              raw_payload->>'releaseDate',
              raw_payload->>'release_date'
            ) from 1 for 4)::int
          else null
        end as year
        from read_items
      )
      select
        (
          select count(distinct lower(nullif(trim(genre_value.name), '')))::int
          from read_items
          cross join lateral jsonb_array_elements_text(read_items.genres) as genre_value(name)
          where nullif(trim(genre_value.name), '') is not null
        ) as unique_genres_read,
        (
          select coalesce(
            jsonb_agg(distinct lower(nullif(trim(genre_value.name), ''))) filter (where nullif(trim(genre_value.name), '') is not null),
            '[]'::jsonb
          )
          from read_items
          cross join lateral jsonb_array_elements_text(read_items.genres) as genre_value(name)
        ) as genres_read,
        (
          select count(distinct lower(nullif(trim(genre_value.name), '')))::int
          from owned_items
          cross join lateral jsonb_array_elements_text(owned_items.genres) as genre_value(name)
          where nullif(trim(genre_value.name), '') is not null
        ) as total_genres_in_library,
        (
          select coalesce(
            jsonb_agg(distinct lower(nullif(trim(genre_value.name), ''))) filter (where nullif(trim(genre_value.name), '') is not null),
            '[]'::jsonb
          )
          from owned_items
          cross join lateral jsonb_array_elements_text(owned_items.genres) as genre_value(name)
        ) as genres_in_library,
        (
          select count(distinct ${catalogAuthorCanonicalNameSql(sql`author_value.name`)})::int
          from read_items
          cross join lateral jsonb_array_elements_text(read_items.authors) as author_value(name)
          where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null
        ) as unique_authors_read,
        (
          select coalesce(
            jsonb_agg(distinct ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}) filter (where nullif(${catalogAuthorDisplayNameSql(sql`author_value.name`)}, '') is not null),
            '[]'::jsonb
          )
          from read_items
          cross join lateral jsonb_array_elements_text(read_items.authors) as author_value(name)
        ) as authors_read,
        (
          select count(distinct (read_items.media_type::text || ':' || read_items.remote_id))::int
          from read_items
        ) as total_books_read,
        (
          select coalesce(jsonb_agg(year), '[]'::jsonb)
          from read_publication_years
          where year is not null
        ) as publication_years,
        (
          select count(distinct lower(nullif(trim(read_items.language), '')))::int
          from read_items
          where nullif(trim(read_items.language), '') is not null
        ) as unique_languages,
        (
          select coalesce(
            jsonb_agg(distinct lower(nullif(trim(read_items.language), ''))) filter (where nullif(trim(read_items.language), '') is not null),
            '[]'::jsonb
          )
          from read_items
        ) as languages_read
    `);

    return catalogDiversityDataRow(result);
  }

  async topUserCatalogAuthors(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<TopAuthorItem[]> {
    if (mediaTypes?.length === 0) return [];

    const authorName = catalogAuthorDisplayNameSql(sql`author_value.name`);
    const clauses: SQL[] = [
      eq(schema.warehouseUserItems.userId, userId),
      sql`nullif(${authorName}, '') is not null`,
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        min(${authorName}) as name,
        count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as count
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      cross join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.authors}) as author_value(name)
      where ${and(...clauses)!}
      group by ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}
      order by count desc, min(${authorName}) asc
    `);

    return catalogNamedCountRows(result);
  }

  async formatDistribution(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<FormatDistributionItem[]> {
    if (mediaTypes?.length === 0) return [];

    const format = sql<string>`lower(nullif(trim(${schema.warehouseCatalogItems.format}), ''))`;
    const clauses: SQL[] = [
      sql`${format} is not null`,
      inArray(format, [...DEFAULT_FORMAT_PRIORITY]),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        ${format} as format,
        count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
      from ${schema.warehouseCatalogItems}
      where ${and(...clauses)!}
      group by ${format}
      order by count desc, ${format} asc
    `);

    return catalogFormatCountRows(result);
  }

  async formatShareOverTime(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<FormatShareOverTimeItem[]> {
    if (mediaTypes?.length === 0) return [];

    const addedAt = sql<Date>`coalesce(${schema.warehouseCatalogItems.upstreamCreatedAt}, ${schema.warehouseCatalogItems.syncedAt}, ${schema.warehouseCatalogItems.createdAt})`;
    const format = sql<string>`lower(nullif(trim(${schema.warehouseCatalogItems.format}), ''))`;
    const clauses: SQL[] = [
      sql`${format} is not null`,
      inArray(format, [...DEFAULT_FORMAT_PRIORITY]),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        extract(year from ${addedAt})::int as year,
        extract(month from ${addedAt})::int as month,
        ${format} as format,
        count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
      from ${schema.warehouseCatalogItems}
      where ${and(...clauses)!}
      group by extract(year from ${addedAt}), extract(month from ${addedAt}), ${format}
      order by extract(year from ${addedAt}), extract(month from ${addedAt}), ${format}
    `);

    return catalogFormatShareOverTimeRows(result);
  }

  async libraryMetadataCompleteness(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseLibraryMetadataCompletenessRow[]> {
    if (mediaTypes?.length === 0) return [];

    const item = schema.warehouseCatalogItems;
    const libraryId = sql<number>`case when ${item.mediaType} = 'audiobook' then ${CLOUD_AUDIO_LIBRARY_ID} when ${item.mediaType} = 'comic' then ${CLOUD_COMIC_LIBRARY_ID} else ${CLOUD_EBOOK_LIBRARY_ID} end`;
    const libraryName = sql<string>`case when ${item.mediaType} = 'audiobook' then 'Audiobooks' when ${item.mediaType} = 'comic' then 'Comics' else 'Books' end`;
    const description = catalogTextIsPresent(catalogPayloadTextExpression('description', 'summary', 'overview'));
    const rating = catalogPositiveNumberIsPresent(catalogPayloadTextExpression('rating', 'averageRating', 'average_rating'));
    const isbn = sql<boolean>`
      ${catalogTextIsPresent(catalogIdentifierTextExpression('isbn13', 'isbn_13'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('isbn10', 'isbn_10'))}
    `;
    const clauses: SQL[] = buildCatalogContentFilterClauses(contentFilters);
    if (mediaTypes) clauses.push(inArray(item.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        ${libraryId}::int as library_id,
        ${libraryName} as library_name,
        count(*)::int as total,
        count(case when ${catalogTextIsPresent(item.title)} then 1 end)::int as has_title,
        count(case when ${item.hasCover} = true then 1 end)::int as has_cover,
        count(case when ${catalogJsonArrayIsPresent(item.authors)} then 1 end)::int as has_author,
        count(case when ${catalogJsonArrayIsPresent(item.genres)} then 1 end)::int as has_genre,
        count(case when ${catalogJsonArrayIsPresent(item.tags)} then 1 end)::int as has_tag,
        count(case when ${description} then 1 end)::int as has_description,
        count(case when ${catalogTextIsPresent(item.publisher)} then 1 end)::int as has_publisher,
        count(case when ${catalogPublishedYearExpression()} is not null then 1 end)::int as has_year,
        count(case when ${catalogTextIsPresent(item.language)} then 1 end)::int as has_language,
        count(case when ${catalogPageCountExpression()} is not null then 1 end)::int as has_page_count,
        count(case when ${rating} then 1 end)::int as has_rating,
        count(case when ${catalogTextIsPresent(item.series)} then 1 end)::int as has_series,
        count(case when ${isbn} then 1 end)::int as has_isbn
      from ${item}
      left join ${schema.warehouseCatalogDetails}
        on ${item.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
       and ${item.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
      where ${and(...clauses) ?? sql`true`}
      -- By ordinal: libraryId/libraryName are parameterised CASE expressions,
      -- and repeating them here renumbers their parameters (see the note in
      -- metadataScoreDistribution).
      group by 1, 2
      order by 2
    `);

    return catalogLibraryMetadataCompletenessRows(result);
  }

  async pageCountDistributionByFormat(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: PageCountDistributionItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0) return { items: [], unknownCount: 0 };

    const item = schema.warehouseCatalogItems;
    const pageCount = catalogPageCountExpression();
    const format = sql<string>`lower(nullif(trim(${item.format}), ''))`;
    const baseClauses: SQL[] = [...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) baseClauses.push(inArray(item.mediaType, mediaTypes));

    const [itemsResult, unknownResult] = await Promise.all([
      this.db.execute(sql`
        select
          ${format} as format,
          count(*)::int as count,
          min(${pageCount})::int as min,
          percentile_cont(0.25) within group (order by ${pageCount})::float as q1,
          percentile_cont(0.5) within group (order by ${pageCount})::float as median,
          percentile_cont(0.75) within group (order by ${pageCount})::float as q3,
          max(${pageCount})::int as max
        from ${item}
        left join ${schema.warehouseCatalogDetails}
          on ${item.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
         and ${item.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
        where ${and(sql`${pageCount} is not null`, sql`${format} is not null`, inArray(format, [...DEFAULT_FORMAT_PRIORITY]), ...baseClauses)!}
        group by ${format}
        order by count(*) desc
      `),
      this.db.execute(sql`
        select count(*)::int as count
        from ${item}
        left join ${schema.warehouseCatalogDetails}
          on ${item.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
         and ${item.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
        where ${and(sql`${pageCount} is null`, ...baseClauses) ?? sql`true`}
      `),
    ]);

    return {
      items: catalogPageCountDistributionRows(itemsResult),
      unknownCount: catalogCountRow(unknownResult),
    };
  }

  async languageDistribution(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: LanguageDistributionItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0) return { items: [], unknownCount: 0 };

    const language = sql<string>`lower(nullif(trim(${schema.warehouseCatalogItems.language}), ''))`;
    const clauses: SQL[] = [...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const [itemsResult, unknownResult] = await Promise.all([
      this.db.execute(sql`
        select
          ${language} as language,
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        where ${and(...clauses, sql`${language} is not null`) ?? sql`${language} is not null`}
        group by ${language}
        order by count desc, ${language} asc
      `),
      this.db.execute(sql`
        select count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        where ${and(...clauses, sql`${language} is null`) ?? sql`${language} is null`}
      `),
    ]);

    return {
      items: catalogLanguageCountRows(itemsResult),
      unknownCount: catalogCountRow(unknownResult),
    };
  }

  async booksAddedOverTime(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
    granularity: StatisticsGranularity = 'monthly',
    range: StatisticsDateRange = 'all-time',
  ): Promise<BooksAddedDataPoint[]> {
    if (mediaTypes?.length === 0) return [];

    const addedAt = sql<Date>`coalesce(${schema.warehouseCatalogItems.upstreamCreatedAt}, ${schema.warehouseCatalogItems.syncedAt}, ${schema.warehouseCatalogItems.createdAt})`;
    const clauses: SQL[] = [...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));
    if (range === 'last-year') clauses.push(gte(addedAt, sql`now() - interval '1 year'`));
    if (range === 'last-5-years') clauses.push(gte(addedAt, sql`now() - interval '5 years'`));
    const whereClause = and(...clauses) ?? sql`true`;

    if (granularity === 'yearly') {
      const result = await this.db.execute(sql`
        select
          extract(year from ${addedAt})::int as year,
          0 as month,
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        where ${whereClause}
        group by extract(year from ${addedAt})
        order by extract(year from ${addedAt})
      `);

      return catalogBooksAddedRows(result);
    }

    const result = await this.db.execute(sql`
      select
        extract(year from ${addedAt})::int as year,
        extract(month from ${addedAt})::int as month,
        count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
      from ${schema.warehouseCatalogItems}
      where ${whereClause}
      group by extract(year from ${addedAt}), extract(month from ${addedAt})
      order by extract(year from ${addedAt}), extract(month from ${addedAt})
    `);

    return catalogBooksAddedRows(result);
  }

  async storageByFormat(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<StorageByFormatItem[]> {
    if (mediaTypes?.length === 0) return [];

    const sizeBytes = catalogFileSizeExpression();
    // ::text on the enum — format is varchar and media_type is the
    // warehouse_media_type enum, and COALESCE refuses to mix them
    // ("COALESCE types character varying and warehouse_media_type cannot be
    // matched").
    const format = sql<string>`lower(nullif(trim(coalesce(${schema.warehouseCatalogItems.format}, ${schema.warehouseCatalogItems.mediaType}::text)), ''))`;
    const clauses: SQL[] = [sql`${sizeBytes} is not null`, sql`${format} is not null`, ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        ${format} as format,
        coalesce(sum(${sizeBytes}), 0)::bigint as size_bytes
      from ${schema.warehouseCatalogItems}
      left join ${schema.warehouseCatalogDetails}
        on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
       and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
      where ${and(...clauses) ?? sql`true`}
      group by ${format}
      order by size_bytes desc, ${format} asc
    `);

    return catalogStorageByFormatRows(result);
  }

  async metadataScoreDistribution(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<MetadataScoreDistribution> {
    if (mediaTypes?.length === 0) {
      return { bins: [], unknownCount: 0, totalCount: 0, percentile25: null, percentile50: null, percentile75: null, percentile90: null };
    }

    const score = catalogMetadataScoreExpression();
    const bucketExpr = sql`(least(floor(${score} / 10.0), 9) * 10)`;
    const clauses: SQL[] = [...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const [binsResult, unknownResult, percentilesResult] = await Promise.all([
      this.db.execute(sql`
        select
          ${bucketExpr}::int as min_score,
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        left join ${schema.warehouseCatalogDetails}
          on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
         and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
        where ${and(...clauses, sql`${score} is not null`) ?? sql`${score} is not null`}
        -- BY ORDINAL, deliberately. bucketExpr carries bound parameters, and
        -- drizzle numbers them per occurrence: repeating the fragment here
        -- emits $12..$22 against the select's $1..$11, so Postgres sees two
        -- different expressions and rejects the query with "title must appear
        -- in the GROUP BY clause".
        group by 1
        order by 1
      `),
      this.db.execute(sql`
        select count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        left join ${schema.warehouseCatalogDetails}
          on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
         and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
        where ${and(...clauses, sql`${score} is null`) ?? sql`${score} is null`}
      `),
      this.db.execute(sql`
        select
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as total_count,
          percentile_cont(0.25) within group (order by ${score})::float as "percentile25",
          percentile_cont(0.5) within group (order by ${score})::float as "percentile50",
          percentile_cont(0.75) within group (order by ${score})::float as "percentile75",
          percentile_cont(0.9) within group (order by ${score})::float as "percentile90"
        from ${schema.warehouseCatalogItems}
        left join ${schema.warehouseCatalogDetails}
          on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
         and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
        where ${and(...clauses, sql`${score} is not null`) ?? sql`${score} is not null`}
      `),
    ]);

    return catalogMetadataScoreDistributionRows(binsResult, unknownResult, percentilesResult);
  }

  async metadataFreshnessGauge(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<Omit<MetadataFreshnessGauge, 'freshnessScore'>> {
    if (mediaTypes?.length === 0) {
      return { totalBooks: 0, neverFetchedCount: 0, fresh30dCount: 0, stale31To90dCount: 0, stale91To180dCount: 0, staleOver180dCount: 0 };
    }

    const item = schema.warehouseCatalogItems;
    const freshnessAt = sql<Date>`coalesce(${item.upstreamUpdatedAt}, ${item.syncedAt})`;
    const hasProviderId = sql<boolean>`
      ${catalogTextIsPresent(catalogIdentifierTextExpression('googleBooksId', 'google_books_id', 'googleBooks', 'google_books'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('goodreadsId', 'goodreads_id'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('amazonId', 'amazon_id', 'asin'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('hardcoverId', 'hardcover_id'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('openLibraryId', 'open_library_id', 'openLibrary', 'open_library'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('itunesId', 'itunes_id', 'itunes'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('audibleId', 'audible_id', 'audible'))}
      or ${catalogTextIsPresent(catalogIdentifierTextExpression('comicvineId', 'comicvine_id', 'comicvine'))}
    `;
    const clauses: SQL[] = buildCatalogContentFilterClauses(contentFilters);
    if (mediaTypes) clauses.push(inArray(item.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        count(*)::int as total_books,
        count(case when ${freshnessAt} is null and not (${hasProviderId}) then 1 end)::int as never_fetched_count,
        count(case when ${freshnessAt} >= now() - interval '30 days' then 1 end)::int as fresh_30d_count,
        count(case when ${freshnessAt} < now() - interval '30 days' and ${freshnessAt} >= now() - interval '90 days' then 1 end)::int as stale_31_to_90d_count,
        count(case when ${freshnessAt} < now() - interval '90 days' and ${freshnessAt} >= now() - interval '180 days' then 1 end)::int as stale_91_to_180d_count,
        count(case when ${freshnessAt} < now() - interval '180 days' or (${freshnessAt} is null and ${hasProviderId}) then 1 end)::int as stale_over_180d_count
      from ${item}
      left join ${schema.warehouseCatalogDetails}
        on ${item.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
       and ${item.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
      where ${and(...clauses) ?? sql`true`}
    `);

    return catalogMetadataFreshnessGaugeRow(result);
  }

  async libraryIntegrityGauge(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<Omit<LibraryIntegrityGauge, 'integrityScore'>> {
    if (mediaTypes?.length === 0) {
      return { totalBooks: 0, presentCount: 0, primaryFileCount: 0, metadataCount: 0 };
    }

    const item = schema.warehouseCatalogItems;
    const details = schema.warehouseCatalogDetails;
    const clauses: SQL[] = buildCatalogContentFilterClauses(contentFilters);
    if (mediaTypes) clauses.push(inArray(item.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        count(*)::int as total_books,
        count(*)::int as present_count,
        count(case when ${catalogTextIsPresent(item.format)} then 1 end)::int as primary_file_count,
        count(case when ${details.remoteId} is not null then 1 end)::int as metadata_count
      from ${item}
      left join ${details}
        on ${item.mediaType} = ${details.mediaType}
       and ${item.remoteId} = ${details.remoteId}
      where ${and(...clauses) ?? sql`true`}
    `);

    return catalogLibraryIntegrityGaugeRow(result);
  }

  async acquisitionLagScatter(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<StatisticsResult<AcquisitionLagPoint>> {
    if (mediaTypes?.length === 0) return { items: [], unknownCount: 0 };

    const item = schema.warehouseCatalogItems;
    const addedAt = sql<Date>`coalesce(${item.upstreamCreatedAt}, ${item.syncedAt}, ${item.createdAt})`;
    const addedYear = sql<number>`extract(year from ${addedAt})::int`;
    const publishedYear = catalogPublishedYearExpression();
    const rawLag = sql`${addedYear} - ${publishedYear}`;
    const lagBucket = sql<number>`greatest(-5, least(120, ${rawLag}))::int`;
    const clauses: SQL[] = buildCatalogContentFilterClauses(contentFilters);
    if (mediaTypes) clauses.push(inArray(item.mediaType, mediaTypes));

    const [itemsResult, unknownResult] = await Promise.all([
      this.db.execute(sql`
        select
          ${addedYear} as added_year,
          ${lagBucket} as lag_years,
          count(distinct (${item.mediaType}::text || ':' || ${item.remoteId}))::int as count
        from ${item}
        where ${and(...clauses, sql`${publishedYear} is not null`) ?? sql`${publishedYear} is not null`}
        group by ${addedYear}, ${lagBucket}
        order by ${addedYear}, ${lagBucket}
      `),
      this.db.execute(sql`
        select count(distinct (${item.mediaType}::text || ':' || ${item.remoteId}))::int as unknown_count
        from ${item}
        where ${and(...clauses, sql`${publishedYear} is null`) ?? sql`${publishedYear} is null`}
      `),
    ]);

    return {
      items: catalogAcquisitionLagRows(itemsResult),
      unknownCount: catalogUnknownCountRow(unknownResult),
    };
  }

  async getGenreCooccurrence(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[], limit = 15): Promise<ChordDiagramData> {
    if (mediaTypes?.length === 0) return { nodes: [], links: [] };

    const item = schema.warehouseCatalogItems;
    const clauses: SQL[] = [sql`jsonb_array_length(${item.genres}) > 0`, ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(item.mediaType, mediaTypes));
    const whereClause = and(...clauses) ?? sql`true`;

    const topGenresResult = await this.db.execute(sql`
      select genre.name
      from ${item}
      cross join lateral (
        select nullif(trim(value), '') as name
        from jsonb_array_elements_text(${item.genres}) as genre_value(value)
      ) genre
      where ${whereClause} and genre.name is not null
      group by genre.name
      order by count(distinct (${item.mediaType}::text || ':' || ${item.remoteId})) desc, genre.name asc
      limit ${limit}
    `);
    const nodes = catalogChordNodes(topGenresResult);
    if (nodes.length < 2) return { nodes, links: [] };

    const linksResult = await this.db.execute(sql`
      with top_genres as (
        select genre.name
        from ${item}
        cross join lateral (
          select nullif(trim(value), '') as name
          from jsonb_array_elements_text(${item.genres}) as genre_value(value)
        ) genre
        where ${whereClause} and genre.name is not null
        group by genre.name
        order by count(distinct (${item.mediaType}::text || ':' || ${item.remoteId})) desc, genre.name asc
        limit ${limit}
      ),
      item_genres as (
        select distinct
          (${item.mediaType}::text || ':' || ${item.remoteId}) as item_key,
          genre.name
        from ${item}
        cross join lateral (
          select nullif(trim(value), '') as name
          from jsonb_array_elements_text(${item.genres}) as genre_value(value)
        ) genre
        inner join top_genres on top_genres.name = genre.name
        where ${whereClause} and genre.name is not null
      )
      select
        g1.name as source,
        g2.name as target,
        count(distinct g1.item_key)::int as value
      from item_genres g1
      inner join item_genres g2 on g1.item_key = g2.item_key and g1.name < g2.name
      group by g1.name, g2.name
      having count(distinct g1.item_key) >= 1
      order by value desc, source asc, target asc
    `);

    return {
      nodes,
      links: catalogChordLinks(linksResult),
    };
  }

  async publicationDecade(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: PublicationDecadeItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0) return { items: [], unknownCount: 0 };

    const publishedYear = catalogPublishedYearExpression();
    const clauses: SQL[] = [...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const [itemsResult, unknownResult] = await Promise.all([
      this.db.execute(sql`
        select
          (floor(${publishedYear} / 10) * 10)::int as decade,
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        where ${and(...clauses, sql`${publishedYear} is not null`) ?? sql`${publishedYear} is not null`}
        group by floor(${publishedYear} / 10) * 10
        order by floor(${publishedYear} / 10) * 10
      `),
      this.db.execute(sql`
        select count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        where ${and(...clauses, sql`${publishedYear} is null`) ?? sql`${publishedYear} is null`}
      `),
    ]);

    return {
      items: catalogPublicationDecadeRows(itemsResult),
      unknownCount: catalogCountRow(unknownResult),
    };
  }

  async publicationYearTimeline(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: PublicationYearPoint[]; unknownCount: number }> {
    if (mediaTypes?.length === 0) return { items: [], unknownCount: 0 };

    const publishedYear = catalogPublishedYearExpression();
    const clauses: SQL[] = [...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const [countsResult, titlesResult, unknownResult] = await Promise.all([
      this.db.execute(sql`
        select
          ${publishedYear}::int as year,
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        where ${and(...clauses, sql`${publishedYear} is not null`) ?? sql`${publishedYear} is not null`}
        group by ${publishedYear}
        order by ${publishedYear}
      `),
      this.db.execute(sql`
        select year, title
        from (
          select
            ${publishedYear}::int as year,
            ${schema.warehouseCatalogItems.title} as title,
            row_number() over (
              partition by ${publishedYear}
              order by ${schema.warehouseCatalogItems.id}
            ) as rn
          from ${schema.warehouseCatalogItems}
          where ${and(...clauses, sql`${publishedYear} is not null`, isNotNull(schema.warehouseCatalogItems.title)) ?? sql`${publishedYear} is not null`}
        ) ranked_title_rows
        where rn <= 3
        order by year
      `),
      this.db.execute(sql`
        select count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as count
        from ${schema.warehouseCatalogItems}
        where ${and(...clauses, sql`${publishedYear} is null`) ?? sql`${publishedYear} is null`}
      `),
    ]);

    return {
      items: catalogPublicationYearRows(countsResult, titlesResult),
      unknownCount: catalogCountRow(unknownResult),
    };
  }

  async largestBooks(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<LargestBookItem[]> {
    if (mediaTypes?.length === 0) return [];

    const sizeBytes = catalogFileSizeExpression();
    const clauses: SQL[] = [
      ...buildCatalogContentFilterClauses(contentFilters),
      isNotNull(schema.warehouseCatalogItems.title),
      sql`${sizeBytes} is not null`,
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseCatalogItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        ${schema.warehouseCatalogItems.id}::int as id,
        ${schema.warehouseCatalogItems.title} as title,
        ${sizeBytes}::bigint as size_bytes,
        coalesce(nullif(${schema.warehouseCatalogItems.format}, ''), ${schema.warehouseCatalogItems.mediaType}::text) as format
      from ${schema.warehouseCatalogItems}
      left join ${schema.warehouseCatalogDetails}
        on ${schema.warehouseCatalogItems.mediaType} = ${schema.warehouseCatalogDetails.mediaType}
       and ${schema.warehouseCatalogItems.remoteId} = ${schema.warehouseCatalogDetails.remoteId}
      where ${and(...clauses) ?? sql`true`}
      order by ${sizeBytes} desc
      limit 50
    `);

    return catalogLargestBookRows(result);
  }

  async topUserCatalogGenres(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: GenreDistributionItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0) return { items: [], unknownCount: 0 };

    const clauses: SQL[] = [eq(schema.warehouseUserItems.userId, userId), ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const [itemsResult, unknownResult] = await Promise.all([
      this.db.execute(sql`
        select
          min(trim(genre_value.name)) as genre,
          count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as count
        from ${schema.warehouseUserItems}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        cross join lateral jsonb_array_elements_text(${schema.warehouseCatalogItems.genres}) as genre_value(name)
        where ${and(...clauses, sql`nullif(trim(genre_value.name), '') is not null`)!}
        group by lower(trim(genre_value.name))
        order by count desc, min(trim(genre_value.name)) asc
      `),
      this.db.execute(sql`
        select count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as count
        from ${schema.warehouseUserItems}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        where ${and(
          ...clauses,
          sql`not exists (
          select 1
          from jsonb_array_elements_text(${schema.warehouseCatalogItems.genres}) as genre_value(name)
          where nullif(trim(genre_value.name), '') is not null
        )`,
        )!}
      `),
    ]);

    return {
      items: catalogGenreCountRows(itemsResult),
      unknownCount: catalogCountRow(unknownResult),
    };
  }

  async getUserReadingSummary(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<UserStatisticsSummary> {
    if (mediaTypes?.length === 0) {
      return {
        trackedBooks: 0,
        startedBooks: 0,
        inProgressBooks: 0,
        completedBooks: 0,
        meanProgressPercent: 0,
      };
    }

    const clauses: SQL[] = [eq(schema.warehouseUserItems.userId, userId), ...buildCatalogContentFilterClauses(contentFilters)];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as tracked_books,
        count(distinct case
          when ${schema.warehouseUserState.readStatus} in ('reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned')
            then (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId})
        end)::int as started_books,
        count(distinct case
          when ${schema.warehouseUserState.readStatus} in ('reading', 'on_hold', 'rereading')
            then (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId})
        end)::int as in_progress_books,
        count(distinct case
          when ${schema.warehouseUserState.readStatus} = 'read'
            then (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId})
        end)::int as completed_books,
        coalesce(avg(${schema.warehouseUserState.progressPercent}) filter (where ${schema.warehouseUserState.progressPercent} is not null), 0)::float
          as mean_progress_percent
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      left join ${schema.warehouseUserState}
        on ${schema.warehouseUserState.userId} = ${schema.warehouseUserItems.userId}
       and ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
      where ${and(...clauses)!}
    `);

    return catalogUserStatisticsSummaryRow(result);
  }

  async getUserProgressFunnelInRange(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    since: Date,
    untilExclusive: Date,
  ): Promise<UserProgressFunnel> {
    if (mediaTypes?.length === 0) {
      return {
        started: 0,
        reached25: 0,
        reached50: 0,
        reached75: 0,
        completed: 0,
      };
    }

    const clauses: SQL[] = [
      eq(schema.warehouseUserItems.userId, userId),
      gte(schema.warehouseUserState.updatedAt, since),
      lt(schema.warehouseUserState.updatedAt, untilExclusive),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const progressScore = sql<number>`greatest(
      coalesce(${schema.warehouseUserState.progressPercent}, 0),
      case
        when ${schema.warehouseUserState.readStatus} = 'read' then 100
        when ${schema.warehouseUserState.readStatus} in ('reading', 'on_hold', 'rereading', 'skimmed', 'abandoned') then 1
        else 0
      end
    )`;

    const result = await this.db.execute(sql`
      select
        count(*) filter (where ${progressScore} > 0)::int as started,
        count(*) filter (where ${progressScore} >= 25)::int as reached25,
        count(*) filter (where ${progressScore} >= 50)::int as reached50,
        count(*) filter (where ${progressScore} >= 75)::int as reached75,
        count(*) filter (where ${progressScore} >= 100)::int as completed
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      inner join ${schema.warehouseUserState}
        on ${schema.warehouseUserState.userId} = ${schema.warehouseUserItems.userId}
       and ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
      where ${and(...clauses)!}
    `);

    return catalogUserProgressFunnelRow(result);
  }

  async getUserMonthlyCompletions(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    days: number,
  ): Promise<UserCompletionTimelinePoint[]> {
    if (mediaTypes?.length === 0) return [];

    const since = startOfUtcDayForDays(days);
    const clauses: SQL[] = [
      eq(schema.warehouseUserItems.userId, userId),
      eq(schema.warehouseUserState.readStatus, 'read'),
      isNotNull(schema.warehouseUserState.finishedAt),
      gte(schema.warehouseUserState.finishedAt, since),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        extract(year from ${schema.warehouseUserState.finishedAt})::int as year,
        extract(month from ${schema.warehouseUserState.finishedAt})::int as month,
        count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as count
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      inner join ${schema.warehouseUserState}
        on ${schema.warehouseUserState.userId} = ${schema.warehouseUserItems.userId}
       and ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
      where ${and(...clauses)!}
      group by extract(year from ${schema.warehouseUserState.finishedAt}), extract(month from ${schema.warehouseUserState.finishedAt})
      order by extract(year from ${schema.warehouseUserState.finishedAt}), extract(month from ${schema.warehouseUserState.finishedAt})
    `);

    return catalogUserMonthlyCompletionRows(result);
  }

  async getUserCompletionLatencyDays(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    days: number,
  ): Promise<number[]> {
    if (mediaTypes?.length === 0) return [];

    const since = startOfUtcDayForDays(days);
    const clauses: SQL[] = [
      eq(schema.warehouseUserItems.userId, userId),
      eq(schema.warehouseUserState.readStatus, 'read'),
      isNotNull(schema.warehouseUserState.finishedAt),
      gte(schema.warehouseUserState.finishedAt, since),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        extract(epoch from (${schema.warehouseUserState.finishedAt} - ${schema.warehouseUserItems.addedAt})) / 86400 as days
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      inner join ${schema.warehouseUserState}
        on ${schema.warehouseUserState.userId} = ${schema.warehouseUserItems.userId}
       and ${schema.warehouseUserState.mediaType} = ${schema.warehouseUserItems.mediaType}
       and ${schema.warehouseUserState.remoteId} = ${schema.warehouseUserItems.remoteId}
      where ${and(...clauses)!}
      order by ${schema.warehouseUserState.finishedAt} asc, ${schema.warehouseUserItems.mediaType} asc, ${schema.warehouseUserItems.remoteId} asc
    `);

    return catalogUserCompletionLatencyRows(result);
  }

  async getUserReadingSurvivalMaxProgress(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    days: number,
  ): Promise<number[]> {
    if (mediaTypes?.length === 0) return [];

    const since = startOfUtcDayForDays(days);
    const clauses: SQL[] = [
      eq(schema.warehouseUserState.userId, userId),
      gte(schema.warehouseUserState.updatedAt, since),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserState.mediaType, mediaTypes));

    const progressScore = sql<number>`greatest(
      coalesce(${schema.warehouseUserState.progressPercent}, 0),
      case
        when ${schema.warehouseUserState.readStatus} = 'read' then 100
        when ${schema.warehouseUserState.readStatus} in ('reading', 'on_hold', 'rereading', 'skimmed', 'abandoned') then 1
        else 0
      end
    )`;

    const result = await this.db.execute(sql`
      select ${progressScore} as max_progress
      from ${schema.warehouseUserState}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserState.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserState.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      where ${and(...clauses, sql`${progressScore} > 0`)!}
      order by ${schema.warehouseUserState.updatedAt} asc, ${schema.warehouseUserState.mediaType} asc, ${schema.warehouseUserState.remoteId} asc
      limit 2000
    `);

    return catalogUserReadingSurvivalRows(result);
  }

  async topUserCatalogSeries(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<TopSeriesItem[]> {
    if (mediaTypes?.length === 0) return [];

    const clauses: SQL[] = [
      eq(schema.warehouseUserItems.userId, userId),
      sql`nullif(trim(${schema.warehouseCatalogItems.series}), '') is not null`,
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    if (mediaTypes) clauses.push(inArray(schema.warehouseUserItems.mediaType, mediaTypes));

    const result = await this.db.execute(sql`
      select
        min(trim(${schema.warehouseCatalogItems.series})) as name,
        count(distinct (${schema.warehouseUserItems.mediaType}::text || ':' || ${schema.warehouseUserItems.remoteId}))::int as count
      from ${schema.warehouseUserItems}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseUserItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseUserItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      where ${and(...clauses)!}
      group by lower(trim(${schema.warehouseCatalogItems.series}))
      order by count desc, min(trim(${schema.warehouseCatalogItems.series})) asc
    `);

    return catalogNamedCountRows(result);
  }

  async listCatalogAuthorSummaries(params: {
    userId: number;
    q?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<CatalogAuthorSummaryRow[]> {
    const clauses = this.catalogAuthorSummaryClauses(params);

    const result = await this.db.execute(sql`
      select
        ${schema.warehouseCatalogItemAuthors.authorId} as id,
        min(${schema.warehouseCatalogItemAuthors.name}) as name,
        count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as book_count,
        max(${catalogLibraryAddedAtExpression()})::text as last_added_at
      from ${schema.warehouseCatalogItemAuthors}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      left join ${schema.warehouseUserItems}
        on ${buildUserCatalogJoin(params.userId)}
      where ${and(...clauses)!}
      group by ${schema.warehouseCatalogItemAuthors.canonicalName}, ${schema.warehouseCatalogItemAuthors.authorId}
    `);

    return catalogAuthorSummaryRows(result);
  }

  private catalogAuthorSummaryClauses(params: { q?: string; contentFilters?: ContentFilterRules; mediaType?: WarehouseMediaType }): SQL[] {
    const clauses: SQL[] = [
      sql`nullif(${schema.warehouseCatalogItemAuthors.name}, '') is not null`,
      ...buildCatalogContentFilterClauses(params.contentFilters),
    ];
    const q = params.q?.trim();

    if (q) {
      const pattern = `%${q}%`;
      clauses.push(ilike(schema.warehouseCatalogItemAuthors.name, pattern));
    }

    if (params.mediaType) {
      clauses.push(eq(schema.warehouseCatalogItems.mediaType, params.mediaType));
    }

    return clauses;
  }

  async listCatalogAuthorSummaryPage(params: {
    userId: number;
    q?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
    page: number;
    size: number;
    sort: 'name' | 'sortName' | 'bookCount' | 'lastAddedAt' | 'lastEnrichedAt';
    order: 'asc' | 'desc';
    minBookCount?: number;
  }): Promise<CatalogAuthorSummaryPage> {
    const page = clampNumber(params.page, 0, 0, Number.MAX_SAFE_INTEGER);
    const size = clampNumber(params.size, DEFAULT_LIMIT, 1, Number.MAX_SAFE_INTEGER);
    if (params.minBookCount === undefined && (params.sort === 'name' || params.sort === 'sortName' || params.sort === 'lastEnrichedAt')) {
      const q = params.q?.trim();
      if (!q && !params.mediaType && (!params.contentFilters || isContentFilterEmpty(params.contentFilters))) {
        return this.listUnfilteredCatalogAuthorSummaryNamePage({ userId: params.userId, page, size, sort: params.sort, order: params.order });
      }

      return this.listCatalogAuthorSummaryNamePage({ ...params, page, size, sort: params.sort });
    }

    const clauses = this.catalogAuthorSummaryClauses(params);
    const groupedWhere: SQL[] = [];
    if (params.minBookCount !== undefined) {
      groupedWhere.push(sql`book_count >= ${params.minBookCount}`);
    }
    const filteredWhere = groupedWhere.length > 0 ? sql`where ${and(...groupedWhere)}` : sql``;
    const orderBy = catalogAuthorSummaryOrder(params.sort, params.order);

    const result = await this.db.execute(sql`
      with grouped as (
        select
          ${schema.warehouseCatalogItemAuthors.authorId} as id,
          min(${schema.warehouseCatalogItemAuthors.name}) as name,
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as book_count,
          max(${catalogLibraryAddedAtExpression()})::text as last_added_at
        from ${schema.warehouseCatalogItemAuthors}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        left join ${schema.warehouseUserItems}
          on ${buildUserCatalogJoin(params.userId)}
        where ${and(...clauses)!}
        group by ${schema.warehouseCatalogItemAuthors.canonicalName}, ${schema.warehouseCatalogItemAuthors.authorId}
      ),
      filtered as (
        select * from grouped
        ${filteredWhere}
      ),
      total as (
        select count(*)::int as total from filtered
      )
      select page_rows.*, total.total
      from total
      left join lateral (
        select *
        from filtered
        order by ${orderBy}
        limit ${size}
        offset ${page * size}
      ) page_rows on true
    `);
    const rows = catalogAuthorSummaryRows(result);
    const total = Number(((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]?.total ?? 0);

    return { rows, total, page, size };
  }

  private async listUnfilteredCatalogAuthorSummaryNamePage(params: {
    userId: number;
    page: number;
    size: number;
    sort: 'name' | 'sortName' | 'lastEnrichedAt';
    order: 'asc' | 'desc';
  }): Promise<CatalogAuthorSummaryPage> {
    const direction = params.order === 'desc' ? sql`desc` : sql`asc`;
    const result = await this.db.execute(sql`
      with total as (
        select count(distinct ${schema.warehouseCatalogItemAuthors.authorId})::int as total
        from ${schema.warehouseCatalogItemAuthors}
        where nullif(${schema.warehouseCatalogItemAuthors.name}, '') is not null
      )
      select page_rows.id, page_rows.name, stats.book_count, stats.last_added_at, total.total
      from total
      left join lateral (
        select distinct on (${schema.warehouseCatalogItemAuthors.canonicalName}, ${schema.warehouseCatalogItemAuthors.authorId})
          ${schema.warehouseCatalogItemAuthors.authorId} as id,
          ${schema.warehouseCatalogItemAuthors.name} as name
        from ${schema.warehouseCatalogItemAuthors}
        where nullif(${schema.warehouseCatalogItemAuthors.name}, '') is not null
        order by
          ${schema.warehouseCatalogItemAuthors.canonicalName} ${direction},
          ${schema.warehouseCatalogItemAuthors.authorId} asc,
          ${schema.warehouseCatalogItemAuthors.sortOrder} asc,
          ${schema.warehouseCatalogItemAuthors.name} asc
        limit ${params.size}
        offset ${params.page * params.size}
      ) page_rows on true
      left join lateral (
        select
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as book_count,
          max(${catalogLibraryAddedAtExpression()})::text as last_added_at
        from ${schema.warehouseCatalogItemAuthors}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        left join ${schema.warehouseUserItems}
          on ${buildUserCatalogJoin(params.userId)}
        where page_rows.id is not null
          and ${schema.warehouseCatalogItemAuthors.authorId} = page_rows.id
      ) stats on true
    `);
    const rows = catalogAuthorSummaryRows(result);
    const total = Number(((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]?.total ?? 0);

    return { rows, total, page: params.page, size: params.size };
  }

  private async listCatalogAuthorSummaryNamePage(params: {
    userId: number;
    q?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
    page: number;
    size: number;
    sort: 'name' | 'sortName' | 'lastEnrichedAt';
    order: 'asc' | 'desc';
  }): Promise<CatalogAuthorSummaryPage> {
    const clauses = this.catalogAuthorSummaryClauses(params);
    const orderBy = catalogAuthorSummaryOrder(params.sort, params.order);

    const result = await this.db.execute(sql`
      with identities as (
        select
          ${schema.warehouseCatalogItemAuthors.authorId} as id,
          min(${schema.warehouseCatalogItemAuthors.name}) as name
        from ${schema.warehouseCatalogItemAuthors}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        where ${and(...clauses)!}
        group by ${schema.warehouseCatalogItemAuthors.canonicalName}, ${schema.warehouseCatalogItemAuthors.authorId}
      ),
      total as (
        select count(*)::int as total from identities
      )
      select page_rows.id, page_rows.name, stats.book_count, stats.last_added_at, total.total
      from total
      left join lateral (
        select *
        from identities
        order by ${orderBy}
        limit ${params.size}
        offset ${params.page * params.size}
      ) page_rows on true
      left join lateral (
        select
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as book_count,
          max(${catalogLibraryAddedAtExpression()})::text as last_added_at
        from ${schema.warehouseCatalogItemAuthors}
        inner join ${schema.warehouseCatalogItems}
          on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        left join ${schema.warehouseUserItems}
          on ${buildUserCatalogJoin(params.userId)}
        where page_rows.id is not null
          and ${schema.warehouseCatalogItemAuthors.authorId} = page_rows.id
          and ${and(...clauses)!}
      ) stats on true
    `);
    const rows = catalogAuthorSummaryRows(result);
    const total = Number(((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]?.total ?? 0);

    return { rows, total, page: params.page, size: params.size };
  }

  async findCatalogAuthorSummaryById(authorId: number, userId: number, contentFilters?: ContentFilterRules): Promise<CatalogAuthorSummaryRow | null> {
    const clauses: SQL[] = [
      sql`nullif(${schema.warehouseCatalogItemAuthors.name}, '') is not null`,
      eq(schema.warehouseCatalogItemAuthors.authorId, authorId),
      ...buildCatalogContentFilterClauses(contentFilters),
    ];
    const result = await this.db.execute(sql`
      select
        ${schema.warehouseCatalogItemAuthors.authorId} as id,
        min(${schema.warehouseCatalogItemAuthors.name}) as name,
        count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as book_count,
        max(${catalogLibraryAddedAtExpression()})::text as last_added_at
      from ${schema.warehouseCatalogItemAuthors}
      inner join ${schema.warehouseCatalogItems}
        on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      left join ${schema.warehouseUserItems}
        on ${buildUserCatalogJoin(userId)}
      where ${and(...clauses)!}
      group by ${schema.warehouseCatalogItemAuthors.canonicalName}, ${schema.warehouseCatalogItemAuthors.authorId}
      limit 1
    `);

    return catalogAuthorSummaryRows(result)[0] ?? null;
  }

  async listCatalogSeriesSummaries(params: {
    userId: number;
    q?: string;
    author?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<CatalogSeriesSummaryRow[]> {
    const clauses = this.catalogSeriesSummaryClauses(params);

    const result = await this.db.execute(sql`
      select
        min(trim(${schema.warehouseCatalogItems.series})) as name,
        count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as book_count,
        count(distinct case when ${schema.warehouseUserState.readStatus} = 'read' then (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}) end)::int as read_count,
        coalesce(
          jsonb_agg(distinct nullif(${schema.warehouseCatalogItemAuthors.name}, '')) filter (where nullif(${schema.warehouseCatalogItemAuthors.name}, '') is not null),
          '[]'::jsonb
        ) as authors,
        max(${catalogLibraryAddedAtExpression()})::text as last_added_at
      from ${schema.warehouseCatalogItems}
      left join ${schema.warehouseUserItems}
        on ${buildUserCatalogJoin(params.userId)}
      left join ${schema.warehouseUserState}
        on ${schema.warehouseUserState.userId} = ${params.userId}
        and ${schema.warehouseUserState.mediaType} = ${schema.warehouseCatalogItems.mediaType}
        and ${schema.warehouseUserState.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      left join ${schema.warehouseCatalogItemAuthors}
        on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
       and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      where ${and(...clauses)!}
      group by lower(trim(${schema.warehouseCatalogItems.series}))
    `);

    return catalogSeriesSummaryRows(result);
  }

  private catalogSeriesSummaryClauses(params: {
    q?: string;
    author?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): SQL[] {
    const clauses: SQL[] = [
      sql`nullif(trim(${schema.warehouseCatalogItems.series}), '') is not null`,
      ...buildCatalogContentFilterClauses(params.contentFilters),
    ];
    const q = params.q?.trim();
    const author = params.author?.trim();

    if (q) {
      const pattern = `%${q}%`;
      clauses.push(
        or(
          ilike(schema.warehouseCatalogItems.series, pattern),
          sql`exists (
            select 1
            from ${schema.warehouseCatalogItemAuthors}
            where ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
              and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
              and ${schema.warehouseCatalogItemAuthors.name} ilike ${pattern}
          )`,
        )!,
      );
    }

    if (author) {
      const pattern = `%${author}%`;
      clauses.push(sql`exists (
        select 1
        from ${schema.warehouseCatalogItemAuthors}
        where ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
          and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
          and ${schema.warehouseCatalogItemAuthors.name} ilike ${pattern}
      )`);
    }

    if (params.mediaType) {
      clauses.push(eq(schema.warehouseCatalogItems.mediaType, params.mediaType));
    }

    return clauses;
  }

  async listCatalogSeriesSummaryPage(params: {
    userId: number;
    q?: string;
    author?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
    page: number;
    size: number;
    sort: 'name' | 'bookCount' | 'lastAddedAt' | 'readProgress';
    order: 'asc' | 'desc';
    completionStatus?: 'not_started' | 'in_progress' | 'complete';
  }): Promise<CatalogSeriesSummaryPage> {
    const page = clampNumber(params.page, 0, 0, Number.MAX_SAFE_INTEGER);
    const size = clampNumber(params.size, DEFAULT_LIMIT, 1, Number.MAX_SAFE_INTEGER);
    const clauses = this.catalogSeriesSummaryClauses(params);
    const filteredWhere = catalogSeriesCompletionWhere(params.completionStatus);
    const orderBy = catalogSeriesSummaryOrder(params.sort, params.order);

    const result = await this.db.execute(sql`
      with grouped as (
        select
          min(trim(${schema.warehouseCatalogItems.series})) as name,
          count(distinct (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}))::int as book_count,
          count(distinct case when ${schema.warehouseUserState.readStatus} = 'read' then (${schema.warehouseCatalogItems.mediaType}::text || ':' || ${schema.warehouseCatalogItems.remoteId}) end)::int as read_count,
          coalesce(
            jsonb_agg(distinct nullif(${schema.warehouseCatalogItemAuthors.name}, '')) filter (where nullif(${schema.warehouseCatalogItemAuthors.name}, '') is not null),
            '[]'::jsonb
          ) as authors,
          max(${catalogLibraryAddedAtExpression()})::text as last_added_at
        from ${schema.warehouseCatalogItems}
        left join ${schema.warehouseUserItems}
          on ${buildUserCatalogJoin(params.userId)}
        left join ${schema.warehouseUserState}
          on ${schema.warehouseUserState.userId} = ${params.userId}
          and ${schema.warehouseUserState.mediaType} = ${schema.warehouseCatalogItems.mediaType}
          and ${schema.warehouseUserState.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        left join ${schema.warehouseCatalogItemAuthors}
          on ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
         and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
        where ${and(...clauses)!}
        group by lower(trim(${schema.warehouseCatalogItems.series}))
      ),
      filtered as (
        select * from grouped
        ${filteredWhere}
      ),
      total as (
        select count(*)::int as total from filtered
      )
      select page_rows.*, total.total
      from total
      left join lateral (
        select *
        from filtered
        order by ${orderBy}
        limit ${size}
        offset ${page * size}
      ) page_rows on true
    `);
    const rows = catalogSeriesSummaryRows(result);
    const total = Number(((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]?.total ?? 0);

    return { rows, total, page, size };
  }

  async listCatalogItemsBySeries(params: {
    userId: number;
    seriesName: string;
    page: number;
    size: number;
    sort: 'seriesIndex' | 'title' | 'addedAt';
    order: 'asc' | 'desc';
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<CatalogSeriesItemsPage> {
    const page = clampNumber(params.page, 0, 0, Number.MAX_SAFE_INTEGER);
    const size = clampNumber(params.size, DEFAULT_LIMIT, 1, Number.MAX_SAFE_INTEGER);
    const where = and(
      sql`lower(btrim(${schema.warehouseCatalogItems.series})) = lower(btrim(${params.seriesName}))`,
      params.mediaType ? eq(schema.warehouseCatalogItems.mediaType, params.mediaType) : undefined,
      ...buildCatalogContentFilterClauses(params.contentFilters),
    )!;
    const orderBy = catalogSeriesItemsOrder(params.sort, params.order);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(schema.warehouseCatalogItems),
          userAddedAt: schema.warehouseUserItems.addedAt,
          rating: schema.warehouseUserState.rating,
          readingProgress: schema.warehouseUserState.progressPercent,
          readStatus: schema.warehouseUserState.readStatus,
          lastReadAt: schema.warehouseUserState.updatedAt,
          finishedAt: schema.warehouseUserState.finishedAt,
        })
        .from(schema.warehouseCatalogItems)
        .leftJoin(schema.warehouseUserItems, buildUserCatalogJoin(params.userId))
        .leftJoin(schema.warehouseUserState, buildCatalogUserStateJoin(params.userId))
        .where(where)
        .orderBy(orderBy)
        .limit(size)
        .offset(page * size),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.warehouseCatalogItems)
        .where(where),
    ]);

    return {
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      size,
    };
  }

  async listCatalogItemsByAuthor(params: {
    userId: number;
    authorId?: number;
    authorName?: string;
    page: number;
    size: number;
    sort: 'title' | 'publishedYear' | 'addedAt';
    order: 'asc' | 'desc';
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<CatalogSeriesItemsPage> {
    const page = clampNumber(params.page, 0, 0, Number.MAX_SAFE_INTEGER);
    const size = clampNumber(params.size, DEFAULT_LIMIT, 1, Number.MAX_SAFE_INTEGER);
    const authorClauses: SQL[] = [];
    if (params.authorId !== undefined) {
      authorClauses.push(eq(schema.warehouseCatalogItemAuthors.authorId, params.authorId));
    }
    const authorName = params.authorName?.trim();
    if (authorName) {
      authorClauses.push(
        or(
          eq(schema.warehouseCatalogItemAuthors.canonicalName, authorName.toLowerCase()),
          eq(schema.warehouseCatalogItemAuthors.canonicalName, catalogAuthorCanonicalName(authorName)),
        )!,
      );
    }
    if (authorClauses.length === 0) {
      return { rows: [], total: 0, page, size };
    }

    const where = and(
      or(...authorClauses),
      params.mediaType ? eq(schema.warehouseCatalogItems.mediaType, params.mediaType) : undefined,
      ...buildCatalogContentFilterClauses(params.contentFilters),
    )!;
    const orderBy = catalogAuthorItemsOrder(params.sort, params.order);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(schema.warehouseCatalogItems),
          userAddedAt: schema.warehouseUserItems.addedAt,
          rating: schema.warehouseUserState.rating,
          readingProgress: schema.warehouseUserState.progressPercent,
          readStatus: schema.warehouseUserState.readStatus,
          lastReadAt: schema.warehouseUserState.updatedAt,
          finishedAt: schema.warehouseUserState.finishedAt,
        })
        .from(schema.warehouseCatalogItemAuthors)
        .innerJoin(
          schema.warehouseCatalogItems,
          and(
            eq(schema.warehouseCatalogItemAuthors.mediaType, schema.warehouseCatalogItems.mediaType),
            eq(schema.warehouseCatalogItemAuthors.remoteId, schema.warehouseCatalogItems.remoteId),
          ),
        )
        .leftJoin(schema.warehouseUserItems, buildUserCatalogJoin(params.userId))
        .leftJoin(schema.warehouseUserState, buildCatalogUserStateJoin(params.userId))
        .where(where)
        .orderBy(orderBy)
        .limit(size)
        .offset(page * size),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.warehouseCatalogItemAuthors)
        .innerJoin(
          schema.warehouseCatalogItems,
          and(
            eq(schema.warehouseCatalogItemAuthors.mediaType, schema.warehouseCatalogItems.mediaType),
            eq(schema.warehouseCatalogItemAuthors.remoteId, schema.warehouseCatalogItems.remoteId),
          ),
        )
        .where(where),
    ]);

    return {
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      size,
    };
  }
}

function catalogDimensionField(kind: Extract<WarehouseCatalogDimensionKind, 'author' | 'narrator' | 'series' | 'genre'>) {
  switch (kind) {
    case 'author':
      return sql`jsonb_array_elements_text(${schema.warehouseCatalogItems.authors})`;
    case 'narrator':
      return sql`jsonb_array_elements_text(${schema.warehouseCatalogItems.narrators})`;
    case 'series':
      return sql`values (${schema.warehouseCatalogItems.series})`;
    case 'genre':
      return sql`jsonb_array_elements_text(${schema.warehouseCatalogItems.genres})`;
  }
}

function dimensionRows(result: unknown): CatalogDimensionRow[] {
  return ((result as { rows?: Array<{ name?: unknown; item_count?: unknown }> }).rows ?? [])
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name.trim() : '',
      itemCount: typeof row.item_count === 'number' ? row.item_count : Number(row.item_count ?? 0),
    }))
    .filter((row) => row.name.length > 0);
}

function catalogLibraryOverviewRow(result: unknown): CatalogLibraryOverviewRow {
  return ((result as { rows?: CatalogLibraryOverviewRow[] }).rows ?? [])[0] ?? {};
}

function catalogStatisticsSummaryRow(result: unknown): CatalogStatisticsSummaryRow {
  return ((result as { rows?: CatalogStatisticsSummaryRow[] }).rows ?? [])[0] ?? {};
}

function catalogUserStatisticsSummaryRow(result: unknown): UserStatisticsSummary {
  const row = ((result as { rows?: CatalogUserStatisticsSummaryRow[] }).rows ?? [])[0] ?? {};
  return {
    trackedBooks: Number(row.tracked_books ?? 0),
    startedBooks: Number(row.started_books ?? 0),
    inProgressBooks: Number(row.in_progress_books ?? 0),
    completedBooks: Number(row.completed_books ?? 0),
    meanProgressPercent: Number(row.mean_progress_percent ?? 0),
  };
}

function catalogUserProgressFunnelRow(result: unknown): UserProgressFunnel {
  const row = ((result as { rows?: CatalogUserProgressFunnelRow[] }).rows ?? [])[0] ?? {};
  return {
    started: Number(row.started ?? 0),
    reached25: Number(row.reached25 ?? 0),
    reached50: Number(row.reached50 ?? 0),
    reached75: Number(row.reached75 ?? 0),
    completed: Number(row.completed ?? 0),
  };
}

function catalogUserMonthlyCompletionRows(result: unknown): UserCompletionTimelinePoint[] {
  return ((result as { rows?: { year?: unknown; month?: unknown; count?: unknown }[] }).rows ?? []).map((row) => ({
    year: Number(row.year),
    month: Number(row.month),
    count: Number(row.count ?? 0),
  }));
}

function catalogUserCompletionLatencyRows(result: unknown): number[] {
  return ((result as { rows?: { days?: unknown }[] }).rows ?? []).map((row) => Number(row.days)).filter((days) => Number.isFinite(days) && days >= 0);
}

function catalogUserReadingSurvivalRows(result: unknown): number[] {
  return ((result as { rows?: { max_progress?: unknown }[] }).rows ?? [])
    .map((row) => Number(row.max_progress))
    .filter((progress) => Number.isFinite(progress) && progress >= 0);
}

function startOfUtcDayForDays(days: number): Date {
  const normalized = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (normalized - 1));
  return start;
}

function emptyLibraryOverview(): LibraryOverviewWidgetData {
  return { totalBooks: 0, totalAuthors: 0, totalSeries: 0, totalStorageBytes: 0, booksAddedThisYear: 0 };
}

function emptyStatisticsSummary(): StatisticsSummary {
  return {
    totalBooks: 0,
    totalAuthors: 0,
    totalSeries: 0,
    totalPublishers: 0,
    totalStorageBytes: 0,
    totalGenres: 0,
    totalLanguages: 0,
    publicationYearMin: null,
    publicationYearMax: null,
    booksAddedThisYear: 0,
  };
}

function emptyCatalogStatisticsDimensionValues(): CatalogStatisticsDimensionValues {
  return { authors: [], series: [], publishers: [], genres: [], languages: [] };
}

function emptyCatalogDiversityData(): CatalogDiversityData {
  return {
    uniqueGenresRead: 0,
    totalGenresInLibrary: 0,
    uniqueAuthorsRead: 0,
    totalBooksRead: 0,
    publicationYears: [],
    uniqueLanguages: 0,
    genresRead: [],
    genresInLibrary: [],
    authorsRead: [],
    languagesRead: [],
  };
}

function emptyCatalogYearProjectionData(): CatalogYearProjectionData {
  return {
    booksCompletedYtd: 0,
    pagesReadLast30Days: 0,
    hoursReadLast30Days: 0,
    booksCompletedLast30Days: 0,
  };
}

function emptyCatalogReadingDnaData(): CatalogReadingDnaData {
  return {
    avgPageCount: 0,
    uniqueGenres: 0,
    totalBooks: 0,
    readingDaysRatio: 0,
    peakHour: 12,
    avgPagesPerHour: null,
    genresRead: [],
    readingDays: [],
    lookbackDays: 0,
    hourBuckets: [],
    pagesReadForSpeed: 0,
    secondsReadForSpeed: 0,
  };
}

function emptyCatalogChallengePatternData(): CatalogChallengePatternData {
  return {
    avgPageCount: 0,
    uniqueGenresLast6Months: 0,
    staleInProgressCount: 0,
    currentStreak: 0,
    maxStreakThisMonth: 0,
    topAuthorBookCount: 0,
    totalBooksRead: 0,
    pagesThisMonth: 0,
    shortBooksCompleted: 0,
    newGenresRead: 0,
    oldestInProgressFinished: false,
    newAuthorsRead: 0,
    pagesReadThisMonth: 0,
    genresLast6Months: [],
    genresReadThisMonth: [],
    authorsReadThisMonth: [],
    readingDaysThisMonth: [],
  };
}

function emptyCatalogNeglectedGemsData(): NeglectedGemsWidgetData {
  return { gems: [] };
}

function catalogStatisticsDimensionValues(result: unknown): CatalogStatisticsDimensionValues {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (!row) return emptyCatalogStatisticsDimensionValues();

  return {
    authors: stringArrayValue(row.authors),
    series: stringArrayValue(row.series),
    publishers: stringArrayValue(row.publishers),
    genres: stringArrayValue(row.genres),
    languages: stringArrayValue(row.languages),
  };
}

function stringArrayValue(value: unknown): string[] {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item.length > 0);
}

function catalogDiversityDataRow(result: unknown): CatalogDiversityData {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (!row) return emptyCatalogDiversityData();

  return {
    uniqueGenresRead: Number(row.unique_genres_read ?? 0),
    totalGenresInLibrary: Number(row.total_genres_in_library ?? 0),
    uniqueAuthorsRead: Number(row.unique_authors_read ?? 0),
    totalBooksRead: Number(row.total_books_read ?? 0),
    publicationYears: numberArrayValue(row.publication_years),
    uniqueLanguages: Number(row.unique_languages ?? 0),
    genresRead: stringArrayValue(row.genres_read),
    genresInLibrary: stringArrayValue(row.genres_in_library),
    authorsRead: stringArrayValue(row.authors_read),
    languagesRead: stringArrayValue(row.languages_read),
  };
}

function numberArrayValue(value: unknown): number[] {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function catalogYearProjectionDataRow(result: unknown): CatalogYearProjectionData {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (!row) return emptyCatalogYearProjectionData();

  return {
    booksCompletedYtd: Number(row.books_completed_ytd ?? 0),
    pagesReadLast30Days: Number(row.pages_read_last_30_days ?? 0),
    hoursReadLast30Days: Number(row.hours_read_last_30_days ?? 0),
    booksCompletedLast30Days: Number(row.books_completed_last_30_days ?? 0),
  };
}

function catalogReadingDnaDataRow(result: unknown): CatalogReadingDnaData {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (!row) return emptyCatalogReadingDnaData();

  const readingDays = stringArrayValue(row.reading_days);
  const lookbackDays = Number(row.lookback_days ?? 0);
  const pagesReadForSpeed = Number(row.pages_read_for_speed ?? 0);
  const secondsReadForSpeed = Number(row.seconds_read_for_speed ?? 0);

  return {
    avgPageCount: Number(row.avg_page_count ?? 0),
    uniqueGenres: Number(row.unique_genres ?? 0),
    totalBooks: Number(row.total_books ?? 0),
    readingDaysRatio: lookbackDays > 0 ? readingDays.length / lookbackDays : 0,
    peakHour: Number(row.peak_hour ?? 12),
    avgPagesPerHour: secondsReadForSpeed > 0 ? pagesReadForSpeed / (secondsReadForSpeed / 3600) : null,
    genresRead: stringArrayValue(row.genres_read),
    readingDays,
    lookbackDays,
    hourBuckets: catalogReadingDnaHourBuckets(row.hour_buckets),
    pagesReadForSpeed,
    secondsReadForSpeed,
  };
}

function catalogChallengePatternDataRow(result: unknown): CatalogChallengePatternData {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (!row) return emptyCatalogChallengePatternData();

  const readingDaysThisMonth = stringArrayValue(row.reading_days_this_month);

  return {
    avgPageCount: Number(row.avg_page_count ?? 0),
    uniqueGenresLast6Months: Number(row.unique_genres_last_6_months ?? 0),
    staleInProgressCount: Number(row.stale_in_progress_count ?? 0),
    currentStreak: 0,
    maxStreakThisMonth: computeDateStreakLength(readingDaysThisMonth),
    topAuthorBookCount: Number(row.top_author_book_count ?? 0),
    totalBooksRead: Number(row.total_books_read ?? 0),
    pagesThisMonth: Number(row.pages_this_month ?? 0),
    shortBooksCompleted: Number(row.short_books_completed ?? 0),
    newGenresRead: Number(row.new_genres_read ?? 0),
    oldestInProgressFinished: row.oldest_in_progress_finished === true || row.oldest_in_progress_finished === 'true',
    newAuthorsRead: Number(row.new_authors_read ?? 0),
    pagesReadThisMonth: Number(row.pages_this_month ?? 0),
    genresLast6Months: stringArrayValue(row.genres_last_6_months),
    genresReadThisMonth: stringArrayValue(row.genres_read_this_month),
    authorsReadThisMonth: stringArrayValue(row.authors_read_this_month),
    readingDaysThisMonth,
  };
}

function catalogNeglectedGemsRows(result: unknown, today: Date): NeglectedGemsWidgetData {
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];

  return {
    gems: rows
      .map((row) => {
        const mediaType: WarehouseMediaType = row.media_type === 'audiobook' ? 'audiobook' : row.media_type === 'comic' ? 'comic' : 'ebook';
        const remoteId = typeof row.remote_id === 'string' ? row.remote_id : '';
        const addedAt = dateValue(row.added_at);
        const waitingDays = Number.isFinite(addedAt.getTime())
          ? Math.max(0, Math.floor((today.getTime() - addedAt.getTime()) / (1000 * 60 * 60 * 24)))
          : 0;

        return {
          type: 'catalog-item' as const,
          bookId: Number(row.id ?? 0),
          mediaType,
          remoteId,
          title: typeof row.title === 'string' ? row.title : null,
          hasCover: row.has_cover === true || row.has_cover === 'true',
          rating: Number(row.rating ?? 0),
          waitingDays,
          genre: typeof row.genre === 'string' && row.genre.trim().length > 0 ? row.genre.trim() : null,
        };
      })
      .filter((gem) => gem.bookId > 0 && gem.remoteId.length > 0 && Number.isFinite(gem.rating)),
  };
}

function catalogLongWaitRow(result: unknown, today: Date): LongWaitWidgetData | null {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  if (!row) return null;

  const mediaType: WarehouseMediaType = row.media_type === 'audiobook' ? 'audiobook' : row.media_type === 'comic' ? 'comic' : 'ebook';
  const remoteId = typeof row.remote_id === 'string' ? row.remote_id : '';
  const addedAt = dateValue(row.added_at);
  if (!remoteId || !Number.isFinite(addedAt.getTime())) return null;

  return {
    type: 'catalog-item',
    bookId: Number(row.id ?? 0),
    mediaType,
    remoteId,
    title: typeof row.title === 'string' ? row.title : null,
    hasCover: row.has_cover === true || row.has_cover === 'true',
    addedAt: addedAt.toISOString(),
    waitingDays: Math.max(0, Math.floor((today.getTime() - addedAt.getTime()) / (1000 * 60 * 60 * 24))),
    pageCount: numberOrNull(row.page_count),
    genre: typeof row.genre === 'string' && row.genre.trim().length > 0 ? row.genre.trim() : null,
    fileId: null,
    fileFormat: typeof row.format === 'string' && row.format.trim().length > 0 ? row.format.trim() : null,
  };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function dateValue(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(Number.NaN);
}

function catalogReadingDnaHourBuckets(value: unknown): { hour: number; totalSeconds: number }[] {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const hour = Number(record.hour);
      const totalSeconds = Number(record.totalSeconds ?? record.total_seconds ?? 0);
      return { hour, totalSeconds };
    })
    .filter((bucket) => Number.isInteger(bucket.hour) && bucket.hour >= 0 && bucket.hour <= 23 && Number.isFinite(bucket.totalSeconds));
}

function computeDateStreakLength(days: string[]): number {
  if (days.length === 0) return 0;

  const timestamps = [...new Set(days)]
    .map((day) => Date.parse(`${day}T00:00:00.000Z`))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous: number | null = null;

  for (const time of timestamps) {
    current = previous !== null && time - previous === 86_400_000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = time;
  }
  return longest;
}

function catalogNamedCountRows(result: unknown): Array<{ name: string; count: number }> {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name.trim() : '',
      count: Number(row.count ?? 0),
    }))
    .filter((row) => row.name.length > 0);
}

function catalogFormatCountRows(result: unknown): FormatDistributionItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      format: typeof row.format === 'string' ? row.format.trim() : '',
      count: Number(row.count ?? 0),
    }))
    .filter((row) => row.format.length > 0);
}

function catalogFormatShareOverTimeRows(result: unknown): FormatShareOverTimeItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      year: Number(row.year),
      month: Number(row.month),
      format: typeof row.format === 'string' ? row.format.trim() : '',
      count: Number(row.count ?? 0),
    }))
    .filter((row) => Number.isInteger(row.year) && Number.isInteger(row.month) && row.format.length > 0);
}

function catalogLibraryMetadataCompletenessRows(result: unknown): WarehouseLibraryMetadataCompletenessRow[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      libraryId: Number(row.library_id),
      libraryName: typeof row.library_name === 'string' ? row.library_name.trim() : '',
      total: Number(row.total ?? 0),
      hasTitle: Number(row.has_title ?? 0),
      hasCover: Number(row.has_cover ?? 0),
      hasAuthor: Number(row.has_author ?? 0),
      hasGenre: Number(row.has_genre ?? 0),
      hasTag: Number(row.has_tag ?? 0),
      hasDescription: Number(row.has_description ?? 0),
      hasPublisher: Number(row.has_publisher ?? 0),
      hasYear: Number(row.has_year ?? 0),
      hasLanguage: Number(row.has_language ?? 0),
      hasPageCount: Number(row.has_page_count ?? 0),
      hasRating: Number(row.has_rating ?? 0),
      hasSeries: Number(row.has_series ?? 0),
      hasIsbn: Number(row.has_isbn ?? 0),
    }))
    .filter((row) => Number.isInteger(row.libraryId) && row.libraryName.length > 0 && row.total > 0);
}

function catalogPageCountDistributionRows(result: unknown): PageCountDistributionItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      format: typeof row.format === 'string' ? row.format.trim() : '',
      count: Number(row.count ?? 0),
      min: Number(row.min),
      q1: Number(row.q1),
      median: Number(row.median),
      q3: Number(row.q3),
      max: Number(row.max),
    }))
    .filter((row) => row.format.length > 0 && Number.isFinite(row.min) && Number.isFinite(row.max));
}

function catalogLanguageCountRows(result: unknown): LanguageDistributionItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      language: typeof row.language === 'string' ? row.language.trim() : '',
      count: Number(row.count ?? 0),
    }))
    .filter((row) => row.language.length > 0);
}

function catalogBooksAddedRows(result: unknown): BooksAddedDataPoint[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      year: Number(row.year),
      month: Number(row.month),
      count: Number(row.count ?? 0),
    }))
    .filter((row) => Number.isInteger(row.year) && Number.isInteger(row.month));
}

function catalogAcquisitionLagRows(result: unknown): AcquisitionLagPoint[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      addedYear: Number(row.added_year),
      lagYears: Number(row.lag_years),
      count: Number(row.count ?? 0),
    }))
    .filter((row) => Number.isInteger(row.addedYear) && Number.isInteger(row.lagYears));
}

function catalogChordNodes(result: unknown): ChordDiagramData['nodes'] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({ name: typeof row.name === 'string' ? row.name.trim() : '' }))
    .filter((row) => row.name.length > 0);
}

function catalogChordLinks(result: unknown): ChordDiagramData['links'] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      source: typeof row.source === 'string' ? row.source.trim() : '',
      target: typeof row.target === 'string' ? row.target.trim() : '',
      value: Number(row.value ?? 0),
    }))
    .filter((row) => row.source.length > 0 && row.target.length > 0 && row.value > 0);
}

function catalogMetadataScoreDistributionRows(binsResult: unknown, unknownResult: unknown, percentilesResult: unknown): MetadataScoreDistribution {
  const percentileRow = ((percentilesResult as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0] ?? {};
  return {
    bins: ((binsResult as { rows?: Array<Record<string, unknown>> }).rows ?? [])
      .map((row) => ({
        minScore: Number(row.min_score),
        maxScore: Number(row.min_score) >= 90 ? 100 : Number(row.min_score) + 9,
        count: Number(row.count ?? 0),
      }))
      .filter((row) => Number.isInteger(row.minScore)),
    unknownCount: catalogCountRow(unknownResult),
    totalCount: Number(percentileRow.total_count ?? 0),
    percentile25: nullableNumber(percentileRow.percentile25),
    percentile50: nullableNumber(percentileRow.percentile50),
    percentile75: nullableNumber(percentileRow.percentile75),
    percentile90: nullableNumber(percentileRow.percentile90),
  };
}

function catalogMetadataFreshnessGaugeRow(result: unknown): Omit<MetadataFreshnessGauge, 'freshnessScore'> {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  return {
    totalBooks: Number(row?.total_books ?? 0),
    neverFetchedCount: Number(row?.never_fetched_count ?? 0),
    fresh30dCount: Number(row?.fresh_30d_count ?? 0),
    stale31To90dCount: Number(row?.stale_31_to_90d_count ?? 0),
    stale91To180dCount: Number(row?.stale_91_to_180d_count ?? 0),
    staleOver180dCount: Number(row?.stale_over_180d_count ?? 0),
  };
}

function catalogLibraryIntegrityGaugeRow(result: unknown): Omit<LibraryIntegrityGauge, 'integrityScore'> {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  return {
    totalBooks: Number(row?.total_books ?? 0),
    presentCount: Number(row?.present_count ?? 0),
    primaryFileCount: Number(row?.primary_file_count ?? 0),
    metadataCount: Number(row?.metadata_count ?? 0),
  };
}

function catalogStorageByFormatRows(result: unknown): StorageByFormatItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      format: typeof row.format === 'string' ? row.format : '',
      sizeBytes: Number(row.size_bytes ?? 0),
    }))
    .filter((row) => row.format.length > 0 && row.sizeBytes > 0);
}

function catalogPublicationDecadeRows(result: unknown): PublicationDecadeItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      decade: Number(row.decade),
      count: Number(row.count ?? 0),
    }))
    .filter((row) => Number.isInteger(row.decade));
}

function catalogPublicationYearRows(countsResult: unknown, titlesResult: unknown): PublicationYearPoint[] {
  const titlesByYear = new Map<number, string[]>();
  for (const row of (titlesResult as { rows?: Array<Record<string, unknown>> }).rows ?? []) {
    const year = Number(row.year);
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!Number.isInteger(year) || title.length === 0) continue;
    const titles = titlesByYear.get(year) ?? [];
    if (titles.length < 3) titles.push(title);
    titlesByYear.set(year, titles);
  }

  return ((countsResult as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => {
      const year = Number(row.year);
      return {
        year,
        count: Number(row.count ?? 0),
        topTitles: titlesByYear.get(year) ?? [],
      };
    })
    .filter((row) => Number.isInteger(row.year));
}

function catalogLargestBookRows(result: unknown): LargestBookItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      id: Number(row.id),
      title: typeof row.title === 'string' ? row.title : '',
      sizeBytes: Number(row.size_bytes ?? 0),
      format: typeof row.format === 'string' ? row.format : '',
    }))
    .filter((row) => Number.isInteger(row.id) && row.title.length > 0 && row.sizeBytes > 0 && row.format.length > 0);
}

function catalogGenreCountRows(result: unknown): GenreDistributionItem[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      genre: typeof row.genre === 'string' ? row.genre.trim() : '',
      count: Number(row.count ?? 0),
    }))
    .filter((row) => row.genre.length > 0);
}

function catalogCountRow(result: unknown): number {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  return Number(row?.count ?? 0);
}

function catalogUnknownCountRow(result: unknown): number {
  const [row] = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  return Number(row?.unknown_count ?? 0);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function catalogAuthorDisplayNameSql(value: SQL): SQL<string> {
  return sql<string>`case
    when position(',' in btrim(${value})) > 0
      and nullif(btrim(split_part(btrim(${value}), ',', 1)), '') is not null
      and nullif(btrim(split_part(btrim(${value}), ',', 2)), '') is not null
    then btrim(split_part(btrim(${value}), ',', 2)) || ' ' || btrim(split_part(btrim(${value}), ',', 1))
    else btrim(${value})
  end`;
}

function catalogAuthorCanonicalNameSql(value: SQL): SQL<string> {
  return sql<string>`lower(${catalogAuthorDisplayNameSql(value)})`;
}

function catalogAuthorSummaryRows(result: unknown): CatalogAuthorSummaryRow[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      id: Number(row.id ?? 0),
      name: typeof row.name === 'string' ? row.name.trim() : '',
      sortName: null,
      description: null,
      bookCount: Number(row.book_count ?? 0),
      lastAddedAt: typeof row.last_added_at === 'string' ? row.last_added_at : null,
    }))
    .filter((row) => row.id < 0 && row.name.length > 0);
}

function catalogSeriesSummaryRows(result: unknown): CatalogSeriesSummaryRow[] {
  return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])
    .map((row) => ({
      name: typeof row.name === 'string' ? row.name.trim() : '',
      bookCount: Number(row.book_count ?? 0),
      readCount: Number(row.read_count ?? 0),
      authors: Array.isArray(row.authors) ? row.authors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : [],
      coverBookIds: [],
      lastAddedAt: typeof row.last_added_at === 'string' ? row.last_added_at : null,
    }))
    .filter((row) => row.name.length > 0 && row.bookCount > 0);
}

function catalogAuthorSummaryOrder(sort: 'name' | 'sortName' | 'bookCount' | 'lastAddedAt' | 'lastEnrichedAt', order: 'asc' | 'desc'): SQL {
  const direction = order === 'desc' ? sql`desc` : sql`asc`;
  switch (sort) {
    case 'bookCount':
      return sql`book_count ${direction}, lower(name) asc, id asc`;
    case 'lastAddedAt':
      return sql`last_added_at ${direction} nulls last, lower(name) asc, id asc`;
    case 'sortName':
    case 'lastEnrichedAt':
    case 'name':
    default:
      return sql`lower(name) ${direction}, id asc`;
  }
}

function catalogSeriesSummaryOrder(sort: 'name' | 'bookCount' | 'lastAddedAt' | 'readProgress', order: 'asc' | 'desc'): SQL {
  const direction = order === 'desc' ? sql`desc` : sql`asc`;
  switch (sort) {
    case 'bookCount':
      return sql`book_count ${direction}, lower(name) asc`;
    case 'lastAddedAt':
      return sql`last_added_at ${direction} nulls last, lower(name) asc`;
    case 'readProgress':
      return sql`(read_count::numeric / nullif(book_count, 0)) ${direction} nulls last, lower(name) asc`;
    case 'name':
    default:
      return sql`lower(name) ${direction}`;
  }
}

function catalogSeriesCompletionWhere(status?: 'not_started' | 'in_progress' | 'complete'): SQL {
  switch (status) {
    case 'not_started':
      return sql`where read_count = 0`;
    case 'in_progress':
      return sql`where read_count > 0 and read_count < book_count`;
    case 'complete':
      return sql`where book_count > 0 and read_count = book_count`;
    default:
      return sql``;
  }
}

function buildUserItemScopeWhere(userId: number, mediaType: WarehouseMediaType, remoteId: string) {
  return and(
    eq(schema.warehouseUserItems.userId, userId),
    eq(schema.warehouseUserItems.mediaType, mediaType),
    eq(schema.warehouseUserItems.remoteId, remoteId),
  );
}

function buildUserCatalogJoin(userId: number) {
  return and(
    eq(schema.warehouseUserItems.userId, userId),
    eq(schema.warehouseUserItems.mediaType, schema.warehouseCatalogItems.mediaType),
    eq(schema.warehouseUserItems.remoteId, schema.warehouseCatalogItems.remoteId),
  )!;
}

function buildCatalogUserStateJoin(userId: number) {
  return and(
    eq(schema.warehouseUserState.userId, userId),
    eq(schema.warehouseUserState.mediaType, schema.warehouseCatalogItems.mediaType),
    eq(schema.warehouseUserState.remoteId, schema.warehouseCatalogItems.remoteId),
  )!;
}

function buildUserStateScopeWhere(userId: number, mediaType: WarehouseMediaType, remoteId: string) {
  return and(
    eq(schema.warehouseUserState.userId, userId),
    eq(schema.warehouseUserState.mediaType, mediaType),
    eq(schema.warehouseUserState.remoteId, remoteId),
  );
}

function buildUserCatalogStateRow(
  mediaType: WarehouseMediaType,
  remoteId: string,
  item: WarehouseUserItemRow | undefined,
  state: WarehouseUserStateRow | undefined,
): WarehouseUserCatalogStateRow {
  return {
    mediaType,
    remoteId,
    inLibrary: Boolean(item),
    favorite: state?.favorite ?? false,
    rating: state?.rating ?? null,
    readStatus: state?.readStatus ?? null,
    progressPercent: state?.progressPercent ?? null,
    positionSeconds: state?.positionSeconds ?? null,
    finishedAt: state?.finishedAt ?? null,
    updatedAt: newestDate(item?.updatedAt, state?.updatedAt),
  };
}

function normalizeWarehouseUserStatePatch(patch: WarehouseUserStatePatch): NormalizedWarehouseUserStatePatch {
  const stateValues: NormalizedWarehouseUserStatePatch = {};

  if (typeof patch.favorite === 'boolean') {
    stateValues.favorite = patch.favorite;
  }

  if (patch.readStatus !== undefined) {
    stateValues.readStatus = patch.readStatus;
    stateValues.finishedAt = isCompletedWarehouseReadStatus(patch.readStatus) ? new Date() : null;
  }

  const rating = normalizeNullableNumber(patch.rating, (value) => clampNumber(value, 1, 1, 5));
  if (rating !== undefined) {
    stateValues.rating = rating;
  }

  const progressPercent = normalizeNullableNumber(patch.progressPercent, (value) => clampFiniteNumber(value, 0, 100));
  if (progressPercent !== undefined) {
    stateValues.progressPercent = progressPercent;
  }

  const positionSeconds = normalizeNullableNumber(patch.positionSeconds, (value) => Math.max(value, 0));
  if (positionSeconds !== undefined) {
    stateValues.positionSeconds = positionSeconds;
  }

  return stateValues;
}

function isCompletedWarehouseReadStatus(status: WarehouseUserReadStatus | null | undefined): status is 'read' | 'skimmed' {
  return status === 'read' || status === 'skimmed';
}

function normalizeNullableNumber(value: number | null | undefined, normalize: (value: number) => number): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return normalize(value);
}

function clampFiniteNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function newestDate(...dates: Array<Date | null | undefined>) {
  return dates.reduce<Date | null>((latest, current) => {
    if (!current) {
      return latest;
    }

    if (!latest || current.getTime() > latest.getTime()) {
      return current;
    }

    return latest;
  }, null);
}

function clampPageLimit(page?: number, limit?: number) {
  return {
    page: clampNumber(page, DEFAULT_PAGE, DEFAULT_PAGE, Number.MAX_SAFE_INTEGER),
    limit: clampNumber(limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
  };
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value as number), min), max);
}

/** Matches one term against every searchable field of a catalogue row. */
function catalogTermMatches(pattern: string): SQL {
  return (
    or(
      ilike(schema.warehouseCatalogItems.title, pattern),
      catalogAuthorNameMatches(pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.narrators}::text, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.identifiers}::text, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.format}, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.language}, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.publisher}, '')`, pattern),
    ) ?? sql`false`
  );
}

/**
 * Every word in the query must appear somewhere in the row, rather than the whole query
 * having to appear as one contiguous substring.
 *
 * Searching "The Will of Many" used to return nothing when the title was "The Will of the
 * Many", because a single ILIKE %...% cannot bridge the missing word. Matching per word also
 * lets a query span fields, so "islington will many" finds the book by author plus title.
 * A quoted query is treated as one phrase, which keeps exact matching available.
 */
export function buildCatalogSearchWhere(term: string): SQL {
  const trimmed = term.trim();
  if (!trimmed) return sql`true`;

  const quoted = /^"(.+)"$/.exec(trimmed);
  if (quoted) return catalogTermMatches(`%${quoted[1]}%`);

  const words = trimmed.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS);
  if (words.length <= 1) return catalogTermMatches(`%${trimmed}%`);

  return and(...words.map((word) => catalogTermMatches(`%${word}%`))) ?? sql`false`;
}

function buildCatalogContentFilterClauses(contentFilters?: ContentFilterRules): SQL[] {
  if (!contentFilters || isContentFilterEmpty(contentFilters)) {
    return [];
  }

  const clauses: SQL[] = [];
  const includeTagClause = contentFilters.includeTagIds.length > 0 ? catalogTagNameExists(contentFilters.includeTagIds) : null;
  const includeGenreClause = contentFilters.includeGenreIds.length > 0 ? catalogGenreNameExists(contentFilters.includeGenreIds) : null;

  if (includeTagClause && includeGenreClause) {
    clauses.push(or(includeTagClause, includeGenreClause)!);
  } else if (includeTagClause) {
    clauses.push(includeTagClause);
  } else if (includeGenreClause) {
    clauses.push(includeGenreClause);
  }

  if (contentFilters.excludeTagIds.length > 0) {
    clauses.push(
      sql`not exists (select 1 from ${schema.tags} where ${inArray(schema.tags.id, contentFilters.excludeTagIds)} and ${schema.warehouseCatalogItems.tags} ? ${schema.tags.name})`,
    );
  }

  if (contentFilters.excludeGenreIds.length > 0) {
    clauses.push(
      sql`not exists (select 1 from ${schema.genres} where ${inArray(schema.genres.id, contentFilters.excludeGenreIds)} and ${schema.warehouseCatalogItems.genres} ? ${schema.genres.name})`,
    );
  }

  return clauses;
}

function catalogTagNameExists(tagIds: number[]): SQL {
  return sql`exists (select 1 from ${schema.tags} where ${inArray(schema.tags.id, tagIds)} and ${schema.warehouseCatalogItems.tags} ? ${schema.tags.name})`;
}

function catalogGenreNameExists(genreIds: number[]): SQL {
  return sql`exists (select 1 from ${schema.genres} where ${inArray(schema.genres.id, genreIds)} and ${schema.warehouseCatalogItems.genres} ? ${schema.genres.name})`;
}

function buildCatalogSmartScopeWhere(filter: GroupRule, userId: number): SQL | null {
  const clauses: SQL[] = [];

  for (const rule of filter.rules) {
    const clause = rule.type === 'group' ? buildCatalogSmartScopeWhere(rule, userId) : buildCatalogRuleWhere(rule, userId);
    if (!clause) {
      if (filter.join === 'AND') return null;
      continue;
    }
    clauses.push(clause);
  }

  if (clauses.length === 0) return filter.join === 'OR' ? null : sql`true`;
  return (filter.join === 'OR' ? or(...clauses) : and(...clauses)) ?? null;
}

function buildCatalogRuleWhere(rule: Rule, userId: number): SQL | null {
  switch (rule.field) {
    case 'title':
      return buildCatalogTextRule(schema.warehouseCatalogItems.title, rule);
    case 'publisher':
      return buildCatalogNullableTextRule(schema.warehouseCatalogItems.publisher, rule);
    case 'series':
      return buildCatalogNullableTextRule(schema.warehouseCatalogItems.series, rule);
    case 'language':
      return buildCatalogNullableTextRule(schema.warehouseCatalogItems.language, rule);
    case 'format':
      return buildCatalogScalarSetRule(schema.warehouseCatalogItems.format, rule);
    case 'author':
      return buildCatalogAuthorExactRule(rule);
    case 'genre':
      return buildCatalogJsonArrayExactRule(schema.warehouseCatalogItems.genres, rule);
    case 'tag':
      return buildCatalogJsonArrayExactRule(schema.warehouseCatalogItems.tags, rule);
    case 'collection':
      return buildCatalogCollectionRule(userId, rule);
    case 'cover':
      if (rule.operator === 'isPresent') return eq(schema.warehouseCatalogItems.hasCover, true);
      if (rule.operator === 'isMissing') return eq(schema.warehouseCatalogItems.hasCover, false);
      return null;
    case 'readStatus':
      return buildCatalogReadStatusRule(rule);
    case 'rating':
      return buildCatalogRatingRule(rule);
    case 'readProgress':
      return buildCatalogReadProgressRule(rule);
    case 'publishedYear':
      return buildCatalogNumericRule(catalogPublishedYearExpression(), rule);
    case 'pageCount':
      return buildCatalogNumericRule(catalogPageCountExpression(), rule);
    case 'metadataScore':
      return buildCatalogNumericRule(catalogMetadataScoreExpression(), rule);
    case 'isbn':
      return buildCatalogIsbnRule(rule);
    default:
      return null;
  }
}

function buildCatalogCollectionRule(userId: number, rule: Rule): SQL | null {
  const names = normalizeRuleStringArray(rule.value);
  const namedMembershipExists = (values: string[]) => sql`exists (
    select 1
    from ${schema.collectionCatalogItems}
    inner join ${schema.collections}
      on ${schema.collections.id} = ${schema.collectionCatalogItems.collectionId}
    where ${schema.collections.userId} = ${userId}
      and ${schema.collectionCatalogItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
      and ${schema.collectionCatalogItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      and ${inArray(schema.collections.name, values)}
  )`;
  const anyMembershipExists = sql`exists (
    select 1
    from ${schema.collectionCatalogItems}
    inner join ${schema.collections}
      on ${schema.collections.id} = ${schema.collectionCatalogItems.collectionId}
    where ${schema.collections.userId} = ${userId}
      and ${schema.collectionCatalogItems.mediaType} = ${schema.warehouseCatalogItems.mediaType}
      and ${schema.collectionCatalogItems.remoteId} = ${schema.warehouseCatalogItems.remoteId}
  )`;

  switch (rule.operator) {
    case 'includesAny':
      if (names.length === 0) return sql`false`;
      return namedMembershipExists(names);
    case 'excludesAll':
      if (names.length === 0) return sql`true`;
      return not(namedMembershipExists(names));
    case 'isEmpty':
      return not(anyMembershipExists);
    case 'isNotEmpty':
      return anyMembershipExists;
    default:
      return null;
  }
}

function buildCatalogNumericRule(column: SQLWrapper, rule: Rule): SQL | null {
  const value = normalizeRuleNumber(rule.value);
  const valueTo = normalizeRuleNumber(rule.valueTo);

  switch (rule.operator) {
    case 'eq':
      return value === null ? null : sql`${column} = ${value}`;
    case 'notEq':
      return value === null ? null : sql`${column} <> ${value}`;
    case 'gt':
      return value === null ? null : gt(column, value);
    case 'gte':
      return value === null ? null : gte(column, value);
    case 'lt':
      return value === null ? null : lt(column, value);
    case 'lte':
      return value === null ? null : lte(column, value);
    case 'between':
      return value === null || valueTo === null ? null : (and(gte(column, value), lte(column, valueTo)) ?? null);
    case 'isEmpty':
      return isNull(column);
    case 'isNotEmpty':
      return isNotNull(column);
    default:
      return null;
  }
}

function buildCatalogReadProgressRule(rule: Rule): SQL | null {
  const progress = schema.warehouseUserState.progressPercent;

  switch (rule.operator) {
    case 'isUnread':
      return or(isNull(progress), lte(progress, 0)) ?? null;
    case 'isInProgress':
      return and(gt(progress, 0), lt(progress, 100)) ?? null;
    case 'isFinished':
      return gte(progress, 100);
    default:
      return null;
  }
}

function buildCatalogRatingRule(rule: Rule): SQL | null {
  const rating = schema.warehouseUserState.rating;
  const value = normalizeRuleNumber(rule.value);

  switch (rule.operator) {
    case 'eq':
      return value === null ? null : eq(rating, value);
    case 'gt':
      return value === null ? null : gt(rating, value);
    case 'gte':
      return value === null ? null : gte(rating, value);
    case 'lt':
      return value === null ? null : lt(rating, value);
    case 'lte':
      return value === null ? null : lte(rating, value);
    case 'isEmpty':
      return isNull(rating);
    case 'isNotEmpty':
      return isNotNull(rating);
    default:
      return null;
  }
}

function buildCatalogReadStatusRule(rule: Rule): SQL | null {
  const values = normalizeRuleStringArray(rule.value) as WarehouseUserReadStatus[];

  switch (rule.operator) {
    case 'includesAny':
      if (values.length === 0) return sql`false`;
      return inArray(schema.warehouseUserState.readStatus, values);
    case 'excludesAll':
      if (values.length === 0) return sql`true`;
      return or(isNull(schema.warehouseUserState.readStatus), not(inArray(schema.warehouseUserState.readStatus, values))) ?? null;
    case 'isEmpty':
      return isNull(schema.warehouseUserState.readStatus);
    case 'isNotEmpty':
      return isNotNull(schema.warehouseUserState.readStatus);
    default:
      return null;
  }
}

function buildCatalogUserItemsOrder(sort: SortSpec[] | undefined) {
  const firstSort = sort?.[0];
  const direction = firstSort?.dir === 'desc' ? desc : asc;
  const stableTitleOrder = sql`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title}) asc`;
  const stableRemoteOrder = sql`${schema.warehouseCatalogItems.remoteId} asc`;

  switch (firstSort?.field) {
    case 'author':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.authors}->>0, '')`);
    case 'series':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`);
    case 'addedAt':
      return direction(catalogLibraryAddedAtExpression());
    case 'publishedYear':
      return sql`${orderNullableColumn(catalogPublishedYearExpression(), firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'pageCount':
      return sql`${orderNullableColumn(catalogPageCountExpression(), firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'seriesIndex':
      return sql`${orderNullableColumn(schema.warehouseCatalogItems.seriesIndex, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'updatedAt':
      return sql`${orderNullableColumn(schema.warehouseCatalogItems.updatedAt, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'fileSize':
      return sql`${orderNullableColumn(catalogFileSizeExpression(), firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'metadataScore':
      return sql`${orderNullableColumn(catalogMetadataScoreExpression(), firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'publisher':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.publisher}, '')`);
    case 'rating':
      return sql`${orderNullableColumn(schema.warehouseUserState.rating, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'readProgress':
      return sql`${orderNullableColumn(schema.warehouseUserState.progressPercent, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'readStatus':
      return sql`${orderNullableColumn(schema.warehouseUserState.readStatus, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'lastReadAt':
      return sql`${orderNullableColumn(schema.warehouseUserState.updatedAt, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'finishedAt':
      return sql`${orderNullableColumn(schema.warehouseUserState.finishedAt, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'language':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.language}, '')`);
    case 'format':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.format}, '')`);
    case 'title':
    default:
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`);
  }
}

function catalogJumpBucketLetterExpr(column: SQL): SQL {
  return sql`
    CASE
      WHEN btrim(COALESCE(${column}, '')) = '' THEN NULL
      WHEN upper(substr(btrim(COALESCE(${column}, '')), 1, 1)) ~ '^[A-Z]$'
        THEN upper(substr(btrim(COALESCE(${column}, '')), 1, 1))
      ELSE '#'
    END`;
}

function buildCatalogJumpBucketExpr(field: SortField): SQL | null {
  switch (field) {
    case 'title':
      return catalogJumpBucketLetterExpr(sql`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`);
    case 'author':
      return catalogJumpBucketLetterExpr(sql`${schema.warehouseCatalogItems.authors}->>0`);
    case 'publishedYear':
      return sql`${catalogPublishedYearExpression()}::text`;
    default:
      return null;
  }
}

function mapCatalogJumpBucketRows(rows: JumpBucketRawRow[], kind: JumpBucketKind = 'letter'): JumpBucketsResponse {
  return {
    buckets: rows.map((row) => ({
      key: row.bucket ?? '',
      label: row.bucket ?? '',
      index: Number(row.item_index),
    })),
    total: rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0,
    kind,
    granularity: null,
  };
}

function orderNullableColumn(column: SQLWrapper, dir: SortSpec['dir'] = 'asc') {
  return dir === 'desc' ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
}

function catalogLibraryAddedAtExpression() {
  return sql<Date>`coalesce(${schema.warehouseUserItems.addedAt}, ${schema.warehouseCatalogItems.syncedAt}, ${schema.warehouseCatalogItems.createdAt})`;
}

function catalogPublishedYearExpression() {
  const rawPayload = schema.warehouseCatalogItems.rawPayload;
  // Stored column first (migration 0050). COALESCE is lazy, so the eight jsonb
  // extractions and two regex tests below only run for rows synced before the
  // column existed. This was the last statistics endpoint still slow.
  return sql<number | null>`coalesce(${schema.warehouseCatalogItems.publishedYear}, case
    when coalesce(
      ${rawPayload}->>'publishedYear',
      ${rawPayload}->>'published_year',
      ${rawPayload}->>'publicationYear',
      ${rawPayload}->>'publication_year'
    ) ~ '^[0-9]{4}$'
      then coalesce(
        ${rawPayload}->>'publishedYear',
        ${rawPayload}->>'published_year',
        ${rawPayload}->>'publicationYear',
        ${rawPayload}->>'publication_year'
      )::int
    when coalesce(
      ${rawPayload}->>'publishedDate',
      ${rawPayload}->>'published_date',
      ${rawPayload}->>'releaseDate',
      ${rawPayload}->>'release_date'
    ) ~ '^[0-9]{4}'
      then substring(coalesce(
        ${rawPayload}->>'publishedDate',
        ${rawPayload}->>'published_date',
        ${rawPayload}->>'releaseDate',
        ${rawPayload}->>'release_date'
      ) from 1 for 4)::int
    else null
  end)`;
}

function catalogPageCountExpression() {
  const rawPayload = schema.warehouseCatalogItems.rawPayload;
  return sql<number | null>`case
    when ${schema.warehouseCatalogItems.mediaType} = 'ebook'
      and coalesce(
        ${rawPayload}->>'pageCount',
        ${rawPayload}->>'page_count',
        ${rawPayload}->>'pages'
      ) ~ '^[0-9]+$'
      then coalesce(
        ${rawPayload}->>'pageCount',
        ${rawPayload}->>'page_count',
        ${rawPayload}->>'pages'
      )::int
    when ${schema.warehouseCatalogItems.mediaType} = 'audiobook'
      and coalesce(${schema.warehouseCatalogItems.durationSeconds}, 0) > 0
      then round((${schema.warehouseCatalogItems.durationSeconds}::numeric / 3600) * ${AUDIOBOOK_VIRTUAL_PAGES_PER_HOUR})::int
    else null
      end`;
}

/**
 * The item's size, from the stored column first.
 *
 * file_size_bytes is materialised at sync time (migration 0048). The payload
 * derivations stay as a fallback for rows synced before it existed, but they
 * are the expensive part: for audiobooks the second and third arms expand
 * jsonb_array_elements(raw_payload->'files') per row, which is what pushed
 * storage-by-format, largest-books, metadata-score-distribution and
 * publication-year-timeline past the 30s statement_timeout.
 *
 * COALESCE is lazy, so once the column is populated the laterals are never
 * evaluated — which is the whole point. No index can substitute: Postgres
 * cannot index an expression containing a subquery.
 */
function catalogFileSizeExpression() {
  return sql<number | null>`coalesce(
    ${schema.warehouseCatalogItems.fileSizeBytes},
    ${catalogPayloadFileSizeExpression(schema.warehouseCatalogItems.rawPayload)},
    ${catalogPayloadFileSizeExpression(schema.warehouseCatalogDetails.rawPayload)}
  )`;
}

function catalogMetadataScoreExpression() {
  const item = schema.warehouseCatalogItems;
  const earned = sql<number>`(
    ${catalogWeightedPresence(10, catalogTextIsPresent(item.title))} +
    ${catalogWeightedPresence(10, catalogJsonArrayIsPresent(item.authors))} +
    ${catalogWeightedPresence(10, sql`${item.hasCover} = true`)} +
    ${catalogWeightedPresence(8, catalogTextIsPresent(catalogPayloadTextExpression('description', 'summary', 'overview')))} +
    ${catalogWeightedPresence(6, catalogJsonArrayIsPresent(item.genres))} +
    ${catalogWeightedPresence(7, catalogTextIsPresent(catalogIdentifierTextExpression('isbn13', 'isbn_13')))} +
    ${catalogWeightedPresence(4, catalogTextIsPresent(item.publisher))} +
    ${catalogWeightedPresence(4, sql`${catalogPublishedYearExpression()} is not null`)} +
    ${catalogWeightedPresence(4, catalogTextIsPresent(item.language))} +
    ${catalogWeightedPresence(2, catalogTextIsPresent(catalogIdentifierTextExpression('isbn10', 'isbn_10')))} +
    ${catalogWeightedPresence(2, sql`${catalogPageCountExpression()} is not null`)} +
    ${catalogWeightedPresence(1, catalogPositiveNumberIsPresent(catalogPayloadTextExpression('rating', 'averageRating', 'average_rating')))} +
    ${catalogWeightedPresence(2, catalogJsonArrayIsPresent(item.tags))} +
    ${catalogWeightedPresence(1, catalogTextIsPresent(catalogIdentifierTextExpression('googleBooksId', 'google_books_id', 'googleBooks', 'google_books')))} +
    ${catalogWeightedPresence(1, catalogTextIsPresent(catalogIdentifierTextExpression('goodreadsId', 'goodreads_id')))} +
    ${catalogWeightedPresence(1, catalogTextIsPresent(catalogIdentifierTextExpression('amazonId', 'amazon_id', 'asin')))} +
    ${catalogWeightedPresence(1, catalogTextIsPresent(catalogIdentifierTextExpression('hardcoverId', 'hardcover_id')))} +
    ${catalogWeightedPresence(1, catalogTextIsPresent(catalogIdentifierTextExpression('openLibraryId', 'open_library_id', 'openLibrary', 'open_library')))} +
    ${catalogWeightedPresence(1, catalogTextIsPresent(catalogIdentifierTextExpression('itunesId', 'itunes_id', 'itunes')))}
  )`;

  // The stored column first: recomputing these 19 terms for ~348,000 rows and
  // then sorting them four times for percentile_cont exceeded the 30s
  // statement_timeout on every request, even with the catalogue fully cached.
  // COALESCE is lazy, so the expression below is only evaluated for rows synced
  // before the column existed.
  return sql<number>`coalesce(
    ${schema.warehouseCatalogItems.metadataScore},
    floor((${earned}::numeric / 76) * 100)::int
  )`;
}

function catalogWeightedPresence(weight: number, condition: SQLWrapper) {
  return sql<number>`case when ${condition} then ${weight} else 0 end`;
}

function catalogTextIsPresent(value: SQLWrapper) {
  return sql<boolean>`nullif(trim(${value}), '') is not null`;
}

function catalogPositiveNumberIsPresent(value: SQLWrapper) {
  return sql<boolean>`case when ${value} ~ '^[0-9]+(\\.[0-9]+)?$' then ${value}::double precision > 0 else false end`;
}

function catalogJsonArrayIsPresent(value: SQLWrapper) {
  return sql<boolean>`jsonb_typeof(${value}) = 'array' and jsonb_array_length(${value}) > 0`;
}

function catalogPayloadTextExpression(...keys: string[]) {
  const itemRawPayload = schema.warehouseCatalogItems.rawPayload;
  const detailRawPayload = schema.warehouseCatalogDetails.rawPayload;
  const itemValues = keys.map((key) => sql<string | null>`${itemRawPayload}->>${key}`);
  const detailValues = keys.map((key) => sql<string | null>`${detailRawPayload}->>${key}`);
  return sql<string | null>`coalesce(${sql.join([...itemValues, ...detailValues], sql`, `)})`;
}

function catalogIdentifierTextExpression(...keys: string[]) {
  const identifiers = schema.warehouseCatalogItems.identifiers;
  const rawPayloadValue = catalogPayloadTextExpression(...keys);
  const identifierValues = keys.map((key) => sql<string | null>`${identifiers}->>${key}`);
  return sql<string | null>`coalesce(${sql.join([...identifierValues, rawPayloadValue], sql`, `)})`;
}

function catalogIdentifierNonBlankTextExpressions(...keys: string[]) {
  const identifiers = schema.warehouseCatalogItems.identifiers;
  const itemRawPayload = schema.warehouseCatalogItems.rawPayload;
  const detailRawPayload = schema.warehouseCatalogDetails.rawPayload;
  const identifierValues = keys.map((key) => sql<string | null>`nullif(trim(${identifiers}->>${key}), '')`);
  const itemValues = keys.map((key) => sql<string | null>`nullif(trim(${itemRawPayload}->>${key}), '')`);
  const detailValues = keys.map((key) => sql<string | null>`nullif(trim(${detailRawPayload}->>${key}), '')`);
  return [...identifierValues, ...itemValues, ...detailValues];
}

function catalogPayloadFileSizeExpression(rawPayload: SQLWrapper) {
  const topLevelSize = sql<string | null>`coalesce(
    ${rawPayload}->>'fileSizeBytes',
    ${rawPayload}->>'file_size_bytes',
    ${rawPayload}->>'sizeBytes',
    ${rawPayload}->>'size_bytes',
    ${rawPayload}->>'fileSize',
    ${rawPayload}->>'file_size',
    ${rawPayload}->>'bytes',
    ${rawPayload}->>'size'
  )`;
  return sql<number | null>`case
      when ${topLevelSize} ~ '^[0-9]+$'
        then ${topLevelSize}::double precision
      else (
        select coalesce(
          file_item.value->>'fileSizeBytes',
          file_item.value->>'file_size_bytes',
          file_item.value->>'sizeBytes',
          file_item.value->>'size_bytes',
          file_item.value->>'fileSize',
          file_item.value->>'file_size',
          file_item.value->>'bytes',
          file_item.value->>'size'
        )::double precision
        from jsonb_array_elements(
          case
            when jsonb_typeof(${rawPayload}->'files') = 'array' then ${rawPayload}->'files'
            else '[]'::jsonb
          end
        ) with ordinality as file_item(value, ordinal)
        where coalesce(
          file_item.value->>'fileSizeBytes',
          file_item.value->>'file_size_bytes',
          file_item.value->>'sizeBytes',
          file_item.value->>'size_bytes',
          file_item.value->>'fileSize',
          file_item.value->>'file_size',
          file_item.value->>'bytes',
          file_item.value->>'size'
        ) ~ '^[0-9]+$'
        order by file_item.ordinal asc
        limit 1
      )
    end`;
}

function buildCatalogTextRule(column: IlikeExpression, rule: Rule): SQL | null {
  const value = normalizeRuleString(rule.value);
  if (rule.operator === 'isNotEmpty') return sql`${column} is not null and ${column} <> ''`;
  if (rule.operator === 'isEmpty') return sql`${column} is null or ${column} = ''`;
  if (!value) return null;

  const escapedValue = escapeLikePattern(value);
  if (rule.operator === 'contains') return ilike(column, `%${escapedValue}%`);
  if (rule.operator === 'notContains') return or(isNull(column), not(ilike(column, `%${escapedValue}%`))) ?? null;
  if (rule.operator === 'startsWith') return ilike(column, `${escapedValue}%`);
  if (rule.operator === 'endsWith') return ilike(column, `%${escapedValue}`);
  if (rule.operator === 'eq') return ilike(column, escapedValue);
  if (rule.operator === 'notEq') return or(isNull(column), not(ilike(column, escapedValue))) ?? null;
  return null;
}

function buildCatalogNullableTextRule(column: SQLWrapper, rule: Rule): SQL | null {
  const scalarSetRule = buildCatalogNullableTextSetRule(column, rule);
  if (scalarSetRule) return scalarSetRule;
  return buildCatalogTextRule(sql<string>`coalesce(${column}, '')`, rule);
}

function buildCatalogNullableTextSetRule(column: SQLWrapper, rule: Rule): SQL | null {
  const values = normalizeRuleStringArray(rule.value);

  if (rule.operator === 'includesAny') {
    if (values.length === 0) return sql`false`;
    return inArray(sql<string>`${column}`, values);
  }

  if (rule.operator === 'excludesAll') {
    if (values.length === 0) return sql`true`;
    return or(isNull(column), not(inArray(sql<string>`${column}`, values))) ?? null;
  }

  return null;
}

function buildCatalogScalarSetRule(column: typeof schema.warehouseCatalogItems.format, rule: Rule): SQL | null {
  const values = normalizeRuleStringArray(rule.value);

  if (rule.operator === 'includesAny') {
    if (values.length === 0) return sql`false`;
    return inArray(column, values);
  }

  if (rule.operator === 'excludesAll') {
    if (values.length === 0) return sql`true`;
    return or(isNull(column), not(inArray(column, values))) ?? null;
  }

  return null;
}

function buildCatalogIsbnRule(rule: Rule): SQL | null {
  const isbnCandidates = [
    ...catalogIdentifierNonBlankTextExpressions('isbn13', 'isbn_13', 'isbn'),
    ...catalogIdentifierNonBlankTextExpressions('isbn10', 'isbn_10', 'isbn'),
  ];

  switch (rule.operator) {
    case 'eq': {
      const value = normalizeRuleString(rule.value);
      return value ? (or(...isbnCandidates.map((candidate) => eq(candidate, value))) ?? null) : null;
    }
    case 'isEmpty':
      return and(...isbnCandidates.map((candidate) => isNull(candidate))) ?? null;
    case 'isNotEmpty':
      return or(...isbnCandidates.map((candidate) => isNotNull(candidate))) ?? null;
    default:
      return null;
  }
}

function buildCatalogJsonArrayExactRule(column: SQLWrapper, rule: Rule): SQL | null {
  if (rule.operator === 'isNotEmpty') return sql`jsonb_array_length(${column}) > 0`;
  if (rule.operator === 'isEmpty') return sql`jsonb_array_length(${column}) = 0`;

  const values = normalizeRuleStringArray(rule.value);
  if (values.length === 0) {
    if (rule.operator === 'excludesAll') return sql`true`;
    return null;
  }

  const existsValue = (value: string) =>
    sql`exists (
      select 1
      from jsonb_array_elements_text(${column}) as catalog_value(value)
      where catalog_value.value = ${value}
    )`;
  const clauses = values.map(existsValue);
  if (rule.operator === 'includesAny') return or(...clauses) ?? null;
  if (rule.operator === 'includesAll') return and(...clauses) ?? null;
  if (rule.operator === 'excludesAll') return not(or(...clauses) ?? sql`false`);
  return null;
}

function buildCatalogAuthorExactRule(rule: Rule): SQL | null {
  if (rule.operator === 'isNotEmpty') return sql`jsonb_array_length(${schema.warehouseCatalogItems.authors}) > 0`;
  if (rule.operator === 'isEmpty') return sql`jsonb_array_length(${schema.warehouseCatalogItems.authors}) = 0`;

  const values = normalizeRuleStringArray(rule.value);
  if (values.length === 0) {
    if (rule.operator === 'excludesAll') return sql`true`;
    return null;
  }

  const existsValue = (value: string) =>
    sql`exists (
      select 1
      from jsonb_array_elements_text(${schema.warehouseCatalogItems.authors}) as catalog_value(value)
      where catalog_value.value = ${value}
         or ${catalogAuthorCanonicalNameSql(sql`catalog_value.value`)} = ${catalogAuthorCanonicalNameSql(sql`${value}`)}
    )`;
  const clauses = values.map(existsValue);
  if (rule.operator === 'includesAny') return or(...clauses) ?? null;
  if (rule.operator === 'includesAll') return and(...clauses) ?? null;
  if (rule.operator === 'excludesAll') return not(or(...clauses) ?? sql`false`);
  return null;
}

function normalizeRuleString(value: Rule['value']): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeRuleStringArray(value: Rule['value']): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? String(item) : typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }

  const single = normalizeRuleString(value);
  return single ? [single] : [];
}

function normalizeRuleNumber(value: Rule['value']): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function buildEbookCatalogWhere(query: WarehouseEbookCatalogQuery): SQL {
  const clauses: SQL[] = [eq(schema.warehouseCatalogItems.mediaType, 'ebook')];
  const trimmedQuery = query.q?.trim();

  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;

    clauses.push(
      or(
        ilike(schema.warehouseCatalogItems.title, pattern),
        catalogAuthorNameMatches(pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.identifiers}::text, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.format}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.language}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.publisher}, '')`, pattern),
      )!,
    );
  }

  pushIfPresent(clauses, catalogAuthorTextFilter(query.author));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.series, query.series));
  pushIfPresent(clauses, jsonbTextFilter(schema.warehouseCatalogItems.genres, query.genre));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.language, query.language));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.format, query.format));

  if (typeof query.hasCover === 'boolean') {
    clauses.push(eq(schema.warehouseCatalogItems.hasCover, query.hasCover));
  }

  return clauses.length === 1 ? clauses[0]! : and(...clauses)!;
}

function buildEbookCatalogOrder(sort?: WarehouseEbookCatalogQuery['sort'], order?: WarehouseEbookCatalogQuery['order']) {
  const direction = order === 'asc' ? asc : desc;

  switch (sort) {
    case 'author':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.authors}->>0, '')`);
    case 'series':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`);
    case 'syncedAt':
      return direction(schema.warehouseCatalogItems.syncedAt);
    case 'addedAt':
      return direction(schema.warehouseCatalogItems.createdAt);
    case 'title':
    default:
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`);
  }
}

function buildComicCatalogWhere(query: WarehouseComicCatalogQuery): SQL {
  const clauses: SQL[] = [eq(schema.warehouseCatalogItems.mediaType, 'comic')];
  const trimmedQuery = query.q?.trim();

  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;

    clauses.push(
      or(
        ilike(schema.warehouseCatalogItems.title, pattern),
        catalogAuthorNameMatches(pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.identifiers}::text, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.format}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.language}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.publisher}, '')`, pattern),
      )!,
    );
  }

  pushIfPresent(clauses, catalogAuthorTextFilter(query.author));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.series, query.series));
  pushIfPresent(clauses, jsonbTextFilter(schema.warehouseCatalogItems.genres, query.genre));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.language, query.language));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.format, query.format));

  if (typeof query.hasCover === 'boolean') {
    clauses.push(eq(schema.warehouseCatalogItems.hasCover, query.hasCover));
  }

  return clauses.length === 1 ? clauses[0]! : and(...clauses)!;
}

function buildAudiobookCatalogWhere(query: WarehouseAudiobookCatalogQuery): SQL {
  const clauses: SQL[] = [eq(schema.warehouseCatalogItems.mediaType, 'audiobook')];
  const trimmedQuery = query.q?.trim();

  if (trimmedQuery) {
    const pattern = `%${trimmedQuery}%`;

    clauses.push(
      or(
        ilike(schema.warehouseCatalogItems.title, pattern),
        catalogAuthorNameMatches(pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.narrators}::text, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.identifiers}::text, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.format}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.language}, '')`, pattern),
        ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.publisher}, '')`, pattern),
      )!,
    );
  }

  pushIfPresent(clauses, catalogAuthorTextFilter(query.author));
  pushIfPresent(clauses, jsonbTextFilter(schema.warehouseCatalogItems.narrators, query.narrator));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.series, query.series));
  pushIfPresent(clauses, jsonbTextFilter(schema.warehouseCatalogItems.genres, query.genre));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.language, query.language));
  pushIfPresent(clauses, textFilter(schema.warehouseCatalogItems.format, query.format));

  if (typeof query.hasCover === 'boolean') {
    clauses.push(eq(schema.warehouseCatalogItems.hasCover, query.hasCover));
  }

  return clauses.length === 1 ? clauses[0]! : and(...clauses)!;
}

function buildAudiobookCatalogOrder(sort?: WarehouseAudiobookCatalogQuery['sort'], order?: WarehouseAudiobookCatalogQuery['order']) {
  const direction = order === 'asc' ? asc : desc;

  switch (sort) {
    case 'author':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.authors}->>0, '')`);
    case 'narrator':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.narrators}->>0, '')`);
    case 'series':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`);
    case 'duration':
      return direction(schema.warehouseCatalogItems.durationSeconds);
    case 'syncedAt':
      return direction(schema.warehouseCatalogItems.syncedAt);
    case 'addedAt':
      return direction(schema.warehouseCatalogItems.createdAt);
    case 'title':
    default:
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`);
  }
}

function catalogSeriesItemsOrder(sort: 'seriesIndex' | 'title' | 'addedAt', order: 'asc' | 'desc') {
  const direction = order === 'asc' ? asc : desc;

  switch (sort) {
    case 'addedAt':
      return direction(catalogLibraryAddedAtExpression());
    case 'seriesIndex':
      return direction(sql<number>`coalesce(${schema.warehouseCatalogItems.seriesIndex}, ${order === 'asc' ? Number.MAX_SAFE_INTEGER : -1})`);
    case 'title':
    default:
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`);
  }
}

function catalogAuthorItemsOrder(sort: 'title' | 'publishedYear' | 'addedAt', order: 'asc' | 'desc') {
  const direction = order === 'asc' ? asc : desc;

  switch (sort) {
    case 'addedAt':
      return direction(catalogLibraryAddedAtExpression());
    case 'publishedYear':
    case 'title':
    default:
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`);
  }
}

function textFilter(column: SQLWrapper, value?: string) {
  const trimmed = value?.trim();
  return trimmed ? ilike(sql<string>`coalesce(${column}, '')`, `%${trimmed}%`) : undefined;
}

function catalogAuthorTextFilter(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? catalogAuthorNameMatches(`%${trimmed}%`) : undefined;
}

function catalogAuthorNameMatches(pattern: string): SQL {
  return sql`exists (
    select 1
    from ${schema.warehouseCatalogItemAuthors}
    where ${schema.warehouseCatalogItemAuthors.mediaType} = ${schema.warehouseCatalogItems.mediaType}
      and ${schema.warehouseCatalogItemAuthors.remoteId} = ${schema.warehouseCatalogItems.remoteId}
      and ${schema.warehouseCatalogItemAuthors.name} ilike ${pattern}
  )`;
}

function jsonbTextFilter(column: SQLWrapper, value?: string) {
  const trimmed = value?.trim();
  return trimmed ? ilike(sql<string>`coalesce(${column}::text, '')`, `%${trimmed}%`) : undefined;
}

function pushIfPresent(clauses: SQL[], clause: SQL | undefined) {
  if (clause) {
    clauses.push(clause);
  }
}

function normalizeRequestMirrorInsert(data: RequestMirrorCreate): NewWarehouseRequestRow {
  return {
    ...data,
    mediaType: data.mediaType ?? 'ebook',
    upstreamRequestId: normalizeNullableText(data.upstreamRequestId),
    status: normalizeWarehouseRequestStatus(data.status),
    author: data.author ?? null,
    isbn: data.isbn ?? null,
    requestedPayload: sanitizeRequestPayload(data.requestedPayload),
    completedRemoteId: data.completedRemoteId ?? null,
    lastStatusSyncedAt: data.lastStatusSyncedAt ?? null,
  };
}

function catalogItemAuthorRows(items: Array<Omit<NewWarehouseCatalogItemRow, 'id' | 'createdAt' | 'updatedAt'>>): NewWarehouseCatalogItemAuthorRow[] {
  return items.flatMap((item) =>
    catalogAuthorRefs(item.authors).map((author, index) => ({
      mediaType: item.mediaType,
      remoteId: item.remoteId,
      authorId: author.id,
      name: author.name,
      canonicalName: author.name.trim().toLowerCase(),
      sortOrder: index,
    })),
  );
}

function normalizeRequestMirrorUpdate(data: RequestMirrorUpdate): Partial<NewWarehouseRequestRow> {
  const update: Partial<NewWarehouseRequestRow> = {};

  if (data.mediaType !== undefined) {
    update.mediaType = data.mediaType;
  }

  if (data.upstreamRequestId !== undefined) {
    update.upstreamRequestId = normalizeNullableText(data.upstreamRequestId);
  }

  if (data.status !== undefined) {
    update.status = normalizeWarehouseRequestStatus(data.status);
  }

  if (data.title !== undefined) {
    update.title = data.title;
  }

  if (data.author !== undefined) {
    update.author = data.author;
  }

  if (data.isbn !== undefined) {
    update.isbn = data.isbn;
  }

  if (data.requestedPayload !== undefined) {
    update.requestedPayload = sanitizeRequestPayload(data.requestedPayload);
  }

  if (data.completedRemoteId !== undefined) {
    update.completedRemoteId = data.completedRemoteId;
  }

  if (data.lastStatusSyncedAt !== undefined) {
    update.lastStatusSyncedAt = data.lastStatusSyncedAt;
  }

  return update;
}

function buildRequestWhere(userId: number, query: WarehouseRequestListQuery): SQL {
  const clauses: SQL[] = [eq(schema.warehouseRequests.userId, userId), eq(schema.warehouseRequests.mediaType, query.mediaType ?? 'ebook')];

  if (query.status) {
    clauses.push(eq(schema.warehouseRequests.status, query.status));
  }

  return and(...clauses)!;
}

function buildRequestSyncCandidateWhere(query: RequestSyncCandidateQuery): SQL {
  const clauses: SQL[] = [
    isNotNull(schema.warehouseRequests.userId),
    isNotNull(schema.warehouseRequests.upstreamRequestId),
    sql`nullif(trim(${schema.warehouseRequests.upstreamRequestId}), '') is not null`,
    inArray(schema.warehouseRequests.status, REQUEST_SYNC_CANDIDATE_STATUSES),
  ];

  if (query.mediaType) {
    clauses.push(eq(schema.warehouseRequests.mediaType, query.mediaType));
  }

  if (query.staleBefore) {
    clauses.push(or(isNull(schema.warehouseRequests.lastStatusSyncedAt), lt(schema.warehouseRequests.lastStatusSyncedAt, query.staleBefore))!);
  }

  return and(...clauses)!;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sanitizeRequestPayload(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  return sanitizeRecord(value);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    if (isUnsafeRequestPayloadKey(key) || isUnsafeRequestPayloadValue(fieldValue)) {
      continue;
    }

    if (Array.isArray(fieldValue)) {
      const items = sanitizeArray(fieldValue);

      if (items.length > 0) {
        sanitized[key] = items;
      }
      continue;
    }

    if (isPlainRecord(fieldValue)) {
      const nested = sanitizeRecord(fieldValue);

      if (!isEmptySanitizedContainer(nested)) {
        sanitized[key] = nested;
      }
      continue;
    }

    sanitized[key] = fieldValue;
  }

  return sanitized;
}

function sanitizeArray(value: unknown[]): unknown[] {
  return value
    .map((item) => {
      if (Array.isArray(item)) {
        return sanitizeArray(item);
      }

      if (isPlainRecord(item)) {
        return sanitizeRecord(item);
      }

      return item;
    })
    .filter((item) => !isEmptySanitizedContainer(item) && !isUnsafeRequestPayloadValue(item));
}

function isUnsafeRequestPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (/(?:provider|source|warehouse|thirdparty|vendor)/.test(normalized)) {
    return true;
  }

  return new Set([
    'key',
    'token',
    'accesstoken',
    'refreshtoken',
    'secret',
    'password',
    'header',
    'headers',
    'authorization',
    'message',
    'cause',
    'stack',
    'error',
    'errors',
    'raw',
    'rawerror',
    'rawresponse',
    'provider',
    'upstream',
    'source',
    'sourceid',
    'sourcelabel',
    'sourcename',
    'sourceprovider',
    'sourceurl',
    'baseurl',
    'upstreamurl',
    'url',
    'uri',
    'apikey',
    'xapikey',
  ]).has(normalized);
}

function buildRandomCatalogCandidateWhere(): SQLWrapper {
  return and(
    or(isNull(schema.warehouseUserState.progressPercent), eq(schema.warehouseUserState.progressPercent, 0)),
    or(isNull(schema.warehouseUserState.readStatus), inArray(schema.warehouseUserState.readStatus, ['unread', 'want_to_read'])),
  ) as SQLWrapper;
}

function isUnsafeRequestPayloadValue(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (/https?:\/\//i.test(value) ||
      /\bwww\./i.test(value) ||
      /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|\b)/i.test(value) ||
      /\bbearer\s+\S+/i.test(value) ||
      /\bapi[_ -]?key\b/i.test(value) ||
      /\b[A-Za-z0-9_-]{32,}\b/.test(value))
  );
}

function isEmptySanitizedContainer(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeSyncErrorMessage(errorMessage: string): string {
  const sanitized = sanitizeLogValue(errorMessage)
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:x-api-key|api[_ -]?key)\b\s*[:=]?\s*\S+/gi, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized || 'Sync failed';
}
