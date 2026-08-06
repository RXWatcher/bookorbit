import type { CurrentlyReadingWidgetData, HighlightOfTheDayWidgetData, LibraryOverviewWidgetData, NeglectedGemsWidgetData } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { DashboardWidgetService } from './dashboard-widget.service';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

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
  const widgetRepo = {
    getCompletedBooksThisYear: vi.fn(),
    getCurrentlyReadingBooks: vi.fn(),
    getReadingStreak: vi.fn(),
    getReadingStreakDays: vi.fn(),
    getLibraryOverview: vi.fn(),
    getAnnotationCount: vi.fn(),
    getAnnotationByOffset: vi.fn(),
    getChallengePatternData: vi.fn(),
    getYearProjectionData: vi.fn(),
    getNeglectedGems: vi.fn(),
    getReadingDnaData: vi.fn(),
    getLongWait: vi.fn(),
    getDiversityData: vi.fn(),
    getReadingRhythmData: vi.fn(),
  };
  const libraryService = {
    findAccessibleLibraryIds: vi.fn(),
    findAll: vi.fn(),
  };
  const warehouseCatalogService = {
    getLibraryOverview: vi.fn(),
    getUserLibraryOverview: vi.fn(),
    getCurrentlyReading: vi.fn(),
    listReadingActivityDays: vi.fn(),
    getCompletedBooksThisYear: vi.fn().mockResolvedValue(0),
    getAnnotationCount: vi.fn().mockResolvedValue(0),
    getAnnotationByOffset: vi.fn(),
    getUserCatalogNeglectedGems: vi.fn(),
    getUserCatalogLongWait: vi.fn(),
    getUserCatalogDiversityData: vi.fn(),
    getUserCatalogYearProjectionData: vi.fn(),
    getUserCatalogReadingDnaData: vi.fn(),
    getUserCatalogChallengePatternData: vi.fn(),
  };

  const service = new DashboardWidgetService(widgetRepo as never, libraryService as never, warehouseCatalogService as never);
  return { service, widgetRepo, libraryService, warehouseCatalogService };
}

describe('DashboardWidgetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getReadingGoal', () => {
    it('returns goal and completed count for user with a reading goal', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({
        settings: { dashboardConfig: { readingGoal: 24, widgets: [] } },
      });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(7);
      warehouseCatalogService.getCompletedBooksThisYear.mockResolvedValue(3);

      const result = await service.getReadingGoal(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getCompletedBooksThisYear).toHaveBeenCalledWith(42, [1, 2], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getCompletedBooksThisYear).toHaveBeenCalledWith(42, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
      expect(result).toEqual({
        goalBooks: 24,
        completedBooks: 10,
        year: new Date().getUTCFullYear(),
      });
    });

    it('omits content filters for superuser source-backed reading goal counts', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ isSuperuser: true, settings: { dashboardConfig: { readingGoal: 12, widgets: [] } } });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(4);
      warehouseCatalogService.getCompletedBooksThisYear.mockResolvedValue(2);

      await expect(service.getReadingGoal(user)).resolves.toMatchObject({ completedBooks: 6 });

      expect(widgetRepo.getCompletedBooksThisYear).toHaveBeenCalledWith(42, [1], undefined);
      expect(warehouseCatalogService.getCompletedBooksThisYear).toHaveBeenCalledWith(42, undefined, ['audiobook']);
    });

    it('does not count source-backed reading goal completions when warehouse libraries are inaccessible', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(4);

      await expect(service.getReadingGoal(makeUser())).resolves.toMatchObject({ completedBooks: 4 });

      expect(widgetRepo.getCompletedBooksThisYear).toHaveBeenCalledWith(42, [1], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getCompletedBooksThisYear).not.toHaveBeenCalled();
    });

    it('returns null goalBooks when user has no reading goal set', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(0);

      const result = await service.getReadingGoal(makeUser());

      expect(result.goalBooks).toBeNull();
      expect(result.completedBooks).toBe(0);
    });

    it('returns null goalBooks when dashboardConfig exists but readingGoal is absent', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ settings: { dashboardConfig: { widgets: [] } } });
      libraryService.findAll.mockResolvedValue([]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(0);

      const result = await service.getReadingGoal(user);

      expect(result.goalBooks).toBeNull();
    });
  });

  describe('getCurrentlyReading', () => {
    it('delegates to widgetRepo with accessible library ids', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 7 });
      const mockData: CurrentlyReadingWidgetData = {
        books: [{ bookId: 10, title: 'Test Book', authors: ['Author'], progress: 45, hasCover: true }],
      };
      libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: 5 }]);
      widgetRepo.getCurrentlyReadingBooks.mockResolvedValue(mockData);

      const result = await service.getCurrentlyReading(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledWith(7, [3, 5], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getCurrentlyReading).not.toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    it('merges source-backed reading progress into the native currently reading widget', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 7 });
      libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getCurrentlyReadingBooks.mockResolvedValue({
        books: [
          {
            type: 'local-book',
            bookId: 10,
            title: 'Local Book',
            authors: ['Author'],
            progress: 45,
            hasCover: true,
            fileId: 99,
            fileFormat: 'epub',
            lastActivityAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      });
      warehouseCatalogService.getCurrentlyReading.mockResolvedValue({
        books: [
          {
            type: 'catalog-item',
            mediaType: 'audiobook',
            remoteId: 'audio-1',
            title: 'Cloud Audio',
            subtitle: null,
            authors: ['Cloud Author'],
            narrators: ['Narrator'],
            seriesName: null,
            libraryName: 'Audio Library',
            fileFormat: 'm4b',
            progress: 67,
            positionSeconds: 3600,
            hasCover: true,
            lastActivityAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      });

      const result = await service.getCurrentlyReading(user);

      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledWith(7, [3], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getCurrentlyReading).toHaveBeenCalledWith(7, EMPTY_CONTENT_FILTER_RULES, ['audiobook']);
      expect(result.books.map((book) => book.title)).toEqual(['Cloud Audio', 'Local Book']);
      expect(JSON.stringify(result)).not.toContain('catalog-source');
      expect(result.books[0]).not.toHaveProperty('rawPayload');
    });

    it('does not query source-backed currently reading when source-backed libraries are inaccessible', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 7 });
      libraryService.findAll.mockResolvedValue([{ id: 3 }]);
      widgetRepo.getCurrentlyReadingBooks.mockResolvedValue({ books: [] });

      await service.getCurrentlyReading(user);

      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledWith(7, [3], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getCurrentlyReading).not.toHaveBeenCalled();
    });
  });

  describe('getReadingStreak', () => {
    it('combines local and source-backed reading days through normal library access', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 99 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      widgetRepo.getReadingStreakDays.mockResolvedValue(['2026-06-03']);
      warehouseCatalogService.listReadingActivityDays.mockResolvedValue(['2026-06-04']);

      try {
        const result = await service.getReadingStreak(user);

        expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
        expect(widgetRepo.getReadingStreakDays).toHaveBeenCalledWith(99, [1], EMPTY_CONTENT_FILTER_RULES);
        expect(warehouseCatalogService.listReadingActivityDays).toHaveBeenCalledWith(99, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
        expect(widgetRepo.getReadingStreak).not.toHaveBeenCalled();
        expect(result).toEqual({
          currentStreak: 2,
          longestStreak: 2,
          lastSevenDays: [false, false, false, false, false, true, true],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not query source-backed reading days when source-backed libraries are inaccessible', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getReadingStreakDays.mockResolvedValue([]);

      await service.getReadingStreak(makeUser({ id: 99 }));

      expect(widgetRepo.getReadingStreakDays).toHaveBeenCalledWith(99, [1], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.listReadingActivityDays).not.toHaveBeenCalled();
    });
  });

  describe('getLibraryOverview', () => {
    it('merges local and cached source-backed library overview counts', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 55 });
      const mockData: LibraryOverviewWidgetData = {
        totalBooks: 500,
        totalAuthors: 120,
        totalSeries: 30,
        totalStorageBytes: 5000000000,
        booksAddedThisYear: 45,
      };
      libraryService.findAll.mockResolvedValue([{ id: 10 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      widgetRepo.getLibraryOverview.mockResolvedValue(mockData);
      warehouseCatalogService.getLibraryOverview.mockResolvedValue({
        totalBooks: 20,
        totalAuthors: 12,
        totalSeries: 4,
        totalStorageBytes: 0,
        booksAddedThisYear: 3,
      });

      const result = await service.getLibraryOverview(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledWith([10], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getLibraryOverview).toHaveBeenCalledWith(EMPTY_CONTENT_FILTER_RULES, ['ebook']);
      expect(warehouseCatalogService.getUserLibraryOverview).not.toHaveBeenCalled();
      expect(result).toEqual({
        totalBooks: 520,
        totalAuthors: 132,
        totalSeries: 34,
        totalStorageBytes: 5000000000,
        booksAddedThisYear: 48,
      });
    });

    it('does not add source-backed overview counts when source-backed libraries are inaccessible', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 55 });
      libraryService.findAll.mockResolvedValue([{ id: 10 }]);
      widgetRepo.getLibraryOverview.mockResolvedValue({
        totalBooks: 12,
        totalAuthors: 8,
        totalSeries: 3,
        totalStorageBytes: 1024,
        booksAddedThisYear: 1,
      });

      const result = await service.getLibraryOverview(user);

      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledWith([10], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserLibraryOverview).not.toHaveBeenCalled();
      expect(warehouseCatalogService.getLibraryOverview).not.toHaveBeenCalled();
      expect(result).toEqual({
        totalBooks: 12,
        totalAuthors: 8,
        totalSeries: 3,
        totalStorageBytes: 1024,
        booksAddedThisYear: 1,
      });
    });
  });

  describe('getHighlightOfTheDay', () => {
    it('returns null when no annotations exist', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getAnnotationCount.mockResolvedValue(0);
      warehouseCatalogService.getAnnotationCount.mockResolvedValue(0);

      const result = await service.getHighlightOfTheDay(makeUser());
      expect(result).toBeNull();
      expect(warehouseCatalogService.getAnnotationCount).not.toHaveBeenCalled();
      expect(widgetRepo.getAnnotationByOffset).not.toHaveBeenCalled();
      expect(warehouseCatalogService.getAnnotationByOffset).not.toHaveBeenCalled();
    });

    it('fetches annotation by offset when annotations exist', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getAnnotationCount.mockResolvedValue(10);
      widgetRepo.getAnnotationByOffset.mockResolvedValue({
        text: 'A great quote',
        note: null,
        bookTitle: 'Test Book',
        bookId: 5,
        hasCover: true,
        chapterTitle: 'Chapter 1',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await service.getHighlightOfTheDay(makeUser());
      expect(result).not.toBeNull();
      expect(result!.text).toBe('A great quote');
      expect(widgetRepo.getAnnotationByOffset).toHaveBeenCalled();
      expect(warehouseCatalogService.getAnnotationByOffset).not.toHaveBeenCalled();
    });

    it('samples source-backed annotations when the warehouse libraries contain the selected highlight', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const sourceHighlight: HighlightOfTheDayWidgetData = {
        type: 'catalog-item',
        text: 'Cloud quote',
        note: 'Saved from warehouse reader',
        bookTitle: 'Warehouse Book',
        bookId: null,
        mediaType: 'ebook',
        remoteId: 'ebook-1',
        libraryName: 'Ebook Library',
        hasCover: true,
        chapterTitle: 'Chapter 7',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      widgetRepo.getAnnotationCount.mockResolvedValue(0);
      warehouseCatalogService.getAnnotationCount.mockResolvedValue(1);
      warehouseCatalogService.getAnnotationByOffset.mockResolvedValue(sourceHighlight);

      const result = await service.getHighlightOfTheDay(makeUser({ id: 7 }));

      expect(result).toEqual(sourceHighlight);
      expect(warehouseCatalogService.getAnnotationCount).toHaveBeenCalledWith(7, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
      expect(warehouseCatalogService.getAnnotationByOffset).toHaveBeenCalledWith(7, 0, EMPTY_CONTENT_FILTER_RULES, ['ebook']);
      expect(widgetRepo.getAnnotationByOffset).not.toHaveBeenCalled();
    });

    it('uses the source-backed offset after local annotations in the mixed highlight pool', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getAnnotationCount.mockResolvedValue(1);
      warehouseCatalogService.getAnnotationCount.mockResolvedValue(1);
      widgetRepo.getAnnotationByOffset.mockResolvedValue({
        text: 'Local quote',
        note: null,
        bookTitle: 'Local Book',
        bookId: 5,
        hasCover: true,
        chapterTitle: 'Chapter 1',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      warehouseCatalogService.getAnnotationByOffset.mockResolvedValue({
        type: 'catalog-item',
        text: 'Cloud quote',
        note: null,
        bookTitle: 'Cloud Book',
        bookId: null,
        mediaType: 'audiobook',
        remoteId: 'audio-1',
        libraryName: 'Audio Library',
        hasCover: true,
        chapterTitle: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      });

      const userIdThatPicksSecondItem = 5;
      try {
        const result = await service.getHighlightOfTheDay(makeUser({ id: userIdThatPicksSecondItem }));

        expect(result?.text).toBe('Cloud quote');
        expect(widgetRepo.getAnnotationByOffset).not.toHaveBeenCalled();
        expect(warehouseCatalogService.getAnnotationByOffset).toHaveBeenCalledWith(userIdThatPicksSecondItem, 0, EMPTY_CONTENT_FILTER_RULES, [
          'audiobook',
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not count source-backed annotations when warehouse libraries are inaccessible', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getAnnotationCount.mockResolvedValue(0);

      await expect(service.getHighlightOfTheDay(makeUser({ id: 7 }))).resolves.toBeNull();

      expect(widgetRepo.getAnnotationCount).toHaveBeenCalledWith(7, [1], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getAnnotationCount).not.toHaveBeenCalled();
      expect(warehouseCatalogService.getAnnotationByOffset).not.toHaveBeenCalled();
    });
  });

  describe('getMonthlyChallenge', () => {
    it('merges source-backed challenge progress through normal library access', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 88 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getChallengePatternData.mockResolvedValue({
        avgPageCount: 200,
        uniqueGenresLast6Months: 6,
        staleInProgressCount: 0,
        currentStreak: 1,
        maxStreakThisMonth: 5,
        topAuthorBookCount: 1,
        totalBooksRead: 4,
        pagesThisMonth: 200,
        shortBooksCompleted: 0,
        newGenresRead: 0,
        oldestInProgressFinished: false,
        newAuthorsRead: 0,
        pagesReadThisMonth: 200,
        genresLast6Months: ['fantasy', 'mystery', 'romance', 'sci-fi', 'thriller', 'western'],
        genresReadThisMonth: [],
        authorsReadThisMonth: [],
        readingDaysThisMonth: ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'],
      });
      warehouseCatalogService.getUserCatalogChallengePatternData.mockResolvedValue({
        avgPageCount: 200,
        uniqueGenresLast6Months: 1,
        staleInProgressCount: 0,
        currentStreak: 0,
        maxStreakThisMonth: 1,
        topAuthorBookCount: 1,
        totalBooksRead: 2,
        pagesThisMonth: 350,
        shortBooksCompleted: 0,
        newGenresRead: 0,
        oldestInProgressFinished: false,
        newAuthorsRead: 0,
        pagesReadThisMonth: 350,
        genresLast6Months: ['mystery'],
        genresReadThisMonth: [],
        authorsReadThisMonth: [],
        readingDaysThisMonth: ['2026-06-05'],
      });

      const result = await service.getMonthlyChallenge(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getChallengePatternData).toHaveBeenCalledWith(88, [1], expect.any(Date), expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogChallengePatternData).toHaveBeenCalledWith(
        88,
        expect.any(Date),
        expect.any(Date),
        EMPTY_CONTENT_FILTER_RULES,
        ['ebook', 'audiobook'],
      );
      expect(result.challengeType).toBe('page-milestone');
      expect(result.progress).toBe(500);
      expect(result.completed).toBe(true);
    });

    it('returns a challenge with computed progress', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getChallengePatternData.mockResolvedValue({
        avgPageCount: 300,
        uniqueGenresLast6Months: 3,
        staleInProgressCount: 1,
        currentStreak: 2,
        maxStreakThisMonth: 3,
        topAuthorBookCount: 5,
        totalBooksRead: 20,
        pagesThisMonth: 200,
        shortBooksCompleted: 1,
        newGenresRead: 0,
        oldestInProgressFinished: false,
        newAuthorsRead: 1,
        pagesReadThisMonth: 200,
      });

      const result = await service.getMonthlyChallenge(makeUser());
      expect(widgetRepo.getChallengePatternData).toHaveBeenCalledWith(42, [1], expect.any(Date), expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(result.challengeType).toBeTruthy();
      expect(result.title).toBeTruthy();
      expect(result.target).toBeGreaterThan(0);
      expect(typeof result.completed).toBe('boolean');
    });

    it('marks finish-oldest challenge complete when oldestInProgressFinished is true', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getChallengePatternData.mockResolvedValue({
        avgPageCount: 200,
        uniqueGenresLast6Months: 10,
        staleInProgressCount: 1,
        currentStreak: 10,
        maxStreakThisMonth: 10,
        topAuthorBookCount: 1,
        totalBooksRead: 20,
        pagesThisMonth: 0,
        shortBooksCompleted: 0,
        newGenresRead: 0,
        oldestInProgressFinished: true,
        newAuthorsRead: 0,
        pagesReadThisMonth: 0,
      });

      const result = await service.getMonthlyChallenge(makeUser());
      if (result.challengeType === 'finish-oldest') {
        expect(result.completed).toBe(true);
        expect(result.progress).toBe(1);
      }
    });
  });

  describe('getYearProjection', () => {
    it('merges source-backed library projection data through normal library access', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 88 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getYearProjectionData.mockResolvedValue({
        booksCompletedYtd: 10,
        pagesReadLast30Days: 900,
        hoursReadLast30Days: 30,
        booksCompletedLast30Days: 3,
      });
      warehouseCatalogService.getUserCatalogYearProjectionData.mockResolvedValue({
        booksCompletedYtd: 2,
        pagesReadLast30Days: 400,
        hoursReadLast30Days: 5,
        booksCompletedLast30Days: 1,
      });

      const result = await service.getYearProjection(user);
      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getYearProjectionData).toHaveBeenCalledWith(88, [1], expect.any(Date), expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogYearProjectionData).toHaveBeenCalledWith(
        88,
        expect.any(Date),
        expect.any(Date),
        EMPTY_CONTENT_FILTER_RULES,
        ['ebook', 'audiobook'],
      );
      expect(result.booksCompletedYtd).toBe(12);
      expect(result.projectedBooks).toBeGreaterThanOrEqual(12);
      expect(result.daysRemaining).toBeGreaterThan(0);
    });

    it('does not query source-backed projection data when source-backed libraries are inaccessible', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getYearProjectionData.mockResolvedValue({
        booksCompletedYtd: 10,
        pagesReadLast30Days: 900,
        hoursReadLast30Days: 30,
        booksCompletedLast30Days: 3,
      });

      const result = await service.getYearProjection(makeUser());
      expect(widgetRepo.getYearProjectionData).toHaveBeenCalledWith(42, [1], expect.any(Date), expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogYearProjectionData).not.toHaveBeenCalled();
      expect(result.booksCompletedYtd).toBe(10);
      expect(result.projectedBooks).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getNeglectedGems', () => {
    it('merges source-backed gems through normal library access', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 88 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getNeglectedGems.mockResolvedValue({
        gems: [{ bookId: 10, title: 'Local Gem', hasCover: true, rating: 5, waitingDays: 20, genre: 'Fantasy' }],
      });
      warehouseCatalogService.getUserCatalogNeglectedGems.mockResolvedValue({
        gems: [
          {
            type: 'catalog-item',
            bookId: 900,
            mediaType: 'ebook',
            remoteId: 'ebook-900',
            title: 'Cloud Gem',
            hasCover: true,
            rating: 4,
            waitingDays: 40,
            genre: 'Mystery',
          },
        ],
      });

      const result = await service.getNeglectedGems(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getNeglectedGems).toHaveBeenCalledWith(88, [1], expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogNeglectedGems).toHaveBeenCalledWith(88, expect.any(Date), EMPTY_CONTENT_FILTER_RULES, [
        'ebook',
        'audiobook',
      ]);
      expect(result.gems.map((gem) => gem.title)).toEqual(['Cloud Gem', 'Local Gem']);
    });

    it('delegates to repo and returns result', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const mockData: NeglectedGemsWidgetData = {
        gems: [{ bookId: 1, title: 'Gem', hasCover: true, rating: 5, waitingDays: 100, genre: 'Fantasy' }],
      };
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getNeglectedGems.mockResolvedValue(mockData);

      const result = await service.getNeglectedGems(makeUser());
      expect(widgetRepo.getNeglectedGems).toHaveBeenCalledWith(42, [1], expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogNeglectedGems).not.toHaveBeenCalled();
      expect(result.gems).toHaveLength(1);
    });
  });

  describe('getReadingDna', () => {
    it('merges source-backed library DNA data through normal library access', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 88 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getReadingDnaData.mockResolvedValue({
        avgPageCount: 300,
        uniqueGenres: 2,
        totalBooks: 4,
        readingDaysRatio: 1 / 180,
        peakHour: 21,
        avgPagesPerHour: 120,
        genresRead: ['fantasy', 'mystery'],
        readingDays: ['2026-06-01'],
        lookbackDays: 180,
        hourBuckets: [{ hour: 21, totalSeconds: 3600 }],
        pagesReadForSpeed: 120,
        secondsReadForSpeed: 3600,
      });
      warehouseCatalogService.getUserCatalogReadingDnaData.mockResolvedValue({
        avgPageCount: 400,
        uniqueGenres: 2,
        totalBooks: 2,
        readingDaysRatio: 2 / 180,
        peakHour: 19,
        avgPagesPerHour: null,
        genresRead: ['mystery', 'sci-fi'],
        readingDays: ['2026-06-01', '2026-06-02'],
        lookbackDays: 180,
        hourBuckets: [{ hour: 19, totalSeconds: 10 }],
        pagesReadForSpeed: 0,
        secondsReadForSpeed: 0,
      });

      const result = await service.getReadingDna(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getReadingDnaData).toHaveBeenCalledWith(88, [1], expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogReadingDnaData).toHaveBeenCalledWith(88, expect.any(Date), EMPTY_CONTENT_FILTER_RULES, [
        'ebook',
        'audiobook',
      ]);
      expect(result.booksAnalyzed).toBe(6);
      expect(result.lengthScore).toBe(67);
      expect(result.varietyScore).toBe(100);
      expect(result.rhythmScore).toBe(1);
      expect(result.timeLabel).toBe('Evening');
      expect(result.speedScore).toBe(100);
    });

    it('computes DNA from raw repo data', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getReadingDnaData.mockResolvedValue({
        avgPageCount: 350,
        uniqueGenres: 8,
        totalBooks: 25,
        readingDaysRatio: 0.7,
        peakHour: 21,
        avgPagesPerHour: 45,
      });

      const result = await service.getReadingDna(makeUser());
      expect(warehouseCatalogService.getUserCatalogReadingDnaData).not.toHaveBeenCalled();
      expect(result.archetype).toBeTruthy();
      expect(result.booksAnalyzed).toBe(25);
      expect(result.timeLabel).toBe('Evening');
      expect(result.speedLabel).toBe('Steady Pacer');
      expect(result.speedScore).toBe(56);
    });

    it('returns speedLabel N/A when no speed data is available', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getReadingDnaData.mockResolvedValue({
        avgPageCount: 350,
        uniqueGenres: 8,
        totalBooks: 25,
        readingDaysRatio: 0.7,
        peakHour: 21,
        avgPagesPerHour: null,
      });

      const result = await service.getReadingDna(makeUser());
      expect(result.speedLabel).toBe('N/A');
      expect(result.speedScore).toBe(0);
    });
  });

  describe('getLongWait', () => {
    it('merges source-backed long-wait candidates through normal library access', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 88 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getLongWait.mockResolvedValue({
        bookId: 7,
        title: 'Local Old Book',
        hasCover: false,
        addedAt: '2026-05-15T00:00:00.000Z',
        waitingDays: 20,
        pageCount: 400,
        genre: 'Mystery',
        fileId: 70,
        fileFormat: 'epub',
      });
      warehouseCatalogService.getUserCatalogLongWait.mockResolvedValue({
        type: 'catalog-item',
        bookId: 901,
        mediaType: 'ebook',
        remoteId: 'ebook-901',
        title: 'Cloud Old Book',
        hasCover: true,
        addedAt: '2026-04-25T00:00:00.000Z',
        waitingDays: 40,
        pageCount: 320,
        genre: 'Fantasy',
        fileId: null,
        fileFormat: 'epub',
      });

      const result = await service.getLongWait(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getLongWait).toHaveBeenCalledWith(88, [1], expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogLongWait).toHaveBeenCalledWith(88, expect.any(Date), EMPTY_CONTENT_FILTER_RULES, [
        'ebook',
        'audiobook',
      ]);
      expect(result?.title).toBe('Cloud Old Book');
    });

    it('returns null when repo returns null', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getLongWait.mockResolvedValue(null);

      const result = await service.getLongWait(makeUser());
      expect(widgetRepo.getLongWait).toHaveBeenCalledWith(42, [1], expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogLongWait).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns book data when found', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getLongWait.mockResolvedValue({
        bookId: 7,
        title: 'Old Book',
        hasCover: false,
        addedAt: '2024-01-01T00:00:00.000Z',
        waitingDays: 847,
        pageCount: 400,
        genre: 'Mystery',
      });

      const result = await service.getLongWait(makeUser());
      expect(result!.bookId).toBe(7);
      expect(result!.waitingDays).toBe(847);
    });
  });

  describe('getDiversityScore', () => {
    it('merges source-backed library diversity data through normal library access', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 88 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getDiversityData.mockResolvedValue({
        uniqueGenresRead: 2,
        totalGenresInLibrary: 3,
        uniqueAuthorsRead: 2,
        totalBooksRead: 4,
        publicationYears: [1990],
        uniqueLanguages: 1,
        genresRead: ['fantasy', 'mystery'],
        genresInLibrary: ['fantasy', 'mystery', 'romance'],
        authorsRead: ['ada', 'becky'],
        languagesRead: ['en'],
      });
      warehouseCatalogService.getUserCatalogDiversityData.mockResolvedValue({
        uniqueGenresRead: 2,
        totalGenresInLibrary: 3,
        uniqueAuthorsRead: 2,
        totalBooksRead: 6,
        publicationYears: [2020],
        uniqueLanguages: 2,
        genresRead: ['mystery', 'sci-fi'],
        genresInLibrary: ['mystery', 'sci-fi', 'romance'],
        authorsRead: ['becky', 'chen'],
        languagesRead: ['en', 'fr'],
      });

      const result = await service.getDiversityScore(user);

      expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
      expect(widgetRepo.getDiversityData).toHaveBeenCalledWith(88, [1], EMPTY_CONTENT_FILTER_RULES);
      expect(warehouseCatalogService.getUserCatalogDiversityData).toHaveBeenCalledWith(88, EMPTY_CONTENT_FILTER_RULES, ['ebook', 'audiobook']);
      expect(result.booksAnalyzed).toBe(10);
      expect(result.genreScore).toBe(75);
      expect(result.authorScore).toBe(30);
      expect(result.eraScore).toBe(30);
      expect(result.languageScore).toBe(40);
      expect(result.score).toBe(44);
    });

    it('computes diversity from raw data', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getDiversityData.mockResolvedValue({
        uniqueGenresRead: 5,
        totalGenresInLibrary: 10,
        uniqueAuthorsRead: 8,
        totalBooksRead: 15,
        publicationYears: [1990, 2020],
        uniqueLanguages: 3,
      });

      const result = await service.getDiversityScore(makeUser());
      expect(libraryService.findAll).toHaveBeenCalledWith(expect.any(Object), { includeSourceBacked: true });
      expect(warehouseCatalogService.getUserCatalogDiversityData).not.toHaveBeenCalled();
      expect(result.genreScore).toBe(50);
      expect(result.authorScore).toBe(53);
      expect(result.eraScore).toBe(30);
      expect(result.languageScore).toBe(60);
      expect(result.score).toBe(48);
      expect(result.booksAnalyzed).toBe(15);
    });
  });

  describe('getReadingRhythm', () => {
    it('combines local and source-backed activity days through normal library access', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      const user = makeUser({ id: 99 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([{ day: '2026-06-03', readingSeconds: 600 }]);
      warehouseCatalogService.listReadingActivityDays.mockResolvedValue(['2026-06-03', '2026-06-04']);

      try {
        const result = await service.getReadingRhythm(user);

        expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
        expect(widgetRepo.getReadingRhythmData).toHaveBeenCalledWith(99, [1], '2026-05-22', EMPTY_CONTENT_FILTER_RULES);
        expect(warehouseCatalogService.listReadingActivityDays).toHaveBeenCalledWith(99, EMPTY_CONTENT_FILTER_RULES, ['ebook', 'audiobook']);
        expect(result.activeDays).toBe(2);
        expect(result.days.find((day) => day.date === '2026-06-03')?.readingSeconds).toBe(600);
        expect(result.days.find((day) => day.date === '2026-06-04')?.readingSeconds).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('fills missing days and computes consistency', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([{ day: new Date().toISOString().slice(0, 10), readingSeconds: 600 }]);

      const result = await service.getReadingRhythm(makeUser());
      expect(libraryService.findAll).toHaveBeenCalledWith(expect.any(Object), { includeSourceBacked: true });
      expect(warehouseCatalogService.listReadingActivityDays).not.toHaveBeenCalled();
      expect(result.days).toHaveLength(14);
      expect(result.totalDays).toBe(14);
      expect(result.activeDays).toBeGreaterThanOrEqual(1);
    });

    it('returns all zeroes when no reading data', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([]);

      const result = await service.getReadingRhythm(makeUser());
      expect(warehouseCatalogService.listReadingActivityDays).not.toHaveBeenCalled();
      expect(result.days).toHaveLength(14);
      expect(result.activeDays).toBe(0);
      expect(result.consistencyPercent).toBe(0);
    });
  });

  describe('caching', () => {
    it('live cache: second call to getReadingStreak does not hit repo', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getReadingStreakDays.mockResolvedValue(['2026-06-04']);

      const user = makeUser();
      await service.getReadingStreak(user);
      await service.getReadingStreak(user);

      expect(widgetRepo.getReadingStreakDays).toHaveBeenCalledTimes(1);
    });

    it('stale cache: second call to getLibraryOverview does not hit repo', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
      widgetRepo.getLibraryOverview.mockResolvedValue({
        totalBooks: 100,
        totalAuthors: 20,
        totalSeries: 5,
        totalStorageBytes: 1024,
        booksAddedThisYear: 8,
      });
      warehouseCatalogService.getLibraryOverview.mockResolvedValue({
        totalBooks: 10,
        totalAuthors: 4,
        totalSeries: 2,
        totalStorageBytes: 0,
        booksAddedThisYear: 10,
      });

      const user = makeUser();
      await service.getLibraryOverview(user);
      await service.getLibraryOverview(user);

      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledTimes(1);
      expect(warehouseCatalogService.getLibraryOverview).toHaveBeenCalledTimes(1);
    });

    it('getReadingGoal returns fresh goalBooks from user settings but reuses cached completedBooks', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(5);

      const userWithOldGoal = makeUser({ settings: { dashboardConfig: { readingGoal: 12, widgets: [] } } });
      const userWithNewGoal = makeUser({ settings: { dashboardConfig: { readingGoal: 24, widgets: [] } } });

      const first = await service.getReadingGoal(userWithOldGoal);
      const second = await service.getReadingGoal(userWithNewGoal);

      expect(widgetRepo.getCompletedBooksThisYear).toHaveBeenCalledTimes(1);
      expect(first.goalBooks).toBe(12);
      expect(second.goalBooks).toBe(24);
      expect(second.completedBooks).toBe(5);
    });

    it('cache is scoped per user: different users get independent cache entries', async () => {
      const { service, widgetRepo, libraryService, warehouseCatalogService } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_AUDIO_LIBRARY_ID }]);
      widgetRepo.getLibraryOverview.mockResolvedValue({
        totalBooks: 100,
        totalAuthors: 20,
        totalSeries: 5,
        totalStorageBytes: 1024,
        booksAddedThisYear: 8,
      });
      warehouseCatalogService.getLibraryOverview.mockResolvedValue({
        totalBooks: 10,
        totalAuthors: 4,
        totalSeries: 2,
        totalStorageBytes: 0,
        booksAddedThisYear: 10,
      });

      const userA = makeUser();
      const userB = makeUser({ id: 99 });

      await service.getLibraryOverview(userA);
      await service.getLibraryOverview(userB);
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledTimes(2);
      expect(warehouseCatalogService.getLibraryOverview).toHaveBeenCalledTimes(2);

      await service.getLibraryOverview(userA);
      await service.getLibraryOverview(userB);
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledTimes(2);
      expect(warehouseCatalogService.getLibraryOverview).toHaveBeenCalledTimes(2);
    });
  });
});
