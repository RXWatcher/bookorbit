import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CLOUD_EBOOK_LIBRARY_ID, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

vi.mock('../book/utils/assemble-book-cards', () => ({
  assembleBookCards: vi.fn(),
}));

import { assembleBookCards } from '../book/utils/assemble-book-cards';

import { AUTHOR_ENRICHMENT_REASONS } from './author-enrichment-reasons';
import { AuthorsService } from './authors.service';

function reqUser(id = 7, superuser = false) {
  return { id, isSuperuser: superuser, permissions: [], contentFilters: undefined } as any;
}

describe('AuthorsService', () => {
  const authorsRepo = {
    findPage: vi.fn(),
    findSummaries: vi.fn(),
    findById: vi.fn(),
    findBookIdsPage: vi.fn(),
    updateAuthorById: vi.fn(),
    findVisibleAuthorIds: vi.fn(),
    countDistinctBooks: vi.fn(),
    findBookIdsByAuthorIds: vi.fn(),
    mergeAuthors: vi.fn(),
    deleteAuthors: vi.fn(),
    findRelatedLibraryIds: vi.fn(),
    findByIdForEnrichment: vi.fn(),
    updateAuthorDescriptionIfEmpty: vi.fn(),
    countAuthors: vi.fn(),
  };

  const bookRepo = {
    findCards: vi.fn(),
  };

  const libraryService = {
    findAll: vi.fn(),
    findAccessibleLibraryIds: vi.fn(),
  };

  const warehouseCatalogService = {
    listAuthorSummaries: vi.fn(),
    listAuthorSummaryPage: vi.fn(),
    findAuthorSummaryById: vi.fn(),
    listAuthorItems: vi.fn(),
    listAuthorBooks: vi.fn(),
  };

  const authorMetadataFetchService = {
    listProviders: vi.fn(),
    search: vi.fn(),
    lookupById: vi.fn(),
    stream: vi.fn(),
    quickSearch: vi.fn(),
  };

  const authorImageStorage = {
    saveFromUrl: vi.fn(),
    saveFromBuffer: vi.fn(),
    getThumbnailPath: vi.fn(),
    getThumbnailUrlIfExists: vi.fn(),
    getImagePath: vi.fn(),
    getImageUrlIfExists: vi.fn(),
    deleteAuthorDir: vi.fn(),
  };

  const enrichmentExecutor = {
    execute: vi.fn(),
  };

  const enrichmentOrchestrator = {
    schedule: vi.fn(),
    backfillLinkedAuthors: vi.fn(),
  };

  const appSettings = {
    getAuthorsAutoEnrichmentWriteMode: vi.fn(),
  };
  const metadataScoreService = {
    calculateAndSaveMany: vi.fn(),
  };

  let service: AuthorsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AuthorsService(
      authorsRepo as any,
      bookRepo as any,
      libraryService as any,
      appSettings as any,
      authorMetadataFetchService as any,
      authorImageStorage as any,
      enrichmentExecutor as any,
      enrichmentOrchestrator as any,
      warehouseCatalogService as any,
      metadataScoreService as any,
    );
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    warehouseCatalogService.listAuthorSummaries.mockResolvedValue([]);
    warehouseCatalogService.listAuthorSummaryPage.mockResolvedValue({ rows: [], total: 0, page: 0, size: 50 });
    warehouseCatalogService.findAuthorSummaryById.mockResolvedValue(null);
    warehouseCatalogService.listAuthorItems.mockResolvedValue({ items: [], total: 0 });
    warehouseCatalogService.listAuthorBooks.mockResolvedValue({ items: [], total: 0 });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue(null);
    authorImageStorage.getImageUrlIfExists.mockResolvedValue(null);
    enrichmentOrchestrator.schedule.mockResolvedValue(1);
    enrichmentOrchestrator.backfillLinkedAuthors.mockResolvedValue(8);
    appSettings.getAuthorsAutoEnrichmentWriteMode.mockResolvedValue('missing_only');
    metadataScoreService.calculateAndSaveMany.mockResolvedValue(undefined);
    vi.mocked(assembleBookCards).mockReturnValue([]);
  });

  it('countAll counts authors across the accessible libraries', async () => {
    authorsRepo.countAuthors.mockResolvedValue(1234);

    await expect(service.countAll(reqUser())).resolves.toBe(1234);
    expect(authorsRepo.countAuthors).toHaveBeenCalledWith({ libraryIds: [1, 2], contentFilters: undefined });
  });

  it('countAll skips the query when the user has no library access', async () => {
    libraryService.findAccessibleLibraryIds.mockResolvedValue([]);

    await expect(service.countAll(reqUser())).resolves.toBe(0);
    expect(authorsRepo.countAuthors).not.toHaveBeenCalled();
  });

  it('merge rejects when sources do not contain any id different from target', async () => {
    await expect(service.merge(reqUser(7, true), { targetAuthorId: 10, sourceAuthorIds: [10, 10] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merge requires superuser', async () => {
    await expect(service.merge(reqUser(), { targetAuthorId: 10, sourceAuthorIds: [11] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delete requires superuser', async () => {
    await expect(service.delete(reqUser(), { authorIds: [11] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('merge blocks mutation when selected authors are linked to inaccessible libraries', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([10, 11]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1, 999]);

    await expect(service.merge(reqUser(7, true), { targetAuthorId: 10, sourceAuthorIds: [11] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorsRepo.mergeAuthors).not.toHaveBeenCalled();
  });

  it('delete removes authors and returns impacted count', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([10, 11]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1, 2]);
    authorsRepo.findBookIdsByAuthorIds.mockResolvedValue([1, 2, 3, 4, 5, 6]);
    authorsRepo.deleteAuthors.mockResolvedValue(undefined);

    const result = await service.delete(reqUser(7, true), { authorIds: [10, 11, 11] });

    expect(authorsRepo.deleteAuthors).toHaveBeenCalledWith([10, 11]);
    expect(metadataScoreService.calculateAndSaveMany).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6]);
    expect(result.deletedAuthorIds).toEqual([10, 11]);
    expect(result.affectedBookCount).toBe(6);
  });

  it('merge deduplicates sources, merges, and returns impacted count', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([10, 11, 12]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1, 2]);
    authorsRepo.findBookIdsByAuthorIds.mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8]);
    authorsRepo.mergeAuthors.mockResolvedValue(undefined);
    authorsRepo.findById.mockResolvedValue({
      id: 10,
      name: 'Target',
      sortName: 'Target',
      description: null,
      bookCount: 3,
      lastAddedAt: null,
    });

    const result = await service.merge(reqUser(7, true), { targetAuthorId: 10, sourceAuthorIds: [10, 11, 11, 12] });

    expect(authorsRepo.mergeAuthors).toHaveBeenCalledWith(10, [11, 12]);
    expect(metadataScoreService.calculateAndSaveMany).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(enrichmentOrchestrator.schedule).toHaveBeenCalledWith(10, AUTHOR_ENRICHMENT_REASONS.AUTHOR_MERGE_TARGET);
    expect(result.mergedAuthorIds).toEqual([11, 12]);
    expect(result.affectedBookCount).toBe(8);
  });

  it('update normalizes author names and blank optional fields', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([20]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorsRepo.updateAuthorById.mockResolvedValue({ id: 20, name: 'Updated', sortName: null, description: 'Bio' });
    authorsRepo.findById.mockResolvedValue({
      id: 20,
      name: 'Updated',
      sortName: null,
      description: 'Bio',
      bookCount: 4,
      lastAddedAt: null,
    });

    await service.update(reqUser(), 20, {
      name: '  Updated   Author  ',
      sortName: '  Author,\tUpdated  ',
      description: '  Bio  ',
    });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(20, {
      name: 'Updated Author',
      sortName: 'Author, Updated',
      description: 'Bio',
    });
    expect(enrichmentOrchestrator.schedule).toHaveBeenCalledWith(20, AUTHOR_ENRICHMENT_REASONS.AUTHOR_RENAME);
  });

  it('findOne returns not found when author is outside user-accessible libraries', async () => {
    authorsRepo.findById.mockResolvedValue(null);
    await expect(service.findOne(reqUser(), 404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refreshEnrichment fills description when missing and returns updated author', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([20]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    enrichmentExecutor.execute.mockResolvedValue({
      kind: 'done',
      provider: 'audnexus',
      descriptionUpdated: true,
      imageUpdated: false,
    });
    authorsRepo.findById.mockResolvedValue({
      id: 20,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: 'Provider description',
      bookCount: 2,
      lastAddedAt: null,
    });

    const result = await service.refreshEnrichment(reqUser(), 20);

    expect(enrichmentExecutor.execute).toHaveBeenCalledWith({
      authorId: 20,
      writeMode: 'missing_only',
      audnexusEnabled: true,
    });
    expect(result.description).toBe('Provider description');
  });

  it('refreshEnrichment stores fetched author image on disk when provider returns one', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([21]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    enrichmentExecutor.execute.mockResolvedValue({
      kind: 'done',
      provider: 'audnexus',
      descriptionUpdated: false,
      imageUpdated: true,
    });
    authorsRepo.findById.mockResolvedValue({
      id: 21,
      name: 'John Doe',
      sortName: 'Doe, John',
      description: 'Existing bio',
      bookCount: 4,
      lastAddedAt: null,
    });

    await service.refreshEnrichment(reqUser(), 21);

    expect(enrichmentExecutor.execute).toHaveBeenCalledWith({
      authorId: 21,
      writeMode: 'missing_only',
      audnexusEnabled: true,
    });
  });

  it('refreshEnrichment throws when provider fails so callers can surface failure', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([22]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    enrichmentExecutor.execute.mockResolvedValue({
      kind: 'failed',
      provider: 'audnexus',
      message: 'upstream timeout',
      httpStatus: 504,
      retryAfterMs: 5_000,
      transient: true,
      descriptionUpdated: false,
      imageUpdated: false,
    });

    await expect(service.refreshEnrichment(reqUser(), 22)).rejects.toThrow('Author enrichment failed');
  });

  it('findAll returns an empty page when user has no accessible libraries', async () => {
    libraryService.findAll.mockResolvedValue([]);

    const page = await service.findAll(reqUser(), {});

    expect(page).toEqual({ items: [], total: 0, page: 0, size: 50 });
    expect(authorsRepo.findPage).not.toHaveBeenCalled();
    expect(authorsRepo.findSummaries).not.toHaveBeenCalled();
    expect(warehouseCatalogService.listAuthorSummaries).not.toHaveBeenCalled();
    expect(libraryService.findAll).toHaveBeenCalledWith(reqUser(), { includeSourceBacked: true });
  });

  it('findAll applies defaults and appends thumbnail urls', async () => {
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
    authorsRepo.findSummaries.mockResolvedValue([
      {
        id: 10,
        name: 'Alpha',
        sortName: null,
        description: null,
        bookCount: 3,
        lastAddedAt: null,
      },
    ]);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue('https://cdn.example.com/a10-thumb.jpg');

    const page = await service.findAll(reqUser(), {});

    expect(authorsRepo.findSummaries).toHaveBeenCalledWith({
      q: undefined,
      libraryIds: [1, 2],
      hasPhoto: undefined,
      contentFilters: undefined,
    });
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        id: 10,
        name: 'Alpha',
        imageUrl: 'https://cdn.example.com/a10-thumb.jpg',
      }),
    );
  });

  it('findAll includes cloud-only authors as native author summaries', async () => {
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseCatalogService.listAuthorSummaryPage.mockResolvedValue({
      rows: [
        {
          id: -3001,
          name: 'Cloud Author',
          sortName: null,
          description: null,
          bookCount: 4,
          lastAddedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 0,
      size: 50,
    });

    const page = await service.findAll(reqUser(), { libraryId: CLOUD_EBOOK_LIBRARY_ID });

    expect(authorsRepo.findPage).not.toHaveBeenCalled();
    expect(warehouseCatalogService.listAuthorSummaryPage).toHaveBeenCalledWith({
      userId: 7,
      q: undefined,
      contentFilters: undefined,
      mediaType: 'ebook',
      page: 0,
      size: 50,
      sort: 'name',
      order: 'asc',
      minBookCount: undefined,
    });
    expect(page).toEqual({
      items: [
        {
          id: -3001,
          name: 'Cloud Author',
          sortName: null,
          description: null,
          bookCount: 4,
          lastAddedAt: '2026-06-01T00:00:00.000Z',
          imageUrl: null,
        },
      ],
      total: 1,
      page: 0,
      size: 50,
    });
  });

  it('findAll deduplicates local and source-backed comma-form authors', async () => {
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
    authorsRepo.findSummaries.mockResolvedValue([
      {
        id: 42,
        name: 'Burrell, Teresa',
        sortName: 'Burrell, Teresa',
        description: 'Local bio',
        bookCount: 3,
        lastAddedAt: '2026-05-01T00:00:00.000Z',
      },
    ]);
    warehouseCatalogService.listAuthorSummaries.mockResolvedValue([
      {
        id: -3001,
        name: 'Teresa Burrell',
        sortName: null,
        description: null,
        bookCount: 2,
        lastAddedAt: '2026-06-01T00:00:00.000Z',
      },
    ]);

    const page = await service.findAll(reqUser(), { libraryId: undefined });

    expect(page).toEqual({
      items: [
        {
          id: 42,
          name: 'Burrell, Teresa',
          sortName: 'Burrell, Teresa',
          description: 'Local bio',
          bookCount: 5,
          lastAddedAt: '2026-06-01T00:00:00.000Z',
          imageUrl: null,
        },
      ],
      total: 1,
      page: 0,
      size: 50,
    });
  });

  it('findAll excludes cloud-only authors from the hasPhoto=true filter', async () => {
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);

    const page = await service.findAll(reqUser(), { libraryId: CLOUD_EBOOK_LIBRARY_ID, hasPhoto: true });

    expect(warehouseCatalogService.listAuthorSummaries).not.toHaveBeenCalled();
    expect(page).toEqual({ items: [], total: 0, page: 0, size: 50 });
  });

  it('findOne resolves a cloud-only author by virtual id', async () => {
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseCatalogService.findAuthorSummaryById.mockResolvedValue({
      id: -3001,
      name: 'Cloud Author',
      sortName: null,
      description: null,
      bookCount: 4,
      lastAddedAt: '2026-06-01T00:00:00.000Z',
    });

    await expect(service.findOne(reqUser(), -3001)).resolves.toEqual({
      id: -3001,
      name: 'Cloud Author',
      sortName: null,
      description: null,
      bookCount: 4,
      lastAddedAt: '2026-06-01T00:00:00.000Z',
      imageUrl: null,
    });
    expect(authorsRepo.findById).not.toHaveBeenCalled();
    expect(warehouseCatalogService.findAuthorSummaryById).toHaveBeenCalledWith(-3001, 7, undefined);
  });

  it('findOne merges matching source-backed summary counts for local author detail', async () => {
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
    authorsRepo.findById.mockResolvedValue({
      id: 42,
      name: 'Burrell, Teresa',
      sortName: 'Burrell, Teresa',
      description: 'Local bio',
      bookCount: 3,
      lastAddedAt: '2026-05-01T00:00:00.000Z',
    });
    warehouseCatalogService.listAuthorSummaries.mockResolvedValue([
      {
        id: -3001,
        name: 'Teresa Burrell',
        sortName: null,
        description: null,
        bookCount: 2,
        lastAddedAt: '2026-06-01T00:00:00.000Z',
      },
      {
        id: -3002,
        name: 'Other Author',
        sortName: null,
        description: null,
        bookCount: 9,
        lastAddedAt: '2026-06-03T00:00:00.000Z',
      },
    ]);

    await expect(service.findOne(reqUser(), 42)).resolves.toEqual({
      id: 42,
      name: 'Burrell, Teresa',
      sortName: 'Burrell, Teresa',
      description: 'Local bio',
      bookCount: 5,
      lastAddedAt: '2026-06-01T00:00:00.000Z',
      imageUrl: null,
    });
    expect(warehouseCatalogService.listAuthorSummaries).toHaveBeenCalledWith({
      userId: 7,
      q: undefined,
      contentFilters: undefined,
      mediaType: 'ebook',
    });
  });

  it('findOne rejects a cloud-only author when source-backed libraries are inaccessible', async () => {
    libraryService.findAll.mockResolvedValue([]);
    warehouseCatalogService.findAuthorSummaryById.mockResolvedValue({
      id: -3001,
      name: 'Cloud Author',
      sortName: null,
      description: null,
      bookCount: 4,
      lastAddedAt: '2026-06-01T00:00:00.000Z',
    });

    await expect(service.findOne(reqUser(), -3001)).rejects.toBeInstanceOf(NotFoundException);
    expect(warehouseCatalogService.findAuthorSummaryById).not.toHaveBeenCalled();
  });

  it('findBooks returns source-backed library items for cloud-only author detail', async () => {
    libraryService.findAll.mockResolvedValue([{ id: CLOUD_EBOOK_LIBRARY_ID }]);
    warehouseCatalogService.findAuthorSummaryById.mockResolvedValue({
      id: -3001,
      name: 'Cloud Author',
      sortName: null,
      description: null,
      bookCount: 4,
      lastAddedAt: '2026-06-01T00:00:00.000Z',
    });
    const bookCard = {
      id: -1000000001,
      status: 'present',
      title: 'Cloud Book',
      authors: ['Cloud Author'],
      addedAt: '2026-06-01T00:00:00.000Z',
      hasCover: true,
    };
    warehouseCatalogService.listAuthorBooks.mockResolvedValue({ items: [bookCard], total: 1 });

    await expect(service.findBooks(reqUser(), -3001, { libraryId: CLOUD_EBOOK_LIBRARY_ID })).resolves.toEqual({
      items: [bookCard],
      total: 1,
      page: 0,
      size: 50,
    });
    expect(authorsRepo.findBookIdsPage).not.toHaveBeenCalled();
    expect(warehouseCatalogService.findAuthorSummaryById).toHaveBeenCalledWith(-3001, 7, undefined);
    expect(warehouseCatalogService.listAuthorBooks).toHaveBeenCalledWith({
      userId: 7,
      authorId: -3001,
      page: 0,
      size: 50,
      sort: 'addedAt',
      order: 'desc',
      contentFilters: undefined,
      mediaType: 'ebook',
    });
  });

  it('findBooks filters a local author to source-backed Ebook Library items by author name', async () => {
    libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
    const bookCard = {
      id: -1000000002,
      status: 'present',
      title: 'Matched Cloud Book',
      authors: ['Local Author'],
      addedAt: '2026-06-02T00:00:00.000Z',
      hasCover: true,
    };
    authorsRepo.findById.mockResolvedValue({ id: 42, name: 'Local Author', bookCount: 3 });
    warehouseCatalogService.listAuthorBooks.mockResolvedValue({ items: [bookCard], total: 1 });

    await expect(service.findBooks(reqUser(), 42, { libraryId: CLOUD_EBOOK_LIBRARY_ID })).resolves.toEqual({
      items: [bookCard],
      total: 1,
      page: 0,
      size: 50,
    });

    expect(authorsRepo.findBookIdsPage).not.toHaveBeenCalled();
    expect(warehouseCatalogService.listAuthorBooks).toHaveBeenCalledWith({
      userId: 7,
      authorName: 'Local Author',
      page: 0,
      size: 50,
      sort: 'addedAt',
      order: 'desc',
      contentFilters: undefined,
      mediaType: 'ebook',
    });
  });

  it('sorts source-backed author detail items by cached published year alongside local books', async () => {
    libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: CLOUD_EBOOK_LIBRARY_ID }]);
    const localBook = { id: 11, title: 'Earlier Local Book', publishedYear: 2001, addedAt: '2026-06-01T00:00:00.000Z' } as any;
    const bookCard = {
      id: -1000002024,
      status: 'present',
      title: 'Newer Cloud Book',
      authors: ['Local Author'],
      hasCover: true,
      publishedYear: 2024,
      addedAt: '2026-06-02T00:00:00.000Z',
    };
    authorsRepo.findById.mockResolvedValue({ id: 42, name: 'Local Author', bookCount: 2 });
    authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [11], total: 1, page: 0, size: 50 });
    bookRepo.findCards.mockResolvedValue({ rows: [], authorRows: [], fileRows: [], genreRows: [], progressRows: [] });
    vi.mocked(assembleBookCards).mockReturnValue([localBook]);
    warehouseCatalogService.listAuthorBooks.mockResolvedValue({ items: [bookCard], total: 1 });

    await expect(service.findBooks(reqUser(), 42, { sort: 'publishedYear', order: 'desc' })).resolves.toEqual({
      items: [bookCard, localBook],
      total: 2,
      page: 0,
      size: 50,
    });
  });

  it('findAll rejects excessively deep offsets', async () => {
    await expect(service.findAll(reqUser(), { page: 2_000_000, size: 100 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findBooks returns empty page when user has no accessible libraries', async () => {
    libraryService.findAll.mockResolvedValue([]);

    const page = await service.findBooks(reqUser(), 99, {});

    expect(page).toEqual({ items: [], total: 0, page: 0, size: 50 });
    expect(authorsRepo.findById).not.toHaveBeenCalled();
  });

  it('findBooks throws not found when the author is not visible', async () => {
    authorsRepo.findById.mockResolvedValue(null);

    await expect(service.findBooks(reqUser(), 99, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findBooks rejects when pagination window is too deep', async () => {
    await expect(service.findBooks(reqUser(), 1, { page: 2_000_000, size: 100 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findBooks returns empty items when author has no books in the given libraries', async () => {
    authorsRepo.findById.mockResolvedValue({ id: 10, name: 'Author', bookCount: 0 });
    authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [], total: 0, page: 0, size: 50 });

    const result = await service.findBooks(reqUser(), 10, {});

    expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
    expect(bookRepo.findCards).not.toHaveBeenCalled();
  });

  it('findBooks passes sort, order, size, and libraryId to findBookIdsPage', async () => {
    authorsRepo.findById.mockResolvedValue({ id: 10, name: 'Author', bookCount: 3 });
    authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [], total: 0, page: 0, size: 10 });

    await service.findBooks(reqUser(), 10, { sort: 'title', order: 'asc', size: 10, page: 0, libraryId: 2 });

    expect(authorsRepo.findBookIdsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 10,
        sort: 'title',
        order: 'asc',
        size: 10,
        page: 0,
        libraryIds: expect.arrayContaining([2]),
        contentFilters: undefined,
      }),
    );
  });

  it('findBooks assembles and returns books in bookIds page order', async () => {
    const book1 = { id: 1, title: 'A' } as any;
    const book3 = { id: 3, title: 'C' } as any;
    const book2 = { id: 2, title: 'B' } as any;

    authorsRepo.findById.mockResolvedValue({ id: 5, name: 'Author', bookCount: 3 });
    authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [3, 1, 2], total: 3, page: 0, size: 50 });
    bookRepo.findCards.mockResolvedValue({ rows: [], authorRows: [], fileRows: [], genreRows: [], progressRows: [] });
    vi.mocked(assembleBookCards).mockReturnValue([book1, book2, book3]);

    const result = await service.findBooks(reqUser(), 5, {});

    expect(result.total).toBe(3);
    expect(result.items.map((b) => b.id)).toEqual([3, 1, 2]);
  });

  it('findBooks uses defaults when dto fields are omitted', async () => {
    authorsRepo.findById.mockResolvedValue({ id: 7, name: 'Author', bookCount: 0 });
    authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [], total: 0, page: 0, size: 50 });

    await service.findBooks(reqUser(), 7, {});

    expect(authorsRepo.findBookIdsPage).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'addedAt', order: 'desc', page: 0, size: 50, contentFilters: undefined }),
    );
  });

  it('findBooks scopes results to user-accessible libraries only', async () => {
    libraryService.findAll.mockResolvedValue([{ id: 3 }]);
    authorsRepo.findById.mockResolvedValue({ id: 8, name: 'Author', bookCount: 2 });
    authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [], total: 0, page: 0, size: 50 });

    await service.findBooks(reqUser(), 8, {});

    expect(authorsRepo.findBookIdsPage).toHaveBeenCalledWith(expect.objectContaining({ libraryIds: [3], contentFilters: undefined }));
  });

  describe('content filter enforcement', () => {
    it('passes contentFilters to findPage for non-superuser', async () => {
      authorsRepo.findPage.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await service.findAll({ ...reqUser(), contentFilters: EMPTY_CONTENT_FILTER_RULES }, {});

      expect(authorsRepo.findPage).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
    });

    it('passes undefined to findPage for superuser', async () => {
      authorsRepo.findPage.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await service.findAll({ ...reqUser(7, true), contentFilters: EMPTY_CONTENT_FILTER_RULES }, {});

      expect(authorsRepo.findPage).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
    });

    it('passes contentFilters to findById and findBookIdsPage for non-superuser', async () => {
      authorsRepo.findById.mockResolvedValue({ id: 10, name: 'Author', sortName: null, description: null, bookCount: 0, lastAddedAt: null });
      authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [], total: 0, page: 0, size: 50 });

      await service.findBooks({ ...reqUser(), contentFilters: EMPTY_CONTENT_FILTER_RULES }, 10, {});

      expect(authorsRepo.findById).toHaveBeenCalledWith(10, [1, 2], EMPTY_CONTENT_FILTER_RULES);
      expect(authorsRepo.findBookIdsPage).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: EMPTY_CONTENT_FILTER_RULES }));
    });

    it('passes undefined to findById and findBookIdsPage for superuser', async () => {
      authorsRepo.findById.mockResolvedValue({ id: 10, name: 'Author', sortName: null, description: null, bookCount: 0, lastAddedAt: null });
      authorsRepo.findBookIdsPage.mockResolvedValue({ bookIds: [], total: 0, page: 0, size: 50 });

      await service.findBooks({ ...reqUser(7, true), contentFilters: EMPTY_CONTENT_FILTER_RULES }, 10, {});

      expect(authorsRepo.findById).toHaveBeenCalledWith(10, [1, 2], undefined);
      expect(authorsRepo.findBookIdsPage).toHaveBeenCalledWith(expect.objectContaining({ contentFilters: undefined }));
    });
  });

  it('returns metadata providers directly from the metadata fetch service', () => {
    authorMetadataFetchService.listProviders.mockReturnValue([{ key: 'audnexus', label: 'Audnexus', identifiable: true }]);

    expect(service.listMetadataProviders()).toEqual([{ key: 'audnexus', label: 'Audnexus', identifiable: true }]);
  });

  it('searchMetadata forwards query and provider filters', async () => {
    authorMetadataFetchService.search.mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'John Smith' }]);

    await expect(service.searchMetadata({ q: 'John Smith', region: 'us', limit: 2, providers: ['audnexus'] })).resolves.toEqual([
      { provider: 'audnexus', providerId: 'A1', name: 'John Smith' },
    ]);
    expect(authorMetadataFetchService.search).toHaveBeenCalledWith({ name: 'John Smith', region: 'us', limit: 2 }, { keys: ['audnexus'] });
  });

  it('lookupMetadata forwards provider key and id', async () => {
    authorMetadataFetchService.lookupById.mockResolvedValue({ provider: 'audnexus', providerId: 'A1', name: 'John Smith' });

    await expect(service.lookupMetadata({ provider: 'audnexus', id: 'A1', region: 'ca' })).resolves.toEqual({
      provider: 'audnexus',
      providerId: 'A1',
      name: 'John Smith',
    });
  });

  it('streamMetadata proxies through provider stream options', () => {
    const mockStream = Symbol('stream');
    authorMetadataFetchService.stream.mockReturnValue(mockStream as any);

    const stream = service.streamMetadata({ q: 'Jane', region: 'us', limit: 5, providers: ['audnexus'] });

    expect(stream).toBe(mockStream);
    expect(authorMetadataFetchService.stream).toHaveBeenCalledWith({ name: 'Jane', region: 'us', limit: 5 }, { keys: ['audnexus'] });
  });

  it('update returns current detail when no mutable fields are provided', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([30]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorsRepo.findById.mockResolvedValue({
      id: 30,
      name: 'Current',
      sortName: null,
      description: null,
      bookCount: 1,
      lastAddedAt: null,
    });

    const result = await service.update(reqUser(), 30, {});

    expect(authorsRepo.updateAuthorById).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 30, name: 'Current' }));
  });

  it('update rejects blank names', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([31]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);

    await expect(service.update(reqUser(), 31, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('get image paths verify readability before touching storage', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([40]);
    authorImageStorage.getThumbnailPath.mockResolvedValue('/tmp/thumb.jpg');
    authorImageStorage.getImagePath.mockResolvedValue('/tmp/full.jpg');

    await expect(service.getThumbnailPath(reqUser(), 40)).resolves.toBe('/tmp/thumb.jpg');
    await expect(service.getImagePath(reqUser(), 40)).resolves.toBe('/tmp/full.jpg');
  });

  it('uploadImage validates and stores author image, then marks hasPhoto=true', async () => {
    const bytes = Buffer.from('fake-image');
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([41]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorImageStorage.saveFromBuffer.mockResolvedValue(undefined);
    authorsRepo.updateAuthorById.mockResolvedValue({ id: 41 });
    authorsRepo.findById.mockResolvedValue({
      id: 41,
      name: 'Photo Author',
      sortName: null,
      description: null,
      bookCount: 1,
      lastAddedAt: null,
    });
    authorImageStorage.getImageUrlIfExists.mockResolvedValue('/api/v1/authors/41/image?t=1234');

    const result = await service.uploadImage(reqUser(), 41, bytes, 'image/png');

    expect(authorImageStorage.saveFromBuffer).toHaveBeenCalledWith(41, bytes);
    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(41, { hasPhoto: true });
    expect(result).toEqual(expect.objectContaining({ id: 41, imageUrl: '/api/v1/authors/41/image?t=1234' }));
  });

  it('uploadImage rejects non-image mime types', async () => {
    await expect(service.uploadImage(reqUser(), 41, Buffer.from('nope'), 'text/plain')).rejects.toMatchObject({
      name: BadRequestException.name,
      message: 'File must be an image',
    });
  });

  it('uploadImage rejects files over 20 MB', async () => {
    const tooLarge = Buffer.alloc(AuthorsService.MAX_AUTHOR_IMAGE_BYTES + 1);
    await expect(service.uploadImage(reqUser(), 41, tooLarge, 'image/jpeg')).rejects.toMatchObject({
      name: BadRequestException.name,
      message: 'Image exceeds 20 MB limit',
    });
  });

  it('deleteImage removes author image directory and marks hasPhoto=false', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([42]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorImageStorage.deleteAuthorDir.mockResolvedValue(undefined);
    authorsRepo.updateAuthorById.mockResolvedValue({ id: 42 });
    authorsRepo.findById.mockResolvedValue({
      id: 42,
      name: 'No Photo Author',
      sortName: null,
      description: null,
      bookCount: 2,
      lastAddedAt: null,
    });
    authorImageStorage.getImageUrlIfExists.mockResolvedValue(null);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue(null);

    const result = await service.deleteImage(reqUser(), 42);

    expect(authorImageStorage.deleteAuthorDir).toHaveBeenCalledWith(42);
    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(42, { hasPhoto: false });
    expect(result).toEqual(expect.objectContaining({ id: 42, imageUrl: null }));
  });

  it('bulkRefreshMetadata returns zero counters for empty input', async () => {
    await expect(service.bulkRefreshMetadata([], reqUser())).resolves.toEqual({
      processed: 0,
      failed: 0,
      updated: 0,
    });
  });

  it('bulkRefreshMetadata stops iterating when progress callback throws', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([1, 2]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue('https://cdn.example.com/1-thumb.jpg');
    vi.spyOn(service as any, 'refreshEnrichmentInternal').mockResolvedValue({
      descriptionUpdated: true,
      imageUpdated: true,
      provider: 'audnexus',
    });

    const progress = vi.fn(() => {
      throw new Error('client disconnected');
    });

    const result = await service.bulkRefreshMetadata([1, 2], reqUser(), progress);

    expect(result).toEqual({ processed: 1, failed: 0, updated: 1 });
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it('bulkRefreshMetadata deduplicates ids and continues after per-item failures', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([1, 2]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    vi.spyOn(service as any, 'refreshEnrichmentInternal')
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({
        descriptionUpdated: false,
        imageUpdated: true,
        provider: 'audnexus',
      });
    vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue('https://cdn.example.com/2-thumb.jpg');

    const progress = vi.fn();
    const result = await service.bulkRefreshMetadata([1, 1, 2], reqUser(), progress);

    expect(result).toEqual({ processed: 2, failed: 1, updated: 1 });
    expect(progress).toHaveBeenCalledTimes(2);
  });
});
