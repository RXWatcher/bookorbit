import { Inject, Injectable } from '@nestjs/common';
import type { CollectionCatalogItemRef, SortSpec, WarehouseMediaType } from '@bookorbit/types';
import { SQL, SQLWrapper, and, asc, count, desc, eq, getTableColumns, ilike, inArray, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata, books, collectionBooks, collectionCatalogItems, collections } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const collectionFields = {
  id: collections.id,
  userId: collections.userId,
  name: collections.name,
  icon: collections.icon,
  description: collections.description,
  syncToKobo: collections.syncToKobo,
  displayOrder: collections.displayOrder,
  createdAt: collections.createdAt,
  updatedAt: collections.updatedAt,
  bookCount: collectionItemCountSql(),
};

function collectionItemCountSql() {
  return sql<number>`(
    (select count(*) from ${collectionBooks} where ${collectionBooks.collectionId} = ${collections.id}) +
    (select count(*) from ${collectionCatalogItems} where ${collectionCatalogItems.collectionId} = ${collections.id})
  )::int`;
}

function localMembershipCountSql(bookIds: number[]) {
  if (bookIds.length === 0) return sql<number>`0`;

  const bookIdList = sql.join(
    bookIds.map((id) => sql`${id}`),
    sql`, `,
  );

  return sql<number>`(
    select count(*)
    from ${collectionBooks}
    where ${collectionBooks.collectionId} = ${collections.id}
      and ${collectionBooks.bookId} in (${bookIdList})
  )`;
}

function catalogMembershipCountSql(catalogItems: CollectionCatalogItemRef[]) {
  if (catalogItems.length === 0) return sql<number>`0`;

  const catalogItemList = sql.join(
    catalogItems.map((item) => sql`(${item.mediaType}, ${item.remoteId})`),
    sql`, `,
  );

  return sql<number>`(
    select count(*)
    from ${collectionCatalogItems}
    where ${collectionCatalogItems.collectionId} = ${collections.id}
      and (${collectionCatalogItems.mediaType}, ${collectionCatalogItems.remoteId}) in (${catalogItemList})
  )`;
}

@Injectable()
export class CollectionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAllForUser(userId: number) {
    return this.db
      .select(collectionFields)
      .from(collections)
      .where(eq(collections.userId, userId))
      .orderBy(collections.displayOrder, collections.name);
  }

  findAllForUserWithMembership(userId: number, bookIds: number[] = [], catalogItems: CollectionCatalogItemRef[] = []) {
    return this.db
      .select({
        ...collectionFields,
        memberCount: sql<number>`(${localMembershipCountSql(bookIds)} + ${catalogMembershipCountSql(catalogItems)})::int`,
      })
      .from(collections)
      .where(eq(collections.userId, userId))
      .orderBy(collections.displayOrder, collections.name);
  }

  findById(id: number) {
    return this.db.select(collectionFields).from(collections).where(eq(collections.id, id)).limit(1);
  }

  insert(values: typeof collections.$inferInsert) {
    return this.db.insert(collections).values(values).returning();
  }

  update(id: number, userId: number, values: Partial<typeof collections.$inferInsert>) {
    return this.db
      .update(collections)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
  }

  delete(id: number, userId: number) {
    return this.db
      .delete(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning();
  }

  addBooks(collectionId: number, bookIds: number[]) {
    const values = bookIds.map((bookId) => ({ collectionId, bookId }));
    return this.db.insert(collectionBooks).values(values).onConflictDoNothing().returning();
  }

  removeBooks(collectionId: number, bookIds: number[]) {
    return this.db
      .delete(collectionBooks)
      .where(and(eq(collectionBooks.collectionId, collectionId), inArray(collectionBooks.bookId, bookIds)))
      .returning();
  }

  addCatalogItems(collectionId: number, items: CollectionCatalogItemRef[]) {
    const values = items.map((item) => ({ collectionId, mediaType: item.mediaType, remoteId: item.remoteId }));
    return this.db.insert(collectionCatalogItems).values(values).onConflictDoNothing().returning();
  }

  removeCatalogItems(collectionId: number, items: CollectionCatalogItemRef[]) {
    const itemTuples = sql.join(
      items.map((item) => sql`(${item.mediaType}, ${item.remoteId})`),
      sql`, `,
    );

    return this.db
      .delete(collectionCatalogItems)
      .where(
        and(
          eq(collectionCatalogItems.collectionId, collectionId),
          sql`(${collectionCatalogItems.mediaType}, ${collectionCatalogItems.remoteId}) in (${itemTuples})`,
        ),
      )
      .returning();
  }

  async findCatalogItemsPage(
    collectionId: number,
    userId: number,
    page: number,
    size: number,
    q?: string,
    sort?: SortSpec[],
    mediaTypes?: WarehouseMediaType[],
  ) {
    const search = q?.trim();
    const where = and(
      eq(collectionCatalogItems.collectionId, collectionId),
      mediaTypes && mediaTypes.length > 0 ? inArray(collectionCatalogItems.mediaType, mediaTypes) : undefined,
      search ? buildCatalogSearchWhere(`%${search}%`) : undefined,
    );
    const orderBy = buildCatalogCollectionOrder(sort);
    const selectFields = {
      ...getTableColumns(schema.warehouseCatalogItems),
      userAddedAt: collectionCatalogItems.addedAt,
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

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(selectFields)
        .from(collectionCatalogItems)
        .innerJoin(
          schema.warehouseCatalogItems,
          and(
            eq(collectionCatalogItems.mediaType, schema.warehouseCatalogItems.mediaType),
            eq(collectionCatalogItems.remoteId, schema.warehouseCatalogItems.remoteId),
          ),
        )
        .leftJoin(
          schema.warehouseUserState,
          and(
            eq(schema.warehouseUserState.userId, userId),
            eq(schema.warehouseUserState.mediaType, collectionCatalogItems.mediaType),
            eq(schema.warehouseUserState.remoteId, collectionCatalogItems.remoteId),
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
        .limit(size)
        .offset(page * size),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(collectionCatalogItems)
        .innerJoin(
          schema.warehouseCatalogItems,
          and(
            eq(collectionCatalogItems.mediaType, schema.warehouseCatalogItems.mediaType),
            eq(collectionCatalogItems.remoteId, schema.warehouseCatalogItems.remoteId),
          ),
        )
        .where(where),
    ]);

    return {
      rows,
      total: Number(total),
      page,
      size,
    };
  }

  buildMembershipWhere(collectionId: number): SQL {
    const membership = this.db
      .select({ one: sql`1` })
      .from(collectionBooks)
      .where(and(eq(collectionBooks.collectionId, collectionId), eq(collectionBooks.bookId, books.id)))
      .limit(1);
    return sql`exists (${membership})`;
  }

  async findBookIdsPage(collectionId: number, libraryIds: number[], page: number, size: number, extraWhere?: SQL) {
    if (libraryIds.length === 0) {
      return {
        bookIds: [],
        total: 0,
        page,
        size,
      };
    }

    const where = and(eq(collectionBooks.collectionId, collectionId), inArray(books.libraryId, libraryIds), ...(extraWhere ? [extraWhere] : []));
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ bookId: collectionBooks.bookId })
        .from(collectionBooks)
        .innerJoin(books, eq(books.id, collectionBooks.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(collectionBooks.addedAt, collectionBooks.bookId)
        .limit(size)
        .offset(page * size),
      this.db
        .select({ total: count() })
        .from(collectionBooks)
        .innerJoin(books, eq(books.id, collectionBooks.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where),
    ]);

    return {
      bookIds: rows.map((row) => row.bookId),
      total: Number(total),
      page,
      size,
    };
  }

  async findAllBookIds(collectionId: number, libraryIds: number[], extraWhere?: SQL): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ bookId: collectionBooks.bookId })
      .from(collectionBooks)
      .innerJoin(books, eq(books.id, collectionBooks.bookId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(eq(collectionBooks.collectionId, collectionId), inArray(books.libraryId, libraryIds), ...(extraWhere ? [extraWhere] : [])))
      .orderBy(collectionBooks.addedAt, collectionBooks.bookId);
    return rows.map((row) => row.bookId);
  }

  async updateDisplayOrders(userId: number, order: { id: number; displayOrder: number }[]) {
    await this.db.transaction(async (tx) => {
      for (const item of order) {
        await tx
          .update(collections)
          .set({ displayOrder: item.displayOrder, updatedAt: sql`now()` })
          .where(and(eq(collections.id, item.id), eq(collections.userId, userId)));
      }
    });
  }
}

function buildCatalogSearchWhere(pattern: string): SQL {
  return (
    or(
      ilike(schema.warehouseCatalogItems.title, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.authors}::text, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.narrators}::text, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.identifiers}::text, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.format}, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.language}, '')`, pattern),
      ilike(sql<string>`coalesce(${schema.warehouseCatalogItems.publisher}, '')`, pattern),
    ) ?? sql`false`
  );
}

function buildCatalogCollectionOrder(sort: SortSpec[] | undefined) {
  const firstSort = sort?.[0];
  const direction = firstSort?.dir === 'desc' ? desc : asc;
  const stableTitleOrder = sql`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title}) asc`;
  const stableRemoteOrder = sql`${schema.warehouseCatalogItems.remoteId} asc`;

  switch (firstSort?.field) {
    case 'author':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.authors}->>0, '')`);
    case 'series':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.series}, '')`);
    case 'seriesIndex':
      return sql`${orderNullableColumn(schema.warehouseCatalogItems.seriesIndex, firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'addedAt':
      return direction(collectionCatalogItems.addedAt);
    case 'publishedYear':
      return sql`${orderNullableColumn(catalogPublishedYearExpression(), firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
    case 'pageCount':
      return sql`${orderNullableColumn(catalogPageCountExpression(), firstSort.dir)}, ${stableTitleOrder}, ${stableRemoteOrder}`;
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
    case 'format':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.format}, '')`);
    case 'language':
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.language}, '')`);
    case 'title':
    default:
      return direction(sql<string>`coalesce(${schema.warehouseCatalogItems.sortTitle}, ${schema.warehouseCatalogItems.title})`);
  }
}

function orderNullableColumn(column: SQLWrapper, dir: SortSpec['dir'] = 'asc') {
  return dir === 'desc' ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
}

function catalogPublishedYearExpression() {
  const rawPayload = schema.warehouseCatalogItems.rawPayload;
  return sql<number | null>`case
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
  end`;
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
      then round((${schema.warehouseCatalogItems.durationSeconds}::numeric / 3600) * 50)::int
    else null
  end`;
}

function catalogFileSizeExpression() {
  return sql<number | null>`coalesce(
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

  return sql<number>`floor((${earned}::numeric / 76) * 100)::int`;
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
