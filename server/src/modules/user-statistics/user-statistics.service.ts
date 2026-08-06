import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';

import type {
  ChordDiagramData,
  WarehouseMediaType,
  ReadingSessionSource,
  ReadingSessionSourceBucket,
  UserCompletionLatencyDistribution,
  UserCompletionRaceBook,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserFavoriteDayStat,
  UserGenreReadingTimeItem,
  UserGoalTrajectory,
  UserGoalTrajectoryPoint,
  UserPeakHourStat,
  UserProgressFunnelComparison,
  UserProgressFunnel,
  UserReadingPacePoint,
  UserReadingSessionTimeline,
  UserReadingSessionTimelineItem,
  UserReadingSourceDistribution,
  UserReadingSurvivalPoint,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
} from '@bookorbit/types';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import { READING_SESSION_SOURCE_BUCKETS, emptySourceBucketRecord, toReadingSessionSourceBucket } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { StatsCache } from '../../common/cache/stats-cache';
import { LibraryService } from '../library/library.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import type { UserDailyReadingQueryDto } from './dto/user-daily-reading-query.dto';
import type { UserGoalTrajectoryQueryDto } from './dto/user-goal-trajectory-query.dto';
import type { UserSessionTimelineQueryDto } from './dto/user-session-timeline-query.dto';
import type { UpdateUserSessionTimelineSessionDto } from './dto/update-user-session-timeline-session.dto';
import type { UserStatisticsFilterQueryDto } from './dto/user-statistics-filter-query.dto';
import { UserStatisticsRepository } from './user-statistics.repository';

const HEATMAP_DEFAULT_DAYS = 365;
const BEHAVIOR_DEFAULT_DAYS = 365;
const COMPLETION_TIMELINE_DEFAULT_DAYS = 1825;
const GOAL_TRAJECTORY_DEFAULT_DAYS = 365;
const GOAL_TRAJECTORY_DEFAULT_GOAL_BOOKS = 12;
const PROGRESS_FUNNEL_DEFAULT_DAYS = 365;
const SESSION_TIMELINE_MAX_SESSIONS = 3000;
const COMPLETION_LATENCY_DEFAULT_DAYS = 1825;
const GENRE_READING_TIME_DEFAULT_DAYS = 365;
const READING_PACE_DEFAULT_DAYS = 1825;
const READING_SURVIVAL_DEFAULT_DAYS = 1825;
const COMPLETION_RACE_DEFAULT_DAYS = 1825;
const SESSION_ARCHETYPES_DEFAULT_DAYS = 365;
const USER_STATS_CACHE_TTL_MS = 300_000;
const USER_STATS_CACHE_MAX_ENTRIES = 2_000;

type UserStatisticsLibraryScope = {
  localLibraryIds: number[] | undefined;
  sourceBackedMediaTypes: WarehouseMediaType[];
  hasExplicitLibraryFilter: boolean;
};

@Injectable()
export class UserStatisticsService {
  private readonly cache = new StatsCache({ ttlMs: USER_STATS_CACHE_TTL_MS, maxEntries: USER_STATS_CACHE_MAX_ENTRIES });

  constructor(
    private readonly repo: UserStatisticsRepository,
    @Optional() private readonly libraryService?: LibraryService,
    @Optional() private readonly warehouseCatalogService?: WarehouseCatalogService,
  ) {}

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private startOfUtcMonth(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  private startOfUtcIsoWeek(date: Date): Date {
    const start = this.startOfUtcDay(date);
    const day = (start.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    start.setUTCDate(start.getUTCDate() - day);
    return start;
  }

  private getUtcIsoWeekYear(date: Date): number {
    const d = this.startOfUtcDay(date);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3); // Thursday
    return d.getUTCFullYear();
  }

  private getUtcIsoWeek(date: Date): number {
    const d = this.startOfUtcDay(date);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3); // Thursday
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDay = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
    return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604_800_000);
  }

  private getUtcIsoWeeksInYear(year: number): number {
    return this.getUtcIsoWeek(new Date(Date.UTC(year, 11, 28)));
  }

  private getUtcIsoWeekStart(year: number, week: number): Date {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const week1Start = this.startOfUtcIsoWeek(jan4);
    const weekStart = new Date(week1Start);
    weekStart.setUTCDate(week1Start.getUTCDate() + (week - 1) * 7);
    return weekStart;
  }

  private sinceDateForDays(days: number): Date {
    const normalized = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
    const startToday = this.startOfUtcDay(new Date());
    startToday.setUTCDate(startToday.getUTCDate() - (normalized - 1));
    return startToday;
  }

  private formatDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private roundProgressDelta(value: number): number {
    return Number(value.toFixed(4));
  }

  private mergeDailyReadingStats(items: UserDailyReadingStat[]): UserDailyReadingStat[] {
    const byDay = new Map<string, UserDailyReadingStat>();
    for (const item of items) {
      const existing = byDay.get(item.day);
      byDay.set(item.day, {
        day: item.day,
        readingSeconds: (existing?.readingSeconds ?? 0) + item.readingSeconds,
        progressDelta: (existing?.progressDelta ?? 0) + item.progressDelta,
        eventsCount: (existing?.eventsCount ?? 0) + item.eventsCount,
      });
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((item) => ({ ...item, progressDelta: this.roundProgressDelta(item.progressDelta) }));
  }

  private mergeFavoriteReadingDays(items: UserFavoriteDayStat[]): UserFavoriteDayStat[] {
    const byDay = new Map<number, UserFavoriteDayStat>();
    for (const item of items) {
      const existing = byDay.get(item.dayOfWeek);
      byDay.set(item.dayOfWeek, {
        dayOfWeek: item.dayOfWeek,
        readingSeconds: (existing?.readingSeconds ?? 0) + item.readingSeconds,
        eventsCount: (existing?.eventsCount ?? 0) + item.eventsCount,
        byFormat: this.mergeNumberRecords(existing?.byFormat, item.byFormat),
        bySource: this.mergeNumberRecords(existing?.bySource, item.bySource) as Record<ReadingSessionSourceBucket, number>,
      });
    }
    return [...byDay.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }

  private mergeGenreReadingTime(items: UserGenreReadingTimeItem[]): UserGenreReadingTimeItem[] {
    const byGenre = new Map<string, { readingSeconds: number; bySource: Record<ReadingSessionSourceBucket, number> }>();
    for (const item of items) {
      const existing = byGenre.get(item.genre);
      byGenre.set(item.genre, {
        readingSeconds: (existing?.readingSeconds ?? 0) + item.readingSeconds,
        bySource: this.mergeNumberRecords(existing?.bySource, item.bySource) as Record<ReadingSessionSourceBucket, number>,
      });
    }
    return [...byGenre.entries()]
      .map(([genre, entry]) => ({ genre, readingSeconds: entry.readingSeconds, bySource: entry.bySource }))
      .sort((a, b) => b.readingSeconds - a.readingSeconds)
      .slice(0, 30);
  }

  private mergeNumberRecords(left: Record<string, number> | undefined, right: Record<string, number> | undefined): Record<string, number> {
    const merged: Record<string, number> = { ...(left ?? {}) };
    for (const [key, value] of Object.entries(right ?? {})) {
      merged[key] = (merged[key] ?? 0) + value;
    }
    return merged;
  }

  private mergeChordData(left: ChordDiagramData, right: ChordDiagramData): ChordDiagramData {
    const nodeNames = new Set([...left.nodes.map((node) => node.name), ...right.nodes.map((node) => node.name)]);
    const links = new Map<string, { source: string; target: string; value: number }>();
    for (const link of [...left.links, ...right.links]) {
      const key = `${link.source}\u0000${link.target}`;
      const existing = links.get(key);
      links.set(key, {
        source: link.source,
        target: link.target,
        value: (existing?.value ?? 0) + link.value,
      });
    }
    return {
      nodes: [...nodeNames].map((name) => ({ name })),
      links: [...links.values()].sort((a, b) => b.value - a.value),
    };
  }

  private percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return Number(sorted[0].toFixed(1));
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    const weight = rank - low;
    const value = sorted[low] * (1 - weight) + sorted[high] * weight;
    return Number(value.toFixed(1));
  }

  private normalizeLibraryIds(libraryIds?: number[]): string {
    return [...(libraryIds ?? [])].sort((a, b) => a - b).join(',');
  }

  private buildUserCacheKey(metric: string, user: RequestUser, params: Record<string, string | number | undefined>): string {
    const pieces = Object.entries(params)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);
    return `${metric}|su=${user.isSuperuser ? 1 : 0}|${pieces.join('|')}`;
  }

  private shouldLoadLocal(scope: UserStatisticsLibraryScope): boolean {
    return (
      scope.localLibraryIds === undefined ||
      scope.localLibraryIds.length > 0 ||
      (!scope.hasExplicitLibraryFilter && scope.sourceBackedMediaTypes.length === 0)
    );
  }

  async getSummary(user: RequestUser, query: UserStatisticsFilterQueryDto): Promise<UserStatisticsSummary> {
    const key = this.buildUserCacheKey('summary', user, { libraries: this.normalizeLibraryIds(query.libraryIds) });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localSummary, sourceSummary] = await Promise.all([
        this.shouldLoadLocal(scope) ? this.repo.getSummary(user.id, user.isSuperuser, scope.localLibraryIds) : this.emptySummary(),
        scope.sourceBackedMediaTypes.length > 0 && this.warehouseCatalogService
          ? this.warehouseCatalogService.getUserReadingSummary(user.id, user.contentFilters, scope.sourceBackedMediaTypes)
          : this.emptySummary(),
      ]);
      const summary = this.mergeSummaries(localSummary, sourceSummary);
      return {
        ...summary,
        meanProgressPercent: Number(summary.meanProgressPercent.toFixed(2)),
      };
    });
  }

  async getDailyReading(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserDailyReadingStat[]> {
    const days = query.days ?? 365;
    const key = this.buildUserCacheKey('daily-reading', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localItems, sourceItems] = await Promise.all([
        this.shouldLoadLocal(scope) ? this.repo.getDailyReadingStats(user.id, user.isSuperuser, scope.localLibraryIds, days) : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogDailyReadingStats(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      return this.mergeDailyReadingStats([...localItems, ...sourceItems]);
    });
  }

  async getReadingHeatmap(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserDailyReadingStat[]> {
    const days = query.days ?? HEATMAP_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('reading-heatmap', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localItems, sourceItems, bySourceRows] = await Promise.all([
        this.shouldLoadLocal(scope) ? this.repo.getDailyReadingStats(user.id, user.isSuperuser, scope.localLibraryIds, days) : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogDailyReadingStats(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
        this.shouldLoadLocal(scope)
          ? this.repo.getDailyReadingSecondsBySource(user.id, user.isSuperuser, scope.localLibraryIds, days)
          : Promise.resolve([]),
      ]);
      const items = this.mergeDailyReadingStats([...localItems, ...sourceItems]);
      const byDay = new Map(items.map((item) => [item.day, item]));
      const bySourceByDay = new Map<string, Record<ReadingSessionSourceBucket, number>>();
      for (const row of bySourceRows) {
        let record = bySourceByDay.get(row.day);
        if (!record) {
          record = emptySourceBucketRecord();
          bySourceByDay.set(row.day, record);
        }
        record[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }
      const start = this.sinceDateForDays(days);
      const end = this.startOfUtcDay(new Date());
      const result: UserDailyReadingStat[] = [];

      for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const day = this.formatDayKey(cursor);
        const value = byDay.get(day);
        result.push({
          day,
          readingSeconds: value?.readingSeconds ?? 0,
          progressDelta: this.roundProgressDelta(value?.progressDelta ?? 0),
          eventsCount: value?.eventsCount ?? 0,
          bySource: bySourceByDay.get(day) ?? emptySourceBucketRecord(),
        });
      }

      return result;
    });
  }

  async getReadingSourceDistribution(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserReadingSourceDistribution> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('source-distribution', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const rows = await this.repo.getDailyReadingSecondsBySource(user.id, user.isSuperuser, query.libraryIds, days);
      const totals = emptySourceBucketRecord();
      for (const row of rows) {
        totals[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }
      const slices = READING_SESSION_SOURCE_BUCKETS.filter((bucket) => totals[bucket] > 0).map((bucket) => ({
        bucket,
        readingSeconds: totals[bucket],
      }));
      const totalSeconds = slices.reduce((sum, slice) => sum + slice.readingSeconds, 0);
      return { totalSeconds, slices };
    });
  }

  async getPeakReadingHours(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserPeakHourStat[]> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    const key = this.buildUserCacheKey('peak-hours', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days, timeZone });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        this.shouldLoadLocal(scope)
          ? this.repo.getPeakReadingHours(user.id, user.isSuperuser, scope.localLibraryIds, days, timeZone)
          : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogPeakReadingHours(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      const rows = [...localRows, ...sourceRows];

      const byHour = new Map<
        number,
        { readingSeconds: number; eventsCount: number; byFormat: Record<string, number>; bySource: Record<ReadingSessionSourceBucket, number> }
      >();
      for (const row of rows) {
        if (!byHour.has(row.hour)) {
          byHour.set(row.hour, { readingSeconds: 0, eventsCount: 0, byFormat: {}, bySource: emptySourceBucketRecord() });
        }
        const entry = byHour.get(row.hour)!;
        entry.readingSeconds += row.readingSeconds;
        entry.eventsCount += row.eventsCount;
        // Grouping now splits each hour by (format, source), so accumulate rather than assign.
        entry.byFormat[row.format] = (entry.byFormat[row.format] ?? 0) + row.readingSeconds;
        entry.bySource[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }

      return Array.from({ length: 24 }, (_, hour) => {
        const entry = byHour.get(hour);
        return {
          hour,
          readingSeconds: entry?.readingSeconds ?? 0,
          eventsCount: entry?.eventsCount ?? 0,
          byFormat: entry?.byFormat ?? {},
          bySource: entry?.bySource ?? emptySourceBucketRecord(),
        };
      });
    });
  }

  async getFavoriteReadingDays(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserFavoriteDayStat[]> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('favorite-days', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        this.shouldLoadLocal(scope) ? this.repo.getFavoriteReadingDays(user.id, user.isSuperuser, scope.localLibraryIds, days) : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogFavoriteReadingDays(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      const byDay = new Map<
        number,
        { readingSeconds: number; eventsCount: number; byFormat: Record<string, number>; bySource: Record<ReadingSessionSourceBucket, number> }
      >();
      for (const row of [...localRows, ...sourceRows]) {
        let entry = byDay.get(row.dayOfWeek);
        if (!entry) {
          entry = { readingSeconds: 0, eventsCount: 0, byFormat: {}, bySource: emptySourceBucketRecord() };
          byDay.set(row.dayOfWeek, entry);
        }
        entry.readingSeconds += row.readingSeconds;
        entry.eventsCount += row.eventsCount;
        entry.byFormat[row.format] = (entry.byFormat[row.format] ?? 0) + row.readingSeconds;
        entry.bySource[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }

      return Array.from({ length: 7 }, (_, dayOfWeek) => {
        const entry = byDay.get(dayOfWeek);
        return {
          dayOfWeek,
          readingSeconds: entry?.readingSeconds ?? 0,
          eventsCount: entry?.eventsCount ?? 0,
          byFormat: entry?.byFormat ?? {},
          bySource: entry?.bySource ?? emptySourceBucketRecord(),
        };
      });
    });
  }

  private toTimelineItem(row: {
    sessionId: number;
    bookId: number;
    bookTitle: string | null;
    bookFormat: string | null;
    source: ReadingSessionSource | null;
    startedAt: Date;
    endedAt: Date;
    durationSeconds: number;
    itemSource?: 'local' | 'warehouse';
    mediaType?: WarehouseMediaType;
    remoteId?: string;
  }): UserReadingSessionTimelineItem {
    return {
      sessionId: row.sessionId,
      bookId: row.bookId,
      bookTitle: row.bookTitle,
      bookFormat: row.bookFormat,
      bookSource: toReadingSessionSourceBucket(row.source),
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      durationSeconds: row.durationSeconds,
      source: row.itemSource,
      mediaType: row.mediaType,
      remoteId: row.remoteId,
    };
  }

  async getSessionTimeline(user: RequestUser, query: UserSessionTimelineQueryDto): Promise<UserReadingSessionTimeline> {
    const now = new Date();
    const defaultYear = this.getUtcIsoWeekYear(now);
    const defaultWeek = this.getUtcIsoWeek(now);
    const year = query.year ?? defaultYear;
    const weeksInYear = this.getUtcIsoWeeksInYear(year);
    const week = Math.min(Math.max(query.week ?? defaultWeek, 1), weeksInYear);
    const weekStart = this.getUtcIsoWeekStart(year, week);
    const weekEndExclusive = new Date(weekStart);
    weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 7);

    const key = this.buildUserCacheKey('session-timeline', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      year,
      week,
    });

    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        this.shouldLoadLocal(scope)
          ? this.repo.getSessionTimelineItems(
              user.id,
              user.isSuperuser,
              scope.localLibraryIds,
              weekStart,
              weekEndExclusive,
              SESSION_TIMELINE_MAX_SESSIONS,
            )
          : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogSessionTimelineItems(
              user.id,
              scope.sourceBackedMediaTypes,
              weekStart,
              weekEndExclusive,
              SESSION_TIMELINE_MAX_SESSIONS,
            )
          : Promise.resolve([]),
      ]);
      const rows = [...localRows, ...sourceRows]
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
        .slice(0, SESSION_TIMELINE_MAX_SESSIONS);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

      return {
        year,
        week,
        weekStart: this.formatDayKey(weekStart),
        weekEnd: this.formatDayKey(weekEnd),
        items: rows.map((row) => this.toTimelineItem(row)),
      };
    });
  }

  async updateSessionTimelineSession(
    user: RequestUser,
    sessionId: number,
    dto: UpdateUserSessionTimelineSessionDto,
    query: UserStatisticsFilterQueryDto,
  ): Promise<UserReadingSessionTimelineItem> {
    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())) {
      throw new BadRequestException('Invalid session timestamps');
    }
    if (endedAt <= startedAt) {
      throw new BadRequestException('Session end time must be after start time');
    }

    const localLibraryIds = await this.resolveLocalSessionLibraryIds(user, query.libraryIds);
    const existing =
      localLibraryIds === null ? null : await this.repo.getSessionTimelineSessionById(user.id, user.isSuperuser, localLibraryIds, sessionId);
    if (!existing) {
      throw new NotFoundException('Reading session not found');
    }

    const proposedDuration = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (proposedDuration !== existing.durationSeconds) {
      throw new BadRequestException('Dragging can move a session only; duration cannot change');
    }

    const moveResult = await this.repo.moveSessionTimelineSessionAtomic(
      user.id,
      sessionId,
      existing.libraryId,
      existing.startedAt,
      existing.endedAt,
      startedAt,
      endedAt,
      proposedDuration,
      resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC'),
    );
    if (moveResult.conflict) {
      const conflictStart = moveResult.conflict.startedAt.toISOString();
      throw new ConflictException(`Session overlaps with #${moveResult.conflict.sessionId} starting at ${conflictStart}`);
    }
    if (!moveResult.updated) {
      throw new NotFoundException('Reading session not found');
    }

    this.cache.clearForScope(String(user.id));

    return this.toTimelineItem(moveResult.updated);
  }

  async getCompletionTimeline(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserCompletionTimelinePoint[]> {
    const days = query.days ?? COMPLETION_TIMELINE_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('completion-timeline', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const rows = await this.getMonthlyCompletionRows(user, scope, days, (localLibraryIds) =>
        this.repo.getCompletionTimeline(user.id, user.isSuperuser, localLibraryIds, days),
      );
      const byMonth = new Map(rows.map((row) => [`${row.year}-${row.month}`, row.count]));
      const start = this.startOfUtcMonth(this.sinceDateForDays(days));
      const end = this.startOfUtcMonth(new Date());
      const result: UserCompletionTimelinePoint[] = [];

      for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth() + 1;
        result.push({
          year,
          month,
          count: byMonth.get(`${year}-${month}`) ?? 0,
        });
      }

      return result;
    });
  }

  async getGoalTrajectory(user: RequestUser, query: UserGoalTrajectoryQueryDto): Promise<UserGoalTrajectory> {
    const days = query.days ?? GOAL_TRAJECTORY_DEFAULT_DAYS;
    const goalBooks = query.goalBooks ?? GOAL_TRAJECTORY_DEFAULT_GOAL_BOOKS;
    const key = this.buildUserCacheKey('goal-trajectory', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      days,
      goalBooks,
    });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const rows = await this.getMonthlyCompletionRows(user, scope, days, (localLibraryIds) =>
        this.repo.getMonthlyCompletions(user.id, user.isSuperuser, localLibraryIds, days),
      );
      const byMonth = new Map(rows.map((row) => [`${row.year}-${row.month}`, row.count]));
      const start = this.startOfUtcMonth(this.sinceDateForDays(days));
      const end = this.startOfUtcMonth(new Date());
      const points: UserGoalTrajectoryPoint[] = [];
      const targetPerMonth = goalBooks / 12;
      let actualCumulative = 0;
      let monthIndex = 0;

      for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
        monthIndex += 1;
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth() + 1;
        const monthActual = byMonth.get(`${year}-${month}`) ?? 0;
        actualCumulative += monthActual;

        points.push({
          year,
          month,
          actualCumulative,
          targetCumulative: Number((targetPerMonth * monthIndex).toFixed(2)),
        });
      }

      return { goalBooks, points };
    });
  }

  async getProgressFunnel(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserProgressFunnelComparison> {
    const days = query.days ?? PROGRESS_FUNNEL_DEFAULT_DAYS;
    const comparePrevious = query.comparePrevious ?? false;
    const key = this.buildUserCacheKey('progress-funnel', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      days,
      comparePrevious: comparePrevious ? 1 : 0,
    });

    return this.cache.get(String(user.id), key, async () => {
      const currentSince = this.sinceDateForDays(days);
      const currentUntilExclusive = new Date(this.startOfUtcDay(new Date()));
      currentUntilExclusive.setUTCDate(currentUntilExclusive.getUTCDate() + 1);

      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const current = await this.getProgressFunnelInRange(user, scope, currentSince, currentUntilExclusive);

      let previous: UserProgressFunnel | null = null;
      if (comparePrevious) {
        const previousSince = new Date(currentSince);
        previousSince.setUTCDate(previousSince.getUTCDate() - days);
        previous = await this.getProgressFunnelInRange(user, scope, previousSince, currentSince);
      }

      return {
        days,
        current,
        previous,
      };
    });
  }

  private async resolveLibraryScope(user: RequestUser, requestedLibraryIds?: number[]): Promise<UserStatisticsLibraryScope> {
    const hasExplicitLibraryFilter = requestedLibraryIds !== undefined && requestedLibraryIds.length > 0;

    if (!this.libraryService || !this.warehouseCatalogService) {
      return {
        localLibraryIds: requestedLibraryIds ?? undefined,
        sourceBackedMediaTypes: [],
        hasExplicitLibraryFilter,
      };
    }

    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const accessibleIds = new Set(libraries.map((library) => library.id));
    const requestedIds = requestedLibraryIds && requestedLibraryIds.length > 0 ? requestedLibraryIds : [...accessibleIds];
    const selectedIds = requestedIds.filter((id) => accessibleIds.has(id));

    return {
      localLibraryIds: selectedIds.filter((id) => id > 0),
      sourceBackedMediaTypes: sourceBackedMediaTypesForLibraryIds(selectedIds),
      hasExplicitLibraryFilter,
    };
  }

  private emptySummary(): UserStatisticsSummary {
    return {
      trackedBooks: 0,
      startedBooks: 0,
      inProgressBooks: 0,
      completedBooks: 0,
      meanProgressPercent: 0,
    };
  }

  private mergeSummaries(left: UserStatisticsSummary, right: UserStatisticsSummary): UserStatisticsSummary {
    const trackedBooks = left.trackedBooks + right.trackedBooks;
    const weightedProgress =
      trackedBooks > 0 ? (left.meanProgressPercent * left.trackedBooks + right.meanProgressPercent * right.trackedBooks) / trackedBooks : 0;

    return {
      trackedBooks,
      startedBooks: left.startedBooks + right.startedBooks,
      inProgressBooks: left.inProgressBooks + right.inProgressBooks,
      completedBooks: left.completedBooks + right.completedBooks,
      meanProgressPercent: weightedProgress,
    };
  }

  private emptyProgressFunnel(): UserProgressFunnel {
    return {
      started: 0,
      reached25: 0,
      reached50: 0,
      reached75: 0,
      completed: 0,
    };
  }

  private mergeProgressFunnels(left: UserProgressFunnel, right: UserProgressFunnel): UserProgressFunnel {
    return {
      started: left.started + right.started,
      reached25: left.reached25 + right.reached25,
      reached50: left.reached50 + right.reached50,
      reached75: left.reached75 + right.reached75,
      completed: left.completed + right.completed,
    };
  }

  private mergeMonthlyCompletions(left: UserCompletionTimelinePoint[], right: UserCompletionTimelinePoint[]): UserCompletionTimelinePoint[] {
    const byMonth = new Map<string, UserCompletionTimelinePoint>();
    for (const row of [...left, ...right]) {
      const key = `${row.year}-${row.month}`;
      const existing = byMonth.get(key);
      byMonth.set(key, {
        year: row.year,
        month: row.month,
        count: (existing?.count ?? 0) + row.count,
      });
    }
    return [...byMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month);
  }

  private async getMonthlyCompletionRows(
    user: RequestUser,
    scope: UserStatisticsLibraryScope,
    days: number,
    loadLocal: (localLibraryIds: number[] | undefined) => Promise<UserCompletionTimelinePoint[]>,
  ): Promise<UserCompletionTimelinePoint[]> {
    const [localRows, sourceRows] = await Promise.all([
      this.shouldLoadLocal(scope) ? loadLocal(scope.localLibraryIds) : Promise.resolve([]),
      scope.sourceBackedMediaTypes.length > 0 && this.warehouseCatalogService
        ? this.warehouseCatalogService.getUserMonthlyCompletions(user.id, user.contentFilters, scope.sourceBackedMediaTypes, days)
        : Promise.resolve([]),
    ]);

    return this.mergeMonthlyCompletions(localRows, sourceRows);
  }

  private async getProgressFunnelInRange(
    user: RequestUser,
    scope: UserStatisticsLibraryScope,
    since: Date,
    untilExclusive: Date,
  ): Promise<UserProgressFunnel> {
    const [localFunnel, sourceFunnel] = await Promise.all([
      this.shouldLoadLocal(scope)
        ? this.repo.getProgressFunnelInRange(user.id, user.isSuperuser, scope.localLibraryIds, since, untilExclusive)
        : this.emptyProgressFunnel(),
      scope.sourceBackedMediaTypes.length > 0 && this.warehouseCatalogService
        ? this.warehouseCatalogService.getUserProgressFunnelInRange(user.id, user.contentFilters, scope.sourceBackedMediaTypes, since, untilExclusive)
        : this.emptyProgressFunnel(),
    ]);

    return this.mergeProgressFunnels(localFunnel, sourceFunnel);
  }

  private async resolveLocalSessionLibraryIds(user: RequestUser, requestedLibraryIds?: number[]): Promise<number[] | undefined | null> {
    const scope = await this.resolveLibraryScope(user, requestedLibraryIds);
    if (scope.localLibraryIds === undefined) return undefined;
    return scope.localLibraryIds.length > 0 ? scope.localLibraryIds : null;
  }

  async getCompletionLatency(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserCompletionLatencyDistribution> {
    const days = query.days ?? COMPLETION_LATENCY_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('completion-latency', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localValues, sourceValues] = await Promise.all([
        this.shouldLoadLocal(scope)
          ? this.repo.getCompletionLatencyDays(user.id, user.isSuperuser, scope.localLibraryIds, days)
          : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0 && this.warehouseCatalogService
          ? this.warehouseCatalogService.getUserCompletionLatencyDays(user.id, user.contentFilters, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      const values = [...localValues, ...sourceValues];
      const sorted = [...values].sort((a, b) => a - b);

      const buckets = [
        { label: '0-7d', minDays: 0, maxDays: 7, count: 0 },
        { label: '8-30d', minDays: 8, maxDays: 30, count: 0 },
        { label: '31-90d', minDays: 31, maxDays: 90, count: 0 },
        { label: '91-180d', minDays: 91, maxDays: 180, count: 0 },
        { label: '181-365d', minDays: 181, maxDays: 365, count: 0 },
        { label: '366-730d', minDays: 366, maxDays: 730, count: 0 },
        { label: '731d+', minDays: 731, maxDays: null, count: 0 },
      ];

      for (const value of sorted) {
        const rounded = Math.round(value);
        const target =
          buckets.find((bucket) => rounded >= bucket.minDays && (bucket.maxDays === null || rounded <= bucket.maxDays)) ??
          buckets[buckets.length - 1];
        target.count += 1;
      }

      return {
        totalCompletions: sorted.length,
        medianDays: this.percentile(sorted, 50),
        percentile75Days: this.percentile(sorted, 75),
        percentile90Days: this.percentile(sorted, 90),
        buckets,
      };
    });
  }

  async getReadingSurvival(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserReadingSurvivalPoint[]> {
    const days = query.days ?? READING_SURVIVAL_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('reading-survival', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localValues, sourceValues] = await Promise.all([
        this.shouldLoadLocal(scope)
          ? this.repo.getReadingSurvivalMaxProgress(user.id, user.isSuperuser, scope.localLibraryIds, days)
          : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0 && this.warehouseCatalogService
          ? this.warehouseCatalogService.getUserReadingSurvivalMaxProgress(user.id, user.contentFilters, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      const values = [...localValues, ...sourceValues];
      const total = values.length;
      const thresholds = Array.from({ length: 21 }, (_, i) => i * 5);
      return thresholds.map((threshold) => {
        const survivedCount = values.filter((v) => v >= threshold).length;
        return {
          threshold,
          survivedCount,
          survivedPct: total > 0 ? Number(((survivedCount / total) * 100).toFixed(1)) : 0,
        };
      });
    });
  }

  async getCompletionRace(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserCompletionRaceBook[]> {
    const days = query.days ?? COMPLETION_RACE_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('completion-race', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        this.shouldLoadLocal(scope)
          ? this.repo.getCompletionRaceRawSessions(user.id, user.isSuperuser, scope.localLibraryIds, days)
          : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogCompletionRaceRawSessions(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      const rows = [...localRows, ...sourceRows];
      const byBook = new Map<number, { title: string; sessions: { startedAt: Date; endProgress: number }[] }>();

      for (const row of rows) {
        if (!byBook.has(row.bookId)) {
          byBook.set(row.bookId, { title: row.title ?? `Book ${row.bookId}`, sessions: [] });
        }
        byBook.get(row.bookId)!.sessions.push({ startedAt: row.startedAt, endProgress: row.endProgress });
      }

      const result: UserCompletionRaceBook[] = [];
      for (const [bookId, { title, sessions }] of byBook.entries()) {
        if (sessions.length < 2) continue;
        const firstMs = sessions[0].startedAt.getTime();
        result.push({
          bookId,
          title: title.length > 40 ? `${title.slice(0, 37)}...` : title,
          points: sessions.map((s) => ({
            daysSinceStart: Number(((s.startedAt.getTime() - firstMs) / 86_400_000).toFixed(2)),
            progress: Number(s.endProgress.toFixed(1)),
          })),
        });
      }

      return result;
    });
  }

  async getSessionArchetypes(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserSessionArchetypePoint[]> {
    const days = query.days ?? SESSION_ARCHETYPES_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('session-archetypes', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        this.shouldLoadLocal(scope)
          ? this.repo.getSessionArchetypePoints(user.id, user.isSuperuser, scope.localLibraryIds, days)
          : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogSessionArchetypePoints(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      return [...localRows, ...sourceRows];
    });
  }

  async getGenreReadingTime(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserGenreReadingTimeItem[]> {
    const days = query.days ?? GENRE_READING_TIME_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('genre-reading-time', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        this.shouldLoadLocal(scope) ? this.repo.getGenreReadingTime(user.id, user.isSuperuser, scope.localLibraryIds, days) : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogGenreReadingTime(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      const byGenre = new Map<string, { readingSeconds: number; bySource: Record<ReadingSessionSourceBucket, number> }>();
      for (const row of [...localRows, ...sourceRows]) {
        let entry = byGenre.get(row.genre);
        if (!entry) {
          entry = { readingSeconds: 0, bySource: emptySourceBucketRecord() };
          byGenre.set(row.genre, entry);
        }
        entry.readingSeconds += row.readingSeconds;
        entry.bySource[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }

      return Array.from(byGenre, ([genre, entry]) => ({ genre, readingSeconds: entry.readingSeconds, bySource: entry.bySource }))
        .sort((a, b) => b.readingSeconds - a.readingSeconds)
        .slice(0, 30);
    });
  }

  async getReadingPace(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserReadingPacePoint[]> {
    const days = query.days ?? READING_PACE_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('reading-pace', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localRows, sourceRows] = await Promise.all([
        this.shouldLoadLocal(scope) ? this.repo.getReadingPacePoints(user.id, user.isSuperuser, scope.localLibraryIds, days) : Promise.resolve([]),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogReadingPacePoints(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve([]),
      ]);
      return [...localRows, ...sourceRows].slice(0, 2000);
    });
  }

  async getAuthorGenreChord(user: RequestUser, query: UserDailyReadingQueryDto): Promise<ChordDiagramData> {
    const days = query.days ?? 1825;
    const key = this.buildUserCacheKey('author-genre-chord', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const scope = await this.resolveLibraryScope(user, query.libraryIds);
      const [localData, sourceData] = await Promise.all([
        this.shouldLoadLocal(scope)
          ? this.repo.getAuthorGenreChord(user.id, user.isSuperuser, scope.localLibraryIds, days)
          : Promise.resolve({ nodes: [], links: [] } satisfies ChordDiagramData),
        scope.sourceBackedMediaTypes.length > 0
          ? this.repo.getCatalogAuthorGenreChord(user.id, scope.sourceBackedMediaTypes, days)
          : Promise.resolve({ nodes: [], links: [] } satisfies ChordDiagramData),
      ]);
      return this.mergeChordData(localData, sourceData);
    });
  }

  async recomputeRecentDailyStats(days = 2) {
    const result = await this.repo.recomputeRecentDailyStats(days);
    this.cache.clear();
    return result;
  }
}

function sourceBackedMediaTypesForLibraryIds(libraryIds: number[]): WarehouseMediaType[] {
  const mediaTypes: WarehouseMediaType[] = [];
  if (libraryIds.includes(CLOUD_EBOOK_LIBRARY_ID)) mediaTypes.push('ebook');
  if (libraryIds.includes(CLOUD_AUDIO_LIBRARY_ID)) mediaTypes.push('audiobook');
  if (libraryIds.includes(CLOUD_COMIC_LIBRARY_ID)) mediaTypes.push('comic');
  return mediaTypes;
}
