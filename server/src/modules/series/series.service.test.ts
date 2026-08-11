import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import { SeriesService } from './series.service';

function reqUser(id = 7, superuser = false) {
  return { id, isSuperuser: superuser, permissions: [], contentFilters: undefined } as any;
}

function syntheticSeriesId(name: string): number {
  let hash = 0;
  const normalized = name.trim().toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }
  return -Math.max(1, Math.abs(hash));
}

describe('SeriesService', () => {
  const seriesRepo = {
    findPage: vi.fn(),
    findSummaries: vi.fn(),
    findDetail: vi.fn(),
    findBookIds: vi.fn(),
    countSeries: vi.fn(),
  };

  const bookReadService = {
    findCardsByBookIds: vi.fn(),
  };

  const libraryService = {
    findAll: vi.fn(),
    findAccessibleLibraryIds: vi.fn(),
  };

  const warehouseCatalogService = {
    listSeriesSummaries: vi.fn(),
    listSeriesSummaryPage: vi.fn(),
    listSeriesItems: vi.fn(),
    listSeriesBooks: vi.fn(),
  };

  let service: SeriesService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new (SeriesService as any)(seriesRepo as any, bookReadService as any, libraryService as any, warehouseCatalogService as any);
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    warehouseCatalogService.listSeriesSummaries.mockResolvedValue([]);
    warehouseCatalogService.listSeriesSummaryPage.mockResolvedValue({ rows: [], total: 0, page: 0, size: 50 });
    warehouseCatalogService.listSeriesItems.mockResolvedValue({ items: [], total: 0 });
    warehouseCatalogService.listSeriesBooks.mockResolvedValue({ items: [], total: 0 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);
  });

  describe('countAll', () => {
    it('counts series across the accessible libraries with the user content filters', async () => {
      seriesRepo.countSeries.mockResolvedValue(1200);

      await expect(service.countAll(reqUser())).resolves.toBe(1200);
      expect(seriesRepo.countSeries).toHaveBeenCalledWith({ libraryIds: [1, 2], contentFilters: undefined });
    });

    it('skips the query when the user has no library access', async () => {
      libraryService.findAccessibleLibraryIds.mockResolvedValue([]);

      await expect(service.countAll(reqUser())).resolves.toBe(0);
      expect(seriesRepo.countSeries).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns empty page when user has no library access', async () => {
      libraryService.findAll.mockResolvedValue([]);
      const result = await service.findAll(reqUser(), { page: 0, size: 50 });
      expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
      expect(seriesRepo.findSummaries).not.toHaveBeenCalled();
      expect(warehouseCatalogService.listSeriesSummaries).not.toHaveBeenCalled();
      expect(libraryService.findAll).toHaveBeenCalledWith(reqUser(), { includeSourceBacked: true });
    });

    it('still lists warehouse-backed series when the user has only source-backed libraries', async () => {
      libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
      warehouseCatalogService.listSeriesSummaryPage.mockResolvedValue({
        rows: [
          {
            name: 'Cloud Only',
            bookCount: 2,
            readCount: 0,
            authors: ['Orbit Author'],
            coverBookIds: [],
            lastAddedAt: '2026-04-01 00:00:00',
          },
        ],
        total: 1,
        page: 0,
        size: 50,
      });

      const result = await service.findAll(reqUser(), { page: 0, size: 50 });

      expect(seriesRepo.findSummaries).not.toHaveBeenCalled();
      expect(warehouseCatalogService.listSeriesSummaryPage).toHaveBeenCalledWith({
        q: undefined,
        author: undefined,
        userId: 7,
        contentFilters: undefined,
        mediaType: 'ebook',
        page: 0,
        size: 50,
        sort: 'name',
        order: 'asc',
        completionStatus: undefined,
      });
      expect(result).toEqual({
        items: [
          {
            id: expect.any(Number),
            name: 'Cloud Only',
            bookCount: 2,
            readCount: 0,
            authors: ['Orbit Author'],
            coverBookIds: [],
            lastAddedAt: '2026-04-01 00:00:00',
          },
        ],
        total: 1,
        page: 0,
        size: 50,
      });
    });

    it('delegates to repository with correct params', async () => {
      seriesRepo.findSummaries.mockResolvedValue([
        {
          name: 'Harry Potter',
          bookCount: 7,
          readCount: 3,
          authors: ['J.K. Rowling'],
          coverBookIds: [1, 2, 3, 4],
          lastAddedAt: '2024-01-01 00:00:00',
        },
      ]);

      const result = await service.findAll(reqUser(), { sort: 'bookCount', order: 'desc' });

      expect(seriesRepo.findSummaries).toHaveBeenCalledWith(
        expect.objectContaining({
          libraryIds: [1, 2],
          userId: 7,
          contentFilters: undefined,
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.name).toBe('Harry Potter');
      expect(result.items[0]!.lastAddedAt).toBe('2024-01-01 00:00:00');
    });

    it('scopes to specific library when libraryId provided', async () => {
      seriesRepo.findSummaries.mockResolvedValue([]);
      await service.findAll(reqUser(), { libraryId: 2 });
      expect(seriesRepo.findSummaries).toHaveBeenCalledWith(expect.objectContaining({ libraryIds: [2], contentFilters: undefined }));
      expect(warehouseCatalogService.listSeriesSummaries).not.toHaveBeenCalled();
    });

    it('scopes virtual ebook library filters to warehouse ebook rows', async () => {
      libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
      warehouseCatalogService.listSeriesSummaryPage.mockResolvedValue({
        rows: [{ name: 'Cloud Series', bookCount: 1, readCount: 0, authors: [], coverBookIds: [], lastAddedAt: null }],
        total: 1,
        page: 0,
        size: 50,
      });

      const result = await service.findAll(reqUser(), { libraryId: CLOUD_EBOOK_LIBRARY_ID });

      expect(seriesRepo.findSummaries).not.toHaveBeenCalled();
      expect(warehouseCatalogService.listSeriesSummaryPage).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: 'ebook',
          userId: 7,
          page: 0,
          size: 50,
        }),
      );
      expect(result.total).toBe(1);
    });

    it('returns empty when scoped library is inaccessible', async () => {
      const result = await service.findAll(reqUser(), { libraryId: 99 });
      expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
    });

    it('rejects deep pagination', async () => {
      await expect(service.findAll(reqUser(), { page: 10000, size: 100 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('converts null lastAddedAt to null', async () => {
      seriesRepo.findSummaries.mockResolvedValue([{ name: 'Test', bookCount: 1, readCount: 0, authors: [], coverBookIds: [], lastAddedAt: null }]);

      const result = await service.findAll(reqUser(), {});
      expect(result.items[0]!.lastAddedAt).toBeNull();
    });

    it('includes warehouse-backed series in the normal series page', async () => {
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      seriesRepo.findSummaries.mockResolvedValue([
        {
          name: 'Dune',
          bookCount: 2,
          readCount: 1,
          authors: ['Herbert, Frank'],
          coverBookIds: [10, 11],
          lastAddedAt: '2026-01-01 00:00:00',
        },
      ]);
      warehouseCatalogService.listSeriesSummaries.mockResolvedValue([
        {
          name: 'Dune',
          bookCount: 1,
          readCount: 0,
          authors: ['Frank Herbert'],
          coverBookIds: [],
          lastAddedAt: '2026-02-01 00:00:00',
        },
        {
          name: 'The Murderbot Diaries',
          bookCount: 2,
          readCount: 1,
          authors: ['Martha Wells'],
          coverBookIds: [],
          lastAddedAt: '2026-03-01 00:00:00',
        },
      ]);

      const result = await service.findAll(reqUser(), { page: 0, size: 10, sort: 'name', order: 'asc' });

      expect(warehouseCatalogService.listSeriesSummaries).toHaveBeenCalledWith({
        q: undefined,
        author: undefined,
        userId: 7,
        contentFilters: undefined,
        mediaType: 'ebook',
      });
      expect(result.total).toBe(2);
      expect(result.items).toEqual([
        {
          id: syntheticSeriesId('Dune'),
          name: 'Dune',
          bookCount: 3,
          readCount: 1,
          authors: ['Herbert, Frank'],
          coverBookIds: [10, 11],
          lastAddedAt: '2026-02-01 00:00:00',
        },
        {
          id: syntheticSeriesId('The Murderbot Diaries'),
          name: 'The Murderbot Diaries',
          bookCount: 2,
          readCount: 1,
          authors: ['Martha Wells'],
          coverBookIds: [],
          lastAddedAt: '2026-03-01 00:00:00',
        },
      ]);
    });

    it('filters completion status after local and warehouse series are merged', async () => {
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      seriesRepo.findSummaries.mockResolvedValue([
        {
          name: 'Shared',
          bookCount: 1,
          readCount: 1,
          authors: [],
          coverBookIds: [],
          lastAddedAt: null,
        },
      ]);
      warehouseCatalogService.listSeriesSummaries.mockResolvedValue([
        {
          name: 'Shared',
          bookCount: 1,
          readCount: 0,
          authors: [],
          coverBookIds: [],
          lastAddedAt: null,
        },
      ]);

      const result = await service.findAll(reqUser(), { completionStatus: 'in_progress' });

      expect(seriesRepo.findSummaries).toHaveBeenCalledWith(expect.not.objectContaining({ completionStatus: expect.anything() }));
      expect(result.items).toEqual([
        {
          id: syntheticSeriesId('Shared'),
          name: 'Shared',
          bookCount: 2,
          readCount: 1,
          authors: [],
          coverBookIds: [],
          lastAddedAt: null,
        },
      ]);
    });
  });

  describe('findBooks', () => {
    it('throws NotFoundException when no libraries accessible', async () => {
      libraryService.findAll.mockResolvedValue([]);
      await expect(service.findBooks(reqUser(), 42, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when series not found', async () => {
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });
      await expect(service.findBooks(reqUser(), 42, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns warehouse-backed items for a warehouse-only series', async () => {
      libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });
      warehouseCatalogService.listSeriesSummaries.mockResolvedValue([
        {
          name: 'Dune',
          bookCount: 1,
          readCount: 0,
          authors: ['Frank Herbert'],
          coverBookIds: [],
          lastAddedAt: null,
        },
      ]);
      const bookCard = {
        id: -1000000001,
        status: 'present',
        title: 'Dune',
        seriesName: 'Dune',
        authors: ['Frank Herbert'],
        hasCover: true,
        addedAt: '2026-01-01T00:00:00.000Z',
      };
      warehouseCatalogService.listSeriesBooks.mockResolvedValue({
        items: [bookCard],
        total: 1,
      });

      const result = await service.findBooks(reqUser(), syntheticSeriesId('Dune'), {});

      expect(warehouseCatalogService.listSeriesBooks).toHaveBeenCalledWith({
        seriesName: 'Dune',
        userId: 7,
        page: 0,
        size: 50,
        sort: 'seriesIndex',
        order: 'asc',
        contentFilters: undefined,
        mediaType: 'ebook',
      });
      expect(result.seriesInfo).toEqual({
        id: syntheticSeriesId('Dune'),
        name: 'Dune',
        bookCount: 1,
        readCount: 0,
        authors: ['Frank Herbert'],
        expectedBookCount: null,
        possibleGaps: [],
      });
      expect(result.items).toEqual([bookCard]);
      expect(result.total).toBe(1);
    });

    it('detects possible gaps from warehouse-backed series indices', async () => {
      libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });
      warehouseCatalogService.listSeriesSummaries.mockResolvedValue([
        {
          name: 'Cloud Sequence',
          bookCount: 2,
          readCount: 0,
          authors: ['Ada Writer'],
          coverBookIds: [],
          lastAddedAt: null,
        },
      ]);
      warehouseCatalogService.listSeriesBooks.mockResolvedValue({
        items: [
          {
            id: -1000000001,
            status: 'present',
            title: 'Cloud Volume One',
            seriesName: 'Cloud Sequence',
            seriesIndex: 1,
            authors: ['Ada Writer'],
            hasCover: false,
          },
          {
            id: -1000000003,
            status: 'present',
            title: 'Cloud Volume Three',
            seriesName: 'Cloud Sequence',
            seriesIndex: 3,
            authors: ['Ada Writer'],
            hasCover: false,
          },
        ],
        total: 2,
      });

      const result = await service.findBooks(reqUser(), syntheticSeriesId('Cloud Sequence'), {});

      expect(result.seriesInfo.possibleGaps).toEqual([2]);
    });

    it('merges local and warehouse-backed series detail into one sorted page', async () => {
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      seriesRepo.findDetail.mockResolvedValue({
        id: 42,
        name: 'Mixed',
        bookCount: 2,
        readCount: 0,
        authors: ['Burrell, Teresa'],
        indices: [],
      });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [10, 11], total: 2 });
      bookReadService.findCardsByBookIds.mockResolvedValue({
        rows: [
          {
            id: 10,
            status: 'present',
            folderPath: '/a',
            addedAt: new Date('2026-01-02T00:00:00.000Z'),
            title: 'Beta',
            seriesName: 'Mixed',
            seriesIndex: null,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
          {
            id: 11,
            status: 'present',
            folderPath: '/b',
            addedAt: new Date('2026-01-04T00:00:00.000Z'),
            title: 'Delta',
            seriesName: 'Mixed',
            seriesIndex: null,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
        ],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 2,
      });
      warehouseCatalogService.listSeriesBooks.mockResolvedValue({
        items: [
          {
            id: -1000000101,
            status: 'present',
            title: 'Alpha',
            seriesName: 'Mixed',
            authors: ['Teresa Burrell'],
            hasCover: false,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: -2000000102,
            status: 'present',
            title: 'Charlie',
            seriesName: 'Mixed',
            authors: ['Teresa Burrell'],
            hasCover: false,
            addedAt: '2026-01-03T00:00:00.000Z',
          },
        ],
        total: 2,
      });

      const result = await service.findBooks(reqUser(), 42, { page: 0, size: 2, sort: 'title', order: 'asc' });

      expect(seriesRepo.findBookIds).toHaveBeenCalledWith(expect.objectContaining({ page: 0, size: 2 }));
      expect(warehouseCatalogService.listSeriesBooks).toHaveBeenCalledWith(expect.objectContaining({ page: 0, size: 2 }));
      expect(result.total).toBe(4);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((item: any) => item.title)).toEqual(['Alpha', 'Beta']);
      expect(result.seriesInfo.authors).toEqual(['Burrell, Teresa']);
    });

    it('sorts source-backed series items by native series index alongside local books', async () => {
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      seriesRepo.findDetail.mockResolvedValue({
        id: 42,
        name: 'Mixed',
        bookCount: 1,
        readCount: 0,
        authors: ['Local Author'],
        indices: [2],
      });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [10], total: 1 });
      bookReadService.findCardsByBookIds.mockResolvedValue({
        rows: [
          {
            id: 10,
            status: 'present',
            folderPath: '/a',
            addedAt: new Date('2026-01-02T00:00:00.000Z'),
            title: 'Local Volume Two',
            seriesName: 'Mixed',
            seriesIndex: 2,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
        ],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 1,
      });
      warehouseCatalogService.listSeriesBooks.mockResolvedValue({
        items: [
          {
            id: -1000000001,
            status: 'present',
            title: 'Cloud Volume One',
            seriesName: 'Mixed',
            seriesIndex: 1,
            authors: ['Cloud Author'],
            hasCover: false,
            addedAt: '2026-01-01T00:00:00.000Z',
          } as any,
        ],
        total: 1,
      });

      const result = await service.findBooks(reqUser(), 42, { page: 0, size: 2, sort: 'seriesIndex', order: 'asc' });

      expect(result.items.map((item: any) => item.title)).toEqual(['Cloud Volume One', 'Local Volume Two']);
    });

    it('returns books with series info and gap detection', async () => {
      seriesRepo.findDetail.mockResolvedValue({
        id: 42,
        name: 'Dune',
        bookCount: 3,
        readCount: 1,
        authors: ['Frank Herbert'],
        indices: [1, 2, 4],
      });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [10, 11, 12], total: 3 });
      bookReadService.findCardsByBookIds.mockResolvedValue({
        rows: [
          {
            id: 10,
            status: 'present',
            folderPath: '/a',
            addedAt: new Date(),
            title: 'Dune',
            seriesName: 'Dune',
            seriesIndex: 1,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
          {
            id: 11,
            status: 'present',
            folderPath: '/b',
            addedAt: new Date(),
            title: 'Dune Messiah',
            seriesName: 'Dune',
            seriesIndex: 2,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
          {
            id: 12,
            status: 'present',
            folderPath: '/c',
            addedAt: new Date(),
            title: 'Children of Dune',
            seriesName: 'Dune',
            seriesIndex: 4,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
        ],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 3,
      });

      const result = await service.findBooks(reqUser(), 42, {});

      expect(result.seriesInfo.possibleGaps).toEqual([3]);
      expect(result.seriesInfo.authors).toEqual(['Frank Herbert']);
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('preserves book order from repository', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Test', bookCount: 2, readCount: 0, authors: [], indices: [1, 2] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [20, 10], total: 2 });
      bookReadService.findCardsByBookIds.mockResolvedValue({
        rows: [
          {
            id: 10,
            status: 'present',
            folderPath: '/a',
            addedAt: new Date(),
            title: 'B',
            seriesName: 'Test',
            seriesIndex: 2,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
          {
            id: 20,
            status: 'present',
            folderPath: '/b',
            addedAt: new Date(),
            title: 'A',
            seriesName: 'Test',
            seriesIndex: 1,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
          },
        ],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 2,
      });

      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.items[0]!.id).toBe(20);
      expect(result.items[1]!.id).toBe(10);
    });

    it('handles empty book list gracefully', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Empty', bookCount: 0, readCount: 0, authors: [], indices: [] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.items).toEqual([]);
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('rejects deep pagination', async () => {
      await expect(service.findBooks(reqUser(), 42, { page: 10000, size: 100 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('content filter enforcement', () => {
    it('passes contentFilters to findSummaries for non-superuser', async () => {
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      seriesRepo.findSummaries.mockResolvedValue([]);

      await service.findAll({ ...reqUser(), contentFilters: EMPTY_CONTENT_FILTER_RULES }, {});

      expect(seriesRepo.findSummaries).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
      expect(warehouseCatalogService.listSeriesSummaries).toHaveBeenCalledWith(
        expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }),
      );
    });

    it('passes undefined to findSummaries for superuser', async () => {
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      seriesRepo.findSummaries.mockResolvedValue([]);

      await service.findAll({ ...reqUser(7, true), contentFilters: EMPTY_CONTENT_FILTER_RULES }, {});

      expect(seriesRepo.findSummaries).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
      expect(warehouseCatalogService.listSeriesSummaries).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
    });

    it('passes contentFilters to findDetail and findBookIds for non-superuser', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Dune', bookCount: 0, readCount: 0, authors: [], indices: [] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await service.findBooks({ ...reqUser(), contentFilters: EMPTY_CONTENT_FILTER_RULES }, 42, {});

      expect(seriesRepo.findDetail).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
      expect(seriesRepo.findBookIds).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
    });

    it('passes undefined to findDetail and findBookIds for superuser', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'Dune', bookCount: 0, readCount: 0, authors: [], indices: [] });
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await service.findBooks({ ...reqUser(7, true), contentFilters: EMPTY_CONTENT_FILTER_RULES }, 42, {});

      expect(seriesRepo.findDetail).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
      expect(seriesRepo.findBookIds).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
    });
  });

  describe('findBooks - library filter empty state', () => {
    it('returns empty state when series exists in another library', async () => {
      seriesRepo.findDetail
        .mockResolvedValueOnce(null) // first call with scoped library [2]
        .mockResolvedValueOnce({ id: 42, name: 'Dune', bookCount: 5, readCount: 2, authors: ['Frank Herbert'], indices: [1, 2, 3, 4, 5] }); // second call with all libraries [1, 2]
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      const result = await service.findBooks(reqUser(), 42, { libraryId: 2 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.seriesInfo.name).toBe('Dune');
      expect(result.seriesInfo.authors).toEqual(['Frank Herbert']);
      expect(result.seriesInfo.possibleGaps).toEqual([]);
      expect(result.seriesInfo.bookCount).toBe(0);
    });

    it('throws 404 when series does not exist in any library', async () => {
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await expect(service.findBooks(reqUser(), 42, { libraryId: 1 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when no library filter and series not found', async () => {
      seriesRepo.findDetail.mockResolvedValue(null);
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });

      await expect(service.findBooks(reqUser(), 42, {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('computeGaps edge cases', () => {
    beforeEach(() => {
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });
    });

    it('returns empty gaps when all indices are non-integer', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 3, readCount: 0, authors: [], indices: [0.5, 1.5, 2.5] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('returns empty gaps when min index < 1', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 2, readCount: 0, authors: [], indices: [0, 5] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('returns empty gaps when max index > 10000', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 2, readCount: 0, authors: [], indices: [1, 10001] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });

    it('handles duplicate indices', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 3, readCount: 0, authors: [], indices: [1, 1, 3] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([2]);
    });

    it('handles empty indices array', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 0, readCount: 0, authors: [], indices: [] });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.possibleGaps).toEqual([]);
    });
  });

  describe('computeGaps with a provider expected book count', () => {
    beforeEach(() => {
      seriesRepo.findBookIds.mockResolvedValue({ bookIds: [], total: 0 });
    });

    async function gapsFor(indices: number[], bookCount: number, expectedBookCount: number | null) {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount, readCount: 0, authors: [], indices, expectedBookCount });
      const result = await service.findBooks(reqUser(), 42, {});
      return result.seriesInfo.possibleGaps;
    }

    it('reports books past the highest owned index, which is the whole point of the total', async () => {
      expect(await gapsFor([1, 2, 4], 3, 7)).toEqual([3, 5, 6, 7]);
    });

    it('reports the books below the lowest owned index', async () => {
      expect(await gapsFor([4], 1, 5)).toEqual([1, 2, 3, 5]);
    });

    it('reports no gaps for a complete series', async () => {
      expect(await gapsFor([1, 2, 3], 3, 3)).toEqual([]);
    });

    it('still reports gaps for a single owned book, which the interior-only rule cannot', async () => {
      expect(await gapsFor([2], 1, 3)).toEqual([1, 3]);
      expect(await gapsFor([2], 1, null)).toEqual([]);
    });

    it('exposes the expected count on the series payload', async () => {
      seriesRepo.findDetail.mockResolvedValue({
        id: 42,
        name: 'S',
        bookCount: 1,
        readCount: 0,
        authors: [],
        indices: [1],
        expectedBookCount: 7,
      });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.expectedBookCount).toBe(7);
    });

    it('reports null when no provider has supplied a total', async () => {
      seriesRepo.findDetail.mockResolvedValue({ id: 42, name: 'S', bookCount: 1, readCount: 0, authors: [], indices: [1], expectedBookCount: null });
      const result = await service.findBooks(reqUser(), 42, {});
      expect(result.seriesInfo.expectedBookCount).toBeNull();
    });

    describe('distrusting the total rather than naming a book missing wrongly', () => {
      it('falls back to interior gaps when a book has no series index', async () => {
        // Four books but only three numbered: the unnumbered one could be any of #4 to #7.
        expect(await gapsFor([1, 2, 5], 4, 7)).toEqual([3, 4]);
      });

      it('falls back to interior gaps when a book has a fractional index', async () => {
        expect(await gapsFor([1, 2.5, 4], 3, 7)).toEqual([2, 3]);
      });

      it('falls back when an owned book is numbered past the provider total', async () => {
        expect(await gapsFor([1, 2, 9], 3, 7)).toEqual([3, 4, 5, 6, 7, 8]);
      });

      it('ignores a total of zero or below', async () => {
        expect(await gapsFor([1, 3], 2, 0)).toEqual([2]);
        expect(await gapsFor([1, 3], 2, -5)).toEqual([2]);
      });

      it('ignores a total beyond the ceiling so gap enumeration stays bounded', async () => {
        expect(await gapsFor([1, 3], 2, 10_001)).toEqual([2]);
      });

      it('ignores a fractional total', async () => {
        expect(await gapsFor([1, 3], 2, 4.5)).toEqual([2]);
      });
    });

    it('counts duplicate editions of one entry as a single owned position', async () => {
      // Two files for #1 plus #3: bookCount 3 matches the three index rows, so the total is trusted.
      expect(await gapsFor([1, 1, 3], 3, 4)).toEqual([2, 4]);
    });
  });
});
