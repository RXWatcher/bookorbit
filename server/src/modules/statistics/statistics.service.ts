import { Injectable } from '@nestjs/common';

import type {
  AcquisitionLagPoint,
  BooksAddedDataPoint,
  ChordDiagramData,
  FormatShareOverTimeItem,
  LibraryIntegrityGauge,
  MetadataFreshnessGauge,
  StatisticsSummary,
  FormatDistributionItem,
  GenreDistributionItem,
  LibraryMetadataCompletenessItem,
  LanguageDistributionItem,
  LargestBookItem,
  MetadataScoreDistribution,
  MetadataCompletenessItem,
  PageCountDistributionItem,
  PublicationDecadeItem,
  PublicationYearPoint,
  StatisticsResult,
  StorageByFormatItem,
  TopAuthorItem,
  TopSeriesItem,
} from '@bookorbit/types';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, type WarehouseMediaType } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { StatsCache } from '../../common/cache/stats-cache';
import { LibraryService } from '../library/library.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import type { BooksOverTimeQueryDto } from './dto/books-over-time-query.dto';
import type { StatisticsFilterQueryDto } from './dto/statistics-filter-query.dto';
import { StatisticsRepository } from './statistics.repository';

const STATISTICS_TOP_N = 10;
const STREAM_TOP_FORMATS = 8;
const TOP_LIST_LIMIT = 25;
const METADATA_SCORE_BIN_COUNT = 10;
const OTHER_BUCKET_LABEL = 'Other';
const UNKNOWN_FORMAT_LABEL = 'UNKNOWN';
const STATISTICS_CACHE_TTL_MS = 300_000;
const STATISTICS_CACHE_MAX_ENTRIES = 500;

type MetadataCompletenessFieldKey =
  | 'hasTitle'
  | 'hasCover'
  | 'hasAuthor'
  | 'hasGenre'
  | 'hasTag'
  | 'hasDescription'
  | 'hasPublisher'
  | 'hasYear'
  | 'hasLanguage'
  | 'hasPageCount'
  | 'hasRating'
  | 'hasSeries'
  | 'hasIsbn';

type MetadataCompletenessFieldDefinition = {
  field: string;
  key: MetadataCompletenessFieldKey;
  includeInOverall: boolean;
};

type StatisticNamedCount = { name: string | null; count: number };
type StatisticGenreCount = { genre: string; count: number };
type StatisticsDimensionValues = {
  authors: string[];
  series: string[];
  publishers: string[];
  genres: string[];
  languages: string[];
};
type StatisticsLibraryScope = {
  localLibraryIds: number[];
  sourceBackedMediaTypes: WarehouseMediaType[];
};
type MetadataCompletenessAggregate = Record<MetadataCompletenessFieldKey, number> & {
  total: number;
};

const METADATA_COMPLETENESS_FIELDS: MetadataCompletenessFieldDefinition[] = [
  { field: 'Title', key: 'hasTitle', includeInOverall: false },
  { field: 'Cover', key: 'hasCover', includeInOverall: true },
  { field: 'Author', key: 'hasAuthor', includeInOverall: true },
  { field: 'Genres', key: 'hasGenre', includeInOverall: false },
  { field: 'Tags', key: 'hasTag', includeInOverall: false },
  { field: 'Description', key: 'hasDescription', includeInOverall: true },
  { field: 'Publisher', key: 'hasPublisher', includeInOverall: true },
  { field: 'Year', key: 'hasYear', includeInOverall: true },
  { field: 'Language', key: 'hasLanguage', includeInOverall: true },
  { field: 'Page Count', key: 'hasPageCount', includeInOverall: true },
  { field: 'Rating', key: 'hasRating', includeInOverall: true },
  { field: 'Series', key: 'hasSeries', includeInOverall: true },
  { field: 'ISBN', key: 'hasIsbn', includeInOverall: true },
];

@Injectable()
export class StatisticsService {
  private readonly cache = new StatsCache({ ttlMs: STATISTICS_CACHE_TTL_MS, maxEntries: STATISTICS_CACHE_MAX_ENTRIES });

  constructor(
    private readonly repo: StatisticsRepository,
    private readonly libraryService: LibraryService,
    private readonly warehouseCatalogService: WarehouseCatalogService,
  ) {}

  async getFormatDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<FormatDistributionItem>> {
    return this.withStatisticsCache('format-distribution', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0 ? this.repo.formatDistribution(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds) : [],
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.formatDistribution(user.contentFilters, scope.sourceBackedMediaTypes)
          : [],
      ]);
      const all = this.mergeFormatCounts([...localRows, ...sourceRows]);
      return { items: this.clipCountsToTopN(all, (count) => ({ format: OTHER_BUCKET_LABEL, count })), unknownCount: 0 };
    });
  }

  async getLanguageDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<LanguageDistributionItem>> {
    return this.withStatisticsCache('language-distribution', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localResult, sourceResult] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.languageDistribution(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { items: [], unknownCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.languageDistribution(user.contentFilters, scope.sourceBackedMediaTypes)
          : { items: [], unknownCount: 0 },
      ]);
      const all = this.mergeLanguageCounts([...localResult.items, ...sourceResult.items]);
      return {
        items: this.clipCountsToTopN(all, (count) => ({ language: OTHER_BUCKET_LABEL, count })),
        unknownCount: localResult.unknownCount + sourceResult.unknownCount,
      };
    });
  }

  async getBooksAddedOverTime(user: RequestUser, query: BooksOverTimeQueryDto): Promise<StatisticsResult<BooksAddedDataPoint>> {
    return this.withStatisticsCache(
      'books-added-over-time',
      user,
      query,
      async () => {
        const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
        const [localItems, sourceItems] = await Promise.all([
          scope.localLibraryIds.length > 0
            ? this.repo.booksAddedOverTime(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds, query.granularity, query.range)
            : [],
          scope.sourceBackedMediaTypes.length > 0
            ? this.warehouseCatalogService.booksAddedOverTime(user.contentFilters, scope.sourceBackedMediaTypes, query.granularity, query.range)
            : [],
        ]);
        const items = this.mergeBooksAddedDataPoints([...localItems, ...sourceItems]);
        return { items, unknownCount: 0 };
      },
      { granularity: query.granularity ?? 'monthly', range: query.range ?? 'all-time' },
    );
  }

  async getMetadataScoreDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<MetadataScoreDistribution> {
    return this.withStatisticsCache('metadata-score-distribution', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localResult, sourceResult] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.metadataScoreDistribution(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : this.emptyMetadataScoreDistribution(),
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.metadataScoreDistribution(user.contentFilters, scope.sourceBackedMediaTypes)
          : this.emptyMetadataScoreDistribution(),
      ]);
      const raw =
        scope.localLibraryIds.length > 0 && scope.sourceBackedMediaTypes.length > 0
          ? this.mergeMetadataScoreDistributions([localResult, sourceResult])
          : scope.sourceBackedMediaTypes.length > 0
            ? sourceResult
            : localResult;
      const byMin = new Map(raw.bins.map((b) => [b.minScore, b.count]));
      const bins = Array.from({ length: METADATA_SCORE_BIN_COUNT }, (_, i) => {
        const minScore = i * 10;
        const maxScore = i === METADATA_SCORE_BIN_COUNT - 1 ? 100 : minScore + 9;
        return {
          minScore,
          maxScore,
          count: byMin.get(minScore) ?? 0,
        };
      });

      return {
        bins,
        unknownCount: raw.unknownCount,
        totalCount: raw.totalCount,
        percentile25: raw.percentile25,
        percentile50: raw.percentile50,
        percentile75: raw.percentile75,
        percentile90: raw.percentile90,
      };
    });
  }

  async getLibraryMetadataCompleteness(
    user: RequestUser,
    query: StatisticsFilterQueryDto,
  ): Promise<StatisticsResult<LibraryMetadataCompletenessItem>> {
    return this.withStatisticsCache('library-metadata-completeness', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.libraryMetadataCompleteness(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : [],
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.libraryMetadataCompleteness(user.contentFilters, scope.sourceBackedMediaTypes)
          : [],
      ]);
      const rows = [...localRows, ...sourceRows];

      const items: LibraryMetadataCompletenessItem[] = rows.flatMap((row) =>
        METADATA_COMPLETENESS_FIELDS.map((f) => {
          const presentCount = Number(row[f.key] ?? 0);
          const totalCount = row.total ?? 0;
          return {
            libraryId: row.libraryId,
            libraryName: row.libraryName,
            field: f.field,
            presentCount,
            totalCount,
            percent: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0,
          };
        }),
      );

      return { items, unknownCount: 0 };
    });
  }

  async getFormatShareOverTime(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<FormatShareOverTimeItem>> {
    return this.withStatisticsCache('format-share-over-time', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0 ? this.repo.formatShareOverTime(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds) : [],
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.formatShareOverTime(user.contentFilters, scope.sourceBackedMediaTypes)
          : [],
      ]);
      const raw = [...localRows, ...sourceRows];
      const totals = new Map<string, number>();
      for (const row of raw) {
        const format = this.normalizeFormatLabel(row.format);
        totals.set(format, (totals.get(format) ?? 0) + row.count);
      }

      const topFormats = new Set(
        [...totals.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, STREAM_TOP_FORMATS)
          .map(([f]) => f),
      );

      const grouped = new Map<string, FormatShareOverTimeItem>();
      for (const row of raw) {
        const normalizedFormat = this.normalizeFormatLabel(row.format);
        const format = topFormats.has(normalizedFormat) ? normalizedFormat : 'OTHER';
        const key = `${row.year}-${row.month}-${format}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.count += row.count;
          continue;
        }
        grouped.set(key, { year: row.year, month: row.month, format, count: row.count });
      }

      const items = [...grouped.values()].sort((a, b) => a.year - b.year || a.month - b.month || a.format.localeCompare(b.format));
      return { items, unknownCount: 0 };
    });
  }

  async getPageCountDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<PageCountDistributionItem>> {
    return this.withStatisticsCache('page-count-distribution', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localResult, sourceResult] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.pageCountDistributionByFormat(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { items: [], unknownCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.pageCountDistributionByFormat(user.contentFilters, scope.sourceBackedMediaTypes)
          : { items: [], unknownCount: 0 },
      ]);
      const raw = [...localResult.items, ...sourceResult.items];
      const unknownCount = localResult.unknownCount + sourceResult.unknownCount;
      const items = raw.flatMap((row) =>
        row.format
          ? [
              {
                format: row.format.toUpperCase(),
                count: row.count,
                min: row.min,
                q1: Number(row.q1),
                median: Number(row.median),
                q3: Number(row.q3),
                max: row.max,
              },
            ]
          : [],
      );
      return { items, unknownCount };
    });
  }

  async getStorageByFormat(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<StorageByFormatItem>> {
    return this.withStatisticsCache('storage-by-format', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0 ? this.repo.storageByFormat(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds) : [],
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.storageByFormat(user.contentFilters, scope.sourceBackedMediaTypes)
          : [],
      ]);
      const all = sourceRows.length > 0 ? this.mergeStorageByFormat([...localRows, ...sourceRows]) : localRows;
      return { items: this.clipStorageToTopN(all), unknownCount: 0 };
    });
  }

  async getPublicationDecade(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<PublicationDecadeItem>> {
    return this.withStatisticsCache('publication-decade', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localResult, sourceResult] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.publicationDecade(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { items: [], unknownCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.publicationDecade(user.contentFilters, scope.sourceBackedMediaTypes)
          : { items: [], unknownCount: 0 },
      ]);
      return {
        items: this.mergePublicationDecadeCounts([...localResult.items, ...sourceResult.items]),
        unknownCount: localResult.unknownCount + sourceResult.unknownCount,
      };
    });
  }

  async getPublicationYearTimeline(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<PublicationYearPoint>> {
    return this.withStatisticsCache('publication-year-timeline', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localResult, sourceResult] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.publicationYearTimeline(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { items: [], unknownCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.publicationYearTimeline(user.contentFilters, scope.sourceBackedMediaTypes)
          : { items: [], unknownCount: 0 },
      ]);
      return {
        items: this.mergePublicationYearPoints([...localResult.items, ...sourceResult.items]),
        unknownCount: localResult.unknownCount + sourceResult.unknownCount,
      };
    });
  }

  async getTopAuthors(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<TopAuthorItem>> {
    return this.withStatisticsCache('top-authors', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0 ? this.repo.topAuthors(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds) : [],
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.topUserCatalogAuthors(user.id, user.contentFilters, scope.sourceBackedMediaTypes)
          : [],
      ]);
      const items = this.mergeAuthorCounts([...localRows, ...sourceRows]).slice(0, TOP_LIST_LIMIT);
      return { items, unknownCount: 0 };
    });
  }

  async getMetadataCompleteness(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<MetadataCompletenessItem>> {
    return this.withStatisticsCache('metadata-completeness', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRow, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.metadataCompleteness(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : undefined,
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.libraryMetadataCompleteness(user.contentFilters, scope.sourceBackedMediaTypes)
          : [],
      ]);
      const row = this.mergeMetadataCompletenessRows([localRow, ...sourceRows]);
      const total = row?.total ?? 0;
      const items = METADATA_COMPLETENESS_FIELDS.filter((fieldDef) => fieldDef.includeInOverall)
        .map((fieldDef) => ({ field: fieldDef.field, presentCount: row?.[fieldDef.key] ?? 0, totalCount: total }))
        .sort((a, b) => b.presentCount - a.presentCount);
      return { items, unknownCount: 0 };
    });
  }

  async getGenreDistribution(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<GenreDistributionItem>> {
    return this.withStatisticsCache('genre-distribution', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localResult, sourceResult] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.genreDistribution(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { items: [], unknownCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.topUserCatalogGenres(user.id, user.contentFilters, scope.sourceBackedMediaTypes)
          : { items: [], unknownCount: 0 },
      ]);
      const items = this.mergeGenreCounts([...localResult.items, ...sourceResult.items]).slice(0, TOP_LIST_LIMIT);
      return { items, unknownCount: localResult.unknownCount + sourceResult.unknownCount };
    });
  }

  async getMetadataFreshnessGauge(user: RequestUser, query: StatisticsFilterQueryDto): Promise<MetadataFreshnessGauge> {
    return this.withStatisticsCache('metadata-freshness-gauge', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRow, sourceRow] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.metadataFreshnessGauge(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { totalBooks: 0, fresh30dCount: 0, stale31To90dCount: 0, stale91To180dCount: 0, staleOver180dCount: 0, neverFetchedCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.metadataFreshnessGauge(user.contentFilters, scope.sourceBackedMediaTypes)
          : { totalBooks: 0, fresh30dCount: 0, stale31To90dCount: 0, stale91To180dCount: 0, staleOver180dCount: 0, neverFetchedCount: 0 },
      ]);
      const row = this.mergeMetadataFreshnessGauge(localRow, sourceRow);
      const totalBooks = row.totalBooks ?? 0;
      const fresh30dCount = row.fresh30dCount ?? 0;
      const stale31To90dCount = row.stale31To90dCount ?? 0;
      const stale91To180dCount = row.stale91To180dCount ?? 0;
      const staleOver180dCount = row.staleOver180dCount ?? 0;
      const neverFetchedCount = row.neverFetchedCount ?? 0;

      const weightedFreshness = fresh30dCount + stale31To90dCount * 0.7 + stale91To180dCount * 0.4 + staleOver180dCount * 0.15;
      const freshnessScore = totalBooks > 0 ? Math.round((weightedFreshness / totalBooks) * 100) : 0;

      return {
        totalBooks,
        neverFetchedCount,
        fresh30dCount,
        stale31To90dCount,
        stale91To180dCount,
        staleOver180dCount,
        freshnessScore,
      };
    });
  }

  async getLibraryIntegrityGauge(user: RequestUser, query: StatisticsFilterQueryDto): Promise<LibraryIntegrityGauge> {
    return this.withStatisticsCache('library-integrity-gauge', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRow, sourceRow] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.libraryIntegrityGauge(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { totalBooks: 0, presentCount: 0, primaryFileCount: 0, metadataCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.libraryIntegrityGauge(user.contentFilters, scope.sourceBackedMediaTypes)
          : { totalBooks: 0, presentCount: 0, primaryFileCount: 0, metadataCount: 0 },
      ]);
      const row = this.mergeLibraryIntegrityGauge(localRow, sourceRow);
      const totalBooks = row.totalBooks ?? 0;
      const presentCount = row.presentCount ?? 0;
      const primaryFileCount = row.primaryFileCount ?? 0;
      const metadataCount = row.metadataCount ?? 0;

      const presentRatio = totalBooks > 0 ? presentCount / totalBooks : 0;
      const primaryFileRatio = totalBooks > 0 ? primaryFileCount / totalBooks : 0;
      const metadataRatio = totalBooks > 0 ? metadataCount / totalBooks : 0;
      const integrityScore = Math.round(((presentRatio + primaryFileRatio + metadataRatio) / 3) * 100);

      return {
        totalBooks,
        presentCount,
        primaryFileCount,
        metadataCount,
        integrityScore,
      };
    });
  }

  async getAcquisitionLagScatter(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<AcquisitionLagPoint>> {
    return this.withStatisticsCache('acquisition-lag-scatter', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.acquisitionLagScatter(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : { items: [], unknownCount: 0 },
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.acquisitionLagScatter(user.contentFilters, scope.sourceBackedMediaTypes)
          : { items: [], unknownCount: 0 },
      ]);
      return {
        items: this.mergeAcquisitionLagScatterItems([...localRows.items, ...sourceRows.items]),
        unknownCount: localRows.unknownCount + sourceRows.unknownCount,
      };
    });
  }

  private clipCountsToTopN<T extends { count: number }>(items: T[], createOtherItem: (count: number) => T, n = STATISTICS_TOP_N): T[] {
    if (items.length <= n) return items;
    const top = items.slice(0, n);
    const otherCount = items.slice(n).reduce((sum, item) => sum + item.count, 0);
    return [...top, createOtherItem(otherCount)];
  }

  private normalizeFormatLabel(format: string | null | undefined): string {
    return (format ?? UNKNOWN_FORMAT_LABEL).toUpperCase();
  }

  private mergeFormatCounts(rows: Array<{ format: string | null; count: number }>): FormatDistributionItem[] {
    const merged = new Map<string, FormatDistributionItem>();
    for (const row of rows) {
      const normalized = row.format?.trim().toLowerCase();
      if (!normalized) continue;
      const existing = merged.get(normalized);
      if (existing) {
        existing.count += row.count;
      } else {
        merged.set(normalized, { format: normalized, count: row.count });
      }
    }

    return [...merged.values()];
  }

  private mergeLanguageCounts(rows: Array<{ language: string | null; count: number }>): LanguageDistributionItem[] {
    const merged = new Map<string, LanguageDistributionItem>();
    for (const row of rows) {
      const normalized = row.language?.trim().toLowerCase();
      if (!normalized) continue;
      const existing = merged.get(normalized);
      if (existing) {
        existing.count += row.count;
      } else {
        merged.set(normalized, { language: normalized, count: row.count });
      }
    }

    return [...merged.values()];
  }

  private mergeBooksAddedDataPoints(rows: BooksAddedDataPoint[]): BooksAddedDataPoint[] {
    const merged = new Map<string, BooksAddedDataPoint>();
    for (const row of rows) {
      const key = `${row.year}:${row.month}`;
      const existing = merged.get(key);
      if (existing) {
        existing.count += row.count;
      } else {
        merged.set(key, { ...row });
      }
    }

    return [...merged.values()].sort((a, b) => a.year - b.year || a.month - b.month);
  }

  private mergePublicationDecadeCounts(rows: PublicationDecadeItem[]): PublicationDecadeItem[] {
    const merged = new Map<number, PublicationDecadeItem>();
    for (const row of rows) {
      const existing = merged.get(row.decade);
      if (existing) {
        existing.count += row.count;
      } else {
        merged.set(row.decade, { ...row });
      }
    }

    return [...merged.values()].sort((a, b) => a.decade - b.decade);
  }

  private mergePublicationYearPoints(rows: PublicationYearPoint[]): PublicationYearPoint[] {
    const merged = new Map<number, PublicationYearPoint>();
    for (const row of rows) {
      const existing = merged.get(row.year);
      if (existing) {
        existing.count += row.count;
        existing.topTitles = [...existing.topTitles, ...row.topTitles].slice(0, 3);
      } else {
        merged.set(row.year, { ...row, topTitles: row.topTitles.slice(0, 3) });
      }
    }

    return [...merged.values()].sort((a, b) => a.year - b.year);
  }

  private mergeMetadataScoreDistributions(rows: MetadataScoreDistribution[]): MetadataScoreDistribution {
    const nonEmptyRows = rows.filter((row) => row.totalCount > 0 || row.unknownCount > 0 || row.bins.length > 0);
    if (nonEmptyRows.length === 0) return this.emptyMetadataScoreDistribution();
    if (nonEmptyRows.length === 1) return nonEmptyRows[0]!;

    const byMin = new Map<number, number>();
    let unknownCount = 0;
    let totalCount = 0;

    for (const row of nonEmptyRows) {
      unknownCount += row.unknownCount;
      totalCount += row.totalCount;
      for (const bin of row.bins) {
        byMin.set(bin.minScore, (byMin.get(bin.minScore) ?? 0) + bin.count);
      }
    }

    const percentileBins = [...byMin.entries()].map(([minScore, count]) => ({ minScore, count })).sort((a, b) => a.minScore - b.minScore);
    const bins = percentileBins.map(({ minScore, count }) => ({
      minScore,
      maxScore: minScore >= 90 ? 100 : minScore + 9,
      count,
    }));

    return {
      bins,
      unknownCount,
      totalCount,
      percentile25: this.percentileFromMetadataScoreBins(percentileBins, totalCount, 0.25),
      percentile50: this.percentileFromMetadataScoreBins(percentileBins, totalCount, 0.5),
      percentile75: this.percentileFromMetadataScoreBins(percentileBins, totalCount, 0.75),
      percentile90: this.percentileFromMetadataScoreBins(percentileBins, totalCount, 0.9),
    };
  }

  private emptyMetadataScoreDistribution(): MetadataScoreDistribution {
    return {
      bins: [],
      unknownCount: 0,
      totalCount: 0,
      percentile25: null,
      percentile50: null,
      percentile75: null,
      percentile90: null,
    };
  }

  private percentileFromMetadataScoreBins(bins: Array<{ minScore: number; count: number }>, totalCount: number, percentile: number): number | null {
    if (totalCount <= 0) return null;
    const rank = (totalCount - 1) * percentile;
    const lowerIndex = Math.floor(rank);
    const upperIndex = Math.ceil(rank);
    const lower = this.metadataScoreValueAtIndex(bins, lowerIndex);
    const upper = this.metadataScoreValueAtIndex(bins, upperIndex);
    if (lower === null || upper === null) return null;
    return lower + (upper - lower) * (rank - lowerIndex);
  }

  private metadataScoreValueAtIndex(bins: Array<{ minScore: number; count: number }>, index: number): number | null {
    let seen = 0;
    for (const bin of bins) {
      const next = seen + bin.count;
      if (index < next) return bin.minScore === 90 ? 95 : bin.minScore + 5;
      seen = next;
    }
    return null;
  }

  private clipStorageToTopN(items: StorageByFormatItem[]): StorageByFormatItem[] {
    if (items.length <= STATISTICS_TOP_N) return items;
    const top = items.slice(0, STATISTICS_TOP_N);
    const otherBytes = items.slice(STATISTICS_TOP_N).reduce((sum, item) => sum + item.sizeBytes, 0);
    return [...top, { format: OTHER_BUCKET_LABEL, sizeBytes: otherBytes }];
  }

  private mergeStorageByFormat(rows: StorageByFormatItem[]): StorageByFormatItem[] {
    const merged = new Map<string, StorageByFormatItem>();
    for (const row of rows) {
      const format = row.format?.trim();
      if (!format) continue;
      const key = format.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.sizeBytes += Number(row.sizeBytes);
      } else {
        merged.set(key, { format, sizeBytes: Number(row.sizeBytes) });
      }
    }

    return [...merged.values()].sort((a, b) => b.sizeBytes - a.sizeBytes || a.format.localeCompare(b.format));
  }

  async getSummary(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsSummary> {
    return this.withStatisticsCache('summary', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localSummary, sourceSummary] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.getSummary(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : this.emptySummary(),
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getUserCatalogStatisticsSummary(user.id, user.contentFilters, scope.sourceBackedMediaTypes)
          : this.emptySummary(),
      ]);
      if (scope.sourceBackedMediaTypes.length === 0) {
        return localSummary;
      }
      if (scope.localLibraryIds.length === 0) {
        return sourceSummary;
      }
      const [localDimensions, sourceDimensions] = await Promise.all([
        this.repo.getSummaryDimensionValues(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds),
        this.warehouseCatalogService.getUserCatalogStatisticsDimensionValues(user.id, user.contentFilters, scope.sourceBackedMediaTypes),
      ]);

      return this.mergeSummaries(localSummary, sourceSummary, localDimensions, sourceDimensions);
    });
  }

  async getGenreCooccurrence(user: RequestUser, query: StatisticsFilterQueryDto): Promise<ChordDiagramData> {
    return this.withStatisticsCache('genre-cooccurrence', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0
          ? this.repo.getGenreCooccurrence(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds)
          : null,
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getGenreCooccurrence(user.contentFilters, scope.sourceBackedMediaTypes)
          : null,
      ]);
      return this.mergeGenreCooccurrenceRows(localRows, sourceRows);
    });
  }

  async getLargestBooks(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<LargestBookItem>> {
    return this.withStatisticsCache('largest-books', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0 ? this.repo.largestBooks(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds) : [],
        scope.sourceBackedMediaTypes.length > 0 ? this.warehouseCatalogService.largestBooks(user.contentFilters, scope.sourceBackedMediaTypes) : [],
      ]);
      const raw = [...localRows, ...sourceRows].sort((a, b) => Number(b.sizeBytes) - Number(a.sizeBytes)).slice(0, 50);
      const items = raw.flatMap((r) => (r.title && r.format ? [{ id: r.id, title: r.title, sizeBytes: Number(r.sizeBytes), format: r.format }] : []));
      return { items, unknownCount: 0 };
    });
  }

  async getTopSeries(user: RequestUser, query: StatisticsFilterQueryDto): Promise<StatisticsResult<TopSeriesItem>> {
    return this.withStatisticsCache('top-series', user, query, async () => {
      const scope = await this.resolveStatisticsLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        scope.localLibraryIds.length > 0 ? this.repo.topSeries(user.id, user.isSuperuser, user.contentFilters, scope.localLibraryIds) : [],
        scope.sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.topUserCatalogSeries(user.id, user.contentFilters, scope.sourceBackedMediaTypes)
          : [],
      ]);
      const items = this.mergeNamedCounts([...localRows, ...sourceRows]).slice(0, TOP_LIST_LIMIT);
      return { items, unknownCount: 0 };
    });
  }

  private async resolveStatisticsLibraryScope(user: RequestUser, requestedLibraryIds?: number[]): Promise<StatisticsLibraryScope> {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const accessibleIds = new Set(libraries.map((library) => library.id));
    const requestedIds = requestedLibraryIds && requestedLibraryIds.length > 0 ? requestedLibraryIds : [...accessibleIds];
    const selectedIds = requestedIds.filter((id) => accessibleIds.has(id));
    const localLibraryIds = selectedIds.filter((id) => id > 0);
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(selectedIds);

    return { localLibraryIds, sourceBackedMediaTypes };
  }

  private async resolveLocalStatisticsLibraryIds(user: RequestUser, requestedLibraryIds?: number[]): Promise<number[]> {
    return (await this.resolveStatisticsLibraryScope(user, requestedLibraryIds)).localLibraryIds;
  }

  private mergeSummaries(
    left: StatisticsSummary,
    right: StatisticsSummary,
    leftDimensions: StatisticsDimensionValues,
    rightDimensions: StatisticsDimensionValues,
  ): StatisticsSummary {
    return {
      totalBooks: left.totalBooks + right.totalBooks,
      totalAuthors: this.countMergedAuthors(leftDimensions.authors, rightDimensions.authors),
      totalSeries: this.countMergedDimension(leftDimensions.series, rightDimensions.series),
      totalPublishers: this.countMergedDimension(leftDimensions.publishers, rightDimensions.publishers),
      totalStorageBytes: Number(left.totalStorageBytes) + Number(right.totalStorageBytes),
      totalGenres: this.countMergedDimension(leftDimensions.genres, rightDimensions.genres),
      totalLanguages: this.countMergedDimension(leftDimensions.languages, rightDimensions.languages),
      publicationYearMin: minNullable(left.publicationYearMin, right.publicationYearMin),
      publicationYearMax: maxNullable(left.publicationYearMax, right.publicationYearMax),
      booksAddedThisYear: left.booksAddedThisYear + right.booksAddedThisYear,
    };
  }

  private emptyDimensionValues(): StatisticsDimensionValues {
    return { authors: [], series: [], publishers: [], genres: [], languages: [] };
  }

  private countMergedDimension(left: string[], right: string[]): number {
    const values = new Set<string>();
    for (const value of [...left, ...right]) {
      const normalized = value.trim().toLowerCase();
      if (normalized) values.add(normalized);
    }
    return values.size;
  }

  private countMergedAuthors(left: string[], right: string[]): number {
    const values = new Set<string>();
    for (const value of [...left, ...right]) {
      const normalized = canonicalAuthorName(value);
      if (normalized) values.add(normalized);
    }
    return values.size;
  }

  private emptySummary(): StatisticsSummary {
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

  private mergeNamedCounts(rows: StatisticNamedCount[]): Array<{ name: string; count: number }> {
    const merged = new Map<string, { name: string; count: number }>();
    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.count += row.count;
      } else {
        merged.set(key, { name, count: row.count });
      }
    }

    return [...merged.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  private mergeAuthorCounts(rows: StatisticNamedCount[]): Array<{ name: string; count: number }> {
    const merged = new Map<string, { name: string; count: number }>();
    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) continue;
      const key = canonicalAuthorName(name);
      const existing = merged.get(key);
      if (existing) {
        existing.count += row.count;
      } else {
        merged.set(key, { name, count: row.count });
      }
    }

    return [...merged.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  private mergeGenreCounts(rows: StatisticGenreCount[]): StatisticGenreCount[] {
    const merged = new Map<string, StatisticGenreCount>();
    for (const row of rows) {
      const genre = row.genre.trim();
      if (!genre) continue;
      const key = genre.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.count += row.count;
      } else {
        merged.set(key, { genre, count: row.count });
      }
    }

    return [...merged.values()].sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
  }

  private mergeMetadataCompletenessRows(rows: Array<Partial<MetadataCompletenessAggregate> | undefined>): MetadataCompletenessAggregate {
    const merged = METADATA_COMPLETENESS_FIELDS.reduce(
      (acc, field) => {
        acc[field.key] = 0;
        return acc;
      },
      { total: 0 } as MetadataCompletenessAggregate,
    );

    for (const row of rows) {
      if (!row) continue;
      merged.total += Number(row.total ?? 0);
      for (const field of METADATA_COMPLETENESS_FIELDS) {
        merged[field.key] += Number(row[field.key] ?? 0);
      }
    }

    return merged;
  }

  private mergeMetadataFreshnessGauge(left: Omit<MetadataFreshnessGauge, 'freshnessScore'>, right: Omit<MetadataFreshnessGauge, 'freshnessScore'>) {
    return {
      totalBooks: left.totalBooks + right.totalBooks,
      neverFetchedCount: left.neverFetchedCount + right.neverFetchedCount,
      fresh30dCount: left.fresh30dCount + right.fresh30dCount,
      stale31To90dCount: left.stale31To90dCount + right.stale31To90dCount,
      stale91To180dCount: left.stale91To180dCount + right.stale91To180dCount,
      staleOver180dCount: left.staleOver180dCount + right.staleOver180dCount,
    };
  }

  private mergeLibraryIntegrityGauge(left: Omit<LibraryIntegrityGauge, 'integrityScore'>, right: Omit<LibraryIntegrityGauge, 'integrityScore'>) {
    return {
      totalBooks: left.totalBooks + right.totalBooks,
      presentCount: left.presentCount + right.presentCount,
      primaryFileCount: left.primaryFileCount + right.primaryFileCount,
      metadataCount: left.metadataCount + right.metadataCount,
    };
  }

  private mergeAcquisitionLagScatterItems(rows: AcquisitionLagPoint[]): AcquisitionLagPoint[] {
    const merged = new Map<string, AcquisitionLagPoint>();
    for (const row of rows) {
      const addedYear = Number(row.addedYear);
      const lagYears = Number(row.lagYears);
      if (!Number.isInteger(addedYear) || !Number.isInteger(lagYears)) continue;
      const key = `${addedYear}:${lagYears}`;
      const existing = merged.get(key);
      if (existing) {
        existing.count += Number(row.count ?? 0);
      } else {
        merged.set(key, { addedYear, lagYears, count: Number(row.count ?? 0) });
      }
    }
    return [...merged.values()].sort((a, b) => a.addedYear - b.addedYear || a.lagYears - b.lagYears);
  }

  private mergeGenreCooccurrenceRows(...datasets: Array<ChordDiagramData | null>): ChordDiagramData {
    const nodes = new Map<string, { name: string }>();
    const links = new Map<string, { source: string; target: string; value: number }>();

    for (const dataset of datasets) {
      if (!dataset) continue;
      for (const node of dataset.nodes) {
        const name = node.name.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!nodes.has(key)) nodes.set(key, { name });
      }

      for (const link of dataset.links) {
        const source = link.source.trim();
        const target = link.target.trim();
        if (!source || !target || source.toLowerCase() === target.toLowerCase()) continue;
        const [first, second] = [source, target].sort((a, b) => a.localeCompare(b));
        const key = `${first.toLowerCase()}:${second.toLowerCase()}`;
        const existing = links.get(key);
        if (existing) {
          existing.value += Number(link.value ?? 0);
        } else {
          links.set(key, { source: first, target: second, value: Number(link.value ?? 0) });
        }
      }
    }

    return {
      nodes: [...nodes.values()],
      links: [...links.values()],
    };
  }

  private withStatisticsCache<T>(
    endpoint: string,
    user: RequestUser,
    query: { libraryIds?: number[] },
    load: () => Promise<T>,
    extraScope: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const key = this.buildCacheKey(endpoint, user, query.libraryIds, extraScope);
    return this.cache.get(String(user.id), key, load);
  }

  private buildCacheKey(
    endpoint: string,
    user: RequestUser,
    libraryIds: number[] | undefined,
    extraScope: Record<string, string | number | boolean>,
  ): string {
    const normalizedLibraries = [...new Set(libraryIds ?? [])].sort((a, b) => a - b);
    return JSON.stringify({
      endpoint,
      isSuperuser: user.isSuperuser,
      libraryIds: normalizedLibraries,
      contentFilters: this.normalizeContentFilters(user.contentFilters),
      ...extraScope,
    });
  }

  private normalizeContentFilters(contentFilters: RequestUser['contentFilters']) {
    return {
      includeTagIds: [...new Set(contentFilters.includeTagIds)].sort((a, b) => a - b),
      excludeTagIds: [...new Set(contentFilters.excludeTagIds)].sort((a, b) => a - b),
      includeGenreIds: [...new Set(contentFilters.includeGenreIds)].sort((a, b) => a - b),
      excludeGenreIds: [...new Set(contentFilters.excludeGenreIds)].sort((a, b) => a - b),
    };
  }
}

function sourceBackedMediaTypesForLibraryIds(libraryIds: number[]): WarehouseMediaType[] {
  const mediaTypes: WarehouseMediaType[] = [];
  if (libraryIds.includes(CLOUD_EBOOK_LIBRARY_ID)) mediaTypes.push('ebook');
  if (libraryIds.includes(CLOUD_AUDIO_LIBRARY_ID)) mediaTypes.push('audiobook');
  if (libraryIds.includes(CLOUD_COMIC_LIBRARY_ID)) mediaTypes.push('comic');
  return mediaTypes;
}

function canonicalAuthorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex <= 0) return trimmed.toLowerCase();

  const family = trimmed.slice(0, commaIndex).trim();
  const given = trimmed.slice(commaIndex + 1).trim();
  return given && family ? `${given} ${family}`.toLowerCase() : trimmed.toLowerCase();
}

function minNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
