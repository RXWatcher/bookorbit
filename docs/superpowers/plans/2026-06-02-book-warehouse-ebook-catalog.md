# Book Warehouse Ebook Catalog Sync Plan

## Goal

Build the next parity slice after the foundation: sync ebook catalog pages into local SQL,
cache ebook details/covers on demand, and expose a native, admin-configured catalog read API
that can later feed BookOrbit Library, Discover, Search, Requests, and reader surfaces.

This phase still must not create a regular user-facing Warehouse page. Public product copy should
use BookOrbit-native labels such as Catalog, Catalog Source, Available, Requested, Processing,
Completed, and Failed. Internal module/file names may continue to use `warehouse`.

## Sources

- Design: `docs/superpowers/specs/2026-06-02-book-warehouse-parity-design.md`
- Foundation plan: `docs/superpowers/plans/2026-06-02-book-warehouse-foundation.md`
- Book Warehouse docs:
  - `GET /api/v1/books` lists ebooks with `page` and `limit`, limit max 100.
  - `GET /api/v1/books/search?q=` searches ebooks.
  - `GET /api/v1/books/{id}` returns full ebook metadata.
  - `GET /api/v1/books/{id}/cover/{size}` returns cover bytes for `thumbnail`, `medium`, or `original`.
  - `GET /api/v1/books/{id}/download` downloads or returns a short-lived link.
  - All API routes are under `/api/v1` except `/health`, and auth uses the `X-API-Key` header.
- Existing native catalog spine:
  - `server/src/modules/book/book.service.ts`
  - `server/src/modules/book/book.repository.ts`
  - `server/src/modules/book/book-query-builder.service.ts`
  - `packages/types/src/book.ts`

## Important Boundaries

- Do not wire warehouse rows into `BookCard`/`BookDetail`, OPDS, Kobo, KOReader, dashboards,
  collections, smart scopes, or global search in this phase.
- Do not add a regular user-facing Warehouse page.
- Do not live-query Book Warehouse from hot user browse/search paths.
- Do not create local `books`/`book_files` rows yet. This phase creates a projection boundary that
  later native integrations can consume deliberately.
- Do not expose API keys, upstream URLs, or raw upstream error payloads to regular users.
- Keep all upstream traffic behind the existing encrypted settings and typed `WarehouseClientService`.

## Review Checkpoints

Use the same subagent-driven workflow as the foundation:

1. Fresh implementer subagent per task.
2. Spec compliance reviewer after each task.
3. Code-quality/security reviewer after spec approval.
4. Controller runs the specified verification before marking a task complete.

---

## Task 1: Ebook Catalog Contracts

**Files:**

- Modify: `packages/types/src/warehouse.ts`
- Modify: `packages/types/src/index.ts` only if needed

### Requirements

Add contracts for the local, native-facing ebook catalog cache:

- `WarehouseCatalogSort` union: `title`, `author`, `series`, `syncedAt`, `addedAt`.
- `WarehouseCatalogOrder` union: `asc`, `desc`.
- `WarehouseEbookCatalogQuery`:
  - optional `q`, `page`, `limit`, `sort`, `order`
  - optional filters: `author`, `series`, `language`, `format`, `hasCover`
- `WarehouseEbookCatalogItem`:
  - `id`, `remoteId`, `title`, `subtitle`, `authors`, `series`, `language`, `publisher`,
    `identifiers`, `format`, `hasCover`, `syncedAt`, `source: "catalog-source"`
  - no upstream URL, no API key, no raw payload
- `WarehouseEbookCatalogPage`:
  - `items`, `page`, `limit`, `total`
- `WarehouseEbookDetail`:
  - extends/contains the item fields plus `raw` as `Record<string, unknown>` for admin/debug-only
    server use if needed; do not expose raw through regular client APIs in later tasks.
- `WarehouseCatalogSyncSummary`:
  - `runId`, `status`, `mediaType`, `fetchedCount`, `savedCount`, `errorMessage`, `startedAt`,
    `finishedAt`
- `WarehouseCatalogSyncState`:
  - `lastRun`, `running`

### Tests

Add type-level or lightweight compile tests only if this repo already has a pattern. Otherwise
verification is package build.

### Verification

Run:

```bash
pnpm --filter @bookorbit/types build
```

### Commit

```bash
git add packages/types/src/warehouse.ts packages/types/src/index.ts
git commit -m "feat: add ebook catalog cache contracts"
```

---

## Task 2: Repository Support For Ebook Cache And Sync Runs

**Files:**

- Modify: `server/src/modules/warehouse/warehouse.repository.ts`
- Modify/Create: `server/src/modules/warehouse/warehouse.repository.test.ts`

### Requirements

Extend `WarehouseRepository` with focused methods for the existing `warehouse_catalog_items`,
`warehouse_catalog_details`, and `warehouse_catalog_sync_runs` tables:

- `createSyncRun(mediaType: "ebook" | "audiobook" | "mixed"): Promise<WarehouseCatalogSyncRunRow>`
  - inserts `running` row and returns it.
- `completeSyncRun(id, counts, timings?): Promise<void>`
  - sets status `completed`, `finishedAt`, `fetchedCount`, `savedCount`, timings.
- `failSyncRun(id, errorMessage, counts?, timings?): Promise<void>`
  - sets status `failed`, `finishedAt`, safe error message, counts/timings.
- `findLatestSyncRun(mediaType?: "ebook" | "audiobook" | "mixed")`
  - returns newest run, optionally filtered.
- `upsertCatalogItems(items: Array<Omit<NewWarehouseCatalogItemRow, "id" | "createdAt" | "updatedAt">>): Promise<number>`
  - no-op for empty list
  - upserts by `(mediaType, remoteId)`
  - returns saved count
- `findCatalogItem(mediaType, remoteId)`
- `upsertCatalogDetail(data: Omit<NewWarehouseCatalogDetailRow, "id" | "fetchedAt">): Promise<void>`
- `findCatalogDetail(mediaType, remoteId)`
- `listEbookCatalog(query)`
  - uses local SQL only
  - supports `q` search across title, authors, series, identifiers, format, language, publisher
  - supports filters from `WarehouseEbookCatalogQuery`
  - supports page/limit clamped to sane bounds
  - supports sort/order
  - returns rows and total

Keep this repository layer generic enough for audiobooks later, but do not implement audiobook
surface behavior in this task.

### Tests

Use Drizzle chain mocks consistent with existing repository tests. Cover:

- empty upsert short-circuits
- upsert uses conflict target `(mediaType, remoteId)`
- sync run create/complete/fail methods call expected insert/update chains
- `listEbookCatalog` applies media type `ebook`, pagination, search/filter, and total count paths

### Verification

Run:

```bash
pnpm --filter server test src/modules/warehouse/warehouse.repository.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse.repository.ts server/src/modules/warehouse/warehouse.repository.test.ts
git commit -m "feat: add ebook catalog repository support"
```

---

## Task 3: Ebook Catalog Mapping And Sync Service

**Files:**

- Create: `server/src/modules/warehouse/warehouse-catalog.mapper.ts`
- Create: `server/src/modules/warehouse/warehouse-catalog.mapper.test.ts`
- Create: `server/src/modules/warehouse/warehouse-catalog-sync.service.ts`
- Create: `server/src/modules/warehouse/warehouse-catalog-sync.service.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts`

### Requirements

Mapper:

- Map `WarehouseBookSummary` and tolerant upstream/raw objects into `NewWarehouseCatalogItemRow`
  for `mediaType: "ebook"`.
- Normalize:
  - `remoteId` from `id`
  - `title` required, fallback to `Untitled`
  - `authors` from `author` or `authors`
  - `series`, `language`, `publisher`, `format`, `hasCover`
  - identifiers from ISBN fields when present
  - `rawPayload` preserves original payload
  - `syncedAt` uses the sync timestamp
- No public/user copy should mention Book Warehouse.

Sync service:

- `syncEbooks(): Promise<WarehouseCatalogSyncSummary>`
- Reads settings; if disabled or credentials missing, throw safe `BadRequestException` with
  catalog-source wording.
- Decrypts API key only inside server service.
- Pages through `WarehouseClientService.listBooks({ page, limit: 100 })` until:
  - a page returns fewer than 100 items, or
  - fetched count reaches upstream `total` if provided.
- Upserts mapped rows in batches per page.
- Records a sync run with `running`, then `completed` or `failed`.
- On failure, persist safe error text, do not leak API key/base URL.
- Keep retry/backoff out of this task; bounded timeout already lives in the client.

### Tests

Mapper tests:

- maps `author` string to `authors: [author]`
- maps `hasCover`, identifiers, language/format/series
- tolerates missing optional fields
- preserves raw payload

Sync service tests:

- rejects when disabled or missing/decrypt-failed credentials
- pages until less than max limit
- stops at upstream total when provided
- records completed run counts
- records failed run on client/repository error with safe message
- never passes API key in URLs; rely on client test or assert client receives separate `apiKey`

### Verification

Run:

```bash
pnpm --filter server test \
  src/modules/warehouse/warehouse-catalog.mapper.test.ts \
  src/modules/warehouse/warehouse-catalog-sync.service.test.ts \
  src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-catalog.mapper.ts server/src/modules/warehouse/warehouse-catalog.mapper.test.ts server/src/modules/warehouse/warehouse-catalog-sync.service.ts server/src/modules/warehouse/warehouse-catalog-sync.service.test.ts server/src/modules/warehouse/warehouse.module.ts
git commit -m "feat: sync ebook catalog cache"
```

---

## Task 4: Admin Cache Status And Manual Ebook Sync

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-admin.controller.ts`
- Modify: `server/src/modules/warehouse/warehouse-admin.controller.test.ts`
- Modify: `client/src/features/warehouse/api/warehouse-admin.api.ts`
- Modify: `client/src/features/warehouse/components/WarehouseAdminSettings.vue`
- Modify: `client/src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts`

### Requirements

Server:

- Add admin-only endpoints under existing `admin/warehouse`:
  - `GET /catalog-sync` returns `WarehouseCatalogSyncState`
  - `POST /catalog-sync/ebooks` triggers `syncEbooks()` and returns `WarehouseCatalogSyncSummary`
- Controller delegates only; service behavior is tested in Task 3.
- Permission remains `ManageAppSettings`.

Client:

- Add API functions:
  - `fetchWarehouseCatalogSyncState()`
  - `syncWarehouseEbooks()`
- Extend admin settings panel with compact cache status/actions:
  - Show last ebook sync status/count/time if present.
  - Button label: `Sync ebooks`
  - No visible warehouse/third-party copy.
  - Disable sync while already syncing or settings are not enabled.
  - Toast safe success/error messages.

### Tests

Server controller test:

- delegates sync state and ebook sync actions.

Client component test:

- renders cache status with native copy.
- calls sync API when `Sync ebooks` clicked.
- disables sync when settings disabled or action in flight.

### Verification

Run:

```bash
pnpm --filter server test src/modules/warehouse/warehouse-admin.controller.test.ts src/modules/warehouse/warehouse-catalog-sync.service.test.ts
pnpm --filter client test:unit --run src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts
pnpm run typecheck
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-admin.controller.ts server/src/modules/warehouse/warehouse-admin.controller.test.ts client/src/features/warehouse/api/warehouse-admin.api.ts client/src/features/warehouse/components/WarehouseAdminSettings.vue client/src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts
git commit -m "feat: add catalog source ebook sync action"
```

---

## Task 5: Native Ebook Catalog Read API

**Files:**

- Create: `server/src/modules/warehouse/warehouse-catalog.controller.ts`
- Create: `server/src/modules/warehouse/warehouse-catalog.controller.test.ts`
- Create: `server/src/modules/warehouse/warehouse-catalog.service.ts`
- Create: `server/src/modules/warehouse/warehouse-catalog.service.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts`

### Requirements

Expose local cached ebook reads only, not live upstream calls:

- `GET /catalog/ebooks`
  - query: `q`, `page`, `limit`, `sort`, `order`, filters from `WarehouseEbookCatalogQuery`
  - returns `WarehouseEbookCatalogPage`
- `GET /catalog/ebooks/:remoteId`
  - returns `WarehouseEbookCatalogItem` plus cached detail summary if present
  - triggers no live upstream request in this task
- `GET /catalog/ebooks/:remoteId/cover/:size`
  - not implemented in this task unless already cached; return 404 or safe not-ready response.

Permission/access:

- Reuse an existing read permission appropriate for library/catalog browse. If uncertain, use the
  same permission required for existing book browse/search and document it in the test.
- Do not require admin settings permission for regular cached catalog reads.
- If settings disabled, return empty list or safe disabled response; prefer empty list to avoid
  exposing admin state details.

Product copy:

- API route names may use `catalog`, not `warehouse`.
- Error messages should avoid Book Warehouse/upstream terminology.

### Tests

- Controller permission metadata matches chosen native read permission.
- Controller delegates list/detail.
- Service returns empty page when settings disabled.
- Service maps repository rows to `WarehouseEbookCatalogItem` without raw payload or API key.
- Search/list is local repository only; no client method called.

### Verification

Run:

```bash
pnpm --filter server test \
  src/modules/warehouse/warehouse-catalog.controller.test.ts \
  src/modules/warehouse/warehouse-catalog.service.test.ts \
  src/modules/warehouse/warehouse.repository.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-catalog.controller.ts server/src/modules/warehouse/warehouse-catalog.controller.test.ts server/src/modules/warehouse/warehouse-catalog.service.ts server/src/modules/warehouse/warehouse-catalog.service.test.ts server/src/modules/warehouse/warehouse.module.ts
git commit -m "feat: expose cached ebook catalog api"
```

### Follow-up: Native Ebook Download Proxy

Completed 2026-06-03.

- Added `GET /api/v1/catalog/ebooks/:remoteId/download`.
- The service verifies settings, decrypts credentials server-side, checks the cached ebook item, and requires the current user's catalog state to include the item before proxying the live download.
- The controller allowlists ebook download content types, uses a safe fallback attachment filename, and never reflects remote filenames, URLs, or secrets.
- Ebook cover proxy/cache remained separate until the follow-up below.

Ownership hardening completed 2026-06-03:

- The route passes the authenticated BookOrbit user into the service.
- Items outside the current user's catalog state return the same safe not-available response and never reach the live binary client.

Cover proxy completed 2026-06-03:

- Added `GET /api/v1/catalog/ebooks/:remoteId/cover/:size` for documented `thumbnail`, `medium`, and `original` sizes.
- The service reuses the same current-user catalog-state gate as ebook downloads before proxying live cover bytes.
- The controller only serves image content types, uses ebook-native safe error copy for invalid proxied cover responses, and applies a private browser cache header.
- Persistent local cover materialization/cache remains a later performance/repair task.

Detail media actions completed 2026-06-03:

- Added client URL helpers for native ebook cover and download routes.
- Catalog ebook detail pages now show proxied covers when available and expose a native Download action.
- The view keeps audiobook playback separate and does not introduce visible Book Warehouse/upstream/provider wording.

Range-aware binary proxy hardening completed 2026-06-03:

- Native ebook downloads now forward only validated single byte-range requests through the live binary client.
- Partial-content metadata is limited to safe `206`, `416`, `Content-Range`, and `Accept-Ranges` response handling without reflecting upstream URLs, raw headers, content-type parameters, or credentials.

---

---

## Task 6: Client Native Catalog API And Internal Composable

**Files:**

- Create: `client/src/features/warehouse/api/catalog-source.api.ts`
- Create: `client/src/features/warehouse/composables/useCatalogSourceEbooks.ts`
- Create: `client/src/features/warehouse/composables/__tests__/useCatalogSourceEbooks.spec.ts`

### Requirements

Add client-side API/composable plumbing only; do not add a new page or nav entry.

- API functions:
  - `fetchCatalogSourceEbooks(query: WarehouseEbookCatalogQuery): Promise<WarehouseEbookCatalogPage>`
  - `fetchCatalogSourceEbook(remoteId: string): Promise<WarehouseEbookCatalogItem | null>`
- Use native URL prefix `/api/v1/catalog/ebooks`.
- Use fetch-style `api`.
- No visible copy in this task.
- Composable manages loading/error/page state and exposes `search`, `setPage`, `refresh`.
- Designed so a later Discover/Search integration can consume it without knowing a third-party source exists.

### Tests

- API encodes query params and handles non-ok response with native error.
- Composable loads first page, refreshes, and preserves safe error state.

### Verification

Run:

```bash
pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceEbooks.spec.ts
pnpm --filter client type-check
pnpm --filter client lint:check
```

### Commit

```bash
git add client/src/features/warehouse/api/catalog-source.api.ts client/src/features/warehouse/composables/useCatalogSourceEbooks.ts client/src/features/warehouse/composables/__tests__/useCatalogSourceEbooks.spec.ts
git commit -m "feat: add cached ebook catalog client api"
```

---

## Task 7: Full Ebook Catalog Phase Verification

Run:

```bash
pnpm --filter @bookorbit/types build
pnpm --filter server test \
  src/modules/warehouse/warehouse.repository.test.ts \
  src/modules/warehouse/warehouse-catalog.mapper.test.ts \
  src/modules/warehouse/warehouse-catalog-sync.service.test.ts \
  src/modules/warehouse/warehouse-admin.controller.test.ts \
  src/modules/warehouse/warehouse-catalog.controller.test.ts \
  src/modules/warehouse/warehouse-catalog.service.test.ts
pnpm --filter client test:unit --run \
  src/features/warehouse/components/__tests__/WarehouseAdminSettings.spec.ts \
  src/features/warehouse/composables/__tests__/useCatalogSourceEbooks.spec.ts
pnpm run typecheck
pnpm run lint:check
```

Visible-copy check:

```bash
node -e "const fs=require('fs');const files=['client/src/features/settings/lib/integrations-tabs.ts','client/src/features/warehouse/components/WarehouseAdminSettings.vue'];for(const file of files){const text=fs.readFileSync(file,'utf8');if(file.includes('integrations-tabs')&&/warehouse/i.test(text)) throw new Error('settings nav leaks warehouse wording');}console.log('visible copy check passed')"
```

If verification creates no file changes, do not commit. If generated metadata changes appear,
inspect and commit only real changes.

---

## After This Phase

Next phases should be separate plans:

1. Audiobook catalog cache/detail/cover/stream/download foundations.
2. Ebook request search/submit/list/status/cancel with local request mirror.
3. Audiobook request search/submit/list/queue with local request mirror.
4. Native BookCard/BookDetail unification for cached source-backed items.
5. Dashboard/search/smart-scope/device/feed integration after authorization and serving semantics
   are proven.
