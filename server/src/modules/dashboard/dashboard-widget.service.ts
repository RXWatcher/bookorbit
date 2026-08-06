import { Injectable } from '@nestjs/common';

import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import type {
  CurrentlyReadingItem,
  CurrentlyReadingWidgetData,
  DiversityScoreWidgetData,
  HighlightOfTheDayWidgetData,
  LibraryOverviewWidgetData,
  LongWaitWidgetData,
  MonthlyChallengeWidgetData,
  NeglectedGemsWidgetData,
  ReadingDnaWidgetData,
  ReadingGoalWidgetData,
  ReadingRhythmWidgetData,
  ReadingStreakWidgetData,
  UserSettings,
  WarehouseMediaType,
  YearProjectionWidgetData,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { StatsCache } from '../../common/cache/stats-cache';
import { LibraryService } from '../library/library.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import {
  buildDaysSeries,
  computeChallengeResult,
  computeDiversityScore,
  computeLongestStreak,
  computeProjection,
  computeReadingDna,
  computeRhythm,
  computeStreakData,
  findEligibleChallenges,
  formatDay,
  pickAnnotationIndex,
  selectChallenge,
} from './dashboard-widget.calculations';
import { DashboardWidgetRepository } from './dashboard-widget.repository';

const DASHBOARD_LIVE_TTL_MS = 120_000;
const DASHBOARD_STALE_TTL_MS = 300_000;
const DASHBOARD_CACHE_MAX_ENTRIES = 200;
const CURRENTLY_READING_WIDGET_LIMIT = 10;

type DiversityScoreRawData = {
  uniqueGenresRead: number;
  totalGenresInLibrary: number;
  uniqueAuthorsRead: number;
  totalBooksRead: number;
  publicationYears: number[];
  uniqueLanguages: number;
  genresRead?: string[];
  genresInLibrary?: string[];
  authorsRead?: string[];
  languagesRead?: string[];
};

type YearProjectionRawData = {
  booksCompletedYtd: number;
  pagesReadLast30Days: number;
  hoursReadLast30Days: number;
  booksCompletedLast30Days: number;
};

type ChallengePatternRawData = {
  avgPageCount: number;
  uniqueGenresLast6Months: number;
  staleInProgressCount: number;
  currentStreak: number;
  topAuthorBookCount: number;
  totalBooksRead: number;
  pagesThisMonth: number;
  shortBooksCompleted: number;
  newGenresRead: number;
  oldestInProgressFinished: boolean;
  maxStreakThisMonth: number;
  newAuthorsRead: number;
  pagesReadThisMonth: number;
  genresLast6Months?: string[];
  genresReadThisMonth?: string[];
  authorsReadThisMonth?: string[];
  readingDaysThisMonth?: string[];
};

type ReadingDnaHourBucket = {
  hour: number;
  totalSeconds: number;
};

type ReadingDnaRawData = {
  avgPageCount: number;
  uniqueGenres: number;
  totalBooks: number;
  readingDaysRatio: number;
  peakHour: number;
  avgPagesPerHour: number | null;
  genresRead?: string[];
  readingDays?: string[];
  lookbackDays?: number;
  hourBuckets?: ReadingDnaHourBucket[];
  pagesReadForSpeed?: number;
  secondsReadForSpeed?: number;
};

@Injectable()
export class DashboardWidgetService {
  private readonly liveCache = new StatsCache({ ttlMs: DASHBOARD_LIVE_TTL_MS, maxEntries: DASHBOARD_CACHE_MAX_ENTRIES });
  private readonly staleCache = new StatsCache({ ttlMs: DASHBOARD_STALE_TTL_MS, maxEntries: DASHBOARD_CACHE_MAX_ENTRIES });

  constructor(
    private readonly widgetRepo: DashboardWidgetRepository,
    private readonly libraryService: LibraryService,
    private readonly warehouseCatalogService: WarehouseCatalogService,
  ) {}

  private getContentFilters(user: RequestUser) {
    return user.isSuperuser ? undefined : user.contentFilters;
  }

  async getReadingGoal(user: RequestUser): Promise<ReadingGoalWidgetData> {
    const settings = user.settings as UserSettings | undefined;
    const goalBooks = settings?.dashboardConfig?.readingGoal ?? null;
    const year = new Date().getUTCFullYear();

    const completedBooks = await this.staleCache.get(String(user.id), `reading-goal-completed:${year}`, async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const [localCompleted, sourceBackedCompleted] = await Promise.all([
        this.widgetRepo.getCompletedBooksThisYear(user.id, accessibleLibraryIds, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getCompletedBooksThisYear(user.id, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve(0),
      ]);
      return localCompleted + sourceBackedCompleted;
    });

    return { goalBooks, completedBooks, year };
  }

  async getCurrentlyReading(user: RequestUser): Promise<CurrentlyReadingWidgetData> {
    return this.liveCache.get(String(user.id), 'currently-reading', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const [local, sourceBacked] = await Promise.all([
        this.widgetRepo.getCurrentlyReadingBooks(user.id, accessibleLibraryIds, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getCurrentlyReading(user.id, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve({ books: [] }),
      ]);
      return this.mergeCurrentlyReading(local, sourceBacked);
    });
  }

  async getReadingStreak(user: RequestUser): Promise<ReadingStreakWidgetData> {
    return this.liveCache.get(String(user.id), 'reading-streak', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const [localDays, sourceBackedDays] = await Promise.all([
        this.widgetRepo.getReadingStreakDays(user.id, accessibleLibraryIds, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.listReadingActivityDays(user.id, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve([]),
      ]);

      return computeStreakData(new Set([...localDays, ...sourceBackedDays]), new Date());
    });
  }

  async getLibraryOverview(user: RequestUser): Promise<LibraryOverviewWidgetData> {
    return this.staleCache.get(String(user.id), 'library-overview', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const [localOverview, sourceBackedOverview] = await Promise.all([
        this.widgetRepo.getLibraryOverview(accessibleLibraryIds, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getLibraryOverview(contentFilters, sourceBackedMediaTypes)
          : Promise.resolve(emptyLibraryOverview()),
      ]);
      return this.mergeLibraryOverview(localOverview, sourceBackedOverview);
    });
  }

  private mergeLibraryOverview(left: LibraryOverviewWidgetData, right: LibraryOverviewWidgetData): LibraryOverviewWidgetData {
    return {
      totalBooks: left.totalBooks + right.totalBooks,
      totalAuthors: left.totalAuthors + right.totalAuthors,
      totalSeries: left.totalSeries + right.totalSeries,
      totalStorageBytes: left.totalStorageBytes + right.totalStorageBytes,
      booksAddedThisYear: left.booksAddedThisYear + right.booksAddedThisYear,
    };
  }

  private mergeCurrentlyReading(left: CurrentlyReadingWidgetData, right: CurrentlyReadingWidgetData): CurrentlyReadingWidgetData {
    return {
      books: [...left.books, ...right.books].sort((a, b) => this.itemTimestamp(b) - this.itemTimestamp(a)).slice(0, CURRENTLY_READING_WIDGET_LIMIT),
    };
  }

  private itemTimestamp(item: CurrentlyReadingItem): number {
    const value = item.lastActivityAt;
    if (!value) return 0;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  async getHighlightOfTheDay(user: RequestUser): Promise<HighlightOfTheDayWidgetData | null> {
    return this.liveCache.get(String(user.id), 'highlight-of-the-day', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const [localCount, sourceBackedCount] = await Promise.all([
        this.widgetRepo.getAnnotationCount(user.id, accessibleLibraryIds, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getAnnotationCount(user.id, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve(0),
      ]);
      const total = localCount + sourceBackedCount;
      if (total === 0) return null;
      const dateStr = formatDay(new Date());
      const offset = pickAnnotationIndex(user.id, dateStr, total);
      if (offset < localCount) {
        return this.widgetRepo.getAnnotationByOffset(user.id, accessibleLibraryIds, offset, contentFilters);
      }
      return this.warehouseCatalogService.getAnnotationByOffset(user.id, offset - localCount, contentFilters, sourceBackedMediaTypes);
    });
  }

  async getMonthlyChallenge(user: RequestUser): Promise<MonthlyChallengeWidgetData> {
    return this.staleCache.get(String(user.id), 'monthly-challenge', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth() + 1;
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      const sixMonthsAgo = new Date(today);
      sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

      const [localData, sourceBackedData] = await Promise.all([
        this.widgetRepo.getChallengePatternData(user.id, accessibleLibraryIds, monthStart, sixMonthsAgo, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getUserCatalogChallengePatternData(user.id, monthStart, sixMonthsAgo, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve(emptyChallengePatternRawData()),
      ]);
      const data = mergeChallengePatternRawData(localData, sourceBackedData);
      const eligible = findEligibleChallenges(data);
      const challengeType = selectChallenge(eligible, user.id, year, month);

      const result = computeChallengeResult(
        challengeType,
        {
          shortBooksCompleted: data.shortBooksCompleted,
          newGenresRead: data.newGenresRead,
          oldestInProgressFinished: data.oldestInProgressFinished,
          maxStreakThisMonth: data.maxStreakThisMonth,
          newAuthorsRead: data.newAuthorsRead,
          pagesReadThisMonth: data.pagesReadThisMonth,
        },
        year,
        month,
      );

      return { challengeType, ...result };
    });
  }

  async getYearProjection(user: RequestUser): Promise<YearProjectionWidgetData> {
    return this.staleCache.get(String(user.id), 'year-projection', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const year = today.getUTCFullYear();
      const yearStart = new Date(Date.UTC(year, 0, 1));
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const daysInYear = isLeapYear ? 366 : 365;
      const dayOfYear = Math.ceil((today.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24));

      const [localData, sourceBackedData] = await Promise.all([
        this.widgetRepo.getYearProjectionData(user.id, accessibleLibraryIds, yearStart, thirtyDaysAgo, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getUserCatalogYearProjectionData(user.id, yearStart, thirtyDaysAgo, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve(emptyYearProjectionRawData()),
      ]);
      const data = mergeYearProjectionRawData(localData, sourceBackedData);

      return computeProjection({
        ...data,
        daysInYear,
        dayOfYear,
        prevProjectedBooks: null,
      });
    });
  }

  async getNeglectedGems(user: RequestUser): Promise<NeglectedGemsWidgetData> {
    return this.staleCache.get(String(user.id), 'neglected-gems', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const [localData, sourceBackedData] = await Promise.all([
        this.widgetRepo.getNeglectedGems(user.id, accessibleLibraryIds, today, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getUserCatalogNeglectedGems(user.id, today, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve({ gems: [] }),
      ]);
      return mergeNeglectedGems(localData, sourceBackedData);
    });
  }

  async getReadingDna(user: RequestUser): Promise<ReadingDnaWidgetData> {
    return this.staleCache.get(String(user.id), 'reading-dna', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - 6);
      const [localData, sourceBackedData] = await Promise.all([
        this.widgetRepo.getReadingDnaData(user.id, accessibleLibraryIds, since, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getUserCatalogReadingDnaData(user.id, since, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve(emptyReadingDnaRawData()),
      ]);
      const data = mergeReadingDnaRawData(localData, sourceBackedData);
      return computeReadingDna(data.avgPageCount, data.uniqueGenres, data.totalBooks, data.readingDaysRatio, data.peakHour, data.avgPagesPerHour);
    });
  }

  async getLongWait(user: RequestUser): Promise<LongWaitWidgetData | null> {
    return this.staleCache.get(String(user.id), 'long-wait', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const [localData, sourceBackedData] = await Promise.all([
        accessibleLibraryIds.length > 0 ? this.widgetRepo.getLongWait(user.id, accessibleLibraryIds, today, contentFilters) : Promise.resolve(null),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.getUserCatalogLongWait(user.id, today, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve(null),
      ]);
      return pickLongWait(localData, sourceBackedData);
    });
  }

  async getDiversityScore(user: RequestUser): Promise<DiversityScoreWidgetData> {
    return this.staleCache.get(String(user.id), 'diversity-score', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      if (sourceBackedMediaTypes.length === 0) {
        const data = await this.widgetRepo.getDiversityData(user.id, accessibleLibraryIds, contentFilters);
        return diversityScoreFromRawData(data);
      }

      const [localData, sourceBackedData] = await Promise.all([
        this.widgetRepo.getDiversityData(user.id, accessibleLibraryIds, contentFilters),
        this.warehouseCatalogService.getUserCatalogDiversityData(user.id, contentFilters, sourceBackedMediaTypes),
      ]);
      const data = mergeDiversityScoreRawData(localData, sourceBackedData);
      return diversityScoreFromRawData(data);
    });
  }

  async getReadingRhythm(user: RequestUser): Promise<ReadingRhythmWidgetData> {
    return this.liveCache.get(String(user.id), 'reading-rhythm', async () => {
      const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
      const libraryIds = libraries.map((library) => library.id);
      const accessibleLibraryIds = libraryIds.filter((libraryId) => libraryId > 0);
      const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraryIds);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const since = new Date(today);
      since.setUTCDate(since.getUTCDate() - 13);
      const sinceStr = formatDay(since);
      const [localDays, sourceBackedDays] = await Promise.all([
        this.widgetRepo.getReadingRhythmData(user.id, accessibleLibraryIds, sinceStr, contentFilters),
        sourceBackedMediaTypes.length > 0
          ? this.warehouseCatalogService.listReadingActivityDays(user.id, contentFilters, sourceBackedMediaTypes)
          : Promise.resolve([]),
      ]);
      const rawDays = mergeReadingRhythmDays(localDays, sourceBackedDays);
      const days = buildDaysSeries(rawDays, today, 14);
      const rhythm = computeRhythm(days);
      return { days, ...rhythm };
    });
  }
}

function mergeYearProjectionRawData(left: YearProjectionRawData, right: YearProjectionRawData): YearProjectionRawData {
  return {
    booksCompletedYtd: left.booksCompletedYtd + right.booksCompletedYtd,
    pagesReadLast30Days: left.pagesReadLast30Days + right.pagesReadLast30Days,
    hoursReadLast30Days: left.hoursReadLast30Days + right.hoursReadLast30Days,
    booksCompletedLast30Days: left.booksCompletedLast30Days + right.booksCompletedLast30Days,
  };
}

function emptyYearProjectionRawData(): YearProjectionRawData {
  return {
    booksCompletedYtd: 0,
    pagesReadLast30Days: 0,
    hoursReadLast30Days: 0,
    booksCompletedLast30Days: 0,
  };
}

function mergeChallengePatternRawData(left: ChallengePatternRawData, right: ChallengePatternRawData): ChallengePatternRawData {
  const totalBooksRead = left.totalBooksRead + right.totalBooksRead;
  const genresLast6Months = mergeDiversityKeys(left.genresLast6Months, right.genresLast6Months);
  const genresReadThisMonth = mergeDiversityKeys(left.genresReadThisMonth, right.genresReadThisMonth);
  const authorsReadThisMonth = mergeDiversityKeys(left.authorsReadThisMonth, right.authorsReadThisMonth);
  const readingDaysThisMonth = mergeReadingDnaDays(left.readingDaysThisMonth, right.readingDaysThisMonth);

  return {
    avgPageCount: totalBooksRead > 0 ? (left.avgPageCount * left.totalBooksRead + right.avgPageCount * right.totalBooksRead) / totalBooksRead : 0,
    uniqueGenresLast6Months: diversityKeyCount(genresLast6Months, left.uniqueGenresLast6Months + right.uniqueGenresLast6Months),
    staleInProgressCount: left.staleInProgressCount + right.staleInProgressCount,
    currentStreak: Math.max(left.currentStreak, right.currentStreak),
    topAuthorBookCount: Math.max(left.topAuthorBookCount, right.topAuthorBookCount),
    totalBooksRead,
    pagesThisMonth: left.pagesThisMonth + right.pagesThisMonth,
    shortBooksCompleted: left.shortBooksCompleted + right.shortBooksCompleted,
    newGenresRead: diversityKeyCount(genresReadThisMonth, left.newGenresRead + right.newGenresRead),
    oldestInProgressFinished: left.oldestInProgressFinished || right.oldestInProgressFinished,
    maxStreakThisMonth: readingDaysThisMonth
      ? computeLongestStreak(new Set(readingDaysThisMonth))
      : Math.max(left.maxStreakThisMonth, right.maxStreakThisMonth),
    newAuthorsRead: diversityKeyCount(authorsReadThisMonth, left.newAuthorsRead + right.newAuthorsRead),
    pagesReadThisMonth: left.pagesReadThisMonth + right.pagesReadThisMonth,
    genresLast6Months,
    genresReadThisMonth,
    authorsReadThisMonth,
    readingDaysThisMonth,
  };
}

function emptyChallengePatternRawData(): ChallengePatternRawData {
  return {
    avgPageCount: 0,
    uniqueGenresLast6Months: 0,
    staleInProgressCount: 0,
    currentStreak: 0,
    topAuthorBookCount: 0,
    totalBooksRead: 0,
    pagesThisMonth: 0,
    shortBooksCompleted: 0,
    newGenresRead: 0,
    oldestInProgressFinished: false,
    maxStreakThisMonth: 0,
    newAuthorsRead: 0,
    pagesReadThisMonth: 0,
    genresLast6Months: [],
    genresReadThisMonth: [],
    authorsReadThisMonth: [],
    readingDaysThisMonth: [],
  };
}

function mergeNeglectedGems(left: NeglectedGemsWidgetData, right: NeglectedGemsWidgetData): NeglectedGemsWidgetData {
  return {
    gems: [...left.gems, ...right.gems].sort((a, b) => b.waitingDays - a.waitingDays).slice(0, 5),
  };
}

function pickLongWait(left: LongWaitWidgetData | null, right: LongWaitWidgetData | null): LongWaitWidgetData | null {
  if (!left) return right;
  if (!right) return left;
  return right.waitingDays > left.waitingDays ? right : left;
}

function mergeReadingDnaRawData(left: ReadingDnaRawData, right: ReadingDnaRawData): ReadingDnaRawData {
  const totalBooks = left.totalBooks + right.totalBooks;
  const avgPageCount = totalBooks > 0 ? (left.avgPageCount * left.totalBooks + right.avgPageCount * right.totalBooks) / totalBooks : 0;
  const genresRead = mergeDiversityKeys(left.genresRead, right.genresRead);
  const readingDays = mergeReadingDnaDays(left.readingDays, right.readingDays);
  const lookbackDays = Math.max(left.lookbackDays ?? 0, right.lookbackDays ?? 0);
  const hourBuckets = mergeReadingDnaHourBuckets(left.hourBuckets, right.hourBuckets);
  const speedInputs = mergeReadingDnaSpeedInputs(left, right);

  return {
    avgPageCount,
    uniqueGenres: diversityKeyCount(genresRead, left.uniqueGenres + right.uniqueGenres),
    totalBooks,
    readingDaysRatio: readingDays && lookbackDays > 0 ? readingDays.length / lookbackDays : Math.max(left.readingDaysRatio, right.readingDaysRatio),
    peakHour: peakHourFromBuckets(hourBuckets, left.peakHour),
    avgPagesPerHour: speedInputs.seconds > 0 ? speedInputs.pages / (speedInputs.seconds / 3600) : (left.avgPagesPerHour ?? right.avgPagesPerHour),
    genresRead,
    readingDays,
    lookbackDays,
    hourBuckets,
    pagesReadForSpeed: speedInputs.pages,
    secondsReadForSpeed: speedInputs.seconds,
  };
}

function emptyReadingDnaRawData(): ReadingDnaRawData {
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

function diversityScoreFromRawData(data: DiversityScoreRawData): DiversityScoreWidgetData {
  return computeDiversityScore(
    data.uniqueGenresRead,
    data.totalGenresInLibrary,
    data.uniqueAuthorsRead,
    data.totalBooksRead,
    data.publicationYears,
    data.uniqueLanguages,
  );
}

function mergeDiversityScoreRawData(left: DiversityScoreRawData, right: DiversityScoreRawData): DiversityScoreRawData {
  const genresRead = mergeDiversityKeys(left.genresRead, right.genresRead);
  const genresInLibrary = mergeDiversityKeys(left.genresInLibrary, right.genresInLibrary);
  const authorsRead = mergeDiversityKeys(left.authorsRead, right.authorsRead);
  const languagesRead = mergeDiversityKeys(left.languagesRead, right.languagesRead);

  return {
    uniqueGenresRead: diversityKeyCount(genresRead, left.uniqueGenresRead + right.uniqueGenresRead),
    totalGenresInLibrary: diversityKeyCount(genresInLibrary, left.totalGenresInLibrary + right.totalGenresInLibrary),
    uniqueAuthorsRead: diversityKeyCount(authorsRead, left.uniqueAuthorsRead + right.uniqueAuthorsRead),
    totalBooksRead: left.totalBooksRead + right.totalBooksRead,
    publicationYears: [...left.publicationYears, ...right.publicationYears],
    uniqueLanguages: diversityKeyCount(languagesRead, left.uniqueLanguages + right.uniqueLanguages),
    genresRead,
    genresInLibrary,
    authorsRead,
    languagesRead,
  };
}

function mergeDiversityKeys(left?: string[], right?: string[]): string[] | undefined {
  if (!left || !right) return undefined;

  const values = new Set<string>();
  for (const value of [...(left ?? []), ...(right ?? [])]) {
    const normalized = normalizeDiversityKey(value);
    if (normalized) values.add(normalized);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

function diversityKeyCount(values: string[] | undefined, fallback: number): number {
  return values ? values.length : fallback;
}

function normalizeDiversityKey(value: string): string {
  return value.trim().toLowerCase();
}

function mergeReadingDnaDays(left?: string[], right?: string[]): string[] | undefined {
  if (!left || !right) return undefined;

  const values = new Set<string>();
  for (const value of [...left, ...right]) {
    const normalized = value.trim();
    if (normalized) values.add(normalized);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

function mergeReadingDnaHourBuckets(left?: ReadingDnaHourBucket[], right?: ReadingDnaHourBucket[]): ReadingDnaHourBucket[] | undefined {
  if (!left || !right) return undefined;

  const byHour = new Map<number, number>();
  for (const bucket of [...left, ...right]) {
    if (!Number.isInteger(bucket.hour) || bucket.hour < 0 || bucket.hour > 23) continue;
    byHour.set(bucket.hour, (byHour.get(bucket.hour) ?? 0) + Math.max(0, bucket.totalSeconds));
  }
  return [...byHour.entries()].map(([hour, totalSeconds]) => ({ hour, totalSeconds }));
}

function peakHourFromBuckets(hourBuckets: ReadingDnaHourBucket[] | undefined, fallback: number): number {
  if (!hourBuckets || hourBuckets.length === 0) return fallback;
  return hourBuckets.reduce((best, bucket) => (bucket.totalSeconds > best.totalSeconds ? bucket : best), hourBuckets[0]).hour;
}

function mergeReadingDnaSpeedInputs(left: ReadingDnaRawData, right: ReadingDnaRawData): { pages: number; seconds: number } {
  const leftHasInputs = left.pagesReadForSpeed !== undefined || left.secondsReadForSpeed !== undefined;
  const rightHasInputs = right.pagesReadForSpeed !== undefined || right.secondsReadForSpeed !== undefined;
  if (!leftHasInputs && !rightHasInputs) return { pages: 0, seconds: 0 };

  return {
    pages: Math.max(0, left.pagesReadForSpeed ?? 0) + Math.max(0, right.pagesReadForSpeed ?? 0),
    seconds: Math.max(0, left.secondsReadForSpeed ?? 0) + Math.max(0, right.secondsReadForSpeed ?? 0),
  };
}

function mergeReadingRhythmDays(
  localDays: { day: string; readingSeconds: number }[],
  sourceBackedDays: string[],
): { day: string; readingSeconds: number }[] {
  const byDay = new Map<string, number>();
  for (const day of localDays) {
    byDay.set(day.day, (byDay.get(day.day) ?? 0) + day.readingSeconds);
  }
  for (const day of sourceBackedDays) {
    if ((byDay.get(day) ?? 0) <= 0) {
      byDay.set(day, 1);
    }
  }
  return [...byDay.entries()].map(([day, readingSeconds]) => ({ day, readingSeconds }));
}

function sourceBackedMediaTypesForLibraryIds(libraryIds: number[]): WarehouseMediaType[] {
  const mediaTypes: WarehouseMediaType[] = [];
  if (libraryIds.includes(CLOUD_EBOOK_LIBRARY_ID)) mediaTypes.push('ebook');
  if (libraryIds.includes(CLOUD_AUDIO_LIBRARY_ID)) mediaTypes.push('audiobook');
  if (libraryIds.includes(CLOUD_COMIC_LIBRARY_ID)) mediaTypes.push('comic');
  return mediaTypes;
}

function emptyLibraryOverview(): LibraryOverviewWidgetData {
  return { totalBooks: 0, totalAuthors: 0, totalSeries: 0, totalStorageBytes: 0, booksAddedThisYear: 0 };
}
