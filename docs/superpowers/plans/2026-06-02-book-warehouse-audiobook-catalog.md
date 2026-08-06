# Book Warehouse Audiobook Catalog Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use review checkpoints after every task.

**Goal:** Add native cached audiobook catalog parity foundations: sync local audiobook catalog rows, expose native cached audiobook reads, and provide safe cover/stream/download proxy endpoints without revealing the upstream source to regular users.

**Architecture:** Reuse the existing internal `warehouse` module and shared `warehouse_catalog_items` cache, extending it only where audiobooks need first-class fields such as duration. Hot browse/search/detail reads remain local-cache-only; binary cover/stream/download actions may call the upstream source because those are explicitly allowed live operations. Regular client APIs must return native catalog concepts and never expose raw upstream payloads, API keys, upstream URLs, or vendor copy.

**Tech Stack:** NestJS, Drizzle/Postgres, Vue 3, Vitest, shared `@bookorbit/types`.

---

## Sources

- Design: `docs/superpowers/specs/2026-06-02-book-warehouse-parity-design.md`
- Completed ebook phase: `docs/superpowers/plans/2026-06-02-book-warehouse-ebook-catalog.md`
- Book Warehouse docs:
  - `GET /api/v1/audiobooks` lists audiobooks with `page` and `limit`, limit max 100.
  - `GET /api/v1/audiobooks/search?q=` searches audiobooks.
  - `GET /api/v1/audiobooks/{id}` returns full audiobook metadata, including chapters and files.
  - `GET /api/v1/audiobooks/{id}/stream` streams audio.
  - `GET /api/v1/audiobooks/{id}/cover` returns cover bytes.
  - `GET /api/v1/audiobooks/{id}/download` downloads the whole audiobook.
  - `GET /api/v1/audiobooks/{id}/files/{file_id}/download` downloads one file.
  - `GET /api/v1/audiobooks/authors`, `/authors/{id}`, `/series`, `/series/{id}`, and `/narrators` provide browse dimensions.
  - All API routes are under `/api/v1` except `/health`; auth uses the `X-API-Key` header.

## Important Boundaries

- Do not add a regular user-facing Warehouse page, route, tab, badge, or source label.
- Do not wire cached source-backed items into BookCard, BookDetail, dashboards, OPDS, Kobo, KOReader, smart scopes, collections, or global search in this phase.
- Do not live-query upstream from audiobook list/detail browse paths.
- Do not expose raw upstream payloads through regular `/api/v1/catalog/...` APIs. Raw detail cache may exist internally only.
- Do not store API keys in client state or return them from API responses.
- Binary cover/stream/download endpoints must proxy content without logging or returning upstream URLs, API keys, or raw upstream error bodies.
- User-visible copy should use native labels: Catalog, Available, Read, Listen, Download, Requested, Processing, Completed, Failed.

## Review Checkpoints

Use the same subagent-driven workflow as the foundation and ebook phase:

1. Fresh implementer subagent per task.
2. Spec compliance reviewer after each task.
3. Code-quality/security reviewer after spec approval.
4. Controller runs the specified verification before marking a task complete.
5. Final reviewer for the full phase before moving to request-system work.

---

## Task 1: Audiobook Catalog Contracts And Duration Schema

**Files:**

- Modify: `packages/types/src/warehouse.ts`
- Modify: `server/src/db/schema/warehouse.ts`
- Create: `server/src/db/migrations/0014_add_warehouse_catalog_duration.sql`
- Modify: `server/src/db/schema/schema.test.ts`

### Requirements

Add native-facing audiobook catalog contracts:

- `WarehouseAudiobookCatalogQuery`
  - optional `q`, `page`, `limit`, `sort`, `order`
  - optional filters: `author`, `narrator`, `series`, `language`, `format`, `hasCover`
- `WarehouseAudiobookCatalogItem`
  - `id`, `remoteId`, `title`, `subtitle`, `authors`, `narrators`, `series`, `language`, `publisher`, `identifiers`, `format`, `durationSeconds`, `hasCover`, `syncedAt`, `source: "catalog-source"`
  - no upstream URL, no API key, no raw payload
- `WarehouseAudiobookChapter`
  - `id`, `title`, `startSeconds`, `endSeconds`
- `WarehouseAudiobookFile`
  - `id`, `name`, `format`, `durationSeconds`, `sizeBytes`
- `WarehouseAudiobookDetail`
  - extends/contains audiobook item fields plus `chapters` and `files`
  - no raw payload
- `WarehouseAudiobookCatalogPage`
  - `items`, `page`, `limit`, `total`
- `WarehouseBinaryProxyTarget`
  - union: `cover`, `stream`, `download`, `file-download`
  - server-only helper type if useful; do not add client-visible upstream URL fields

Schema:

- Add nullable integer column `duration_seconds` to `warehouse_catalog_items`.
- Update `WarehouseCatalogItemRow` typing through the Drizzle schema.
- Migration should be idempotent enough for normal Postgres migration execution:

```sql
ALTER TABLE warehouse_catalog_items
  ADD COLUMN IF NOT EXISTS duration_seconds integer;
```

### Tests

- Package build is required.
- Update the existing `warehouse_catalog_items is unique by media type and remote id` schema test to assert `warehouseCatalogItems.durationSeconds` is defined.

### Verification

Run:

```bash
pnpm --filter @bookorbit/types build
pnpm --filter server test src/db/schema/schema.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add packages/types/src/warehouse.ts server/src/db/schema/warehouse.ts server/src/db/migrations/0014_add_warehouse_catalog_duration.sql server/src/db/schema/schema.test.ts
git commit -m "feat: add audiobook catalog contracts"
```

---

## Task 2: Upstream Audiobook Client And Binary Proxy Helpers

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-client.service.ts`
- Modify: `server/src/modules/warehouse/warehouse-client.service.test.ts`
- Use fixture: `server/src/modules/warehouse/__fixtures__/audiobook.json`

### Requirements

Extend `WarehouseClientService` with audiobook capabilities needed by this phase:

- `getAudiobook({ baseUrl, apiKey, id })`
  - calls `GET /audiobooks/{id}`
  - maps tolerant upstream fields into a typed public-safe server object for mapper/service use
  - preserves original raw object only inside the server return if mapper needs it; never expose through controller
- `getAudiobookCover({ baseUrl, apiKey, id })`
  - calls `GET /audiobooks/{id}/cover`
- `streamAudiobook({ baseUrl, apiKey, id })`
  - calls `GET /audiobooks/{id}/stream`
- `downloadAudiobook({ baseUrl, apiKey, id })`
  - calls `GET /audiobooks/{id}/download`
- `downloadAudiobookFile({ baseUrl, apiKey, id, fileId })`
  - calls `GET /audiobooks/{id}/files/{fileId}/download`

Binary methods should return a server-only response wrapper containing:

- status
- content type
- optional content length
- readable/body stream or `ArrayBuffer`/`Buffer`, following the repo's existing HTTP-client style
- safe filename when inferable from response headers, without trusting path traversal characters

Security:

- Continue using `X-API-Key` header only.
- Never put API keys in query strings.
- Sanitize upstream error text through existing `WarehouseApiError` behavior.
- Do not pass raw `Response` objects to client code.

### Tests

Cover:

- `getAudiobook` uses `/api/v1/audiobooks/{id}` and maps chapters/files/narrators/duration.
- cover/stream/download/file-download methods use the documented paths.
- file IDs and audiobook IDs are URL-encoded.
- API key is sent only as `X-API-Key`.
- upstream error JSON maps to safe `WarehouseApiError` message.
- binary response headers are sanitized and do not expose upstream URL or API key.

### Verification

Run:

```bash
pnpm --filter server test src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-client.service.ts server/src/modules/warehouse/warehouse-client.service.test.ts server/src/modules/warehouse/__fixtures__/audiobook.json
git commit -m "feat: add audiobook catalog upstream client"
```

---

## Task 3: Audiobook Mapper And Repository Query Support

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-catalog.mapper.ts`
- Modify: `server/src/modules/warehouse/warehouse-catalog.mapper.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.repository.ts`
- Modify: `server/src/modules/warehouse/warehouse.repository.test.ts`

### Requirements

Mapper:

- Add `mapWarehouseAudiobookCatalogItemRow(payload, syncedAt)` returning `mediaType: "audiobook"` catalog item insert data.
- Normalize:
  - `remoteId` from `id`
  - `title` required, fallback to `Untitled`
  - `authors` from `author` or `authors`
  - `narrators` from `narrator` or `narrators`
  - `series`, `language`, `publisher`, `format`, `hasCover`, `durationSeconds`
  - identifiers from ISBN/ASIN/source IDs when present
  - `rawPayload` preserves original payload internally
  - `syncedAt` uses the sync timestamp
- Add `mapWarehouseAudiobookDetail(raw)` for public detail DTO fields: chapters and files only, no raw.

Repository:

- Add `listAudiobookCatalog(query: WarehouseAudiobookCatalogQuery): Promise<CatalogPage>`.
- It must use local SQL only.
- Search `q` across title, authors, narrators, series, identifiers, format, language, publisher.
- Filters: author, narrator, series, language, format, hasCover.
- Sort/order should support `title`, `author`, `narrator`, `series`, `duration`, `syncedAt`, `addedAt`.
- Page/limit clamped to sane bounds, consistent with ebook query behavior.

### Tests

Mapper tests:

- maps scalar and array authors/narrators.
- maps duration from `duration`, `durationSeconds`, or `duration_seconds`.
- maps chapters/files from detail raw objects.
- preserves raw payload internally for cache rows but public detail mapper omits raw.

Repository tests:

- list query always filters `mediaType = "audiobook"`.
- search includes narrators.
- narrator filter is applied.
- duration sort uses `duration_seconds`.
- pagination and total query paths match ebook behavior.

### Verification

Run:

```bash
pnpm --filter server test \
  src/modules/warehouse/warehouse-catalog.mapper.test.ts \
  src/modules/warehouse/warehouse.repository.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-catalog.mapper.ts server/src/modules/warehouse/warehouse-catalog.mapper.test.ts server/src/modules/warehouse/warehouse.repository.ts server/src/modules/warehouse/warehouse.repository.test.ts
git commit -m "feat: add audiobook catalog cache mapping"
```

---

## Task 4: Audiobook Catalog Sync And Admin Action

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-catalog-sync.service.ts`
- Modify: `server/src/modules/warehouse/warehouse-catalog-sync.service.test.ts`
- Modify: `server/src/modules/warehouse/warehouse-admin.controller.ts`
- Modify: `server/src/modules/warehouse/warehouse-admin.controller.test.ts`
- Modify: `client/src/features/warehouse/api/warehouse-admin.api.ts`
- Modify: `client/src/features/warehouse/components/WarehouseAdminSettings.vue`
- Modify: `client/src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts`

### Requirements

Server:

- Add `syncAudiobooks(): Promise<WarehouseCatalogSyncSummary>`.
- Reads settings; disabled/missing/decrypt-failed credentials throw safe catalog-source messages.
- Pages through `WarehouseClientService.listAudiobooks({ page, limit: 100 })` until:
  - a page returns fewer than 100 items, or
  - fetched count reaches upstream `total` when provided.
- Maps and upserts audiobook rows.
- Records sync run with `mediaType: "audiobook"`.
- On failure, persist sanitized error text with no API key/base URL leakage.
- Admin endpoint:
  - `POST /api/v1/admin/warehouse/catalog-sync/audiobooks`
  - returns `WarehouseCatalogSyncSummary`
  - permission remains `ManageAppSettings`.
- Existing `GET /catalog-sync` should return the latest relevant run. If only one `lastRun` is supported, use latest across ebook/audiobook/mixed and include `mediaType` so the UI can label it.

Client admin:

- Add `syncWarehouseAudiobooks()`.
- Extend admin settings panel with compact audiobook sync action/status.
- Keep copy native: `Sync audiobooks`, `Last audiobook sync`.
- Disable while settings disabled, action in flight, or existing sync is running.
- Do not use Book Warehouse/upstream/third-party visible copy.

### Tests

Server:

- rejects disabled/missing/decrypt-failed credentials.
- pages until less than max limit.
- stops at upstream total.
- records completed run counts with `mediaType: "audiobook"`.
- records failed run with sanitized message.
- admin controller delegates audiobook sync.

Client:

- renders audiobook sync status with native copy.
- calls audiobook sync API on click.
- disables action when settings disabled/in flight/running.
- no visible vendor copy in text or placeholder attributes.

### Verification

Run:

```bash
pnpm --filter server test \
  src/modules/warehouse/warehouse-catalog-sync.service.test.ts \
  src/modules/warehouse/warehouse-admin.controller.test.ts
pnpm --filter client test:unit --run src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts
pnpm run typecheck
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-catalog-sync.service.ts server/src/modules/warehouse/warehouse-catalog-sync.service.test.ts server/src/modules/warehouse/warehouse-admin.controller.ts server/src/modules/warehouse/warehouse-admin.controller.test.ts client/src/features/warehouse/api/warehouse-admin.api.ts client/src/features/warehouse/components/WarehouseAdminSettings.vue client/src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts
git commit -m "feat: add catalog source audiobook sync action"
```

---

## Task 5: Native Audiobook Catalog Read And Binary Routes

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-catalog.service.ts`
- Modify: `server/src/modules/warehouse/warehouse-catalog.service.test.ts`
- Modify: `server/src/modules/warehouse/warehouse-catalog.controller.ts`
- Modify: `server/src/modules/warehouse/warehouse-catalog.controller.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts` only if new providers are needed

### Requirements

Expose native cached audiobook reads:

- `GET /api/v1/catalog/audiobooks`
  - query: `q`, `page`, `limit`, `sort`, `order`, filters from `WarehouseAudiobookCatalogQuery`
  - returns `WarehouseAudiobookCatalogPage`
  - local repository only, no live upstream
- `GET /api/v1/catalog/audiobooks/:remoteId`
  - returns `WarehouseAudiobookDetail`
  - local repository/cache only
  - if cached detail is missing, return mapped item with empty `chapters` and `files`; do not live-fetch
  - return safe 404 when settings disabled or item missing
- `GET /api/v1/catalog/audiobooks/:remoteId/cover`
- `GET /api/v1/catalog/audiobooks/:remoteId/stream`
- `GET /api/v1/catalog/audiobooks/:remoteId/download`
- `GET /api/v1/catalog/audiobooks/:remoteId/files/:fileId/download`

Binary routes:

- May call upstream live through `WarehouseClientService` because cover/stream/download are allowed live operations.
- Require catalog source settings enabled and credentials configured.
- Verify the cached audiobook item exists before proxying.
- Require the current user's catalog state to include the audiobook before any live cover, stream, download, or file-download fetch.
- Set safe response headers: `Content-Type`, optional `Content-Length`, safe `Content-Disposition` for downloads.
- Preserve safe single byte-range stream/download requests with validated `Range`, `206`, `416`, `Content-Range`, and `Accept-Ranges` handling.
- Never expose upstream URL, API key, or raw upstream error bodies.
- Return safe native 404/502 style errors.

Access:

- Do not require admin settings permission for regular cached catalog reads.
- Rely on existing global auth behavior, consistent with ebook catalog routes.

### Tests

Controller:

- no admin permission metadata on catalog read/proxy routes.
- delegates list/detail/proxy routes.
- missing detail throws safe 404.
- binary routes pass `remoteId`/`fileId` safely and never expose upstream names in error copy.

Service:

- list returns empty page when catalog source disabled.
- list maps rows without raw payload or secrets.
- detail returns safe public detail, no raw.
- detail uses cached raw detail only for chapters/files projection.
- binary proxy rejects disabled/missing credentials safely.
- binary proxy verifies cached item before upstream call.
- binary proxy rejects cached items outside the current user's catalog state before upstream calls.
- binary proxy uses `WarehouseClientService` only for cover/stream/download, never for list/detail.
- stream/download/file-download range requests are forwarded only when valid, content-type parameters are stripped, partial-content responses require valid metadata, and range response metadata stays on the safe header allowlist.

### Verification

Run:

```bash
pnpm --filter server test \
  src/modules/warehouse/warehouse-catalog.controller.test.ts \
  src/modules/warehouse/warehouse-catalog.service.test.ts \
  src/modules/warehouse/warehouse.repository.test.ts \
  src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-catalog.service.ts server/src/modules/warehouse/warehouse-catalog.service.test.ts server/src/modules/warehouse/warehouse-catalog.controller.ts server/src/modules/warehouse/warehouse-catalog.controller.test.ts server/src/modules/warehouse/warehouse.module.ts
git commit -m "feat: expose cached audiobook catalog api"
```

---

## Task 6: Client Native Audiobook Catalog API And Composable

**Files:**

- Modify: `client/src/features/warehouse/api/catalog-source.api.ts`
- Modify/Create: `client/src/features/warehouse/composables/useCatalogSourceAudiobooks.ts`
- Create: `client/src/features/warehouse/composables/__tests__/useCatalogSourceAudiobooks.spec.ts`

### Requirements

Add client-side API/composable plumbing only; do not add a page, nav entry, card integration, or player integration.

API functions:

- `fetchCatalogSourceAudiobooks(query: WarehouseAudiobookCatalogQuery): Promise<WarehouseAudiobookCatalogPage>`
- `fetchCatalogSourceAudiobook(remoteId: string): Promise<WarehouseAudiobookDetail | null>`
- `catalogSourceAudiobookCoverUrl(remoteId: string): string`
- `catalogSourceAudiobookStreamUrl(remoteId: string): string`
- `catalogSourceAudiobookDownloadUrl(remoteId: string): string`
- `catalogSourceAudiobookFileDownloadUrl(remoteId: string, fileId: string): string`

Use native URL prefix `/api/v1/catalog/audiobooks`.

2026-06-03 detail follow-up:

- Catalog item detail pages render cached audiobook `files` with native per-file download actions.
- File actions use encoded native catalog URLs and avoid provider/upstream wording in regular user copy.

Composable:

- `useCatalogSourceAudiobooks(initialQuery?)`
- manages loading/error/page state.
- exposes `search`, `setPage`, `refresh`.
- future Discover/Search/Listen integrations can consume it without knowing a third-party source exists.

Security/copy:

- Fallback errors use native catalog language.
- No visible Book Warehouse/upstream/third-party copy.
- Do not include API keys or upstream URLs.

### Tests

- API encodes query params, including `hasCover`, `narrator`, `duration` sort, and omission of undefined/null.
- Detail returns `null` on 404.
- URL helpers encode `remoteId` and `fileId`.
- Composable loads first page, refreshes, searches, pages, and preserves safe stale data/error state.

### Verification

Run:

```bash
pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceAudiobooks.spec.ts
pnpm --filter client type-check
pnpm --filter client lint:check
```

### Commit

```bash
git add client/src/features/warehouse/api/catalog-source.api.ts client/src/features/warehouse/composables/useCatalogSourceAudiobooks.ts client/src/features/warehouse/composables/__tests__/useCatalogSourceAudiobooks.spec.ts
git commit -m "feat: add cached audiobook catalog client api"
```

---

## Task 7: Full Audiobook Catalog Phase Verification

Run:

```bash
pnpm --filter @bookorbit/types build
pnpm --filter server test \
  src/modules/warehouse/warehouse.repository.test.ts \
  src/modules/warehouse/warehouse-catalog.mapper.test.ts \
  src/modules/warehouse/warehouse-catalog-sync.service.test.ts \
  src/modules/warehouse/warehouse-admin.controller.test.ts \
  src/modules/warehouse/warehouse-catalog.controller.test.ts \
  src/modules/warehouse/warehouse-catalog.service.test.ts \
  src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter client test:unit --run \
  src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts \
  src/features/warehouse/composables/__tests__/useCatalogSourceEbooks.spec.ts \
  src/features/warehouse/composables/__tests__/useCatalogSourceAudiobooks.spec.ts
pnpm run typecheck
pnpm run lint:check
```

Visible-copy check:

```bash
node -e "const fs=require('fs');const files=['client/src/features/settings/lib/integrations-tabs.ts','client/src/features/warehouse/components/WarehouseAdminSettings.vue','client/src/features/warehouse/api/catalog-source.api.ts'];for(const file of files){const text=fs.readFileSync(file,'utf8');if(file.includes('integrations-tabs')&&/warehouse/i.test(text)) throw new Error('settings nav leaks warehouse wording');if(file.includes('WarehouseAdminSettings')&&/Book Warehouse|third-party|upstream/i.test(text)) throw new Error('admin UI leaks provider wording');}console.log('visible copy check passed')"
```

If verification creates no file changes, do not commit. If generated metadata changes appear, inspect and commit only real changes.

---

## After This Phase

Next phases should be separate plans:

1. Ebook request search/submit/list/status/cancel with local request mirror.
2. Audiobook request search/submit/list/queue with local request mirror.
3. Cached cover storage and refresh policies for ebook/audiobook catalog items.
4. Native BookCard/BookDetail unification for cached source-backed items.
5. Dashboard/search/smart-scope/device/feed integration after authorization and serving semantics are proven.
