vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { readdir, rm, stat } from 'fs/promises';

import { ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED } from '../achievement/achievement-events.service';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { LibraryService } from './library.service';

const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockIsPrimaryFormat = isPrimaryFormat as MockedFunction<typeof isPrimaryFormat>;

function dirent(name: string, kind: 'file' | 'dir') {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

describe('LibraryService', () => {
  const libraryRepo = {
    hasUserAccess: vi.fn(),
    findAll: vi.fn(),
    findAllForUser: vi.fn(),
    findAllIds: vi.fn(),
    findAccessibleIdsForUser: vi.fn(),
    findAllFolders: vi.fn(),
    findFoldersByLibraryIds: vi.fn(),
    findById: vi.fn(),
    findFoldersByLibrary: vi.fn(),
    findByName: vi.fn(),
    insert: vi.fn(),
    insertFolder: vi.fn(),
    update: vi.fn(),
    deleteFolder: vi.fn(),
    findBookIdsByLibrary: vi.fn(),
    delete: vi.fn(),
    findAllFolderPaths: vi.fn(),
    getStats: vi.fn(),
    updateDisplayOrders: vi.fn(),
    getAccessWithUsers: vi.fn(),
    grantAccess: vi.fn(),
    updateAccess: vi.fn(),
    revokeAccess: vi.fn(),
  };

  const config = { get: vi.fn().mockReturnValue('/books') };
  const scannerService = { startScanAsync: vi.fn() };
  const fileWatcherService = { startWatcher: vi.fn(), stopWatcher: vi.fn() };
  const fileWriteService = {
    findNonMissingPrimaryFilesByLibrary: vi.fn(),
    writeToFile: vi.fn(),
  };
  const achievementEvents = {
    emit: vi.fn(),
  };
  const warehouseCatalog = {
    isCatalogEnabled: vi.fn(),
    listEbooks: vi.fn(),
    listAudiobooks: vi.fn(),
    listComics: vi.fn(),
    queryLibraryItems: vi.fn(),
    queryLibraryBooks: vi.fn(),
    queryLibraryJumpBuckets: vi.fn(),
  };
  const warehouseSettings = {
    getSourceBackedLibraryIcons: vi.fn(),
  };
  const pathPolicy = {
    assertWithinBrowseRoot: vi.fn((path: string) => Promise.resolve(path)),
    resolveBrowsePath: vi.fn((path: string) => Promise.resolve(path)),
  };

  let service: LibraryService;

  beforeEach(() => {
    vi.resetAllMocks();
    config.get.mockReturnValue('/books');
    service = new LibraryService(
      libraryRepo as any,
      config as any,
      scannerService as any,
      fileWatcherService as any,
      fileWriteService as any,
      achievementEvents as any,
      pathPolicy as any,
      warehouseCatalog as any,
      warehouseSettings as any,
    );

    mockStat.mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockRm.mockResolvedValue(undefined);
    mockIsPrimaryFormat.mockReturnValue(false);
    pathPolicy.assertWithinBrowseRoot.mockImplementation((path: string) => Promise.resolve(path));
    pathPolicy.resolveBrowsePath.mockImplementation((path: string) => Promise.resolve(path));
    warehouseCatalog.isCatalogEnabled.mockResolvedValue(true);
    warehouseCatalog.listComics.mockResolvedValue({ items: [], page: 1, limit: 1, total: 0 });
    warehouseSettings.getSourceBackedLibraryIcons.mockResolvedValue({
      ebook: 'BookOpen',
      audiobook: 'Headphones',
      comic: 'PanelsTopLeft',
    });
  });

  it('findAll uses scoped folder query for non-superusers', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([{ id: 10, name: 'A', coverAspectRatio: '1/1' }]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([{ id: 1, libraryId: 10, path: '/a', createdAt: new Date() }]);

    const result = await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any);

    expect(libraryRepo.findAllForUser).toHaveBeenCalledWith(7, EMPTY_CONTENT_FILTER_RULES);
    expect(libraryRepo.findFoldersByLibraryIds).toHaveBeenCalledWith([10]);
    expect(libraryRepo.findAllFolders).not.toHaveBeenCalled();
    expect(result[0].folders).toEqual([{ id: 1, path: '/a', createdAt: expect.any(Date) }]);
    expect(result[0].coverAspectRatio).toBe('1/1');
  });

  it('findAll includes source-backed libraries as native library rows when requested', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([{ id: 10, name: 'A', coverAspectRatio: '1/1' }]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([{ id: 1, libraryId: 10, path: '/a', createdAt: new Date() }]);
    warehouseCatalog.listEbooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 56251 });
    warehouseCatalog.listAudiobooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 2400 });
    warehouseCatalog.listComics.mockResolvedValue({ items: [], page: 1, limit: 1, total: 915 });

    const result = await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any, {
      includeSourceBacked: true,
    });

    expect(warehouseCatalog.listEbooks).toHaveBeenCalledWith({ page: 1, limit: 1, sort: 'title', order: 'asc' });
    expect(warehouseCatalog.listAudiobooks).toHaveBeenCalledWith({ page: 1, limit: 1, sort: 'title', order: 'asc' });
    expect(warehouseCatalog.listComics).toHaveBeenCalledWith({ page: 1, limit: 1, sort: 'title', order: 'asc' });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: CLOUD_EBOOK_LIBRARY_ID,
          name: 'Books',
          sourceKind: 'source_backed',
          icon: 'BookOpen',
          coverAspectRatio: '2/3',
          bookCount: 56251,
          folders: [],
        }),
        expect.objectContaining({
          id: CLOUD_AUDIO_LIBRARY_ID,
          name: 'Audiobooks',
          sourceKind: 'source_backed',
          icon: 'Headphones',
          coverAspectRatio: '1/1',
          bookCount: 2400,
          folders: [],
        }),
        expect.objectContaining({
          id: CLOUD_COMIC_LIBRARY_ID,
          name: 'Comics',
          sourceKind: 'source_backed',
          icon: 'PanelsTopLeft',
          coverAspectRatio: '2/3',
          bookCount: 915,
          folders: [],
        }),
        expect.objectContaining({
          id: 10,
          name: 'A',
          sourceKind: 'filesystem',
        }),
      ]),
    );
  });

  it('findAll uses configured source-backed library icons', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([]);
    warehouseCatalog.listEbooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 1 });
    warehouseCatalog.listAudiobooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 2 });
    warehouseCatalog.listComics.mockResolvedValue({ items: [], page: 1, limit: 1, total: 3 });
    warehouseSettings.getSourceBackedLibraryIcons.mockResolvedValue({
      ebook: 'LibraryBig',
      audiobook: 'Radio',
      comic: 'BookImage',
    });

    const result = await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any, {
      includeSourceBacked: true,
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: CLOUD_EBOOK_LIBRARY_ID, icon: 'LibraryBig' }),
        expect.objectContaining({ id: CLOUD_AUDIO_LIBRARY_ID, icon: 'Radio' }),
        expect.objectContaining({ id: CLOUD_COMIC_LIBRARY_ID, icon: 'BookImage' }),
      ]),
    );
  });

  it('findAll keeps source-backed libraries out of filesystem-only calls', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([]);

    await expect(service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any)).resolves.toEqual([]);

    expect(warehouseCatalog.listEbooks).not.toHaveBeenCalled();
    expect(warehouseCatalog.listAudiobooks).not.toHaveBeenCalled();
    expect(warehouseCatalog.listComics).not.toHaveBeenCalled();
  });

  it('findAll omits source-backed libraries when the catalog source is disabled', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([{ id: 10, name: 'A', coverAspectRatio: '1/1' }]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([]);
    warehouseCatalog.isCatalogEnabled.mockResolvedValue(false);

    const result = await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any, {
      includeSourceBacked: true,
    });

    expect(result).toEqual([expect.objectContaining({ id: 10, name: 'A', sourceKind: 'filesystem' })]);
    expect(warehouseCatalog.listEbooks).not.toHaveBeenCalled();
    expect(warehouseCatalog.listAudiobooks).not.toHaveBeenCalled();
  });

  it('passes contentFilters to findAllForUser for non-superuser and skips for superuser', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([]);
    libraryRepo.findAll.mockResolvedValue([]);
    libraryRepo.findAllFolders.mockResolvedValue([]);

    await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any);
    await service.findAll({ id: 1, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any);

    expect(libraryRepo.findAllForUser).toHaveBeenCalledWith(7, EMPTY_CONTENT_FILTER_RULES);
    expect(libraryRepo.findAll).toHaveBeenCalled();
  });

  it('findAccessibleLibraryIds reads all IDs for superusers and scoped IDs for normal users', async () => {
    libraryRepo.findAllIds.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    libraryRepo.findAccessibleIdsForUser.mockResolvedValue([{ id: 3 }, { id: 4 }]);

    await expect(service.findAccessibleLibraryIds({ id: 99, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any)).resolves.toEqual(
      [1, 2],
    );
    await expect(
      service.findAccessibleLibraryIds({ id: 42, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any),
    ).resolves.toEqual([3, 4]);
  });

  it('findOne returns library details and normalizes organization mode', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Main', organizationMode: null }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 50, path: '/books/main' }]);

    await expect(service.findOne(10)).resolves.toEqual({
      id: 10,
      name: 'Main',
      organizationMode: 'book_per_folder',
      folders: [{ id: 50, path: '/books/main' }],
    });
  });

  it('findOne throws when library is missing', async () => {
    libraryRepo.findById.mockResolvedValue([]);
    await expect(service.findOne(111)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne returns source-backed ebook library details', async () => {
    warehouseCatalog.listEbooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 56251 });
    warehouseCatalog.listAudiobooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 2400 });
    warehouseCatalog.listComics.mockResolvedValue({ items: [], page: 1, limit: 1, total: 915 });

    await expect(service.findOne(CLOUD_EBOOK_LIBRARY_ID)).resolves.toEqual(
      expect.objectContaining({
        id: CLOUD_EBOOK_LIBRARY_ID,
        name: 'Books',
        sourceKind: 'source_backed',
        folders: [],
        bookCount: 56251,
      }),
    );

    expect(libraryRepo.findById).not.toHaveBeenCalled();
  });

  it('findOne hides source-backed libraries when the catalog source is disabled', async () => {
    warehouseCatalog.isCatalogEnabled.mockResolvedValue(false);

    await expect(service.findOne(CLOUD_EBOOK_LIBRARY_ID)).rejects.toBeInstanceOf(NotFoundException);

    expect(libraryRepo.findById).not.toHaveBeenCalled();
  });

  it('queries source-backed ebook libraries through the catalog service', async () => {
    const query = {
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 50 },
      q: 'dune',
    } as const;
    const page = {
      items: [{ type: 'catalog-item', mediaType: 'ebook', remoteId: 'ebook-1', title: 'Dune' }],
      total: 1,
      page: 0,
      limit: 50,
    };
    warehouseCatalog.queryLibraryItems.mockResolvedValue(page);

    await expect(service.querySourceBackedCatalogItems({ id: 42, isSuperuser: false } as any, CLOUD_EBOOK_LIBRARY_ID, query as any)).resolves.toBe(
      page,
    );

    expect(warehouseCatalog.queryLibraryItems).toHaveBeenCalledWith({ id: 42, isSuperuser: false }, 'ebook', query);
  });

  it('queries source-backed audiobook libraries through the catalog service', async () => {
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as const;
    warehouseCatalog.queryLibraryItems.mockResolvedValue({ items: [], total: 0, page: 0, limit: 50 });

    await service.querySourceBackedCatalogItems({ id: 42, isSuperuser: false } as any, CLOUD_AUDIO_LIBRARY_ID, query as any);

    expect(warehouseCatalog.queryLibraryItems).toHaveBeenCalledWith({ id: 42, isSuperuser: false }, 'audiobook', query);
  });

  it('queries source-backed comic libraries through the catalog service', async () => {
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as const;
    warehouseCatalog.queryLibraryItems.mockResolvedValue({ items: [], total: 0, page: 0, limit: 50 });

    await service.querySourceBackedCatalogItems({ id: 42, isSuperuser: false } as any, CLOUD_COMIC_LIBRARY_ID, query as any);

    expect(warehouseCatalog.queryLibraryItems).toHaveBeenCalledWith({ id: 42, isSuperuser: false }, 'comic', query);
  });

  it('adapts source-backed library book queries to the native library books page shape', async () => {
    const user = { id: 42, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 1, size: 25 } } as const;
    const item = { id: -1000000001, status: 'present', title: 'Dune', authors: ['Frank Herbert'], addedAt: '2026-01-01T00:00:00.000Z' };
    warehouseCatalog.queryLibraryBooks.mockResolvedValue({ items: [item], total: 3, page: 1, limit: 25 });

    await expect(service.querySourceBackedLibraryBooks(user, CLOUD_EBOOK_LIBRARY_ID, query as any)).resolves.toEqual({
      items: [item],
      total: 3,
      page: 1,
      size: 25,
    });
    expect(warehouseCatalog.queryLibraryBooks).toHaveBeenCalledWith(user, 'ebook', query);
    expect(warehouseCatalog.queryLibraryItems).not.toHaveBeenCalled();
  });

  it('queries source-backed comic library jump buckets through the catalog service', async () => {
    const user = { id: 42, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as const;
    const buckets = { buckets: [{ key: 'M', label: 'M', index: 12 }], total: 91 };
    warehouseCatalog.queryLibraryJumpBuckets.mockResolvedValue(buckets);

    await expect(service.querySourceBackedLibraryJumpBuckets(user, CLOUD_COMIC_LIBRARY_ID, query as any)).resolves.toBe(buckets);
    expect(warehouseCatalog.queryLibraryJumpBuckets).toHaveBeenCalledWith(user, 'comic', query);
  });

  it('rejects catalog item queries for non-source-backed libraries', async () => {
    await expect(
      service.querySourceBackedCatalogItems({ id: 42, isSuperuser: false } as any, 12, {
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: 50 },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(warehouseCatalog.queryLibraryItems).not.toHaveBeenCalled();
  });

  it('verifyUserAccess bypasses lookup for superusers', async () => {
    await service.verifyUserAccess(1, 2, true);
    expect(libraryRepo.hasUserAccess).not.toHaveBeenCalled();
  });

  it('verifyUserAccess allows source-backed libraries when the catalog source is enabled', async () => {
    warehouseCatalog.listEbooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 56251 });
    warehouseCatalog.listAudiobooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 2400 });
    warehouseCatalog.listComics.mockResolvedValue({ items: [], page: 1, limit: 1, total: 915 });

    await service.verifyUserAccess(1, CLOUD_COMIC_LIBRARY_ID, false);

    expect(warehouseCatalog.isCatalogEnabled).toHaveBeenCalled();
    expect(libraryRepo.hasUserAccess).not.toHaveBeenCalled();
  });

  it('verifyUserAccess rejects source-backed libraries when the catalog source is disabled', async () => {
    warehouseCatalog.isCatalogEnabled.mockResolvedValue(false);

    await expect(service.verifyUserAccess(1, CLOUD_COMIC_LIBRARY_ID, false)).rejects.toThrow('No access to this library');

    expect(libraryRepo.hasUserAccess).not.toHaveBeenCalled();
  });

  it('verifyUserAccess throws when user has no library access', async () => {
    libraryRepo.hasUserAccess.mockResolvedValue(false);
    await expect(service.verifyUserAccess(1, 2, false)).rejects.toThrow('No access to this library');
  });

  it('create applies defaults, inserts folders, and starts an async scan', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, name: 'Sci-Fi', icon: 'BookOpen' }]);
    libraryRepo.insertFolder.mockResolvedValueOnce([{ id: 11, path: '/a' }]).mockResolvedValueOnce([{ id: 12, path: '/b' }]);

    const result = await service.create({ name: 'Sci-Fi', icon: 'BookOpen', folders: ['/a', '/b'] } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sci-Fi',
        icon: 'BookOpen',
        displayOrder: 0,
        watch: false,
        metadataPrecedence: ['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar'],
        formatPriority: ['epub', 'kepub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2', 'm4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'],
        organizationMode: 'book_per_folder',
        coverAspectRatio: '2/3',
      }),
    );
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(5);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(result.folders).toEqual([
      { id: 11, path: '/a' },
      { id: 12, path: '/b' },
    ]);
  });

  it('create passes file write defaults to insert', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, name: 'Sci-Fi', icon: 'BookOpen' }]);
    libraryRepo.insertFolder.mockResolvedValueOnce([{ id: 11, path: '/a' }]);

    await service.create({ name: 'Sci-Fi', icon: 'BookOpen', folders: ['/a'] } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        fileWriteEnabled: false,
        fileWriteWriteCover: true,
        fileWriteEpubEnabled: true,
        fileWriteEpubMaxFileSizeMb: 100,
        fileWritePdfEnabled: true,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteAudioEnabled: true,
        fileWriteAudioMaxFileSizeMb: 500,
        fileRenameEnabled: false,
      }),
    );
  });

  it('create starts watcher immediately when watch is enabled', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 6, name: 'Watched', icon: 'BookOpen', watch: true }]);
    libraryRepo.insertFolder.mockResolvedValueOnce([{ id: 21, path: '/watch-a' }]).mockResolvedValueOnce([{ id: 22, path: '/watch-b' }]);

    await service.create({ name: 'Watched', icon: 'BookOpen', folders: ['/watch-a', '/watch-b'], watch: true } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(6, ['/watch-a', '/watch-b']);
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(6);
  });

  it('create rejects duplicate library names', async () => {
    libraryRepo.findByName.mockResolvedValue([{ id: 9 }]);

    await expect(service.create({ name: 'Dup', icon: 'BookOpen', folders: ['/x'] } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('create rejects folders outside the configured browse root before inserting the library', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    pathPolicy.assertWithinBrowseRoot.mockRejectedValue(new ForbiddenException('outside root'));

    await expect(service.create({ name: 'Sci-Fi', icon: 'BookOpen', folders: ['/outside'] } as any)).rejects.toBeInstanceOf(ForbiddenException);

    expect(libraryRepo.insert).not.toHaveBeenCalled();
    expect(libraryRepo.insertFolder).not.toHaveBeenCalled();
  });

  it('create rejects missing icons', async () => {
    libraryRepo.findByName.mockResolvedValue([]);

    await expect(service.create({ name: 'Sci-Fi', folders: ['/a'] } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(libraryRepo.insert).not.toHaveBeenCalled();
  });

  it('update synchronizes folder additions and removals', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 3, name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 3, name: 'Updated' }]);
    libraryRepo.findFoldersByLibrary
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 2, path: '/remove' },
      ])
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 3, path: '/add' },
      ]);

    await service.update(3, { folders: ['/keep', '/add'] } as any);

    expect(libraryRepo.deleteFolder).toHaveBeenCalledWith(2);
    expect(libraryRepo.insertFolder).toHaveBeenCalledWith({ libraryId: 3, path: '/add' });
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update rejects folders outside the configured browse root before changing the library', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 3, name: 'Current', icon: 'BookOpen', watch: false }]);
    pathPolicy.assertWithinBrowseRoot.mockRejectedValue(new ForbiddenException('outside root'));

    await expect(service.update(3, { folders: ['/outside'] } as any)).rejects.toBeInstanceOf(ForbiddenException);

    expect(libraryRepo.update).not.toHaveBeenCalled();
    expect(libraryRepo.insertFolder).not.toHaveBeenCalled();
    expect(libraryRepo.deleteFolder).not.toHaveBeenCalled();
  });

  it('update starts watcher when watch toggles on', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 7, name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 7, name: 'Current', watch: true }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 31, path: '/watched' }]);

    await service.update(7, { watch: true } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(7, ['/watched']);
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update stops watcher when watch toggles off', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, name: 'Current', icon: 'BookOpen', watch: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 8, name: 'Current', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 41, path: '/watched' }]);

    await service.update(8, { watch: false } as any);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(8);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
  });

  it('update rebinds watcher when folders change and watch remains on', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 9, name: 'Current', icon: 'BookOpen', watch: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 9, name: 'Current', watch: true }]);
    libraryRepo.findFoldersByLibrary
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 2, path: '/remove' },
      ])
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 3, path: '/add' },
      ]);

    await service.update(9, { folders: ['/keep', '/add'] } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(9, ['/keep', '/add']);
  });

  it('update triggers a background scan when format selection settings change', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    await service.update(10, { formatPriority: ['epub', 'pdf'], allowedFormats: ['epub'] } as any);

    expect(scannerService.startScanAsync).toHaveBeenCalledWith(10);
  });

  it('update rejects organization mode changes after creation', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_folder' }]);

    await expect(service.update(10, { organizationMode: 'book_per_file' } as any)).rejects.toThrow(BadRequestException);

    expect(libraryRepo.update).not.toHaveBeenCalled();
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
  });

  it('update accepts the same organization mode without triggering a scan', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_file' }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_file' }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    const result = await service.update(10, { organizationMode: 'book_per_file' } as any);

    expect(libraryRepo.update).toHaveBeenCalledWith(10, { organizationMode: 'book_per_file' });
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
    expect(result.organizationMode).toBe('book_per_file');
  });

  it('update accepts the default organization mode for legacy rows without triggering a scan', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: null }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: null }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    const result = await service.update(10, { organizationMode: 'book_per_folder' } as any);

    expect(libraryRepo.update).toHaveBeenCalledWith(10, { organizationMode: 'book_per_folder' });
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
    expect(result.organizationMode).toBe('book_per_folder');
  });

  it('update rejects changes that would leave a library without an icon', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: null, watch: false }]);

    await expect(service.update(10, { watch: true } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(libraryRepo.update).not.toHaveBeenCalled();
  });

  it('grantAccess emits library catalog changed event for the granted user', async () => {
    libraryRepo.grantAccess.mockResolvedValue({ libraryId: 4, userId: 21, accessLevel: 'read' });

    await service.grantAccess(4, { userId: 21, accessLevel: 'read' } as any);

    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: 21, libraryId: 4 });
  });

  it('revokeAccess emits library catalog changed event for the revoked user', async () => {
    libraryRepo.revokeAccess.mockResolvedValue(undefined);

    await service.revokeAccess(4, 21);

    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: 21, libraryId: 4 });
  });

  it('getAccess proxies to repository', async () => {
    libraryRepo.getAccessWithUsers.mockResolvedValue([{ userId: 1, accessLevel: 'read' }]);

    const result = await service.getAccess(9);

    expect(libraryRepo.getAccessWithUsers).toHaveBeenCalledWith(9);
    expect(result).toEqual([{ userId: 1, accessLevel: 'read' }]);
  });

  it('updateAccess proxies to repository', async () => {
    libraryRepo.updateAccess.mockResolvedValue({ libraryId: 9, userId: 1, accessLevel: 'write' });

    const result = await service.updateAccess(9, 1, 'write');

    expect(libraryRepo.updateAccess).toHaveBeenCalledWith(9, 1, 'write');
    expect(result).toEqual({ libraryId: 9, userId: 1, accessLevel: 'write' });
  });

  it('reorder proxies library order updates', async () => {
    libraryRepo.updateDisplayOrders.mockResolvedValue(undefined);

    await service.reorder({ order: [3, 1, 2] } as any);

    expect(libraryRepo.updateDisplayOrders).toHaveBeenCalledWith([3, 1, 2]);
  });

  it('remove deletes library and cleans related cover directories', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 4, name: 'L' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([{ id: 101 }, { id: 102 }]);

    await service.remove(4);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(4);
    expect(libraryRepo.delete).toHaveBeenCalledWith(4);
    expect(mockRm).toHaveBeenCalledWith('/books/covers/101', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('/books/covers/102', { recursive: true, force: true });
  });

  it('remove throws when library does not exist', async () => {
    libraryRepo.findById.mockResolvedValue([]);

    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prescan counts primary files recursively and flags overlapping paths', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([{ path: '/books/existing', libraryName: 'Existing Library' }]);

    mockReaddir.mockImplementation((path: Parameters<typeof readdir>[0]) => {
      if (path === '/books/new') {
        return Promise.resolve([dirent('a.epub', 'file'), dirent('.hidden.epub', 'file'), dirent('sub', 'dir')] as any);
      }
      if (path === '/books/new/sub') {
        return Promise.resolve([dirent('b.pdf', 'file'), dirent('note.txt', 'file')] as any);
      }
      return Promise.resolve([] as any);
    });

    mockIsPrimaryFormat.mockImplementation((path: string) => path.endsWith('.epub') || path.endsWith('.pdf'));

    const result = await service.prescan({ paths: ['/books/new', '/books/existing/sub'] } as any);

    expect(result.totalFiles).toBe(2);
    expect(result.paths[0]).toEqual(expect.objectContaining({ path: '/books/new', accessible: true, fileCount: 2 }));
    expect(result.paths[1]).toEqual(expect.objectContaining({ overlapLibrary: 'Existing Library' }));
  });

  it('prescan reports paths outside the configured browse root without touching the filesystem', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    pathPolicy.resolveBrowsePath.mockRejectedValue(new ForbiddenException('outside root'));

    const result = await service.prescan({ paths: ['/outside'] } as any);

    expect(result).toEqual({
      paths: [{ path: '/outside', accessible: false, fileCount: 0, error: 'Path is outside the configured library browse root' }],
      totalFiles: 0,
    });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('prescan reports non-directory paths with explicit error', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    mockStat.mockResolvedValue({ isDirectory: () => false } as Awaited<ReturnType<typeof stat>>);

    const result = await service.prescan({ paths: ['/tmp/file'] } as any);

    expect(result.paths[0]).toEqual({ path: '/tmp/file', accessible: false, fileCount: 0, error: 'Not a directory' });
  });

  it('prescan reports ENOENT paths with a sanitized message', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    mockStat.mockRejectedValue({ code: 'ENOENT' });

    const result = await service.prescan({ paths: ['/tmp/missing'] } as any);

    expect(result.paths[0]).toEqual(expect.objectContaining({ accessible: false, error: 'Path does not exist' }));
  });

  it('getStats maps repository overflow errors to InternalServerErrorException', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L' }]);
    libraryRepo.getStats.mockRejectedValue(new RangeError('overflow'));

    await expect(service.getStats(1)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('getStats returns source-backed ebook library counts without local storage size', async () => {
    warehouseCatalog.listEbooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 56251 });
    warehouseCatalog.listAudiobooks.mockResolvedValue({ items: [], page: 1, limit: 1, total: 2400 });

    await expect(service.getStats(CLOUD_EBOOK_LIBRARY_ID)).resolves.toEqual({
      totalBooks: 56251,
      totalSizeBytes: 0,
      formatCounts: {},
    });

    expect(libraryRepo.findById).not.toHaveBeenCalled();
    expect(libraryRepo.getStats).not.toHaveBeenCalled();
  });

  it('getStats hides source-backed libraries when the catalog source is disabled', async () => {
    warehouseCatalog.isCatalogEnabled.mockResolvedValue(false);

    await expect(service.getStats(CLOUD_EBOOK_LIBRARY_ID)).rejects.toBeInstanceOf(NotFoundException);

    expect(libraryRepo.findById).not.toHaveBeenCalled();
    expect(libraryRepo.getStats).not.toHaveBeenCalled();
  });

  it('writeMetadataToFiles blocks non-dry-run when file write is disabled', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: false }]);

    await expect(service.writeMetadataToFiles(1, 7, false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writeMetadataToFiles throws when the library does not exist', async () => {
    libraryRepo.findById.mockResolvedValue([]);

    await expect(service.writeMetadataToFiles(404, 7, true)).rejects.toBeInstanceOf(NotFoundException);
    expect(fileWriteService.findNonMissingPrimaryFilesByLibrary).not.toHaveBeenCalled();
  });

  it('writeMetadataToFiles emits progress and returns summary counters', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: true }]);
    fileWriteService.findNonMissingPrimaryFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
    fileWriteService.writeToFile
      .mockResolvedValueOnce({ status: 'success', fieldsWritten: [], durationMs: 1 })
      .mockResolvedValueOnce({ status: 'failed', fieldsWritten: [], durationMs: 1, reason: 'write failed' })
      .mockResolvedValueOnce({ status: 'skipped', fieldsWritten: [], durationMs: 1, reason: 'no changes' });

    const onProgress = vi.fn();
    const summary = await service.writeMetadataToFiles(1, 7, false, { onProgress });

    expect(summary).toEqual({ processed: 3, succeeded: 1, failed: 1, skipped: 1, cancelled: false });
    expect(onProgress).toHaveBeenNthCalledWith(1, { bookId: 1, status: 'success', reason: undefined });
    expect(onProgress).toHaveBeenNthCalledWith(2, { bookId: 2, status: 'failed', reason: 'write failed' });
    expect(onProgress).toHaveBeenNthCalledWith(3, { bookId: 3, status: 'skipped', reason: 'no changes' });
  });

  it('writeMetadataToFiles converts thrown write errors into failed results', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: true }]);
    fileWriteService.findNonMissingPrimaryFilesByLibrary.mockResolvedValue([{ bookId: 1 }]);
    fileWriteService.writeToFile.mockRejectedValue('disk offline');

    const summary = await service.writeMetadataToFiles(1, 7, false);

    expect(summary).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0, cancelled: false });
  });

  it('writeMetadataToFiles stops when cancellation is requested', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: true }]);
    fileWriteService.findNonMissingPrimaryFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 1 });

    let isCancelled = false;
    const summary = await service.writeMetadataToFiles(1, 7, false, {
      onProgress: () => {
        isCancelled = true;
      },
      isCancelled: () => isCancelled,
    });

    expect(fileWriteService.writeToFile).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0, cancelled: true });
  });
});
