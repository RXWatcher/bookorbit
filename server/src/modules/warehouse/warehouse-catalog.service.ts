import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type {
  AcquisitionLagPoint,
  BookCard,
  BooksAddedDataPoint,
  BookQuery,
  ChordDiagramData,
  ContentFilterRules,
  CurrentlyReadingWidgetData,
  DashboardCatalogItem,
  FormatDistributionItem,
  FormatShareOverTimeItem,
  HighlightOfTheDayWidgetData,
  LanguageDistributionItem,
  JumpBucketsResponse,
  LargestBookItem,
  LibraryIntegrityGauge,
  LibraryOverviewWidgetData,
  LongWaitWidgetData,
  MetadataFreshnessGauge,
  MetadataScoreDistribution,
  NeglectedGemsWidgetData,
  PageCountDistributionItem,
  PublicationDecadeItem,
  PublicationYearPoint,
  WarehouseAudiobookCatalogItem,
  WarehouseAudiobookCatalogPage,
  WarehouseAudiobookCatalogQuery,
  WarehouseAudiobookDetail,
  WarehouseCatalogDimensionItem,
  WarehouseCatalogDimensionPage,
  WarehouseComicCatalogItem,
  WarehouseComicCatalogPage,
  WarehouseComicCatalogQuery,
  WarehouseComicPagesPage,
  WarehouseComicSeriesQuery,
  WarehouseComicSeriesSummary,
  WarehouseComicSummary,
  WarehouseEbookCatalogItem,
  WarehouseEbookCatalogPage,
  WarehouseEbookCatalogQuery,
  WarehouseListPage,
  StatisticsSummary,
  StatisticsResult,
  StatisticsDateRange,
  StatisticsGranularity,
  StorageByFormatItem,
  TopAuthorItem,
  GenreDistributionItem,
  TopSeriesItem,
  ReadStatus,
  UserCompletionTimelinePoint,
  UserProgressFunnel,
  UserStatisticsSummary,
  WarehouseMediaType,
} from '@bookorbit/types';
import { jumpBucketKindForSort } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { WarehouseCatalogItemRow } from '../../db/schema';
import { mapWarehouseAudiobookCatalogItemRow, mapWarehouseAudiobookDetail, mapWarehouseEbookCatalogItemRow } from './warehouse-catalog.mapper';
import { WarehouseClientService, type WarehouseBinaryResponse } from './warehouse-client.service';
import { WarehouseCatalogCoverCacheService } from './warehouse-catalog-cover-cache.service';
import { LocalContentService } from '../local-scan/local-content.service';
import { catalogAuthorRefs, catalogSeriesRef } from './catalog-link-refs';
import { LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE, LIBRARY_MEDIA_UNAVAILABLE_MESSAGE } from './warehouse-user-facing-messages';
import {
  WarehouseRepository,
  type CatalogAuthorSummaryRow,
  type CatalogAuthorSummaryPage,
  type CatalogListRow,
  type CatalogChallengePatternData,
  type CatalogDiversityData,
  type CatalogReadingDnaData,
  type CatalogSeriesSummaryRow,
  type CatalogSeriesSummaryPage,
  type CatalogYearProjectionData,
  type UserOwnedCatalogItemRow,
  type WarehouseLibraryMetadataCompletenessRow,
} from './warehouse.repository';
import { WarehouseSecretService, type EncryptedWarehouseSecret } from './warehouse-secret.service';
import { mapWarehouseCatalogItemToBookCard } from './warehouse-book-card.mapper';

const EBOOK_MEDIA_TYPE = 'ebook' as const;
const AUDIOBOOK_MEDIA_TYPE = 'audiobook' as const;
const COMIC_MEDIA_TYPE = 'comic' as const;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const EBOOK_NOT_AVAILABLE_MESSAGE = LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE;
const EBOOK_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;
const AUDIOBOOK_NOT_AVAILABLE_MESSAGE = LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE;
const AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;
const COMIC_NOT_AVAILABLE_MESSAGE = LIBRARY_ITEM_NOT_AVAILABLE_MESSAGE;
const COMIC_MEDIA_UNAVAILABLE_MESSAGE = LIBRARY_MEDIA_UNAVAILABLE_MESSAGE;

type AudiobookBinaryRequest = {
  baseUrl: string;
  apiKey: string;
  sourceKey: string;
  id: string;
  range?: string;
};

type EbookBinaryRequest = {
  baseUrl: string;
  apiKey: string;
  sourceKey: string;
  id: string;
  range?: string;
};

type ComicBinaryRequest = {
  baseUrl: string;
  apiKey: string;
  sourceKey: string;
  id: string;
  range?: string;
};

type CatalogClientRequest = {
  baseUrl: string;
  apiKey: string;
};

type CatalogStatisticsDimensionValues = {
  authors: string[];
  series: string[];
  publishers: string[];
  genres: string[];
  languages: string[];
};

@Injectable()
export class WarehouseCatalogService {
  private readonly logger = new Logger(WarehouseCatalogService.name);

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly client: WarehouseClientService,
    private readonly secret: WarehouseSecretService,
    private readonly coverCache: WarehouseCatalogCoverCacheService,
    @Optional() private readonly localContent?: LocalContentService,
  ) {}

  /** Local rows carry their bytes on the mount rather than at the warehouse, so every binary
   *  path checks here first. Returns null for a warehouse row, which takes the original path. */
  private async localBinary(
    mediaType: WarehouseMediaType,
    remoteId: string,
    kind: 'file' | 'cover',
    range?: string,
  ): Promise<WarehouseBinaryResponse | null> {
    if (!this.localContent) return null;

    const localPath = await this.localContent.findLocalPath(mediaType, remoteId);
    if (!localPath) return null;

    const response = kind === 'cover' ? await this.localContent.getCover(localPath) : await this.localContent.getFile(localPath, range);
    return response as WarehouseBinaryResponse;
  }

  async listEbooks(query: WarehouseEbookCatalogQuery): Promise<WarehouseEbookCatalogPage> {
    if (!(await this.isCatalogEnabled())) {
      return emptyCatalogPage(query);
    }

    const page = await this.repository.listEbookCatalog(query);

    return {
      items: page.rows.map(mapEbookCatalogItem),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  async getEbook(remoteId: string): Promise<WarehouseEbookCatalogItem | null> {
    if (!(await this.isCatalogEnabled())) {
      return null;
    }

    const item = await this.repository.findCatalogItem(EBOOK_MEDIA_TYPE, remoteId);
    if (!item) {
      return null;
    }

    return mapEbookCatalogItem(item);
  }

  async listComics(query: WarehouseComicCatalogQuery): Promise<WarehouseComicCatalogPage> {
    if (!(await this.isCatalogEnabled())) {
      return emptyComicCatalogPage(query);
    }

    const page = await this.repository.listComicCatalog(query);

    return {
      items: page.rows.map(mapComicCatalogItem),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  async getComic(remoteId: string): Promise<WarehouseComicCatalogItem | null> {
    if (!(await this.isCatalogEnabled())) {
      return null;
    }

    const item = await this.repository.findCatalogItem(COMIC_MEDIA_TYPE, remoteId);
    if (!item) {
      return null;
    }

    return mapComicCatalogItem(item);
  }

  async findAccessibleCatalogItemById(
    user: RequestUser,
    mediaType: WarehouseMediaType,
    catalogItemId: number,
  ): Promise<WarehouseCatalogItemRow | null> {
    if (!(await this.isCatalogEnabled())) {
      return null;
    }

    return this.repository.findAccessibleCatalogItemById(mediaType, catalogItemId, user.isSuperuser ? undefined : user.contentFilters);
  }

  async listComicSeries(query: Omit<WarehouseComicSeriesQuery, 'q'>): Promise<WarehouseListPage<WarehouseComicSeriesSummary>> {
    const request = await this.catalogClientRequest(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    if (!request) {
      return emptyWarehouseListPage(query);
    }

    const { page, limit } = clampPageLimit(query.page, query.limit);
    try {
      return await this.client.listComicSeries({ ...request, page, limit });
    } catch {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async searchComicSeries(query: WarehouseComicSeriesQuery): Promise<WarehouseListPage<WarehouseComicSeriesSummary>> {
    const request = await this.catalogClientRequest(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    if (!request) {
      return emptyWarehouseListPage(query);
    }

    const { page, limit } = clampPageLimit(query.page, query.limit);
    try {
      return await this.client.searchComicSeries({ ...request, q: query.q ?? '', page, limit });
    } catch {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async listComicSeriesItems(seriesId: string, query: Omit<WarehouseComicSeriesQuery, 'q'>): Promise<WarehouseListPage<WarehouseComicSummary>> {
    const request = await this.catalogClientRequest(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    if (!request) {
      return emptyWarehouseListPage(query);
    }

    const { page, limit } = clampPageLimit(query.page, query.limit);
    try {
      return await this.client.listComicSeriesItems({ ...request, seriesId, page, limit });
    } catch {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async assertUserCanAccessComic(user: RequestUser, remoteId: string): Promise<void> {
    if (!(await this.isCatalogEnabled())) {
      throw new NotFoundException(COMIC_NOT_AVAILABLE_MESSAGE);
    }

    const item = await this.repository.findCatalogItem(COMIC_MEDIA_TYPE, remoteId);
    if (!item) {
      throw new NotFoundException(COMIC_NOT_AVAILABLE_MESSAGE);
    }
  }

  async listEbookGenres(): Promise<WarehouseCatalogDimensionPage> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0 };
    }

    const items = (await this.repository.listEbookCatalogDimensions('genre')).map(mapCatalogDimensionItem);
    return {
      items,
      total: items.length,
    };
  }

  listEbooksByGenre(genre: string, query: WarehouseEbookCatalogQuery): Promise<WarehouseEbookCatalogPage> {
    return this.listEbooks({ ...query, genre });
  }

  async isCatalogEnabled(): Promise<boolean> {
    return this.catalogEnabled();
  }

  async searchCatalogItems(
    q: string,
    limit: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseCatalogItemRow[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.searchCatalogItems(q, limit, contentFilters, mediaTypes);
  }

  async getLibraryOverview(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<LibraryOverviewWidgetData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyLibraryOverview();
    }

    return this.repository.getCatalogLibraryOverview(contentFilters, mediaTypes);
  }

  async getUserLibraryOverview(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<LibraryOverviewWidgetData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyLibraryOverview();
    }

    return this.repository.getUserCatalogLibraryOverview(userId, contentFilters, mediaTypes);
  }

  async getUserCatalogStatisticsSummary(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<StatisticsSummary> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyStatisticsSummary();
    }

    return this.repository.getUserCatalogStatisticsSummary(userId, contentFilters, mediaTypes);
  }

  async getUserCatalogStatisticsDimensionValues(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogStatisticsDimensionValues> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyCatalogStatisticsDimensionValues();
    }

    return this.repository.getUserCatalogStatisticsDimensionValues(userId, contentFilters, mediaTypes);
  }

  async getUserCatalogDiversityData(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogDiversityData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyCatalogDiversityData();
    }

    return this.repository.getUserCatalogDiversityData(userId, contentFilters, mediaTypes);
  }

  async getUserCatalogYearProjectionData(
    userId: number,
    yearStart: Date,
    thirtyDaysAgo: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogYearProjectionData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyCatalogYearProjectionData();
    }

    return this.repository.getUserCatalogYearProjectionData(userId, yearStart, thirtyDaysAgo, contentFilters, mediaTypes);
  }

  async getUserCatalogReadingDnaData(
    userId: number,
    since: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogReadingDnaData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyCatalogReadingDnaData();
    }

    return this.repository.getUserCatalogReadingDnaData(userId, since, contentFilters, mediaTypes);
  }

  async getUserCatalogChallengePatternData(
    userId: number,
    monthStart: Date,
    sixMonthsAgo: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CatalogChallengePatternData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyCatalogChallengePatternData();
    }

    return this.repository.getUserCatalogChallengePatternData(userId, monthStart, sixMonthsAgo, contentFilters, mediaTypes);
  }

  async getUserCatalogNeglectedGems(
    userId: number,
    today: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<NeglectedGemsWidgetData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return emptyCatalogNeglectedGemsData();
    }

    return this.repository.getUserCatalogNeglectedGems(userId, today, contentFilters, mediaTypes);
  }

  async getUserCatalogLongWait(
    userId: number,
    today: Date,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<LongWaitWidgetData | null> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return null;
    }

    return this.repository.getUserCatalogLongWait(userId, today, contentFilters, mediaTypes);
  }

  async topUserCatalogAuthors(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<TopAuthorItem[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.topUserCatalogAuthors(userId, contentFilters, mediaTypes);
  }

  async formatDistribution(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<FormatDistributionItem[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.formatDistribution(contentFilters, mediaTypes);
  }

  async languageDistribution(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: LanguageDistributionItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { items: [], unknownCount: 0 };
    }

    return this.repository.languageDistribution(contentFilters, mediaTypes);
  }

  async booksAddedOverTime(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
    granularity?: StatisticsGranularity,
    range?: StatisticsDateRange,
  ): Promise<BooksAddedDataPoint[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.booksAddedOverTime(contentFilters, mediaTypes, granularity, range);
  }

  async metadataScoreDistribution(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<MetadataScoreDistribution> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { bins: [], unknownCount: 0, totalCount: 0, percentile25: null, percentile50: null, percentile75: null, percentile90: null };
    }

    return this.repository.metadataScoreDistribution(contentFilters, mediaTypes);
  }

  async metadataFreshnessGauge(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<Omit<MetadataFreshnessGauge, 'freshnessScore'>> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { totalBooks: 0, neverFetchedCount: 0, fresh30dCount: 0, stale31To90dCount: 0, stale91To180dCount: 0, staleOver180dCount: 0 };
    }

    return this.repository.metadataFreshnessGauge(contentFilters, mediaTypes);
  }

  async libraryIntegrityGauge(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<Omit<LibraryIntegrityGauge, 'integrityScore'>> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { totalBooks: 0, presentCount: 0, primaryFileCount: 0, metadataCount: 0 };
    }

    return this.repository.libraryIntegrityGauge(contentFilters, mediaTypes);
  }

  async acquisitionLagScatter(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<StatisticsResult<AcquisitionLagPoint>> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { items: [], unknownCount: 0 };
    }

    return this.repository.acquisitionLagScatter(contentFilters, mediaTypes);
  }

  async getGenreCooccurrence(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<ChordDiagramData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { nodes: [], links: [] };
    }

    return this.repository.getGenreCooccurrence(contentFilters, mediaTypes);
  }

  async storageByFormat(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<StorageByFormatItem[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.storageByFormat(contentFilters, mediaTypes);
  }

  async formatShareOverTime(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<FormatShareOverTimeItem[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.formatShareOverTime(contentFilters, mediaTypes);
  }

  async libraryMetadataCompleteness(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<WarehouseLibraryMetadataCompletenessRow[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.libraryMetadataCompleteness(contentFilters, mediaTypes);
  }

  async pageCountDistributionByFormat(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: PageCountDistributionItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { items: [], unknownCount: 0 };
    }

    return this.repository.pageCountDistributionByFormat(contentFilters, mediaTypes);
  }

  async publicationDecade(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: PublicationDecadeItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { items: [], unknownCount: 0 };
    }

    return this.repository.publicationDecade(contentFilters, mediaTypes);
  }

  async publicationYearTimeline(
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: PublicationYearPoint[]; unknownCount: number }> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { items: [], unknownCount: 0 };
    }

    return this.repository.publicationYearTimeline(contentFilters, mediaTypes);
  }

  async largestBooks(contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<LargestBookItem[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.largestBooks(contentFilters, mediaTypes);
  }

  async topUserCatalogGenres(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<{ items: GenreDistributionItem[]; unknownCount: number }> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { items: [], unknownCount: 0 };
    }

    return this.repository.topUserCatalogGenres(userId, contentFilters, mediaTypes);
  }

  async topUserCatalogSeries(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<TopSeriesItem[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.topUserCatalogSeries(userId, contentFilters, mediaTypes);
  }

  async getCompletedBooksThisYear(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<number> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return 0;
    }

    return this.repository.countCompletedUserCatalogItemsThisYear(userId, contentFilters, mediaTypes);
  }

  async getUserReadingSummary(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<UserStatisticsSummary> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return {
        trackedBooks: 0,
        startedBooks: 0,
        inProgressBooks: 0,
        completedBooks: 0,
        meanProgressPercent: 0,
      };
    }

    return this.repository.getUserReadingSummary(userId, contentFilters, mediaTypes);
  }

  async getUserProgressFunnelInRange(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    since: Date,
    untilExclusive: Date,
  ): Promise<UserProgressFunnel> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return {
        started: 0,
        reached25: 0,
        reached50: 0,
        reached75: 0,
        completed: 0,
      };
    }

    return this.repository.getUserProgressFunnelInRange(userId, contentFilters, mediaTypes, since, untilExclusive);
  }

  async getUserMonthlyCompletions(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    days: number,
  ): Promise<UserCompletionTimelinePoint[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.getUserMonthlyCompletions(userId, contentFilters, mediaTypes, days);
  }

  async getUserCompletionLatencyDays(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    days: number,
  ): Promise<number[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.getUserCompletionLatencyDays(userId, contentFilters, mediaTypes, days);
  }

  async getUserReadingSurvivalMaxProgress(
    userId: number,
    contentFilters: ContentFilterRules | undefined,
    mediaTypes: WarehouseMediaType[] | undefined,
    days: number,
  ): Promise<number[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.getUserReadingSurvivalMaxProgress(userId, contentFilters, mediaTypes, days);
  }

  async getCurrentlyReading(
    userId: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<CurrentlyReadingWidgetData> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return { books: [] };
    }

    const rows = await this.repository.listCurrentlyReadingUserCatalogItems(userId, 10, contentFilters, mediaTypes);
    return {
      books: rows.map((row) => {
        const authorRefs = catalogAuthorRefs(row.authors);
        return {
          type: 'catalog-item',
          mediaType: row.mediaType,
          remoteId: row.remoteId,
          title: row.title,
          subtitle: row.subtitle ?? null,
          seriesName: row.series ?? null,
          seriesRef: catalogSeriesRef(row.series),
          authors: authorRefs.map((author) => author.name),
          authorRefs,
          narrators: safeStringArray(row.narrators),
          libraryName: sourceBackedLibraryName(row.mediaType),
          fileFormat: row.format ?? null,
          progress: row.progressPercent ?? 0,
          positionSeconds: row.positionSeconds ?? null,
          hasCover: row.hasCover,
          lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async listReadingActivityDays(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<string[]> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.listUserCatalogReadingActivityDays(userId, contentFilters, mediaTypes);
  }

  async getAnnotationCount(userId: number, contentFilters?: ContentFilterRules, mediaTypes?: WarehouseMediaType[]): Promise<number> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return 0;
    }

    return this.repository.countUserCatalogAnnotations(userId, contentFilters, mediaTypes);
  }

  async getAnnotationByOffset(
    userId: number,
    offset: number,
    contentFilters?: ContentFilterRules,
    mediaTypes?: WarehouseMediaType[],
  ): Promise<HighlightOfTheDayWidgetData | null> {
    if (mediaTypes?.length === 0 || !(await this.isCatalogEnabled())) {
      return null;
    }

    const row = await this.repository.getUserCatalogAnnotationByOffset(userId, offset, contentFilters, mediaTypes);
    if (!row) return null;

    return {
      type: 'catalog-item',
      text: row.text,
      note: row.note,
      bookTitle: row.bookTitle,
      bookId: null,
      mediaType: row.mediaType,
      remoteId: row.remoteId,
      libraryName: sourceBackedLibraryName(row.mediaType),
      hasCover: row.hasCover,
      chapterTitle: row.chapterTitle,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async queryLibraryItems(
    user: RequestUser,
    mediaType: WarehouseMediaType,
    query: BookQuery,
  ): Promise<{ items: DashboardCatalogItem[]; total: number; page: number; limit: number }> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0, page: query.pagination.page, limit: query.pagination.size };
    }

    const page = await this.repository.queryUserCatalogItems(user.id, {
      includeAllCatalogItems: true,
      mediaType,
      filter: query.filter,
      q: query.q,
      sort: query.sort,
      page: query.pagination.page,
      limit: query.pagination.size,
      contentFilters: user.contentFilters,
    });

    return {
      items: page.rows.map(mapSeriesCatalogItem),
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }

  async queryLibraryBooks(
    user: RequestUser,
    mediaType: WarehouseMediaType,
    query: BookQuery,
  ): Promise<{ items: BookCard[]; total: number; page: number; limit: number }> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0, page: query.pagination.page, limit: query.pagination.size };
    }

    const page = await this.repository.queryUserCatalogItems(user.id, {
      includeAllCatalogItems: true,
      mediaType,
      filter: query.filter,
      q: query.q,
      sort: query.sort,
      page: query.pagination.page,
      limit: query.pagination.size,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });

    return {
      items: page.rows.map(mapWarehouseCatalogItemToBookCard),
      total: page.total,
      page: page.page,
      limit: page.limit,
    };
  }

  /** Loads a specific set of catalogue rows by remote id, e.g. resolving search result ids
   *  into cards. Order is not guaranteed; callers that need a specific order must restore it
   *  themselves from the returned items' catalogSource. */
  async getCatalogItemsByRemoteIds(user: RequestUser, mediaType: WarehouseMediaType, remoteIds: string[]): Promise<BookCard[]> {
    if (remoteIds.length === 0 || !(await this.isCatalogEnabled())) {
      return [];
    }

    const page = await this.repository.queryUserCatalogItems(user.id, {
      includeAllCatalogItems: true,
      mediaType,
      remoteIds,
      page: 0,
      limit: remoteIds.length,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });

    return page.rows.map(mapWarehouseCatalogItemToBookCard);
  }

  async queryLibraryJumpBuckets(user: RequestUser, mediaType: WarehouseMediaType, query: BookQuery): Promise<JumpBucketsResponse> {
    if (!jumpBucketKindForSort(query.sort)) {
      throw new BadRequestException('jump buckets are not available for this sort');
    }

    if (!(await this.isCatalogEnabled())) {
      return { buckets: [], total: 0, kind: jumpBucketKindForSort(query.sort) ?? 'letter', granularity: null };
    }

    return this.repository.queryUserCatalogJumpBuckets(user.id, {
      includeAllCatalogItems: true,
      mediaType,
      filter: query.filter,
      q: query.q,
      sort: query.sort,
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    });
  }

  async bulkSetReadStatusForQuery(
    user: RequestUser,
    mediaType: WarehouseMediaType,
    query: Pick<BookQuery, 'filter' | 'q'> & { sort?: BookQuery['sort'] },
    readStatus: ReadStatus,
  ): Promise<{ updated: number }> {
    return this.bulkSetUserStateForQuery(user, mediaType, query, { readStatus });
  }

  async bulkSetRatingForQuery(
    user: RequestUser,
    mediaType: WarehouseMediaType,
    query: Pick<BookQuery, 'filter' | 'q'> & { sort?: BookQuery['sort'] },
    rating: number | null,
  ): Promise<{ updated: number }> {
    return this.bulkSetUserStateForQuery(user, mediaType, query, { rating });
  }

  private async bulkSetUserStateForQuery(
    user: RequestUser,
    mediaType: WarehouseMediaType,
    query: Pick<BookQuery, 'filter' | 'q'> & { sort?: BookQuery['sort'] },
    patch: { readStatus?: ReadStatus; rating?: number | null },
  ): Promise<{ updated: number }> {
    if (!(await this.isCatalogEnabled())) {
      return { updated: 0 };
    }

    let updated = 0;
    let page = 0;

    while (true) {
      const result = await this.repository.queryUserCatalogItems(user.id, {
        includeAllCatalogItems: true,
        mediaType,
        filter: query.filter,
        q: query.q,
        sort: query.sort,
        page,
        limit: MAX_LIMIT,
        contentFilters: user.isSuperuser ? undefined : user.contentFilters,
      });

      for (const row of result.rows) {
        await this.repository.upsertUserCatalogState(user.id, mediaType, row.remoteId, patch);
      }

      updated += result.rows.length;
      if (result.rows.length === 0 || updated >= result.total) {
        break;
      }
      page += 1;
    }

    return { updated };
  }

  async listAuthorSummaries(params: {
    userId: number;
    q?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<CatalogAuthorSummaryRow[]> {
    if (!(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.listCatalogAuthorSummaries(params);
  }

  async listAuthorSummaryPage(params: {
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
    if (!(await this.isCatalogEnabled())) {
      return { rows: [], total: 0, page: params.page, size: params.size };
    }

    return this.repository.listCatalogAuthorSummaryPage(params);
  }

  async findAuthorSummaryById(authorId: number, userId: number, contentFilters?: ContentFilterRules): Promise<CatalogAuthorSummaryRow | null> {
    if (!(await this.isCatalogEnabled())) {
      return null;
    }

    return this.repository.findCatalogAuthorSummaryById(authorId, userId, contentFilters);
  }

  async listAuthorItems(params: {
    userId: number;
    authorId?: number;
    authorName?: string;
    page: number;
    size: number;
    sort: 'title' | 'publishedYear' | 'addedAt';
    order: 'asc' | 'desc';
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<{ items: DashboardCatalogItem[]; total: number }> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0 };
    }

    const page = await this.repository.listCatalogItemsByAuthor(params);
    return {
      items: page.rows.map(mapSeriesCatalogItem),
      total: page.total,
    };
  }

  async listAuthorBooks(params: {
    userId: number;
    authorId?: number;
    authorName?: string;
    page: number;
    size: number;
    sort: 'title' | 'publishedYear' | 'addedAt';
    order: 'asc' | 'desc';
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<{ items: BookCard[]; total: number }> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0 };
    }

    const page = await this.repository.listCatalogItemsByAuthor(params);
    return {
      items: page.rows.map(mapWarehouseCatalogItemToBookCard),
      total: page.total,
    };
  }

  async listSeriesSummaries(params: {
    userId: number;
    q?: string;
    author?: string;
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<CatalogSeriesSummaryRow[]> {
    if (!(await this.isCatalogEnabled())) {
      return [];
    }

    return this.repository.listCatalogSeriesSummaries(params);
  }

  async listSeriesSummaryPage(params: {
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
    if (!(await this.isCatalogEnabled())) {
      return { rows: [], total: 0, page: params.page, size: params.size };
    }

    return this.repository.listCatalogSeriesSummaryPage(params);
  }

  async listSeriesItems(params: {
    seriesName: string;
    userId: number;
    page: number;
    size: number;
    sort: 'seriesIndex' | 'title' | 'addedAt';
    order: 'asc' | 'desc';
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<{ items: DashboardCatalogItem[]; total: number }> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0 };
    }

    const page = await this.repository.listCatalogItemsBySeries(params);
    return {
      items: page.rows.map(mapSeriesCatalogItem),
      total: page.total,
    };
  }

  async listSeriesBooks(params: {
    seriesName: string;
    userId: number;
    page: number;
    size: number;
    sort: 'seriesIndex' | 'title' | 'addedAt';
    order: 'asc' | 'desc';
    contentFilters?: ContentFilterRules;
    mediaType?: WarehouseMediaType;
  }): Promise<{ items: BookCard[]; total: number }> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0 };
    }

    const page = await this.repository.listCatalogItemsBySeries(params);
    return {
      items: page.rows.map(mapWarehouseCatalogItemToBookCard),
      total: page.total,
    };
  }

  async assertUserCanAccessEbook(user: RequestUser, remoteId: string): Promise<void> {
    if (!(await this.isCatalogEnabled())) {
      throw new NotFoundException(EBOOK_NOT_AVAILABLE_MESSAGE);
    }

    const item = await this.repository.findCatalogItem(EBOOK_MEDIA_TYPE, remoteId);
    if (!item) {
      throw new NotFoundException(EBOOK_NOT_AVAILABLE_MESSAGE);
    }
  }

  async downloadEbook(user: RequestUser, remoteId: string, range?: string): Promise<WarehouseBinaryResponse> {
    const local = await this.localBinary(EBOOK_MEDIA_TYPE, remoteId, 'file', range);
    if (local) return local;

    const request = await this.ebookBinaryRequest(user, remoteId);
    const clientRequest = ebookClientRequest(request);

    try {
      return await this.client.downloadBook(range === undefined ? clientRequest : { ...clientRequest, range });
    } catch {
      throw new BadGatewayException(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async downloadComic(user: RequestUser, remoteId: string, range?: string): Promise<WarehouseBinaryResponse> {
    const local = await this.localBinary(COMIC_MEDIA_TYPE, remoteId, 'file', range);
    if (local) return local;

    const request = await this.comicBinaryRequest(user, remoteId);

    try {
      const rangedRequest = range === undefined ? request : { ...request, range };
      return await this.client.downloadComic(comicClientRequest(rangedRequest));
    } catch {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async listComicPages(user: RequestUser, remoteId: string): Promise<WarehouseComicPagesPage> {
    const request = await this.comicBinaryRequest(user, remoteId);

    try {
      return await this.client.listComicPages(comicClientRequest(request));
    } catch {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async getComicPageImage(user: RequestUser, remoteId: string, pageIndex: number, range?: string): Promise<WarehouseBinaryResponse> {
    // A local comic is a cbz on the mount, so the whole archive is returned and the reader
    // extracts the page, rather than the warehouse rendering it server side.
    const local = await this.localBinary(COMIC_MEDIA_TYPE, remoteId, 'file', range);
    if (local) return local;

    const request = await this.comicBinaryRequest(user, remoteId);

    try {
      const rangedRequest = range === undefined ? request : { ...request, range };
      return await this.client.getComicPageImage({ ...comicClientRequest(rangedRequest), pageIndex });
    } catch {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async getEbookCover(user: RequestUser, remoteId: string, size: string): Promise<WarehouseBinaryResponse> {
    const local = await this.localBinary(EBOOK_MEDIA_TYPE, remoteId, 'cover');
    if (local) return local;

    const request = await this.ebookBinaryRequest(user, remoteId);
    const cached = await this.readCachedEbookCover(request.sourceKey, remoteId, size);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client.getBookCover({ ...ebookClientRequest(request), size });
      return await this.writeCachedEbookCover(request.sourceKey, remoteId, size, response);
    } catch {
      throw new BadGatewayException(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async listAudiobooks(query: WarehouseAudiobookCatalogQuery): Promise<WarehouseAudiobookCatalogPage> {
    if (!(await this.isCatalogEnabled())) {
      return emptyAudiobookCatalogPage(query);
    }

    const page = await this.repository.listAudiobookCatalog(query);

    return {
      items: page.rows.map(mapAudiobookCatalogItem),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  async listAudiobookAuthors(): Promise<WarehouseCatalogDimensionPage> {
    return this.listAudiobookDimensions('author');
  }

  async listAudiobookNarrators(): Promise<WarehouseCatalogDimensionPage> {
    return this.listAudiobookDimensions('narrator');
  }

  async listAudiobookSeries(): Promise<WarehouseCatalogDimensionPage> {
    return this.listAudiobookDimensions('series');
  }

  async listAudiobookGenres(): Promise<WarehouseCatalogDimensionPage> {
    return this.listAudiobookDimensions('genre');
  }

  listAudiobooksByAuthor(author: string, query: WarehouseAudiobookCatalogQuery): Promise<WarehouseAudiobookCatalogPage> {
    return this.listAudiobooks({ ...query, author });
  }

  listAudiobooksBySeries(series: string, query: WarehouseAudiobookCatalogQuery): Promise<WarehouseAudiobookCatalogPage> {
    return this.listAudiobooks({ ...query, series });
  }

  listAudiobooksByGenre(genre: string, query: WarehouseAudiobookCatalogQuery): Promise<WarehouseAudiobookCatalogPage> {
    return this.listAudiobooks({ ...query, genre });
  }

  async getAudiobook(remoteId: string): Promise<WarehouseAudiobookDetail | null> {
    if (!(await this.isCatalogEnabled())) {
      return null;
    }

    const item = await this.repository.findCatalogItem(AUDIOBOOK_MEDIA_TYPE, remoteId);
    if (!item) {
      return null;
    }

    const rawDetail = await this.loadOrFetchAudiobookDetail(remoteId);
    const publicDetail = rawDetail ? mapWarehouseAudiobookDetail(rawDetail) : { chapters: [], files: [] };

    return {
      ...mapAudiobookCatalogItem(item),
      chapters: publicDetail.chapters,
      files: publicDetail.files,
    };
  }

  /**
   * The cached warehouse detail for one audiobook, fetching and caching it on
   * a miss.
   *
   * The catalog sync only ever stores the warehouse's LIST projection, which
   * carries no chapters, narrators or genres — those come from
   * GET /audiobooks/{id}. warehouse_catalog_details was built to hold that
   * response, and repository.upsertCatalogDetail to write it, but nothing ever
   * called either: the table sat empty and this method's caller always
   * returned { chapters: [], files: [] }. Filling it on first read is what
   * makes chapter navigation work at all.
   *
   * Returns null rather than throwing. A detail fetch is an ENRICHMENT of a
   * page that already has everything the list gave us, so an unreachable or
   * slow warehouse must degrade to "no chapters" rather than fail the request.
   */
  private async loadOrFetchAudiobookDetail(remoteId: string): Promise<unknown | null> {
    const cached = await this.repository.findCatalogDetail(AUDIOBOOK_MEDIA_TYPE, remoteId);
    if (cached) {
      return cached.rawPayload;
    }

    const request = await this.catalogClientRequest(AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    if (!request) {
      return null;
    }

    try {
      const rawPayload = await this.client.getAudiobookWireDetail({ ...request, id: remoteId });
      await this.repository.upsertCatalogDetail({
        mediaType: AUDIOBOOK_MEDIA_TYPE,
        remoteId,
        rawPayload,
      });

      // The detail carries genres and narrators; the list projection the sync
      // stored did not, so the item row has empty arrays for both. Re-running
      // the SAME mapper the sync uses over the richer payload corrects the row
      // in place — no separate parsing to drift out of step with it.
      const enriched = mapWarehouseAudiobookCatalogItemRow(rawPayload as never, new Date());
      await this.repository.updateCatalogItemFacets(AUDIOBOOK_MEDIA_TYPE, remoteId, {
        genres: enriched.genres,
        narrators: enriched.narrators,
      });

      return rawPayload;
    } catch (error) {
      this.logger.warn(`[catalog.detail] [miss] remoteId=${remoteId} - detail fetch failed: ${String(error)}`);
      return null;
    }
  }

  /**
   * Fetch and cache warehouse details for audiobooks that have none, so
   * genres and narrators stop waiting for somebody to open each book.
   *
   * Bounded per call and resumable — "has no cached detail" is the queue, so
   * calling it repeatedly walks the catalogue and calling it once more at the
   * end is a no-op.
   *
   * It VERIFIES rather than assumes. Two bugs in this area both looked like
   * success: the detail cache filled while every item still had empty facets
   * (the mapper dropped object entries), and before that the whole detail
   * fetch was missing while the reads returned a cheerful empty list. So this
   * counts items carrying facets before and after, and reports the delta. A
   * batch that fetches successfully but enriches NOTHING is reported as
   * `stalled` — the caller should stop and look rather than grind through
   * another 184,000 items writing nothing.
   */
  async backfillAudiobookDetails(limit = 50): Promise<{
    examined: number;
    fetched: number;
    failed: number;
    facetsBefore: number;
    facetsAfter: number;
    stalled: boolean;
    remaining: boolean;
  }> {
    if (!(await this.isCatalogEnabled())) {
      return { examined: 0, fetched: 0, failed: 0, facetsBefore: 0, facetsAfter: 0, stalled: false, remaining: false };
    }

    const facetsBefore = await this.repository.countItemsWithFacets(AUDIOBOOK_MEDIA_TYPE);
    const remoteIds = await this.repository.listRemoteIdsWithoutDetail(AUDIOBOOK_MEDIA_TYPE, limit);

    let fetched = 0;
    let failed = 0;
    for (const remoteId of remoteIds) {
      // Sequential on purpose. This walks a third-party service that also
      // serves the customer-facing catalogue; a backfill is not worth
      // degrading live reads for.
      const detail = await this.loadOrFetchAudiobookDetail(remoteId);
      if (detail) {
        fetched += 1;
      } else {
        failed += 1;
      }
    }

    const facetsAfter = await this.repository.countItemsWithFacets(AUDIOBOOK_MEDIA_TYPE);
    const stalled = fetched > 0 && facetsAfter === facetsBefore;

    this.logger.log(
      `[catalog.backfill] [end] examined=${remoteIds.length} fetched=${fetched} failed=${failed} ` +
        `facets=${facetsBefore}->${facetsAfter} stalled=${stalled}`,
    );

    return {
      examined: remoteIds.length,
      fetched,
      failed,
      facetsBefore,
      facetsAfter,
      stalled,
      remaining: remoteIds.length === limit,
    };
  }

  /**
   * Fetch and cache the warehouse detail for one ebook, and correct the item's
   * facets from it.
   *
   * Ebooks have no chapters or files to show, so unlike the audiobook path
   * nothing renders this directly — it exists so genres and tags land on the
   * item row, which is what genre browsing and the genre statistics read.
   */
  private async fetchEbookDetail(remoteId: string): Promise<boolean> {
    const cached = await this.repository.findCatalogDetail(EBOOK_MEDIA_TYPE, remoteId);
    if (cached) {
      return true;
    }

    const request = await this.catalogClientRequest(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    if (!request) {
      return false;
    }

    try {
      const rawPayload = await this.client.getBookWireDetail({ ...request, id: remoteId });
      await this.repository.upsertCatalogDetail({ mediaType: EBOOK_MEDIA_TYPE, remoteId, rawPayload });

      const enriched = mapWarehouseEbookCatalogItemRow(rawPayload as never, new Date());
      await this.repository.updateCatalogItemFacets(EBOOK_MEDIA_TYPE, remoteId, {
        genres: enriched.genres,
        narrators: enriched.narrators,
      });
      return true;
    } catch (error) {
      this.logger.warn(`[catalog.detail] [miss] ebook remoteId=${remoteId} - detail fetch failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * The ebook counterpart of backfillAudiobookDetails — same queue, same
   * before/after verification, same refusal to keep going when nothing lands.
   */
  async backfillEbookDetails(limit = 50): Promise<{
    examined: number;
    fetched: number;
    failed: number;
    facetsBefore: number;
    facetsAfter: number;
    stalled: boolean;
    remaining: boolean;
  }> {
    if (!(await this.isCatalogEnabled())) {
      return { examined: 0, fetched: 0, failed: 0, facetsBefore: 0, facetsAfter: 0, stalled: false, remaining: false };
    }

    const facetsBefore = await this.repository.countItemsWithFacets(EBOOK_MEDIA_TYPE);
    const remoteIds = await this.repository.listRemoteIdsWithoutDetail(EBOOK_MEDIA_TYPE, limit);

    let fetched = 0;
    let failed = 0;
    for (const remoteId of remoteIds) {
      if (await this.fetchEbookDetail(remoteId)) {
        fetched += 1;
      } else {
        failed += 1;
      }
    }

    const facetsAfter = await this.repository.countItemsWithFacets(EBOOK_MEDIA_TYPE);
    const stalled = fetched > 0 && facetsAfter === facetsBefore;

    this.logger.log(
      `[catalog.backfill] [end] media=ebook examined=${remoteIds.length} fetched=${fetched} failed=${failed} ` +
        `facets=${facetsBefore}->${facetsAfter} stalled=${stalled}`,
    );

    return {
      examined: remoteIds.length,
      fetched,
      failed,
      facetsBefore,
      facetsAfter,
      stalled,
      remaining: remoteIds.length === limit,
    };
  }

  private async listAudiobookDimensions(kind: 'author' | 'narrator' | 'series' | 'genre'): Promise<WarehouseCatalogDimensionPage> {
    if (!(await this.isCatalogEnabled())) {
      return { items: [], total: 0 };
    }

    const items = (await this.repository.listAudiobookCatalogDimensions(kind)).map(mapCatalogDimensionItem);
    return {
      items,
      total: items.length,
    };
  }

  async getAudiobookCover(user: RequestUser, remoteId: string): Promise<WarehouseBinaryResponse> {
    const local = await this.localBinary(AUDIOBOOK_MEDIA_TYPE, remoteId, 'cover');
    if (local) return local;

    const request = await this.audiobookBinaryRequest(user, remoteId);
    const cached = await this.readCachedAudiobookCover(request.sourceKey, remoteId);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client.getAudiobookCover(audiobookClientRequest(request));
      return await this.writeCachedAudiobookCover(request.sourceKey, remoteId, response);
    } catch {
      throw new BadGatewayException(AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  async streamAudiobook(user: RequestUser, remoteId: string, range?: string): Promise<WarehouseBinaryResponse> {
    const local = await this.localBinary(AUDIOBOOK_MEDIA_TYPE, remoteId, 'file', range);
    if (local) return local;

    return this.fetchAudiobookBinary(user, remoteId, (request) => this.client.streamAudiobook(request), range);
  }

  async downloadAudiobook(user: RequestUser, remoteId: string, range?: string): Promise<WarehouseBinaryResponse> {
    const local = await this.localBinary(AUDIOBOOK_MEDIA_TYPE, remoteId, 'file', range);
    if (local) return local;

    return this.fetchAudiobookBinary(user, remoteId, (request) => this.client.downloadAudiobook(request), range);
  }

  async downloadAudiobookFile(user: RequestUser, remoteId: string, fileId: string, range?: string): Promise<WarehouseBinaryResponse> {
    const local = await this.localBinary(AUDIOBOOK_MEDIA_TYPE, remoteId, 'file', range);
    if (local) return local;

    const request = await this.audiobookBinaryRequest(user, remoteId);

    try {
      const rangedRequest = range === undefined ? request : { ...request, range };
      return await this.client.downloadAudiobookFile({ ...audiobookClientRequest(rangedRequest), fileId });
    } catch {
      throw new BadGatewayException(AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  private async catalogEnabled(): Promise<boolean> {
    return Boolean((await this.repository.findSettings())?.enabled);
  }

  private async catalogClientRequest(mediaUnavailableMessage: string): Promise<CatalogClientRequest | null> {
    const settings = await this.repository.findSettings();
    if (!settings?.enabled) {
      return null;
    }

    const encryptedSecret = encryptedSecretFromSettings(settings);
    if (!encryptedSecret) {
      throw new BadGatewayException(mediaUnavailableMessage);
    }

    try {
      return {
        baseUrl: settings.baseUrl,
        apiKey: this.secret.decrypt(encryptedSecret),
      };
    } catch {
      throw new BadGatewayException(mediaUnavailableMessage);
    }
  }

  private async readCachedEbookCover(sourceKey: string, remoteId: string, size: string): Promise<WarehouseBinaryResponse | null> {
    try {
      return await this.coverCache.readEbookCover(sourceKey, remoteId, size);
    } catch {
      return null;
    }
  }

  private async writeCachedEbookCover(
    sourceKey: string,
    remoteId: string,
    size: string,
    response: WarehouseBinaryResponse,
  ): Promise<WarehouseBinaryResponse> {
    try {
      return await this.coverCache.writeEbookCover(sourceKey, remoteId, size, response);
    } catch {
      // Cache writes are opportunistic; a readable live cover should still be returned.
      return response;
    }
  }

  private async fetchAudiobookBinary(
    user: RequestUser,
    remoteId: string,
    fetcher: (request: Omit<AudiobookBinaryRequest, 'sourceKey'>) => Promise<WarehouseBinaryResponse>,
    range?: string,
  ): Promise<WarehouseBinaryResponse> {
    const request = await this.audiobookBinaryRequest(user, remoteId);

    try {
      const rangedRequest = range === undefined ? request : { ...request, range };
      return await fetcher(audiobookClientRequest(rangedRequest));
    } catch {
      throw new BadGatewayException(AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }
  }

  private async readCachedAudiobookCover(sourceKey: string, remoteId: string): Promise<WarehouseBinaryResponse | null> {
    try {
      return await this.coverCache.readAudiobookCover(sourceKey, remoteId);
    } catch {
      return null;
    }
  }

  private async writeCachedAudiobookCover(sourceKey: string, remoteId: string, response: WarehouseBinaryResponse): Promise<WarehouseBinaryResponse> {
    try {
      return await this.coverCache.writeAudiobookCover(sourceKey, remoteId, response);
    } catch {
      return response;
    }
  }

  private async audiobookBinaryRequest(user: RequestUser, remoteId: string): Promise<AudiobookBinaryRequest> {
    const settings = await this.repository.findSettings();
    if (!settings?.enabled) {
      throw new NotFoundException(AUDIOBOOK_NOT_AVAILABLE_MESSAGE);
    }

    const encryptedSecret = encryptedSecretFromSettings(settings);
    if (!encryptedSecret) {
      throw new BadGatewayException(AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }

    let apiKey: string;
    try {
      apiKey = this.secret.decrypt(encryptedSecret);
    } catch {
      throw new BadGatewayException(AUDIOBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }

    const item = await this.repository.findCatalogItem(AUDIOBOOK_MEDIA_TYPE, remoteId);
    if (!item) {
      throw new NotFoundException(AUDIOBOOK_NOT_AVAILABLE_MESSAGE);
    }

    return {
      baseUrl: settings.baseUrl,
      apiKey,
      sourceKey: catalogSourceKey(settings),
      id: remoteId,
    };
  }

  private async comicBinaryRequest(user: RequestUser, remoteId: string): Promise<ComicBinaryRequest> {
    const settings = await this.repository.findSettings();
    if (!settings?.enabled) {
      throw new NotFoundException(COMIC_NOT_AVAILABLE_MESSAGE);
    }

    const encryptedSecret = encryptedSecretFromSettings(settings);
    if (!encryptedSecret) {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }

    let apiKey: string;
    try {
      apiKey = this.secret.decrypt(encryptedSecret);
    } catch {
      throw new BadGatewayException(COMIC_MEDIA_UNAVAILABLE_MESSAGE);
    }

    const item = await this.repository.findCatalogItem(COMIC_MEDIA_TYPE, remoteId);
    if (!item) {
      throw new NotFoundException(COMIC_NOT_AVAILABLE_MESSAGE);
    }

    return {
      baseUrl: settings.baseUrl,
      apiKey,
      sourceKey: catalogSourceKey(settings),
      id: remoteId,
    };
  }

  private async ebookBinaryRequest(user: RequestUser, remoteId: string): Promise<EbookBinaryRequest> {
    const settings = await this.repository.findSettings();
    if (!settings?.enabled) {
      throw new NotFoundException(EBOOK_NOT_AVAILABLE_MESSAGE);
    }

    const encryptedSecret = encryptedSecretFromSettings(settings);
    if (!encryptedSecret) {
      throw new BadGatewayException(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }

    let apiKey: string;
    try {
      apiKey = this.secret.decrypt(encryptedSecret);
    } catch {
      throw new BadGatewayException(EBOOK_MEDIA_UNAVAILABLE_MESSAGE);
    }

    const item = await this.repository.findCatalogItem(EBOOK_MEDIA_TYPE, remoteId);
    if (!item) {
      throw new NotFoundException(EBOOK_NOT_AVAILABLE_MESSAGE);
    }

    return {
      baseUrl: settings.baseUrl,
      apiKey,
      sourceKey: catalogSourceKey(settings),
      id: remoteId,
    };
  }
}

function catalogSourceKey(settings: {
  baseUrl: string;
  apiKeyEncrypted: string | null;
  apiKeyNonce: string | null;
  apiKeyTag: string | null;
}): string {
  return [settings.baseUrl, settings.apiKeyEncrypted ?? '', settings.apiKeyNonce ?? '', settings.apiKeyTag ?? ''].join('\n');
}

function audiobookClientRequest(request: AudiobookBinaryRequest): Omit<AudiobookBinaryRequest, 'sourceKey'> {
  const clientRequest = { ...request };
  delete (clientRequest as Partial<AudiobookBinaryRequest>).sourceKey;
  return clientRequest;
}

function ebookClientRequest(request: EbookBinaryRequest): Omit<EbookBinaryRequest, 'sourceKey'> {
  const clientRequest = { ...request };
  delete (clientRequest as Partial<EbookBinaryRequest>).sourceKey;
  return clientRequest;
}

function comicClientRequest(request: ComicBinaryRequest): Omit<ComicBinaryRequest, 'sourceKey'> {
  const clientRequest = { ...request };
  delete (clientRequest as Partial<ComicBinaryRequest>).sourceKey;
  return clientRequest;
}

function mapCatalogDimensionItem(row: { name: string; itemCount: number }): WarehouseCatalogDimensionItem {
  return {
    id: encodeURIComponent(row.name),
    name: row.name,
    itemCount: row.itemCount,
  };
}

function mapEbookCatalogItem(row: CatalogListRow): WarehouseEbookCatalogItem {
  const authorRefs = catalogAuthorRefs(row.authors);
  const seriesRef = catalogSeriesRef(row.series);
  return {
    id: row.id,
    remoteId: row.remoteId,
    title: row.title,
    subtitle: row.subtitle,
    authors: authorRefs.map((author) => author.name),
    authorRefs,
    series: row.series,
    seriesRef,
    language: row.language,
    publisher: row.publisher,
    identifiers: row.identifiers,
    format: row.format,
    hasCover: row.hasCover,
    syncedAt: row.syncedAt.toISOString(),
    source: 'catalog-source',
  };
}

function mapComicCatalogItem(row: CatalogListRow): WarehouseComicCatalogItem {
  const item: WarehouseComicCatalogItem = {
    ...mapEbookCatalogItem(row),
    mediaType: 'comic',
  };

  const seriesId = stringIdentifier(row.identifiers.seriesId);
  const issueNumber = stringIdentifier(row.identifiers.issueNumber);
  const year = numberIdentifier(row.identifiers.year);
  if (seriesId !== undefined) item.seriesId = seriesId;
  if (issueNumber !== undefined) item.issueNumber = issueNumber;
  if (year !== undefined) item.year = year;

  return item;
}

function mapAudiobookCatalogItem(row: CatalogListRow): WarehouseAudiobookCatalogItem {
  const authorRefs = catalogAuthorRefs(row.authors);
  const seriesRef = catalogSeriesRef(row.series);
  return {
    id: row.id,
    remoteId: row.remoteId,
    title: row.title,
    subtitle: row.subtitle,
    authors: authorRefs.map((author) => author.name),
    authorRefs,
    narrators: row.narrators,
    series: row.series,
    seriesRef,
    language: row.language,
    publisher: row.publisher,
    identifiers: row.identifiers,
    format: row.format,
    durationSeconds: row.durationSeconds,
    hasCover: row.hasCover,
    syncedAt: row.syncedAt.toISOString(),
    source: 'catalog-source',
  };
}

function mapSeriesCatalogItem(
  row: WarehouseCatalogItemRow & {
    userAddedAt?: Date | null;
    rating?: number | null;
    readingProgress?: number | null;
    readStatus?: DashboardCatalogItem['readStatus'];
    publishedYear?: number | null;
    pageCount?: number | null;
    fileSizeBytes?: number | null;
    metadataScore?: number | null;
    lastReadAt?: Date | null;
    finishedAt?: Date | null;
  },
): DashboardCatalogItem {
  const authorRefs = catalogAuthorRefs(row.authors);
  const seriesRef = catalogSeriesRef(row.series);
  return {
    type: 'catalog-item',
    mediaType: row.mediaType,
    remoteId: row.remoteId,
    title: row.title,
    subtitle: row.subtitle ?? null,
    seriesName: row.series ?? null,
    seriesRef,
    seriesIndex: row.seriesIndex ?? null,
    authors: authorRefs.map((author) => author.name),
    authorRefs,
    narrators: safeStringArray(row.narrators),
    libraryName: sourceBackedLibraryName(row.mediaType),
    formats: row.format ? [row.format] : [],
    language: row.language ?? null,
    publisher: row.publisher ?? null,
    publishedYear: row.publishedYear ?? null,
    pageCount: row.pageCount ?? null,
    fileSizeBytes: row.fileSizeBytes ?? null,
    metadataScore: row.metadataScore ?? null,
    rating: row.rating ?? null,
    readingProgress: row.readingProgress ?? null,
    readStatus: row.readStatus ?? null,
    lastReadAt: row.lastReadAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds ?? null,
    hasCover: row.hasCover,
    addedAt: ((row as UserOwnedCatalogItemRow).userAddedAt ?? row.syncedAt ?? row.createdAt).toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sourceBackedLibraryName(mediaType: WarehouseMediaType): string {
  if (mediaType === 'audiobook') return 'Audiobooks';
  if (mediaType === 'comic') return 'Comics';
  return 'Books';
}

function stringIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberIdentifier(value: unknown): number | undefined {
  const text = stringIdentifier(value);
  if (text === undefined) {
    return undefined;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function emptyCatalogPage(query: WarehouseEbookCatalogQuery): WarehouseEbookCatalogPage {
  const { page, limit } = clampPageLimit(query.page, query.limit);

  return {
    items: [],
    page,
    limit,
    total: 0,
  };
}

function emptyComicCatalogPage(query: WarehouseComicCatalogQuery): WarehouseComicCatalogPage {
  const { page, limit } = clampPageLimit(query.page, query.limit);

  return {
    items: [],
    page,
    limit,
    total: 0,
  };
}

function emptyAudiobookCatalogPage(query: WarehouseAudiobookCatalogQuery): WarehouseAudiobookCatalogPage {
  const { page, limit } = clampPageLimit(query.page, query.limit);

  return {
    items: [],
    page,
    limit,
    total: 0,
  };
}

function emptyWarehouseListPage<T>(query: { page?: number; limit?: number }): WarehouseListPage<T> {
  const { page, limit } = clampPageLimit(query.page, query.limit);

  return {
    items: [],
    page,
    limit,
    total: 0,
    hasNextPage: false,
  };
}

function emptyLibraryOverview(): LibraryOverviewWidgetData {
  return {
    totalBooks: 0,
    totalAuthors: 0,
    totalSeries: 0,
    totalStorageBytes: 0,
    booksAddedThisYear: 0,
  };
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

function encryptedSecretFromSettings(settings: {
  apiKeyEncrypted: string | null;
  apiKeyNonce: string | null;
  apiKeyTag: string | null;
}): EncryptedWarehouseSecret | null {
  if (!settings.apiKeyEncrypted || !settings.apiKeyNonce || !settings.apiKeyTag) {
    return null;
  }

  return {
    ciphertext: settings.apiKeyEncrypted,
    nonce: settings.apiKeyNonce,
    tag: settings.apiKeyTag,
  };
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
