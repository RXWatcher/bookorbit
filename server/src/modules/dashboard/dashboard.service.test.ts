import { BadRequestException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { DashboardService } from './dashboard.service';
import { ScrollerType } from './dto/scroller-type.enum';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 42,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const dashboardRepo = {
    findRecentlyAddedBookIds: vi.fn(),
    findContinueReadingBooks: vi.fn(),
    findContinueReadingBookIds: vi.fn(),
    findContinueListeningBookIds: vi.fn(),
    findWantToReadBookIds: vi.fn(),
    findUpNextInSeriesBookIds: vi.fn(),
    findUpNextInSeriesBooks: vi.fn(),
    findRandomBookIds: vi.fn(),
    countRandomBookCandidates: vi.fn(),
  };
  const bookReadService = {
    findCardsByBookIds: vi.fn(),
  };
  const libraryService = {
    findAccessibleLibraryIds: vi.fn(),
    findAll: vi.fn(),
  };
  const smartScopeService = {
    executeSmartScope: vi.fn(),
  };
  const warehouseRepo = {
    listRecentCatalogItems: vi.fn().mockResolvedValue([]),
    listRecentUserCatalogItems: vi.fn().mockResolvedValue([]),
    listRandomCatalogItems: vi.fn().mockResolvedValue([]),
    listCurrentlyReadingUserCatalogItems: vi.fn().mockResolvedValue([]),
    listRandomUserCatalogItems: vi.fn().mockResolvedValue([]),
    countRandomUserCatalogItems: vi.fn().mockResolvedValue(0),
    listUpNextInSeriesUserCatalogItems: vi.fn().mockResolvedValue([]),
  };

  const service = new DashboardService(
    dashboardRepo as never,
    bookReadService as never,
    libraryService as never,
    smartScopeService as never,
    warehouseRepo as never,
  );
  return { service, dashboardRepo, bookReadService, libraryService, smartScopeService, warehouseRepo };
}

function makeFindCardsResult(idsInRowOrder: number[]) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    rows: idsInRowOrder.map((id) => ({
      id,
      status: 'present',
      primaryFileId: id * 10,
      folderPath: `/books/${id}`,
      addedAt: now,
      title: `Book ${id}`,
      seriesName: null,
      seriesIndex: null,
      publishedYear: null,
      language: null,
      rating: null,
    })),
    authorRows: [],
    fileRows: idsInRowOrder.map((id) => ({ bookId: id, id: id * 10, format: 'epub', role: 'primary' })),
    genreRows: [],
    tagRows: [],
    narratorRows: [],
    progressRows: [],
    statusRows: [],
    total: idsInRowOrder.length,
  };
}

describe('DashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects smartScope scroller calls when smartScopeId is missing or invalid', async () => {
    const { service, smartScopeService } = makeService();

    await expect(service.getScroller(ScrollerType.SMART_SCOPE, makeUser(), 20, 0)).rejects.toThrow(BadRequestException);
    await expect(service.getScroller(ScrollerType.SMART_SCOPE, makeUser(), 20, -2)).rejects.toThrow(BadRequestException);

    expect(smartScopeService.executeSmartScope).not.toHaveBeenCalled();
  });

  it('executes smartScope scroller with max limit clamp and returns smartScope items', async () => {
    const { service, smartScopeService } = makeService();
    const user = makeUser({ id: 7 });
    const items = [{ id: 11 }, { id: 12 }];
    smartScopeService.executeSmartScope.mockResolvedValue({ items, total: 2, page: 0, size: 50 });

    const result = await service.getScroller(ScrollerType.SMART_SCOPE, user, 999, 88);

    expect(smartScopeService.executeSmartScope).toHaveBeenCalledWith(88, user, 0, 50);
    expect(result).toEqual(items);
  });

  it('returns cached source-backed library additions as safe dashboard items', async () => {
    const { service, warehouseRepo, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_AUDIO_LIBRARY_ID }]);
    warehouseRepo.listRecentUserCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'audiobook',
        remoteId: 'audio-1',
        title: 'Dune Audio',
        subtitle: 'Collector Edition',
        sortTitle: 'Dune Audio',
        authors: ['Frank Herbert'],
        narrators: ['Simon Vance'],
        series: 'Dune',
        genres: ['Science Fiction'],
        tags: [],
        language: 'en',
        publisher: 'Orbit',
        identifiers: { isbn: '9780000000001' },
        format: 'm4b',
        durationSeconds: 3600,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.getCatalogAdditions(user, 999);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
    expect(warehouseRepo.listRecentUserCatalogItems).toHaveBeenCalledWith(7, 50, EMPTY_CONTENT_FILTER_RULES, ['audiobook']);
    expect(warehouseRepo.listRecentCatalogItems).not.toHaveBeenCalled();
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    // Cards, because this shelf renders through the same component as every
    // other one. Handing it the catalog projection left it without files and
    // threw during render, taking the whole dashboard blank.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: 'Dune Audio',
      subtitle: 'Collector Edition',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      hasCover: true,
      durationSeconds: 3600,
      catalogSource: { mediaType: 'audiobook', remoteId: 'audio-1' },
    });
    expect(result.items[0].files).toEqual([expect.objectContaining({ format: 'm4b', role: 'primary' })]);
    expect(JSON.stringify(result)).not.toContain('catalog-source');
    expect(result.items[0]).not.toHaveProperty('rawPayload');
    expect(result.items[0]).not.toHaveProperty('upstreamUpdatedAt');
  });

  it('returns cached Comics additions as normal Comics dashboard items', async () => {
    const { service, warehouseRepo, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_COMIC_LIBRARY_ID }]);
    warehouseRepo.listRecentUserCatalogItems.mockResolvedValue([
      {
        id: 102,
        mediaType: 'comic',
        remoteId: 'comic-1',
        title: 'Saga #1',
        subtitle: null,
        sortTitle: 'Saga #1',
        authors: ['Brian K. Vaughan'],
        narrators: [],
        series: 'Saga',
        seriesIndex: 1,
        genres: ['Science Fiction'],
        tags: [],
        language: 'en',
        publisher: 'Image',
        identifiers: { seriesId: 'series-1', issueNumber: '1' },
        format: 'cbz',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { media_path: '/media/private/comic.cbz', storage_path: 'ceph://private/comic.cbz' },
        syncedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.getCatalogAdditions(user, 20);

    expect(warehouseRepo.listRecentUserCatalogItems).toHaveBeenCalledWith(7, 20, EMPTY_CONTENT_FILTER_RULES, ['comic']);
    expect(result.items[0]).toMatchObject({
      title: 'Saga #1',
      subtitle: null,
      seriesName: 'Saga',
      seriesIndex: 1,
      authors: ['Brian K. Vaughan'],
      hasCover: true,
      catalogSource: { mediaType: 'comic', remoteId: 'comic-1' },
    });
    expect(result.items[0].files).toEqual([expect.objectContaining({ format: 'cbz', role: 'primary' })]);
    expect(JSON.stringify(result)).not.toMatch(/\/media\/|ceph:\/\/|storage_path|media_path/i);
  });

  it('returns cached source-backed library discovery items as safe dashboard items', async () => {
    const { service, warehouseRepo, libraryService } = makeService();
    const user = makeUser({ id: 7 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseRepo.listRandomCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        title: 'Dune',
        subtitle: null,
        sortTitle: 'Dune',
        authors: ['Frank Herbert'],
        narrators: [],
        series: 'Dune',
        genres: [],
        tags: [],
        language: 'en',
        publisher: 'Orbit',
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: false,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.getCatalogDiscovery(user, 999);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
    expect(warehouseRepo.listRandomCatalogItems).toHaveBeenCalledWith(50, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(warehouseRepo.listRandomUserCatalogItems).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      title: 'Dune',
      subtitle: null,
      seriesName: 'Dune',
      authors: ['Frank Herbert'],
      hasCover: false,
      catalogSource: { mediaType: 'ebook', remoteId: 'ebook-1' },
    });
    expect(result.items[0].files).toEqual([expect.objectContaining({ format: 'epub', role: 'primary' })]);
    expect(JSON.stringify(result)).not.toContain('catalog-source');
  });

  it('rejects catalog discovery on the generic scroller endpoint', async () => {
    const { service, libraryService, warehouseRepo } = makeService();

    await expect(service.getScroller(ScrollerType.CATALOG_DISCOVERY, makeUser(), 20)).rejects.toThrow(BadRequestException);
    await expect(service.getScroller(ScrollerType.CATALOG_DISCOVERY, makeUser(), 20)).rejects.toThrow(
      'Library discovery is loaded through the library discovery endpoint',
    );

    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(warehouseRepo.listRandomUserCatalogItems).not.toHaveBeenCalled();
  });

  it('rejects library additions on the generic scroller endpoint with native copy', async () => {
    const { service, libraryService } = makeService();

    await expect(service.getScroller(ScrollerType.CATALOG_ADDITIONS, makeUser(), 20)).rejects.toThrow(BadRequestException);
    await expect(service.getScroller(ScrollerType.CATALOG_ADDITIONS, makeUser(), 20)).rejects.toThrow(
      'Library additions are loaded through the library additions endpoint',
    );

    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
  });

  it('returns empty list when user has no accessible libraries', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    libraryService.findAll.mockResolvedValue([]);

    const result = await service.getScroller(ScrollerType.RECENTLY_ADDED, makeUser(), 20);

    expect(result).toEqual([]);
    expect(libraryService.findAll).toHaveBeenCalledWith(expect.any(Object), { includeSourceBacked: true });
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.findRecentlyAddedBookIds).not.toHaveBeenCalled();
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
  });

  it('loads recently added cards with min limit clamp and preserves repository id order', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 5 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([100, 200]);
    libraryService.findAll.mockResolvedValue([{ id: 100 }, { id: 200 }]);
    dashboardRepo.findRecentlyAddedBookIds.mockResolvedValue([9]);
    bookReadService.findCardsByBookIds.mockResolvedValue({
      ...makeFindCardsResult([3, 9]),
      statusRows: [
        {
          bookId: 9,
          status: 'reading',
          source: 'manual',
          startedAt: null,
          finishedAt: null,
          updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.getScroller(ScrollerType.RECENTLY_ADDED, user, 0);

    expect(dashboardRepo.findRecentlyAddedBookIds).toHaveBeenCalledWith([100, 200], 1, EMPTY_CONTENT_FILTER_RULES);
    expect(bookReadService.findCardsByBookIds).toHaveBeenCalledWith([9], 5);
    expect(result.map((card) => card.id)).toEqual([9]);
    expect(result[0]?.readStatus?.status).toBe('reading');
  });

  it('merges source-backed library rows into the recently added scroller without querying negative ids as local books', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 5 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }, { id: 100 }, { id: 200 }]);
    dashboardRepo.findRecentlyAddedBookIds.mockResolvedValue([9]);
    bookReadService.findCardsByBookIds.mockResolvedValue({
      ...makeFindCardsResult([9]),
      rows: [
        {
          ...makeFindCardsResult([9]).rows[0],
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    warehouseRepo.listRecentCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        title: 'Cloud Latest',
        subtitle: null,
        sortTitle: 'Cloud Latest',
        authors: ['Cloud Author'],
        narrators: [],
        series: null,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2026-01-04T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
      {
        id: 102,
        mediaType: 'ebook',
        remoteId: 'ebook-unknown-date',
        title: 'Cloud Unknown Date',
        subtitle: null,
        sortTitle: 'Cloud Unknown Date',
        authors: ['Cloud Author'],
        narrators: [],
        series: null,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: null,
        upstreamUpdatedAt: null,
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-05T00:00:00.000Z'),
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
        updatedAt: new Date('2026-01-05T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScroller(ScrollerType.RECENTLY_ADDED, user, 20);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.findRecentlyAddedBookIds).toHaveBeenCalledWith([100, 200], 20, EMPTY_CONTENT_FILTER_RULES);
    expect(warehouseRepo.listRecentCatalogItems).toHaveBeenCalledWith(20, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(warehouseRepo.listRecentUserCatalogItems).not.toHaveBeenCalled();
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: -1000000102,
      status: 'present',
      title: 'Cloud Unknown Date',
      authors: ['Cloud Author'],
      addedAt: '2026-01-05T00:00:00.000Z',
    });
    expect(result[1]).toMatchObject({
      id: -1000000101,
      status: 'present',
      title: 'Cloud Latest',
      authors: ['Cloud Author'],
      addedAt: '2026-01-04T00:00:00.000Z',
    });
    expect(result[2]).toMatchObject({ id: 9, title: 'Book 9' });
    expect(JSON.stringify(result)).not.toContain('catalog-source');
  });

  it('routes continue reading requests to repository with clamped max limit', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 9 });
    libraryService.findAll.mockResolvedValue([{ id: 301 }]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([301]);
    dashboardRepo.findContinueReadingBooks.mockResolvedValue([{ id: 4, lastActivityAt: new Date('2026-01-02T00:00:00.000Z') }]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([4]));

    const result = await service.getScroller(ScrollerType.CONTINUE_READING, user, 500);

    expect(dashboardRepo.findContinueReadingBooks).toHaveBeenCalledWith([301], 9, 50, EMPTY_CONTENT_FILTER_RULES);
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.findContinueReadingBookIds).not.toHaveBeenCalled();
    expect(result.map((card) => card.id)).toEqual([4]);
  });

  it('merges source-backed library rows into the continue reading scroller by latest activity', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 9 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }, { id: 301 }]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([301]);
    dashboardRepo.findContinueReadingBooks.mockResolvedValue([{ id: 4, lastActivityAt: new Date('2026-01-02T00:00:00.000Z') }]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([4]));
    warehouseRepo.listCurrentlyReadingUserCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-continue',
        title: 'Cloud Continue',
        subtitle: null,
        sortTitle: 'Cloud Continue',
        authors: ['Cloud Author'],
        narrators: [],
        series: null,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        readStatus: 'reading',
        progressPercent: 42,
        positionSeconds: null,
        lastActivityAt: '2026-01-04T00:00:00.000Z',
      },
    ]);

    const result = await service.getScroller(ScrollerType.CONTINUE_READING, user, 20);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.findContinueReadingBooks).toHaveBeenCalledWith([301], 9, 20, EMPTY_CONTENT_FILTER_RULES);
    expect(dashboardRepo.findContinueReadingBookIds).not.toHaveBeenCalled();
    expect(warehouseRepo.listCurrentlyReadingUserCatalogItems).toHaveBeenCalledWith(9, 20, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(result[0]).toMatchObject({
      id: -1000000101,
      status: 'present',
      title: 'Cloud Continue',
      authors: ['Cloud Author'],
      readingProgress: 42,
      readStatus: expect.objectContaining({ status: 'reading', updatedAt: '2026-01-04T00:00:00.000Z' }),
    });
    expect(result[1]).toMatchObject({ id: 4, title: 'Book 4' });
    expect(JSON.stringify(result)).not.toContain('catalog-source');
  });

  it('includes source-backed comics marked reading even when there are no local libraries', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 9 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_COMIC_LIBRARY_ID }]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([]);
    warehouseRepo.listCurrentlyReadingUserCatalogItems.mockResolvedValue([
      {
        id: 102,
        mediaType: 'comic',
        remoteId: 'comic-reading',
        title: 'Cloud Comic',
        subtitle: null,
        sortTitle: 'Cloud Comic',
        authors: ['Cloud Artist'],
        narrators: [],
        series: null,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'cbz',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        readStatus: 'reading',
        progressPercent: null,
        positionSeconds: null,
        lastActivityAt: new Date('2026-01-05T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScroller(ScrollerType.CONTINUE_READING, user, 20);

    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.findContinueReadingBooks).not.toHaveBeenCalled();
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
    expect(warehouseRepo.listCurrentlyReadingUserCatalogItems).toHaveBeenCalledWith(9, 20, EMPTY_CONTENT_FILTER_RULES, ['comic']);
    expect(result).toEqual([
      expect.objectContaining({
        id: -3000000102,
        status: 'present',
        title: 'Cloud Comic',
        authors: ['Cloud Artist'],
        readStatus: expect.objectContaining({ status: 'reading' }),
      }),
    ]);
  });

  it('routes continue listening requests to repository with user scope and content filters', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 14 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([302, 303]);
    dashboardRepo.findContinueListeningBookIds.mockResolvedValue([6]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([6]));

    const result = await service.getScroller(ScrollerType.CONTINUE_LISTENING, user, 500);

    expect(dashboardRepo.findContinueListeningBookIds).toHaveBeenCalledWith([302, 303], 14, 50, EMPTY_CONTENT_FILTER_RULES);
    expect(bookReadService.findCardsByBookIds).toHaveBeenCalledWith([6], 14);
    expect(result.map((card) => card.id)).toEqual([6]);
  });

  it('routes want-to-read requests to repository and preserves response order', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 21 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([404]);
    dashboardRepo.findWantToReadBookIds.mockResolvedValue([31, 22]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([22, 31]));

    const result = await service.getScroller(ScrollerType.WANT_TO_READ, user, 7);

    expect(dashboardRepo.findWantToReadBookIds).toHaveBeenCalledWith([404], 21, 7, EMPTY_CONTENT_FILTER_RULES);
    expect(result.map((card) => card.id)).toEqual([31, 22]);
  });

  it('routes up-next-in-series requests to repository and preserves response order', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 11 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }, { id: 707 }]);
    dashboardRepo.findUpNextInSeriesBooks.mockResolvedValue([
      { id: 19, previousCompletionUpdatedAt: new Date('2026-01-03T00:00:00.000Z') },
      { id: 8, previousCompletionUpdatedAt: new Date('2026-01-02T00:00:00.000Z') },
    ]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([8, 19]));
    warehouseRepo.listUpNextInSeriesUserCatalogItems.mockResolvedValue([]);

    const result = await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, user, 25);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.findUpNextInSeriesBooks).toHaveBeenCalledWith([707], 11, 25, EMPTY_CONTENT_FILTER_RULES);
    expect(dashboardRepo.findUpNextInSeriesBookIds).not.toHaveBeenCalled();
    expect(warehouseRepo.listUpNextInSeriesUserCatalogItems).toHaveBeenCalledWith(11, 25, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(result.map((card) => card.id)).toEqual([19, 8]);
  });

  it('orders mixed source-backed and local up-next-in-series items by previous completion recency', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 11 });
    libraryService.findAll.mockResolvedValue([{ id: 707 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
    dashboardRepo.findUpNextInSeriesBooks.mockResolvedValue([{ id: 19, previousCompletionUpdatedAt: new Date('2026-01-01T00:00:00.000Z') }]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([19]));
    warehouseRepo.listUpNextInSeriesUserCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-2',
        title: 'Cloud Volume 2',
        subtitle: null,
        sortTitle: 'Cloud Volume 2',
        authors: ['Cloud Author'],
        narrators: [],
        series: 'Cloud Saga',
        seriesIndex: 2,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        previousCompletionUpdatedAt: new Date('2026-01-04T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, user, 20);

    expect(result[0]).toMatchObject({ id: -1000000101, title: 'Cloud Volume 2' });
    expect(result[1]).toMatchObject({ id: 19 });
  });

  it('returns source-backed up-next-in-series items for cloud-only library users', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 5 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseRepo.listUpNextInSeriesUserCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-2',
        title: 'Cloud Volume 2',
        subtitle: null,
        sortTitle: 'Cloud Volume 2',
        authors: ['Cloud Author'],
        narrators: [],
        series: 'Cloud Saga',
        seriesIndex: 2,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        previousCompletionUpdatedAt: new Date('2026-01-04T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, user, 20);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.findUpNextInSeriesBookIds).not.toHaveBeenCalled();
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
    expect(warehouseRepo.listUpNextInSeriesUserCatalogItems).toHaveBeenCalledWith(5, 20, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(result).toEqual([
      expect.objectContaining({
        id: -1000000101,
        status: 'present',
        title: 'Cloud Volume 2',
        seriesName: 'Cloud Saga',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('catalog-source');
  });

  it('passes undefined content filters for up-next-in-series when user is superuser', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const superuser = makeUser({ id: 17, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES });
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
    dashboardRepo.findUpNextInSeriesBooks.mockResolvedValue([{ id: 55, previousCompletionUpdatedAt: new Date('2026-01-01T00:00:00.000Z') }]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([55]));
    warehouseRepo.listUpNextInSeriesUserCatalogItems.mockResolvedValue([]);

    await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, superuser, 20);

    expect(dashboardRepo.findUpNextInSeriesBooks).toHaveBeenCalledWith([1], 17, 20, undefined);
    expect(warehouseRepo.listUpNextInSeriesUserCatalogItems).toHaveBeenCalledWith(17, 20, undefined, ['audiobook']);
  });

  it('clamps up-next-in-series limit to minimum of 1', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 18 });
    libraryService.findAll.mockResolvedValue([{ id: 91 }]);
    dashboardRepo.findUpNextInSeriesBooks.mockResolvedValue([{ id: 3, previousCompletionUpdatedAt: new Date('2026-01-01T00:00:00.000Z') }]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([3]));

    await service.getScroller(ScrollerType.UP_NEXT_IN_SERIES, user, 0);

    expect(dashboardRepo.findUpNextInSeriesBooks).toHaveBeenCalledWith([91], 18, 1, EMPTY_CONTENT_FILTER_RULES);
  });

  it('routes random requests to repository and skips card fetch when no ids are returned', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    libraryService.findAccessibleLibraryIds.mockResolvedValue([901]);
    libraryService.findAll.mockResolvedValue([{ id: 901 }]);
    dashboardRepo.countRandomBookCandidates.mockResolvedValue(20);
    dashboardRepo.findRandomBookIds.mockResolvedValue([]);
    warehouseRepo.listRandomCatalogItems.mockResolvedValue([]);

    const result = await service.getScroller(ScrollerType.RANDOM, makeUser({ id: 3 }), 20);

    expect(dashboardRepo.countRandomBookCandidates).toHaveBeenCalledWith([901], 3, EMPTY_CONTENT_FILTER_RULES);
    expect(dashboardRepo.findRandomBookIds).toHaveBeenCalledWith([901], 3, 20, EMPTY_CONTENT_FILTER_RULES);
    expect(result).toEqual([]);
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
  });

  it('merges source-backed library rows into the random scroller without querying negative ids as local books', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 5 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_AUDIO_LIBRARY_ID }, { id: 100 }]);
    dashboardRepo.countRandomBookCandidates.mockResolvedValue(1);
    dashboardRepo.findRandomBookIds.mockResolvedValue([9]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([9]));
    warehouseRepo.listRandomCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'audiobook',
        remoteId: 'audio-1',
        title: 'Cloud Random',
        subtitle: null,
        sortTitle: 'Cloud Random',
        authors: ['Cloud Author'],
        narrators: ['Narrator One'],
        series: null,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'm4b',
        durationSeconds: 3600,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScroller(ScrollerType.RANDOM, user, 20);

    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(dashboardRepo.countRandomBookCandidates).toHaveBeenCalledWith([100], 5, EMPTY_CONTENT_FILTER_RULES);
    expect(warehouseRepo.countRandomUserCatalogItems).not.toHaveBeenCalled();
    expect(dashboardRepo.findRandomBookIds).toHaveBeenCalledWith([100], 5, 20, EMPTY_CONTENT_FILTER_RULES);
    expect(warehouseRepo.listRandomCatalogItems).toHaveBeenCalledWith(20, EMPTY_CONTENT_FILTER_RULES, ['audiobook']);
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 9, title: 'Book 9' }),
        expect.objectContaining({
          id: -2000000101,
          status: 'present',
          title: 'Cloud Random',
          authors: ['Cloud Author'],
          narrators: ['Narrator One'],
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('catalog-source');
  });

  it('returns source-backed random scroller items for cloud-only library users', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 5 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseRepo.listRandomCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        title: 'Cloud Only Random',
        subtitle: null,
        sortTitle: 'Cloud Only Random',
        authors: ['Cloud Author'],
        narrators: [],
        series: null,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScroller(ScrollerType.RANDOM, user, 20);

    expect(dashboardRepo.findRandomBookIds).not.toHaveBeenCalled();
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
    expect(warehouseRepo.countRandomUserCatalogItems).not.toHaveBeenCalled();
    expect(warehouseRepo.listRandomCatalogItems).toHaveBeenCalledWith(20, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(result).toEqual([
      expect.objectContaining({
        id: -1000000101,
        status: 'present',
        title: 'Cloud Only Random',
        authors: ['Cloud Author'],
      }),
    ]);
  });

  it('uses the full source-backed catalog for random discovery when the user has no saved catalog items yet', async () => {
    const { service, dashboardRepo, bookReadService, libraryService, warehouseRepo } = makeService();
    const user = makeUser({ id: 5 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseRepo.listRandomCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-fresh',
        title: 'Fresh Install Pick',
        subtitle: null,
        sortTitle: 'Fresh Install Pick',
        authors: ['Cloud Author'],
        narrators: [],
        series: null,
        genres: [],
        tags: [],
        language: 'en',
        publisher: null,
        identifiers: {},
        format: 'epub',
        durationSeconds: null,
        hasCover: true,
        upstreamCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
        upstreamUpdatedAt: new Date('2025-01-02T00:00:00.000Z'),
        rawPayload: { source: 'catalog-source' },
        syncedAt: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScroller(ScrollerType.RANDOM, user, 20);

    expect(dashboardRepo.countRandomBookCandidates).not.toHaveBeenCalled();
    expect(dashboardRepo.findRandomBookIds).not.toHaveBeenCalled();
    expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
    expect(warehouseRepo.countRandomUserCatalogItems).not.toHaveBeenCalled();
    expect(warehouseRepo.listRandomUserCatalogItems).not.toHaveBeenCalled();
    expect(warehouseRepo.listRandomCatalogItems).toHaveBeenCalledWith(20, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(result).toEqual([
      expect.objectContaining({
        id: -1000000101,
        status: 'present',
        title: 'Fresh Install Pick',
      }),
    ]);
  });

  it('serves source-backed shelves through the batch endpoint too', async () => {
    // The batch path selects numeric book ids out of the books table, so on a
    // source-backed install it returned empty shelves while the single shelf
    // route returned the same content fine. The dashboard only ever calls the
    // batch route, so every shelf on the page was blank.
    const { service, warehouseRepo, libraryService } = makeService();
    const user = makeUser({ id: 8 });
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseRepo.listRecentCatalogItems.mockResolvedValue([
      {
        id: 101,
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        title: 'Dune',
        authors: ['Frank Herbert'],
        format: 'epub',
        hasCover: true,
        rawPayload: {},
        syncedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.getScrollers({ items: [{ id: 'recent', type: 'recently-added', limit: 20 }] }, user);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].failed).toBe(false);
    expect(result.items[0].books.map((book) => book.title)).toEqual(['Dune']);
  });

  it('batches shelf selection and hydrates overlapping books once', async () => {
    const { service, dashboardRepo, bookReadService, libraryService } = makeService();
    const user = makeUser({ id: 8 });
    // Filesystem only, so the batch keeps its shared hydration path.
    libraryService.findAll.mockResolvedValue([{ id: 10 }]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([10]);
    dashboardRepo.findRecentlyAddedBookIds.mockResolvedValue([9, 3]);
    dashboardRepo.findWantToReadBookIds.mockResolvedValue([3, 7]);
    bookReadService.findCardsByBookIds.mockResolvedValue(makeFindCardsResult([3, 7, 9]));

    const result = await service.getScrollers(
      {
        items: [
          { id: 'recent', type: 'recently-added', limit: 20 },
          { id: 'wanted', type: 'want-to-read', limit: 20 },
        ],
      },
      user,
    );

    expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledOnce();
    expect(bookReadService.findCardsByBookIds).toHaveBeenCalledExactlyOnceWith([9, 3, 7], 8);
    expect(result.items.map((item) => ({ id: item.id, ids: item.books.map((book) => book.id), failed: item.failed }))).toEqual([
      { id: 'recent', ids: [9, 3], failed: false },
      { id: 'wanted', ids: [3, 7], failed: false },
    ]);
  });
});
