import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types';

import { AudiobookshelfCompatService } from './audiobookshelf-compat.service';
import { encodeWarehouseBookId } from '../warehouse/warehouse-book-card.mapper';

describe('AudiobookshelfCompatService', () => {
  it('passes auth login through a no-op cookie reply and maps the ABS response', async () => {
    const authService = {
      login: vi.fn().mockResolvedValue({
        accessToken: 'bookorbit-access-token',
        user: {
          id: 42,
          username: 'ramindexadmin',
          email: 'admin@example.test',
          isSuperuser: true,
        },
      }),
    };
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn(),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const absAssetService = {
      pipeCover: vi.fn(),
      pipeDownload: vi.fn(),
      play: vi.fn(),
      pipeTrack: vi.fn(),
    };

    const service = new AudiobookshelfCompatService(
      authService as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      absAssetService as never,
    );
    const response = await service.login({ username: '  ramindexadmin  ', password: 'secret' }, '10.0.0.8');

    expect(authService.login).toHaveBeenCalledWith(
      { username: 'ramindexadmin', password: 'secret' },
      expect.objectContaining({
        setCookie: expect.any(Function),
        clearCookie: expect.any(Function),
      }),
      '10.0.0.8',
    );
    expect(response).toMatchObject({
      user: {
        id: '42',
        username: 'ramindexadmin',
        email: 'admin@example.test',
        type: 'root',
      },
      token: 'bookorbit-access-token',
      refreshToken: null,
      source: 'bookorbit',
    });
  });

  it('returns the AuthService-issued access token with the normal token-version claim', async () => {
    const jwtService = new JwtService({ secret: 'abs-login-test-secret' });
    const accessToken = jwtService.sign({ sub: 42, ver: 7 });
    const authService = {
      login: vi.fn().mockResolvedValue({
        accessToken,
        user: {
          id: 42,
          username: 'ramindexadmin',
          email: 'admin@example.test',
          isSuperuser: true,
        },
      }),
    };
    const service = new AudiobookshelfCompatService(authService as never, {} as never, {} as never, {} as never, {} as never);

    const response = await service.login({ username: 'ramindexadmin', password: 'secret' });
    const payload = jwtService.decode(response.token) as { sub?: number; ver?: number };

    expect(response.token).toBe(accessToken);
    expect(payload).toMatchObject({ sub: 42, ver: 7 });
  });

  it('rejects missing ABS credentials', async () => {
    const service = new AudiobookshelfCompatService({ login: vi.fn() } as never, {} as never, {} as never, {} as never, {} as never);

    await expect(service.login({ username: ' ', password: '' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lists libraries through the normal library service and maps ABS ids', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraries = [
      {
        id: 7,
        name: 'Books',
        coverAspectRatio: '2/3',
        sourceKind: 'filesystem',
      },
      {
        id: CLOUD_AUDIO_LIBRARY_ID,
        name: 'Audiobooks',
        coverAspectRatio: '1/1',
        sourceKind: 'source_backed',
      },
    ];
    const libraryService = {
      findAll: vi.fn().mockResolvedValue(libraries),
      verifyUserAccess: vi.fn(),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.listLibraries(user)).resolves.toEqual([
      {
        id: 'lib_l_7',
        name: 'Books',
        mediaType: 'book',
        settings: { coverAspectRatio: '2/3' },
      },
      {
        id: 'lib_bw_audio',
        name: 'Audiobooks',
        mediaType: 'audiobook',
        settings: { coverAspectRatio: '1/1' },
      },
    ]);
    expect(libraryService.findAll).toHaveBeenCalledWith(user, { includeSourceBacked: true });
  });

  it('does not leak provider or source-backed details when listing warehouse libraries', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn().mockResolvedValue([
        {
          id: CLOUD_AUDIO_LIBRARY_ID,
          name: 'Audiobooks',
          coverAspectRatio: '1/1',
          sourceKind: 'source_backed',
          provider: 'warehouse',
        },
      ]),
      verifyUserAccess: vi.fn(),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      { queryForLibrary: vi.fn() } as never,
      { findAccessibleCatalogItemById: vi.fn() } as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    const response = await service.listLibraries(user);
    const serialized = JSON.stringify(response);

    expect(response[0]).toEqual({
      id: 'lib_bw_audio',
      name: 'Audiobooks',
      mediaType: 'audiobook',
      settings: { coverAspectRatio: '1/1' },
    });
    expect(response[0]).not.toHaveProperty('provider');
    expect((response[0] as { settings: Record<string, unknown> }).settings).not.toHaveProperty('sourceKind');
    expect(serialized).not.toContain('source_backed');
    expect(serialized).not.toContain('warehouse');
  });

  it('browses warehouse libraries through the source-backed library service', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn().mockResolvedValue({
        items: [
          {
            id: encodeWarehouseBookId('audiobook', 1),
            catalogSource: {
              mediaType: 'audiobook',
              remoteId: 'remote-secret-1',
            },
            status: 'present',
            title: 'Audio Dune',
            subtitle: null,
            authors: ['Frank Herbert'],
            narrators: ['Simon Vance'],
            seriesName: null,
            seriesIndex: null,
            files: [],
            publishedYear: null,
            language: null,
            genres: [],
            rating: null,
            readingProgress: null,
            readStatus: null,
            addedAt: new Date(0).toISOString(),
            updatedAt: null,
            metadataScore: null,
            hasCover: true,
            hasMetadataLocks: false,
            lockedFields: [],
            publisher: null,
            pageCount: null,
            isbn13: null,
            hardcoverId: null,
            hardcoverEditionId: null,
            tags: [],
          },
        ],
        total: 1,
        page: 0,
        size: 50,
      }),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.listLibraryItems(user, 'lib_bw_audio', query)).resolves.toEqual({
      results: [
        {
          id: 'bo_bw_audio_catalog_1',
          libraryId: 'lib_bw_audio',
          mediaType: 'audiobook',
          coverPath: '/api/items/bo_bw_audio_catalog_1/cover',
          duration: null,
          metadata: {
            title: 'Audio Dune',
            subtitle: null,
            authors: ['Frank Herbert'],
            narrators: ['Simon Vance'],
          },
        },
      ],
      total: 1,
      page: 0,
      limit: 50,
    });
    const response = await service.listLibraryItems(user, 'lib_bw_audio', query);
    expect(JSON.stringify(response)).not.toContain('remote-secret-1');

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, CLOUD_AUDIO_LIBRARY_ID, user.isSuperuser);
    expect(libraryService.querySourceBackedLibraryBooks).toHaveBeenCalledWith(user, CLOUD_AUDIO_LIBRARY_ID, query);
    expect(bookService.queryForLibrary).not.toHaveBeenCalled();
  });

  it('browses local libraries through the book service', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 1, size: 25 } } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn().mockResolvedValue({
        items: [{ id: 9, title: 'Dune', authors: ['Frank Herbert'], hasCover: true }],
        total: 1,
        page: 1,
        size: 25,
      }),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.listLibraryItems(user, 'lib_l_7', query)).resolves.toEqual({
      results: [
        {
          id: 'bo_l_7_book_9',
          libraryId: 'lib_l_7',
          mediaType: 'book',
          coverPath: '/api/items/bo_l_7_book_9/cover',
          metadata: {
            title: 'Dune',
            subtitle: null,
            authors: ['Frank Herbert'],
            narrators: [],
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 7, user.isSuperuser);
    expect(bookService.queryForLibrary).toHaveBeenCalledWith(user, 7, query);
    expect(libraryService.querySourceBackedLibraryBooks).not.toHaveBeenCalled();
  });

  it('rejects invalid ABS library IDs as bad requests before checking access', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn(),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.listLibraryItems(user, 'not-valid', {} as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(libraryService.verifyUserAccess).not.toHaveBeenCalled();
    expect(libraryService.querySourceBackedLibraryBooks).not.toHaveBeenCalled();
    expect(bookService.queryForLibrary).not.toHaveBeenCalled();
  });

  it('gets local ABS items, verifies access, and maps them', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
      getDetail: vi.fn().mockResolvedValue({
        id: 55,
        libraryId: 3,
        title: 'Dune',
        subtitle: null,
        authors: [{ id: 1, name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
        coverSource: 'custom',
        audioMetadata: { narrators: [], durationSeconds: null, abridged: false, chapters: null },
      }),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
    );

    await expect(service.getItem(user, 'bo_l_3_book_55')).resolves.toEqual({
      id: 'bo_l_3_book_55',
      libraryId: 'lib_l_3',
      mediaType: 'book',
      coverPath: '/api/items/bo_l_3_book_55/cover',
      metadata: {
        title: 'Dune',
        subtitle: null,
        authors: ['Frank Herbert'],
        narrators: [],
      },
    });

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 3, user.isSuperuser);
    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(55, user);
    expect(bookService.getDetail).toHaveBeenCalledWith(55, user);
  });

  it('returns not found when local ABS detail is hidden by existing book access checks', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn().mockRejectedValue(new NotFoundException('Book 55 not found')),
      getDetail: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.getItem(user, 'bo_l_3_book_55')).rejects.toBeInstanceOf(NotFoundException);
    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(55, user);
    expect(bookService.getDetail).not.toHaveBeenCalled();
  });

  it('returns not found when a local ABS item belongs to a different library', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
      getDetail: vi.fn().mockResolvedValue({
        id: 55,
        libraryId: 4,
        title: 'Dune',
        subtitle: null,
        authors: [{ id: 1, name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
        audioMetadata: { narrators: [], durationSeconds: null, abridged: false, chapters: null },
      }),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.getItem(user, 'bo_l_3_book_55')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gets catalog ABS items, verifies access, and never leaks remote ids', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
        id: 77,
        mediaType: 'audiobook',
        remoteId: 'upstream-secret',
        title: 'Audio Dune',
        subtitle: null,
        authors: ['Frank Herbert'],
        narrators: ['Simon Vance'],
        durationSeconds: 123,
        hasCover: true,
      }),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
    );

    const result = await service.getItem(user, 'bo_bw_audio_catalog_77');

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, CLOUD_AUDIO_LIBRARY_ID, user.isSuperuser);
    expect(warehouseCatalogService.findAccessibleCatalogItemById).toHaveBeenCalledWith(user, 'audiobook', 77);
    expect(result).toEqual({
      id: 'bo_bw_audio_catalog_77',
      libraryId: 'lib_bw_audio',
      mediaType: 'audiobook',
      coverPath: '/api/items/bo_bw_audio_catalog_77/cover',
      duration: 123,
      metadata: {
        title: 'Audio Dune',
        subtitle: null,
        authors: ['Frank Herbert'],
        narrators: ['Simon Vance'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('upstream-secret');
  });

  it('rejects catalog ABS items when the media type does not match the encoded id', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
        id: 77,
        mediaType: 'ebook',
        remoteId: 'upstream-secret',
        title: 'Audio Dune',
        subtitle: null,
        authors: ['Frank Herbert'],
        narrators: [],
        durationSeconds: null,
        hasCover: false,
      }),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.getItem(user, 'bo_bw_audio_catalog_77')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns not found when a warehouse ABS item is hidden by content filters', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue(null),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.getItem(user, 'bo_bw_audio_catalog_77')).rejects.toBeInstanceOf(NotFoundException);
    expect(warehouseCatalogService.findAccessibleCatalogItemById).toHaveBeenCalledWith(user, 'audiobook', 77);
  });

  it('rejects invalid ABS item ids as bad requests before checking access', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn(),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn(),
      getDetail: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.getItem(user, '0')).rejects.toBeInstanceOf(BadRequestException);

    expect(libraryService.verifyUserAccess).not.toHaveBeenCalled();
    expect(bookService.verifyBookAccess).not.toHaveBeenCalled();
    expect(bookService.getDetail).not.toHaveBeenCalled();
    expect(warehouseCatalogService.findAccessibleCatalogItemById).not.toHaveBeenCalled();
  });

  it('converts malformed synthetic warehouse browse ids into bad requests', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const query = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn().mockResolvedValue({
        items: [
          {
            id: 0,
            catalogSource: { mediaType: 'audiobook', remoteId: 'remote-secret-1' },
            status: 'present',
            title: 'Broken',
            subtitle: null,
            authors: ['Frank Herbert'],
            narrators: [],
            seriesName: null,
            seriesIndex: null,
            files: [],
            publishedYear: null,
            language: null,
            genres: [],
            rating: null,
            readingProgress: null,
            readStatus: null,
            addedAt: new Date(0).toISOString(),
            updatedAt: null,
            metadataScore: null,
            hasCover: false,
            hasMetadataLocks: false,
            lockedFields: [],
            publisher: null,
            pageCount: null,
            isbn13: null,
            hardcoverId: null,
            hardcoverEditionId: null,
            tags: [],
          },
        ],
        total: 1,
        page: 0,
        size: 50,
      }),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      { queryForLibrary: vi.fn() } as never,
      { findAccessibleCatalogItemById: vi.fn() } as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    await expect(service.listLibraryItems(user, 'lib_bw_audio', query)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delegates cover, download, play, and track piping to the asset service', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const absAssetService = {
      pipeCover: vi.fn().mockResolvedValue('cover-result'),
      pipeDownload: vi.fn().mockResolvedValue('download-result'),
      play: vi.fn().mockResolvedValue({ audioTracks: [] }),
      pipeTrack: vi.fn().mockResolvedValue('track-result'),
    };
    const service = new AudiobookshelfCompatService({ login: vi.fn() } as never, {} as never, {} as never, {} as never, absAssetService as never);
    const reply = {} as any;

    await expect(service.pipeCover(user, 'bo_l_3_book_55', reply)).resolves.toBe('cover-result');
    await expect(service.pipeDownload(user, 'bo_bw_audio_catalog_77', 'bytes=10-99', reply)).resolves.toBe('download-result');
    await expect(service.play(user, 'bo_bw_audio_catalog_77')).resolves.toEqual({ audioTracks: [] });
    await expect(service.pipeTrack(user, 'bo_bw_audio_catalog_77', '1', 'bytes=10-99', reply)).resolves.toBe('track-result');

    expect(absAssetService.pipeCover).toHaveBeenCalledWith(user, 'bo_l_3_book_55', reply);
    expect(absAssetService.pipeDownload).toHaveBeenCalledWith(user, 'bo_bw_audio_catalog_77', 'bytes=10-99', reply);
    expect(absAssetService.play).toHaveBeenCalledWith(user, 'bo_bw_audio_catalog_77');
    expect(absAssetService.pipeTrack).toHaveBeenCalledWith(user, 'bo_bw_audio_catalog_77', '1', 'bytes=10-99', reply);
  });

  it('updates local audiobook progress through BookService using a real file id after access checks', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
      getDetail: vi.fn().mockResolvedValue({
        id: 55,
        libraryId: 3,
        files: [
          { id: 701, role: 'supplemental', format: 'epub' },
          { id: 702, role: 'primary', format: 'm4b' },
        ],
        audioMetadata: { narrators: [], durationSeconds: 900, abridged: false, chapters: null },
      }),
      saveAudioProgress: vi.fn().mockResolvedValue(undefined),
      saveProgress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      { findAccessibleCatalogItemById: vi.fn() } as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
    );

    const result = await (service as any).updateProgress(user, 'bo_l_3_book_55', { progress: 0.5, currentTime: 90 });

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 3, user.isSuperuser);
    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(55, user);
    expect(bookService.getDetail).toHaveBeenCalledWith(55, user);
    expect(bookService.saveAudioProgress).toHaveBeenCalledWith(
      user.id,
      55,
      {
        currentFileId: 702,
        percentage: 50,
        positionSeconds: 90,
      },
      user,
    );
    expect(bookService.saveProgress).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('702');
    expect(result).toEqual({
      success: true,
      result: {
        itemId: 'bo_l_3_book_55',
        progress: 50,
        positionSeconds: 90,
        isFinished: false,
      },
    });
  });

  it('updates warehouse progress only after resolving an accessible catalog item and never leaks remote ids', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
        id: 77,
        mediaType: 'audiobook',
        remoteId: 'upstream-secret',
        title: 'Audio Dune',
      }),
    };
    const warehouseUserStateService = {
      patchState: vi.fn().mockResolvedValue({ progressPercent: 25, positionSeconds: 125, readStatus: 'reading' }),
      saveReadingSession: vi.fn(),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      { queryForLibrary: vi.fn() } as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
      undefined as never,
      warehouseUserStateService as never,
    );

    const result = await (service as any).updateProgress(user, 'bo_bw_audio_catalog_77', { progressPercent: 25, position: 125 });

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, CLOUD_AUDIO_LIBRARY_ID, user.isSuperuser);
    expect(warehouseCatalogService.findAccessibleCatalogItemById).toHaveBeenCalledWith(user, 'audiobook', 77);
    expect(warehouseCatalogService.findAccessibleCatalogItemById.mock.invocationCallOrder[0]).toBeLessThan(
      warehouseUserStateService.patchState.mock.invocationCallOrder[0],
    );
    expect(warehouseUserStateService.patchState).toHaveBeenCalledWith(user, 'audiobook', 'upstream-secret', {
      progressPercent: 25,
      positionSeconds: 125,
      readStatus: 'reading',
    });
    expect(JSON.stringify(result)).not.toContain('upstream-secret');
    expect(result).toEqual({
      success: true,
      result: {
        itemId: 'bo_bw_audio_catalog_77',
        progress: 25,
        positionSeconds: 125,
        isFinished: false,
      },
    });
  });

  it('syncs a single local offline session for local and warehouse items', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const libraryService = {
      findAll: vi.fn(),
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = {
      queryForLibrary: vi.fn(),
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
      getDetail: vi.fn().mockResolvedValue({
        id: 55,
        libraryId: 3,
        files: [{ id: 701, role: 'primary', format: 'epub' }],
        audioMetadata: null,
      }),
    };
    const readingSessionService = {
      save: vi.fn().mockResolvedValue(undefined),
    };
    const warehouseCatalogService = {
      findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
        id: 9,
        mediaType: 'ebook',
        remoteId: 'ebook-secret',
      }),
    };
    const warehouseUserStateService = {
      patchState: vi.fn(),
      saveReadingSession: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      libraryService as never,
      bookService as never,
      warehouseCatalogService as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
      readingSessionService as never,
      warehouseUserStateService as never,
    );

    const localResult = await (service as any).syncLocalSession(user, {
      itemId: 'bo_l_3_book_55',
      sessionId: 'local-offline-1',
      startedAt: '2026-06-01T12:00:00.000Z',
      endedAt: '2026-06-01T12:20:00.000Z',
      duration: 1200,
      progressPercent: 20,
    });
    const warehouseResult = await (service as any).syncLocalSession(user, {
      itemId: 'bo_bw_ebook_catalog_9',
      sessionId: 'warehouse-offline-1',
      startedAt: '2026-06-01T13:00:00.000Z',
      updatedAt: '2026-06-01T13:10:00.000Z',
      duration: 600,
      progress: 0.4,
    });

    expect(readingSessionService.save).toHaveBeenCalledWith(
      701,
      {
        sessionId: 'local-offline-1',
        startedAt: '2026-06-01T12:00:00.000Z',
        endedAt: '2026-06-01T12:20:00.000Z',
        durationSeconds: 1200,
        progressDelta: null,
        endProgress: 20,
      },
      user,
    );
    expect(warehouseUserStateService.saveReadingSession).toHaveBeenCalledWith(user, 'ebook', 'ebook-secret', {
      sessionId: 'warehouse-offline-1',
      startedAt: '2026-06-01T13:00:00.000Z',
      endedAt: '2026-06-01T13:10:00.000Z',
      durationSeconds: 600,
      progressDelta: null,
      endProgress: 40,
    });
    expect(JSON.stringify(warehouseResult)).not.toContain('ebook-secret');
    expect(localResult.success).toBe(true);
    expect(warehouseResult.success).toBe(true);
  });

  it('syncs local-all batches with per-session failures instead of aborting the whole batch', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      {
        verifyBookAccess: vi.fn().mockResolvedValue(undefined),
        getDetail: vi
          .fn()
          .mockResolvedValueOnce({
            id: 55,
            libraryId: 3,
            files: [{ id: 701, role: 'primary', format: 'epub' }],
            audioMetadata: null,
          })
          .mockResolvedValueOnce({
            id: 56,
            libraryId: 3,
            files: [],
            audioMetadata: null,
          }),
      } as never,
      { findAccessibleCatalogItemById: vi.fn() } as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
      { save: vi.fn().mockResolvedValue(undefined) } as never,
      { saveReadingSession: vi.fn() } as never,
    );

    const result = await (service as any).syncLocalSessions(user, {
      sessions: [
        {
          itemId: 'bo_l_3_book_55',
          sessionId: 'ok-1',
          startedAt: '2026-06-01T12:00:00.000Z',
          endedAt: '2026-06-01T12:10:00.000Z',
          duration: 600,
          progressPercent: 10,
        },
        {
          itemId: 'bo_l_3_book_56',
          sessionId: 'bad-1',
          startedAt: '2026-06-01T12:00:00.000Z',
          endedAt: '2026-06-01T12:10:00.000Z',
          duration: 600,
          progressPercent: 10,
        },
      ],
    });

    expect(result).toEqual({
      success: false,
      results: [
        {
          success: true,
          result: {
            itemId: 'bo_l_3_book_55',
            sessionId: 'ok-1',
          },
        },
        {
          success: false,
          itemId: 'bo_l_3_book_56',
          error: 'not_found',
        },
      ],
    });
  });

  it('sanitizes local-all downstream failure details that contain internal ids or upstream URLs', async () => {
    const user = { id: 17, isSuperuser: false } as any;
    const readingSessionService = {
      save: vi.fn().mockRejectedValue(new Error('failed to save fileId=701 at https://warehouse.example/private')),
    };
    const warehouseUserStateService = {
      saveReadingSession: vi.fn().mockRejectedValue(new Error('remoteId=warehouse-secret-9 provider=https://upstream.example/item')),
    };
    const service = new AudiobookshelfCompatService(
      { login: vi.fn() } as never,
      { verifyUserAccess: vi.fn().mockResolvedValue(undefined) } as never,
      {
        verifyBookAccess: vi.fn().mockResolvedValue(undefined),
        getDetail: vi.fn().mockResolvedValue({
          id: 55,
          libraryId: 3,
          files: [{ id: 701, role: 'primary', format: 'epub' }],
          audioMetadata: null,
        }),
      } as never,
      {
        findAccessibleCatalogItemById: vi.fn().mockResolvedValue({
          id: 9,
          mediaType: 'ebook',
          remoteId: 'warehouse-secret-9',
        }),
      } as never,
      { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() } as never,
      readingSessionService as never,
      warehouseUserStateService as never,
    );

    const result = await (service as any).syncLocalSessions(user, {
      sessions: [
        {
          itemId: 'bo_l_3_book_55',
          sessionId: 'local-leak',
          startedAt: '2026-06-01T12:00:00.000Z',
          endedAt: '2026-06-01T12:10:00.000Z',
          duration: 600,
          progressPercent: 10,
        },
        {
          itemId: 'bo_bw_ebook_catalog_9',
          sessionId: 'warehouse-leak',
          startedAt: '2026-06-01T12:00:00.000Z',
          endedAt: '2026-06-01T12:10:00.000Z',
          duration: 600,
          progressPercent: 10,
        },
        {
          itemId: '0',
          sessionId: 'placeholder-zero',
          startedAt: '2026-06-01T12:00:00.000Z',
          endedAt: '2026-06-01T12:10:00.000Z',
          duration: 600,
          progressPercent: 10,
        },
      ],
    });

    const body = JSON.stringify(result);
    expect(result).toEqual({
      success: false,
      results: [
        { success: false, itemId: 'bo_l_3_book_55', error: 'sync_failed' },
        { success: false, itemId: 'bo_bw_ebook_catalog_9', error: 'sync_failed' },
        { success: false, itemId: null, error: 'invalid_item' },
      ],
    });
    expect(body).not.toContain('701');
    expect(body).not.toContain('warehouse-secret-9');
    expect(body).not.toContain('https://');
    expect(body).not.toContain('upstream.example');
  });
});
