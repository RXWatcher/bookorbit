import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  ChordDiagramData,
  WarehouseMediaType,
  ReadingSessionSource,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserProgressFunnel,
  UserReadingPacePoint,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
} from '@bookorbit/types';
import { toReadingSessionSourceBucket } from '@bookorbit/types';

import {
  aggregateReadingSessionDailyStats,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  type ReadingDailyStatsSegment,
} from '../../common/utils/reading-daily-stats.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  bookFiles,
  bookGenres,
  bookMetadata,
  books,
  genres,
  readingProgress,
  readingSessions,
  userBookStatus,
  userLibraryAccess,
  userReadingDailyStats,
  users,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type SessionTimelineItemRow = {
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
};
type SessionTimelineSessionRow = SessionTimelineItemRow & {
  libraryId: number;
};
type SessionTimelineConflictRow = {
  sessionId: number;
  startedAt: Date;
  endedAt: Date;
};
const RECENT_DAILY_AGGREGATION_DAYS = 2;

@Injectable()
export class UserStatisticsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async getAccessibleLibraryIds(userId: number, isSuperuser: boolean): Promise<number[] | null> {
    if (isSuperuser) return null;
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  private intersectLibraryIds(accessible: number[] | null, requested: number[] | number | undefined): number[] | null {
    const requestedIds = Array.isArray(requested) ? requested : requested == null ? [] : [requested];
    if (requestedIds.length === 0) return accessible;
    if (accessible === null) return requestedIds;
    const set = new Set(accessible);
    return requestedIds.filter((id) => set.has(id));
  }

  private libraryFilter(libraryIds: number[] | null) {
    if (libraryIds === null) return undefined;
    if (libraryIds.length === 0) return sql`false`;
    return inArray(books.libraryId, libraryIds);
  }

  private dailyStatsLibraryFilter(libraryIds: number[] | null) {
    if (libraryIds === null) return undefined;
    if (libraryIds.length === 0) return sql`false`;
    return inArray(userReadingDailyStats.libraryId, libraryIds);
  }

  private warehouseMediaTypeFilter(mediaTypes: WarehouseMediaType[]) {
    if (mediaTypes.length === 0) return sql`false`;
    return inArray(schema.warehouseReadingSessions.mediaType, mediaTypes);
  }

  private warehouseMediaTypeSql(mediaTypes: WarehouseMediaType[]) {
    if (mediaTypes.length === 0) return sql`false`;
    return sql`wrs.media_type in (${sql.join(
      mediaTypes.map((mediaType) => sql`${mediaType}`),
      sql`, `,
    )})`;
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private sinceDateForDays(days: number): Date {
    const normalized = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
    const now = new Date();
    const startToday = this.startOfUtcDay(now);
    startToday.setUTCDate(startToday.getUTCDate() - (normalized - 1));
    return startToday;
  }

  private formatDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async getSummary(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]): Promise<UserStatisticsSummary> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryIds = this.intersectLibraryIds(accessible, filterLibraryIds);
    const libraryFilter = this.libraryFilter(libraryIds);

    // Status counts come from user_book_status (respects manual overrides)
    const [statusRow] = await this.db
      .select({
        trackedBooks: sql<number>`count(*)::int`,
        startedBooks: sql<number>`count(*) filter (where ${userBookStatus.status} in ('reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned'))::int`,
        inProgressBooks: sql<number>`count(*) filter (where ${userBookStatus.status} in ('reading', 'on_hold', 'rereading'))::int`,
        completedBooks: sql<number>`count(*) filter (where ${userBookStatus.status} = 'read')::int`,
      })
      .from(userBookStatus)
      .innerJoin(books, eq(books.id, userBookStatus.bookId))
      .where(and(eq(userBookStatus.userId, userId), libraryFilter));

    // meanProgressPercent stays derived from actual reading position
    const perBookProgress = this.db
      .select({
        bookId: bookFiles.bookId,
        maxPercentage: sql<number>`max(${readingProgress.percentage})`.as('max_percentage'),
      })
      .from(readingProgress)
      .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingProgress.userId, userId), libraryFilter))
      .groupBy(bookFiles.bookId)
      .as('per_book_progress');

    const [progressRow] = await this.db
      .select({ meanProgressPercent: sql<number>`coalesce(avg(${perBookProgress.maxPercentage}), 0)::float` })
      .from(perBookProgress);

    return {
      trackedBooks: statusRow?.trackedBooks ?? 0,
      startedBooks: statusRow?.startedBooks ?? 0,
      inProgressBooks: statusRow?.inProgressBooks ?? 0,
      completedBooks: statusRow?.completedBooks ?? 0,
      meanProgressPercent: progressRow?.meanProgressPercent ?? 0,
    };
  }

  async getDailyReadingStats(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserDailyReadingStat[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.dailyStatsLibraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const sinceDay = this.sinceDateForDays(days).toISOString().slice(0, 10);

    return this.db
      .select({
        day: userReadingDailyStats.day,
        readingSeconds: sql<number>`coalesce(sum(${userReadingDailyStats.readingSeconds}), 0)::int`,
        progressDelta: sql<number>`coalesce(sum(${userReadingDailyStats.progressDelta}), 0)::float`,
        eventsCount: sql<number>`coalesce(sum(${userReadingDailyStats.sessionsCount}), 0)::int`,
      })
      .from(userReadingDailyStats)
      .where(and(eq(userReadingDailyStats.userId, userId), gte(userReadingDailyStats.day, sinceDay), libraryFilter))
      .groupBy(userReadingDailyStats.day)
      .orderBy(userReadingDailyStats.day);
  }

  async getCatalogDailyReadingStats(userId: number, mediaTypes: WarehouseMediaType[], days = 365): Promise<UserDailyReadingStat[]> {
    const mediaFilter = this.warehouseMediaTypeFilter(mediaTypes);
    const since = this.sinceDateForDays(days);

    return this.db
      .select({
        day: sql<string>`date_trunc('day', ${schema.warehouseReadingSessions.startedAt})::date::text`,
        readingSeconds: sql<number>`coalesce(sum(${schema.warehouseReadingSessions.durationSeconds}), 0)::int`,
        progressDelta: sql<number>`coalesce(sum(${schema.warehouseReadingSessions.progressDelta}), 0)::float`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(schema.warehouseReadingSessions)
      .where(and(eq(schema.warehouseReadingSessions.userId, userId), gte(schema.warehouseReadingSessions.startedAt, since), mediaFilter))
      .groupBy(sql`date_trunc('day', ${schema.warehouseReadingSessions.startedAt})::date`)
      .orderBy(sql`date_trunc('day', ${schema.warehouseReadingSessions.startedAt})::date`);
  }

  async getPeakReadingHours(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
    timeZone = 'UTC',
  ): Promise<{ hour: number; format: string; source: ReadingSessionSource | null; readingSeconds: number; eventsCount: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const resolvedTimeZone = resolveTimeZone(timeZone, 'UTC');
    const hourExpr = sql<number>`extract(hour from (${readingSessions.startedAt} AT TIME ZONE ${resolvedTimeZone}))::int`;
    const formatExpr = sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`;

    const sessionBuckets = this.db
      .select({
        hour: hourExpr.as('hour'),
        format: formatExpr.as('format'),
        source: readingSessions.source,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .as('session_buckets');

    return this.db
      .select({
        hour: sessionBuckets.hour,
        format: sessionBuckets.format,
        source: sessionBuckets.source,
        readingSeconds: sql<number>`coalesce(sum(${sessionBuckets.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(sessionBuckets)
      .groupBy(sessionBuckets.hour, sessionBuckets.format, sessionBuckets.source)
      .orderBy(sessionBuckets.hour);
  }

  async getCatalogPeakReadingHours(
    userId: number,
    mediaTypes: WarehouseMediaType[],
    days = 365,
  ): Promise<{ hour: number; format: string; source: ReadingSessionSource | null; readingSeconds: number; eventsCount: number }[]> {
    const mediaFilter = this.warehouseMediaTypeFilter(mediaTypes);
    const since = this.sinceDateForDays(days);
    const hourExpr = sql<number>`extract(hour from ${schema.warehouseReadingSessions.startedAt})::int`;
    const formatExpr = sql<string>`upper(coalesce(${schema.warehouseCatalogItems.format}, ${schema.warehouseReadingSessions.mediaType}::text, 'UNKNOWN'))`;

    return this.db
      .select({
        hour: hourExpr,
        format: formatExpr,
        source: sql<ReadingSessionSource | null>`null`,
        readingSeconds: sql<number>`coalesce(sum(${schema.warehouseReadingSessions.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(schema.warehouseReadingSessions)
      .leftJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseCatalogItems.mediaType, schema.warehouseReadingSessions.mediaType),
          eq(schema.warehouseCatalogItems.remoteId, schema.warehouseReadingSessions.remoteId),
        ),
      )
      .where(and(eq(schema.warehouseReadingSessions.userId, userId), gte(schema.warehouseReadingSessions.startedAt, since), mediaFilter))
      .groupBy(hourExpr, formatExpr)
      .orderBy(hourExpr);
  }

  async getSessionTimelineItems(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    sinceInclusive: Date,
    untilExclusive: Date,
    limit = 3000,
  ): Promise<SessionTimelineItemRow[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    return this.db
      .select({
        sessionId: readingSessions.id,
        bookId: readingSessions.bookId,
        bookTitle: bookMetadata.title,
        bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
        source: readingSessions.source,
        itemSource: sql<'local'>`'local'`,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          lt(readingSessions.startedAt, untilExclusive),
          gt(readingSessions.endedAt, sinceInclusive),
          libraryFilter,
        ),
      )
      .orderBy(readingSessions.startedAt)
      .limit(limit);
  }

  async getCatalogSessionTimelineItems(
    userId: number,
    mediaTypes: WarehouseMediaType[],
    sinceInclusive: Date,
    untilExclusive: Date,
    limit = 3000,
  ): Promise<SessionTimelineItemRow[]> {
    const mediaFilter = this.warehouseMediaTypeFilter(mediaTypes);

    return this.db
      .select({
        sessionId: schema.warehouseReadingSessions.id,
        bookId: sql<number>`-${schema.warehouseCatalogItems.id}`,
        bookTitle: schema.warehouseCatalogItems.title,
        bookFormat: sql<string | null>`nullif(${schema.warehouseCatalogItems.format}, '')`,
        startedAt: schema.warehouseReadingSessions.startedAt,
        endedAt: schema.warehouseReadingSessions.endedAt,
        durationSeconds: schema.warehouseReadingSessions.durationSeconds,
        source: sql<ReadingSessionSource | null>`null`,
        itemSource: sql<'warehouse'>`'warehouse'`,
        mediaType: schema.warehouseReadingSessions.mediaType,
        remoteId: schema.warehouseReadingSessions.remoteId,
      })
      .from(schema.warehouseReadingSessions)
      .innerJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseCatalogItems.mediaType, schema.warehouseReadingSessions.mediaType),
          eq(schema.warehouseCatalogItems.remoteId, schema.warehouseReadingSessions.remoteId),
        ),
      )
      .where(
        and(
          eq(schema.warehouseReadingSessions.userId, userId),
          lt(schema.warehouseReadingSessions.startedAt, untilExclusive),
          gt(schema.warehouseReadingSessions.endedAt, sinceInclusive),
          mediaFilter,
        ),
      )
      .orderBy(schema.warehouseReadingSessions.startedAt)
      .limit(limit);
  }

  async getSessionTimelineSessionById(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    sessionId: number,
  ): Promise<SessionTimelineSessionRow | null> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const [row] = await this.db
      .select({
        sessionId: readingSessions.id,
        libraryId: books.libraryId,
        bookId: readingSessions.bookId,
        bookTitle: bookMetadata.title,
        bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
        source: readingSessions.source,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId), libraryFilter))
      .limit(1);

    return row ?? null;
  }

  async moveSessionTimelineSessionAtomic(
    userId: number,
    sessionId: number,
    libraryId: number,
    previousStartedAt: Date,
    previousEndedAt: Date,
    startedAt: Date,
    endedAt: Date,
    durationSeconds: number,
    timeZone = 'UTC',
  ): Promise<{ updated: SessionTimelineSessionRow | null; conflict: SessionTimelineConflictRow | null }> {
    return this.db.transaction(async (tx) => {
      // Serialize edits per user to avoid race conditions between concurrent drags.
      await tx.execute(sql`select pg_advisory_xact_lock(${userId}::bigint)`);

      const [conflict] = await tx
        .select({
          sessionId: readingSessions.id,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
        })
        .from(readingSessions)
        .where(
          and(
            eq(readingSessions.userId, userId),
            ne(readingSessions.id, sessionId),
            lt(readingSessions.startedAt, endedAt),
            gt(readingSessions.endedAt, startedAt),
          ),
        )
        .orderBy(readingSessions.startedAt)
        .limit(1);

      if (conflict) return { updated: null, conflict };

      const touched = await tx
        .update(readingSessions)
        .set({ startedAt, endedAt, durationSeconds })
        .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId)))
        .returning({ id: readingSessions.id });
      if (touched.length === 0) return { updated: null, conflict: null };

      const uniqueDays = [
        ...new Set([
          ...getReadingSessionDayKeys({ startedAt: previousStartedAt, endedAt: previousEndedAt, durationSeconds, progressDelta: null }, timeZone),
          ...getReadingSessionDayKeys({ startedAt, endedAt, durationSeconds, progressDelta: null }, timeZone),
        ]),
      ];
      if (uniqueDays.length > 0) {
        await this.recomputeDailyStats(tx, userId, libraryId, uniqueDays, timeZone);
      }

      const [updated] = await tx
        .select({
          sessionId: readingSessions.id,
          libraryId: books.libraryId,
          bookId: readingSessions.bookId,
          bookTitle: bookMetadata.title,
          bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
          source: readingSessions.source,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
        .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId)))
        .limit(1);

      return { updated: updated ?? null, conflict: null };
    });
  }

  private async recomputeDailyStats(tx: Tx, userId: number, libraryId: number, days: string[], timeZone: string): Promise<void> {
    const affectedDays = [...new Set(days)].sort();
    if (affectedDays.length === 0) return;

    await this.lockDailyStats(tx, userId, libraryId);

    await tx
      .delete(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          eq(userReadingDailyStats.libraryId, libraryId),
          inArray(userReadingDailyStats.day, affectedDays),
        ),
      );

    const range = getDayRangeForDateKeys(affectedDays, timeZone);
    if (!range) return;

    const rows = await tx
      .select({
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
        progressDelta: readingSessions.progressDelta,
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(books.libraryId, libraryId),
          lt(readingSessions.startedAt, range.end),
          gt(readingSessions.endedAt, range.start),
        ),
      );

    const segments = aggregateReadingSessionDailyStats(
      rows.map((row) => ({
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        progressDelta: row.progressDelta ?? null,
      })),
      timeZone,
      new Set(affectedDays),
    );
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments);
  }

  private async lockDailyStats(tx: Tx, userId: number, libraryId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
  }

  private async insertDailyStatsSegments(tx: Tx, userId: number, libraryId: number, segments: ReadingDailyStatsSegment[]): Promise<void> {
    if (segments.length === 0) return;

    const now = new Date();
    await tx
      .insert(userReadingDailyStats)
      .values(
        segments.map((segment) => ({
          userId,
          libraryId,
          day: segment.day,
          readingSeconds: segment.readingSeconds,
          progressDelta: segment.progressDelta,
          sessionsCount: segment.sessionsCount,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [userReadingDailyStats.userId, userReadingDailyStats.libraryId, userReadingDailyStats.day],
        set: {
          readingSeconds: sql`excluded.reading_seconds`,
          progressDelta: sql`excluded.progress_delta`,
          sessionsCount: sql`excluded.sessions_count`,
          updatedAt: now,
        },
      });
  }

  async getFavoriteReadingDays(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
  ): Promise<{ dayOfWeek: number; source: ReadingSessionSource | null; format: string; readingSeconds: number; eventsCount: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const dayOfWeekExpr = sql<number>`extract(dow from ${readingSessions.startedAt})::int`;
    const formatExpr = sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`;

    return this.db
      .select({
        dayOfWeek: dayOfWeekExpr,
        source: readingSessions.source,
        format: formatExpr,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(dayOfWeekExpr, readingSessions.source, formatExpr)
      .orderBy(dayOfWeekExpr);
  }

  async getCatalogFavoriteReadingDays(
    userId: number,
    mediaTypes: WarehouseMediaType[],
    days = 365,
  ): Promise<{ dayOfWeek: number; source: ReadingSessionSource | null; format: string; readingSeconds: number; eventsCount: number }[]> {
    const mediaFilter = this.warehouseMediaTypeFilter(mediaTypes);
    const since = this.sinceDateForDays(days);
    const dayOfWeekExpr = sql<number>`extract(dow from ${schema.warehouseReadingSessions.startedAt})::int`;
    const formatExpr = sql<string>`upper(coalesce(${schema.warehouseCatalogItems.format}, ${schema.warehouseReadingSessions.mediaType}::text, 'UNKNOWN'))`;

    return this.db
      .select({
        dayOfWeek: dayOfWeekExpr,
        source: sql<ReadingSessionSource | null>`null`,
        format: formatExpr,
        readingSeconds: sql<number>`coalesce(sum(${schema.warehouseReadingSessions.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(schema.warehouseReadingSessions)
      .leftJoin(
        schema.warehouseCatalogItems,
        and(
          eq(schema.warehouseCatalogItems.mediaType, schema.warehouseReadingSessions.mediaType),
          eq(schema.warehouseCatalogItems.remoteId, schema.warehouseReadingSessions.remoteId),
        ),
      )
      .where(and(eq(schema.warehouseReadingSessions.userId, userId), gte(schema.warehouseReadingSessions.startedAt, since), mediaFilter))
      .groupBy(dayOfWeekExpr, formatExpr)
      .orderBy(dayOfWeekExpr);
  }

  async getCompletionTimeline(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 1825,
  ): Promise<UserCompletionTimelinePoint[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const firstCompletion = this.db
      .select({
        bookId: readingSessions.bookId,
        firstCompletedAt: sql<Date>`min(${readingSessions.endedAt})`.as('first_completed_at'),
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.endProgress, 99), libraryFilter))
      .groupBy(readingSessions.bookId)
      .as('first_completion');

    const yearExpr = sql<number>`extract(year from ${firstCompletion.firstCompletedAt})::int`;
    const monthExpr = sql<number>`extract(month from ${firstCompletion.firstCompletedAt})::int`;

    return this.db
      .select({
        year: yearExpr,
        month: monthExpr,
        count: sql<number>`count(*)::int`,
      })
      .from(firstCompletion)
      .where(sql`${firstCompletion.firstCompletedAt} >= ${since}`)
      .groupBy(yearExpr, monthExpr)
      .orderBy(yearExpr, monthExpr);
  }

  async getMonthlyCompletions(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserCompletionTimelinePoint[]> {
    return this.getCompletionTimeline(userId, isSuperuser, filterLibraryIds, days);
  }

  async getProgressFunnelInRange(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    since: Date,
    untilExclusive?: Date,
  ): Promise<UserProgressFunnel> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const timeFilter = untilExclusive
      ? and(gte(readingSessions.startedAt, since), lt(readingSessions.startedAt, untilExclusive))
      : gte(readingSessions.startedAt, since);

    const perBookProgress = this.db
      .select({
        bookId: readingSessions.bookId,
        maxPercentage: sql<number>`max(${readingSessions.endProgress})`.as('max_percentage'),
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), timeFilter, libraryFilter, isNotNull(readingSessions.endProgress)))
      .groupBy(readingSessions.bookId)
      .as('per_book_progress');

    const [row] = await this.db
      .select({
        started: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} > 0)::int`,
        reached25: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 25)::int`,
        reached50: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 50)::int`,
        reached75: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 75)::int`,
        completed: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 100)::int`,
      })
      .from(perBookProgress);

    return {
      started: row?.started ?? 0,
      reached25: row?.reached25 ?? 0,
      reached50: row?.reached50 ?? 0,
      reached75: row?.reached75 ?? 0,
      completed: row?.completed ?? 0,
    };
  }

  async getCompletionLatencyDays(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<number[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const completedInWindow = this.db
      .select({
        bookId: readingSessions.bookId,
        completedAt: sql<Date>`min(${readingSessions.endedAt})`.as('completed_at'),
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), gte(readingSessions.endProgress, 99), libraryFilter))
      .groupBy(readingSessions.bookId)
      .as('completed_in_window');

    const startedAndCompleted = this.db
      .select({
        completedAt: completedInWindow.completedAt,
        startedAt: sql<Date | null>`min(${readingSessions.startedAt})`.as('started_at'),
      })
      .from(readingSessions)
      .innerJoin(completedInWindow, eq(completedInWindow.bookId, readingSessions.bookId))
      .where(eq(readingSessions.userId, userId))
      .groupBy(completedInWindow.bookId, completedInWindow.completedAt)
      .as('started_and_completed');

    const rows = await this.db
      .select({
        days: sql<number | string>`extract(epoch from (${startedAndCompleted.completedAt} - ${startedAndCompleted.startedAt})) / 86400`,
      })
      .from(startedAndCompleted)
      .where(and(sql`${startedAndCompleted.startedAt} is not null`, sql`${startedAndCompleted.completedAt} >= ${startedAndCompleted.startedAt}`));

    return rows
      .map((row) => (typeof row.days === 'number' ? row.days : Number.parseFloat(String(row.days))))
      .filter((daysValue) => Number.isFinite(daysValue) && daysValue >= 0);
  }

  async getGenreReadingTime(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
  ): Promise<{ genre: string; source: ReadingSessionSource | null; readingSeconds: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    // Grouped by source so the genre treemap can show a per-source tooltip breakdown;
    // the top-N limit and ordering are applied in the service after folding by genre.
    return this.db
      .select({
        genre: genres.name,
        source: readingSessions.source,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .innerJoin(bookGenres, eq(bookGenres.bookId, books.id))
      .innerJoin(genres, eq(genres.id, bookGenres.genreId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(genres.name, readingSessions.source);
  }

  async getDailyReadingSecondsBySource(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    days: number,
  ): Promise<{ day: string; source: ReadingSessionSource | null; readingSeconds: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const dayExpr = sql<string>`date_trunc('day', ${readingSessions.startedAt})::date::text`;

    return this.db
      .select({
        day: dayExpr,
        source: readingSessions.source,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(dayExpr, readingSessions.source);
  }

  async getCatalogGenreReadingTime(
    userId: number,
    mediaTypes: WarehouseMediaType[],
    days = 365,
  ): Promise<{ genre: string; source: ReadingSessionSource | null; readingSeconds: number }[]> {
    const since = this.sinceDateForDays(days).toISOString();
    const rows = await this.db.execute<{ genre: string; reading_seconds: number }>(sql`
      select genre.value as genre, coalesce(sum(wrs.duration_seconds), 0)::int as reading_seconds
      from warehouse_reading_sessions wrs
      inner join warehouse_catalog_items wci on wci.media_type = wrs.media_type and wci.remote_id = wrs.remote_id
      cross join lateral jsonb_array_elements_text(wci.genres) as genre(value)
      where wrs.user_id = ${userId}
        and wrs.started_at >= ${since}::timestamp
        and ${this.warehouseMediaTypeSql(mediaTypes)}
        and genre.value <> ''
      group by genre.value
      order by reading_seconds desc
      limit 30
    `);

    return rows.rows.map((row) => ({ genre: row.genre, source: null, readingSeconds: Number(row.reading_seconds) }));
  }

  async getReadingPacePoints(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<UserReadingPacePoint[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const rows = await this.db
      .select({
        durationSeconds: readingSessions.durationSeconds,
        progressDelta: readingSessions.progressDelta,
        source: readingSessions.source,
        format: sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          gte(readingSessions.startedAt, since),
          isNotNull(readingSessions.progressDelta),
          gt(readingSessions.progressDelta, 0),
          libraryFilter,
        ),
      )
      .orderBy(readingSessions.startedAt)
      .limit(2000);

    return rows.map((r) => ({
      durationSeconds: r.durationSeconds,
      progressDelta: r.progressDelta!,
      bucket: toReadingSessionSourceBucket(r.source),
      format: r.format,
    }));
  }

  async getCatalogReadingPacePoints(userId: number, mediaTypes: WarehouseMediaType[], days = 1825): Promise<UserReadingPacePoint[]> {
    const mediaFilter = this.warehouseMediaTypeFilter(mediaTypes);
    const since = this.sinceDateForDays(days);

    const rows = await this.db
      .select({
        durationSeconds: schema.warehouseReadingSessions.durationSeconds,
        progressDelta: schema.warehouseReadingSessions.progressDelta,
        format: sql<string>`upper(${schema.warehouseReadingSessions.mediaType}::text)`,
      })
      .from(schema.warehouseReadingSessions)
      .where(
        and(
          eq(schema.warehouseReadingSessions.userId, userId),
          gte(schema.warehouseReadingSessions.startedAt, since),
          isNotNull(schema.warehouseReadingSessions.progressDelta),
          gt(schema.warehouseReadingSessions.progressDelta, 0),
          mediaFilter,
        ),
      )
      .orderBy(schema.warehouseReadingSessions.startedAt)
      .limit(2000);

    return rows.map((r) => ({
      durationSeconds: r.durationSeconds,
      progressDelta: r.progressDelta!,
      bucket: toReadingSessionSourceBucket(null),
      format: r.format,
    }));
  }

  async getReadingSurvivalMaxProgress(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<number[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const perBook = this.db
      .select({
        bookId: readingSessions.bookId,
        maxProgress: sql<number>`max(${readingSessions.endProgress})`.as('max_progress'),
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), isNotNull(readingSessions.endProgress), libraryFilter))
      .groupBy(readingSessions.bookId)
      .as('per_book');

    const rows = await this.db.select({ maxProgress: perBook.maxProgress }).from(perBook);
    return rows.map((r) => Number(r.maxProgress)).filter((v) => Number.isFinite(v));
  }

  async getCompletionRaceRawSessions(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 1825,
    limit = 15,
  ): Promise<{ bookId: number; title: string | null; startedAt: Date; endProgress: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const topBookIds = await this.db
      .select({ bookId: readingSessions.bookId })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), isNotNull(readingSessions.endProgress), libraryFilter))
      .groupBy(readingSessions.bookId)
      .orderBy(sql`count(*) desc`)
      .limit(limit)
      .then((rows) => rows.map((r) => r.bookId));

    if (!topBookIds.length) return [];

    return this.db
      .select({
        bookId: readingSessions.bookId,
        title: bookMetadata.title,
        startedAt: readingSessions.startedAt,
        endProgress: readingSessions.endProgress,
      })
      .from(readingSessions)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), inArray(readingSessions.bookId, topBookIds), isNotNull(readingSessions.endProgress)))
      .orderBy(readingSessions.bookId, readingSessions.startedAt)
      .then((rows) => rows.map((r) => ({ ...r, endProgress: r.endProgress! })));
  }

  async getCatalogCompletionRaceRawSessions(
    userId: number,
    mediaTypes: WarehouseMediaType[],
    days = 1825,
    limit = 15,
  ): Promise<{ bookId: number; title: string | null; startedAt: Date; endProgress: number }[]> {
    const since = this.sinceDateForDays(days).toISOString();
    const rows = await this.db.execute<{ book_id: number; title: string | null; started_at: Date; end_progress: number }>(sql`
      with top_items as (
        select wrs.media_type, wrs.remote_id, count(*) as total
        from warehouse_reading_sessions wrs
        where wrs.user_id = ${userId}
          and wrs.started_at >= ${since}::timestamp
          and wrs.end_progress is not null
          and ${this.warehouseMediaTypeSql(mediaTypes)}
        group by wrs.media_type, wrs.remote_id
        order by total desc
        limit ${limit}
      )
      select
        -wci.id::int as book_id,
        wci.title,
        wrs.started_at,
        wrs.end_progress::float as end_progress
      from warehouse_reading_sessions wrs
      inner join top_items ti on ti.media_type = wrs.media_type and ti.remote_id = wrs.remote_id
      inner join warehouse_catalog_items wci on wci.media_type = wrs.media_type and wci.remote_id = wrs.remote_id
      where wrs.user_id = ${userId}
        and wrs.end_progress is not null
      order by wci.id, wrs.started_at
    `);

    return rows.rows.map((row) => ({
      bookId: Number(row.book_id),
      title: row.title,
      startedAt: new Date(row.started_at),
      endProgress: Number(row.end_progress),
    }));
  }

  async getSessionArchetypePoints(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
  ): Promise<UserSessionArchetypePoint[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const hourExpr = sql<number>`extract(hour from ${readingSessions.startedAt}) + extract(minute from ${readingSessions.startedAt}) / 60.0`;
    const durationExpr = sql<number>`${readingSessions.durationSeconds} / 60.0`;
    const dowExpr = sql<number>`extract(dow from ${readingSessions.startedAt})::int`;

    const rows = await this.db
      .select({ hour: hourExpr, durationMinutes: durationExpr, dayOfWeek: dowExpr })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), gte(readingSessions.durationSeconds, 300), libraryFilter))
      .orderBy(readingSessions.startedAt)
      .limit(2000);

    return rows.map((r) => ({
      hour: Number(r.hour),
      durationMinutes: Number(r.durationMinutes),
      dayOfWeek: Number(r.dayOfWeek),
    }));
  }

  async getCatalogSessionArchetypePoints(userId: number, mediaTypes: WarehouseMediaType[], days = 365): Promise<UserSessionArchetypePoint[]> {
    const mediaFilter = this.warehouseMediaTypeFilter(mediaTypes);
    const since = this.sinceDateForDays(days);
    const hourExpr = sql<number>`extract(hour from ${schema.warehouseReadingSessions.startedAt}) + extract(minute from ${schema.warehouseReadingSessions.startedAt}) / 60.0`;
    const durationExpr = sql<number>`${schema.warehouseReadingSessions.durationSeconds} / 60.0`;
    const dowExpr = sql<number>`extract(dow from ${schema.warehouseReadingSessions.startedAt})::int`;

    const rows = await this.db
      .select({ hour: hourExpr, durationMinutes: durationExpr, dayOfWeek: dowExpr })
      .from(schema.warehouseReadingSessions)
      .where(
        and(
          eq(schema.warehouseReadingSessions.userId, userId),
          gte(schema.warehouseReadingSessions.startedAt, since),
          gte(schema.warehouseReadingSessions.durationSeconds, 300),
          mediaFilter,
        ),
      )
      .orderBy(schema.warehouseReadingSessions.startedAt)
      .limit(2000);

    return rows.map((r) => ({
      hour: Number(r.hour),
      durationMinutes: Number(r.durationMinutes),
      dayOfWeek: Number(r.dayOfWeek),
    }));
  }

  async getAuthorGenreChord(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 1825,
    authorLimit = 12,
    genreLimit = 12,
  ): Promise<ChordDiagramData> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libFilter = this.intersectLibraryIds(accessible, filterLibraryIds);
    const since = this.sinceDateForDays(days);
    const sinceStr = since.toISOString().slice(0, 10);

    const libCondition = libFilter === null ? sql`true` : libFilter.length === 0 ? sql`false` : inArray(books.libraryId, libFilter);

    const rows = await this.db.execute<{ author: string; genre: string; reading_seconds: number }>(sql`
      with top_authors as (
        select a.name, sum(rs.duration_seconds) as total
        from reading_sessions rs
        inner join books b on b.id = rs.book_id
        inner join book_authors ba on ba.book_id = b.id
        inner join authors a on a.id = ba.author_id
        where rs.user_id = ${userId}
          and rs.started_at >= ${sinceStr}::timestamp
          and ${libCondition}
        group by a.name
        order by total desc
        limit ${authorLimit}
      ),
      top_genres as (
        select g.name, sum(rs.duration_seconds) as total
        from reading_sessions rs
        inner join books b on b.id = rs.book_id
        inner join book_genres bg on bg.book_id = b.id
        inner join genres g on g.id = bg.genre_id
        where rs.user_id = ${userId}
          and rs.started_at >= ${sinceStr}::timestamp
          and ${libCondition}
        group by g.name
        order by total desc
        limit ${genreLimit}
      )
      select
        a.name as author,
        g.name as genre,
        sum(rs.duration_seconds)::int as reading_seconds
      from reading_sessions rs
      inner join books b on b.id = rs.book_id
      inner join book_authors ba on ba.book_id = b.id
      inner join top_authors a on a.name = (
        select a2.name from book_authors ba2 inner join authors a2 on a2.id = ba2.author_id where ba2.book_id = b.id order by ba2.display_order, ba2.author_id limit 1
      )
      inner join book_genres bg on bg.book_id = b.id
      inner join top_genres g on g.name = (
        select g2.name from book_genres bg2 inner join genres g2 on g2.id = bg2.genre_id where bg2.book_id = b.id order by bg2.genre_id limit 1
      )
      where rs.user_id = ${userId}
        and rs.started_at >= ${sinceStr}::timestamp
        and ${libCondition}
      group by a.name, g.name
      having sum(rs.duration_seconds) > 0
      order by reading_seconds desc
    `);

    if (rows.rows.length === 0) return { nodes: [], links: [] };

    const authorNames = [...new Set(rows.rows.map((r) => r.author))];
    const genreNames = [...new Set(rows.rows.map((r) => r.genre))];

    return {
      nodes: [...authorNames.map((n) => ({ name: n })), ...genreNames.map((n) => ({ name: n }))],
      links: rows.rows.map((r) => ({ source: r.author, target: r.genre, value: r.reading_seconds })),
    };
  }

  async getCatalogAuthorGenreChord(
    userId: number,
    mediaTypes: WarehouseMediaType[],
    days = 1825,
    authorLimit = 12,
    genreLimit = 12,
  ): Promise<ChordDiagramData> {
    const since = this.sinceDateForDays(days).toISOString();
    const rows = await this.db.execute<{ author: string; genre: string; reading_seconds: number }>(sql`
      with source_sessions as (
        select wrs.duration_seconds, wci.authors, wci.genres
        from warehouse_reading_sessions wrs
        inner join warehouse_catalog_items wci on wci.media_type = wrs.media_type and wci.remote_id = wrs.remote_id
        where wrs.user_id = ${userId}
          and wrs.started_at >= ${since}::timestamp
          and ${this.warehouseMediaTypeSql(mediaTypes)}
      ),
      expanded as (
        select
          nullif(author.value, '') as author,
          nullif(genre.value, '') as genre,
          ss.duration_seconds
        from source_sessions ss
        cross join lateral jsonb_array_elements_text(ss.authors) with ordinality as author(value, author_ord)
        cross join lateral jsonb_array_elements_text(ss.genres) with ordinality as genre(value, genre_ord)
        where author.author_ord = 1 and genre.genre_ord = 1
      ),
      top_authors as (
        select author, sum(duration_seconds) as total
        from expanded
        where author is not null
        group by author
        order by total desc
        limit ${authorLimit}
      ),
      top_genres as (
        select genre, sum(duration_seconds) as total
        from expanded
        where genre is not null
        group by genre
        order by total desc
        limit ${genreLimit}
      )
      select e.author, e.genre, sum(e.duration_seconds)::int as reading_seconds
      from expanded e
      inner join top_authors ta on ta.author = e.author
      inner join top_genres tg on tg.genre = e.genre
      group by e.author, e.genre
      having sum(e.duration_seconds) > 0
      order by reading_seconds desc
    `);

    if (rows.rows.length === 0) return { nodes: [], links: [] };
    const authorNames = [...new Set(rows.rows.map((r) => r.author))];
    const genreNames = [...new Set(rows.rows.map((r) => r.genre))];
    return {
      nodes: [...authorNames.map((name) => ({ name })), ...genreNames.map((name) => ({ name }))],
      links: rows.rows.map((row) => ({ source: row.author, target: row.genre, value: Number(row.reading_seconds) })),
    };
  }

  async recomputeRecentDailyStats(days = RECENT_DAILY_AGGREGATION_DAYS): Promise<{ deleted: number; inserted: number; since: string }> {
    const sinceDay = this.sinceDateForDays(days).toISOString().slice(0, 10);
    const broadSince = new Date(Date.parse(`${sinceDay}T00:00:00.000Z`) - 14 * 60 * 60 * 1000);

    return this.db.transaction(async (tx) => {
      const existingGroups = await tx
        .select({
          userId: userReadingDailyStats.userId,
          libraryId: userReadingDailyStats.libraryId,
          settings: users.settings,
        })
        .from(userReadingDailyStats)
        .innerJoin(users, eq(users.id, userReadingDailyStats.userId))
        .where(gte(userReadingDailyStats.day, sinceDay))
        .groupBy(userReadingDailyStats.userId, userReadingDailyStats.libraryId, users.settings);

      const sessionGroups = await tx
        .select({
          userId: readingSessions.userId,
          libraryId: books.libraryId,
          settings: users.settings,
        })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .innerJoin(users, eq(users.id, readingSessions.userId))
        .where(gt(readingSessions.endedAt, broadSince))
        .groupBy(readingSessions.userId, books.libraryId, users.settings);

      const groups = new Map<string, { userId: number; libraryId: number; settings: unknown }>();
      for (const group of [...existingGroups, ...sessionGroups]) {
        groups.set(`${group.userId}:${group.libraryId}`, group);
      }

      let deleted = 0;
      let inserted = 0;

      for (const group of groups.values()) {
        await this.lockDailyStats(tx, group.userId, group.libraryId);

        const deleteResult = await tx.execute(sql`
          delete from user_reading_daily_stats
          where user_id = ${group.userId}
            and library_id = ${group.libraryId}
            and day >= ${sinceDay}::date
        `);
        deleted += Number((deleteResult as { rowCount?: number }).rowCount ?? 0);

        const timeZone = resolveTimeZone((group.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
        const range = getDayRangeForDateKeys([sinceDay], timeZone);
        if (!range) continue;

        const rows = await tx
          .select({
            startedAt: readingSessions.startedAt,
            endedAt: readingSessions.endedAt,
            durationSeconds: readingSessions.durationSeconds,
            progressDelta: readingSessions.progressDelta,
          })
          .from(readingSessions)
          .innerJoin(books, eq(books.id, readingSessions.bookId))
          .where(and(eq(readingSessions.userId, group.userId), eq(books.libraryId, group.libraryId), gt(readingSessions.endedAt, range.start)));

        const segments = aggregateReadingSessionDailyStats(
          rows.map((row) => ({
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            durationSeconds: row.durationSeconds,
            progressDelta: row.progressDelta ?? null,
          })),
          timeZone,
        ).filter((segment) => segment.day >= sinceDay);

        await this.insertDailyStatsSegments(tx, group.userId, group.libraryId, segments);
        inserted += segments.length;
      }

      return { deleted, inserted, since: sinceDay };
    });
  }
}
