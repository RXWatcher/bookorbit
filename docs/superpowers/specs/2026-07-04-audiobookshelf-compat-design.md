# Audiobookshelf Compatibility API Design

## Goal

Let a user open an Audiobookshelf-compatible mobile app, enter their BookOrbit base URL, authenticate, and browse/play/read BookOrbit libraries without changing BookOrbit's normal UI.

The compatibility layer should make BookOrbit look enough like an Audiobookshelf server for real clients while keeping ABS-specific behavior isolated from upstream BookOrbit code.

## Non-Goals

- Do not fork or restyle the BookOrbit frontend.
- Do not change normal `/api/v1` behavior for BookOrbit clients.
- Do not import Audiobookshelf as a data source in this feature. This is a server compatibility facade for ABS apps.
- Do not require warehouse-only behavior. Local and warehouse libraries must both work.
- Do not implement every Audiobookshelf endpoint before the first real-app proof. Implement the app-driven surface first.

## Architecture

Add a server-only `AudiobookshelfCompatModule` under `server/src/modules/audiobookshelf-compat/`.

Request flow:

```text
ABS client
  -> ABS-compatible root/API route
  -> AudiobookshelfCompatController
  -> AudiobookshelfCompatService
  -> BookOrbit library services
  -> local BookOrbit services + source-backed warehouse catalog services
  -> ABS-shaped JSON / stream response
```

The module owns all ABS response shapes, route aliases, compatibility IDs, client quirks, and token translation. Existing BookOrbit modules continue to expose BookOrbit-native DTOs.

## Compatibility Boundaries

The compatibility module may depend on existing server services:

- `AuthService` / user services for local login and user lookup.
- Existing OIDC services for browser-based OIDC login.
- `LibraryService`, `BookService`, and related repositories for normal local and source-backed library browse/search/detail behavior.
- `WarehouseCatalogService` and `WarehouseUserStateService` behind the normal library abstraction where warehouse-specific state is still required.
- Existing cover, stream, download, progress, bookmark, annotation, and reading session services where possible.

The compatibility module should not add ABS-specific branches to BookOrbit frontend components or normal library UI.

## Library Model

Expose BookOrbit libraries as Audiobookshelf libraries.

Supported library sources:

- Local audiobook libraries.
- Warehouse audiobook library.
- Local ebook/book libraries.
- Warehouse ebook/book library.
- Local comic libraries where ABS clients expose them.
- Warehouse comic library.

The ABS facade treats all of them as BookOrbit libraries. Warehouse media must not become a parallel ABS-only source model; it should enter the facade through the same source-backed library behavior that the normal BookOrbit UI uses.

BookOrbit library IDs are numeric:

- normal local/scanned libraries use positive IDs from `libraries.id`
- source-backed warehouse libraries use reserved sentinel IDs:
  - `-1` for warehouse ebooks/books
  - `-2` for warehouse audiobooks
  - `-3` for warehouse comics

ABS library IDs must encode the real BookOrbit library ID and decode back to that number:

```text
lib_l_<libraryId>
lib_bw_<media>
```

Examples:

```text
lib_l_1
lib_bw_ebook
lib_bw_audio
lib_bw_comic
```

Do not expose raw negative sentinel IDs in ABS-facing route params. The codec maps `lib_bw_ebook` to `-1`, `lib_bw_audio` to `-2`, and `lib_bw_comic` to `-3` before calling BookOrbit services.

The compatibility layer should call normal library services with the decoded numeric ID, including sentinel IDs. It should not hardcode separate ABS library IDs such as `warehouse:audiobook`.

The design should keep ID encoding in one helper so the format can change without touching every controller.

## Item IDs

ABS item IDs must be stable, reversible, and unambiguous across backing tables. The agreed format is:

```text
bo_l_<libraryId>_<kind>_<nativeId>
bo_bw_<media>_<kind>_<nativeId>
```

Where:

- `l_<libraryId>` is a normal local/scanned BookOrbit library ID.
- `bw_<media>` is a source-backed warehouse library alias that decodes to a sentinel library ID.
- `kind` is `book` for local `books.id`.
- `kind` is `catalog` for warehouse `warehouse_catalog_items.id`.
- `nativeId` is the local database ID in that backing table.

Examples:

```text
bo_l_1_book_123
bo_bw_ebook_catalog_456
bo_bw_audio_catalog_789
bo_bw_comic_catalog_321
```

The library segment makes item routes self-validating. `bo_l_1_book_123` must resolve to local book `123` in library `1`; `bo_bw_audio_catalog_789` must resolve to warehouse catalog row `789` whose media type belongs to the audiobook sentinel library. Mismatches return not found.

Never expose placeholder `0` IDs to ABS clients. Placeholder IDs may exist internally in BookOrbit's source-backed reader paths, but ABS responses should only contain compat IDs.

Do not expose warehouse `remoteId` values to ABS clients. They remain internal provider identifiers used by warehouse services.

## Media Types

Audiobookshelf's primary model is audiobook-oriented, but some apps can read ebooks. The compatibility layer should support both.

### Audiobooks

Local and warehouse audiobook items should map to ABS library items with:

- title, subtitle, description when available
- authors
- narrators
- series and sequence
- genres/tags
- duration
- cover URL
- progress/media progress
- `media.audioTracks`
- stream/download URLs

For warehouse audiobooks, stream and cover responses should proxy through existing warehouse catalog endpoints and services.

For local audiobooks, stream and cover responses should reuse existing local file/cover services.

### Ebooks

Local and warehouse ebooks should map to ABS ebook-capable item responses:

- title, subtitle, description when available
- authors
- series and sequence
- genres/tags
- format
- page count when known
- cover URL
- download/open URL
- progress/bookmark/annotation data when the client sends it

For warehouse ebooks, downloads should use existing warehouse ebook download paths. For local ebooks, downloads should use existing local book file download/serve paths.

### Comics

Local and warehouse comics should use the same library and item ID rules as books. If a tested ABS client exposes comics as readable ebook-like media, map comic metadata and downloads through the same compatibility module rather than adding frontend-specific comic behavior.

## Auth

Authentication is first-class because "just enter the BookOrbit URL" only works if the app can complete login.

### Local Username/Password

ABS login endpoints accept username/password and validate against BookOrbit local users. The response should be ABS-shaped and include an ABS-compatible token while preserving BookOrbit's permission checks.

Support both `application/json` and `application/x-www-form-urlencoded` request bodies.

### OIDC

If BookOrbit is configured for OIDC, the ABS status/settings response should advertise compatible OIDC login support.

Flow:

1. ABS client discovers OIDC capability from status/settings.
2. ABS client opens a browser/webview authorization URL.
3. BookOrbit uses its existing OIDC flow.
4. On callback, the compatibility layer mints an ABS-compatible session/token for the BookOrbit user.

This depends on what real ABS clients support. If a client does not complete the ABS/OIDC flow, app tokens provide a fallback.

### App Token Fallback

Add an ABS app-token path for users who authenticate to BookOrbit by OIDC but whose ABS client cannot complete OIDC.

Expected behavior:

- User generates a BookOrbit ABS app token in BookOrbit.
- User enters the BookOrbit URL and token-compatible credentials in the ABS app.
- The compatibility layer validates that token and returns an ABS-shaped session.

The token should be revocable and scoped to ABS compatibility. It should not be a general admin API token.

## Endpoint Map

The first implementation should cover the endpoints real clients call during connect, browse, playback, and sync. Exact paths should match Audiobookshelf clients where possible.

### Server and Auth

- `GET /ping`
- `GET /status`
- `POST /login`
- `POST /api/authorize`
- `POST /api/auth/refresh`
- `GET /api/me`

### Libraries

- `GET /api/libraries`
- `GET /api/libraries/:libraryId`
- `GET /api/libraries/:libraryId/items`
- `GET /api/libraries/:libraryId/search`
- `GET /api/libraries/:libraryId/personalized`

### Items

- `GET /api/items/:itemId`
- `GET /api/items/:itemId/cover`
- `GET /api/items/:itemId/download`
- `POST /api/items/:itemId/play`
- `GET /api/items/:itemId/tracks/:trackId/stream`

### Progress and Sessions

- ABS media progress update endpoint used by clients.
- ABS session open/close endpoint used by clients.
- `POST /api/session/local`
- `POST /api/session/local-all`

The exact media-progress and session method/path set must be confirmed by real app traffic during Milestone 1. Milestone 4 is not complete until every progress/session path emitted by the tested clients is either implemented or intentionally rejected with a client-safe response.

### Authors and Series

Post-MVP but expected:

- authors browse/detail endpoints used by ABS apps
- series browse/detail endpoints used by ABS apps
- continue-listening or in-progress endpoints used by ABS apps

## Streaming and Range Support

ABS clients should start playback through `POST /api/items/:itemId/play`. That response should open or identify a playback session and return ABS-shaped `media.audioTracks` entries whose content URLs point back to BookOrbit.

All audio track content endpoints must support HTTP Range requests.

The compatibility layer should forward range headers to the existing local or warehouse stream path and preserve:

- status `206` for ranged responses
- `Content-Range`
- `Accept-Ranges`
- `Content-Length`
- `Content-Type`

If an upstream warehouse stream returns a non-range response, the compatibility layer should pass through the safest equivalent response without buffering whole files in memory.

## Library and Asset Resolution

Create compatibility services responsible for:

- listing accessible ABS libraries by calling normal BookOrbit library services
- parsing compat library IDs into numeric BookOrbit library IDs
- querying library items through normal local/source-backed library browse paths
- parsing compat item IDs into local `book` or warehouse `catalog` refs
- validating that an item belongs to the encoded library ID
- mapping BookOrbit-native records into ABS DTOs
- resolving cover/download/stream handlers
- resolving and updating progress/session state through normal BookOrbit user state services where possible

Suggested interface:

```ts
type AbsLibraryId = {
  libraryId: number;
};

type AbsItemRef =
  | { libraryId: number; kind: 'book'; bookId: number }
  | { libraryId: number; kind: 'catalog'; catalogItemId: number };

type AbsAssetRequest = {
  item: AbsItemRef;
  trackId?: string;
  range?: string;
};
```

Controllers should not know database details. They should parse ABS route params, call the compatibility service, and return ABS DTOs.

Source-aware code should be limited to the asset boundary: covers, downloads, and audio track streams. Metadata, browse, search, authors, series, progress, and access control should use normal BookOrbit library/state behavior wherever that behavior already exists.

## Mapping Strategy

Keep ABS DTO generation in dedicated mapper files:

- `abs-auth.mapper.ts`
- `abs-library.mapper.ts`
- `abs-item.mapper.ts`
- `abs-progress.mapper.ts`

Mappers should accept BookOrbit-native data and produce ABS-shaped responses. This keeps client quirks out of core services.

Any existing ABS-specific mapper inside the warehouse module should be moved into or superseded by the compatibility module. The warehouse module should expose warehouse-native or BookOrbit-native shapes, not ABS DTOs.

## Permissions and Content Filtering

All ABS responses must honor BookOrbit user access:

- user permissions
- library access
- content filters
- warehouse availability/settings

The ABS facade must never leak inaccessible local library items, warehouse remote IDs, upstream URLs, or private provider details.

## Error Handling

Return ABS-compatible error shapes where clients expect them, but log BookOrbit-native structured errors server-side.

Rules:

- Invalid/missing token -> ABS-compatible unauthorized response.
- Inaccessible library/item -> not found, not forbidden, unless ABS clients specifically need forbidden.
- Upstream warehouse stream failure -> safe playback error without leaking upstream credentials or URLs.
- Unsupported endpoint -> stable 404/501 response that does not crash the app.

## Client Verification Plan

Use three sources of truth:

1. Audiobookshelf API docs for broad endpoint names.
2. Silo PR #289 as a compatibility checklist.
3. Actual ABS iOS/Android app traffic as the final authority.

Verification steps:

1. Point ABS app at local BookOrbit URL.
2. Capture connect/login calls.
3. Implement missing startup endpoints.
4. Capture library browse calls.
5. Implement missing library/item response fields.
6. Play a local audiobook and a warehouse audiobook.
7. Confirm cover loading and Range playback.
8. Update progress on one device and verify BookOrbit sees it.
9. Test offline/local session sync if the app sends it.
10. Test local ebook and warehouse ebook if the app exposes ebook reading.
11. Test OIDC login where client supports it.
12. Test app-token fallback where client does not support OIDC.

## Milestones

### Milestone 1: Connect and Login

- Add module/controller skeleton.
- Implement `/ping`, `/status`, `/login`, `/api/authorize`, `/api/me`.
- Support local login and app-token login.
- Advertise OIDC only if configured.

Success: ABS app accepts the BookOrbit URL and reaches a logged-in state.

### Milestone 2: Libraries and Browse

- List local + source-backed audiobook libraries through normal library services.
- List local + source-backed ebook/book libraries through normal library services.
- List local + source-backed comic libraries where clients expose them.
- Return ABS-shaped library item rows.

Success: ABS app shows BookOrbit libraries and items.

### Milestone 3: Details, Covers, Playback, Downloads

- Resolve compat item IDs.
- Return item detail responses.
- Serve covers for local and warehouse items.
- Stream local and warehouse audiobooks with Range support.
- Serve ebook downloads for local and warehouse ebooks.

Success: ABS app can open an item, load cover art, play an audiobook, and open/download an ebook where supported.

### Milestone 4: Progress and Sessions

- Map ABS media progress/session calls to BookOrbit local and warehouse state.
- Support local/offline session sync endpoints used by ABS apps.

Success: progress updates in the ABS app are visible in BookOrbit and survive app restart.

### Milestone 5: OIDC and Polish

- Complete OIDC redirect/callback compatibility if real clients support it.
- Add authors/series/continue-listening endpoints.
- Fill response fields discovered from app traffic.

Success: OIDC users have a clean path, app-token fallback works, and normal browse surfaces feel complete.

## Testing

Use TDD at each milestone.

Server tests:

- auth response mapper tests
- compat ID encode/decode tests
- normal library behavior tests proving source-backed warehouse libraries browse/search/filter through the same library path as local libraries
- item mapper tests for audiobook, ebook, and comic shapes
- controller tests for endpoint status and response shapes
- stream tests verifying Range header pass-through
- progress/session tests for local and warehouse updates
- authorization tests proving inaccessible items are hidden
- tests proving ABS responses never serialize item ID `0` or warehouse `remoteId` values

Manual/app tests:

- ABS app login with local credentials
- ABS app login with app token
- ABS app OIDC login where supported
- local audiobook playback
- warehouse audiobook playback
- local ebook open/download
- warehouse ebook open/download
- progress sync
- offline session sync if available

## Open Client-Compatibility Questions

These should be answered by app traffic capture during Milestone 1:

- Which exact startup endpoints do the iOS and Android apps call after base URL entry?
- Do the apps require `/socket.io` for login/browse/playback, or only for live updates?
- Which login response fields are mandatory?
- Which `media.audioTracks` fields are mandatory for playback?
- Which ebook fields/routes are used by the clients that support ebooks?
- Does the app support ABS OIDC endpoints, or do we need app tokens for OIDC-only BookOrbit users?

These are discovery questions, not blockers for the design. The compatibility module is isolated so we can add endpoints and fields as real clients demand them.
