import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { SQL, and, count, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookMetadata,
  bookSeries,
  bookSeriesMemberships,
  books,
  collections,
  collectionBooks,
  collectionCatalogItems,
  smartScopes,
  libraries,
  userBookStatus,
  userLibraryAccess,
  warehouseCatalogItems,
  warehouseUserItems,
} from '../../db/schema';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { CLOUD_EBOOK_LIBRARY_ID, isContentFilterEmpty } from '@bookorbit/types';
import type { ContentFilterRules, GroupRule, SortSpec } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { WarehouseRepository, type UserOwnedCatalogItemRow } from '../warehouse/warehouse.repository';

type Db = NodePgDatabase<typeof schema>;

type OpdsBookFilters = {
  libraryId?: number;
  collectionId?: number;
  smartScopeId?: number;
  author?: string;
  series?: string;
  seriesId?: number;
  q?: string;
  readStatus?: 'unread' | 'reading' | 'finished';
  format?: string;
  ids?: number[];
};

type SeriesFilter = { seriesId: number } | { normalizedName: string };

type FetchBookEntriesOptions = {
  contextSeries?: SeriesFilter;
};

type ContextSeriesRow = {
  bookId: number;
  seriesId: number;
  seriesName: string;
  seriesIndex: number | null;
};

type OpdsSortOrder =
  | 'recent'
  | 'recent_asc'
  | 'updated'
  | 'updated_asc'
  | 'recently_read'
  | 'recently_read_asc'
  | 'title_asc'
  | 'title_desc'
  | 'author_asc'
  | 'author_desc'
  | 'series_asc'
  | 'series_desc';
type CatalogEbookPageFilters = { collectionId?: number; author?: string; series?: string; q?: string };
type OpdsCatalogFilters = {
  libraryId?: number;
  collectionId?: number;
  smartScopeId?: number;
  author?: string;
  series?: string;
  q?: string;
  readStatus?: 'unread' | 'reading' | 'finished';
  format?: string;
  ids?: number[];
};
type OpdsNavigationCount<Name extends string | null = string> = { name: Name; bookCount: number };

const OPDS_SORT_MAP: Record<OpdsSortOrder, SQL[]> = {
  recent: [sql`${books.addedAt} DESC`, sql`${books.id} ASC`],
  recent_asc: [sql`${books.addedAt} ASC`, sql`${books.id} ASC`],
  updated: [sql`${books.updatedAt} DESC`, sql`${books.id} ASC`],
  updated_asc: [sql`${books.updatedAt} ASC`, sql`${books.id} ASC`],
  recently_read: [sql`${userBookStatus.updatedAt} DESC NULLS LAST`, sql`${books.id} ASC`],
  recently_read_asc: [sql`${userBookStatus.updatedAt} ASC NULLS LAST`, sql`${books.id} ASC`],
  title_asc: [sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  title_desc: [sql`${bookMetadata.title} DESC NULLS LAST`, sql`${books.id} ASC`],
  author_asc: [sql`min(${authors.sortName}) ASC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  author_desc: [sql`min(${authors.sortName}) DESC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  series_asc: [sql`${bookMetadata.seriesName} ASC NULLS LAST`, sql`${bookMetadata.seriesIndex} ASC NULLS LAST`, sql`${books.id} ASC`],
  series_desc: [sql`${bookMetadata.seriesName} DESC NULLS LAST`, sql`${bookMetadata.seriesIndex} DESC NULLS LAST`, sql`${books.id} ASC`],
};

const READ_STATUS_BUCKETS = {
  reading: ['reading', 'rereading', 'on_hold'],
  finished: ['read', 'skimmed', 'abandoned'],
} as const;

const ACTIVE_READ_STATUSES = [...READ_STATUS_BUCKETS.reading, ...READ_STATUS_BUCKETS.finished];

const LIKE_SPECIAL_CHARS = /[%_\\]/g;

export interface OpdsBookEntry {
  id: number | string;
  kind?: 'book' | 'catalog-ebook';
  title: string;
  sortTitle?: string | null;
  sortAuthor?: string | null;
  folderPath: string;
  addedAt: Date;
  updatedAt: Date;
  description: string | null;
  seriesId: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
  hasCover: boolean;
  authors: string[];
  files: { id: number | string; format: string; href?: string }[];
  coverHref?: string;
  thumbnailHref?: string;
}

export interface OpdsManifestFileRow {
  id: number;
  format: string;
  sizeBytes: number | null;
  fileHash: string | null;
  filename: string | null;
  contentVersion: Date;
}

export interface OpdsManifestBookRow {
  id: number;
  title: string;
  subtitle: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  language: string | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn10: string | null;
  isbn13: string | null;
  files: OpdsManifestFileRow[];
}

@Injectable()
export class OpdsBookService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queryBuilder: BookQueryBuilder,
    @Optional() private readonly warehouseCatalog?: WarehouseCatalogService,
    @Optional() private readonly warehouseRepository?: WarehouseRepository,
  ) {}

  async getAccessibleLibraryIds(userId: number, isSuperuser = false): Promise<number[]> {
    if (isSuperuser) {
      const rows = await this.db.select({ id: libraries.id }).from(libraries);
      return rows.map((r) => r.id);
    }
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  async getAccessibleLibraries(userId: number, isSuperuser = false): Promise<{ id: number; name: string; bookCount: number }[]> {
    const filesystemLibraries = isSuperuser
      ? await this.db
          .select({
            id: libraries.id,
            name: libraries.name,
            bookCount: sql<number>`count(${books.id})::int`,
          })
          .from(libraries)
          .leftJoin(books, and(eq(books.libraryId, libraries.id), eq(books.status, 'present')))
          .groupBy(libraries.id)
          .orderBy(libraries.name)
      : await this.db
          .select({
            id: libraries.id,
            name: libraries.name,
            bookCount: sql<number>`count(${books.id})::int`,
          })
          .from(libraries)
          .innerJoin(userLibraryAccess, and(eq(userLibraryAccess.libraryId, libraries.id), eq(userLibraryAccess.userId, userId)))
          .leftJoin(books, and(eq(books.libraryId, libraries.id), eq(books.status, 'present')))
          .groupBy(libraries.id)
          .orderBy(libraries.name);

    const ebookLibrary = await this.getAccessibleCatalogEbookLibrary(userId);
    return ebookLibrary ? [ebookLibrary, ...filesystemLibraries] : filesystemLibraries;
  }

  async getBooksPage(
    userId: number,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    filters?: OpdsCatalogFilters,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0 && !filters?.smartScopeId) return { entries: [], total: 0 };

    if (filters?.ids && filters.ids.length === 0) return { entries: [], total: 0 };

    if (filters?.libraryId && !accessibleIds.includes(filters.libraryId)) {
      throw new ForbiddenException('No access to this library');
    }

    if (filters?.collectionId) {
      const [collection] = await this.db
        .select({ userId: collections.userId })
        .from(collections)
        .where(eq(collections.id, filters.collectionId))
        .limit(1);
      if (!collection || collection.userId !== userId) {
        throw new ForbiddenException('No access to this collection');
      }
    }

    if (filters?.smartScopeId) {
      return this.getBooksBySmartScope(userId, filters.smartScopeId, accessibleIds, sortOrder, page, size, contentFilters, filters.q);
    }

    const clauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];

    if (filters?.libraryId) clauses.push(eq(books.libraryId, filters.libraryId));

    if (filters?.ids) clauses.push(inArray(books.id, filters.ids));

    if (filters?.collectionId) {
      clauses.push(
        sql`${books.id} IN (SELECT ${collectionBooks.bookId} FROM ${collectionBooks} WHERE ${collectionBooks.collectionId} = ${filters.collectionId})`,
      );
    }

    if (filters?.author) {
      clauses.push(
        sql`${books.id} IN (SELECT ${bookAuthors.bookId} FROM ${bookAuthors} INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId} WHERE ${authors.name} = ${filters.author})`,
      );
    }

    const seriesFilter = this.resolveSeriesFilter(filters);
    if (seriesFilter) clauses.push(this.buildSeriesMembershipClause(seriesFilter));

    if (filters?.format) {
      const format = filters.format.trim().toLowerCase();
      if (format) {
        clauses.push(
          sql`${books.id} IN (SELECT ${bookFiles.bookId} FROM ${bookFiles} WHERE ${bookFiles.role} = 'content' AND lower(${bookFiles.format}) = ${format})`,
        );
      }
    }

    if (filters?.readStatus) {
      clauses.push(this.buildReadStatusClause(userId, filters.readStatus));
    }

    if (filters?.q) {
      const searchClause = this.buildCatalogSearchClause(filters.q);
      if (searchClause) clauses.push(searchClause);
    }

    if (!isSuperuser && contentFilters) {
      clauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }

    return this.paginatedBookQuery(and(...clauses)!, sortOrder, page, size, userId, { contextSeries: seriesFilter });
  }

  private buildReadStatusClause(userId: number, readStatus: 'unread' | 'reading' | 'finished'): SQL {
    if (readStatus === 'unread') {
      return sql`${books.id} NOT IN (SELECT ${userBookStatus.bookId} FROM ${userBookStatus} WHERE ${userBookStatus.userId} = ${userId} AND ${userBookStatus.status} IN ${ACTIVE_READ_STATUSES})`;
    }
    const statuses = READ_STATUS_BUCKETS[readStatus];
    return sql`${books.id} IN (SELECT ${userBookStatus.bookId} FROM ${userBookStatus} WHERE ${userBookStatus.userId} = ${userId} AND ${userBookStatus.status} IN ${statuses})`;
  }

  async getLibraryBooksPage(
    userId: number,
    sortOrder: OpdsSortOrder,
    libraryId: number,
    page: number,
    size: number,
    filters?: CatalogEbookPageFilters,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    if (libraryId === CLOUD_EBOOK_LIBRARY_ID) {
      if (!this.warehouseCatalog || !(await this.warehouseCatalog.isCatalogEnabled())) {
        return { entries: [], total: 0 };
      }
      return this.getCatalogEbookPage(userId, page, size, filters, sortOrder, isSuperuser ? undefined : contentFilters);
    }

    return this.getBooksPage(userId, sortOrder, page, size, { ...filters, libraryId }, isSuperuser, contentFilters);
  }

  private buildCatalogSearchClause(q: string): SQL | undefined {
    const term = q.trim();
    if (!term) return undefined;

    const pattern = `%${term.replace(LIKE_SPECIAL_CHARS, '\\$&')}%`;
    const existsAuthor = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(and(eq(bookAuthors.bookId, books.id), accentInsensitiveIlike(authors.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    const existsSeries = sql`exists (
      SELECT 1
      FROM ${bookSeriesMemberships}
      INNER JOIN ${bookSeries} ON ${bookSeries.id} = ${bookSeriesMemberships.seriesId}
      WHERE ${bookSeriesMemberships.bookId} = ${books.id}
        AND ${accentInsensitiveIlike(bookSeries.name, pattern)}
    )`;

    const clauses: SQL[] = [
      accentInsensitiveIlike(bookMetadata.title, pattern),
      existsAuthor,
      existsSeries,
      accentInsensitiveIlike(bookMetadata.seriesName, pattern),
    ];
    const normalizedIsbn = normalizeIsbnSearchTerm(term);
    if (normalizedIsbn) {
      clauses.push(or(eq(bookMetadata.isbn13, normalizedIsbn), eq(bookMetadata.isbn10, normalizedIsbn))!);
    }

    return or(...clauses)!;
  }

  async getRecentBooksPage(
    userId: number,
    page: number,
    size: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { entries: [], total: 0 };
    const clauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];
    if (!isSuperuser && contentFilters) {
      clauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }
    const where = and(...clauses);
    return this.paginatedBookQuery(where!, 'recent', page, size);
  }

  async getBooksAndCatalogEbooksPage(
    userId: number,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    filters?: CatalogEbookPageFilters,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const candidateSize = page * size;
    const [localPage, catalogPage] = await Promise.all([
      this.getBooksPage(userId, sortOrder, 1, candidateSize, filters, isSuperuser, contentFilters),
      this.getCatalogEbookPage(userId, 1, candidateSize, filters, sortOrder, contentFilters),
    ]);

    return mergedOpdsPage(localPage, catalogPage, sortOrder, page, size);
  }

  async getRecentBooksAndCatalogEbooksPage(
    userId: number,
    page: number,
    size: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const candidateSize = page * size;
    const [localPage, catalogPage] = await Promise.all([
      this.getRecentBooksPage(userId, 1, candidateSize, isSuperuser, contentFilters),
      this.getCatalogEbookPage(userId, 1, candidateSize, undefined, 'recent', contentFilters),
    ]);

    return mergedOpdsPage(localPage, catalogPage, 'recent', page, size);
  }

  async getCatalogEbookPage(
    userId: number,
    page: number,
    size: number,
    filters?: CatalogEbookPageFilters,
    sortOrder: OpdsSortOrder = 'recent',
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const offset = (page - 1) * size;
    const whereClauses: SQL[] = [eq(warehouseCatalogItems.mediaType, 'ebook')];
    const searchClause = filters?.q ? this.buildCatalogEbookSearchClause(filters.q) : undefined;
    if (searchClause) whereClauses.push(searchClause);
    const authorClause = filters?.author ? this.buildCatalogEbookAuthorClause(filters.author) : undefined;
    if (authorClause) whereClauses.push(authorClause);
    const seriesClause = filters?.series ? this.buildCatalogEbookSeriesClause(filters.series) : undefined;
    if (seriesClause) whereClauses.push(seriesClause);
    const collectionClause = filters?.collectionId ? this.buildCatalogEbookCollectionClause(filters.collectionId) : undefined;
    if (collectionClause) whereClauses.push(collectionClause);
    whereClauses.push(...buildCatalogContentFilterClauses(contentFilters));

    const where = and(...whereClauses)!;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          remoteId: warehouseCatalogItems.remoteId,
          title: warehouseCatalogItems.title,
          sortTitle: warehouseCatalogItems.sortTitle,
          authors: warehouseCatalogItems.authors,
          series: warehouseCatalogItems.series,
          language: warehouseCatalogItems.language,
          publisher: warehouseCatalogItems.publisher,
          identifiers: warehouseCatalogItems.identifiers,
          format: warehouseCatalogItems.format,
          hasCover: warehouseCatalogItems.hasCover,
          syncedAt: warehouseCatalogItems.syncedAt,
          addedAt: sql<Date>`coalesce(${warehouseUserItems.addedAt}, ${warehouseCatalogItems.syncedAt})`,
          userUpdatedAt: sql<Date>`coalesce(${warehouseUserItems.updatedAt}, ${warehouseCatalogItems.syncedAt})`,
        })
        .from(warehouseCatalogItems)
        .leftJoin(
          warehouseUserItems,
          and(
            eq(warehouseUserItems.userId, userId),
            eq(warehouseUserItems.mediaType, warehouseCatalogItems.mediaType),
            eq(warehouseUserItems.remoteId, warehouseCatalogItems.remoteId),
          ),
        )
        .where(where)
        .orderBy(...catalogEbookOrderBy(sortOrder))
        .limit(size)
        .offset(offset),
      this.db.select({ total: count() }).from(warehouseCatalogItems).where(where),
    ]);

    return {
      entries: rows.map((row) => this.catalogEbookEntry(row)),
      total: Number(total),
    };
  }

  private buildCatalogEbookSearchClause(q: string): SQL | undefined {
    const term = q.trim();
    if (!term) return undefined;

    const pattern = `%${term.replace(LIKE_SPECIAL_CHARS, '\\$&')}%`;
    return or(
      accentInsensitiveIlike(warehouseCatalogItems.title, pattern),
      accentInsensitiveIlike(sql<string>`coalesce(${warehouseCatalogItems.authors}::text, '')`, pattern),
      accentInsensitiveIlike(sql<string>`coalesce(${warehouseCatalogItems.series}, '')`, pattern),
      accentInsensitiveIlike(sql<string>`coalesce(${warehouseCatalogItems.identifiers}::text, '')`, pattern),
      accentInsensitiveIlike(sql<string>`coalesce(${warehouseCatalogItems.format}, '')`, pattern),
      accentInsensitiveIlike(sql<string>`coalesce(${warehouseCatalogItems.language}, '')`, pattern),
      accentInsensitiveIlike(sql<string>`coalesce(${warehouseCatalogItems.publisher}, '')`, pattern),
    )!;
  }

  private buildCatalogEbookAuthorClause(author: string): SQL | undefined {
    const term = author.trim();
    if (!term) return undefined;

    return sql`exists (select 1 from jsonb_array_elements_text(${warehouseCatalogItems.authors}) as author_name(name) where author_name.name = ${term})`;
  }

  private buildCatalogEbookSeriesClause(series: string): SQL | undefined {
    const term = series.trim();
    if (!term) return undefined;

    return eq(warehouseCatalogItems.series, term);
  }

  private buildCatalogEbookCollectionClause(collectionId: number): SQL {
    return sql`exists (
      select 1
      from ${collectionCatalogItems}
      where ${collectionCatalogItems.collectionId} = ${collectionId}
        and ${collectionCatalogItems.mediaType} = ${warehouseCatalogItems.mediaType}
        and ${collectionCatalogItems.remoteId} = ${warehouseCatalogItems.remoteId}
    )`;
  }

  async getRandomBooks(userId: number, count: number, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<OpdsBookEntry[]> {
    if (count <= 0) return [];

    const [localEntries, catalogEntries] = await Promise.all([
      this.getRandomLocalBooks(userId, count, isSuperuser, contentFilters),
      this.getRandomCatalogEbooks(userId, count, contentFilters),
    ]);

    return shuffleEntries([...localEntries, ...catalogEntries]).slice(0, count);
  }

  private async getRandomLocalBooks(
    userId: number,
    count: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<OpdsBookEntry[]> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return [];

    const baseClauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];
    if (!isSuperuser && contentFilters) {
      baseClauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }
    const baseFilter = and(...baseClauses)!;
    const idRows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(baseFilter)
      .orderBy(sql`random()`)
      .limit(count);

    const ids = idRows.map((row) => row.id);
    if (ids.length === 0) return [];
    return this.fetchBookEntries(ids);
  }

  private async getRandomCatalogEbooks(userId: number, count: number, contentFilters?: ContentFilterRules): Promise<OpdsBookEntry[]> {
    if (!(await this.shouldIncludeCatalogOpdsRows())) return [];

    const rows = await this.db
      .select({
        remoteId: warehouseCatalogItems.remoteId,
        title: warehouseCatalogItems.title,
        sortTitle: warehouseCatalogItems.sortTitle,
        authors: warehouseCatalogItems.authors,
        series: warehouseCatalogItems.series,
        language: warehouseCatalogItems.language,
        publisher: warehouseCatalogItems.publisher,
        identifiers: warehouseCatalogItems.identifiers,
        format: warehouseCatalogItems.format,
        hasCover: warehouseCatalogItems.hasCover,
        syncedAt: warehouseCatalogItems.syncedAt,
        addedAt: sql<Date>`coalesce(${warehouseUserItems.addedAt}, ${warehouseCatalogItems.syncedAt})`,
        userUpdatedAt: sql<Date>`coalesce(${warehouseUserItems.updatedAt}, ${warehouseCatalogItems.syncedAt})`,
      })
      .from(warehouseCatalogItems)
      .leftJoin(
        warehouseUserItems,
        and(
          eq(warehouseUserItems.userId, userId),
          eq(warehouseUserItems.mediaType, warehouseCatalogItems.mediaType),
          eq(warehouseUserItems.remoteId, warehouseCatalogItems.remoteId),
        ),
      )
      .where(and(eq(warehouseCatalogItems.mediaType, 'ebook'), ...buildCatalogContentFilterClauses(contentFilters)))
      .orderBy(sql`random()`)
      .limit(count);

    return rows.map((row) => this.catalogEbookEntry(row));
  }

  async getDistinctAuthors(userId: number, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<OpdsNavigationCount[]> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const [localRows, catalogRows] = await Promise.all([
      accessibleIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              name: authors.name,
              bookCount: sql<number>`count(DISTINCT ${bookAuthors.bookId})::int`,
            })
            .from(authors)
            .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
            .innerJoin(books, and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...filterClauses))
            .where(inArray(books.libraryId, accessibleIds))
            .groupBy(authors.name, authors.sortName)
            .orderBy(sql`${authors.sortName} ASC NULLS LAST`),
      this.getCatalogDistinctAuthors(contentFilters),
    ]);

    return mergeNavigationCounts(localRows, catalogRows, normalizeAuthorDisplayName);
  }

  async getDistinctSeries(userId: number, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<OpdsNavigationCount<string | null>[]> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const [localRows, catalogRows] = await Promise.all([
      accessibleIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              name: bookMetadata.seriesName,
              bookCount: sql<number>`count(DISTINCT ${books.id})::int`,
            })
            .from(bookMetadata)
            .innerJoin(books, and(eq(books.id, bookMetadata.bookId), eq(books.status, 'present'), ...filterClauses))
            .where(and(inArray(books.libraryId, accessibleIds), sql`${bookMetadata.seriesName} IS NOT NULL`))
            .groupBy(bookMetadata.seriesName)
            .orderBy(sql`${bookMetadata.seriesName} ASC`),
      this.getCatalogDistinctSeries(contentFilters),
    ]);

    return mergeNavigationCounts(localRows, catalogRows, normalizeSeriesName);
  }

  private async getCatalogDistinctAuthors(contentFilters?: ContentFilterRules): Promise<OpdsNavigationCount[]> {
    if (!(await this.shouldIncludeCatalogNavigationRows())) return [];

    const authorName = catalogAuthorDisplayNameSql(sql`author_value.name`);
    const result = await this.db.execute(sql`
      select
        min(${authorName}) as name,
        count(distinct (${warehouseCatalogItems.mediaType}::text || ':' || ${warehouseCatalogItems.remoteId}))::int as "bookCount"
      from ${warehouseCatalogItems}
      cross join lateral jsonb_array_elements_text(${warehouseCatalogItems.authors}) as author_value(name)
      where ${warehouseCatalogItems.mediaType} = 'ebook'
        and nullif(${authorName}, '') is not null
        ${catalogContentFilterWhereSql(contentFilters)}
      group by ${catalogAuthorCanonicalNameSql(sql`author_value.name`)}
      order by min(${authorName}) asc
    `);

    return navigationCountRows<string>(result, false);
  }

  private async getCatalogDistinctSeries(contentFilters?: ContentFilterRules): Promise<OpdsNavigationCount<string | null>[]> {
    if (!(await this.shouldIncludeCatalogNavigationRows())) return [];

    const result = await this.db.execute(sql`
      select
        ${warehouseCatalogItems.series} as name,
        count(distinct (${warehouseCatalogItems.mediaType}::text || ':' || ${warehouseCatalogItems.remoteId}))::int as "bookCount"
      from ${warehouseCatalogItems}
      where ${warehouseCatalogItems.mediaType} = 'ebook'
        and nullif(trim(${warehouseCatalogItems.series}), '') is not null
        ${catalogContentFilterWhereSql(contentFilters)}
      group by ${warehouseCatalogItems.series}
      order by ${warehouseCatalogItems.series} asc
    `);

    return navigationCountRows(result, true);
  }

  private async shouldIncludeCatalogNavigationRows(): Promise<boolean> {
    return this.shouldIncludeCatalogOpdsRows();
  }

  private async shouldIncludeCatalogOpdsRows(): Promise<boolean> {
    if (!this.warehouseCatalog || !(await this.warehouseCatalog.isCatalogEnabled())) return false;
    return true;
  }

  async getDistinctAuthorsPage(
    userId: number,
    opts: { q?: string; limit: number; offset: number },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ items: { name: string; bookCount: number }[]; hasNext: boolean }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { items: [], hasNext: false };

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const where: SQL[] = [inArray(books.libraryId, accessibleIds)];
    const term = opts.q?.trim();
    if (term) {
      where.push(accentInsensitiveIlike(authors.name, `%${term.replace(LIKE_SPECIAL_CHARS, '\\$&')}%`));
    }

    const rows = await this.db
      .select({
        name: authors.name,
        bookCount: sql<number>`count(DISTINCT ${bookAuthors.bookId})::int`,
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...filterClauses))
      .where(and(...where))
      .groupBy(authors.name, authors.sortName)
      .orderBy(sql`${authors.sortName} ASC NULLS LAST`)
      .limit(opts.limit + 1)
      .offset(opts.offset);

    const hasNext = rows.length > opts.limit;
    return { items: hasNext ? rows.slice(0, opts.limit) : rows, hasNext };
  }

  async getDistinctSeriesPage(
    userId: number,
    opts: { q?: string; limit: number; offset: number },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ items: { id: number; name: string; bookCount: number }[]; hasNext: boolean }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { items: [], hasNext: false };

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const where: SQL[] = [inArray(books.libraryId, accessibleIds)];
    const term = opts.q?.trim();
    if (term) {
      where.push(accentInsensitiveIlike(bookSeries.name, `%${term.replace(LIKE_SPECIAL_CHARS, '\\$&')}%`));
    }

    const rows = await this.db
      .select({
        id: bookSeries.id,
        name: bookSeries.name,
        bookCount: sql<number>`count(DISTINCT ${books.id})::int`,
      })
      .from(bookSeries)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.seriesId, bookSeries.id))
      .innerJoin(books, and(eq(books.id, bookSeriesMemberships.bookId), eq(books.status, 'present'), ...filterClauses))
      .where(and(...where))
      .groupBy(bookSeries.id, bookSeries.name)
      .orderBy(sql`${bookSeries.name} ASC`)
      .limit(opts.limit + 1)
      .offset(opts.offset);

    const hasNext = rows.length > opts.limit;
    return { items: hasNext ? rows.slice(0, opts.limit) : rows, hasNext };
  }

  async getUserCollections(userId: number) {
    return this.db
      .select({
        id: collections.id,
        name: collections.name,
        bookCount: sql<number>`(
          count(${collectionBooks.bookId})::int +
          (
            select count(*)::int
            from ${collectionCatalogItems}
            inner join ${warehouseUserItems}
              on ${warehouseUserItems.mediaType} = ${collectionCatalogItems.mediaType}
              and ${warehouseUserItems.remoteId} = ${collectionCatalogItems.remoteId}
              and ${warehouseUserItems.userId} = ${userId}
            where ${collectionCatalogItems.collectionId} = ${collections.id}
              and ${collectionCatalogItems.mediaType} = 'ebook'
          )
        )`,
      })
      .from(collections)
      .leftJoin(collectionBooks, eq(collectionBooks.collectionId, collections.id))
      .where(eq(collections.userId, userId))
      .groupBy(collections.id)
      .orderBy(collections.name);
  }

  async getUserSmartScopes(userId: number) {
    return this.db
      .select({
        id: smartScopes.id,
        name: smartScopes.name,
        icon: smartScopes.icon,
      })
      .from(smartScopes)
      .where(or(eq(smartScopes.userId, userId), eq(smartScopes.isPublic, true)))
      .orderBy(smartScopes.displayOrder, smartScopes.name);
  }

  async validateBookAccess(bookId: number, userId: number, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<void> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const [row] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    if (!row || !accessibleIds.includes(row.libraryId)) {
      throw new ForbiddenException('No access to this book');
    }
    if (!isSuperuser && contentFilters) {
      const filterClauses = buildContentFilterClauses(contentFilters, this.db);
      if (filterClauses.length > 0) {
        const [filtered] = await this.db
          .select({ id: books.id })
          .from(books)
          .where(and(eq(books.id, bookId), ...filterClauses))
          .limit(1);
        if (!filtered) throw new ForbiddenException('No access to this book');
      }
    }
  }

  async getBookFiles(bookId: number, fileId?: number): Promise<{ absolutePath: string; format: string; title: string; authorName: string } | null> {
    const fileQuery = this.db
      .select({
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        title: bookMetadata.title,
      })
      .from(bookFiles)
      .leftJoin(books, eq(books.id, bookFiles.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(fileId ? and(eq(bookFiles.id, fileId), eq(bookFiles.bookId, bookId)) : and(eq(books.id, bookId), eq(bookFiles.id, books.primaryFileId)))
      .limit(1);

    const [file] = await fileQuery;
    if (!file) return null;

    const [authorRow] = await this.db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(eq(bookAuthors.bookId, bookId))
      .orderBy(bookAuthors.displayOrder)
      .limit(1);

    return {
      absolutePath: file.absolutePath,
      format: file.format ?? 'unknown',
      title: file.title ?? `book-${bookId}`,
      authorName: authorRow?.name ?? '',
    };
  }

  private catalogEbookEntry(row: {
    remoteId: string;
    title: string;
    sortTitle: string | null;
    authors: string[] | null;
    series: string | null;
    language: string | null;
    publisher: string | null;
    identifiers: Record<string, string> | null;
    format: string | null;
    hasCover: boolean | null;
    syncedAt: Date;
    addedAt: Date;
    userUpdatedAt: Date;
  }): OpdsBookEntry {
    const encodedId = encodeURIComponent(row.remoteId);
    const identifiers = row.identifiers ?? {};
    const format = row.format ?? 'epub';
    const rowAuthors = stringArray(row.authors);

    return {
      id: row.remoteId,
      kind: 'catalog-ebook',
      title: row.title,
      sortTitle: row.sortTitle ?? row.title,
      sortAuthor: rowAuthors[0] ?? null,
      folderPath: '',
      addedAt: row.addedAt,
      updatedAt: row.userUpdatedAt ?? row.syncedAt,
      description: null,
      seriesId: null,
      seriesName: row.series,
      seriesIndex: null,
      language: row.language,
      publisher: row.publisher,
      isbn13: identifiers.isbn13 ?? identifiers.isbn ?? null,
      hasCover: row.hasCover === true,
      authors: rowAuthors,
      files: [
        {
          id: row.remoteId,
          format,
          href: `/api/v1/opds/catalog-ebooks/${encodedId}/download`,
        },
      ],
      coverHref: `/api/v1/opds/catalog-ebooks/${encodedId}/cover`,
      thumbnailHref: `/api/v1/opds/catalog-ebooks/${encodedId}/thumbnail`,
    };
  }

  private async getAccessibleCatalogEbookLibrary(userId: number): Promise<{ id: number; name: string; bookCount: number } | null> {
    if (!this.warehouseCatalog || !(await this.warehouseCatalog.isCatalogEnabled())) {
      return null;
    }

    const overview = await this.warehouseCatalog.getUserLibraryOverview(userId, undefined, ['ebook']);
    return {
      id: CLOUD_EBOOK_LIBRARY_ID,
      name: 'Books',
      bookCount: overview.totalBooks,
    };
  }

  private async getBooksBySmartScope(
    userId: number,
    smartScopeId: number,
    accessibleIds: number[],
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    contentFilters?: ContentFilterRules,
    q?: string,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    // One read of the scope row, then the shared predicate. OPDS browsing adds
    // explicit library scoping and merges in warehouse catalog items; the
    // catalog/manifest endpoints use the same predicate via buildSmartScopeWhere.
    const smartScope = await this.loadReadableSmartScope(userId, smartScopeId);
    if (!smartScope) return { entries: [], total: 0 };
    const localWhere = this.smartScopeWhere(smartScope, userId, accessibleIds, contentFilters, q);

    const localClauses = [localWhere, accessibleIds.length > 0 ? inArray(books.libraryId, accessibleIds) : undefined].filter(
      (clause): clause is SQL => clause !== undefined,
    );
    const canIncludeCatalog = this.warehouseCatalog && this.warehouseRepository && (await this.warehouseCatalog.isCatalogEnabled());

    if (!canIncludeCatalog) {
      if (accessibleIds.length === 0) return { entries: [], total: 0 };
      return this.paginatedBookQuery(and(...localClauses)!, sortOrder, page, size, userId);
    }

    const candidateSize = page * size;
    const localPagePromise =
      accessibleIds.length > 0
        ? this.paginatedBookQuery(and(...localClauses)!, sortOrder, 1, candidateSize, userId)
        : Promise.resolve({ entries: [], total: 0 });
    const catalogPagePromise = this.getCatalogEbooksBySmartScope(
      userId,
      smartScope.filter as GroupRule | null,
      sortOrder,
      1,
      candidateSize,
      q,
      contentFilters,
    );
    const [localPage, catalogPage] = await Promise.all([localPagePromise, catalogPagePromise]);
    return mergedOpdsPage(localPage, catalogPage, sortOrder, page, size);
  }

  private async getCatalogEbooksBySmartScope(
    userId: number,
    filter: GroupRule | null,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    q?: string,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    if (!this.warehouseRepository) return { entries: [], total: 0 };
    const catalogPage = await this.warehouseRepository.queryUserCatalogItems(userId, {
      includeAllCatalogItems: true,
      filter: filter ?? undefined,
      mediaType: 'ebook',
      contentFilters,
      q,
      sort: catalogSortSpec(sortOrder),
      page: page - 1,
      limit: size,
    });
    return {
      entries: catalogPage.rows.map((row) => this.catalogEbookEntryFromUserCatalogRow(row)),
      total: catalogPage.total,
    };
  }

  private catalogEbookEntryFromUserCatalogRow(row: UserOwnedCatalogItemRow): OpdsBookEntry {
    return this.catalogEbookEntry({
      remoteId: row.remoteId,
      title: row.title,
      sortTitle: row.sortTitle,
      authors: row.authors,
      series: row.series,
      language: row.language,
      publisher: row.publisher,
      identifiers: row.identifiers,
      format: row.format,
      hasCover: row.hasCover,
      syncedAt: row.syncedAt,
      addedAt: row.userAddedAt ?? row.syncedAt,
      userUpdatedAt: row.updatedAt ?? row.syncedAt,
    });
  }

  private async paginatedBookQuery(
    where: SQL,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    userId?: number,
    options: FetchBookEntriesOptions = {},
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const offset = (page - 1) * size;
    const needsAuthorJoin = sortOrder === 'author_asc' || sortOrder === 'author_desc';
    const needsStatusJoin = (sortOrder === 'recently_read' || sortOrder === 'recently_read_asc') && userId !== undefined;
    const needsContextSeriesJoin = options.contextSeries !== undefined && (sortOrder === 'series_asc' || sortOrder === 'series_desc');
    const orderClauses = needsContextSeriesJoin ? this.buildContextSeriesOrder(sortOrder) : OPDS_SORT_MAP[sortOrder];

    const buildIdQuery = () => {
      if (needsContextSeriesJoin) {
        const query = this.db
          .select({ id: books.id })
          .from(books)
          .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
          .innerJoin(bookSeriesMemberships, this.buildContextSeriesMembershipJoin(options.contextSeries!));

        if ('normalizedName' in options.contextSeries!) {
          return query
            .innerJoin(
              bookSeries,
              and(eq(bookSeries.id, bookSeriesMemberships.seriesId), eq(bookSeries.normalizedName, options.contextSeries.normalizedName))!,
            )
            .where(where)
            .orderBy(...orderClauses)
            .limit(size)
            .offset(offset);
        }

        return query
          .where(where)
          .orderBy(...orderClauses)
          .limit(size)
          .offset(offset);
      }
      if (needsAuthorJoin) {
        return this.db
          .select({ id: books.id })
          .from(books)
          .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
          .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
          .leftJoin(authors, eq(authors.id, bookAuthors.authorId))
          .where(where)
          .groupBy(books.id, bookMetadata.title, bookMetadata.seriesName, bookMetadata.seriesIndex)
          .orderBy(...orderClauses)
          .limit(size)
          .offset(offset);
      }
      if (needsStatusJoin) {
        return this.db
          .select({ id: books.id })
          .from(books)
          .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
          .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId!)))
          .where(where)
          .orderBy(...orderClauses)
          .limit(size)
          .offset(offset);
      }
      return this.db
        .select({ id: books.id })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(...orderClauses)
        .limit(size)
        .offset(offset);
    };

    const [idRows, [{ total }]] = await Promise.all([
      buildIdQuery(),
      this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where),
    ]);

    if (idRows.length === 0) return { entries: [], total: Number(total) };

    const entries = await this.fetchBookEntries(
      idRows.map((r) => r.id),
      options,
    );
    return { entries, total: Number(total) };
  }

  private async fetchBookEntries(bookIds: number[], options: FetchBookEntriesOptions = {}): Promise<OpdsBookEntry[]> {
    if (bookIds.length === 0) return [];

    const [metaRows, authorRows, fileRows, contextSeriesRows] = await Promise.all([
      this.db
        .select({
          id: books.id,
          folderPath: books.folderPath,
          addedAt: books.addedAt,
          bookUpdatedAt: books.updatedAt,
          title: bookMetadata.title,
          description: bookMetadata.description,
          seriesId: bookMetadata.seriesId,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          language: bookMetadata.language,
          publisher: bookMetadata.publisher,
          isbn13: bookMetadata.isbn13,
          coverSource: bookMetadata.coverSource,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name, sortName: authors.sortName })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ bookId: books.id, id: bookFiles.id, format: bookFiles.format, role: bookFiles.role })
        .from(bookFiles)
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(and(inArray(bookFiles.bookId, bookIds), eq(bookFiles.role, 'content')))
        .orderBy(sql`case when ${bookFiles.id} = ${books.primaryFileId} then 0 else 1 end`, bookFiles.sortOrder, bookFiles.id),
      options.contextSeries ? this.fetchContextSeriesRows(bookIds, options.contextSeries) : Promise.resolve<ContextSeriesRow[]>([]),
    ]);

    const authorsByBook = new Map<number, string[]>();
    const authorSortByBook = new Map<number, string>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
      const sortName = row.sortName ?? row.name;
      const currentSortName = authorSortByBook.get(row.bookId);
      if (!currentSortName || sortName.localeCompare(currentSortName) < 0) {
        authorSortByBook.set(row.bookId, sortName);
      }
    }

    const filesByBook = new Map<number, { id: number; format: string }[]>();
    for (const row of fileRows) {
      if (row.role !== 'content') continue;
      const list = filesByBook.get(row.bookId) ?? [];
      list.push({ id: row.id, format: row.format ?? 'unknown' });
      filesByBook.set(row.bookId, list);
    }

    const idOrder = new Map(bookIds.map((id, i) => [id, i]));
    const contextSeriesByBook = new Map(contextSeriesRows.map((row) => [row.bookId, row]));

    return metaRows
      .map((row) => {
        const contextSeries = contextSeriesByBook.get(row.id);
        return {
          id: row.id,
          title: row.title ?? row.folderPath.split('/').pop() ?? 'Untitled',
          sortTitle: row.title,
          sortAuthor: authorSortByBook.get(row.id) ?? null,
          folderPath: row.folderPath,
          addedAt: row.addedAt,
          updatedAt: row.bookUpdatedAt,
          description: row.description,
          seriesId: contextSeries?.seriesId ?? row.seriesId,
          seriesName: contextSeries?.seriesName ?? row.seriesName,
          seriesIndex: contextSeries?.seriesIndex ?? row.seriesIndex,
          language: row.language,
          publisher: row.publisher,
          isbn13: row.isbn13,
          hasCover: row.coverSource !== null,
          authors: authorsByBook.get(row.id) ?? [],
          files: filesByBook.get(row.id) ?? [],
        };
      })
      .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  }

  private resolveSeriesFilter(filters?: OpdsBookFilters): SeriesFilter | undefined {
    if (filters?.seriesId !== undefined) return { seriesId: filters.seriesId };

    const catalogSeriesId = parseCatalogSeriesId(filters?.series);
    if (catalogSeriesId !== undefined) return { seriesId: catalogSeriesId };

    const normalizedName = normalizeSeriesNameFilter(filters?.series);
    return normalizedName ? { normalizedName } : undefined;
  }

  private buildSeriesMembershipClause(filter: SeriesFilter): SQL {
    if ('seriesId' in filter) {
      return sql`${books.id} IN (
        SELECT ${bookSeriesMemberships.bookId}
        FROM ${bookSeriesMemberships}
        WHERE ${bookSeriesMemberships.seriesId} = ${filter.seriesId}
      )`;
    }

    return sql`${books.id} IN (
      SELECT ${bookSeriesMemberships.bookId}
      FROM ${bookSeriesMemberships}
      INNER JOIN ${bookSeries} ON ${bookSeries.id} = ${bookSeriesMemberships.seriesId}
      WHERE ${bookSeries.normalizedName} = ${filter.normalizedName}
    )`;
  }

  private buildContextSeriesMembershipJoin(filter: SeriesFilter): SQL {
    if ('seriesId' in filter) {
      return and(eq(bookSeriesMemberships.bookId, books.id), eq(bookSeriesMemberships.seriesId, filter.seriesId))!;
    }

    return eq(bookSeriesMemberships.bookId, books.id);
  }

  private buildContextSeriesOrder(sortOrder: OpdsSortOrder): SQL[] {
    const direction = sortOrder === 'series_desc' ? 'DESC' : 'ASC';
    return [
      sql`${bookSeriesMemberships.seriesIndex} ${sql.raw(direction)} NULLS LAST`,
      sql`${bookMetadata.title} ASC NULLS LAST`,
      sql`${books.id} ASC`,
    ];
  }

  private fetchContextSeriesRows(bookIds: number[], filter: SeriesFilter): Promise<ContextSeriesRow[]> {
    const conditions: SQL[] = [inArray(bookSeriesMemberships.bookId, bookIds)];
    if ('seriesId' in filter) {
      conditions.push(eq(bookSeriesMemberships.seriesId, filter.seriesId));
    } else {
      conditions.push(eq(bookSeries.normalizedName, filter.normalizedName));
    }

    return this.db
      .select({
        bookId: bookSeriesMemberships.bookId,
        seriesId: bookSeriesMemberships.seriesId,
        seriesName: bookSeries.name,
        seriesIndex: bookSeriesMemberships.seriesIndex,
      })
      .from(bookSeriesMemberships)
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .where(and(...conditions))
      .orderBy(bookSeriesMemberships.displayOrder, bookSeriesMemberships.seriesId);
  }

  async countUserCollections(userId: number): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(collections).where(eq(collections.userId, userId));
    return Number(row?.total ?? 0);
  }

  async countUserSmartScopes(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(smartScopes)
      .where(or(eq(smartScopes.userId, userId), eq(smartScopes.isPublic, true)));
    return Number(row?.total ?? 0);
  }

  async getBookManifestPage(
    userId: number,
    opts: { filters?: OpdsBookFilters; afterId?: number; limit: number },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ rows: OpdsManifestBookRow[]; hasNext: boolean }> {
    const scope = await this.buildCatalogScope(userId, opts.filters, isSuperuser, contentFilters);
    if (!scope) return { rows: [], hasNext: false };

    const clauses: SQL[] = [scope.where];
    if (opts.afterId !== undefined) clauses.push(gt(books.id, opts.afterId));

    const idRows = await this.db
      .select({ id: books.id })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(...clauses)!)
      .orderBy(books.id)
      .limit(opts.limit + 1);

    const hasNext = idRows.length > opts.limit;
    const ids = idRows.slice(0, opts.limit).map((row) => row.id);
    return { rows: await this.fetchManifestRows(ids), hasNext };
  }

  private async fetchManifestRows(bookIds: number[]): Promise<OpdsManifestBookRow[]> {
    if (bookIds.length === 0) return [];

    const [metaRows, authorRows, fileRows] = await Promise.all([
      this.db
        .select({
          id: books.id,
          folderPath: books.folderPath,
          title: bookMetadata.title,
          subtitle: bookMetadata.subtitle,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          language: bookMetadata.language,
          publisher: bookMetadata.publisher,
          publishedYear: bookMetadata.publishedYear,
          isbn10: bookMetadata.isbn10,
          isbn13: bookMetadata.isbn13,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({
          bookId: books.id,
          id: bookFiles.id,
          format: bookFiles.format,
          sizeBytes: bookFiles.sizeBytes,
          fileHash: bookFiles.fileHash,
          absolutePath: bookFiles.absolutePath,
          updatedAt: bookFiles.updatedAt,
        })
        .from(bookFiles)
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(and(inArray(bookFiles.bookId, bookIds), eq(bookFiles.role, 'content')))
        .orderBy(sql`case when ${bookFiles.id} = ${books.primaryFileId} then 0 else 1 end`, bookFiles.sortOrder, bookFiles.id),
    ]);

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    const filesByBook = new Map<number, OpdsManifestFileRow[]>();
    for (const row of fileRows) {
      const list = filesByBook.get(row.bookId) ?? [];
      list.push({
        id: row.id,
        format: row.format ?? 'unknown',
        sizeBytes: row.sizeBytes,
        fileHash: row.fileHash,
        // Only the basename leaves the server; the stored absolute path never does.
        filename: row.absolutePath.split('/').pop() ?? null,
        contentVersion: row.updatedAt,
      });
      filesByBook.set(row.bookId, list);
    }

    const idOrder = new Map(bookIds.map((id, index) => [id, index]));
    return metaRows
      .map((row) => ({
        id: row.id,
        title: row.title ?? row.folderPath.split('/').pop() ?? 'Untitled',
        subtitle: row.subtitle,
        authors: authorsByBook.get(row.id) ?? [],
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        language: row.language,
        publisher: row.publisher,
        publishedYear: row.publishedYear,
        isbn10: row.isbn10,
        isbn13: row.isbn13,
        files: filesByBook.get(row.id) ?? [],
      }))
      .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  }

  /** Loads a smart scope if the user may read it, else null. */
  private async loadReadableSmartScope(userId: number, smartScopeId: number) {
    const [smartScope] = await this.db.select().from(smartScopes).where(eq(smartScopes.id, smartScopeId)).limit(1);
    if (!smartScope) return null;
    if (!smartScope.isPublic && smartScope.userId !== userId) return null;
    return smartScope;
  }

  /**
   * The local-books predicate for a smart scope. This is the single definition
   * of what a scope selects; callers that also need the scope row should use
   * loadReadableSmartScope and pass it in, so the row is read only once.
   */
  private smartScopeWhere(
    smartScope: { filter: unknown },
    userId: number,
    accessibleIds: number[],
    contentFilters?: ContentFilterRules,
    q?: string,
  ): SQL {
    const where = this.queryBuilder.buildWhere(smartScope.filter as GroupRule | null, {
      accessibleLibraryIds: accessibleIds,
      userId,
      contentFilters,
    });
    const statusClause = eq(books.status, 'present');
    const searchClause = q?.trim() ? this.buildCatalogSearchClause(q) : undefined;
    return and(...([where, statusClause, searchClause].filter(Boolean) as SQL[]))!;
  }

  private async buildSmartScopeWhere(
    userId: number,
    smartScopeId: number,
    accessibleIds: number[],
    contentFilters?: ContentFilterRules,
    q?: string,
  ): Promise<SQL | null> {
    const smartScope = await this.loadReadableSmartScope(userId, smartScopeId);
    if (!smartScope) return null;
    return this.smartScopeWhere(smartScope, userId, accessibleIds, contentFilters, q);
  }

  private async buildCatalogScope(
    userId: number,
    filters: OpdsBookFilters | undefined,
    isSuperuser: boolean,
    contentFilters: ContentFilterRules | undefined,
  ): Promise<{ where: SQL; contextSeries?: SeriesFilter } | null> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return null;

    if (filters?.ids && filters.ids.length === 0) return null;

    if (filters?.libraryId && !accessibleIds.includes(filters.libraryId)) {
      throw new ForbiddenException('No access to this library');
    }

    if (filters?.collectionId) {
      const [collection] = await this.db
        .select({ userId: collections.userId })
        .from(collections)
        .where(eq(collections.id, filters.collectionId))
        .limit(1);
      if (!collection || collection.userId !== userId) {
        throw new ForbiddenException('No access to this collection');
      }
    }

    if (filters?.smartScopeId) {
      const where = await this.buildSmartScopeWhere(userId, filters.smartScopeId, accessibleIds, contentFilters, filters.q);
      return where ? { where } : null;
    }

    const clauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];

    if (filters?.libraryId) clauses.push(eq(books.libraryId, filters.libraryId));

    if (filters?.ids) clauses.push(inArray(books.id, filters.ids));

    if (filters?.collectionId) {
      clauses.push(
        sql`${books.id} IN (SELECT ${collectionBooks.bookId} FROM ${collectionBooks} WHERE ${collectionBooks.collectionId} = ${filters.collectionId})`,
      );
    }

    if (filters?.author) {
      clauses.push(
        sql`${books.id} IN (SELECT ${bookAuthors.bookId} FROM ${bookAuthors} INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId} WHERE ${authors.name} = ${filters.author})`,
      );
    }

    const seriesFilter = this.resolveSeriesFilter(filters);
    if (seriesFilter) clauses.push(this.buildSeriesMembershipClause(seriesFilter));

    if (filters?.format) {
      const format = filters.format.trim().toLowerCase();
      if (format) {
        clauses.push(
          sql`${books.id} IN (SELECT ${bookFiles.bookId} FROM ${bookFiles} WHERE ${bookFiles.role} = 'content' AND lower(${bookFiles.format}) = ${format})`,
        );
      }
    }

    if (filters?.readStatus) {
      clauses.push(this.buildReadStatusClause(userId, filters.readStatus));
    }

    if (filters?.q) {
      const searchClause = this.buildCatalogSearchClause(filters.q);
      if (searchClause) clauses.push(searchClause);
    }

    if (!isSuperuser && contentFilters) {
      clauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }

    return { where: and(...clauses)!, contextSeries: seriesFilter };
  }

  async countBooks(userId: number, filters?: OpdsBookFilters, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<number> {
    const scope = await this.buildCatalogScope(userId, filters, isSuperuser, contentFilters);
    if (!scope) return 0;
    const [row] = await this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(scope.where);
    return Number(row?.total ?? 0);
  }
}

function normalizeIsbnSearchTerm(value: string): string {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function stringArray(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function parseCatalogSeriesId(value: string | null | undefined): number | undefined {
  const match = /^series:(\d+)$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function normalizeSeriesNameFilter(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function catalogEbookOrderBy(sortOrder: OpdsSortOrder): SQL[] {
  switch (sortOrder) {
    case 'title_asc':
      return [sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`, sql`${warehouseCatalogItems.remoteId} ASC`];
    case 'title_desc':
      return [sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) DESC`, sql`${warehouseCatalogItems.remoteId} ASC`];
    case 'author_asc':
      return [
        sql`coalesce(${warehouseCatalogItems.authors}->>0, '') ASC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
    case 'author_desc':
      return [
        sql`coalesce(${warehouseCatalogItems.authors}->>0, '') DESC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
    case 'series_asc':
      return [
        sql`coalesce(${warehouseCatalogItems.series}, '') ASC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
    case 'series_desc':
      return [
        sql`coalesce(${warehouseCatalogItems.series}, '') DESC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
    case 'recent':
      return [
        sql`coalesce(${warehouseUserItems.addedAt}, ${warehouseCatalogItems.syncedAt}) DESC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
    case 'recent_asc':
      return [
        sql`coalesce(${warehouseUserItems.addedAt}, ${warehouseCatalogItems.syncedAt}) ASC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
    case 'updated':
    case 'recently_read':
      return [
        sql`coalesce(${warehouseCatalogItems.updatedAt}, ${warehouseCatalogItems.syncedAt}) DESC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
    case 'updated_asc':
    case 'recently_read_asc':
      return [
        sql`coalesce(${warehouseCatalogItems.updatedAt}, ${warehouseCatalogItems.syncedAt}) ASC`,
        sql`coalesce(${warehouseCatalogItems.sortTitle}, ${warehouseCatalogItems.title}) ASC`,
        sql`${warehouseCatalogItems.remoteId} ASC`,
      ];
  }
}

function catalogSortSpec(sortOrder: OpdsSortOrder): SortSpec[] {
  switch (sortOrder) {
    case 'title_desc':
      return [{ field: 'title', dir: 'desc' }];
    case 'author_asc':
      return [{ field: 'author', dir: 'asc' }];
    case 'author_desc':
      return [{ field: 'author', dir: 'desc' }];
    case 'series_asc':
      return [{ field: 'series', dir: 'asc' }];
    case 'series_desc':
      return [{ field: 'series', dir: 'desc' }];
    case 'recent':
      return [{ field: 'addedAt', dir: 'desc' }];
    case 'recent_asc':
      return [{ field: 'addedAt', dir: 'asc' }];
    case 'updated':
    case 'recently_read':
      return [{ field: 'updatedAt', dir: 'desc' }];
    case 'updated_asc':
    case 'recently_read_asc':
      return [{ field: 'updatedAt', dir: 'asc' }];
    case 'title_asc':
    default:
      return [{ field: 'title', dir: 'asc' }];
  }
}

function mergedOpdsPage(
  localPage: { entries: OpdsBookEntry[]; total: number },
  catalogPage: { entries: OpdsBookEntry[]; total: number },
  sortOrder: OpdsSortOrder,
  page: number,
  size: number,
): { entries: OpdsBookEntry[]; total: number } {
  const offset = (page - 1) * size;
  const entries = [...localPage.entries, ...catalogPage.entries].sort((a, b) => compareOpdsEntries(a, b, sortOrder));
  return {
    entries: entries.slice(offset, offset + size),
    total: localPage.total + catalogPage.total,
  };
}

function compareOpdsEntries(a: OpdsBookEntry, b: OpdsBookEntry, sortOrder: OpdsSortOrder): number {
  switch (sortOrder) {
    case 'title_asc':
      return compareNullableText(a.sortTitle, b.sortTitle, 'asc') || compareStableId(a, b);
    case 'title_desc':
      return compareNullableText(a.sortTitle, b.sortTitle, 'desc') || compareStableId(a, b);
    case 'author_asc':
      return compareNullableText(a.sortAuthor, b.sortAuthor, 'asc') || compareNullableText(a.sortTitle, b.sortTitle, 'asc') || compareStableId(a, b);
    case 'author_desc':
      return compareNullableText(a.sortAuthor, b.sortAuthor, 'desc') || compareNullableText(a.sortTitle, b.sortTitle, 'asc') || compareStableId(a, b);
    case 'series_asc':
      return (
        compareNullableText(a.seriesName, b.seriesName, 'asc') ||
        compareNumber(a.seriesIndex, b.seriesIndex) ||
        compareNullableText(a.sortTitle, b.sortTitle, 'asc') ||
        compareStableId(a, b)
      );
    case 'series_desc':
      return (
        compareNullableText(a.seriesName, b.seriesName, 'desc') ||
        compareNumber(b.seriesIndex, a.seriesIndex) ||
        compareNullableText(a.sortTitle, b.sortTitle, 'asc') ||
        compareStableId(a, b)
      );
    case 'recent':
      return b.addedAt.getTime() - a.addedAt.getTime() || compareNullableText(a.sortTitle, b.sortTitle, 'asc') || compareStableId(a, b);
    case 'recent_asc':
      return a.addedAt.getTime() - b.addedAt.getTime() || compareNullableText(a.sortTitle, b.sortTitle, 'asc') || compareStableId(a, b);
    case 'updated':
    case 'recently_read':
      return b.updatedAt.getTime() - a.updatedAt.getTime() || compareNullableText(a.sortTitle, b.sortTitle, 'asc') || compareStableId(a, b);
    case 'updated_asc':
    case 'recently_read_asc':
      return a.updatedAt.getTime() - b.updatedAt.getTime() || compareNullableText(a.sortTitle, b.sortTitle, 'asc') || compareStableId(a, b);
  }
}

function compareNullableText(a: string | null | undefined, b: string | null | undefined, direction: 'asc' | 'desc'): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const result = a.localeCompare(b, undefined, { sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

function compareNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareStableId(a: OpdsBookEntry, b: OpdsBookEntry): number {
  return String(a.id).localeCompare(String(b.id));
}

function shuffleEntries(entries: OpdsBookEntry[]): OpdsBookEntry[] {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function buildCatalogContentFilterClauses(contentFilters?: ContentFilterRules): SQL[] {
  if (!contentFilters || isContentFilterEmpty(contentFilters)) {
    return [];
  }

  const clauses: SQL[] = [];
  const includeTagClause =
    contentFilters.includeTagIds.length > 0
      ? sql`exists (select 1 from ${schema.tags} where ${inArray(schema.tags.id, contentFilters.includeTagIds)} and ${warehouseCatalogItems.tags} ? ${schema.tags.name})`
      : null;
  const includeGenreClause =
    contentFilters.includeGenreIds.length > 0
      ? sql`exists (select 1 from ${schema.genres} where ${inArray(schema.genres.id, contentFilters.includeGenreIds)} and ${warehouseCatalogItems.genres} ? ${schema.genres.name})`
      : null;

  if (includeTagClause && includeGenreClause) {
    clauses.push(or(includeTagClause, includeGenreClause)!);
  } else if (includeTagClause) {
    clauses.push(includeTagClause);
  } else if (includeGenreClause) {
    clauses.push(includeGenreClause);
  }

  if (contentFilters.excludeTagIds.length > 0) {
    clauses.push(
      sql`not exists (select 1 from ${schema.tags} where ${inArray(schema.tags.id, contentFilters.excludeTagIds)} and ${warehouseCatalogItems.tags} ? ${schema.tags.name})`,
    );
  }

  if (contentFilters.excludeGenreIds.length > 0) {
    clauses.push(
      sql`not exists (select 1 from ${schema.genres} where ${inArray(schema.genres.id, contentFilters.excludeGenreIds)} and ${warehouseCatalogItems.genres} ? ${schema.genres.name})`,
    );
  }

  return clauses;
}

function catalogContentFilterWhereSql(contentFilters?: ContentFilterRules): SQL {
  const clauses = buildCatalogContentFilterClauses(contentFilters);
  return clauses.length === 0 ? sql`` : sql`and ${and(...clauses)!}`;
}

function mergeNavigationCounts<Name extends string | null>(
  localRows: OpdsNavigationCount<Name>[],
  catalogRows: OpdsNavigationCount<Name>[],
  normalizeName: (value: Name) => Name | null,
): OpdsNavigationCount<Name>[] {
  const merged = new Map<string, OpdsNavigationCount<Name>>();
  for (const row of [...localRows, ...catalogRows]) {
    const name = normalizeName(row.name);
    if (name === null) continue;
    const key = String(name).toLowerCase();
    const current = merged.get(key);
    if (current) {
      current.bookCount += Number(row.bookCount ?? 0);
    } else {
      merged.set(key, { name, bookCount: Number(row.bookCount ?? 0) });
    }
  }

  return [...merged.values()].sort((a, b) => compareNullableText(a.name, b.name, 'asc'));
}

function navigationCountRows<Name extends string | null>(result: unknown, allowNullName: boolean): OpdsNavigationCount<Name>[] {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const raw = row as Record<string, unknown>;
    const name = raw.name;
    if (name === null && allowNullName) return [{ name: null as Name, bookCount: Number(raw.bookCount ?? raw.book_count ?? raw.count ?? 0) }];
    if (typeof name !== 'string' || name.trim().length === 0) return [];
    return [{ name: name.trim() as Name, bookCount: Number(raw.bookCount ?? raw.book_count ?? raw.count ?? 0) }];
  });
}

function normalizeAuthorDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const comma = trimmed.indexOf(',');
  if (comma < 0) return trimmed;

  const last = trimmed.slice(0, comma).trim();
  const first = trimmed.slice(comma + 1).trim();
  return first && last ? `${first} ${last}` : trimmed;
}

function normalizeSeriesName(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
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
