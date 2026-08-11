import type { WarehouseCatalogDetailRow, WarehouseCatalogItemRow, WarehouseSettingRow } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { WarehouseRepository } from './warehouse.repository';
import { WarehouseClientService } from './warehouse-client.service';
import { WarehouseSecretService } from './warehouse-secret.service';
import { WarehouseCatalogService } from './warehouse-catalog.service';
import { WarehouseCatalogCoverCacheService } from './warehouse-catalog-cover-cache.service';

const CREATED_AT = new Date('2026-06-02T10:00:00.000Z');
const UPDATED_AT = new Date('2026-06-02T10:05:00.000Z');
const SYNCED_AT = new Date('2026-06-02T11:00:00.000Z');

const expectedCatalogAuthorRef = (name: string) => ({ id: expect.any(Number), name });
const expectedCatalogSeriesRef = (name: string) => ({ id: expect.any(Number), name });

function makeSettingsRow(overrides: Partial<WarehouseSettingRow> = {}): WarehouseSettingRow {
  return {
    id: 1,
    profileKey: 'default',
    enabled: true,
    baseUrl: 'https://catalog-source.example.test',
    apiKeyEncrypted: 'ciphertext',
    apiKeyNonce: 'nonce',
    apiKeyTag: 'tag',
    syncCadenceMinutes: 360,
    lastConnectionStatus: 'untested',
    lastConnectionCheckedAt: null,
    lastConnectionError: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeCatalogItemRow(overrides: Partial<WarehouseCatalogItemRow> = {}): WarehouseCatalogItemRow {
  return {
    id: 10,
    mediaType: 'ebook',
    remoteId: 'remote-10',
    title: 'A Memory Called Empire',
    subtitle: 'A Novel',
    sortTitle: 'Memory Called Empire, A',
    authors: ['Arkady Martine'],
    narrators: [],
    series: 'Teixcalaan',
    genres: ['Science Fiction'],
    tags: ['space'],
    language: 'en',
    publisher: 'Tor',
    identifiers: { isbn13: '9781250186430' },
    format: 'epub',
    hasCover: true,
    upstreamCreatedAt: null,
    upstreamUpdatedAt: null,
    rawPayload: {
      apiKey: 'do-not-expose',
      debug: true,
    },
    syncedAt: SYNCED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeCatalogDetailRow(overrides: Partial<WarehouseCatalogDetailRow> = {}): WarehouseCatalogDetailRow {
  return {
    id: 90,
    mediaType: 'ebook',
    remoteId: 'remote-10',
    rawPayload: {
      description: 'cached detail payload',
      subjects: ['space opera'],
    },
    fetchedAt: UPDATED_AT,
    ...overrides,
  };
}

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
    contentFilters: null,
    ...overrides,
  };
}

function makeRepo(): jest.Mocked<WarehouseRepository> {
  return {
    findSettings: vi.fn(),
    listEbookCatalog: vi.fn(),
    listAudiobookCatalog: vi.fn(),
    searchCatalogItems: vi.fn(),
    queryUserCatalogItems: vi.fn(),
    queryUserCatalogJumpBuckets: vi.fn(),
    getCatalogLibraryOverview: vi.fn(),
    getUserCatalogLibraryOverview: vi.fn(),
    getUserCatalogStatisticsSummary: vi.fn(),
    getUserCatalogStatisticsDimensionValues: vi.fn(),
    getUserCatalogDiversityData: vi.fn(),
    getUserCatalogYearProjectionData: vi.fn(),
    getUserCatalogReadingDnaData: vi.fn(),
    getUserCatalogChallengePatternData: vi.fn(),
    getUserCatalogNeglectedGems: vi.fn(),
    getUserCatalogLongWait: vi.fn(),
    getUserReadingSurvivalMaxProgress: vi.fn(),
    topUserCatalogAuthors: vi.fn(),
    topUserCatalogGenres: vi.fn(),
    topUserCatalogSeries: vi.fn(),
    listUserCatalogReadingActivityDays: vi.fn(),
    getUserMonthlyCompletions: vi.fn(),
    getUserCompletionLatencyDays: vi.fn(),
    countCompletedUserCatalogItemsThisYear: vi.fn(),
    listCurrentlyReadingUserCatalogItems: vi.fn(),
    countUserCatalogAnnotations: vi.fn(),
    getUserCatalogAnnotationByOffset: vi.fn(),
    listCatalogAuthorSummaries: vi.fn(),
    findCatalogAuthorSummaryById: vi.fn(),
    listCatalogItemsByAuthor: vi.fn(),
    listCatalogItemsBySeries: vi.fn(),
    listEbookCatalogDimensions: vi.fn(),
    listAudiobookCatalogDimensions: vi.fn(),
    findUserCatalogItemById: vi.fn(),
    findAccessibleCatalogItemById: vi.fn(),
    findCatalogItemById: vi.fn(),
    findCatalogItem: vi.fn(),
    findCatalogDetail: vi.fn(),
    getUserCatalogState: vi.fn(),
    upsertUserCatalogState: vi.fn(),
  } as unknown as jest.Mocked<WarehouseRepository>;
}

function makeClient(): jest.Mocked<WarehouseClientService> {
  return {
    downloadBook: vi.fn(),
    getBookCover: vi.fn(),
    getAudiobookCover: vi.fn(),
    streamAudiobook: vi.fn(),
    downloadAudiobook: vi.fn(),
    downloadAudiobookFile: vi.fn(),
    downloadComic: vi.fn(),
    listComicPages: vi.fn(),
    getComicPageImage: vi.fn(),
    listComicSeries: vi.fn(),
    searchComicSeries: vi.fn(),
    listComicSeriesItems: vi.fn(),
  } as unknown as jest.Mocked<WarehouseClientService>;
}

function makeSecret(): jest.Mocked<WarehouseSecretService> {
  return {
    decrypt: vi.fn().mockReturnValue('decrypted-api-key'),
  } as unknown as jest.Mocked<WarehouseSecretService>;
}

function makeCoverCache(): jest.Mocked<WarehouseCatalogCoverCacheService> {
  return {
    readEbookCover: vi.fn(),
    writeEbookCover: vi.fn((_sourceKey, _remoteId, _size, response) => Promise.resolve(response)),
    readAudiobookCover: vi.fn(),
    writeAudiobookCover: vi.fn((_sourceKey, _remoteId, response) => Promise.resolve(response)),
  } as unknown as jest.Mocked<WarehouseCatalogCoverCacheService>;
}

describe('WarehouseCatalogService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let client: ReturnType<typeof makeClient>;
  let secret: ReturnType<typeof makeSecret>;
  let coverCache: ReturnType<typeof makeCoverCache>;
  let service: WarehouseCatalogService;

  beforeEach(() => {
    repo = makeRepo();
    client = makeClient();
    secret = makeSecret();
    coverCache = makeCoverCache();
    service = new WarehouseCatalogService(repo, client, secret, coverCache);
  });

  it('returns an empty page when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.listEbooks({ page: 3, limit: 250 })).resolves.toEqual({
      items: [],
      page: 3,
      limit: 100,
      total: 0,
    });
    expect(repo.listEbookCatalog).not.toHaveBeenCalled();
  });

  it('returns empty audiobook dimensions when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.listAudiobookAuthors()).resolves.toEqual({ items: [], total: 0 });
    await expect(service.listAudiobookNarrators()).resolves.toEqual({ items: [], total: 0 });
    await expect(service.listAudiobookSeries()).resolves.toEqual({ items: [], total: 0 });
    await expect(service.listAudiobookGenres()).resolves.toEqual({ items: [], total: 0 });
    expect(repo.listAudiobookCatalogDimensions).not.toHaveBeenCalled();
  });

  it('returns empty ebook genres when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.listEbookGenres()).resolves.toEqual({ items: [], total: 0 });
    expect(repo.listEbookCatalogDimensions).not.toHaveBeenCalled();
  });

  it('returns empty comic series pages when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.listComicSeries({ page: 3, limit: 250 })).resolves.toEqual({
      items: [],
      page: 3,
      limit: 100,
      total: 0,
      hasNextPage: false,
    });
    await expect(service.searchComicSeries({ q: 'saga', page: 1, limit: 5 })).resolves.toEqual({
      items: [],
      page: 1,
      limit: 5,
      total: 0,
      hasNextPage: false,
    });
    await expect(service.listComicSeriesItems('series 1', { page: 2, limit: 20 })).resolves.toEqual({
      items: [],
      page: 2,
      limit: 20,
      total: 0,
      hasNextPage: false,
    });

    expect(secret.decrypt).not.toHaveBeenCalled();
    expect(client.listComicSeries).not.toHaveBeenCalled();
    expect(client.searchComicSeries).not.toHaveBeenCalled();
    expect(client.listComicSeriesItems).not.toHaveBeenCalled();
  });

  it('delegates comic series browsing to the Book Warehouse client with decrypted catalog settings', async () => {
    const seriesPage = {
      items: [{ id: 'series-1', title: 'Saga', publisher: 'Image', year: 2012 }],
      page: 1,
      limit: 10,
      total: 1,
      hasNextPage: false,
    };
    const itemPage = {
      items: [{ id: 'comic-1', title: 'Saga #1', seriesId: 'series-1', issueNumber: '1', year: 2012 }],
      page: 2,
      limit: 20,
      total: 1,
      hasNextPage: false,
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listComicSeries.mockResolvedValue(seriesPage);
    client.searchComicSeries.mockResolvedValue(seriesPage);
    client.listComicSeriesItems.mockResolvedValue(itemPage);

    await expect(service.listComicSeries({ page: 1, limit: 10 })).resolves.toBe(seriesPage);
    await expect(service.searchComicSeries({ q: 'crossed', page: 1, limit: 5 })).resolves.toBe(seriesPage);
    await expect(service.listComicSeriesItems('series 1', { page: 2, limit: 20 })).resolves.toBe(itemPage);

    expect(client.listComicSeries).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      page: 1,
      limit: 10,
    });
    expect(client.searchComicSeries).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      q: 'crossed',
      page: 1,
      limit: 5,
    });
    expect(client.listComicSeriesItems).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      seriesId: 'series 1',
      page: 2,
      limit: 20,
    });
    expect(repo.findCatalogItem).not.toHaveBeenCalled();
    expect(JSON.stringify(seriesPage)).not.toMatch(/warehouse|upstream|\/media\/|ceph:/i);
  });

  it('wraps comic series upstream failures in safe native error copy', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    client.listComicSeries.mockRejectedValue(new Error('catalog-source https://catalog-source.example.test/media/path apiKey=secret'));

    await expect(service.listComicSeries({})).rejects.toThrow('Library media is temporarily unavailable.');
    await expect(service.listComicSeries({})).rejects.not.toThrow('/media/');
    await expect(service.listComicSeries({})).rejects.not.toThrow('apiKey');
  });

  it('returns empty global search rows when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.searchCatalogItems('dune', 10)).resolves.toEqual([]);
    expect(repo.searchCatalogItems).not.toHaveBeenCalled();
  });

  it('returns an empty library overview when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getLibraryOverview()).resolves.toEqual({
      totalBooks: 0,
      totalAuthors: 0,
      totalSeries: 0,
      totalStorageBytes: 0,
      booksAddedThisYear: 0,
    });
    expect(repo.getCatalogLibraryOverview).not.toHaveBeenCalled();
  });

  it('returns zero completed source-backed books this year when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getCompletedBooksThisYear(42)).resolves.toBe(0);
    expect(repo.countCompletedUserCatalogItemsThisYear).not.toHaveBeenCalled();
  });

  it('returns empty monthly completions when disabled or no media types are available', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getUserMonthlyCompletions(42, undefined, ['ebook'], 120)).resolves.toEqual([]);
    await expect(service.getUserMonthlyCompletions(42, undefined, [], 120)).resolves.toEqual([]);
    expect(repo.getUserMonthlyCompletions).not.toHaveBeenCalled();
  });

  it('returns source-backed monthly completions when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserMonthlyCompletions.mockResolvedValue([
      { year: 2026, month: 3, count: 2 },
      { year: 2026, month: 4, count: 1 },
    ]);
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserMonthlyCompletions(42, contentFilters, ['ebook'], 120)).resolves.toEqual([
      { year: 2026, month: 3, count: 2 },
      { year: 2026, month: 4, count: 1 },
    ]);
    expect(repo.getUserMonthlyCompletions).toHaveBeenCalledWith(42, contentFilters, ['ebook'], 120);
  });

  it('returns empty completion latency values when disabled or no media types are available', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getUserCompletionLatencyDays(42, undefined, ['ebook'], 365)).resolves.toEqual([]);
    await expect(service.getUserCompletionLatencyDays(42, undefined, [], 365)).resolves.toEqual([]);
    expect(repo.getUserCompletionLatencyDays).not.toHaveBeenCalled();
  });

  it('returns source-backed completion latency values when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCompletionLatencyDays.mockResolvedValue([5.5, 40]);
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserCompletionLatencyDays(42, contentFilters, ['audiobook'], 365)).resolves.toEqual([5.5, 40]);
    expect(repo.getUserCompletionLatencyDays).toHaveBeenCalledWith(42, contentFilters, ['audiobook'], 365);
  });

  it('returns empty reading survival progress values when disabled or no media types are available', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getUserReadingSurvivalMaxProgress(42, undefined, ['ebook'], 365)).resolves.toEqual([]);
    await expect(service.getUserReadingSurvivalMaxProgress(42, undefined, [], 365)).resolves.toEqual([]);
    expect(repo.getUserReadingSurvivalMaxProgress).not.toHaveBeenCalled();
  });

  it('returns source-backed reading survival progress values when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserReadingSurvivalMaxProgress.mockResolvedValue([25, 75, 100]);
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserReadingSurvivalMaxProgress(42, contentFilters, ['ebook'], 365)).resolves.toEqual([25, 75, 100]);
    expect(repo.getUserReadingSurvivalMaxProgress).toHaveBeenCalledWith(42, contentFilters, ['ebook'], 365);
  });

  it('returns empty source-backed diversity data when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getUserCatalogDiversityData(42)).resolves.toEqual({
      uniqueGenresRead: 0,
      totalGenresInLibrary: 0,
      uniqueAuthorsRead: 0,
      totalBooksRead: 0,
      publicationYears: [],
      uniqueLanguages: 0,
      genresRead: [],
      genresInLibrary: [],
      authorsRead: [],
      languagesRead: [],
    });
    expect(repo.getUserCatalogDiversityData).not.toHaveBeenCalled();
  });

  it('returns empty author summaries when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.listAuthorSummaries({ userId: 42, q: 'octavia' })).resolves.toEqual([]);
    await expect(service.findAuthorSummaryById(-3001, 42)).resolves.toBeNull();
    expect(repo.listCatalogAuthorSummaries).not.toHaveBeenCalled();
    expect(repo.findCatalogAuthorSummaryById).not.toHaveBeenCalled();
  });

  it('searches synced catalog rows through local cache when the catalog source is enabled', async () => {
    const row = makeCatalogItemRow({ title: 'Dune' });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.searchCatalogItems.mockResolvedValue([row]);

    await expect(
      service.searchCatalogItems(
        'dune',
        10,
        {
          includeTagIds: [7],
          excludeTagIds: [],
          includeGenreIds: [],
          excludeGenreIds: [9],
        },
        ['ebook'],
      ),
    ).resolves.toEqual([row]);
    expect(repo.searchCatalogItems).toHaveBeenCalledWith(
      'dune',
      10,
      {
        includeTagIds: [7],
        excludeTagIds: [],
        includeGenreIds: [],
        excludeGenreIds: [9],
      },
      ['ebook'],
    );
  });

  it('returns cached catalog counts as a native library overview when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getCatalogLibraryOverview.mockResolvedValue({
      totalBooks: 12,
      totalAuthors: 8,
      totalSeries: 3,
      totalStorageBytes: 0,
      booksAddedThisYear: 12,
    });
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getLibraryOverview(contentFilters, ['ebook'])).resolves.toEqual({
      totalBooks: 12,
      totalAuthors: 8,
      totalSeries: 3,
      totalStorageBytes: 0,
      booksAddedThisYear: 12,
    });
    expect(repo.getCatalogLibraryOverview).toHaveBeenCalledWith(contentFilters, ['ebook']);
  });

  it('returns user-owned source-backed library overview counts when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCatalogLibraryOverview.mockResolvedValue({
      totalBooks: 9,
      totalAuthors: 6,
      totalSeries: 2,
      totalStorageBytes: 0,
      booksAddedThisYear: 4,
    });
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserLibraryOverview(42, contentFilters, ['ebook'])).resolves.toEqual({
      totalBooks: 9,
      totalAuthors: 6,
      totalSeries: 2,
      totalStorageBytes: 0,
      booksAddedThisYear: 4,
    });
    expect(repo.getUserCatalogLibraryOverview).toHaveBeenCalledWith(42, contentFilters, ['ebook']);
  });

  it('returns an empty user-owned library overview when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.getUserLibraryOverview(42, undefined, [])).resolves.toEqual({
      totalBooks: 0,
      totalAuthors: 0,
      totalSeries: 0,
      totalStorageBytes: 0,
      booksAddedThisYear: 0,
    });
    expect(repo.getUserCatalogLibraryOverview).not.toHaveBeenCalled();
  });

  it('returns source-backed reading activity days when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listUserCatalogReadingActivityDays.mockResolvedValue(['2026-06-03', '2026-06-04']);
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.listReadingActivityDays(42, contentFilters, ['ebook'])).resolves.toEqual(['2026-06-03', '2026-06-04']);
    expect(repo.listUserCatalogReadingActivityDays).toHaveBeenCalledWith(42, contentFilters, ['ebook']);
  });

  it('returns no source-backed reading activity days when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.listReadingActivityDays(42, undefined, [])).resolves.toEqual([]);
    expect(repo.listUserCatalogReadingActivityDays).not.toHaveBeenCalled();
  });

  it('returns completed source-backed books this year when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.countCompletedUserCatalogItemsThisYear.mockResolvedValue(5);
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getCompletedBooksThisYear(42, contentFilters, ['ebook'])).resolves.toBe(5);
    expect(repo.countCompletedUserCatalogItemsThisYear).toHaveBeenCalledWith(42, contentFilters, ['ebook']);
  });

  it('returns source-backed diversity data when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCatalogDiversityData.mockResolvedValue({
      uniqueGenresRead: 3,
      totalGenresInLibrary: 5,
      uniqueAuthorsRead: 4,
      totalBooksRead: 8,
      publicationYears: [1990, 2020],
      uniqueLanguages: 2,
      genresRead: ['mystery', 'sci-fi'],
      genresInLibrary: ['mystery', 'romance', 'sci-fi', 'thriller', 'western'],
      authorsRead: ['ada', 'becky', 'chen', 'dina'],
      languagesRead: ['en', 'fr'],
    });
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserCatalogDiversityData(42, contentFilters, ['ebook'])).resolves.toEqual({
      uniqueGenresRead: 3,
      totalGenresInLibrary: 5,
      uniqueAuthorsRead: 4,
      totalBooksRead: 8,
      publicationYears: [1990, 2020],
      uniqueLanguages: 2,
      genresRead: ['mystery', 'sci-fi'],
      genresInLibrary: ['mystery', 'romance', 'sci-fi', 'thriller', 'western'],
      authorsRead: ['ada', 'becky', 'chen', 'dina'],
      languagesRead: ['en', 'fr'],
    });
    expect(repo.getUserCatalogDiversityData).toHaveBeenCalledWith(42, contentFilters, ['ebook']);
  });

  it('returns source-backed year projection data when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCatalogYearProjectionData.mockResolvedValue({
      booksCompletedYtd: 3,
      pagesReadLast30Days: 450,
      hoursReadLast30Days: 6.5,
      booksCompletedLast30Days: 2,
    });
    const yearStart = new Date('2026-01-01T00:00:00.000Z');
    const thirtyDaysAgo = new Date('2026-05-05T00:00:00.000Z');
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserCatalogYearProjectionData(42, yearStart, thirtyDaysAgo, contentFilters, ['ebook'])).resolves.toEqual({
      booksCompletedYtd: 3,
      pagesReadLast30Days: 450,
      hoursReadLast30Days: 6.5,
      booksCompletedLast30Days: 2,
    });
    expect(repo.getUserCatalogYearProjectionData).toHaveBeenCalledWith(42, yearStart, thirtyDaysAgo, contentFilters, ['ebook']);
  });

  it('returns source-backed reading DNA data when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCatalogReadingDnaData.mockResolvedValue({
      avgPageCount: 360,
      uniqueGenres: 3,
      totalBooks: 5,
      readingDaysRatio: 0.1,
      peakHour: 20,
      avgPagesPerHour: null,
      genresRead: ['mystery', 'sci-fi', 'thriller'],
      readingDays: ['2026-06-01'],
      lookbackDays: 180,
      hourBuckets: [{ hour: 20, totalSeconds: 2 }],
      pagesReadForSpeed: 0,
      secondsReadForSpeed: 0,
    });
    const since = new Date('2025-12-04T00:00:00.000Z');
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserCatalogReadingDnaData(42, since, contentFilters, ['ebook'])).resolves.toEqual({
      avgPageCount: 360,
      uniqueGenres: 3,
      totalBooks: 5,
      readingDaysRatio: 0.1,
      peakHour: 20,
      avgPagesPerHour: null,
      genresRead: ['mystery', 'sci-fi', 'thriller'],
      readingDays: ['2026-06-01'],
      lookbackDays: 180,
      hourBuckets: [{ hour: 20, totalSeconds: 2 }],
      pagesReadForSpeed: 0,
      secondsReadForSpeed: 0,
    });
    expect(repo.getUserCatalogReadingDnaData).toHaveBeenCalledWith(42, since, contentFilters, ['ebook']);
  });

  it('returns source-backed challenge pattern data when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCatalogChallengePatternData.mockResolvedValue({
      avgPageCount: 260,
      uniqueGenresLast6Months: 4,
      staleInProgressCount: 1,
      currentStreak: 0,
      maxStreakThisMonth: 2,
      topAuthorBookCount: 3,
      totalBooksRead: 5,
      pagesThisMonth: 420,
      shortBooksCompleted: 1,
      newGenresRead: 2,
      oldestInProgressFinished: true,
      newAuthorsRead: 2,
      pagesReadThisMonth: 420,
      genresLast6Months: ['mystery', 'sci-fi'],
      genresReadThisMonth: ['mystery'],
      authorsReadThisMonth: ['ada'],
      readingDaysThisMonth: ['2026-06-01'],
    });
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const sixMonthsAgo = new Date('2025-12-04T00:00:00.000Z');
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserCatalogChallengePatternData(42, monthStart, sixMonthsAgo, contentFilters, ['ebook'])).resolves.toEqual({
      avgPageCount: 260,
      uniqueGenresLast6Months: 4,
      staleInProgressCount: 1,
      currentStreak: 0,
      maxStreakThisMonth: 2,
      topAuthorBookCount: 3,
      totalBooksRead: 5,
      pagesThisMonth: 420,
      shortBooksCompleted: 1,
      newGenresRead: 2,
      oldestInProgressFinished: true,
      newAuthorsRead: 2,
      pagesReadThisMonth: 420,
      genresLast6Months: ['mystery', 'sci-fi'],
      genresReadThisMonth: ['mystery'],
      authorsReadThisMonth: ['ada'],
      readingDaysThisMonth: ['2026-06-01'],
    });
    expect(repo.getUserCatalogChallengePatternData).toHaveBeenCalledWith(42, monthStart, sixMonthsAgo, contentFilters, ['ebook']);
  });

  it('returns source-backed neglected gems when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCatalogNeglectedGems.mockResolvedValue({
      gems: [
        {
          type: 'catalog-item',
          bookId: 901,
          mediaType: 'ebook',
          remoteId: 'ebook-901',
          title: 'Cloud Gem',
          hasCover: true,
          rating: 5,
          waitingDays: 44,
          genre: 'Mystery',
        },
      ],
    });
    const today = new Date('2026-06-04T00:00:00.000Z');
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserCatalogNeglectedGems(42, today, contentFilters, ['ebook'])).resolves.toEqual({
      gems: [
        {
          type: 'catalog-item',
          bookId: 901,
          mediaType: 'ebook',
          remoteId: 'ebook-901',
          title: 'Cloud Gem',
          hasCover: true,
          rating: 5,
          waitingDays: 44,
          genre: 'Mystery',
        },
      ],
    });
    expect(repo.getUserCatalogNeglectedGems).toHaveBeenCalledWith(42, today, contentFilters, ['ebook']);
  });

  it('returns source-backed long-wait candidate when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.getUserCatalogLongWait.mockResolvedValue({
      type: 'catalog-item',
      bookId: 901,
      mediaType: 'ebook',
      remoteId: 'ebook-901',
      title: 'Cloud Old Book',
      hasCover: true,
      addedAt: '2026-05-01T00:00:00.000Z',
      waitingDays: 34,
      pageCount: 320,
      genre: 'Mystery',
      fileId: null,
      fileFormat: 'epub',
    });
    const today = new Date('2026-06-04T00:00:00.000Z');
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [9],
    };

    await expect(service.getUserCatalogLongWait(42, today, contentFilters, ['ebook'])).resolves.toEqual({
      type: 'catalog-item',
      bookId: 901,
      mediaType: 'ebook',
      remoteId: 'ebook-901',
      title: 'Cloud Old Book',
      hasCover: true,
      addedAt: '2026-05-01T00:00:00.000Z',
      waitingDays: 34,
      pageCount: 320,
      genre: 'Mystery',
      fileId: null,
      fileFormat: 'epub',
    });
    expect(repo.getUserCatalogLongWait).toHaveBeenCalledWith(42, today, contentFilters, ['ebook']);
  });

  it('returns empty source-backed reading DNA data when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.getUserCatalogReadingDnaData(42, new Date('2025-12-04T00:00:00.000Z'), undefined, [])).resolves.toEqual({
      avgPageCount: 0,
      uniqueGenres: 0,
      totalBooks: 0,
      readingDaysRatio: 0,
      peakHour: 12,
      avgPagesPerHour: null,
      genresRead: [],
      readingDays: [],
      lookbackDays: 0,
      hourBuckets: [],
      pagesReadForSpeed: 0,
      secondsReadForSpeed: 0,
    });
    expect(repo.getUserCatalogReadingDnaData).not.toHaveBeenCalled();
  });

  it('returns empty source-backed challenge pattern data when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(
      service.getUserCatalogChallengePatternData(42, new Date('2026-06-01T00:00:00.000Z'), new Date('2025-12-04T00:00:00.000Z'), undefined, []),
    ).resolves.toEqual({
      avgPageCount: 0,
      uniqueGenresLast6Months: 0,
      staleInProgressCount: 0,
      currentStreak: 0,
      maxStreakThisMonth: 0,
      topAuthorBookCount: 0,
      totalBooksRead: 0,
      pagesThisMonth: 0,
      shortBooksCompleted: 0,
      newGenresRead: 0,
      oldestInProgressFinished: false,
      newAuthorsRead: 0,
      pagesReadThisMonth: 0,
      genresLast6Months: [],
      genresReadThisMonth: [],
      authorsReadThisMonth: [],
      readingDaysThisMonth: [],
    });
    expect(repo.getUserCatalogChallengePatternData).not.toHaveBeenCalled();
  });

  it('returns empty source-backed neglected gems when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.getUserCatalogNeglectedGems(42, new Date('2026-06-04T00:00:00.000Z'), undefined, [])).resolves.toEqual({
      gems: [],
    });
    expect(repo.getUserCatalogNeglectedGems).not.toHaveBeenCalled();
  });

  it('returns empty source-backed year projection data when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    const yearStart = new Date('2026-01-01T00:00:00.000Z');
    const thirtyDaysAgo = new Date('2026-05-05T00:00:00.000Z');

    await expect(service.getUserCatalogYearProjectionData(42, yearStart, thirtyDaysAgo, undefined, [])).resolves.toEqual({
      booksCompletedYtd: 0,
      pagesReadLast30Days: 0,
      hoursReadLast30Days: 0,
      booksCompletedLast30Days: 0,
    });
    expect(repo.getUserCatalogYearProjectionData).not.toHaveBeenCalled();
  });

  it('returns empty source-backed diversity data when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.getUserCatalogDiversityData(42, undefined, [])).resolves.toEqual({
      uniqueGenresRead: 0,
      totalGenresInLibrary: 0,
      uniqueAuthorsRead: 0,
      totalBooksRead: 0,
      publicationYears: [],
      uniqueLanguages: 0,
      genresRead: [],
      genresInLibrary: [],
      authorsRead: [],
      languagesRead: [],
    });
    expect(repo.getUserCatalogDiversityData).not.toHaveBeenCalled();
  });

  it('returns zero completed source-backed books this year when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.getCompletedBooksThisYear(42, undefined, [])).resolves.toBe(0);
    expect(repo.countCompletedUserCatalogItemsThisYear).not.toHaveBeenCalled();
  });

  it('returns empty currently-reading catalog items when disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getCurrentlyReading(42)).resolves.toEqual({ books: [] });
    expect(repo.listCurrentlyReadingUserCatalogItems).not.toHaveBeenCalled();
  });

  it('maps source-backed reading progress into native currently-reading items', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listCurrentlyReadingUserCatalogItems.mockResolvedValue([
      {
        ...makeCatalogItemRow({
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Cloud Audio',
          subtitle: null,
          authors: ['Cloud Author'],
          narrators: ['Narrator'],
          series: null,
          format: 'm4b',
          hasCover: true,
          rawPayload: { source: 'catalog-source' },
        }),
        progressPercent: 67,
        positionSeconds: 3600,
        lastActivityAt: new Date('2026-06-02T00:00:00.000Z'),
      },
    ]);
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [],
    };

    await expect(service.getCurrentlyReading(42, contentFilters, ['audiobook'])).resolves.toEqual({
      books: [
        {
          type: 'catalog-item',
          mediaType: 'audiobook',
          remoteId: 'audio-1',
          title: 'Cloud Audio',
          subtitle: null,
          seriesName: null,
          seriesRef: null,
          authors: ['Cloud Author'],
          authorRefs: [expectedCatalogAuthorRef('Cloud Author')],
          narrators: ['Narrator'],
          libraryName: 'Audiobooks',
          fileFormat: 'm4b',
          progress: 67,
          positionSeconds: 3600,
          hasCover: true,
          lastActivityAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    });
    expect(repo.listCurrentlyReadingUserCatalogItems).toHaveBeenCalledWith(42, 10, contentFilters, ['audiobook']);
  });

  it('returns empty currently-reading catalog items when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.getCurrentlyReading(42, undefined, [])).resolves.toEqual({ books: [] });
    expect(repo.listCurrentlyReadingUserCatalogItems).not.toHaveBeenCalled();
  });

  it('returns empty source-backed annotation counts when disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getAnnotationCount(42)).resolves.toBe(0);
    await expect(service.getAnnotationByOffset(42, 0)).resolves.toBeNull();
    expect(repo.countUserCatalogAnnotations).not.toHaveBeenCalled();
    expect(repo.getUserCatalogAnnotationByOffset).not.toHaveBeenCalled();
  });

  it('maps source-backed annotations into native highlight widget data', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.countUserCatalogAnnotations.mockResolvedValue(1);
    repo.getUserCatalogAnnotationByOffset.mockResolvedValue({
      text: 'Cloud quote',
      note: 'Cloud note',
      bookTitle: 'Cloud Ebook',
      mediaType: 'ebook',
      remoteId: 'ebook-1',
      hasCover: true,
      chapterTitle: 'Chapter 2',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [],
    };

    await expect(service.getAnnotationCount(42, contentFilters, ['ebook'])).resolves.toBe(1);
    await expect(service.getAnnotationByOffset(42, 0, contentFilters, ['ebook'])).resolves.toEqual({
      type: 'catalog-item',
      text: 'Cloud quote',
      note: 'Cloud note',
      bookTitle: 'Cloud Ebook',
      bookId: null,
      mediaType: 'ebook',
      remoteId: 'ebook-1',
      libraryName: 'Books',
      hasCover: true,
      chapterTitle: 'Chapter 2',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(repo.countUserCatalogAnnotations).toHaveBeenCalledWith(42, contentFilters, ['ebook']);
    expect(repo.getUserCatalogAnnotationByOffset).toHaveBeenCalledWith(42, 0, contentFilters, ['ebook']);
  });

  it('returns empty source-backed annotations when no source-backed media libraries are accessible', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(service.getAnnotationCount(42, undefined, [])).resolves.toBe(0);
    await expect(service.getAnnotationByOffset(42, 0, undefined, [])).resolves.toBeNull();
    expect(repo.countUserCatalogAnnotations).not.toHaveBeenCalled();
    expect(repo.getUserCatalogAnnotationByOffset).not.toHaveBeenCalled();
  });

  it('maps source-backed library queries into native catalog card pages', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.queryUserCatalogItems.mockResolvedValue({
      rows: [
        {
          ...makeCatalogItemRow({
            mediaType: 'ebook',
            remoteId: 'ebook-1',
            title: 'Library Ebook',
            authors: ['Library Author'],
            series: 'Library Series',
            format: 'epub',
          }),
          rating: 5,
          readingProgress: 66,
          readStatus: 'reading',
          publishedYear: 2024,
          pageCount: 640,
          fileSizeBytes: 8192,
          metadataScore: 86,
          lastReadAt: new Date('2026-06-02T12:00:00.000Z'),
          finishedAt: new Date('2026-06-02T13:00:00.000Z'),
          updatedAt: new Date('2026-06-02T14:00:00.000Z'),
        },
      ],
      total: 1,
      page: 0,
      limit: 50,
    });
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [],
    };
    const query = {
      filter: {
        type: 'group',
        join: 'AND',
        rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Library' }],
      },
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 50 },
      q: 'ebook',
    } as const;

    await expect(service.queryLibraryItems(makeUser({ contentFilters }), 'ebook', query)).resolves.toEqual({
      items: [
        {
          type: 'catalog-item',
          mediaType: 'ebook',
          remoteId: 'ebook-1',
          title: 'Library Ebook',
          subtitle: 'A Novel',
          seriesName: 'Library Series',
          seriesRef: expectedCatalogSeriesRef('Library Series'),
          seriesIndex: null,
          authors: ['Library Author'],
          authorRefs: [expectedCatalogAuthorRef('Library Author')],
          narrators: [],
          libraryName: 'Books',
          formats: ['epub'],
          language: 'en',
          publisher: 'Tor',
          rating: 5,
          readingProgress: 66,
          readStatus: 'reading',
          publishedYear: 2024,
          pageCount: 640,
          fileSizeBytes: 8192,
          metadataScore: 86,
          lastReadAt: '2026-06-02T12:00:00.000Z',
          finishedAt: '2026-06-02T13:00:00.000Z',
          durationSeconds: null,
          hasCover: true,
          addedAt: '2026-06-02T11:00:00.000Z',
          updatedAt: '2026-06-02T14:00:00.000Z',
        },
      ],
      total: 1,
      page: 0,
      limit: 50,
    });
    expect(repo.queryUserCatalogItems).toHaveBeenCalledWith(42, {
      includeAllCatalogItems: true,
      mediaType: 'ebook',
      filter: query.filter,
      q: 'ebook',
      sort: query.sort,
      page: 0,
      limit: 50,
      contentFilters,
    });
  });

  it('queries source-backed library jump buckets from native catalog rows', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.queryUserCatalogJumpBuckets.mockResolvedValue({
      buckets: [{ key: 'A', label: 'A', index: 0 }],
      total: 12,
    });
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [],
    };
    const query = {
      filter: {
        type: 'group',
        join: 'AND',
        rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Astro' }],
      },
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 50 },
      q: 'comic',
    } as const;

    await expect(service.queryLibraryJumpBuckets(makeUser({ contentFilters }), 'comic', query)).resolves.toEqual({
      buckets: [{ key: 'A', label: 'A', index: 0 }],
      total: 12,
    });
    expect(repo.queryUserCatalogJumpBuckets).toHaveBeenCalledWith(42, {
      includeAllCatalogItems: true,
      mediaType: 'comic',
      filter: query.filter,
      q: 'comic',
      sort: query.sort,
      contentFilters,
    });
  });

  it('serves repeated jump rail opens from memory, but never across users', async () => {
    // The bucket query scans the whole media type, about 900ms on a 242k row
    // library, and the rail asks for it every time it opens.
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.queryUserCatalogJumpBuckets.mockResolvedValue({ buckets: [{ key: 'A', label: 'A', index: 0 }], total: 12 });
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as const;

    await service.queryLibraryJumpBuckets(makeUser({ id: 42 }), 'comic', query);
    await service.queryLibraryJumpBuckets(makeUser({ id: 42 }), 'comic', query);

    expect(repo.queryUserCatalogJumpBuckets).toHaveBeenCalledTimes(1);

    // Content filters are per user, so a second user must not read the first
    // user's buckets out of the cache.
    await service.queryLibraryJumpBuckets(makeUser({ id: 43 }), 'comic', query);
    expect(repo.queryUserCatalogJumpBuckets).toHaveBeenCalledTimes(2);

    // A different media type is a different rail.
    await service.queryLibraryJumpBuckets(makeUser({ id: 42 }), 'ebook', query);
    expect(repo.queryUserCatalogJumpBuckets).toHaveBeenCalledTimes(3);
  });

  it('rejects unsupported source-backed library jump bucket sorts like native libraries', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());

    await expect(
      service.queryLibraryJumpBuckets(makeUser(), 'comic', {
        sort: [{ field: 'rating', dir: 'desc' }],
        pagination: { page: 0, size: 50 },
      }),
    ).rejects.toThrow('jump buckets are not available for this sort');
    expect(repo.queryUserCatalogJumpBuckets).not.toHaveBeenCalled();
  });

  it('bulk sets read status for every source-backed library query match', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.queryUserCatalogItems
      .mockResolvedValueOnce({
        rows: [makeCatalogItemRow({ mediaType: 'ebook', remoteId: 'ebook-1' }), makeCatalogItemRow({ mediaType: 'ebook', remoteId: 'ebook-2' })],
        total: 3,
        page: 0,
        limit: 100,
      })
      .mockResolvedValueOnce({
        rows: [makeCatalogItemRow({ mediaType: 'ebook', remoteId: 'ebook-3' })],
        total: 3,
        page: 1,
        limit: 100,
      });

    const filter = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Library' }],
    } as const;
    const sort = [{ field: 'title', dir: 'asc' }] as const;

    await expect(service.bulkSetReadStatusForQuery(makeUser({ id: 42 }), 'ebook', { filter, q: 'library', sort }, 'read')).resolves.toEqual({
      updated: 3,
    });

    expect(repo.queryUserCatalogItems).toHaveBeenNthCalledWith(1, 42, {
      includeAllCatalogItems: true,
      mediaType: 'ebook',
      filter,
      q: 'library',
      sort,
      page: 0,
      limit: 100,
      contentFilters: null,
    });
    expect(repo.queryUserCatalogItems).toHaveBeenNthCalledWith(2, 42, {
      includeAllCatalogItems: true,
      mediaType: 'ebook',
      filter,
      q: 'library',
      sort,
      page: 1,
      limit: 100,
      contentFilters: null,
    });
    expect(repo.upsertUserCatalogState).toHaveBeenCalledTimes(3);
    expect(repo.upsertUserCatalogState).toHaveBeenNthCalledWith(1, 42, 'ebook', 'ebook-1', { readStatus: 'read' });
    expect(repo.upsertUserCatalogState).toHaveBeenNthCalledWith(2, 42, 'ebook', 'ebook-2', { readStatus: 'read' });
    expect(repo.upsertUserCatalogState).toHaveBeenNthCalledWith(3, 42, 'ebook', 'ebook-3', { readStatus: 'read' });
  });

  it('bulk sets rating for every source-backed library query match', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.queryUserCatalogItems
      .mockResolvedValueOnce({
        rows: [
          makeCatalogItemRow({ mediaType: 'audiobook', remoteId: 'audio-1' }),
          makeCatalogItemRow({ mediaType: 'audiobook', remoteId: 'audio-2' }),
        ],
        total: 3,
        page: 0,
        limit: 100,
      })
      .mockResolvedValueOnce({
        rows: [makeCatalogItemRow({ mediaType: 'audiobook', remoteId: 'audio-3' })],
        total: 3,
        page: 1,
        limit: 100,
      });

    const filter = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Library' }],
    } as const;
    const sort = [{ field: 'rating', dir: 'desc' }] as const;

    await expect(service.bulkSetRatingForQuery(makeUser({ id: 42 }), 'audiobook', { filter, q: 'library', sort }, 4)).resolves.toEqual({
      updated: 3,
    });

    expect(repo.queryUserCatalogItems).toHaveBeenNthCalledWith(1, 42, {
      includeAllCatalogItems: true,
      mediaType: 'audiobook',
      filter,
      q: 'library',
      sort,
      page: 0,
      limit: 100,
      contentFilters: null,
    });
    expect(repo.queryUserCatalogItems).toHaveBeenNthCalledWith(2, 42, {
      includeAllCatalogItems: true,
      mediaType: 'audiobook',
      filter,
      q: 'library',
      sort,
      page: 1,
      limit: 100,
      contentFilters: null,
    });
    expect(repo.upsertUserCatalogState).toHaveBeenCalledTimes(3);
    expect(repo.upsertUserCatalogState).toHaveBeenNthCalledWith(1, 42, 'audiobook', 'audio-1', { rating: 4 });
    expect(repo.upsertUserCatalogState).toHaveBeenNthCalledWith(2, 42, 'audiobook', 'audio-2', { rating: 4 });
    expect(repo.upsertUserCatalogState).toHaveBeenNthCalledWith(3, 42, 'audiobook', 'audio-3', { rating: 4 });
  });

  it('returns author summaries from local catalog rows when enabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listCatalogAuthorSummaries.mockResolvedValue([
      {
        id: -3001,
        name: 'Octavia Butler',
        sortName: null,
        description: null,
        bookCount: 3,
        lastAddedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await expect(service.listAuthorSummaries({ userId: 42, q: 'octavia', mediaType: 'ebook' })).resolves.toEqual([
      {
        id: -3001,
        name: 'Octavia Butler',
        sortName: null,
        description: null,
        bookCount: 3,
        lastAddedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(repo.listCatalogAuthorSummaries).toHaveBeenCalledWith({ userId: 42, q: 'octavia', mediaType: 'ebook' });
  });

  it('finds author summaries and items through current-user owned catalog rows', async () => {
    const contentFilters = {
      includeTagIds: [7],
      excludeTagIds: [],
      includeGenreIds: [],
      excludeGenreIds: [],
    };
    const row = {
      ...makeCatalogItemRow({ title: 'Kindred', remoteId: 'kindred', authors: ['Octavia Butler'] }),
      userAddedAt: new Date('2026-01-03T00:00:00.000Z'),
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogAuthorSummaryById.mockResolvedValue({
      id: -3001,
      name: 'Octavia Butler',
      sortName: null,
      description: null,
      bookCount: 1,
      lastAddedAt: '2026-01-01T00:00:00.000Z',
    });
    repo.listCatalogItemsByAuthor.mockResolvedValue({ rows: [row], total: 1, page: 0, size: 25 });

    await expect(service.findAuthorSummaryById(-3001, 42, contentFilters)).resolves.toEqual({
      id: -3001,
      name: 'Octavia Butler',
      sortName: null,
      description: null,
      bookCount: 1,
      lastAddedAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(
      service.listAuthorItems({
        userId: 42,
        authorId: -3001,
        page: 0,
        size: 25,
        sort: 'addedAt',
        order: 'desc',
        contentFilters,
        mediaType: 'ebook',
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          remoteId: 'kindred',
          title: 'Kindred',
          addedAt: '2026-01-03T00:00:00.000Z',
        }),
      ],
      total: 1,
    });

    expect(repo.findCatalogAuthorSummaryById).toHaveBeenCalledWith(-3001, 42, contentFilters);
    expect(repo.listCatalogItemsByAuthor).toHaveBeenCalledWith({
      userId: 42,
      authorId: -3001,
      page: 0,
      size: 25,
      sort: 'addedAt',
      order: 'desc',
      contentFilters,
      mediaType: 'ebook',
    });
  });

  it('maps source-backed series indexes onto native catalog library items', async () => {
    const row = {
      ...makeCatalogItemRow({ title: 'Dune Messiah', remoteId: 'dune-2', series: 'Dune', seriesIndex: 2 }),
      userAddedAt: new Date('2026-01-03T00:00:00.000Z'),
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listCatalogItemsBySeries.mockResolvedValue({ rows: [row], total: 1, page: 0, size: 25 });

    await expect(
      service.listSeriesItems({
        userId: 42,
        seriesName: 'Dune',
        page: 0,
        size: 25,
        sort: 'seriesIndex',
        order: 'asc',
        mediaType: 'ebook',
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          remoteId: 'dune-2',
          title: 'Dune Messiah',
          seriesIndex: 2,
        }),
      ],
      total: 1,
    });
  });

  it('maps ebook genre dimensions from local catalog rows', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listEbookCatalogDimensions.mockResolvedValue([
      { name: 'Fantasy', itemCount: 3 },
      { name: 'Science Fiction', itemCount: 2 },
    ]);

    await expect(service.listEbookGenres()).resolves.toEqual({
      items: [
        { id: 'Fantasy', name: 'Fantasy', itemCount: 3 },
        { id: 'Science%20Fiction', name: 'Science Fiction', itemCount: 2 },
      ],
      total: 2,
    });
    expect(repo.listEbookCatalogDimensions).toHaveBeenCalledWith('genre');
    expect(client.downloadBook).not.toHaveBeenCalled();
  });

  it('maps audiobook dimensions from local catalog rows without live client calls', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listAudiobookCatalogDimensions.mockResolvedValue([
      { name: 'Robin Miles', itemCount: 2 },
      { name: 'Kevin R. Free', itemCount: 1 },
    ]);

    await expect(service.listAudiobookNarrators()).resolves.toEqual({
      items: [
        { id: 'Robin%20Miles', name: 'Robin Miles', itemCount: 2 },
        { id: 'Kevin%20R.%20Free', name: 'Kevin R. Free', itemCount: 1 },
      ],
      total: 2,
    });
    expect(repo.listAudiobookCatalogDimensions).toHaveBeenCalledWith('narrator');
    expect(client.getAudiobookCover).not.toHaveBeenCalled();
    expect(client.streamAudiobook).not.toHaveBeenCalled();
  });

  it('lists audiobooks by decoded dimension name using local catalog filters', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listAudiobookCatalog.mockResolvedValue({
      rows: [makeCatalogItemRow({ mediaType: 'audiobook', remoteId: 'audio-1', narrators: ['Robin Miles'], format: 'm4b' })],
      page: 2,
      limit: 5,
      total: 1,
    });

    const page = await service.listAudiobooksByAuthor('N. K. Jemisin', { page: 2, limit: 5 });

    expect(repo.listAudiobookCatalog).toHaveBeenCalledWith({ page: 2, limit: 5, author: 'N. K. Jemisin' });
    expect(page.items[0]).toMatchObject({
      remoteId: 'audio-1',
      source: 'catalog-source',
    });
    expect(JSON.stringify(page)).not.toContain('apiKey');
  });

  it('lists ebooks and audiobooks by decoded genre using local catalog filters', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listEbookCatalog.mockResolvedValue({
      rows: [makeCatalogItemRow({ genres: ['Science Fiction'] })],
      page: 2,
      limit: 5,
      total: 1,
    });
    repo.listAudiobookCatalog.mockResolvedValue({
      rows: [makeCatalogItemRow({ mediaType: 'audiobook', remoteId: 'audio-genre', genres: ['Fantasy'], format: 'm4b' })],
      page: 1,
      limit: 10,
      total: 1,
    });

    const ebookPage = await service.listEbooksByGenre('Science Fiction', { page: 2, limit: 5 });
    await service.listAudiobooksByGenre('Fantasy', { page: 1, limit: 10 });

    expect(repo.listEbookCatalog).toHaveBeenCalledWith({ page: 2, limit: 5, genre: 'Science Fiction' });
    expect(repo.listAudiobookCatalog).toHaveBeenCalledWith({ page: 1, limit: 10, genre: 'Fantasy' });
    expect(ebookPage.items[0]).toMatchObject({ source: 'catalog-source' });
  });

  it('maps repository list rows to catalog items without exposing raw payload or secrets', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listEbookCatalog.mockResolvedValue({
      rows: [makeCatalogItemRow()],
      page: 1,
      limit: 20,
      total: 1,
    });

    const page = await service.listEbooks({ q: 'memory' });

    expect(repo.listEbookCatalog).toHaveBeenCalledWith({ q: 'memory' });
    expect(page).toEqual({
      items: [
        {
          id: 10,
          remoteId: 'remote-10',
          title: 'A Memory Called Empire',
          subtitle: 'A Novel',
          authors: ['Arkady Martine'],
          authorRefs: [expectedCatalogAuthorRef('Arkady Martine')],
          series: 'Teixcalaan',
          seriesRef: expectedCatalogSeriesRef('Teixcalaan'),
          language: 'en',
          publisher: 'Tor',
          identifiers: { isbn13: '9781250186430' },
          format: 'epub',
          hasCover: true,
          syncedAt: '2026-06-02T11:00:00.000Z',
          source: 'catalog-source',
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });
    expect(page.items[0]).not.toHaveProperty('rawPayload');
    expect(page.items[0]).not.toHaveProperty('apiKey');
  });

  it('returns null for detail lookups when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getEbook('remote-10')).resolves.toBeNull();
    expect(repo.findCatalogItem).not.toHaveBeenCalled();
    expect(repo.findCatalogDetail).not.toHaveBeenCalled();
  });

  it('uses only local repository data for detail lookups without exposing cached raw detail', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow());
    repo.findCatalogDetail.mockResolvedValue(makeCatalogDetailRow());

    const detail = await service.getEbook('remote-10');

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.findCatalogDetail).not.toHaveBeenCalled();
    expect(detail).toEqual({
      id: 10,
      remoteId: 'remote-10',
      title: 'A Memory Called Empire',
      subtitle: 'A Novel',
      authors: ['Arkady Martine'],
      authorRefs: [expectedCatalogAuthorRef('Arkady Martine')],
      series: 'Teixcalaan',
      seriesRef: expectedCatalogSeriesRef('Teixcalaan'),
      language: 'en',
      publisher: 'Tor',
      identifiers: { isbn13: '9781250186430' },
      format: 'epub',
      hasCover: true,
      syncedAt: '2026-06-02T11:00:00.000Z',
      source: 'catalog-source',
    });
    expect(detail).not.toHaveProperty('raw');
  });

  it('returns the mapped catalog item without raw detail when no cached detail exists', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow());
    repo.findCatalogDetail.mockResolvedValue(null);

    const detail = await service.getEbook('remote-10');

    expect(detail).toEqual({
      id: 10,
      remoteId: 'remote-10',
      title: 'A Memory Called Empire',
      subtitle: 'A Novel',
      authors: ['Arkady Martine'],
      authorRefs: [expectedCatalogAuthorRef('Arkady Martine')],
      series: 'Teixcalaan',
      seriesRef: expectedCatalogSeriesRef('Teixcalaan'),
      language: 'en',
      publisher: 'Tor',
      identifiers: { isbn13: '9781250186430' },
      format: 'epub',
      hasCover: true,
      syncedAt: '2026-06-02T11:00:00.000Z',
      source: 'catalog-source',
    });
  });

  it('returns null when a cached item is missing', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(null);

    await expect(service.getEbook('missing-remote-id')).resolves.toBeNull();
    expect(repo.findCatalogDetail).not.toHaveBeenCalled();
  });

  it('finds an accessible cached catalog item by local id using user content filters', async () => {
    const user = makeUser({
      contentFilters: {
        version: 1,
        mode: 'exclude',
        rules: [{ field: 'tags', operator: 'has', value: 'spoilers' }],
      },
    });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findAccessibleCatalogItemById.mockResolvedValue(makeCatalogItemRow({ id: 33, mediaType: 'audiobook' }));

    await expect(service.findAccessibleCatalogItemById(user, 'audiobook', 33)).resolves.toMatchObject({
      id: 33,
      mediaType: 'audiobook',
    });

    expect(repo.findAccessibleCatalogItemById).toHaveBeenCalledWith('audiobook', 33, user.contentFilters);
  });

  it('returns null for filtered or hidden cached catalog items', async () => {
    const user = makeUser({
      contentFilters: {
        version: 1,
        mode: 'exclude',
        rules: [{ field: 'authors', operator: 'has', value: 'Hidden Author' }],
      },
    });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findAccessibleCatalogItemById.mockResolvedValue(null);

    await expect(service.findAccessibleCatalogItemById(user, 'audiobook', 33)).resolves.toBeNull();
    expect(repo.findAccessibleCatalogItemById).toHaveBeenCalledWith('audiobook', 33, user.contentFilters);
  });

  it('returns comic-specific cached metadata in public Comic Library item detail', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(
      makeCatalogItemRow({
        mediaType: 'comic',
        remoteId: 'comic-1',
        title: 'Saga #1',
        subtitle: null,
        authors: ['Brian K. Vaughan', 'Fiona Staples'],
        series: 'Saga',
        publisher: 'Image',
        identifiers: {
          seriesId: 'series-1',
          issueNumber: '1',
          year: '2012',
        },
        format: 'cbz',
        rawPayload: {
          storage_path: 'ceph://private/comic.cbz',
          media_path: '/media/private/comic.cbz',
        },
      }),
    );

    const detail = await service.getComic('comic-1');

    expect(repo.findCatalogItem).toHaveBeenCalledWith('comic', 'comic-1');
    expect(detail).toEqual({
      id: 10,
      remoteId: 'comic-1',
      title: 'Saga #1',
      subtitle: null,
      authors: ['Brian K. Vaughan', 'Fiona Staples'],
      authorRefs: [expectedCatalogAuthorRef('Brian K. Vaughan'), expectedCatalogAuthorRef('Fiona Staples')],
      series: 'Saga',
      seriesRef: expectedCatalogSeriesRef('Saga'),
      language: 'en',
      publisher: 'Image',
      identifiers: {
        seriesId: 'series-1',
        issueNumber: '1',
        year: '2012',
      },
      format: 'cbz',
      hasCover: true,
      syncedAt: '2026-06-02T11:00:00.000Z',
      source: 'catalog-source',
      mediaType: 'comic',
      seriesId: 'series-1',
      issueNumber: '1',
      year: 2012,
    });
    expect(JSON.stringify(detail)).not.toMatch(/ceph:\/\/|\/media\/|storage_path|media_path/i);
  });

  it('returns an empty audiobook page when the catalog source is disabled', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.listAudiobooks({ page: 2, limit: 250 })).resolves.toEqual({
      items: [],
      page: 2,
      limit: 100,
      total: 0,
    });
    expect(repo.listAudiobookCatalog).not.toHaveBeenCalled();
  });

  it('maps audiobook rows without exposing raw payloads or secrets', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.listAudiobookCatalog.mockResolvedValue({
      rows: [
        makeCatalogItemRow({
          mediaType: 'audiobook',
          narrators: ['Robin Miles'],
          format: 'm4b',
          durationSeconds: 12345,
        }),
      ],
      page: 1,
      limit: 20,
      total: 1,
    });

    const page = await service.listAudiobooks({ narrator: 'Robin Miles' });

    expect(repo.listAudiobookCatalog).toHaveBeenCalledWith({ narrator: 'Robin Miles' });
    expect(page).toEqual({
      items: [
        {
          id: 10,
          remoteId: 'remote-10',
          title: 'A Memory Called Empire',
          subtitle: 'A Novel',
          authors: ['Arkady Martine'],
          authorRefs: [expectedCatalogAuthorRef('Arkady Martine')],
          narrators: ['Robin Miles'],
          series: 'Teixcalaan',
          seriesRef: expectedCatalogSeriesRef('Teixcalaan'),
          language: 'en',
          publisher: 'Tor',
          identifiers: { isbn13: '9781250186430' },
          format: 'm4b',
          durationSeconds: 12345,
          hasCover: true,
          syncedAt: '2026-06-02T11:00:00.000Z',
          source: 'catalog-source',
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });
    expect(page.items[0]).not.toHaveProperty('rawPayload');
    expect(page.items[0]).not.toHaveProperty('apiKey');
    expect(client.getAudiobookCover).not.toHaveBeenCalled();
    expect(client.streamAudiobook).not.toHaveBeenCalled();
    expect(client.downloadAudiobook).not.toHaveBeenCalled();
    expect(client.downloadAudiobookFile).not.toHaveBeenCalled();
  });

  it('returns safe audiobook detail using cached raw detail only for chapters and files', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(
      makeCatalogItemRow({
        mediaType: 'audiobook',
        narrators: ['Robin Miles'],
        format: 'm4b',
        durationSeconds: 12345,
      }),
    );
    repo.findCatalogDetail.mockResolvedValue(
      makeCatalogDetailRow({
        mediaType: 'audiobook',
        rawPayload: {
          apiKey: 'do-not-expose',
          baseUrl: 'https://catalog-source.example.test',
          chapters: [{ id: 'ch-1', title: 'Opening', startSeconds: 0, endSeconds: 120, durationSeconds: 120 }],
          files: [{ id: 'file-1', name: 'part-one.m4b', format: 'm4b', durationSeconds: 120, sizeBytes: 4096 }],
        },
      }),
    );

    const detail = await service.getAudiobook('remote-10');

    expect(repo.findCatalogItem).toHaveBeenCalledWith('audiobook', 'remote-10');
    expect(repo.findCatalogDetail).toHaveBeenCalledWith('audiobook', 'remote-10');
    expect(detail).toEqual({
      id: 10,
      remoteId: 'remote-10',
      title: 'A Memory Called Empire',
      subtitle: 'A Novel',
      authors: ['Arkady Martine'],
      authorRefs: [expectedCatalogAuthorRef('Arkady Martine')],
      narrators: ['Robin Miles'],
      series: 'Teixcalaan',
      seriesRef: expectedCatalogSeriesRef('Teixcalaan'),
      language: 'en',
      publisher: 'Tor',
      identifiers: { isbn13: '9781250186430' },
      format: 'm4b',
      durationSeconds: 12345,
      hasCover: true,
      syncedAt: '2026-06-02T11:00:00.000Z',
      source: 'catalog-source',
      chapters: [{ id: 'ch-1', title: 'Opening', startSeconds: 0, endSeconds: 120, durationSeconds: 120 }],
      files: [{ id: 'file-1', name: 'part-one.m4b', format: 'm4b', durationSeconds: 120, sizeBytes: 4096 }],
    });
    expect(detail).not.toHaveProperty('rawPayload');
    expect(detail).not.toHaveProperty('apiKey');
    expect(detail).not.toHaveProperty('baseUrl');
    expect(client.getAudiobookCover).not.toHaveBeenCalled();
    expect(client.streamAudiobook).not.toHaveBeenCalled();
    expect(client.downloadAudiobook).not.toHaveBeenCalled();
    expect(client.downloadAudiobookFile).not.toHaveBeenCalled();
  });

  it('returns audiobook detail with empty chapters and files when no cached detail exists', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'audiobook' }));
    repo.findCatalogDetail.mockResolvedValue(null);

    await expect(service.getAudiobook('remote-10')).resolves.toMatchObject({
      remoteId: 'remote-10',
      chapters: [],
      files: [],
    });
  });

  it('does not expose the legacy ABS compatibility item method', () => {
    expect((service as any).getAudiobookshelfItem).toBeUndefined();
  });

  it('rejects audiobook binary reads when disabled or credentials are missing without calling the client', async () => {
    const user = makeUser({ id: 7 });
    repo.findSettings.mockResolvedValue(makeSettingsRow({ enabled: false }));

    await expect(service.getAudiobookCover(user, 'remote-10')).rejects.toThrow('Library item is not available.');
    expect(client.getAudiobookCover).not.toHaveBeenCalled();

    repo.findSettings.mockResolvedValue(
      makeSettingsRow({
        apiKeyEncrypted: null,
        apiKeyNonce: null,
        apiKeyTag: null,
      }),
    );

    await expect(service.streamAudiobook(user, 'remote-10')).rejects.toThrow('Library media is temporarily unavailable.');
    expect(client.streamAudiobook).not.toHaveBeenCalled();
  });

  it('verifies the cached audiobook item exists before calling the binary client', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(null);

    await expect(service.downloadAudiobook(makeUser({ id: 7 }), 'missing-remote-id')).rejects.toThrow('Library item is not available.');

    expect(repo.findCatalogItem).toHaveBeenCalledWith('audiobook', 'missing-remote-id');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.downloadAudiobook).not.toHaveBeenCalled();
  });

  it('uses the live client only for audiobook binaries after verifying the cached catalog item', async () => {
    const response = {
      status: 200,
      contentType: 'audio/mpeg',
      contentLength: 3,
      body: Buffer.from('abc'),
      fileName: 'book.mp3',
    };
    const user = makeUser({ id: 7 });
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'audiobook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });
    client.getAudiobookCover.mockResolvedValue({ ...response, contentType: 'image/jpeg', fileName: null });
    client.streamAudiobook.mockResolvedValue(response);
    client.downloadAudiobook.mockResolvedValue(response);
    client.downloadAudiobookFile.mockResolvedValue(response);

    await service.getAudiobookCover(user, 'remote-10');
    await service.streamAudiobook(user, 'remote-10', 'bytes=100-199');
    await service.downloadAudiobook(user, 'remote-10', 'bytes=200-299');
    await service.downloadAudiobookFile(user, 'remote-10', 'file-1', 'bytes=300-399');

    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.getAudiobookCover).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
    });
    expect(client.streamAudiobook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      range: 'bytes=100-199',
    });
    expect(client.downloadAudiobook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      range: 'bytes=200-299',
    });
    expect(client.downloadAudiobookFile).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      range: 'bytes=300-399',
      fileId: 'file-1',
    });
    expect(repo.listAudiobookCatalog).not.toHaveBeenCalled();
  });

  it('streams visible cached audiobooks without requiring an old user library row', async () => {
    const response = {
      status: 206,
      contentType: 'audio/mpeg',
      contentLength: 3,
      body: Buffer.from('abc'),
      fileName: 'book.mp3',
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'audiobook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'remote-10',
      inLibrary: false,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: null,
    });
    client.streamAudiobook.mockResolvedValue(response);

    await expect(service.streamAudiobook(makeUser({ id: 9 }), 'remote-10', 'bytes=100-199')).resolves.toBe(response);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('audiobook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.streamAudiobook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      range: 'bytes=100-199',
    });
  });

  it('returns cached audiobook covers after verifying the cached catalog item without calling the live client', async () => {
    const cachedResponse = {
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'audiobook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });
    coverCache.readAudiobookCover.mockResolvedValue(cachedResponse);

    await expect(service.getAudiobookCover(makeUser({ id: 7 }), 'remote-10')).resolves.toBe(cachedResponse);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('audiobook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(coverCache.readAudiobookCover).toHaveBeenCalledWith('https://catalog-source.example.test\nciphertext\nnonce\ntag', 'remote-10');
    expect(client.getAudiobookCover).not.toHaveBeenCalled();
  });

  it('uses the live client for cached audiobook covers without requiring a user item row', async () => {
    const response = {
      status: 200,
      contentType: 'image/jpeg',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'audiobook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'remote-10',
      inLibrary: false,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: null,
    });
    client.getAudiobookCover.mockResolvedValue(response);

    await expect(service.getAudiobookCover(makeUser({ id: 7 }), 'remote-10')).resolves.toBe(response);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('audiobook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.getAudiobookCover).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
    });
  });

  it('uses the live client for ebook download after verifying a cached ebook item exists', async () => {
    const response = {
      status: 200,
      contentType: 'application/epub+zip',
      contentLength: 3,
      body: Buffer.from('abc'),
      fileName: 'book.epub',
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'ebook' }));
    client.downloadBook.mockResolvedValue(response);

    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'ebook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });

    await expect(service.downloadEbook(makeUser({ id: 7 }), 'remote-10', 'bytes=0-499')).resolves.toBe(response);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.downloadBook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      range: 'bytes=0-499',
    });
    expect(repo.listEbookCatalog).not.toHaveBeenCalled();
  });

  it('allows visible cached ebook access and download without requiring an old user library row', async () => {
    const response = {
      status: 206,
      contentType: 'application/epub+zip',
      contentLength: 3,
      body: Buffer.from('abc'),
      fileName: 'book.epub',
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'ebook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'ebook',
      remoteId: 'remote-10',
      inLibrary: false,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: null,
    });
    client.downloadBook.mockResolvedValue(response);

    await expect(service.assertUserCanAccessEbook(makeUser({ id: 9 }), 'remote-10')).resolves.toBeUndefined();
    await expect(service.downloadEbook(makeUser({ id: 9 }), 'remote-10', 'bytes=0-499')).resolves.toBe(response);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.downloadBook).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      range: 'bytes=0-499',
    });
  });

  it('asserts source-backed ebook access through cached item existence without downloading media', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'ebook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'ebook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });

    await expect(service.assertUserCanAccessEbook(makeUser({ id: 7 }), 'remote-10')).resolves.toBeUndefined();

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.downloadBook).not.toHaveBeenCalled();
  });

  it('rejects source-backed ebook access when the cached item is missing', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(null);

    await expect(service.assertUserCanAccessEbook(makeUser({ id: 9 }), 'remote-10')).rejects.toThrow('Library item is not available.');

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.downloadBook).not.toHaveBeenCalled();
  });

  it('uses the live client for ebook covers after verifying the cached catalog item', async () => {
    const response = {
      status: 200,
      contentType: 'image/webp',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'ebook' }));
    client.getBookCover.mockResolvedValue(response);
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'ebook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });

    await expect(service.getEbookCover(makeUser({ id: 7 }), 'remote-10', 'medium')).resolves.toBe(response);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.getBookCover).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      size: 'medium',
    });
    expect(repo.listEbookCatalog).not.toHaveBeenCalled();
  });

  it('uses the live client for cached ebook covers without requiring a user item row', async () => {
    const response = {
      status: 200,
      contentType: 'image/webp',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'ebook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'ebook',
      remoteId: 'remote-10',
      inLibrary: false,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: null,
    });
    client.getBookCover.mockResolvedValue(response);

    await expect(service.getEbookCover(makeUser({ id: 7 }), 'remote-10', 'medium')).resolves.toBe(response);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(client.getBookCover).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      size: 'medium',
    });
  });

  it('returns cached ebook covers after verifying the cached catalog item without calling the live client', async () => {
    const cachedResponse = {
      status: 200,
      contentType: 'image/webp',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'ebook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'ebook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });
    coverCache.readEbookCover.mockResolvedValue(cachedResponse);

    await expect(service.getEbookCover(makeUser({ id: 7 }), 'remote-10', 'medium')).resolves.toBe(cachedResponse);

    expect(repo.findCatalogItem).toHaveBeenCalledWith('ebook', 'remote-10');
    expect(repo.getUserCatalogState).not.toHaveBeenCalled();
    expect(coverCache.readEbookCover).toHaveBeenCalledWith('https://catalog-source.example.test\nciphertext\nnonce\ntag', 'remote-10', 'medium');
    expect(client.getBookCover).not.toHaveBeenCalled();
  });

  it('falls back to the live ebook cover when the cache is unavailable', async () => {
    const response = {
      status: 200,
      contentType: 'image/webp',
      contentLength: 3,
      body: Buffer.from('img'),
      fileName: null,
    };
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'ebook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'ebook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });
    coverCache.readEbookCover.mockRejectedValue(new Error('disk unavailable'));
    coverCache.writeEbookCover.mockRejectedValue(new Error('disk unavailable'));
    client.getBookCover.mockResolvedValue(response);

    await expect(service.getEbookCover(makeUser({ id: 7 }), 'remote-10', 'medium')).resolves.toBe(response);

    expect(client.getBookCover).toHaveBeenCalledWith({
      baseUrl: 'https://catalog-source.example.test',
      apiKey: 'decrypted-api-key',
      id: 'remote-10',
      size: 'medium',
    });
  });

  it('wraps upstream binary failures in safe native error copy', async () => {
    repo.findSettings.mockResolvedValue(makeSettingsRow());
    repo.findCatalogItem.mockResolvedValue(makeCatalogItemRow({ mediaType: 'audiobook' }));
    repo.getUserCatalogState.mockResolvedValue({
      mediaType: 'audiobook',
      remoteId: 'remote-10',
      inLibrary: true,
      favorite: false,
      rating: null,
      readStatus: null,
      progressPercent: null,
      positionSeconds: null,
      updatedAt: UPDATED_AT,
    });
    client.downloadAudiobook.mockRejectedValue(new Error('catalog-source https://catalog-source.example.test apiKey=secret'));

    await expect(service.downloadAudiobook(makeUser({ id: 7 }), 'remote-10')).rejects.toThrow('Library media is temporarily unavailable.');
    await expect(service.downloadAudiobook(makeUser({ id: 7 }), 'remote-10')).rejects.not.toThrow('catalog-source');
    await expect(service.downloadAudiobook(makeUser({ id: 7 }), 'remote-10')).rejects.not.toThrow('apiKey');
  });
});
