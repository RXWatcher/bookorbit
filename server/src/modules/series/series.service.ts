import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  CLOUD_AUDIO_LIBRARY_ID,
  CLOUD_COMIC_LIBRARY_ID,
  CLOUD_EBOOK_LIBRARY_ID,
  type BooksPage,
  type SeriesBooksPage,
  type SeriesDetail,
  type SeriesLibraryItem,
  type SeriesPage,
  type SeriesSummary,
  type WarehouseMediaType,
} from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import type { RequestUser } from '../../common/types/request-user';
import { MAX_SERIES_TOTAL_BOOKS, normalizeSeriesTotalBooks } from '../../common/utils/series-total-books.utils';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { WarehouseCatalogService } from '../warehouse/warehouse-catalog.service';
import { ListSeriesBooksDto } from './dto/list-series-books.dto';
import { CompletionStatus, ListSeriesDto, SeriesListSort, SortDirection } from './dto/list-series.dto';
import { SeriesRepository, type SeriesSummaryRow } from './series.repository';

type ResolvedReadableLibraryScope = {
  localLibraryIds: number[];
  includeWarehouse: boolean;
  warehouseMediaType?: WarehouseMediaType;
};

@Injectable()
export class SeriesService {
  private readonly logger = new Logger(SeriesService.name);

  constructor(
    private readonly seriesRepo: SeriesRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly warehouseCatalogService: WarehouseCatalogService,
  ) {}

  private assertPaginationWindow(page: number, size: number): void {
    if (!isOffsetWithinLimit(page * size)) {
      throw new BadRequestException(`pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`);
    }
  }

  async findAll(user: RequestUser, dto: ListSeriesDto): Promise<SeriesPage> {
    const page = dto.page ?? 0;
    const size = dto.size ?? 50;
    this.assertPaginationWindow(page, size);

    const libraryScope = this.resolveLibraryScope(dto.libraryId);
    const readableScope = await this.resolveReadableLibraryScope(user, libraryScope);
    const libraryIds = readableScope.localLibraryIds;
    const includeWarehouseLibraries = readableScope.includeWarehouse;
    if (libraryIds.length === 0 && !includeWarehouseLibraries) {
      return { items: [], total: 0, page, size };
    }

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;

    if (includeWarehouseLibraries && libraryIds.length === 0) {
      const warehousePage = await this.warehouseCatalogService.listSeriesSummaryPage({
        q: dto.q,
        author: dto.author,
        userId: user.id,
        contentFilters,
        mediaType: readableScope.warehouseMediaType,
        page,
        size,
        sort: dto.sort ?? 'name',
        order: dto.order ?? 'asc',
        completionStatus: dto.completionStatus,
      });
      const items: SeriesSummary[] = warehousePage.rows.map((row) => ({
        id: syntheticSeriesId(row.name),
        name: row.name,
        bookCount: row.bookCount,
        readCount: row.readCount,
        authors: row.authors,
        coverBookIds: row.coverBookIds,
        lastAddedAt: row.lastAddedAt ?? null,
      }));

      return { items, total: warehousePage.total, page, size };
    }

    const [localRows, warehouseRows] = await Promise.all([
      libraryIds.length > 0
        ? this.seriesRepo.findSummaries({
            q: dto.q,
            libraryIds,
            userId: user.id,
            author: dto.author,
            contentFilters,
          })
        : [],
      includeWarehouseLibraries
        ? this.warehouseCatalogService.listSeriesSummaries({
            q: dto.q,
            author: dto.author,
            userId: user.id,
            contentFilters,
            mediaType: readableScope.warehouseMediaType,
          })
        : [],
    ]);

    const mergedItems = this.mergeSeriesSummaries([...localRows, ...warehouseRows])
      .filter((row) => this.matchesCompletionStatus(row, dto.completionStatus))
      .sort((a, b) => this.compareSeriesRows(a, b, dto.sort ?? 'name', dto.order ?? 'asc'));
    const items: SeriesSummary[] = mergedItems.slice(page * size, page * size + size).map((row) => ({
      id: row.id ?? syntheticSeriesId(row.name),
      name: row.name,
      bookCount: row.bookCount,
      readCount: row.readCount,
      authors: row.authors,
      coverBookIds: row.coverBookIds,
      lastAddedAt: row.lastAddedAt ?? null,
    }));

    return { items, total: mergedItems.length, page, size };
  }

  private mergeSeriesSummaries(rows: SeriesSummaryRow[]): SeriesSummaryRow[] {
    const merged = new Map<string, SeriesSummaryRow>();

    for (const row of rows) {
      const key = this.normalizeSeriesName(row.name);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          id: row.id ?? syntheticSeriesId(row.name),
          name: row.name,
          bookCount: row.bookCount,
          readCount: row.readCount,
          authors: [...row.authors],
          coverBookIds: [...row.coverBookIds],
          lastAddedAt: row.lastAddedAt,
        });
        continue;
      }

      existing.bookCount += row.bookCount;
      existing.readCount += row.readCount;
      existing.id = existing.id && existing.id > 0 ? existing.id : (row.id ?? existing.id);
      existing.authors = this.mergeAuthorLists(existing.authors, row.authors);
      existing.coverBookIds = [...existing.coverBookIds, ...row.coverBookIds].slice(0, 9);
      existing.lastAddedAt = this.latestTimestamp(existing.lastAddedAt, row.lastAddedAt);
    }

    return [...merged.values()];
  }

  private normalizeSeriesName(name: string): string {
    return name.trim().toLowerCase();
  }

  private mergeStringLists(left: string[], right: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of [...left, ...right]) {
      const key = value.trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }

    return result;
  }

  private mergeAuthorLists(left: string[], right: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of [...left, ...right]) {
      const key = this.normalizeAuthorName(value);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }

    return result;
  }

  private normalizeAuthorName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '';
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex <= 0) return trimmed.toLowerCase();

    const family = trimmed.slice(0, commaIndex).trim();
    const given = trimmed.slice(commaIndex + 1).trim();
    return given && family ? `${given} ${family}`.toLowerCase() : trimmed.toLowerCase();
  }

  private latestTimestamp(left: string | null, right: string | null): string | null {
    if (!left) return right ?? null;
    if (!right) return left;
    return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
  }

  private matchesCompletionStatus(row: SeriesSummaryRow, status?: CompletionStatus): boolean {
    if (!status) return true;

    switch (status) {
      case 'not_started':
        return row.readCount === 0;
      case 'in_progress':
        return row.readCount > 0 && row.readCount < row.bookCount;
      case 'complete':
        return row.bookCount > 0 && row.readCount === row.bookCount;
    }
  }

  private compareSeriesRows(a: SeriesSummaryRow, b: SeriesSummaryRow, sort: SeriesListSort, order: SortDirection): number {
    const direction = order === 'asc' ? 1 : -1;
    const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

    switch (sort) {
      case 'bookCount':
        return direction * (a.bookCount - b.bookCount) || nameCompare;
      case 'lastAddedAt':
        return direction * (this.timestampValue(a.lastAddedAt) - this.timestampValue(b.lastAddedAt)) || nameCompare;
      case 'readProgress':
        return direction * (this.readProgress(a) - this.readProgress(b)) || nameCompare;
      case 'name':
      default:
        return direction * nameCompare;
    }
  }

  private timestampValue(value: string | null): number {
    if (!value) return Number.NEGATIVE_INFINITY;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
  }

  private readProgress(row: SeriesSummaryRow): number {
    if (row.bookCount === 0) return 0;
    return row.readCount / row.bookCount;
  }

  private async resolveWarehouseSeriesName(
    user: RequestUser,
    seriesId: number,
    contentFilters: RequestUser['contentFilters'] | undefined,
    mediaType?: WarehouseMediaType,
  ): Promise<string | null> {
    if (seriesId >= 0) return null;
    const rows = await this.warehouseCatalogService.listSeriesSummaries({
      userId: user.id,
      contentFilters,
      mediaType,
    });
    return rows.find((row) => syntheticSeriesId(row.name) === seriesId)?.name ?? null;
  }

  /** Total series the user can browse; matches the unfiltered total of {@link findAll}. */
  async countAll(user: RequestUser): Promise<number> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    if (libraryIds.length === 0) return 0;
    return this.seriesRepo.countSeries({ libraryIds, contentFilters: user.isSuperuser ? undefined : user.contentFilters });
  }

  async findBooks(user: RequestUser, seriesId: number, dto: ListSeriesBooksDto): Promise<SeriesBooksPage> {
    const page = dto.page ?? 0;
    const size = dto.size ?? 50;
    const pageStart = page * size;
    const pageEnd = pageStart + size;
    const windowSize = pageEnd;
    const emptyBookPage: { bookIds: number[]; total: number } = { bookIds: [], total: 0 };
    this.assertPaginationWindow(page, size);

    const libraryScope = this.resolveLibraryScope(dto.libraryId);
    const readableScope = await this.resolveReadableLibraryScope(user, libraryScope);
    const libraryIds = readableScope.localLibraryIds;
    const includeWarehouseLibraries = readableScope.includeWarehouse;
    if (libraryIds.length === 0 && !includeWarehouseLibraries) {
      throw new NotFoundException('Series not found');
    }

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    const canQueryLocalSeries = seriesId > 0 && libraryIds.length > 0;
    const [detail, bookPage] = await Promise.all([
      canQueryLocalSeries
        ? this.seriesRepo.findDetail({
            seriesId,
            userId: user.id,
            libraryIds,
            contentFilters,
          })
        : null,
      canQueryLocalSeries
        ? this.seriesRepo.findBookIds({
            seriesId,
            page: 0,
            size: windowSize,
            sort: dto.sort ?? 'seriesIndex',
            order: dto.order ?? 'asc',
            libraryIds,
            contentFilters,
          })
        : emptyBookPage,
    ]);
    const seriesName =
      detail?.name ??
      (includeWarehouseLibraries ? await this.resolveWarehouseSeriesName(user, seriesId, contentFilters, readableScope.warehouseMediaType) : null);
    const warehousePage =
      includeWarehouseLibraries && seriesName
        ? await this.warehouseCatalogService.listSeriesBooks({
            seriesName,
            userId: user.id,
            page: 0,
            size: windowSize,
            sort: dto.sort ?? 'seriesIndex',
            order: dto.order ?? 'asc',
            contentFilters,
            mediaType: readableScope.warehouseMediaType,
          })
        : { items: [] as SeriesLibraryItem[], total: 0 };

    if (!detail && warehousePage.total === 0) {
      if (dto.libraryId) {
        const allLibraryIds = await this.resolveLibraryIds(user);
        const existsInAnyLibrary = await this.seriesRepo.findDetail({
          seriesId,
          userId: user.id,
          libraryIds: allLibraryIds,
          contentFilters,
        });
        if (existsInAnyLibrary) {
          const emptyInfo: SeriesDetail = {
            id: existsInAnyLibrary.id,
            name: existsInAnyLibrary.name,
            bookCount: 0,
            readCount: 0,
            authors: existsInAnyLibrary.authors,
            possibleGaps: [],
            expectedBookCount: existsInAnyLibrary.expectedBookCount ?? null,
          };
          return { items: [], total: 0, page, size, seriesInfo: emptyInfo };
        }
      }
      throw new NotFoundException('Series not found');
    }

    const warehouseIndices = warehousePage.items
      .map((item) => item.seriesIndex)
      .filter((index): index is number => typeof index === 'number' && Number.isFinite(index));
    const possibleGaps = this.computeGaps(
      [...(detail?.indices ?? []), ...warehouseIndices],
      detail?.bookCount ?? 0,
      detail?.expectedBookCount ?? null,
    );

    let items: BooksPage['items'] = [];
    if (bookPage.bookIds.length > 0) {
      const cardData = await this.bookReadService.findCardsByBookIds(bookPage.bookIds, user.id);
      const cards = assembleBookCards(
        cardData.rows,
        cardData.authorRows,
        cardData.fileRows,
        cardData.genreRows,
        cardData.progressRows,
        cardData.statusRows,
        cardData.narratorRows,
        cardData.tagRows,
        cardData.seriesMembershipRows,
      );
      const orderMap = new Map(bookPage.bookIds.map((id, i) => [id, i]));
      items = cards
        .map((card) => {
          const contextualSeries = (card.seriesMemberships ?? []).find((membership) => membership.seriesId === seriesId);
          return contextualSeries
            ? {
                ...card,
                seriesId: contextualSeries.seriesId,
                seriesName: contextualSeries.seriesName,
                seriesIndex: contextualSeries.seriesIndex,
              }
            : card;
        })
        .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }

    const allItems = this.sortSeriesLibraryItems([...items, ...warehousePage.items], dto.sort ?? 'seriesIndex', dto.order ?? 'asc');
    const pageItems = allItems.slice(pageStart, pageEnd);
    const warehouseAuthors = this.mergeAuthorLists(
      [],
      warehousePage.items.flatMap((item) => item.authors),
    );
    const seriesInfo: SeriesDetail = {
      id: detail?.id ?? seriesId,
      name: detail?.name ?? warehousePage.items[0]?.seriesName ?? seriesName ?? 'Series',
      bookCount: (detail?.bookCount ?? 0) + warehousePage.total,
      readCount: detail?.readCount ?? 0,
      authors: this.mergeAuthorLists(detail?.authors ?? [], warehouseAuthors),
      possibleGaps,
      expectedBookCount: detail?.expectedBookCount ?? null,
    };

    return { items: pageItems, total: bookPage.total + warehousePage.total, page, size, seriesInfo };
  }

  private sortSeriesLibraryItems(items: SeriesLibraryItem[], sort: ListSeriesBooksDto['sort'], order: SortDirection): SeriesLibraryItem[] {
    const direction = order === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const titleCompare = this.itemTitle(a).localeCompare(this.itemTitle(b), undefined, { sensitivity: 'base' });
      switch (sort) {
        case 'addedAt':
          return direction * (this.itemTimestamp(a) - this.itemTimestamp(b)) || titleCompare;
        case 'title':
          return direction * titleCompare;
        case 'seriesIndex':
        default:
          return direction * (this.itemSeriesIndex(a) - this.itemSeriesIndex(b)) || titleCompare;
      }
    });
  }

  private itemTitle(item: SeriesLibraryItem): string {
    return item.title ?? '';
  }

  private itemTimestamp(item: SeriesLibraryItem): number {
    return this.timestampValue(item.addedAt ?? null);
  }

  private itemSeriesIndex(item: SeriesLibraryItem): number {
    return item.seriesIndex ?? Number.MAX_SAFE_INTEGER;
  }

  private computeGaps(indices: number[], bookCount: number, expectedBookCount: number | null): number[] {
    const integerIndices = indices.filter((idx) => Math.abs(Math.round(idx) - idx) < 0.01).map((idx) => Math.round(idx));
    if (integerIndices.length === 0) return [];

    const min = Math.min(...integerIndices);
    const max = Math.max(...integerIndices);
    if (min < 1 || max > MAX_SERIES_TOTAL_BOOKS) return [];

    const expectedMax = this.resolveTrustedExpectedMax(indices, bookCount, integerIndices, expectedBookCount);

    // With no trusted total only interior holes are knowable, and one book has no interior.
    if (expectedMax === undefined) {
      if (integerIndices.length < 2) return [];
      return this.collectMissing(integerIndices, min, max);
    }

    return this.collectMissing(integerIndices, 1, expectedMax);
  }

  /**
   * A provider total turns "the books you own" into "the books the series has", which is the whole
   * point, but it also lets us name books as missing. Only trust it when nothing about the local
   * data contradicts it, because a false "you are missing #5" is worse than staying quiet.
   */
  private resolveTrustedExpectedMax(
    indices: number[],
    bookCount: number,
    integerIndices: number[],
    expectedBookCount: number | null,
  ): number | undefined {
    const expected = normalizeSeriesTotalBooks(expectedBookCount);
    if (expected === undefined) return undefined;

    // An owned book with no usable index would be reported missing, so every book must be numbered.
    if (indices.length !== bookCount || integerIndices.length !== indices.length) return undefined;

    // Owning a book numbered past the total means the total is stale or matched the wrong series.
    if (Math.max(...integerIndices) > expected) return undefined;

    return expected;
  }

  private collectMissing(integerIndices: number[], from: number, to: number): number[] {
    const present = new Set(integerIndices);
    const gaps: number[] = [];
    for (let i = from; i <= to; i++) {
      if (!present.has(i)) {
        gaps.push(i);
      }
    }
    return gaps;
  }

  private async resolveLibraryIds(user: RequestUser, scopedLibraryId?: number): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    const accessibleIds = libraries.map((library) => library.id);

    if (!scopedLibraryId) return accessibleIds;
    return accessibleIds.includes(scopedLibraryId) ? [scopedLibraryId] : [];
  }

  private async resolveReadableLibraryScope(
    user: RequestUser,
    libraryScope: {
      localLibraryId?: number;
      includeLocal: boolean;
      includeWarehouse: boolean;
      mediaType?: WarehouseMediaType;
    },
  ): Promise<ResolvedReadableLibraryScope> {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const accessibleIds = libraries.map((library) => library.id);
    const localLibraryIds = libraryScope.includeLocal
      ? libraryScope.localLibraryId
        ? accessibleIds.includes(libraryScope.localLibraryId)
          ? [libraryScope.localLibraryId]
          : []
        : accessibleIds.filter((id) => id > 0)
      : [];

    const warehouseMediaTypes: WarehouseMediaType[] = [];
    if (libraryScope.includeWarehouse) {
      if (libraryScope.mediaType) {
        const requiredLibraryId = sourceBackedLibraryIdForMediaType(libraryScope.mediaType);
        if (accessibleIds.includes(requiredLibraryId)) warehouseMediaTypes.push(libraryScope.mediaType);
      } else {
        if (accessibleIds.includes(CLOUD_EBOOK_LIBRARY_ID)) warehouseMediaTypes.push('ebook');
        if (accessibleIds.includes(CLOUD_AUDIO_LIBRARY_ID)) warehouseMediaTypes.push('audiobook');
        if (accessibleIds.includes(CLOUD_COMIC_LIBRARY_ID)) warehouseMediaTypes.push('comic');
      }
    }

    return {
      localLibraryIds,
      includeWarehouse: warehouseMediaTypes.length > 0,
      warehouseMediaType: warehouseMediaTypes.length === 1 ? warehouseMediaTypes[0] : undefined,
    };
  }

  private resolveLibraryScope(libraryId?: number): {
    localLibraryId?: number;
    includeLocal: boolean;
    includeWarehouse: boolean;
    mediaType?: WarehouseMediaType;
  } {
    switch (libraryId) {
      case undefined:
        return { includeLocal: true, includeWarehouse: true };
      case CLOUD_EBOOK_LIBRARY_ID:
        return { includeLocal: false, includeWarehouse: true, mediaType: 'ebook' };
      case CLOUD_AUDIO_LIBRARY_ID:
        return { includeLocal: false, includeWarehouse: true, mediaType: 'audiobook' };
      case CLOUD_COMIC_LIBRARY_ID:
        return { includeLocal: false, includeWarehouse: true, mediaType: 'comic' };
      default:
        return { includeLocal: true, includeWarehouse: false, localLibraryId: libraryId };
    }
  }
}

function sourceBackedLibraryIdForMediaType(mediaType: WarehouseMediaType): number {
  if (mediaType === 'audiobook') return CLOUD_AUDIO_LIBRARY_ID;
  if (mediaType === 'comic') return CLOUD_COMIC_LIBRARY_ID;
  return CLOUD_EBOOK_LIBRARY_ID;
}

function syntheticSeriesId(name: string): number {
  let hash = 0;
  const normalized = name.trim().toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}
