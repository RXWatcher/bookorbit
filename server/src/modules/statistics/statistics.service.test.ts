import type { RequestUser } from '../../common/types/request-user';
import { StatisticsService } from './statistics.service';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(isSuperuser = false): RequestUser {
  return {
    id: 42,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const repo = {
    formatDistribution: vi.fn(),
    languageDistribution: vi.fn(),
    booksAddedOverTime: vi.fn(),
    metadataScoreDistribution: vi.fn(),
    libraryMetadataCompleteness: vi.fn(),
    formatShareOverTime: vi.fn(),
    pageCountDistributionByFormat: vi.fn(),
    storageByFormat: vi.fn(),
    publicationDecade: vi.fn(),
    publicationYearTimeline: vi.fn(),
    topAuthors: vi.fn(),
    metadataCompleteness: vi.fn(),
    genreDistribution: vi.fn(),
    metadataFreshnessGauge: vi.fn(),
    libraryIntegrityGauge: vi.fn(),
    acquisitionLagScatter: vi.fn(),
    getSummary: vi.fn(),
    getSummaryDimensionValues: vi.fn().mockResolvedValue({ authors: [], series: [], publishers: [], genres: [], languages: [] }),
    getGenreCooccurrence: vi.fn(),
    largestBooks: vi.fn(),
    topSeries: vi.fn(),
  };
  const libraryService = {
    findAll: vi.fn().mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]),
  };
  const warehouseCatalogService = {
    getUserCatalogStatisticsSummary: vi.fn().mockResolvedValue({
      totalBooks: 0,
      totalAuthors: 0,
      totalSeries: 0,
      totalPublishers: 0,
      totalStorageBytes: 0,
      totalGenres: 0,
      totalLanguages: 0,
      publicationYearMin: null,
      publicationYearMax: null,
      booksAddedThisYear: 0,
    }),
    getUserCatalogStatisticsDimensionValues: vi.fn().mockResolvedValue({ authors: [], series: [], publishers: [], genres: [], languages: [] }),
    metadataScoreDistribution: vi.fn().mockResolvedValue({
      bins: [],
      unknownCount: 0,
      totalCount: 0,
      percentile25: null,
      percentile50: null,
      percentile75: null,
      percentile90: null,
    }),
    formatDistribution: vi.fn().mockResolvedValue([]),
    languageDistribution: vi.fn().mockResolvedValue({ items: [], unknownCount: 0 }),
    booksAddedOverTime: vi.fn().mockResolvedValue([]),
    formatShareOverTime: vi.fn().mockResolvedValue([]),
    libraryMetadataCompleteness: vi.fn().mockResolvedValue([]),
    metadataFreshnessGauge: vi.fn().mockResolvedValue({
      totalBooks: 0,
      neverFetchedCount: 0,
      fresh30dCount: 0,
      stale31To90dCount: 0,
      stale91To180dCount: 0,
      staleOver180dCount: 0,
    }),
    libraryIntegrityGauge: vi.fn().mockResolvedValue({
      totalBooks: 0,
      presentCount: 0,
      primaryFileCount: 0,
      metadataCount: 0,
    }),
    acquisitionLagScatter: vi.fn().mockResolvedValue({ items: [], unknownCount: 0 }),
    getGenreCooccurrence: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    pageCountDistributionByFormat: vi.fn().mockResolvedValue({ items: [], unknownCount: 0 }),
    storageByFormat: vi.fn().mockResolvedValue([]),
    publicationDecade: vi.fn().mockResolvedValue({ items: [], unknownCount: 0 }),
    publicationYearTimeline: vi.fn().mockResolvedValue({ items: [], unknownCount: 0 }),
    largestBooks: vi.fn().mockResolvedValue([]),
    topUserCatalogAuthors: vi.fn().mockResolvedValue([]),
    topUserCatalogGenres: vi.fn().mockResolvedValue({ items: [], unknownCount: 0 }),
    topUserCatalogSeries: vi.fn().mockResolvedValue([]),
  };

  return {
    repo,
    libraryService,
    warehouseCatalogService,
    service: new StatisticsService(repo as never, libraryService as never, warehouseCatalogService as never),
  };
}

describe('StatisticsService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clips format distribution to top N and aggregates the remaining counts as Other', async () => {
    const { service, repo } = makeService();
    repo.formatDistribution.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        format: `f${index + 1}`,
        count: index + 1,
      })),
    );

    const result = await service.getFormatDistribution(makeUser(), {});

    expect(result.unknownCount).toBe(0);
    expect(result.items).toHaveLength(11);
    expect(result.items[10]).toEqual({ format: 'Other', count: 23 });
  });

  it('drops null formats from distribution payload mapping', async () => {
    const { service, repo } = makeService();
    repo.formatDistribution.mockResolvedValue([
      { format: 'epub', count: 4 },
      { format: null, count: 99 },
      { format: 'pdf', count: 3 },
    ]);

    const result = await service.getFormatDistribution(makeUser(), {});

    expect(result.items).toEqual([
      { format: 'epub', count: 4 },
      { format: 'pdf', count: 3 },
    ]);
  });

  it('fills metadata score bins from 0-100 and preserves percentile metrics', async () => {
    const { service, repo } = makeService();
    repo.metadataScoreDistribution.mockResolvedValue({
      bins: [
        { minScore: 0, count: 2 },
        { minScore: 20, count: 5 },
        { minScore: 90, count: 1 },
      ],
      unknownCount: 7,
      totalCount: 8,
      percentile25: 10,
      percentile50: 25,
      percentile75: 40,
      percentile90: 90,
    });

    const result = await service.getMetadataScoreDistribution(makeUser(), {});

    expect(result.bins).toHaveLength(10);
    expect(result.bins[0]).toEqual({ minScore: 0, maxScore: 9, count: 2 });
    expect(result.bins[1]).toEqual({ minScore: 10, maxScore: 19, count: 0 });
    expect(result.bins[2]).toEqual({ minScore: 20, maxScore: 29, count: 5 });
    expect(result.bins[9]).toEqual({ minScore: 90, maxScore: 100, count: 1 });
    expect(result.percentile90).toBe(90);
    expect(result.unknownCount).toBe(7);
  });

  it('merges metadata score distribution rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.metadataScoreDistribution.mockResolvedValue({
      bins: [
        { minScore: 0, count: 1 },
        { minScore: 80, count: 1 },
      ],
      unknownCount: 1,
      totalCount: 2,
      percentile25: 5,
      percentile50: 45,
      percentile75: 65,
      percentile90: 74,
    });
    warehouseCatalogService.metadataScoreDistribution.mockResolvedValue({
      bins: [{ minScore: 20, count: 2 }],
      unknownCount: 3,
      totalCount: 2,
      percentile25: 25,
      percentile50: 25,
      percentile75: 25,
      percentile90: 25,
    });

    const result = await service.getMetadataScoreDistribution(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] });

    expect(result.bins).toHaveLength(10);
    expect(result.bins[0]).toEqual({ minScore: 0, maxScore: 9, count: 1 });
    expect(result.bins[2]).toEqual({ minScore: 20, maxScore: 29, count: 2 });
    expect(result.bins[8]).toEqual({ minScore: 80, maxScore: 89, count: 1 });
    expect(result.totalCount).toBe(4);
    expect(result.unknownCount).toBe(4);
    expect(result.percentile50).toBe(25);
    expect(repo.metadataScoreDistribution).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.metadataScoreDistribution).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('groups non-top and unknown formats into OTHER in format share over time', async () => {
    const { service, repo } = makeService();
    repo.formatShareOverTime.mockResolvedValue([
      { year: 2025, month: 1, format: 'epub', count: 10 },
      { year: 2025, month: 1, format: 'pdf', count: 9 },
      { year: 2025, month: 1, format: 'cbz', count: 8 },
      { year: 2025, month: 1, format: 'cbr', count: 7 },
      { year: 2025, month: 1, format: 'mobi', count: 6 },
      { year: 2025, month: 1, format: 'azw3', count: 5 },
      { year: 2025, month: 1, format: 'fb2', count: 4 },
      { year: 2025, month: 1, format: 'mp3', count: 3 },
      { year: 2025, month: 1, format: 'flac', count: 2 },
      { year: 2025, month: 1, format: null, count: 1 },
      { year: 2025, month: 1, format: null, count: 2 },
    ]);

    const result = await service.getFormatShareOverTime(makeUser(), {});
    const other = result.items.find((item) => item.format === 'OTHER');

    expect(other).toEqual({ year: 2025, month: 1, format: 'OTHER', count: 5 });
    expect(result.items.some((item) => item.format === 'UNKNOWN')).toBe(false);
  });

  it('merges format share over time rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.formatShareOverTime.mockResolvedValue([
      { year: 2025, month: 1, format: 'epub', count: 2 },
      { year: 2025, month: 2, format: 'pdf', count: 1 },
    ]);
    warehouseCatalogService.formatShareOverTime.mockResolvedValue([
      { year: 2025, month: 1, format: 'EPUB', count: 3 },
      { year: 2025, month: 1, format: 'm4b', count: 4 },
    ]);

    await expect(service.getFormatShareOverTime(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { year: 2025, month: 1, format: 'EPUB', count: 5 },
        { year: 2025, month: 1, format: 'M4B', count: 4 },
        { year: 2025, month: 2, format: 'PDF', count: 1 },
      ],
      unknownCount: 0,
    });

    expect(repo.formatShareOverTime).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.formatShareOverTime).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('reads format share over time from source-backed libraries without querying local repositories', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    warehouseCatalogService.formatShareOverTime.mockResolvedValue([{ year: 2025, month: 3, format: 'mp3', count: 7 }]);

    await expect(service.getFormatShareOverTime(makeUser(), { libraryIds: [CLOUD_AUDIO_LIBRARY_ID] })).resolves.toEqual({
      items: [{ year: 2025, month: 3, format: 'MP3', count: 7 }],
      unknownCount: 0,
    });

    expect(repo.formatShareOverTime).not.toHaveBeenCalled();
    expect(warehouseCatalogService.formatShareOverTime).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['audiobook']);
  });

  it('clips storage by format and aggregates tail size into Other bucket', async () => {
    const { service, repo } = makeService();
    repo.storageByFormat.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        format: `f${index + 1}`,
        sizeBytes: index + 1,
      })),
    );

    const result = await service.getStorageByFormat(makeUser(), {});

    expect(result.items).toHaveLength(11);
    expect(result.items[10]).toEqual({ format: 'Other', sizeBytes: 23 });
  });

  it('merges storage-by-format rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.storageByFormat.mockResolvedValue([
      { format: 'epub', sizeBytes: 100 },
      { format: 'pdf', sizeBytes: 200 },
    ]);
    warehouseCatalogService.storageByFormat.mockResolvedValue([
      { format: 'epub', sizeBytes: 300 },
      { format: 'm4b', sizeBytes: 400 },
    ]);

    await expect(service.getStorageByFormat(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { format: 'epub', sizeBytes: 400 },
        { format: 'm4b', sizeBytes: 400 },
        { format: 'pdf', sizeBytes: 200 },
      ],
      unknownCount: 0,
    });

    expect(repo.storageByFormat).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.storageByFormat).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('adds cached source-backed libraries to library metadata completeness', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.libraryMetadataCompleteness.mockResolvedValue([
      {
        libraryId: 1,
        libraryName: 'Local Library',
        total: 2,
        hasTitle: 2,
        hasCover: 1,
        hasAuthor: 2,
        hasGenre: 1,
        hasTag: 0,
        hasDescription: 1,
        hasPublisher: 1,
        hasYear: 1,
        hasLanguage: 2,
        hasPageCount: 1,
        hasRating: 0,
        hasSeries: 1,
        hasIsbn: 1,
      },
    ]);
    warehouseCatalogService.libraryMetadataCompleteness.mockResolvedValue([
      {
        libraryId: CLOUD_EBOOK_LIBRARY_ID,
        libraryName: 'Ebook Library',
        total: 4,
        hasTitle: 4,
        hasCover: 3,
        hasAuthor: 2,
        hasGenre: 2,
        hasTag: 0,
        hasDescription: 1,
        hasPublisher: 1,
        hasYear: 3,
        hasLanguage: 4,
        hasPageCount: 2,
        hasRating: 1,
        hasSeries: 1,
        hasIsbn: 2,
      },
    ]);

    const result = await service.getLibraryMetadataCompleteness(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] });

    expect(result.items).toContainEqual({
      libraryId: CLOUD_EBOOK_LIBRARY_ID,
      libraryName: 'Ebook Library',
      field: 'Cover',
      presentCount: 3,
      totalCount: 4,
      percent: 75,
    });
    expect(result.items).toContainEqual({
      libraryId: CLOUD_EBOOK_LIBRARY_ID,
      libraryName: 'Ebook Library',
      field: 'Author',
      presentCount: 2,
      totalCount: 4,
      percent: 50,
    });
    expect(result.items).toContainEqual({
      libraryId: 1,
      libraryName: 'Local Library',
      field: 'Cover',
      presentCount: 1,
      totalCount: 2,
      percent: 50,
    });
    expect(repo.libraryMetadataCompleteness).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.libraryMetadataCompleteness).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('merges page-count distribution rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.pageCountDistributionByFormat.mockResolvedValue({
      items: [{ format: 'epub', count: 2, min: 10, q1: 12, median: 20, q3: 30, max: 40 }],
      unknownCount: 1,
    });
    warehouseCatalogService.pageCountDistributionByFormat.mockResolvedValue({
      items: [{ format: 'EPUB', count: 3, min: 15, q1: '18.5', median: '22.5', q3: 31, max: 45 }],
      unknownCount: 2,
    });

    await expect(service.getPageCountDistribution(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { format: 'EPUB', count: 2, min: 10, q1: 12, median: 20, q3: 30, max: 40 },
        { format: 'EPUB', count: 3, min: 15, q1: 18.5, median: 22.5, q3: 31, max: 45 },
      ],
      unknownCount: 3,
    });
    expect(repo.pageCountDistributionByFormat).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.pageCountDistributionByFormat).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('uses shared metadata field definitions for overall completeness and sorts by presence', async () => {
    const { service, repo } = makeService();
    repo.metadataCompleteness.mockResolvedValue({
      total: 20,
      hasTitle: 20,
      hasCover: 19,
      hasAuthor: 18,
      hasDescription: 7,
      hasPublisher: 6,
      hasYear: 5,
      hasLanguage: 4,
      hasPageCount: 3,
      hasRating: 2,
      hasSeries: 1,
      hasIsbn: 0,
      hasGenre: 15,
      hasTag: 14,
    });

    const result = await service.getMetadataCompleteness(makeUser(), {});

    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toEqual({ field: 'Cover', presentCount: 19, totalCount: 20 });
    expect(result.items[9]).toEqual({ field: 'ISBN', presentCount: 0, totalCount: 20 });
    expect(result.items.find((item) => item.field === 'Title')).toBeUndefined();
    expect(result.items.find((item) => item.field === 'Genres')).toBeUndefined();
    expect(result.items.find((item) => item.field === 'Tags')).toBeUndefined();
  });

  it('merges overall metadata completeness from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.metadataCompleteness.mockResolvedValue({
      total: 10,
      hasTitle: 10,
      hasCover: 7,
      hasAuthor: 6,
      hasDescription: 5,
      hasPublisher: 4,
      hasYear: 3,
      hasLanguage: 2,
      hasPageCount: 1,
      hasRating: 0,
      hasSeries: 1,
      hasIsbn: 2,
      hasGenre: 5,
      hasTag: 4,
    });
    warehouseCatalogService.libraryMetadataCompleteness.mockResolvedValue([
      {
        libraryId: CLOUD_EBOOK_LIBRARY_ID,
        libraryName: 'Ebook Library',
        total: 5,
        hasTitle: 5,
        hasCover: 5,
        hasAuthor: 4,
        hasDescription: 3,
        hasPublisher: 2,
        hasYear: 1,
        hasLanguage: 5,
        hasPageCount: 2,
        hasRating: 1,
        hasSeries: 2,
        hasIsbn: 3,
        hasGenre: 4,
        hasTag: 3,
      },
    ]);

    const result = await service.getMetadataCompleteness(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] });

    expect(result.items).toContainEqual({ field: 'Cover', presentCount: 12, totalCount: 15 });
    expect(result.items).toContainEqual({ field: 'Author', presentCount: 10, totalCount: 15 });
    expect(result.items).toContainEqual({ field: 'Language', presentCount: 7, totalCount: 15 });
    expect(result.items.find((item) => item.field === 'Title')).toBeUndefined();
    expect(repo.metadataCompleteness).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.libraryMetadataCompleteness).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('returns zeroed metadata completeness when repository row is unexpectedly missing', async () => {
    const { service, repo } = makeService();
    repo.metadataCompleteness.mockResolvedValue(undefined);

    const result = await service.getMetadataCompleteness(makeUser(), {});

    expect(result.items.every((item) => item.totalCount === 0 && item.presentCount === 0)).toBe(true);
  });

  it('merges metadata freshness gauge rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.metadataFreshnessGauge.mockResolvedValue({
      totalBooks: 10,
      neverFetchedCount: 1,
      fresh30dCount: 4,
      stale31To90dCount: 2,
      stale91To180dCount: 2,
      staleOver180dCount: 1,
    });
    warehouseCatalogService.metadataFreshnessGauge.mockResolvedValue({
      totalBooks: 5,
      neverFetchedCount: 1,
      fresh30dCount: 3,
      stale31To90dCount: 1,
      stale91To180dCount: 0,
      staleOver180dCount: 0,
    });

    await expect(service.getMetadataFreshnessGauge(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      totalBooks: 15,
      neverFetchedCount: 2,
      fresh30dCount: 7,
      stale31To90dCount: 3,
      stale91To180dCount: 2,
      staleOver180dCount: 1,
      freshnessScore: 67,
    });
    expect(repo.metadataFreshnessGauge).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.metadataFreshnessGauge).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('merges library integrity gauge rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.libraryIntegrityGauge.mockResolvedValue({
      totalBooks: 10,
      presentCount: 8,
      primaryFileCount: 7,
      metadataCount: 6,
    });
    warehouseCatalogService.libraryIntegrityGauge.mockResolvedValue({
      totalBooks: 5,
      presentCount: 5,
      primaryFileCount: 4,
      metadataCount: 3,
    });

    await expect(service.getLibraryIntegrityGauge(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      totalBooks: 15,
      presentCount: 13,
      primaryFileCount: 11,
      metadataCount: 9,
      integrityScore: 73,
    });

    await expect(service.getLibraryIntegrityGauge(makeUser(), { libraryIds: [CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      totalBooks: 5,
      presentCount: 5,
      primaryFileCount: 4,
      metadataCount: 3,
      integrityScore: 80,
    });

    expect(repo.libraryIntegrityGauge).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.libraryIntegrityGauge).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('merges acquisition lag scatter rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.acquisitionLagScatter.mockResolvedValue({
      items: [
        { addedYear: 2024, lagYears: 5, count: 2 },
        { addedYear: 2025, lagYears: 1, count: 3 },
      ],
      unknownCount: 1,
    });
    warehouseCatalogService.acquisitionLagScatter.mockResolvedValue({
      items: [
        { addedYear: 2024, lagYears: 5, count: 4 },
        { addedYear: 2026, lagYears: 10, count: 1 },
      ],
      unknownCount: 2,
    });

    await expect(service.getAcquisitionLagScatter(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { addedYear: 2024, lagYears: 5, count: 6 },
        { addedYear: 2025, lagYears: 1, count: 3 },
        { addedYear: 2026, lagYears: 10, count: 1 },
      ],
      unknownCount: 3,
    });

    expect(repo.acquisitionLagScatter).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.acquisitionLagScatter).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('filters invalid largest-books rows with missing required fields', async () => {
    const { service, repo } = makeService();
    repo.largestBooks.mockResolvedValue([
      { id: 1, title: null, sizeBytes: 100, format: 'epub' },
      { id: 2, title: 'Valid Title', sizeBytes: 200, format: null },
      { id: 3, title: 'Another', sizeBytes: 300, format: 'pdf' },
    ]);

    const result = await service.getLargestBooks(makeUser(), {});

    expect(result.items).toEqual([{ id: 3, title: 'Another', sizeBytes: 300, format: 'pdf' }]);
  });

  it('merges largest book rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.largestBooks.mockResolvedValue([
      { id: 1, title: 'Local Small', sizeBytes: 100, format: 'epub' },
      { id: 2, title: 'Local Large', sizeBytes: 500, format: 'pdf' },
    ]);
    warehouseCatalogService.largestBooks.mockResolvedValue([
      { id: 9001, title: 'Source Largest', sizeBytes: 900, format: 'epub' },
      { id: 9002, title: 'Source Medium', sizeBytes: 300, format: 'm4b' },
    ]);

    await expect(service.getLargestBooks(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { id: 9001, title: 'Source Largest', sizeBytes: 900, format: 'epub' },
        { id: 2, title: 'Local Large', sizeBytes: 500, format: 'pdf' },
        { id: 9002, title: 'Source Medium', sizeBytes: 300, format: 'm4b' },
        { id: 1, title: 'Local Small', sizeBytes: 100, format: 'epub' },
      ],
      unknownCount: 0,
    });

    expect(repo.largestBooks).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.largestBooks).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('filters invalid top-series rows with null names', async () => {
    const { service, repo } = makeService();
    repo.topSeries.mockResolvedValue([
      { name: null, count: 5 },
      { name: 'Saga', count: 4 },
    ]);

    const result = await service.getTopSeries(makeUser(), {});

    expect(result.items).toEqual([{ name: 'Saga', count: 4 }]);
  });

  it('merges local and source-backed libraries in the statistics summary', async () => {
    const { service, repo, libraryService, warehouseCatalogService } = makeService();
    repo.getSummary.mockResolvedValue({
      totalBooks: 4,
      totalAuthors: 3,
      totalSeries: 1,
      totalPublishers: 2,
      totalStorageBytes: 1024,
      totalGenres: 2,
      totalLanguages: 1,
      publicationYearMin: 1984,
      publicationYearMax: 2024,
      booksAddedThisYear: 1,
    });
    warehouseCatalogService.getUserCatalogStatisticsSummary.mockResolvedValue({
      totalBooks: 7,
      totalAuthors: 5,
      totalSeries: 2,
      totalPublishers: 3,
      totalStorageBytes: 0,
      totalGenres: 4,
      totalLanguages: 2,
      publicationYearMin: null,
      publicationYearMax: null,
      booksAddedThisYear: 6,
    });
    repo.getSummaryDimensionValues.mockResolvedValue({
      authors: ['Ada', 'Bea', 'Shared', 'Burrell, Teresa'],
      series: ['Local Series'],
      publishers: ['Local Press'],
      genres: ['Mystery'],
      languages: ['en'],
    });
    warehouseCatalogService.getUserCatalogStatisticsDimensionValues.mockResolvedValue({
      authors: ['ada', 'Chen', 'Shared', 'Teresa Burrell'],
      series: ['Local Series', 'Cloud Series'],
      publishers: ['Cloud Press'],
      genres: ['Mystery', 'Sci-Fi'],
      languages: ['EN', 'fr'],
    });

    await expect(service.getSummary(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      totalBooks: 11,
      totalAuthors: 5,
      totalSeries: 2,
      totalPublishers: 2,
      totalStorageBytes: 1024,
      totalGenres: 2,
      totalLanguages: 2,
      publicationYearMin: 1984,
      publicationYearMax: 2024,
      booksAddedThisYear: 7,
    });

    expect(libraryService.findAll).toHaveBeenCalledWith(expect.any(Object), { includeSourceBacked: true });
    expect(repo.getSummary).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(repo.getSummaryDimensionValues).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.getUserCatalogStatisticsSummary).toHaveBeenCalledWith(42, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(warehouseCatalogService.getUserCatalogStatisticsDimensionValues).toHaveBeenCalledWith(42, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('does not fall back to all local statistics when only source-backed libraries are selected', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    warehouseCatalogService.getUserCatalogStatisticsSummary.mockResolvedValue({
      totalBooks: 3,
      totalAuthors: 2,
      totalSeries: 1,
      totalPublishers: 1,
      totalStorageBytes: 0,
      totalGenres: 2,
      totalLanguages: 1,
      publicationYearMin: null,
      publicationYearMax: null,
      booksAddedThisYear: 3,
    });
    warehouseCatalogService.getUserCatalogStatisticsDimensionValues.mockResolvedValue({
      authors: ['Ada', 'Bea'],
      series: ['Series'],
      publishers: ['Press'],
      genres: ['Mystery', 'Sci-Fi'],
      languages: ['en'],
    });

    await expect(service.getSummary(makeUser(), { libraryIds: [CLOUD_AUDIO_LIBRARY_ID] })).resolves.toEqual({
      totalBooks: 3,
      totalAuthors: 2,
      totalSeries: 1,
      totalPublishers: 1,
      totalStorageBytes: 0,
      totalGenres: 2,
      totalLanguages: 1,
      publicationYearMin: null,
      publicationYearMax: null,
      booksAddedThisYear: 3,
    });

    expect(repo.getSummary).not.toHaveBeenCalled();
    expect(repo.getSummaryDimensionValues).not.toHaveBeenCalled();
    expect(warehouseCatalogService.getUserCatalogStatisticsSummary).toHaveBeenCalledWith(42, EMPTY_CONTENT_FILTER_RULES, ['audiobook']);
  });

  it('preserves repository summary counts for local-only library scopes', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.getSummary.mockResolvedValue({
      totalBooks: 4,
      totalAuthors: 3,
      totalSeries: 2,
      totalPublishers: 2,
      totalStorageBytes: 1024,
      totalGenres: 5,
      totalLanguages: 2,
      publicationYearMin: 1984,
      publicationYearMax: 2024,
      booksAddedThisYear: 1,
    });
    repo.getSummaryDimensionValues.mockResolvedValue({
      authors: ['duplicate', 'Duplicate'],
      series: [],
      publishers: [],
      genres: [],
      languages: [],
    });

    await expect(service.getSummary(makeUser(), { libraryIds: [1] })).resolves.toEqual({
      totalBooks: 4,
      totalAuthors: 3,
      totalSeries: 2,
      totalPublishers: 2,
      totalStorageBytes: 1024,
      totalGenres: 5,
      totalLanguages: 2,
      publicationYearMin: 1984,
      publicationYearMax: 2024,
      booksAddedThisYear: 1,
    });

    expect(repo.getSummaryDimensionValues).not.toHaveBeenCalled();
    expect(warehouseCatalogService.getUserCatalogStatisticsSummary).not.toHaveBeenCalled();
    expect(warehouseCatalogService.getUserCatalogStatisticsDimensionValues).not.toHaveBeenCalled();
  });

  it('does not pass virtual library ids into local-only statistics chart queries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    warehouseCatalogService.getUserCatalogStatisticsSummary.mockResolvedValue({
      totalBooks: 1,
      totalAuthors: 0,
      totalSeries: 0,
      totalPublishers: 0,
      totalStorageBytes: 0,
      totalGenres: 0,
      totalLanguages: 0,
      publicationYearMin: null,
      publicationYearMax: null,
      booksAddedThisYear: 1,
    });

    warehouseCatalogService.formatDistribution.mockResolvedValue([
      { format: 'epub', count: 5 },
      { format: 'pdf', count: 2 },
    ]);

    await expect(service.getFormatDistribution(makeUser(), { libraryIds: [CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { format: 'epub', count: 5 },
        { format: 'pdf', count: 2 },
      ],
      unknownCount: 0,
    });
    await expect(service.getLargestBooks(makeUser(), { libraryIds: [CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [],
      unknownCount: 0,
    });
    await expect(service.getGenreCooccurrence(makeUser(), { libraryIds: [CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      nodes: [],
      links: [],
    });

    expect(repo.formatDistribution).not.toHaveBeenCalled();
    expect(repo.largestBooks).not.toHaveBeenCalled();
    expect(repo.getGenreCooccurrence).not.toHaveBeenCalled();
    expect(warehouseCatalogService.formatDistribution).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(warehouseCatalogService.getGenreCooccurrence).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('merges genre co-occurrence nodes and links from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.getGenreCooccurrence.mockResolvedValue({
      nodes: [{ name: 'Mystery' }, { name: 'Thriller' }, { name: 'Fantasy' }],
      links: [
        { source: 'Mystery', target: 'Thriller', value: 2 },
        { source: 'Fantasy', target: 'Mystery', value: 1 },
      ],
    });
    warehouseCatalogService.getGenreCooccurrence.mockResolvedValue({
      nodes: [{ name: 'Mystery' }, { name: 'Thriller' }, { name: 'Sci-Fi' }],
      links: [
        { source: 'Thriller', target: 'Mystery', value: 3 },
        { source: 'Mystery', target: 'Sci-Fi', value: 4 },
      ],
    });

    await expect(service.getGenreCooccurrence(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      nodes: [{ name: 'Mystery' }, { name: 'Thriller' }, { name: 'Fantasy' }, { name: 'Sci-Fi' }],
      links: [
        { source: 'Mystery', target: 'Thriller', value: 5 },
        { source: 'Fantasy', target: 'Mystery', value: 1 },
        { source: 'Mystery', target: 'Sci-Fi', value: 4 },
      ],
    });

    expect(repo.getGenreCooccurrence).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.getGenreCooccurrence).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('merges top author, genre, and series statistic rows from source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.topAuthors.mockResolvedValue([
      { name: 'Ada', count: 2 },
      { name: 'Burrell, Teresa', count: 3 },
      { name: 'Bea', count: 1 },
    ]);
    repo.genreDistribution.mockResolvedValue({ items: [{ genre: 'Mystery', count: 2 }], unknownCount: 1 });
    repo.topSeries.mockResolvedValue([{ name: 'Orbit', count: 3 }]);
    warehouseCatalogService.topUserCatalogAuthors.mockResolvedValue([
      { name: 'Ada', count: 4 },
      { name: 'Teresa Burrell', count: 2 },
      { name: 'Chen', count: 2 },
    ]);
    warehouseCatalogService.topUserCatalogGenres.mockResolvedValue({ items: [{ genre: 'Mystery', count: 5 }], unknownCount: 2 });
    warehouseCatalogService.topUserCatalogSeries.mockResolvedValue([
      { name: 'Orbit', count: 1 },
      { name: 'Deep Space', count: 2 },
    ]);

    await expect(service.getTopAuthors(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { name: 'Ada', count: 6 },
        { name: 'Burrell, Teresa', count: 5 },
        { name: 'Chen', count: 2 },
        { name: 'Bea', count: 1 },
      ],
      unknownCount: 0,
    });
    await expect(service.getGenreDistribution(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [{ genre: 'Mystery', count: 7 }],
      unknownCount: 3,
    });
    await expect(service.getTopSeries(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { name: 'Orbit', count: 4 },
        { name: 'Deep Space', count: 2 },
      ],
      unknownCount: 0,
    });
  });

  it('merges language distribution statistic rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.languageDistribution.mockResolvedValue({ items: [{ language: 'en', count: 2 }], unknownCount: 1 });
    warehouseCatalogService.languageDistribution.mockResolvedValue({
      items: [
        { language: 'en', count: 5 },
        { language: 'fr', count: 3 },
      ],
      unknownCount: 2,
    });

    await expect(service.getLanguageDistribution(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { language: 'en', count: 7 },
        { language: 'fr', count: 3 },
      ],
      unknownCount: 3,
    });

    expect(repo.languageDistribution).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.languageDistribution).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('merges books-added-over-time rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.booksAddedOverTime.mockResolvedValue([
      { year: 2026, month: 4, count: 2 },
      { year: 2026, month: 5, count: 1 },
    ]);
    warehouseCatalogService.booksAddedOverTime.mockResolvedValue([
      { year: 2026, month: 4, count: 5 },
      { year: 2026, month: 6, count: 3 },
    ]);

    await expect(service.getBooksAddedOverTime(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID], granularity: 'monthly' })).resolves.toEqual({
      items: [
        { year: 2026, month: 4, count: 7 },
        { year: 2026, month: 5, count: 1 },
        { year: 2026, month: 6, count: 3 },
      ],
      unknownCount: 0,
    });

    expect(repo.booksAddedOverTime).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1], 'monthly', undefined);
    expect(warehouseCatalogService.booksAddedOverTime).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook'], 'monthly', undefined);
  });

  it('merges publication year statistic rows from cached source-backed libraries', async () => {
    const { service, repo, warehouseCatalogService } = makeService();
    repo.publicationDecade.mockResolvedValue({
      items: [
        { decade: 1990, count: 2 },
        { decade: 2000, count: 1 },
      ],
      unknownCount: 1,
    });
    repo.publicationYearTimeline.mockResolvedValue({
      items: [
        { year: 1999, count: 2, topTitles: ['Local A'] },
        { year: 2001, count: 1, topTitles: ['Local B'] },
      ],
      unknownCount: 1,
    });
    warehouseCatalogService.publicationDecade.mockResolvedValue({
      items: [
        { decade: 1990, count: 3 },
        { decade: 2010, count: 4 },
      ],
      unknownCount: 2,
    });
    warehouseCatalogService.publicationYearTimeline.mockResolvedValue({
      items: [
        { year: 1999, count: 3, topTitles: ['Source A', 'Source B', 'Source C'] },
        { year: 2018, count: 4, topTitles: ['Source D'] },
      ],
      unknownCount: 2,
    });

    await expect(service.getPublicationDecade(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { decade: 1990, count: 5 },
        { decade: 2000, count: 1 },
        { decade: 2010, count: 4 },
      ],
      unknownCount: 3,
    });
    await expect(service.getPublicationYearTimeline(makeUser(), { libraryIds: [1, CLOUD_EBOOK_LIBRARY_ID] })).resolves.toEqual({
      items: [
        { year: 1999, count: 5, topTitles: ['Local A', 'Source A', 'Source B'] },
        { year: 2001, count: 1, topTitles: ['Local B'] },
        { year: 2018, count: 4, topTitles: ['Source D'] },
      ],
      unknownCount: 3,
    });

    expect(repo.publicationDecade).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(repo.publicationYearTimeline).toHaveBeenCalledWith(42, false, EMPTY_CONTENT_FILTER_RULES, [1]);
    expect(warehouseCatalogService.publicationDecade).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
    expect(warehouseCatalogService.publicationYearTimeline).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
  });

  it('reuses cached metadata score distribution for identical scope', async () => {
    const { service, repo } = makeService();
    repo.metadataScoreDistribution.mockResolvedValue({
      bins: [{ minScore: 0, count: 1 }],
      unknownCount: 0,
      totalCount: 1,
      percentile25: 0,
      percentile50: 0,
      percentile75: 0,
      percentile90: 0,
    });

    await service.getMetadataScoreDistribution(makeUser(), { libraryIds: [2, 1] });
    await service.getMetadataScoreDistribution(makeUser(), { libraryIds: [1, 2] });

    expect(repo.metadataScoreDistribution).toHaveBeenCalledTimes(1);
  });
});
