import { BadRequestException, CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { RequestMethod } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import type { FastifyInstance } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AudiobookshelfCompatController } from './audiobookshelf-compat.controller';
import type { AbsStatusResponse } from './dto';
import { AudiobookshelfCompatService } from './audiobookshelf-compat.service';
import { LoginDto } from '../auth/dto/login.dto';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';

type CompatServiceMock = {
  getStatus: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  listLibraries: ReturnType<typeof vi.fn>;
  listLibraryItems: ReturnType<typeof vi.fn>;
  getItem: ReturnType<typeof vi.fn>;
  pipeCover: ReturnType<typeof vi.fn>;
  pipeDownload: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pipeTrack: ReturnType<typeof vi.fn>;
  updateProgress: ReturnType<typeof vi.fn>;
  syncLocalSession: ReturnType<typeof vi.fn>;
  syncLocalSessions: ReturnType<typeof vi.fn>;
};

const statusResponse: AbsStatusResponse = {
  server: 'BookOrbit',
  version: '0.0.0-test',
  language: 'en-us',
  authMethods: ['local'],
};

const loginResponse = {
  user: {
    id: '42',
    username: 'ramindexadmin',
    email: 'admin@example.test',
    type: 'root',
    token: null,
    mediaProgress: [],
    seriesHideFromContinueListening: [],
    bookmarks: [],
  },
  token: 'abs-token-123',
  refreshToken: null,
  source: 'bookorbit',
  serverSettings: {
    version: '0.0.0-test',
    authMethods: ['local'],
  },
};

@Injectable()
class PublicOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

    if (!isPublic) {
      throw new UnauthorizedException();
    }

    return true;
  }
}

describe('AudiobookshelfCompatController handshake', () => {
  let controller: AudiobookshelfCompatController;
  let service: CompatServiceMock;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AudiobookshelfCompatController],
      providers: [
        {
          provide: AudiobookshelfCompatService,
          useValue: {
            getStatus: vi.fn().mockResolvedValue(statusResponse),
            login: vi.fn().mockResolvedValue(loginResponse),
            listLibraries: vi.fn(),
            listLibraryItems: vi.fn(),
            getItem: vi.fn(),
            pipeCover: vi.fn(),
            pipeDownload: vi.fn(),
            play: vi.fn(),
            pipeTrack: vi.fn(),
            updateProgress: vi.fn(),
            syncLocalSession: vi.fn(),
            syncLocalSessions: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(AudiobookshelfCompatController);
    service = moduleRef.get(AudiobookshelfCompatService) as unknown as CompatServiceMock;
  });

  it('returns the ABS ping shape', () => {
    expect(controller.ping()).toEqual({ success: true });
  });

  it('returns status without requiring auth', async () => {
    await expect(controller.status()).resolves.toEqual(statusResponse);
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });

  it('delegates login to the compat service', async () => {
    const dto: LoginDto = { username: '  ramindexadmin  ', password: 'secret' };

    await expect(controller.login(dto, { ip: '10.0.0.8' } as never)).resolves.toEqual(loginResponse);
    expect(service.login).toHaveBeenCalledWith(dto, '10.0.0.8');
  });

  it('exposes ABS-style library route metadata', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.listLibraries)).toBe('api/libraries');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.listLibraryItems)).toBe('api/libraries/:libraryId/items');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.getItem)).toBe('api/items/:itemId');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.getCover)).toBe('api/items/:itemId/cover');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.download)).toBe('api/items/:itemId/download');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.play)).toBe('api/items/:itemId/play');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.streamTrack)).toBe('api/items/:itemId/tracks/:trackId/stream');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.postProgress)).toBe('api/items/:itemId/progress');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.patchProgress)).toBe('api/items/:itemId/progress');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.syncLocalSession)).toBe('api/session/local');
    expect(Reflect.getMetadata(PATH_METADATA, AudiobookshelfCompatController.prototype.syncLocalSessions)).toBe('api/session/local-all');
  });

  it('delegates ABS library listing to the compat service', async () => {
    const user = { id: 7, isSuperuser: false } as any;
    const libraries = [{ id: 'lib_l_7' }];
    service.listLibraries.mockResolvedValue(libraries);

    await expect(controller.listLibraries(user)).resolves.toBe(libraries);
    expect(service.listLibraries).toHaveBeenCalledWith(user);
  });

  it('parses ABS library item GET queries before delegating to the compat service', async () => {
    const user = { id: 7, isSuperuser: false } as any;
    const query = {
      q: 'dune',
      collapseSeries: 'true',
      sort: JSON.stringify([{ field: 'title', dir: 'desc' }]),
      pagination: JSON.stringify({ page: 1, size: 25 }),
    } as any;
    const page = { results: [], total: 0, page: 0, limit: 50 };
    service.listLibraryItems.mockResolvedValue(page);

    await expect(controller.listLibraryItems('lib_l_7', query, user)).resolves.toBe(page);
    expect(service.listLibraryItems).toHaveBeenCalledWith(user, 'lib_l_7', {
      q: 'dune',
      collapseSeries: true,
      sort: [{ field: 'title', dir: 'desc' }],
      pagination: { page: 1, size: 25 },
    });
  });

  it('delegates ABS item detail to the compat service', async () => {
    const user = { id: 7, isSuperuser: false } as any;
    const item = { id: 'bo_l_7_book_9' };
    service.getItem.mockResolvedValue(item);

    await expect(controller.getItem('bo_l_7_book_9', user)).resolves.toBe(item);
    expect(service.getItem).toHaveBeenCalledWith(user, 'bo_l_7_book_9');
  });

  it('delegates ABS asset routes to the compat service', async () => {
    const user = { id: 7, isSuperuser: false } as any;
    const reply = {} as any;
    service.pipeCover.mockResolvedValue('cover');
    service.pipeDownload.mockResolvedValue('download');
    service.play.mockResolvedValue({ audioTracks: [] });
    service.pipeTrack.mockResolvedValue('track');

    await expect(controller.getCover('bo_l_7_book_9', user, reply)).resolves.toBe('cover');
    await expect(controller.download('bo_bw_audio_catalog_77', user, reply, 'bytes=10-99')).resolves.toBe('download');
    await expect(controller.play('bo_bw_audio_catalog_77', user)).resolves.toEqual({ audioTracks: [] });
    await expect(controller.streamTrack('bo_bw_audio_catalog_77', '1', user, reply, 'bytes=10-99')).resolves.toBe('track');

    expect(service.pipeCover).toHaveBeenCalledWith(user, 'bo_l_7_book_9', reply);
    expect(service.pipeDownload).toHaveBeenCalledWith(user, 'bo_bw_audio_catalog_77', 'bytes=10-99', reply);
    expect(service.play).toHaveBeenCalledWith(user, 'bo_bw_audio_catalog_77');
    expect(service.pipeTrack).toHaveBeenCalledWith(user, 'bo_bw_audio_catalog_77', '1', 'bytes=10-99', reply);
  });

  it('delegates ABS progress and local session sync routes to the compat service', async () => {
    const user = { id: 7, isSuperuser: false } as any;
    const progressBody = { progress: 0.5, currentTime: 60 };
    const sessionBody = { id: 'bo_l_7_book_9', sessionId: 'offline-1' };
    const batchBody = { sessions: [sessionBody] };
    service.updateProgress.mockResolvedValue({ success: true });
    service.syncLocalSession.mockResolvedValue({ success: true });
    service.syncLocalSessions.mockResolvedValue({ results: [] });

    await expect(controller.postProgress('bo_l_7_book_9', progressBody, user)).resolves.toEqual({ success: true });
    await expect(controller.patchProgress('bo_l_7_book_9', progressBody, user)).resolves.toEqual({ success: true });
    await expect(controller.syncLocalSession(sessionBody, user)).resolves.toEqual({ success: true });
    await expect(controller.syncLocalSessions(batchBody, user)).resolves.toEqual({ results: [] });

    expect(service.updateProgress).toHaveBeenNthCalledWith(1, user, 'bo_l_7_book_9', progressBody);
    expect(service.updateProgress).toHaveBeenNthCalledWith(2, user, 'bo_l_7_book_9', progressBody);
    expect(service.syncLocalSession).toHaveBeenCalledWith(user, sessionBody);
    expect(service.syncLocalSessions).toHaveBeenCalledWith(user, batchBody);
  });
});

describe('AudiobookshelfCompat HTTP handshake routes', () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let service: CompatServiceMock;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AudiobookshelfCompatController],
      providers: [
        {
          provide: AudiobookshelfCompatService,
          useValue: {
            getStatus: vi.fn().mockResolvedValue(statusResponse),
            login: vi.fn().mockResolvedValue(loginResponse),
            listLibraries: vi.fn(),
            listLibraryItems: vi.fn(),
            getItem: vi.fn(),
            pipeCover: vi.fn(),
            pipeDownload: vi.fn(),
            play: vi.fn(),
            pipeTrack: vi.fn(),
            updateProgress: vi.fn(),
            syncLocalSession: vi.fn(),
            syncLocalSessions: vi.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AudiobookshelfCompatService) as unknown as CompatServiceMock;

    app = moduleRef.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api/v1', {
      exclude: [
        'api/kobo/:deviceToken/(.*)',
        'ping',
        'status',
        'login',
        'api/libraries',
        'api/libraries/:libraryId/items',
        'api/items/:itemId',
        { path: 'api/items/:itemId/cover', method: RequestMethod.GET },
        { path: 'api/items/:itemId/download', method: RequestMethod.GET },
        { path: 'api/items/:itemId/play', method: RequestMethod.POST },
        { path: 'api/items/:itemId/tracks/:trackId/stream', method: RequestMethod.GET },
        { path: 'api/items/:itemId/progress', method: RequestMethod.POST },
        { path: 'api/items/:itemId/progress', method: RequestMethod.PATCH },
        { path: 'api/session/local', method: RequestMethod.POST },
        { path: 'api/session/local-all', method: RequestMethod.POST },
        'api/v3/(.*)',
        'api/UserStorage/(.*)',
      ],
    });
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.getStatus.mockClear();
    service.login.mockClear();
    service.listLibraries.mockClear();
    service.listLibraryItems.mockClear();
    service.getItem.mockClear();
    service.pipeCover.mockClear();
    service.pipeDownload.mockClear();
    service.play.mockClear();
    service.pipeTrack.mockClear();
    service.updateProgress.mockClear();
    service.syncLocalSession.mockClear();
    service.syncLocalSessions.mockClear();
  });

  it('mounts ABS library list at root /api/libraries', async () => {
    const libraries = [{ id: 'lib_bw_audio', name: 'Audiobooks' }];
    service.listLibraries.mockResolvedValue(libraries);

    const response = await server.inject({
      method: 'GET',
      url: '/api/libraries',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual(libraries);
    expect(service.listLibraries).toHaveBeenCalledTimes(1);
  });

  it('mounts ABS library item browse at root /api/libraries/:libraryId/items and parses queries', async () => {
    const items = { results: [], total: 0, page: 2, limit: 10 };
    service.listLibraryItems.mockResolvedValue(items);
    const sort = encodeURIComponent(JSON.stringify([{ field: 'title', dir: 'asc' }]));
    const pagination = encodeURIComponent(JSON.stringify({ page: 2, size: 10 }));

    const response = await server.inject({
      method: 'GET',
      url: `/api/libraries/lib_l_7/items?q=dune&collapseSeries=false&sort=${sort}&pagination=${pagination}`,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual(items);
    expect(service.listLibraryItems).toHaveBeenCalledWith(undefined, 'lib_l_7', {
      q: 'dune',
      collapseSeries: false,
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 2, size: 10 },
    });
  });

  it('mounts ABS item detail at root /api/items/:itemId', async () => {
    const item = { id: 'bo_l_7_book_9' };
    service.getItem.mockResolvedValue(item);

    const response = await server.inject({
      method: 'GET',
      url: '/api/items/bo_l_7_book_9',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual(item);
    expect(service.getItem).toHaveBeenCalledWith(undefined, 'bo_l_7_book_9');
  });

  it('mounts ABS asset routes at root paths', async () => {
    service.pipeCover.mockImplementation((_user, _itemId, reply) => reply.code(204).send());
    service.pipeDownload.mockImplementation((_user, _itemId, _range, reply) => reply.code(204).send());
    service.play.mockResolvedValue({ audioTracks: [] });
    service.pipeTrack.mockImplementation((_user, _itemId, _trackId, _range, reply) => reply.code(204).send());

    const cover = await server.inject({ method: 'GET', url: '/api/items/bo_l_7_book_9/cover' });
    const download = await server.inject({ method: 'GET', url: '/api/items/bo_bw_audio_catalog_77/download', headers: { range: 'bytes=10-99' } });
    const play = await server.inject({ method: 'POST', url: '/api/items/bo_bw_audio_catalog_77/play' });
    const track = await server.inject({
      method: 'GET',
      url: '/api/items/bo_bw_audio_catalog_77/tracks/1/stream',
      headers: { range: 'bytes=20-40' },
    });

    expect(cover.statusCode).toBe(204);
    expect(download.statusCode).toBe(204);
    expect(play.statusCode).toBe(200);
    expect(JSON.parse(play.payload)).toEqual({ audioTracks: [] });
    expect(track.statusCode).toBe(204);
    expect(service.pipeCover).toHaveBeenCalledWith(undefined, 'bo_l_7_book_9', expect.anything());
    expect(service.pipeDownload).toHaveBeenCalledWith(undefined, 'bo_bw_audio_catalog_77', 'bytes=10-99', expect.anything());
    expect(service.play).toHaveBeenCalledWith(undefined, 'bo_bw_audio_catalog_77');
    expect(service.pipeTrack).toHaveBeenCalledWith(undefined, 'bo_bw_audio_catalog_77', '1', 'bytes=20-40', expect.anything());
  });

  it('mounts ABS progress and local session sync at root paths', async () => {
    service.updateProgress.mockResolvedValue({ success: true, result: { itemId: 'bo_l_7_book_9', progress: 50 } });
    service.syncLocalSession.mockResolvedValue({ success: true, result: { itemId: 'bo_l_7_book_9' } });
    service.syncLocalSessions.mockResolvedValue({ success: true, results: [] });

    const postProgress = await server.inject({
      method: 'POST',
      url: '/api/items/bo_l_7_book_9/progress',
      payload: { progress: 0.5, currentTime: 60 },
    });
    const patchProgress = await server.inject({
      method: 'PATCH',
      url: '/api/items/bo_l_7_book_9/progress',
      payload: { percentage: 51, position: 61 },
    });
    const local = await server.inject({
      method: 'POST',
      url: '/api/session/local',
      payload: { id: 'bo_l_7_book_9', sessionId: 'offline-1' },
    });
    const localAll = await server.inject({
      method: 'POST',
      url: '/api/session/local-all',
      payload: { sessions: [{ id: 'bo_l_7_book_9', sessionId: 'offline-1' }] },
    });

    expect(postProgress.statusCode).toBe(201);
    expect(patchProgress.statusCode).toBe(200);
    expect(local.statusCode).toBe(201);
    expect(localAll.statusCode).toBe(201);
    expect(service.updateProgress).toHaveBeenNthCalledWith(1, undefined, 'bo_l_7_book_9', { progress: 0.5, currentTime: 60 });
    expect(service.updateProgress).toHaveBeenNthCalledWith(2, undefined, 'bo_l_7_book_9', { percentage: 51, position: 61 });
    expect(service.syncLocalSession).toHaveBeenCalledWith(undefined, { id: 'bo_l_7_book_9', sessionId: 'offline-1' });
    expect(service.syncLocalSessions).toHaveBeenCalledWith(undefined, { sessions: [{ id: 'bo_l_7_book_9', sessionId: 'offline-1' }] });
  });

  it('returns 4xx for malformed JSON query values instead of 500', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/libraries/lib_l_7/items?sort=${encodeURIComponent('[bad-json')}`,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(service.listLibraryItems).not.toHaveBeenCalled();
  });

  it('returns 4xx for invalid ABS library IDs instead of 500', async () => {
    service.listLibraryItems.mockRejectedValueOnce(new BadRequestException('Invalid ABS library ID'));

    const response = await server.inject({
      method: 'GET',
      url: '/api/libraries/not-valid/items',
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it('returns ping at root path', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ success: true });
  });

  it('returns status at root path', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual(statusResponse);
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });

  it('returns login at root path', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/login',
      payload: { username: '  ramindexadmin  ', password: 'secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual(loginResponse);
    expect(service.login).toHaveBeenCalledWith({ username: '  ramindexadmin  ', password: 'secret' }, '127.0.0.1');
  });
});

describe('AudiobookshelfCompat login token with real JWT guard', () => {
  it('authenticates protected ABS routes with the AuthService-issued access token', async () => {
    const jwtSecret = 'abs-compat-route-test-secret';
    const authUser = {
      id: 42,
      username: 'ramindexadmin',
      email: 'admin@example.test',
      isSuperuser: true,
    };
    const requestUser = {
      id: 42,
      username: 'ramindexadmin',
      isSuperuser: true,
      isDefaultPassword: false,
    };
    const authService = {
      login: vi.fn(),
      validateUser: vi.fn((_sub: number, ver: number | undefined) => (ver === 7 ? requestUser : null)),
    };
    const libraryService = {
      findAll: vi.fn().mockResolvedValue([{ id: 7, name: 'Books', coverAspectRatio: '2/3', sourceKind: 'filesystem' }]),
      verifyUserAccess: vi.fn(),
      querySourceBackedLibraryBooks: vi.fn(),
    };
    const bookService = { queryForLibrary: vi.fn() };
    const warehouseCatalogService = { findAccessibleCatalogItemById: vi.fn() };
    const absAssetService = { pipeCover: vi.fn(), pipeDownload: vi.fn(), play: vi.fn(), pipeTrack: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: '15m', algorithm: 'HS256' } }),
      ],
      controllers: [AudiobookshelfCompatController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: vi.fn((key: string) => (key === 'auth.jwtSecret' ? jwtSecret : undefined)) } },
        {
          provide: AudiobookshelfCompatService,
          useFactory: (auth: AuthService) =>
            new AudiobookshelfCompatService(
              auth,
              libraryService as never,
              bookService as never,
              warehouseCatalogService as never,
              absAssetService as never,
            ),
          inject: [AuthService],
        },
      ],
    }).compile();

    const jwtService = moduleRef.get(JwtService);
    const accessToken = jwtService.sign({ sub: 42, ver: 7 });
    authService.login.mockResolvedValue({ accessToken, user: authUser });

    const app = moduleRef.createNestApplication(new FastifyAdapter());
    await app.init();
    const server = app.getHttpAdapter().getInstance() as FastifyInstance;

    try {
      const login = await server.inject({
        method: 'POST',
        url: '/login',
        payload: { username: 'ramindexadmin', password: 'secret' },
      });
      const loginBody = JSON.parse(login.payload) as { token: string };

      const libraries = await server.inject({
        method: 'GET',
        url: '/api/libraries',
        headers: { authorization: `Bearer ${loginBody.token}` },
      });

      expect(login.statusCode).toBe(200);
      expect(loginBody.token).toBe(accessToken);
      expect(authService.validateUser).toHaveBeenCalledWith(42, 7);
      expect(libraries.statusCode).toBe(200);
      expect(JSON.parse(libraries.payload)).toEqual([{ id: 'lib_l_7', name: 'Books', mediaType: 'book', settings: { coverAspectRatio: '2/3' } }]);
      expect(libraryService.findAll).toHaveBeenCalledWith(requestUser, { includeSourceBacked: true });
    } finally {
      await app.close();
    }
  });
});

describe('AudiobookshelfCompat HTTP handshake routes with public-guard', () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let service: CompatServiceMock;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AudiobookshelfCompatController],
      providers: [
        {
          provide: AudiobookshelfCompatService,
          useValue: {
            getStatus: vi.fn().mockResolvedValue(statusResponse),
            login: vi.fn().mockResolvedValue(loginResponse),
            listLibraries: vi.fn(),
            listLibraryItems: vi.fn(),
            getItem: vi.fn(),
            pipeCover: vi.fn(),
            pipeDownload: vi.fn(),
            play: vi.fn(),
            pipeTrack: vi.fn(),
            updateProgress: vi.fn(),
            syncLocalSession: vi.fn(),
            syncLocalSessions: vi.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AudiobookshelfCompatService) as unknown as CompatServiceMock;

    app = moduleRef.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api/v1', {
      exclude: [
        'api/kobo/:deviceToken/(.*)',
        'ping',
        'status',
        'login',
        'api/libraries',
        'api/libraries/:libraryId/items',
        'api/items/:itemId',
        { path: 'api/items/:itemId/cover', method: RequestMethod.GET },
        { path: 'api/items/:itemId/download', method: RequestMethod.GET },
        { path: 'api/items/:itemId/play', method: RequestMethod.POST },
        { path: 'api/items/:itemId/tracks/:trackId/stream', method: RequestMethod.GET },
        { path: 'api/items/:itemId/progress', method: RequestMethod.POST },
        { path: 'api/items/:itemId/progress', method: RequestMethod.PATCH },
        { path: 'api/session/local', method: RequestMethod.POST },
        { path: 'api/session/local-all', method: RequestMethod.POST },
        'api/v3/(.*)',
        'api/UserStorage/(.*)',
      ],
    });
    app.useGlobalGuards(new PublicOnlyGuard(new Reflector()));
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.getStatus.mockClear();
    service.login.mockClear();
    service.listLibraries.mockClear();
    service.listLibraryItems.mockClear();
    service.getItem.mockClear();
    service.pipeCover.mockClear();
    service.pipeDownload.mockClear();
    service.play.mockClear();
    service.pipeTrack.mockClear();
    service.updateProgress.mockClear();
    service.syncLocalSession.mockClear();
    service.syncLocalSessions.mockClear();
  });

  it('returns ping at root path even with a strict public-only guard', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ success: true });
  });

  it('returns status at root path even with a strict public-only guard', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual(statusResponse);
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });

  it('returns login at root path even with a strict public-only guard', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/login',
      payload: { username: 'ramindexadmin', password: 'secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual(loginResponse);
    expect(service.login).toHaveBeenCalledWith({ username: 'ramindexadmin', password: 'secret' }, '127.0.0.1');
  });

  it('protects root ABS library list under the strict public-only guard', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/libraries',
    });

    expect(response.statusCode).toBe(401);
    expect(service.listLibraries).not.toHaveBeenCalled();
  });

  it('protects root ABS library browse under the strict public-only guard', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/libraries/lib_l_7/items',
    });

    expect(response.statusCode).toBe(401);
    expect(service.listLibraryItems).not.toHaveBeenCalled();
  });

  it('protects root ABS item detail under the strict public-only guard', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/items/bo_l_7_book_9',
    });

    expect(response.statusCode).toBe(401);
    expect(service.getItem).not.toHaveBeenCalled();
  });

  it('protects root ABS asset routes under the strict public-only guard', async () => {
    const requests = [
      server.inject({ method: 'GET', url: '/api/items/bo_l_7_book_9/cover' }),
      server.inject({ method: 'GET', url: '/api/items/bo_bw_audio_catalog_77/download' }),
      server.inject({ method: 'POST', url: '/api/items/bo_bw_audio_catalog_77/play' }),
      server.inject({ method: 'GET', url: '/api/items/bo_bw_audio_catalog_77/tracks/1/stream' }),
    ];
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
    expect(service.pipeCover).not.toHaveBeenCalled();
    expect(service.pipeDownload).not.toHaveBeenCalled();
    expect(service.play).not.toHaveBeenCalled();
    expect(service.pipeTrack).not.toHaveBeenCalled();
  });

  it('protects root ABS progress and session sync routes under the strict public-only guard', async () => {
    const requests = [
      server.inject({ method: 'POST', url: '/api/items/bo_l_7_book_9/progress', payload: { progress: 0.5 } }),
      server.inject({ method: 'PATCH', url: '/api/items/bo_l_7_book_9/progress', payload: { progress: 0.5 } }),
      server.inject({ method: 'POST', url: '/api/session/local', payload: { itemId: 'bo_l_7_book_9' } }),
      server.inject({ method: 'POST', url: '/api/session/local-all', payload: { sessions: [{ itemId: 'bo_l_7_book_9' }] } }),
    ];
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401]);
    expect(service.updateProgress).not.toHaveBeenCalled();
    expect(service.syncLocalSession).not.toHaveBeenCalled();
    expect(service.syncLocalSessions).not.toHaveBeenCalled();
  });
});

describe('AudiobookshelfCompatController login metadata', () => {
  it('matches the auth login throttle contract', () => {
    const limitKey = 'THROTTLER:LIMITdefault';
    const ttlKey = 'THROTTLER:TTLdefault';

    expect(Reflect.getMetadata(limitKey, AudiobookshelfCompatController.prototype.login)).toBe(5);
    expect(Reflect.getMetadata(ttlKey, AudiobookshelfCompatController.prototype.login)).toBe(60_000);
  });
});
