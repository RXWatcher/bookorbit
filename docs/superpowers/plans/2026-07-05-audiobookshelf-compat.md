# Audiobookshelf Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-only Audiobookshelf-compatible API that lets ABS clients connect to BookOrbit, browse normal local and source-backed warehouse libraries, load covers, play audiobooks, and sync basic progress without changing the BookOrbit user UI.

**Architecture:** Add `AudiobookshelfCompatModule` under `server/src/modules/audiobookshelf-compat/`. The module owns ABS routes, DTO mappers, ID codecs, and client quirks, while metadata/browse/access flow through normal BookOrbit services. Source-aware branching is limited to cover/download/audio asset serving.

**Tech Stack:** NestJS controllers/services, Fastify replies, Vitest/Jest-style server unit tests, existing BookOrbit `LibraryService`, `BookService`, `AuthService`, `WarehouseCatalogService`, and warehouse user-state services.

---

## File Structure

- Create `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.module.ts`  
  Registers the compat controller and services, imports existing modules needed for auth, libraries, books, warehouse, covers, and progress.
- Create `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`  
  Owns root-level ABS routes: `/ping`, `/status`, `/login`, `/api/authorize`, `/api/me`, `/api/auth/refresh`, `/api/libraries`, `/api/libraries/:id/items`, `/api/items/:id`, `/api/items/:id/play`, covers, downloads, tracks, progress/session routes.
- Create `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`  
  Orchestrates auth handshakes, library browse, item detail, playback session response, and progress updates by calling existing BookOrbit services.
- Create `server/src/modules/audiobookshelf-compat/abs-id-codec.ts`  
  Encodes/decodes `lib_l_1`, `lib_bw_audio`, `bo_l_1_book_123`, and `bo_bw_audio_catalog_789`.
- Create `server/src/modules/audiobookshelf-compat/abs-auth.mapper.ts`  
  Produces ABS-shaped login/authorize/me/refresh responses.
- Create `server/src/modules/audiobookshelf-compat/abs-library.mapper.ts`  
  Maps BookOrbit `Library` data into ABS library DTOs.
- Create `server/src/modules/audiobookshelf-compat/abs-item.mapper.ts`  
  Maps BookOrbit book cards/source-backed catalog items into ABS minified item and expanded item DTOs.
- Create `server/src/modules/audiobookshelf-compat/abs-asset.service.ts`  
  Resolves cover/download/audio-track responses. This is the only intentionally source-aware service.
- Create `server/src/modules/audiobookshelf-compat/abs-token.service.ts`  
  Mints and verifies ABS bearer tokens by layering over BookOrbit auth primitives. First slice can use signed JWT access tokens without refresh persistence changes; refresh rotation is implemented once captured clients require it.
- Create `server/src/modules/audiobookshelf-compat/dto.ts`  
  Holds local request/response DTO types for the compat module only.
- Create tests beside each new file:
  - `server/src/modules/audiobookshelf-compat/abs-id-codec.test.ts`
  - `server/src/modules/audiobookshelf-compat/abs-auth.mapper.test.ts`
  - `server/src/modules/audiobookshelf-compat/abs-library.mapper.test.ts`
  - `server/src/modules/audiobookshelf-compat/abs-item.mapper.test.ts`
  - `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.test.ts`
  - `server/src/modules/audiobookshelf-compat/abs-asset.service.test.ts`
- Modify `server/src/app.module.ts`  
  Import `AudiobookshelfCompatModule` after the core modules it depends on.
- Modify `server/src/modules/warehouse/warehouse.module.ts` only if exports are missing for services already used by the compat module.
- Modify `server/src/modules/warehouse/warehouse-audiobookshelf.mapper.ts`  
  Delete this file or turn it into a compatibility-module import after `abs-item.mapper.ts` fully replaces it.

## Task 1: ABS ID Codec

**Files:**
- Create: `server/src/modules/audiobookshelf-compat/abs-id-codec.ts`
- Test: `server/src/modules/audiobookshelf-compat/abs-id-codec.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';

import {
  decodeAbsItemId,
  decodeAbsLibraryId,
  encodeAbsCatalogItemId,
  encodeAbsLibraryId,
  encodeAbsLocalBookItemId,
} from './abs-id-codec';

describe('abs-id-codec', () => {
  it('encodes and decodes local library IDs', () => {
    expect(encodeAbsLibraryId(12)).toBe('lib_l_12');
    expect(decodeAbsLibraryId('lib_l_12')).toEqual({ libraryId: 12, source: 'local' });
  });

  it('encodes and decodes warehouse library aliases without exposing negative IDs', () => {
    expect(encodeAbsLibraryId(CLOUD_EBOOK_LIBRARY_ID)).toBe('lib_bw_ebook');
    expect(encodeAbsLibraryId(CLOUD_AUDIO_LIBRARY_ID)).toBe('lib_bw_audio');
    expect(encodeAbsLibraryId(CLOUD_COMIC_LIBRARY_ID)).toBe('lib_bw_comic');
    expect(decodeAbsLibraryId('lib_bw_audio')).toEqual({ libraryId: CLOUD_AUDIO_LIBRARY_ID, source: 'warehouse', mediaType: 'audiobook' });
  });

  it('encodes and decodes local book item IDs', () => {
    expect(encodeAbsLocalBookItemId(12, 345)).toBe('bo_l_12_book_345');
    expect(decodeAbsItemId('bo_l_12_book_345')).toEqual({ libraryId: 12, kind: 'book', bookId: 345, source: 'local' });
  });

  it('encodes and decodes warehouse catalog item IDs', () => {
    expect(encodeAbsCatalogItemId(CLOUD_AUDIO_LIBRARY_ID, 789)).toBe('bo_bw_audio_catalog_789');
    expect(decodeAbsItemId('bo_bw_audio_catalog_789')).toEqual({
      libraryId: CLOUD_AUDIO_LIBRARY_ID,
      kind: 'catalog',
      catalogItemId: 789,
      mediaType: 'audiobook',
      source: 'warehouse',
    });
  });

  it('rejects placeholder, malformed, and mismatched IDs', () => {
    expect(() => decodeAbsItemId('0')).toThrow('Invalid ABS item ID');
    expect(() => decodeAbsItemId('bo_l_1_book_0')).toThrow('Invalid ABS item ID');
    expect(() => decodeAbsItemId('bo_bw_audio_book_7')).toThrow('Invalid ABS item ID');
    expect(() => decodeAbsLibraryId('lib_-2')).toThrow('Invalid ABS library ID');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- abs-id-codec.test.ts`

Expected: FAIL because `abs-id-codec.ts` does not exist.

- [ ] **Step 3: Implement the codec**

```ts
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID, CLOUD_EBOOK_LIBRARY_ID } from '@bookorbit/types';
import type { WarehouseMediaType } from '@bookorbit/types';

type AbsWarehouseMediaAlias = 'ebook' | 'audio' | 'comic';

export type DecodedAbsLibraryId =
  | { libraryId: number; source: 'local' }
  | { libraryId: number; source: 'warehouse'; mediaType: WarehouseMediaType };

export type DecodedAbsItemId =
  | { libraryId: number; source: 'local'; kind: 'book'; bookId: number }
  | { libraryId: number; source: 'warehouse'; kind: 'catalog'; catalogItemId: number; mediaType: WarehouseMediaType };

const MEDIA_ALIAS_BY_LIBRARY_ID = new Map<number, AbsWarehouseMediaAlias>([
  [CLOUD_EBOOK_LIBRARY_ID, 'ebook'],
  [CLOUD_AUDIO_LIBRARY_ID, 'audio'],
  [CLOUD_COMIC_LIBRARY_ID, 'comic'],
]);

const LIBRARY_ID_BY_MEDIA_ALIAS = new Map<AbsWarehouseMediaAlias, number>([
  ['ebook', CLOUD_EBOOK_LIBRARY_ID],
  ['audio', CLOUD_AUDIO_LIBRARY_ID],
  ['comic', CLOUD_COMIC_LIBRARY_ID],
]);

const MEDIA_TYPE_BY_ALIAS: Record<AbsWarehouseMediaAlias, WarehouseMediaType> = {
  ebook: 'ebook',
  audio: 'audiobook',
  comic: 'comic',
};

export function encodeAbsLibraryId(libraryId: number): string {
  const alias = MEDIA_ALIAS_BY_LIBRARY_ID.get(libraryId);
  if (alias) return `lib_bw_${alias}`;
  if (!Number.isInteger(libraryId) || libraryId <= 0) throw new Error('Invalid BookOrbit library ID');
  return `lib_l_${libraryId}`;
}

export function decodeAbsLibraryId(value: string): DecodedAbsLibraryId {
  const localMatch = /^lib_l_([1-9]\d*)$/.exec(value);
  if (localMatch) return { libraryId: Number(localMatch[1]), source: 'local' };

  const warehouseMatch = /^lib_bw_(ebook|audio|comic)$/.exec(value);
  if (warehouseMatch) {
    const alias = warehouseMatch[1] as AbsWarehouseMediaAlias;
    return { libraryId: LIBRARY_ID_BY_MEDIA_ALIAS.get(alias)!, source: 'warehouse', mediaType: MEDIA_TYPE_BY_ALIAS[alias] };
  }

  throw new Error('Invalid ABS library ID');
}

export function encodeAbsLocalBookItemId(libraryId: number, bookId: number): string {
  if (!Number.isInteger(libraryId) || libraryId <= 0 || !Number.isInteger(bookId) || bookId <= 0) throw new Error('Invalid ABS item ID');
  return `bo_l_${libraryId}_book_${bookId}`;
}

export function encodeAbsCatalogItemId(libraryId: number, catalogItemId: number): string {
  const alias = MEDIA_ALIAS_BY_LIBRARY_ID.get(libraryId);
  if (!alias || !Number.isInteger(catalogItemId) || catalogItemId <= 0) throw new Error('Invalid ABS item ID');
  return `bo_bw_${alias}_catalog_${catalogItemId}`;
}

export function decodeAbsItemId(value: string): DecodedAbsItemId {
  const localMatch = /^bo_l_([1-9]\d*)_book_([1-9]\d*)$/.exec(value);
  if (localMatch) return { libraryId: Number(localMatch[1]), source: 'local', kind: 'book', bookId: Number(localMatch[2]) };

  const catalogMatch = /^bo_bw_(ebook|audio|comic)_catalog_([1-9]\d*)$/.exec(value);
  if (catalogMatch) {
    const alias = catalogMatch[1] as AbsWarehouseMediaAlias;
    return {
      libraryId: LIBRARY_ID_BY_MEDIA_ALIAS.get(alias)!,
      source: 'warehouse',
      kind: 'catalog',
      catalogItemId: Number(catalogMatch[2]),
      mediaType: MEDIA_TYPE_BY_ALIAS[alias],
    };
  }

  throw new Error('Invalid ABS item ID');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test -- abs-id-codec.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/audiobookshelf-compat/abs-id-codec.ts server/src/modules/audiobookshelf-compat/abs-id-codec.test.ts
git commit -m "feat: add audiobookshelf id codec"
```

## Task 2: Module Skeleton and Public Handshake Routes

**Files:**
- Create: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.module.ts`
- Create: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`
- Create: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`
- Create: `server/src/modules/audiobookshelf-compat/dto.ts`
- Test: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.test.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Write failing controller tests for `/ping` and `/status`**

```ts
import { Test } from '@nestjs/testing';

import { AudiobookshelfCompatController } from './audiobookshelf-compat.controller';
import { AudiobookshelfCompatService } from './audiobookshelf-compat.service';

describe('AudiobookshelfCompatController handshake', () => {
  let controller: AudiobookshelfCompatController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AudiobookshelfCompatController],
      providers: [
        {
          provide: AudiobookshelfCompatService,
          useValue: {
            getStatus: vi.fn().mockResolvedValue({
              server: 'BookOrbit',
              version: '0.0.0-test',
              language: 'en-us',
              authMethods: ['local'],
            }),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(AudiobookshelfCompatController);
  });

  it('returns the ABS ping shape', () => {
    expect(controller.ping()).toEqual({ success: true });
  });

  it('returns status without requiring auth', async () => {
    await expect(controller.status()).resolves.toEqual({
      server: 'BookOrbit',
      version: '0.0.0-test',
      language: 'en-us',
      authMethods: ['local'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- audiobookshelf-compat.controller.test.ts`

Expected: FAIL because the controller/module files do not exist.

- [ ] **Step 3: Add skeleton files**

```ts
// server/src/modules/audiobookshelf-compat/dto.ts
export interface AbsStatusResponse {
  server: 'BookOrbit';
  version: string;
  language: string;
  authMethods: Array<'local' | 'oidc' | 'app-token'>;
}

export interface AbsPingResponse {
  success: true;
}
```

```ts
// server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts
import { Injectable } from '@nestjs/common';

import type { AbsStatusResponse } from './dto';

@Injectable()
export class AudiobookshelfCompatService {
  async getStatus(): Promise<AbsStatusResponse> {
    return {
      server: 'BookOrbit',
      version: process.env.npm_package_version ?? '0.0.0',
      language: 'en-us',
      authMethods: ['local'],
    };
  }
}
```

```ts
// server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts
import { Controller, Get } from '@nestjs/common';

import { AudiobookshelfCompatService } from './audiobookshelf-compat.service';
import type { AbsPingResponse, AbsStatusResponse } from './dto';

@Controller()
export class AudiobookshelfCompatController {
  constructor(private readonly compatService: AudiobookshelfCompatService) {}

  @Get('ping')
  ping(): AbsPingResponse {
    return { success: true };
  }

  @Get('status')
  status(): Promise<AbsStatusResponse> {
    return this.compatService.getStatus();
  }
}
```

```ts
// server/src/modules/audiobookshelf-compat/audiobookshelf-compat.module.ts
import { Module } from '@nestjs/common';

import { AudiobookshelfCompatController } from './audiobookshelf-compat.controller';
import { AudiobookshelfCompatService } from './audiobookshelf-compat.service';

@Module({
  controllers: [AudiobookshelfCompatController],
  providers: [AudiobookshelfCompatService],
})
export class AudiobookshelfCompatModule {}
```

- [ ] **Step 4: Register the module in `AppModule`**

```ts
import { AudiobookshelfCompatModule } from './modules/audiobookshelf-compat/audiobookshelf-compat.module';
```

Add `AudiobookshelfCompatModule` to the imports array after `WarehouseModule`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test -- audiobookshelf-compat.controller.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.module.ts server/src/modules/audiobookshelf-compat
git commit -m "feat: add audiobookshelf compat module skeleton"
```

## Task 3: Auth Response Mapping and Login Shell

**Files:**
- Create: `server/src/modules/audiobookshelf-compat/abs-auth.mapper.ts`
- Create: `server/src/modules/audiobookshelf-compat/abs-token.service.ts`
- Test: `server/src/modules/audiobookshelf-compat/abs-auth.mapper.test.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.module.ts`

- [ ] **Step 1: Write mapper tests**

```ts
import { mapAbsAuthUser } from './abs-auth.mapper';

describe('abs-auth.mapper', () => {
  it('maps a BookOrbit user into the ABS user envelope without leaking password data', () => {
    expect(
      mapAbsAuthUser({
        id: 42,
        username: 'ramindexadmin',
        email: 'admin@example.test',
        isSuperuser: true,
      }),
    ).toEqual({
      id: '42',
      username: 'ramindexadmin',
      email: 'admin@example.test',
      type: 'root',
      token: null,
      mediaProgress: [],
      seriesHideFromContinueListening: [],
      bookmarks: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- abs-auth.mapper.test.ts`

Expected: FAIL because mapper does not exist.

- [ ] **Step 3: Implement mapper and token service**

```ts
// server/src/modules/audiobookshelf-compat/abs-auth.mapper.ts
export interface AbsAuthUserInput {
  id: number;
  username: string;
  email?: string | null;
  isSuperuser?: boolean;
}

export interface AbsAuthUser {
  id: string;
  username: string;
  email: string | null;
  type: 'root' | 'user';
  token: string | null;
  mediaProgress: unknown[];
  seriesHideFromContinueListening: unknown[];
  bookmarks: unknown[];
}

export function mapAbsAuthUser(user: AbsAuthUserInput): AbsAuthUser {
  return {
    id: String(user.id),
    username: user.username,
    email: user.email ?? null,
    type: user.isSuperuser ? 'root' : 'user',
    token: null,
    mediaProgress: [],
    seriesHideFromContinueListening: [],
    bookmarks: [],
  };
}

export function mapAbsLoginResponse(user: AbsAuthUserInput, token: string, refreshToken?: string) {
  const absUser = { ...mapAbsAuthUser(user), token };
  return {
    user: absUser,
    userDefaultLibraryId: null,
    serverSettings: {
      id: 'bookorbit',
      scannerFindCovers: false,
      scannerCoverProvider: 'bookorbit',
    },
    source: 'bookorbit',
    token,
    refreshToken: refreshToken ?? null,
  };
}
```

```ts
// server/src/modules/audiobookshelf-compat/abs-token.service.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AbsTokenService {
  constructor(private readonly jwtService: JwtService) {}

  async mintAccessToken(user: { id: number; username: string; isSuperuser?: boolean }): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, username: user.username, compat: 'audiobookshelf', isSuperuser: Boolean(user.isSuperuser) },
      { expiresIn: '15m' },
    );
  }
}
```

- [ ] **Step 4: Add login route shell**

Add to `AudiobookshelfCompatController`:

```ts
@Post('login')
login(@Body() body: { username?: string; password?: string }) {
  return this.compatService.login(body);
}
```

Add to `AudiobookshelfCompatService`:

```ts
async login(body: { username?: string; password?: string }) {
  const username = body.username?.trim();
  const password = body.password ?? '';
  if (!username || !password) throw new UnauthorizedException('Invalid credentials');

  const authResult = await this.authService.login({ username, password }, createNoopCookieReply());
  const user = authResult.user;

  const token = await this.absTokenService.mintAccessToken(user);
  return mapAbsLoginResponse(user, token);
}
```

Add constructor dependencies for `AuthService` and `AbsTokenService`; import `AuthModule` and `JwtModule` the same way `AuthModule` already configures JWT in the codebase. Add a tiny local helper that satisfies the cookie calls made by `AuthService.login` without writing browser cookies to the ABS response:

```ts
function createNoopCookieReply() {
  return {
    setCookie: () => undefined,
    clearCookie: () => undefined,
  } as unknown as FastifyReply;
}
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter server test -- abs-auth.mapper.test.ts audiobookshelf-compat.controller.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/audiobookshelf-compat
git commit -m "feat: add audiobookshelf auth mapping"
```

## Task 4: Library List and Browse Through Normal Library Services

**Files:**
- Create: `server/src/modules/audiobookshelf-compat/abs-library.mapper.ts`
- Test: `server/src/modules/audiobookshelf-compat/abs-library.mapper.test.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.module.ts`

- [ ] **Step 1: Write mapper tests**

```ts
import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types';

import { mapAbsLibrary } from './abs-library.mapper';

describe('abs-library.mapper', () => {
  it('maps local libraries with encoded IDs', () => {
    expect(mapAbsLibrary({ id: 7, name: 'Books', coverAspectRatio: '2/3', sourceKind: 'filesystem' } as any)).toEqual({
      id: 'lib_l_7',
      name: 'Books',
      mediaType: 'book',
      provider: 'bookorbit',
      settings: expect.any(Object),
    });
  });

  it('maps warehouse audiobook sentinel libraries without negative client IDs', () => {
    expect(mapAbsLibrary({ id: CLOUD_AUDIO_LIBRARY_ID, name: 'Audiobooks', coverAspectRatio: '2/3', sourceKind: 'source_backed' } as any)).toMatchObject({
      id: 'lib_bw_audio',
      name: 'Audiobooks',
      mediaType: 'audiobook',
      provider: 'bookorbit',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- abs-library.mapper.test.ts`

Expected: FAIL because mapper does not exist.

- [ ] **Step 3: Implement mapper**

```ts
import { CLOUD_AUDIO_LIBRARY_ID, CLOUD_COMIC_LIBRARY_ID } from '@bookorbit/types';
import type { Library } from '@bookorbit/types';

import { encodeAbsLibraryId } from './abs-id-codec';

export function mapAbsLibrary(library: Library) {
  return {
    id: encodeAbsLibraryId(library.id),
    name: library.name,
    mediaType: library.id === CLOUD_AUDIO_LIBRARY_ID ? 'audiobook' : library.id === CLOUD_COMIC_LIBRARY_ID ? 'comic' : 'book',
    provider: 'bookorbit',
    settings: {
      coverAspectRatio: library.coverAspectRatio,
      sourceKind: library.sourceKind ?? 'filesystem',
    },
  };
}
```

- [ ] **Step 4: Add controller/service routes**

Add controller methods:

```ts
@Get('api/libraries')
listLibraries(@CurrentUser() user: RequestUser) {
  return this.compatService.listLibraries(user);
}

@Get('api/libraries/:libraryId/items')
listLibraryItems(@Param('libraryId') libraryId: string, @Body() query: BookQuery, @CurrentUser() user: RequestUser) {
  return this.compatService.listLibraryItems(user, libraryId, query);
}
```

Add service methods:

```ts
async listLibraries(user: RequestUser) {
  const libraries = await this.libraryService.findAll(user, { includeSourceBacked: true });
  return { libraries: libraries.map(mapAbsLibrary) };
}

async listLibraryItems(user: RequestUser, absLibraryId: string, query: BookQuery) {
  const decoded = decodeAbsLibraryId(absLibraryId);
  await this.libraryService.verifyUserAccess(user.id, decoded.libraryId, user.isSuperuser);
  const page = this.libraryService.isSourceBackedLibraryId(decoded.libraryId)
    ? await this.libraryService.querySourceBackedLibraryBooks(user, decoded.libraryId, query)
    : await this.bookService.queryForLibrary(user, decoded.libraryId, query);
  return mapAbsLibraryItemsPage(decoded.libraryId, page);
}
```

If `isSourceBackedLibraryId` is private, add a small exported helper in `library.service.ts` or use the existing constants in the compat service. Do not duplicate warehouse query logic.

- [ ] **Step 5: Add controller tests proving source-backed libraries use `LibraryService`**

Add test cases that mock `libraryService.querySourceBackedLibraryBooks` for `lib_bw_audio` and `bookService.queryForLibrary` for `lib_l_7`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter server test -- abs-library.mapper.test.ts audiobookshelf-compat.controller.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/audiobookshelf-compat server/src/modules/library/library.service.ts
git commit -m "feat: browse audiobookshelf libraries"
```

## Task 5: Item Mapping and Detail

**Files:**
- Create: `server/src/modules/audiobookshelf-compat/abs-item.mapper.ts`
- Test: `server/src/modules/audiobookshelf-compat/abs-item.mapper.test.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`
- Modify: `server/src/modules/warehouse/warehouse-audiobookshelf.mapper.ts`

- [ ] **Step 1: Write mapper tests**

```ts
import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types';

import { mapAbsCatalogItem, mapAbsLocalBookItem } from './abs-item.mapper';

describe('abs-item.mapper', () => {
  it('maps local books without placeholder IDs', () => {
    const item = mapAbsLocalBookItem(3, { id: 55, title: 'Dune', authors: ['Frank Herbert'], coverUrl: '/api/v1/books/55/cover' } as any);
    expect(item.id).toBe('bo_l_3_book_55');
    expect(JSON.stringify(item)).not.toContain('"0"');
  });

  it('maps warehouse catalog rows without remote IDs', () => {
    const item = mapAbsCatalogItem(CLOUD_AUDIO_LIBRARY_ID, {
      id: 77,
      remoteId: 'upstream-secret',
      title: 'Audio Dune',
      authors: ['Frank Herbert'],
      narrators: ['Simon Vance'],
      durationSeconds: 123,
      hasCover: true,
    } as any);

    expect(item.id).toBe('bo_bw_audio_catalog_77');
    expect(JSON.stringify(item)).not.toContain('upstream-secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- abs-item.mapper.test.ts`

Expected: FAIL because mapper does not exist.

- [ ] **Step 3: Implement item mapper**

```ts
import { encodeAbsCatalogItemId, encodeAbsLocalBookItemId } from './abs-id-codec';

export function mapAbsLocalBookItem(libraryId: number, book: { id: number; title?: string | null; authors?: string[]; coverUrl?: string | null }) {
  return {
    id: encodeAbsLocalBookItemId(libraryId, book.id),
    ino: book.id,
    libraryId,
    mediaType: 'book',
    media: {
      metadata: {
        title: book.title ?? 'Untitled',
        authors: book.authors ?? [],
      },
      coverPath: `/api/items/${encodeAbsLocalBookItemId(libraryId, book.id)}/cover`,
    },
  };
}

export function mapAbsCatalogItem(
  libraryId: number,
  item: { id: number; title?: string | null; authors?: string[]; narrators?: string[]; durationSeconds?: number | null; hasCover?: boolean },
) {
  const absId = encodeAbsCatalogItemId(libraryId, item.id);
  return {
    id: absId,
    ino: item.id,
    libraryId,
    mediaType: libraryId === -2 ? 'audiobook' : libraryId === -3 ? 'comic' : 'book',
    media: {
      metadata: {
        title: item.title ?? 'Untitled',
        authors: item.authors ?? [],
        narrators: item.narrators ?? [],
      },
      duration: item.durationSeconds ?? 0,
      coverPath: item.hasCover ? `/api/items/${absId}/cover` : null,
    },
  };
}

export function mapAbsLibraryItemsPage(libraryId: number, page: { items: unknown[]; total: number; page: number; size?: number; limit?: number }) {
  return {
    results: page.items.map((item: any) => ('remoteId' in item || item.sourceKind === 'warehouse' ? mapAbsCatalogItem(libraryId, item) : mapAbsLocalBookItem(libraryId, item))),
    total: page.total,
    page: page.page,
    limit: page.size ?? page.limit ?? page.items.length,
  };
}
```

- [ ] **Step 4: Move warehouse ABS mapping**

Replace imports/usages of `server/src/modules/warehouse/warehouse-audiobookshelf.mapper.ts` with calls into `abs-item.mapper.ts`, then delete the warehouse mapper if nothing imports it.

Run: `rg "warehouse-audiobookshelf.mapper|map.*Audiobookshelf|bookorbit-catalog-audiobooks" server/src`.

Expected after cleanup: no warehouse-owned ABS mapper imports remain.

- [ ] **Step 5: Add item detail route**

Add controller:

```ts
@Get('api/items/:itemId')
getItem(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser) {
  return this.compatService.getItem(user, itemId);
}
```

Add service:

```ts
async getItem(user: RequestUser, absItemId: string) {
  const itemRef = decodeAbsItemId(absItemId);
  await this.libraryService.verifyUserAccess(user.id, itemRef.libraryId, user.isSuperuser);
  if (itemRef.kind === 'book') {
    const book = await this.bookService.findOneForUser(user, itemRef.bookId);
    if (book.libraryId !== itemRef.libraryId) throw new NotFoundException('Item not found');
    return mapAbsLocalBookItem(itemRef.libraryId, book);
  }
  const catalogItem = await this.warehouseCatalogService.findCatalogItemById(itemRef.catalogItemId);
  if (!catalogItem || catalogItem.mediaType !== itemRef.mediaType) throw new NotFoundException('Item not found');
  return mapAbsCatalogItem(itemRef.libraryId, catalogItem);
}
```

If `WarehouseCatalogService.findCatalogItemById` does not exist, add it as a narrow wrapper over `WarehouseRepository.findCatalogItemById`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter server test -- abs-item.mapper.test.ts audiobookshelf-compat.controller.test.ts warehouse-catalog.service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/audiobookshelf-compat server/src/modules/warehouse
git commit -m "feat: map audiobookshelf library items"
```

## Task 6: Covers, Downloads, and Playback Assets

**Files:**
- Create: `server/src/modules/audiobookshelf-compat/abs-asset.service.ts`
- Test: `server/src/modules/audiobookshelf-compat/abs-asset.service.test.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`

- [ ] **Step 1: Write asset service tests**

```ts
import { CLOUD_AUDIO_LIBRARY_ID } from '@bookorbit/types';

import { AbsAssetService } from './abs-asset.service';

describe('AbsAssetService', () => {
  it('delegates local covers to the local cover service', async () => {
    const service = new AbsAssetService({ getCover: vi.fn().mockResolvedValue('local-cover') } as any, {} as any);
    await expect(service.getCover({ libraryId: 1, source: 'local', kind: 'book', bookId: 2 })).resolves.toBe('local-cover');
  });

  it('delegates warehouse covers to the warehouse catalog service', async () => {
    const warehouse = { getCatalogCoverByItemId: vi.fn().mockResolvedValue('warehouse-cover') };
    const service = new AbsAssetService({} as any, warehouse as any);
    await expect(service.getCover({ libraryId: CLOUD_AUDIO_LIBRARY_ID, source: 'warehouse', kind: 'catalog', catalogItemId: 9, mediaType: 'audiobook' })).resolves.toBe('warehouse-cover');
    expect(warehouse.getCatalogCoverByItemId).toHaveBeenCalledWith('audiobook', 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- abs-asset.service.test.ts`

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement asset service**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';

import type { DecodedAbsItemId } from './abs-id-codec';

@Injectable()
export class AbsAssetService {
  constructor(
    private readonly localAssetService: { getCover: (bookId: number) => Promise<unknown>; getDownload?: (bookId: number) => Promise<unknown> },
    private readonly warehouseCatalogService: {
      getCatalogCoverByItemId?: (mediaType: string, catalogItemId: number) => Promise<unknown>;
      getCatalogDownloadByItemId?: (mediaType: string, catalogItemId: number, range?: string) => Promise<unknown>;
    },
  ) {}

  async getCover(ref: DecodedAbsItemId) {
    if (ref.kind === 'book') return this.localAssetService.getCover(ref.bookId);
    if (!this.warehouseCatalogService.getCatalogCoverByItemId) throw new NotFoundException('Cover not found');
    return this.warehouseCatalogService.getCatalogCoverByItemId(ref.mediaType, ref.catalogItemId);
  }

  async getDownload(ref: DecodedAbsItemId, range?: string) {
    if (ref.kind === 'book') {
      if (!this.localAssetService.getDownload) throw new NotFoundException('Download not found');
      return this.localAssetService.getDownload(ref.bookId);
    }
    if (!this.warehouseCatalogService.getCatalogDownloadByItemId) throw new NotFoundException('Download not found');
    return this.warehouseCatalogService.getCatalogDownloadByItemId(ref.mediaType, ref.catalogItemId, range);
  }
}
```

- [ ] **Step 4: Add cover/download/play routes**

Add routes:

```ts
@Get('api/items/:itemId/cover')
getCover(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
  return this.compatService.pipeCover(user, itemId, reply);
}

@Get('api/items/:itemId/download')
download(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser, @Headers('range') range: string | undefined, @Res() reply: FastifyReply) {
  return this.compatService.pipeDownload(user, itemId, range, reply);
}

@Post('api/items/:itemId/play')
play(@Param('itemId') itemId: string, @CurrentUser() user: RequestUser) {
  return this.compatService.play(user, itemId);
}
```

The `play` response must return track URLs under `/api/items/:itemId/tracks/:trackId/stream` and never an upstream warehouse URL.

- [ ] **Step 5: Add Range preservation tests**

In `abs-asset.service.test.ts`, add a test that sends `range = 'bytes=10-99'` to a warehouse audiobook and asserts the warehouse client receives the same range string and that the service does not buffer a full file.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter server test -- abs-asset.service.test.ts audiobookshelf-compat.controller.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/audiobookshelf-compat
git commit -m "feat: serve audiobookshelf media assets"
```

## Task 7: Progress and Session Sync

**Files:**
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`
- Modify: `server/src/modules/audiobookshelf-compat/abs-auth.mapper.ts`
- Test: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.test.ts`

- [ ] **Step 1: Write controller tests for progress patch**

```ts
it('updates progress for encoded warehouse item IDs through compat service', async () => {
  const service = {
    updateProgress: vi.fn().mockResolvedValue({ success: true }),
  };
  const controller = new AudiobookshelfCompatController(service as any);
  await expect(controller.updateProgress('bo_bw_audio_catalog_9', { progress: 0.5, currentTime: 42 }, { id: 1, isSuperuser: false } as any)).resolves.toEqual({ success: true });
  expect(service.updateProgress).toHaveBeenCalledWith({ id: 1, isSuperuser: false }, 'bo_bw_audio_catalog_9', { progress: 0.5, currentTime: 42 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test -- audiobookshelf-compat.controller.test.ts`

Expected: FAIL because route/service method does not exist.

- [ ] **Step 3: Implement progress routes**

Add controller:

```ts
@Patch('api/me/progress/:itemId')
updateProgress(@Param('itemId') itemId: string, @Body() body: { progress?: number; currentTime?: number }, @CurrentUser() user: RequestUser) {
  return this.compatService.updateProgress(user, itemId, body);
}

@Post('api/session/local')
syncLocalSession(@Body() body: unknown, @CurrentUser() user: RequestUser) {
  return this.compatService.syncLocalSession(user, body);
}

@Post('api/session/local-all')
syncAllLocalSessions(@Body() body: unknown, @CurrentUser() user: RequestUser) {
  return this.compatService.syncAllLocalSessions(user, body);
}
```

Add service methods:

```ts
async updateProgress(user: RequestUser, absItemId: string, body: { progress?: number; currentTime?: number }) {
  const ref = decodeAbsItemId(absItemId);
  await this.libraryService.verifyUserAccess(user.id, ref.libraryId, user.isSuperuser);
  if (ref.kind === 'catalog') {
    await this.warehouseUserStateService.patchState(user, ref.mediaType, await this.resolveRemoteId(ref.catalogItemId), {
      progressPercent: typeof body.progress === 'number' ? body.progress * 100 : undefined,
      positionSeconds: body.currentTime,
    });
    return { success: true };
  }
  await this.userBookStatusService.updateProgress(user.id, ref.bookId, {
    progressPercent: typeof body.progress === 'number' ? body.progress * 100 : undefined,
    positionSeconds: body.currentTime,
  });
  return { success: true };
}
```

Use existing progress service method names from `UserBookStatusService`; adjust only the call signature, not the route behavior.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter server test -- audiobookshelf-compat.controller.test.ts warehouse-user-state.service.test.ts user-book-status`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/audiobookshelf-compat
git commit -m "feat: sync audiobookshelf progress"
```

## Task 8: Verification, Guardrails, and Build

**Files:**
- Modify: `server/src/modules/architecture/architecture-boundaries.test.ts`
- Modify: `server/src/modules/audiobookshelf-compat/*.test.ts`
- Modify: `server/src/modules/warehouse/warehouse-catalog.service.test.ts`

- [ ] **Step 1: Add architecture boundary test**

Add an assertion to `architecture-boundaries.test.ts` that fails if `server/src/modules/warehouse` owns ABS DTO/mapping names:

```ts
it('keeps Audiobookshelf compatibility out of the warehouse module', () => {
  const forbiddenFiles = findFiles('server/src/modules/warehouse').filter((file) => /audiobookshelf|abs-/i.test(file));
  expect(forbiddenFiles).toEqual([]);
});
```

Use the existing helper style in that file instead of adding a second directory walker.

- [ ] **Step 2: Add response serialization guard tests**

In `abs-item.mapper.test.ts`, assert:

```ts
expect(JSON.stringify(mappedItem)).not.toContain('remoteId');
expect(JSON.stringify(mappedItem)).not.toContain('"id":"0"');
expect(JSON.stringify(mappedItem)).not.toContain('lib_-');
expect(JSON.stringify(mappedItem)).not.toContain('bo_-');
```

- [ ] **Step 3: Run focused server tests**

Run:

```bash
pnpm --filter server test -- audiobookshelf-compat architecture-boundaries.test.ts library.service.test.ts warehouse-catalog.service.test.ts warehouse-user-state.service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck:server`

Expected: PASS.

- [ ] **Step 5: Run server build**

Run: `pnpm run build:server`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/audiobookshelf-compat server/src/modules/architecture server/src/modules/warehouse server/src/app.module.ts
git commit -m "test: guard audiobookshelf compatibility boundaries"
```

## Task 9: Smoke Capture Hook for Real ABS Clients

**Files:**
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.ts`
- Modify: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.service.ts`
- Test: `server/src/modules/audiobookshelf-compat/audiobookshelf-compat.controller.test.ts`

- [ ] **Step 1: Add unknown-route test**

```ts
it('returns a stable client-safe response for unsupported ABS routes', async () => {
  const service = { unsupported: vi.fn().mockReturnValue({ statusCode: 501, message: 'Audiobookshelf endpoint not implemented' }) };
  const controller = new AudiobookshelfCompatController(service as any);
  expect(controller.unsupported('GET', 'api/unknown/path')).toEqual({ statusCode: 501, message: 'Audiobookshelf endpoint not implemented' });
});
```

- [ ] **Step 2: Implement safe unsupported handling**

Add catch-all handlers at the bottom of the controller for unsupported ABS paths that log method/path and return a stable `501` JSON body. Keep this below implemented routes so it does not mask real endpoints.

```ts
@All(['api/*path', '*path'])
unsupported(@Req() req: FastifyRequest) {
  return this.compatService.unsupported(req.method, req.url);
}
```

```ts
unsupported(method: string, url: string) {
  this.logger.warn({ method, url }, 'Unsupported Audiobookshelf compatibility endpoint');
  return { statusCode: 501, message: 'Audiobookshelf endpoint not implemented' };
}
```

- [ ] **Step 3: Run smoke tests**

Run: `pnpm --filter server test -- audiobookshelf-compat.controller.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/modules/audiobookshelf-compat
git commit -m "chore: log unsupported audiobookshelf routes"
```

## Final Verification

- [ ] Run focused tests:

```bash
pnpm --filter server test -- audiobookshelf-compat
```

- [ ] Run related regression tests:

```bash
pnpm --filter server test -- library.service.test.ts warehouse-catalog.service.test.ts warehouse-user-state.service.test.ts architecture-boundaries.test.ts
```

- [ ] Run server typecheck:

```bash
pnpm run typecheck:server
```

- [ ] Run server build:

```bash
pnpm run build:server
```

- [ ] Inspect route behavior locally with an authenticated test user or a controller-level integration test:

```text
GET /ping -> { success: true }
GET /status -> BookOrbit ABS status
POST /login -> ABS-shaped auth envelope
GET /api/libraries -> includes local libraries and lib_bw_* source-backed libraries
GET /api/libraries/lib_bw_audio/items -> warehouse audiobooks through normal library service path
POST /api/items/bo_bw_audio_catalog_1/play -> BookOrbit-hosted track URLs
GET /api/items/bo_bw_audio_catalog_1/cover -> proxied cover without remote ID leak
```

## Self-Review

- Spec coverage: covered client-safe IDs, normal library semantics, isolated ABS module, auth handshake, library browse, item detail, covers/downloads/playback, progress/session sync, route logging, and tests for no `0`/remote ID leakage.
- Scope control: this plan builds the server compatibility facade only. It does not add frontend UI, new warehouse ingestion behavior, or full OIDC browser callback support beyond advertising and token fallback hooks.
- Type consistency: ID codec types are used by item mapping, asset service, progress, and controller routes; library aliases are `lib_l_*` and `lib_bw_*`; item aliases are `bo_l_*` and `bo_bw_*`.
