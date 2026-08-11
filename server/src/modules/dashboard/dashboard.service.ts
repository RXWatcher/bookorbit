import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  CLOUD_AUDIO_LIBRARY_ID,
  CLOUD_COMIC_LIBRARY_ID,
  CLOUD_EBOOK_LIBRARY_ID,
  type BookCard,
  type DashboardCatalogAdditionsData,
  type DashboardCatalogItem,
  type DashboardScrollerBatchResponse,
  type DashboardScrollerItem,
  type LibraryBookItem,
  type WarehouseMediaType,
} from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import type { WarehouseCatalogItemRow } from '../../db/schema';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookReadService } from '../book/book-read.service';
import { assembleBookCards } from '../book/utils/assemble-book-cards';
import { SmartScopeService } from '../smart-scope/smart-scope.service';
import { LibraryService } from '../library/library.service';
import { WarehouseRepository } from '../warehouse/warehouse.repository';
import { catalogAuthorRefs, catalogSeriesRef } from '../warehouse/catalog-link-refs';
import { mapWarehouseCatalogItemToBookCard } from '../warehouse/warehouse-book-card.mapper';
import type { ContinueReadingRow, UpNextInSeriesRow } from './dashboard.repository';
import { DashboardRepository } from './dashboard.repository';
import { DASHBOARD_SCROLLER_MAX_LIMIT, type DashboardScrollerBatchDto, type DashboardScrollerBatchItemDto } from './dto/dashboard-scroller-batch.dto';
import { ScrollerType } from './dto/scroller-type.enum';

const SCROLLER_QUERY_CONCURRENCY = 3;
type DateLike = Date | string | number | null | undefined;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly dashboardRepo: DashboardRepository,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly smartScopeService: SmartScopeService,
    private readonly warehouseRepo: WarehouseRepository,
  ) {}

  private async loadCardsByIds(bookIds: number[], userId: number): Promise<BookCard[]> {
    if (bookIds.length === 0) return [];
    const { rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows } = await this.bookReadService.findCardsByBookIds(
      bookIds,
      userId,
    );
    const cards = assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows);
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    return bookIds.map((id) => cardsById.get(id)).filter((card): card is BookCard => card != null);
  }

  async getCatalogAdditions(user: RequestUser, limit: number): Promise<DashboardCatalogAdditionsData> {
    const clampedLimit = Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT);
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraries.map((library) => library.id));
    const rows = await this.warehouseRepo.listRecentUserCatalogItems(
      user.id,
      clampedLimit,
      user.isSuperuser ? undefined : user.contentFilters,
      sourceBackedMediaTypes,
    );
    return { items: rows.map(mapCatalogDashboardItem) };
  }

  async getCatalogDiscovery(user: RequestUser, limit: number): Promise<DashboardCatalogAdditionsData> {
    const clampedLimit = Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT);
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraries.map((library) => library.id));
    const rows = await this.warehouseRepo.listRandomCatalogItems(
      clampedLimit,
      user.isSuperuser ? undefined : user.contentFilters,
      sourceBackedMediaTypes,
    );
    return { items: rows.map(mapCatalogDashboardItem) };
  }

  async getScroller(type: ScrollerType, user: RequestUser, limit: number, smartScopeId?: number): Promise<DashboardScrollerItem[]> {
    const clampedLimit = Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT);

    if (type === ScrollerType.SMART_SCOPE) {
      if (!smartScopeId || smartScopeId <= 0) {
        throw new BadRequestException('smartScopeId is required and must be a positive integer when scroller type is smartScope');
      }
      const result = await this.smartScopeService.executeSmartScope(smartScopeId, user, 0, clampedLimit);
      return result.items.filter(isBookCard);
    }

    if (type === ScrollerType.CATALOG_ADDITIONS) {
      throw new BadRequestException('Library additions are loaded through the library additions endpoint');
    }
    if (type === ScrollerType.CATALOG_DISCOVERY) {
      throw new BadRequestException('Library discovery is loaded through the library discovery endpoint');
    }

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    if (type === ScrollerType.RECENTLY_ADDED) {
      return this.getRecentlyAddedScroller(user, clampedLimit, contentFilters);
    }
    if (type === ScrollerType.RANDOM) {
      return this.getRandomScroller(user, clampedLimit, contentFilters);
    }
    if (type === ScrollerType.UP_NEXT_IN_SERIES) {
      return this.getUpNextInSeriesScroller(user, clampedLimit, contentFilters);
    }

    switch (type) {
      case ScrollerType.CONTINUE_READING:
        return this.getContinueReadingScroller(user, clampedLimit, contentFilters);
      case ScrollerType.CONTINUE_LISTENING:
      case ScrollerType.WANT_TO_READ: {
        const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
        if (accessibleLibraryIds.length === 0) return [];
        if (type === ScrollerType.WANT_TO_READ) {
          return this.loadCardsByIds(
            await this.dashboardRepo.findWantToReadBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters),
            user.id,
          );
        }
        return this.loadCardsByIds(
          await this.dashboardRepo.findContinueListeningBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters),
          user.id,
        );
      }
    }
  }

  private async getContinueReadingScroller(
    user: RequestUser,
    limit: number,
    contentFilters: RequestUser['contentFilters'] | undefined,
  ): Promise<DashboardScrollerItem[]> {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const localLibraryIds = libraries.map((library) => library.id).filter((id) => id > 0);
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraries.map((library) => library.id));

    if (localLibraryIds.length === 0 && sourceBackedMediaTypes.length === 0) return [];

    const [localRows, catalogRows] = await Promise.all([
      localLibraryIds.length > 0 ? this.dashboardRepo.findContinueReadingBooks(localLibraryIds, user.id, limit, contentFilters) : Promise.resolve([]),
      sourceBackedMediaTypes.length > 0
        ? this.warehouseRepo.listCurrentlyReadingUserCatalogItems(user.id, limit, contentFilters, sourceBackedMediaTypes)
        : Promise.resolve([]),
    ]);
    const localBookIds = localRows.map((row) => row.id);

    const [localCards] = await Promise.all([this.loadCardsByIds(localBookIds, user.id)]);
    const catalogCards = catalogRows.map(mapWarehouseCatalogItemToBookCard);

    return mergeContinueReadingItems(localRows, localCards, catalogRows, catalogCards, limit);
  }

  private async getRecentlyAddedScroller(
    user: RequestUser,
    limit: number,
    contentFilters: RequestUser['contentFilters'] | undefined,
  ): Promise<DashboardScrollerItem[]> {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const localLibraryIds = libraries.map((library) => library.id).filter((id) => id > 0);
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraries.map((library) => library.id));

    if (localLibraryIds.length === 0 && sourceBackedMediaTypes.length === 0) return [];

    const [localBookIds, catalogRows] = await Promise.all([
      localLibraryIds.length > 0 ? this.dashboardRepo.findRecentlyAddedBookIds(localLibraryIds, limit, contentFilters) : Promise.resolve([]),
      sourceBackedMediaTypes.length > 0
        ? this.warehouseRepo.listRecentCatalogItems(limit, contentFilters, sourceBackedMediaTypes)
        : Promise.resolve([]),
    ]);

    const [localCards] = await Promise.all([this.loadCardsByIds(localBookIds, user.id)]);
    const catalogCards = catalogRows.map(mapWarehouseCatalogItemToBookCard);

    return [...localCards, ...catalogCards].sort(compareDashboardScrollerItemsByAddedAt).slice(0, limit);
  }

  private async getRandomScroller(
    user: RequestUser,
    limit: number,
    contentFilters: RequestUser['contentFilters'] | undefined,
  ): Promise<DashboardScrollerItem[]> {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const localLibraryIds = libraries.map((library) => library.id).filter((id) => id > 0);
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraries.map((library) => library.id));

    if (localLibraryIds.length === 0 && sourceBackedMediaTypes.length === 0) return [];

    const [localCandidateCount, catalogRows] = await Promise.all([
      localLibraryIds.length > 0 ? this.dashboardRepo.countRandomBookCandidates(localLibraryIds, user.id, contentFilters) : Promise.resolve(0),
      sourceBackedMediaTypes.length > 0
        ? this.warehouseRepo.listRandomCatalogItems(limit, contentFilters, sourceBackedMediaTypes)
        : Promise.resolve([]),
    ]);
    const localLimit = localCandidateCount > 0 ? limit : 0;

    const [localBookIds] = await Promise.all([
      localLimit > 0 ? this.dashboardRepo.findRandomBookIds(localLibraryIds, user.id, localLimit, contentFilters) : Promise.resolve([]),
    ]);

    const [localCards] = await Promise.all([this.loadCardsByIds(localBookIds, user.id)]);
    const catalogCards = catalogRows.map(mapWarehouseCatalogItemToBookCard);

    return selectRandomScrollerItems([...localCards, ...catalogCards], limit);
  }

  private async getUpNextInSeriesScroller(
    user: RequestUser,
    limit: number,
    contentFilters: RequestUser['contentFilters'] | undefined,
  ): Promise<DashboardScrollerItem[]> {
    const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
    const localLibraryIds = libraries.map((library) => library.id).filter((id) => id > 0);
    const sourceBackedMediaTypes = sourceBackedMediaTypesForLibraryIds(libraries.map((library) => library.id));

    if (localLibraryIds.length === 0 && sourceBackedMediaTypes.length === 0) return [];

    const [localRows, catalogRows] = await Promise.all([
      localLibraryIds.length > 0 ? this.dashboardRepo.findUpNextInSeriesBooks(localLibraryIds, user.id, limit, contentFilters) : Promise.resolve([]),
      sourceBackedMediaTypes.length > 0
        ? this.warehouseRepo.listUpNextInSeriesUserCatalogItems(user.id, limit, contentFilters, sourceBackedMediaTypes)
        : Promise.resolve([]),
    ]);
    const localBookIds = localRows.map((row) => row.id);

    const [localCards] = await Promise.all([this.loadCardsByIds(localBookIds, user.id)]);
    const catalogCards = catalogRows.map(mapWarehouseCatalogItemToBookCard);

    return mergeUpNextInSeriesItems(localRows, localCards, catalogRows, catalogCards, limit);
  }

  async getSmartScopeBookIds(smartScopeId: number | undefined, user: RequestUser, limit: number): Promise<number[]> {
    const result = await this.smartScopeService.executeSmartScope(
      this.assertSmartScopeId(smartScopeId),
      user,
      0,
      Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT),
    );
    return result.items.filter(isBookCard).map((item) => item.id);
  }

  async getScrollerBookIds(type: Exclude<ScrollerType, 'smart-scope'>, user: RequestUser, limit: number): Promise<number[]> {
    return this.findScrollerBookIds(type, user, Math.min(Math.max(1, limit), DASHBOARD_SCROLLER_MAX_LIMIT));
  }

  private async findScrollerBookIds(type: Exclude<ScrollerType, 'smart-scope'>, user: RequestUser, clampedLimit: number): Promise<number[]> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return this.findScrollerBookIdsForLibraries(type, user, clampedLimit, accessibleLibraryIds);
  }

  private async findScrollerBookIdsForLibraries(
    type: Exclude<ScrollerType, 'smart-scope'>,
    user: RequestUser,
    clampedLimit: number,
    accessibleLibraryIds: number[],
  ): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];

    const contentFilters = user.isSuperuser ? undefined : user.contentFilters;
    switch (type) {
      case ScrollerType.RECENTLY_ADDED:
        return this.dashboardRepo.findRecentlyAddedBookIds(accessibleLibraryIds, clampedLimit, contentFilters);
      case ScrollerType.CONTINUE_READING:
        return this.dashboardRepo.findContinueReadingBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.CONTINUE_LISTENING:
        return this.dashboardRepo.findContinueListeningBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.WANT_TO_READ:
        return this.dashboardRepo.findWantToReadBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.UP_NEXT_IN_SERIES:
        return this.dashboardRepo.findUpNextInSeriesBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
      case ScrollerType.RANDOM:
        return this.dashboardRepo.findRandomBookIds(accessibleLibraryIds, user.id, clampedLimit, contentFilters);
    }

    // Catalog scroller types are served by the warehouse endpoints, not here.
    return [];
  }

  // v2.5.0's batched shelf endpoint: one round trip for the whole dashboard,
  // with a single shared card hydration across every shelf. Catalog shelves are
  // not served here — findScrollerBookIds returns [] for them and the client
  // routes them to the warehouse endpoints instead.
  async getScrollers(dto: DashboardScrollerBatchDto, user: RequestUser): Promise<DashboardScrollerBatchResponse> {
    const startedAt = Date.now();
    const requestIds = new Set(dto.items.map((item) => item.id));
    if (requestIds.size !== dto.items.length) throw new BadRequestException('Scroller batch item IDs must be unique');

    this.logger.debug(
      `[dashboard.scroller_batch] [start] userId=${user.id} shelfCount=${dto.items.length} concurrency=${SCROLLER_QUERY_CONCURRENCY} - scroller batch started`,
    );

    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const selections = await mapWithConcurrency(dto.items, SCROLLER_QUERY_CONCURRENCY, async (item) => {
      const selectionStartedAt = Date.now();
      try {
        const bookIds = await this.findBatchScrollerBookIds(item, user, accessibleLibraryIds);
        return { item, bookIds, failed: false };
      } catch (error) {
        const errorClass = error instanceof Error ? error.constructor.name : typeof error;
        const message = sanitizeLogValue(error instanceof Error ? error.message : error);
        this.logger.warn(
          `[dashboard.scroller_query] [fail] userId=${user.id} type=${item.type} smartScopeId=${item.smartScopeId ?? 0} durationMs=${Date.now() - selectionStartedAt} errorClass=${errorClass} error="${message}" - scroller selection failed`,
        );
        return { item, bookIds: [] as number[], failed: true };
      }
    });

    const uniqueBookIds = [...new Set(selections.flatMap((selection) => selection.bookIds))];
    const hydrationStartedAt = Date.now();
    this.logger.debug(`[dashboard.card_hydration] [start] userId=${user.id} uniqueBookCount=${uniqueBookIds.length} - shared card hydration started`);
    let cards: BookCard[];
    try {
      cards = await this.loadCardsByIds(uniqueBookIds, user.id);
      this.logger.debug(
        `[dashboard.card_hydration] [end] userId=${user.id} uniqueBookCount=${uniqueBookIds.length} resultCount=${cards.length} durationMs=${Date.now() - hydrationStartedAt} - shared card hydration completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : typeof error;
      const message = sanitizeLogValue(error instanceof Error ? error.message : error);
      this.logger.warn(
        `[dashboard.card_hydration] [fail] userId=${user.id} uniqueBookCount=${uniqueBookIds.length} durationMs=${Date.now() - hydrationStartedAt} errorClass=${errorClass} error="${message}" - shared card hydration failed`,
      );
      throw error;
    }
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    const items = selections.map(({ item, bookIds, failed }) => ({
      id: item.id,
      books: bookIds.map((id) => cardsById.get(id)).filter((card): card is BookCard => card != null),
      failed,
    }));

    this.logger.debug(
      `[dashboard.scroller_batch] [end] userId=${user.id} shelfCount=${items.length} failedCount=${items.filter((item) => item.failed).length} uniqueBookCount=${uniqueBookIds.length} durationMs=${Date.now() - startedAt} - scroller batch completed`,
    );
    return { items };
  }

  private async findBatchScrollerBookIds(item: DashboardScrollerBatchItemDto, user: RequestUser, accessibleLibraryIds: number[]): Promise<number[]> {
    const startedAt = Date.now();
    this.logger.debug(
      `[dashboard.scroller_query] [start] userId=${user.id} type=${item.type} smartScopeId=${item.smartScopeId ?? 0} limit=${item.limit} - scroller selection started`,
    );

    let bookIds: number[];
    if (item.type === ScrollerType.SMART_SCOPE) {
      const smartScopeId = this.assertSmartScopeId(item.smartScopeId);
      bookIds = await this.smartScopeService.executeSmartScopeBookIds(smartScopeId, user, item.limit);
    } else {
      bookIds = await this.findScrollerBookIdsForLibraries(item.type, user, item.limit, accessibleLibraryIds);
    }

    this.logger.debug(
      `[dashboard.scroller_query] [end] userId=${user.id} type=${item.type} smartScopeId=${item.smartScopeId ?? 0} resultCount=${bookIds.length} durationMs=${Date.now() - startedAt} - scroller selection completed`,
    );
    return bookIds;
  }

  private assertSmartScopeId(smartScopeId?: number): number {
    if (!smartScopeId || smartScopeId <= 0) {
      throw new BadRequestException('smartScopeId is required and must be a positive integer when scroller type is smartScope');
    }
    return smartScopeId;
  }
}

function mergeUpNextInSeriesItems(
  localRows: UpNextInSeriesRow[],
  localCards: BookCard[],
  catalogRows: Array<{ previousCompletionUpdatedAt: DateLike }>,
  catalogItems: BookCard[],
  limit: number,
): DashboardScrollerItem[] {
  const localCompletionById = new Map(localRows.map((row) => [row.id, row.previousCompletionUpdatedAt]));
  const rankedItems = [
    ...localCards.map((item) => ({ item, previousCompletionUpdatedAt: localCompletionById.get(item.id) ?? null })),
    ...catalogItems.map((item, index) => ({ item, previousCompletionUpdatedAt: catalogRows[index]?.previousCompletionUpdatedAt ?? null })),
  ];

  return rankedItems
    .sort((a, b) => getNullableTime(b.previousCompletionUpdatedAt) - getNullableTime(a.previousCompletionUpdatedAt))
    .slice(0, limit)
    .map(({ item }) => item);
}

function mergeContinueReadingItems(
  localRows: ContinueReadingRow[],
  localCards: BookCard[],
  catalogRows: Array<{ lastActivityAt: DateLike }>,
  catalogItems: BookCard[],
  limit: number,
): DashboardScrollerItem[] {
  const localActivityById = new Map(localRows.map((row) => [row.id, row.lastActivityAt]));
  const rankedItems = [
    ...localCards.map((item) => ({ item, lastActivityAt: localActivityById.get(item.id) ?? null })),
    ...catalogItems.map((item, index) => ({ item, lastActivityAt: catalogRows[index]?.lastActivityAt ?? null })),
  ];

  return rankedItems
    .sort((a, b) => getNullableTime(b.lastActivityAt) - getNullableTime(a.lastActivityAt))
    .slice(0, limit)
    .map(({ item }) => item);
}

function mapCatalogDashboardItem(row: WarehouseCatalogItemRow): DashboardCatalogItem {
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
    libraryName: dashboardCatalogLibraryName(row.mediaType),
    formats: row.format ? [row.format] : [],
    hasCover: row.hasCover,
  };
}

function compareDashboardScrollerItemsByAddedAt(a: DashboardScrollerItem, b: DashboardScrollerItem): number {
  return getDashboardScrollerItemTime(b) - getDashboardScrollerItemTime(a);
}

function getDashboardScrollerItemTime(item: DashboardScrollerItem): number {
  const value = item.addedAt;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getNullableTime(value: DateLike): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function selectRandomScrollerItems(items: DashboardScrollerItem[], limit: number): DashboardScrollerItem[] {
  return items
    .map((item) => ({ item, rank: Math.random() }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ item }) => item);
}

function isBookCard(item: LibraryBookItem): item is BookCard {
  return !('type' in item && item.type === 'catalog-item');
}

function sourceBackedMediaTypesForLibraryIds(libraryIds: number[]): WarehouseMediaType[] {
  const mediaTypes: WarehouseMediaType[] = [];
  if (libraryIds.includes(CLOUD_EBOOK_LIBRARY_ID)) mediaTypes.push('ebook');
  if (libraryIds.includes(CLOUD_AUDIO_LIBRARY_ID)) mediaTypes.push('audiobook');
  if (libraryIds.includes(CLOUD_COMIC_LIBRARY_ID)) mediaTypes.push('comic');
  return mediaTypes;
}

function dashboardCatalogLibraryName(mediaType: WarehouseCatalogItemRow['mediaType']): string {
  if (mediaType === 'audiobook') return 'Audiobooks';
  if (mediaType === 'comic') return 'Comics';
  return 'Books';
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
