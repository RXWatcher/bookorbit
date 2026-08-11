import { Inject, Injectable } from '@nestjs/common';
import { and, count, countDistinct, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, sql, sum } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, type WarehouseMediaType } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  achievements,
  userAchievements,
  userBookStatus,
  userBookRatings,
  readingSessions,
  readingAttempts,
  annotations,
  collections,
  collectionBooks,
  books,
  bookFiles,
  bookMetadata,
  bookGenres,
  genres,
  bookAuthors,
  authors,
  userReadingDailyStats,
  userLibraryAccess,
  koreaderDeviceProgress,
  koboReadingStates,
  users,
  warehouseCatalogItems,
  warehouseUserState,
} from '../../db/schema';
import type { AchievementRow, NewAchievement, UserAchievementRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type WarehouseRawPayload = Record<string, unknown> | null;

const WAREHOUSE_PUBLICATION_YEAR_KEYS = ['publishedYear', 'published_year', 'publicationYear', 'publication_year'] as const;
const WAREHOUSE_PUBLICATION_DATE_KEYS = ['publishedDate', 'published_date', 'releaseDate', 'release_date'] as const;
const WAREHOUSE_PAGE_COUNT_KEYS = ['pageCount', 'page_count', 'pages'] as const;
const AUDIOBOOK_VIRTUAL_PAGES_PER_HOUR = 30;

function parseWarehousePublishedYear(rawPayload: unknown): number | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null;
  const payload = rawPayload as Record<string, unknown>;
  for (const key of WAREHOUSE_PUBLICATION_YEAR_KEYS) {
    const year = normalizeWarehouseYear(payload[key]);
    if (year !== null) return year;
  }
  for (const key of WAREHOUSE_PUBLICATION_DATE_KEYS) {
    const value = payload[key];
    if (typeof value !== 'string') continue;
    const match = value.match(/^\d{4}/);
    if (!match) continue;
    const year = normalizeWarehouseYear(match[0]);
    if (year !== null) return year;
  }
  return null;
}

function normalizeWarehouseYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 1000 && value <= 2200 ? value : null;
  }
  if (typeof value === 'string' && /^\d{4}$/.test(value)) {
    const year = Number(value);
    return year >= 1000 && year <= 2200 ? year : null;
  }
  return null;
}

function parseWarehousePageCount(mediaType: WarehouseMediaType, rawPayload: unknown, durationSeconds: number | null): number | null {
  if (mediaType === 'audiobook') {
    if (typeof durationSeconds !== 'number' || durationSeconds <= 0) return null;
    const pageCount = Math.round((durationSeconds / 3600) * AUDIOBOOK_VIRTUAL_PAGES_PER_HOUR);
    return pageCount > 0 ? pageCount : null;
  }
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null;
  const payload = rawPayload as Record<string, unknown>;
  for (const key of WAREHOUSE_PAGE_COUNT_KEYS) {
    const pageCount = normalizeWarehousePageCount(payload[key]);
    if (pageCount !== null) return pageCount;
  }
  return null;
}

function normalizeWarehousePageCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const pageCount = Number(value);
    return pageCount > 0 ? pageCount : null;
  }
  return null;
}

function canonicalAchievementAuthorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex <= 0) return trimmed.toLowerCase();

  const family = trimmed.slice(0, commaIndex).trim();
  const given = trimmed.slice(commaIndex + 1).trim();
  return given && family ? `${given} ${family}`.toLowerCase() : trimmed.toLowerCase();
}

function canonicalAchievementGenreName(name: string): string {
  return name.trim().toLowerCase();
}

function canonicalAchievementLanguageName(name: string): string {
  return name.trim().toLowerCase();
}

@Injectable()
export class AchievementRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async upsertCatalogue(seed: NewAchievement[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (seed.length > 0) {
        await tx
          .insert(achievements)
          .values(seed)
          .onConflictDoUpdate({
            target: achievements.key,
            set: {
              groupKey: sql`excluded.group_key`,
              tier: sql`excluded.tier`,
              category: sql`excluded.category`,
              name: sql`excluded.name`,
              description: sql`excluded.description`,
              iconName: sql`excluded.icon_name`,
              rarity: sql`excluded.rarity`,
              threshold: sql`excluded.threshold`,
              hidden: sql`excluded.hidden`,
              sortOrder: sql`excluded.sort_order`,
            },
          });
        await tx.delete(achievements).where(
          notInArray(
            achievements.key,
            seed.map((row) => row.key),
          ),
        );
      } else {
        await tx.delete(achievements);
      }
    });
  }

  async findAchievementByKey(key: string): Promise<AchievementRow | null> {
    const [row] = await this.db.select().from(achievements).where(eq(achievements.key, key)).limit(1);
    return row ?? null;
  }

  async findAllAchievements(): Promise<AchievementRow[]> {
    return this.db.select().from(achievements).orderBy(achievements.category, achievements.sortOrder);
  }

  async findUserAchievements(userId: number): Promise<UserAchievementRow[]> {
    return this.db.select().from(userAchievements).where(eq(userAchievements.userId, userId)).orderBy(desc(userAchievements.awardedAt));
  }

  async findUserEarnedKeys(userId: number): Promise<Set<string>> {
    const rows = await this.db
      .select({ achievementKey: userAchievements.achievementKey })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    return new Set(rows.map((r) => r.achievementKey));
  }

  async hasAchievement(userId: number, key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ key: userAchievements.achievementKey })
      .from(userAchievements)
      .where(and(eq(userAchievements.userId, userId), eq(userAchievements.achievementKey, key)))
      .limit(1);
    return !!row;
  }

  async award(userId: number, key: string, context: Record<string, unknown> | null): Promise<UserAchievementRow | null> {
    const [row] = await this.db
      .insert(userAchievements)
      .values({ userId, achievementKey: key, contextJson: context })
      .onConflictDoNothing({ target: [userAchievements.userId, userAchievements.achievementKey] })
      .returning();
    return row ?? null;
  }

  async findUserIsSuperuser(userId: number): Promise<boolean> {
    const [row] = await this.db.select({ isSuperuser: users.isSuperuser }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.isSuperuser ?? false;
  }

  async countFinishedBooks(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    return value + (await this.countFinishedWarehouseItems(userId));
  }

  async sumPagesRead(userId: number): Promise<number> {
    const [result] = await this.db
      .select({
        value: sql<number>`coalesce(sum(${bookMetadata.pageCount} * least(greatest(coalesce(${readingSessions.progressDelta}, 0), 0), 100) / 100.0), 0)::float`,
      })
      .from(readingSessions)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          isNotNull(bookMetadata.pageCount),
          gt(bookMetadata.pageCount, 0),
          isNotNull(readingSessions.progressDelta),
          gt(readingSessions.progressDelta, 0),
          sql`${readingSessions.progressDelta} <= 100`,
          gt(readingSessions.durationSeconds, 0),
        ),
      );
    return Math.floor(Number(result?.value ?? 0));
  }

  async sumReadingHours(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ value: sum(readingSessions.durationSeconds) })
      .from(readingSessions)
      .where(eq(readingSessions.userId, userId));
    return Math.floor(Number(result?.value ?? 0) / 3600);
  }

  async countAnnotations(userId: number): Promise<number> {
    const [{ value }] = await this.db.select({ value: count() }).from(annotations).where(eq(annotations.userId, userId));
    return value;
  }

  async countAccessibleBooks(userId: number, isSuperuser: boolean): Promise<number> {
    if (isSuperuser) {
      const [{ value }] = await this.db.select({ value: count() }).from(books).where(eq(books.status, 'present'));
      return value + (await this.countAccessibleWarehouseItems(await this.accessibleWarehouseMediaTypes(userId, isSuperuser)));
    }
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(books)
      .innerJoin(userLibraryAccess, eq(books.libraryId, userLibraryAccess.libraryId))
      .where(and(eq(userLibraryAccess.userId, userId), eq(books.status, 'present')));
    return value + (await this.countAccessibleWarehouseItems(await this.accessibleWarehouseMediaTypes(userId, isSuperuser)));
  }

  async countDistinctFormats(userId: number, isSuperuser: boolean): Promise<number> {
    const localRows = isSuperuser
      ? await this.db.select({ format: bookFiles.format }).from(bookFiles).where(isNotNull(bookFiles.format))
      : await this.db
          .select({ format: bookFiles.format })
          .from(bookFiles)
          .innerJoin(books, eq(bookFiles.bookId, books.id))
          .innerJoin(userLibraryAccess, eq(books.libraryId, userLibraryAccess.libraryId))
          .where(and(eq(userLibraryAccess.userId, userId), isNotNull(bookFiles.format)));
    const warehouseRows = await this.listAccessibleWarehouseFormats(await this.accessibleWarehouseMediaTypes(userId, isSuperuser));
    return new Set(
      [...localRows, ...warehouseRows].map((row) => row.format).filter((format): format is string => typeof format === 'string' && format.length > 0),
    ).size;
  }

  private async accessibleWarehouseMediaTypes(userId: number, isSuperuser: boolean): Promise<WarehouseMediaType[]> {
    if (isSuperuser) return ['ebook', 'audiobook', 'comic'];
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    const ids = new Set(rows.map((row) => row.libraryId));
    const mediaTypes: WarehouseMediaType[] = [];
    if (ids.has(CLOUD_EBOOK_LIBRARY_ID)) mediaTypes.push('ebook');
    if (ids.has(CLOUD_AUDIO_LIBRARY_ID)) mediaTypes.push('audiobook');
    if (ids.has(CLOUD_COMIC_LIBRARY_ID)) mediaTypes.push('comic');
    return mediaTypes;
  }

  private async countAccessibleWarehouseItems(mediaTypes: WarehouseMediaType[]): Promise<number> {
    if (mediaTypes.length === 0) return 0;
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(warehouseCatalogItems)
      .where(inArray(warehouseCatalogItems.mediaType, mediaTypes));
    return value;
  }

  private async listAccessibleWarehouseFormats(mediaTypes: WarehouseMediaType[]): Promise<{ format: string | null }[]> {
    if (mediaTypes.length === 0) return [];
    return this.db
      .select({ format: warehouseCatalogItems.format })
      .from(warehouseCatalogItems)
      .where(and(inArray(warehouseCatalogItems.mediaType, mediaTypes), isNotNull(warehouseCatalogItems.format)));
  }

  private async countFinishedWarehouseItems(userId: number, range?: { start: Date; end: Date }): Promise<number> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return 0;

    const clauses = [
      eq(warehouseUserState.userId, userId),
      eq(warehouseUserState.readStatus, 'read'),
      inArray(warehouseUserState.mediaType, mediaTypes),
    ];
    if (range) {
      clauses.push(gte(warehouseUserState.finishedAt, range.start), lt(warehouseUserState.finishedAt, range.end));
    }

    const [{ value }] = await this.db
      .select({ value: count() })
      .from(warehouseUserState)
      .innerJoin(
        warehouseCatalogItems,
        and(eq(warehouseUserState.mediaType, warehouseCatalogItems.mediaType), eq(warehouseUserState.remoteId, warehouseCatalogItems.remoteId)),
      )
      .where(and(...clauses));
    return value;
  }

  private async listFinishedWarehouseGenres(userId: number): Promise<{ genres: string[] }[]> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return [];
    return this.db
      .select({ genres: warehouseCatalogItems.genres })
      .from(warehouseUserState)
      .innerJoin(
        warehouseCatalogItems,
        and(eq(warehouseUserState.mediaType, warehouseCatalogItems.mediaType), eq(warehouseUserState.remoteId, warehouseCatalogItems.remoteId)),
      )
      .where(
        and(eq(warehouseUserState.userId, userId), eq(warehouseUserState.readStatus, 'read'), inArray(warehouseUserState.mediaType, mediaTypes)),
      );
  }

  private async listFinishedWarehouseLanguages(userId: number): Promise<{ language: string | null }[]> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return [];
    return this.db
      .select({ language: warehouseCatalogItems.language })
      .from(warehouseUserState)
      .innerJoin(
        warehouseCatalogItems,
        and(eq(warehouseUserState.mediaType, warehouseCatalogItems.mediaType), eq(warehouseUserState.remoteId, warehouseCatalogItems.remoteId)),
      )
      .where(
        and(
          eq(warehouseUserState.userId, userId),
          eq(warehouseUserState.readStatus, 'read'),
          inArray(warehouseUserState.mediaType, mediaTypes),
          isNotNull(warehouseCatalogItems.language),
        ),
      );
  }

  private async listFinishedWarehouseAuthors(userId: number): Promise<{ authors: string[] }[]> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return [];
    return this.db
      .select({ authors: warehouseCatalogItems.authors })
      .from(warehouseUserState)
      .innerJoin(
        warehouseCatalogItems,
        and(eq(warehouseUserState.mediaType, warehouseCatalogItems.mediaType), eq(warehouseUserState.remoteId, warehouseCatalogItems.remoteId)),
      )
      .where(
        and(eq(warehouseUserState.userId, userId), eq(warehouseUserState.readStatus, 'read'), inArray(warehouseUserState.mediaType, mediaTypes)),
      );
  }

  private async hasFinishedWarehouseSeriesBook(userId: number): Promise<boolean> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return false;
    const [row] = await this.db
      .select({ series: warehouseCatalogItems.series })
      .from(warehouseUserState)
      .innerJoin(
        warehouseCatalogItems,
        and(eq(warehouseUserState.mediaType, warehouseCatalogItems.mediaType), eq(warehouseUserState.remoteId, warehouseCatalogItems.remoteId)),
      )
      .where(
        and(
          eq(warehouseUserState.userId, userId),
          eq(warehouseUserState.readStatus, 'read'),
          inArray(warehouseUserState.mediaType, mediaTypes),
          isNotNull(warehouseCatalogItems.series),
          ne(warehouseCatalogItems.series, ''),
        ),
      )
      .limit(1);
    return !!row;
  }

  private async hasCompletedWarehouseSeriesOfSize(userId: number, size: number): Promise<boolean> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return false;
    const mediaTypeList = sql.join(
      mediaTypes.map((mediaType) => sql`${mediaType}`),
      sql`, `,
    );
    const result = await this.db.execute(sql`
      SELECT 1 FROM (
        SELECT ${warehouseCatalogItems.series} AS series,
          COUNT(DISTINCT ${warehouseCatalogItems.mediaType} || ':' || ${warehouseCatalogItems.remoteId}) AS total_in_series,
          COUNT(DISTINCT CASE
            WHEN ${warehouseUserState.remoteId} IS NOT NULL
            THEN ${warehouseCatalogItems.mediaType} || ':' || ${warehouseCatalogItems.remoteId}
          END) AS read_count
        FROM ${warehouseCatalogItems}
        LEFT JOIN ${warehouseUserState}
          ON ${warehouseUserState.mediaType} = ${warehouseCatalogItems.mediaType}
          AND ${warehouseUserState.remoteId} = ${warehouseCatalogItems.remoteId}
          AND ${warehouseUserState.userId} = ${userId}
          AND ${warehouseUserState.readStatus} = 'read'
        WHERE ${warehouseCatalogItems.mediaType} IN (${mediaTypeList})
          AND ${warehouseCatalogItems.series} IS NOT NULL
          AND ${warehouseCatalogItems.series} != ''
        GROUP BY ${warehouseCatalogItems.series}
        HAVING COUNT(DISTINCT ${warehouseCatalogItems.mediaType} || ':' || ${warehouseCatalogItems.remoteId}) = ${size}
          AND COUNT(DISTINCT ${warehouseCatalogItems.mediaType} || ':' || ${warehouseCatalogItems.remoteId}) = COUNT(DISTINCT CASE
            WHEN ${warehouseUserState.remoteId} IS NOT NULL
            THEN ${warehouseCatalogItems.mediaType} || ':' || ${warehouseCatalogItems.remoteId}
          END)
      ) complete_series
      LIMIT 1
    `);
    return (result as unknown as { rows: unknown[] }).rows.length > 0;
  }

  private async listFinishedWarehousePublicationYears(userId: number): Promise<number[]> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return [];
    const rows = await this.db
      .select({ rawPayload: warehouseCatalogItems.rawPayload })
      .from(warehouseUserState)
      .innerJoin(
        warehouseCatalogItems,
        and(eq(warehouseUserState.mediaType, warehouseCatalogItems.mediaType), eq(warehouseUserState.remoteId, warehouseCatalogItems.remoteId)),
      )
      .where(
        and(eq(warehouseUserState.userId, userId), eq(warehouseUserState.readStatus, 'read'), inArray(warehouseUserState.mediaType, mediaTypes)),
      );
    return rows.map((row) => parseWarehousePublishedYear(row.rawPayload as WarehouseRawPayload)).filter((year): year is number => year !== null);
  }

  private async listFinishedWarehousePageCounts(userId: number): Promise<number[]> {
    const mediaTypes = await this.accessibleWarehouseMediaTypes(userId, false);
    if (mediaTypes.length === 0) return [];
    const rows = await this.db
      .select({
        mediaType: warehouseCatalogItems.mediaType,
        rawPayload: warehouseCatalogItems.rawPayload,
        durationSeconds: warehouseCatalogItems.durationSeconds,
      })
      .from(warehouseUserState)
      .innerJoin(
        warehouseCatalogItems,
        and(eq(warehouseUserState.mediaType, warehouseCatalogItems.mediaType), eq(warehouseUserState.remoteId, warehouseCatalogItems.remoteId)),
      )
      .where(
        and(eq(warehouseUserState.userId, userId), eq(warehouseUserState.readStatus, 'read'), inArray(warehouseUserState.mediaType, mediaTypes)),
      );
    return rows
      .map((row) => parseWarehousePageCount(row.mediaType as WarehouseMediaType, row.rawPayload as WarehouseRawPayload, row.durationSeconds))
      .filter((pageCount): pageCount is number => pageCount !== null);
  }

  async countCollections(userId: number): Promise<number> {
    const [{ value }] = await this.db.select({ value: count() }).from(collections).where(eq(collections.userId, userId));
    return value;
  }

  async countDistinctGenresRead(userId: number): Promise<number> {
    const localRows = await this.db
      .select({ genre: genres.name })
      .from(userBookStatus)
      .innerJoin(bookGenres, eq(userBookStatus.bookId, bookGenres.bookId))
      .innerJoin(genres, eq(bookGenres.genreId, genres.id))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    const warehouseRows = await this.listFinishedWarehouseGenres(userId);
    return new Set(
      [...localRows.map((row) => row.genre), ...warehouseRows.flatMap((row) => row.genres)]
        .map((genre) => canonicalAchievementGenreName(genre))
        .filter((genre) => genre.length > 0),
    ).size;
  }

  async countDistinctLanguagesRead(userId: number): Promise<number> {
    const localRows = await this.db
      .select({ language: bookMetadata.language })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.language)));
    const warehouseRows = await this.listFinishedWarehouseLanguages(userId);
    return new Set(
      [...localRows, ...warehouseRows]
        .map((row) => row.language)
        .filter((language): language is string => typeof language === 'string')
        .map((language) => canonicalAchievementLanguageName(language))
        .filter((language) => language.length > 0),
    ).size;
  }

  async countDistinctCenturiesRead(userId: number): Promise<number> {
    const localRows = await this.db
      .select({ century: sql<number>`floor(${bookMetadata.publishedYear} / 100)` })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.publishedYear)))
      .groupBy(sql`floor(${bookMetadata.publishedYear} / 100)`);
    const warehouseYears = await this.listFinishedWarehousePublicationYears(userId);
    return new Set([...localRows.map((row) => row.century), ...warehouseYears.map((year) => Math.floor(year / 100))]).size;
  }

  async hasCompletedSeries(userId: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM (
	        SELECT bm.series_id,
          COUNT(DISTINCT bm.book_id) AS total_in_series,
          COUNT(DISTINCT ubs.book_id) AS read_count
        FROM book_metadata bm
        LEFT JOIN user_book_status ubs
          ON ubs.book_id = bm.book_id AND ubs.user_id = ${userId} AND ubs.status = 'read'
	        WHERE bm.series_id IS NOT NULL
	        GROUP BY bm.series_id
        HAVING COUNT(DISTINCT bm.book_id) >= 2
          AND COUNT(DISTINCT bm.book_id) = COUNT(DISTINCT ubs.book_id)
      ) complete_series
      LIMIT 1
    `);
    return (result as unknown as { rows: unknown[] }).rows.length > 0;
  }

  async maxBooksPerAuthor(userId: number): Promise<number> {
    const localRows = await this.db
      .select({ authorName: authors.name })
      .from(userBookStatus)
      .innerJoin(bookAuthors, eq(userBookStatus.bookId, bookAuthors.bookId))
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    const counts = new Map<string, number>();
    for (const row of localRows) {
      this.incrementAuthorCount(counts, row.authorName);
    }
    for (const row of await this.listFinishedWarehouseAuthors(userId)) {
      const authorKeys = new Set(row.authors.map((author) => canonicalAchievementAuthorName(author)).filter((author) => author.length > 0));
      for (const authorKey of authorKeys) {
        counts.set(authorKey, (counts.get(authorKey) ?? 0) + 1);
      }
    }
    return Math.max(0, ...counts.values());
  }

  private incrementAuthorCount(counts: Map<string, number>, authorName: string | null): void {
    if (!authorName) return;
    const authorKey = canonicalAchievementAuthorName(authorName);
    if (!authorKey) return;
    counts.set(authorKey, (counts.get(authorKey) ?? 0) + 1);
  }

  async getBookPageCount(bookId: number): Promise<number | null> {
    const [row] = await this.db.select({ pageCount: bookMetadata.pageCount }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return row?.pageCount ?? null;
  }

  async getBookPublishedYear(bookId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ publishedYear: bookMetadata.publishedYear })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    return row?.publishedYear ?? null;
  }

  async getBookTitle(bookId: number): Promise<string | null> {
    const [row] = await this.db.select({ title: bookMetadata.title }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return row?.title ?? null;
  }

  async getCurrentStreak(userId: number): Promise<number> {
    // Count consecutive days with reading activity ending at today or yesterday
    const result = await this.db.execute(sql`
      WITH daily AS (
        SELECT DISTINCT day::date as d
        FROM user_reading_daily_stats
        WHERE user_id = ${userId} AND sessions_count > 0
      ),
      streak AS (
        SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
        FROM daily
      )
      SELECT COUNT(*) as streak_length
      FROM streak
      WHERE grp = (
        SELECT grp FROM streak WHERE d >= CURRENT_DATE - INTERVAL '1 day' ORDER BY d DESC LIMIT 1
      )
    `);
    const rows = (result as unknown as { rows: Array<{ streak_length: string }> }).rows;
    return rows.length > 0 ? Number(rows[0].streak_length) : 0;
  }

  async countDistinctMonthsWithReading(userId: number, year: number): Promise<number> {
    const rows = await this.db
      .select({ month: sql<string>`EXTRACT(MONTH FROM day::date)` })
      .from(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          gt(userReadingDailyStats.sessionsCount, 0),
          sql`EXTRACT(YEAR FROM ${userReadingDailyStats.day}::date) = ${year}`,
        ),
      )
      .groupBy(sql`EXTRACT(MONTH FROM day::date)`);
    return rows.length;
  }

  async wasBookAbandonedBefore(userId: number, bookId: number, monthsAgo: number): Promise<boolean> {
    const [row] = await this.db
      .select({ startedOn: readingAttempts.startedOn, endedOn: readingAttempts.endedOn })
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          eq(readingAttempts.outcome, 'abandoned'),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .orderBy(desc(readingAttempts.id))
      .limit(1);
    if (!row?.startedOn || !row?.endedOn) return false;
    const diffMs = new Date(row.endedOn).getTime() - new Date(row.startedOn).getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
    return diffMonths >= monthsAgo;
  }

  async countBooksFinishedInDateRange(userId: number, start: Date, end: Date): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.outcome, 'completed'),
          isNull(readingAttempts.deletedAt),
          sql`${readingAttempts.endedOn} >= ${start.toISOString().slice(0, 10)}::date`,
          sql`${readingAttempts.endedOn} < ${end.toISOString().slice(0, 10)}::date`,
        ),
      );
    return value + (await this.countFinishedWarehouseItems(userId, { start, end }));
  }

  async wasBookStartedAndFinishedOnSameDay(userId: number, bookId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ startedOn: readingAttempts.startedOn, endedOn: readingAttempts.endedOn })
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          eq(readingAttempts.outcome, 'completed'),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .orderBy(desc(readingAttempts.id))
      .limit(1);
    return !!row?.startedOn && row.startedOn === row.endedOn;
  }

  async sumWeekendReadingHours(userId: number, saturdayDate: string): Promise<number> {
    const saturday = new Date(saturdayDate);
    const monday = new Date(saturday);
    monday.setDate(monday.getDate() + 2);

    const [result] = await this.db
      .select({ value: sum(userReadingDailyStats.readingSeconds) })
      .from(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          gte(sql`${userReadingDailyStats.day}::date`, sql`${saturdayDate}::date`),
          lt(sql`${userReadingDailyStats.day}::date`, sql`${monday.toISOString().split('T')[0]}::date`),
        ),
      );
    return Math.floor(Number(result?.value ?? 0) / 3600);
  }

  async getBookIdForFile(fileId: number): Promise<number | null> {
    const [row] = await this.db.select({ bookId: bookFiles.bookId }).from(bookFiles).where(eq(bookFiles.id, fileId)).limit(1);
    return row?.bookId ?? null;
  }

  async getPreviousSessionEndedAt(userId: number, currentSessionId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ endedAt: readingSessions.endedAt })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), sql`${readingSessions.sessionId} != ${currentSessionId}`))
      .orderBy(desc(readingSessions.endedAt))
      .limit(1);
    return row?.endedAt ?? null;
  }

  async findAllUserIds(): Promise<number[]> {
    const rows = await this.db.execute<{ id: number }>(sql`SELECT id FROM users WHERE active = true ORDER BY id`);
    return (rows as unknown as { rows: Array<{ id: number }> }).rows.map((r) => r.id);
  }

  async hasSessionLongerThan(userId: number, minSeconds: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.durationSeconds, minSeconds)))
      .limit(1);
    return !!row;
  }

  async hasSessionInHourRange(userId: number, startHour: number, endHour: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          sql`(
            EXTRACT(HOUR FROM ${readingSessions.startedAt}) >= ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.startedAt}) < ${endHour}
            OR EXTRACT(HOUR FROM ${readingSessions.endedAt}) >= ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.endedAt}) < ${endHour}
            OR EXTRACT(HOUR FROM ${readingSessions.startedAt}) < ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.endedAt}) >= ${endHour}
          )`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasSessionStartingInHourRange(userId: number, startHour: number, endHour: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          sql`EXTRACT(HOUR FROM ${readingSessions.startedAt}) >= ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.startedAt}) < ${endHour}`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async getMaxFinishedBookPageCount(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ value: sql<number>`coalesce(max(${bookMetadata.pageCount}), 0)::int` })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.pageCount)));
    return Number(result?.value ?? 0);
  }

  async hasFinishedBookWithMinPages(userId: number, minPages: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          gte(bookMetadata.pageCount, minPages),
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasAnyBookStartedAndFinishedOnSameDay(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: readingAttempts.bookId })
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.outcome, 'completed'),
          isNull(readingAttempts.deletedAt),
          isNotNull(readingAttempts.startedOn),
          isNotNull(readingAttempts.endedOn),
          eq(readingAttempts.startedOn, readingAttempts.endedOn),
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasFinishedBookPublishedBefore(userId: number, year: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.publishedYear),
          lt(bookMetadata.publishedYear, year),
        ),
      )
      .limit(1);
    if (row) return true;
    return (await this.listFinishedWarehousePublicationYears(userId)).some((publishedYear) => publishedYear < year);
  }

  async hasFinishedBookPublishedInYear(userId: number, year: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), eq(bookMetadata.publishedYear, year)))
      .limit(1);
    if (row) return true;
    return (await this.listFinishedWarehousePublicationYears(userId)).some((publishedYear) => publishedYear === year);
  }

  async hasAnyBookRebornFromAbandoned(userId: number, monthsAgo: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(userBookStatus.startedAt),
          isNotNull(userBookStatus.finishedAt),
          sql`EXTRACT(EPOCH FROM (${userBookStatus.finishedAt} - ${userBookStatus.startedAt})) / 2592000 >= ${monthsAgo}`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasLargeGapBetweenAnySessions(userId: number, minDays: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM (
          SELECT
            ended_at,
            LEAD(started_at) OVER (ORDER BY started_at) AS next_start
          FROM reading_sessions
          WHERE user_id = ${userId}
        ) gaps
        WHERE next_start IS NOT NULL
          AND EXTRACT(EPOCH FROM (next_start - ended_at)) / 86400 >= ${minDays}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasSessionOnJanFirst(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          sql`EXTRACT(MONTH FROM ${readingSessions.startedAt}) = 1`,
          sql`EXTRACT(DAY FROM ${readingSessions.startedAt}) = 1`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async getMaxSessionMinutes(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ value: sql<number>`coalesce(max(${readingSessions.durationSeconds}) / 60.0, 0)::float` })
      .from(readingSessions)
      .where(eq(readingSessions.userId, userId));
    return Math.floor(Number(result?.value ?? 0));
  }

  async hasWeekendMarathon(userId: number, minHours: number): Promise<boolean> {
    const minSeconds = minHours * 3600;
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM user_reading_daily_stats
        WHERE user_id = ${userId}
          AND EXTRACT(DOW FROM day::date) IN (0, 6)
          AND reading_seconds >= ${minSeconds}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async countBooksFinishedInYear(userId: number, year: number): Promise<number> {
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
    return this.countBooksFinishedInDateRange(userId, start, end);
  }

  async countBooksFinishedInMonth(userId: number, year: number, month: number): Promise<number> {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return this.countBooksFinishedInDateRange(userId, start, end);
  }

  async hasCompletedSeriesOfSize(userId: number, size: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM (
	        SELECT bm.series_id,
          COUNT(DISTINCT bm.book_id) AS total_in_series,
          COUNT(DISTINCT ubs.book_id) AS read_count
        FROM book_metadata bm
        LEFT JOIN user_book_status ubs
          ON ubs.book_id = bm.book_id AND ubs.user_id = ${userId} AND ubs.status = 'read'
	        WHERE bm.series_id IS NOT NULL
	        GROUP BY bm.series_id
        HAVING COUNT(DISTINCT bm.book_id) = ${size}
          AND COUNT(DISTINCT bm.book_id) = COUNT(DISTINCT ubs.book_id)
      ) complete_series
      LIMIT 1
    `);
    if ((result as unknown as { rows: unknown[] }).rows.length > 0) return true;
    return this.hasCompletedWarehouseSeriesOfSize(userId, size);
  }

  async countDistinctDecadesRead(userId: number): Promise<number> {
    const localRows = await this.db
      .select({ decade: sql<number>`floor(${bookMetadata.publishedYear} / 10)` })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.publishedYear)))
      .groupBy(sql`floor(${bookMetadata.publishedYear} / 10)`);
    const warehouseYears = await this.listFinishedWarehousePublicationYears(userId);
    return new Set([...localRows.map((row) => row.decade), ...warehouseYears.map((year) => Math.floor(year / 10))]).size;
  }

  async countFinishedBooksByMaxPageCount(userId: number, maxPages: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          lt(bookMetadata.pageCount, maxPages),
        ),
      );
    const warehouseCount = (await this.listFinishedWarehousePageCounts(userId)).filter((pageCount) => pageCount < maxPages).length;
    return value + warehouseCount;
  }

  async hasFinishedBookUnderPages(userId: number, maxPages: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          lt(bookMetadata.pageCount, maxPages),
        ),
      )
      .limit(1);
    if (row) return true;
    return (await this.listFinishedWarehousePageCounts(userId)).some((pageCount) => pageCount < maxPages);
  }

  async hasFinishedBookOverPages(userId: number, minPages: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          gt(bookMetadata.pageCount, minPages),
        ),
      )
      .limit(1);
    if (row) return true;
    return (await this.listFinishedWarehousePageCounts(userId)).some((pageCount) => pageCount > minPages);
  }

  async maxBooksPerGenre(userId: number): Promise<number> {
    const localRows = await this.db
      .select({ genre: genres.name })
      .from(userBookStatus)
      .innerJoin(bookGenres, eq(userBookStatus.bookId, bookGenres.bookId))
      .innerJoin(genres, eq(bookGenres.genreId, genres.id))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    const counts = new Map<string, number>();
    for (const row of localRows) {
      this.incrementGenreCount(counts, row.genre);
    }
    for (const row of await this.listFinishedWarehouseGenres(userId)) {
      const genreKeys = new Set(row.genres.map((genre) => canonicalAchievementGenreName(genre)).filter((genre) => genre.length > 0));
      for (const genreKey of genreKeys) {
        counts.set(genreKey, (counts.get(genreKey) ?? 0) + 1);
      }
    }
    return Math.max(0, ...counts.values());
  }

  private incrementGenreCount(counts: Map<string, number>, genreName: string | null): void {
    if (!genreName) return;
    const genreKey = canonicalAchievementGenreName(genreName);
    if (!genreKey) return;
    counts.set(genreKey, (counts.get(genreKey) ?? 0) + 1);
  }

  async countAnnotationsOnDay(userId: number, date: Date): Promise<number> {
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), gte(annotations.createdAt, dayStart), lt(annotations.createdAt, dayEnd)));
    return value;
  }

  async countAnnotationsWithNotes(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), isNotNull(annotations.note), ne(annotations.note, '')));
    return value;
  }

  async countCollectionBookLinks(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(collectionBooks)
      .innerJoin(collections, eq(collectionBooks.collectionId, collections.id))
      .where(eq(collections.userId, userId));
    return value;
  }

  async getBookSeriesName(bookId: number): Promise<string | null> {
    const [row] = await this.db.select({ seriesName: bookMetadata.seriesName }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return row?.seriesName ?? null;
  }

  async countDistinctFinishedAnnotatedBooks(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(userBookStatus.bookId) })
      .from(userBookStatus)
      .innerJoin(annotations, and(eq(annotations.bookId, userBookStatus.bookId), eq(annotations.userId, userId)))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    return value;
  }

  async countDistinctFinishedBooksInCollections(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(userBookStatus.bookId) })
      .from(userBookStatus)
      .innerJoin(collectionBooks, eq(collectionBooks.bookId, userBookStatus.bookId))
      .innerJoin(collections, and(eq(collections.id, collectionBooks.collectionId), eq(collections.userId, userId)))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    return value;
  }

  async countDistinctEarnedCategories(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(achievements.category) })
      .from(userAchievements)
      .innerJoin(achievements, eq(achievements.key, userAchievements.achievementKey))
      .where(eq(userAchievements.userId, userId));
    return value;
  }

  async hasConsecutiveWeekendsWithReading(userId: number, weeks: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      WITH weekend_weeks AS (
        SELECT DISTINCT
          TO_CHAR(day::date, 'IYYY-IW') AS iso_week
        FROM user_reading_daily_stats
        WHERE user_id = ${userId}
          AND reading_seconds > 0
          AND EXTRACT(DOW FROM day::date) IN (0, 6)
      ),
      ordered AS (
        SELECT iso_week,
          iso_week::text AS yw,
          ROW_NUMBER() OVER (ORDER BY iso_week) AS rn
        FROM weekend_weeks
      ),
      grouped AS (
        SELECT iso_week,
          rn - ROW_NUMBER() OVER (ORDER BY iso_week) AS grp
        FROM ordered
      ),
      runs AS (
        SELECT COUNT(*) AS run_length FROM grouped GROUP BY grp
      )
      SELECT EXISTS (SELECT 1 FROM runs WHERE run_length >= ${weeks}) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async countDistinctSeasonsWithReading(userId: number, year: number): Promise<number> {
    const result = await this.db.execute<{ season: number }>(sql`
      SELECT DISTINCT
        CASE
          WHEN EXTRACT(MONTH FROM day::date) IN (12, 1, 2) THEN 1
          WHEN EXTRACT(MONTH FROM day::date) IN (3, 4, 5)  THEN 2
          WHEN EXTRACT(MONTH FROM day::date) IN (6, 7, 8)  THEN 3
          ELSE 4
        END AS season
      FROM user_reading_daily_stats
      WHERE user_id = ${userId}
        AND reading_seconds > 0
        AND EXTRACT(YEAR FROM day::date) = ${year}
    `);
    return (result as unknown as { rows: unknown[] }).rows.length;
  }

  async hasReadEveryDayInAnyMonth(userId: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      WITH daily AS (
        SELECT
          DATE_TRUNC('month', day::date) AS month_start,
          COUNT(DISTINCT day::date) AS days_read,
          EXTRACT(DAY FROM (DATE_TRUNC('month', day::date) + INTERVAL '1 month' - INTERVAL '1 day'))::int AS days_in_month
        FROM user_reading_daily_stats
        WHERE user_id = ${userId} AND reading_seconds > 0
        GROUP BY DATE_TRUNC('month', day::date)
      )
      SELECT EXISTS (
        SELECT 1 FROM daily WHERE days_read = days_in_month
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasConsecutiveDaysWithMinReading(userId: number, days: number, minSeconds: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      WITH qualifying AS (
        SELECT DISTINCT day::date AS d
        FROM user_reading_daily_stats
        WHERE user_id = ${userId} AND reading_seconds >= ${minSeconds}
      ),
      streaks AS (
        SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
        FROM qualifying
      ),
      runs AS (
        SELECT COUNT(*) AS run_length FROM streaks GROUP BY grp
      )
      SELECT EXISTS (SELECT 1 FROM runs WHERE run_length >= ${days}) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async countSessionsLongerThan(userId: number, minSeconds: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.durationSeconds, minSeconds)));
    return value;
  }

  async getBookStartedAndFinishedAt(userId: number, bookId: number): Promise<{ startedAt: Date | null; finishedAt: Date | null } | null> {
    const [row] = await this.db
      .select({ startedOn: readingAttempts.startedOn, endedOn: readingAttempts.endedOn })
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          eq(readingAttempts.outcome, 'completed'),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .orderBy(desc(readingAttempts.id))
      .limit(1);
    return row ? { startedAt: row.startedOn ? new Date(row.startedOn) : null, finishedAt: row.endedOn ? new Date(row.endedOn) : null } : null;
  }

  async hasAnySlowBurnBook(userId: number, minDays: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(userBookStatus.startedAt),
          isNotNull(userBookStatus.finishedAt),
          sql`EXTRACT(EPOCH FROM (${userBookStatus.finishedAt} - ${userBookStatus.startedAt})) / 86400 > ${minDays}`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasMonthWithBooksFinished(userId: number, minCount: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM reading_attempts
        WHERE user_id = ${userId}
          AND outcome = 'completed'
          AND ended_on IS NOT NULL
          AND deleted_at IS NULL
        GROUP BY DATE_TRUNC('month', ended_on)
        HAVING COUNT(*) >= ${minCount}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasSessionWithProgressDeltaAtLeast(userId: number, minDelta: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), isNotNull(readingSessions.progressDelta), gte(readingSessions.progressDelta, minDelta)))
      .limit(1);
    return !!row;
  }

  async hasAnyDayWithAnnotationCount(userId: number, minCount: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM annotations
        WHERE user_id = ${userId}
        GROUP BY DATE_TRUNC('day', created_at)
        HAVING COUNT(*) >= ${minCount}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasFinishedBookInSeries(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.seriesName),
          ne(bookMetadata.seriesName, ''),
        ),
      )
      .limit(1);
    if (row) return true;
    return this.hasFinishedWarehouseSeriesBook(userId);
  }

  // ── Ratings ──

  async countRatings(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userBookRatings)
      .where(and(eq(userBookRatings.userId, userId), isNotNull(userBookRatings.rating)));
    return value;
  }

  async countRatingsAtMost(userId: number, max: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userBookRatings)
      .where(and(eq(userBookRatings.userId, userId), lte(userBookRatings.rating, max)));
    return value;
  }

  async countDistinctRatingValues(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(userBookRatings.rating) })
      .from(userBookRatings)
      .where(and(eq(userBookRatings.userId, userId), isNotNull(userBookRatings.rating)));
    return value;
  }

  async existsRatingValue(userId: number, value: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookRatings.bookId })
      .from(userBookRatings)
      .where(and(eq(userBookRatings.userId, userId), eq(userBookRatings.rating, value)))
      .limit(1);
    return !!row;
  }

  // ── Reading velocity (pages) ──

  async getPageCountByBookFile(bookFileId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ pageCount: bookMetadata.pageCount })
      .from(bookFiles)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(eq(bookFiles.id, bookFileId))
      .limit(1);
    return row?.pageCount ?? null;
  }

  async getMaxSessionPages(userId: number): Promise<number> {
    const [result] = await this.db
      .select({
        value: sql<number>`coalesce(max(${bookMetadata.pageCount} * least(greatest(${readingSessions.progressDelta}, 0), 100) / 100.0), 0)::float`,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          isNotNull(bookMetadata.pageCount),
          gt(bookMetadata.pageCount, 0),
          isNotNull(readingSessions.progressDelta),
          gt(readingSessions.progressDelta, 0),
          sql`${readingSessions.progressDelta} <= 100`,
          gt(readingSessions.durationSeconds, 0),
        ),
      );
    return Math.floor(Number(result?.value ?? 0));
  }

  async getPagesOnDay(userId: number, day: Date): Promise<number> {
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [result] = await this.db
      .select({
        value: sql<number>`coalesce(sum(${bookMetadata.pageCount} * least(greatest(${readingSessions.progressDelta}, 0), 100) / 100.0), 0)::float`,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          gte(readingSessions.startedAt, dayStart),
          lt(readingSessions.startedAt, dayEnd),
          isNotNull(bookMetadata.pageCount),
          gt(bookMetadata.pageCount, 0),
          isNotNull(readingSessions.progressDelta),
          gt(readingSessions.progressDelta, 0),
          sql`${readingSessions.progressDelta} <= 100`,
          gt(readingSessions.durationSeconds, 0),
        ),
      );
    return Math.floor(Number(result?.value ?? 0));
  }

  async getMaxPagesInADay(userId: number): Promise<number> {
    const result = await this.db.execute<{ max_pages: number }>(sql`
      SELECT COALESCE(MAX(day_pages), 0)::float AS max_pages FROM (
        SELECT SUM(bm.page_count * LEAST(GREATEST(rs.progress_delta, 0), 100) / 100.0) AS day_pages
        FROM reading_sessions rs
        JOIN book_files bf ON bf.id = rs.book_file_id
        JOIN book_metadata bm ON bm.book_id = bf.book_id
        WHERE rs.user_id = ${userId}
          AND bm.page_count IS NOT NULL AND bm.page_count > 0
          AND rs.progress_delta IS NOT NULL AND rs.progress_delta > 0 AND rs.progress_delta <= 100
          AND rs.duration_seconds > 0
        GROUP BY DATE_TRUNC('day', rs.started_at AT TIME ZONE 'UTC')
      ) daily
    `);
    const rows = (result as unknown as { rows: Array<{ max_pages: number }> }).rows;
    return Math.floor(Number(rows[0]?.max_pages ?? 0));
  }

  // ── Annotation enrichment ──

  async getAnnotationNoteLength(annotationId: number, userId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ note: annotations.note })
      .from(annotations)
      .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId)))
      .limit(1);
    if (!row || row.note === null) return null;
    return row.note.length;
  }

  async getMaxNoteLength(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ value: sql<number>`coalesce(max(char_length(${annotations.note})), 0)::int` })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), isNotNull(annotations.note)));
    return Number(result?.value ?? 0);
  }

  async countDistinctColors(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(annotations.color) })
      .from(annotations)
      .where(eq(annotations.userId, userId));
    return value;
  }

  // ── Devices / reading sources ──

  async hasWebSession(userId: number): Promise<boolean> {
    // Kobo analytics also writes reading sessions, so a genuine web-reader session must filter on source.
    const [row] = await this.db
      .select({ id: readingSessions.id })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.source, 'web')))
      .limit(1);
    return !!row;
  }

  async hasKoreaderSync(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: koreaderDeviceProgress.id })
      .from(koreaderDeviceProgress)
      .where(and(eq(koreaderDeviceProgress.userId, userId), eq(koreaderDeviceProgress.orphaned, false)))
      .limit(1);
    return !!row;
  }

  async hasKoboSync(userId: number): Promise<boolean> {
    const [row] = await this.db.select({ id: koboReadingStates.id }).from(koboReadingStates).where(eq(koboReadingStates.userId, userId)).limit(1);
    return !!row;
  }

  async hasAnyExternalDevice(userId: number): Promise<boolean> {
    const [koreader, kobo] = await Promise.all([this.hasKoreaderSync(userId), this.hasKoboSync(userId)]);
    return koreader || kobo;
  }

  async countDistinctSources(userId: number): Promise<number> {
    const [web, koreader, kobo] = await Promise.all([this.hasWebSession(userId), this.hasKoreaderSync(userId), this.hasKoboSync(userId)]);
    return (web ? 1 : 0) + (koreader ? 1 : 0) + (kobo ? 1 : 0);
  }

  async maxSourcesOnSingleBook(userId: number): Promise<number> {
    const result = await this.db.execute<{ max_sources: number }>(sql`
      SELECT COALESCE(MAX(src_count), 0)::int AS max_sources FROM (
        SELECT book_id, COUNT(DISTINCT src) AS src_count FROM (
          SELECT bf.book_id, 'web' AS src
          FROM reading_sessions rs JOIN book_files bf ON bf.id = rs.book_file_id
          WHERE rs.user_id = ${userId} AND rs.source = 'web'
          UNION
          SELECT bf.book_id, 'koreader' AS src
          FROM koreader_device_progress kdp JOIN book_files bf ON bf.id = kdp.book_file_id
          WHERE kdp.user_id = ${userId} AND kdp.orphaned = false AND kdp.book_file_id IS NOT NULL
          UNION
          SELECT krs.book_id, 'kobo' AS src
          FROM kobo_reading_states krs WHERE krs.user_id = ${userId}
        ) sources
        GROUP BY book_id
      ) per_book
    `);
    const rows = (result as unknown as { rows: Array<{ max_sources: number }> }).rows;
    return Number(rows[0]?.max_sources ?? 0);
  }

  // ── Status ──

  async hasAbandonedBook(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'abandoned')))
      .limit(1);
    return !!row;
  }
}
