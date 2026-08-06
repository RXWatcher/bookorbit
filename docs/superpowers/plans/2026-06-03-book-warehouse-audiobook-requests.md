# Book Warehouse Audiobook Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native audiobook request parity foundations: discovery, title/author submission, local request mirror, status sync, queue visibility, request notifications, and client request state without exposing the upstream provider to regular users.

**Architecture:** Reuse the internal `warehouse` module and existing `warehouse_requests` mirror. Audiobook request reads are native BookOrbit request concepts; live upstream calls are limited to discovery, submission, status sync, and queue state. There is no audiobook cancel or stream route because the upstream user API does not provide those actions.

**Tech Stack:** NestJS, Drizzle/Postgres, Vue 3 composables, Vitest, shared `@bookorbit/types`, BookOrbit `NotificationService`.

---

## Sources

- Design: `docs/superpowers/specs/2026-06-02-book-warehouse-parity-design.md`
- Grimmory reference: `/Users/jonathanfinley/Developer/GitHub/relictiohosting/grimmory/docs/prds/warehouse-audiobook-requests.md`
- Upstream docs:
  - Audible discovery: `GET /api/v1/audiobooks/search/external?q=...`
  - Acquisition candidate search: `GET /api/v1/audiobooks/abiplayer/search?q=...`
  - Submit audiobook request: `POST /api/v1/audiobooks/abiplayer/requests` with `{ "title": "..." }` and optional `{ "author": "..." }`
  - Request status list: `GET /api/v1/audiobooks/abiplayer/requests` with optional `status` and `limit`
  - Active queue: `GET /api/v1/audiobooks/abiplayer/queue`
  - Auth uses `X-API-Key`; do not use query-string keys.

## Boundaries

- No regular user-facing Book Warehouse, warehouse, upstream, provider, third-party, source, vendor, or API-key copy.
- Native copy only: Requests, Requested, Processing, Completed, Failed, Queue, Search, Submit, Refresh, Available.
- Do not expose raw upstream request objects, raw upstream errors, upstream URLs, API keys, provider-specific source labels, or cover URLs from discovery results.
- Do not add audiobook cancel, progress-stream, scan, or per-request stream endpoints.
- Do not wire UI dialogs, BookCard, BookDetail, dashboards, OPDS, Kobo, KOReader, collections, or global search in this plan.
- Do not create local mirror rows from upstream request-list rows that are not already associated with the requesting user.

## Review Checkpoints

- [x] Fresh implementer subagent per task.
- [x] Spec compliance reviewer after each task.
- [x] Code quality/security reviewer after spec approval.
- [x] Controller runs verification before marking a task complete.
- [x] Final full-phase reviewer before moving to request dialogs or deeper integrations.

---

## Task 1: Audiobook Request Contracts And Public Mappers

**Files:**

- Modify: `packages/types/src/warehouse.ts`
- Modify: `server/src/modules/warehouse/dto/warehouse-request.dto.ts`
- Modify: `server/src/modules/warehouse/dto/warehouse-request.dto.test.ts`
- Modify: `server/src/modules/warehouse/warehouse-request.mapper.ts`
- Modify: `server/src/modules/warehouse/warehouse-request.mapper.test.ts`

### Requirements

- [ ] Add shared client/server types:
  - `WarehouseExternalAudiobookSearchResult`
    - `title: string`
    - optional `author`, `authors`, `narrators`, `asin`, `series`, `durationSeconds`
  - `WarehouseAudiobookExternalSearchPage`
    - `results: WarehouseExternalAudiobookSearchResult[]`
  - `WarehouseAudiobookRequestSubmitPayload`
    - `title: string`
    - optional `author`
  - `WarehouseAudiobookQueueItem`
    - `title: string`
    - optional `author`
    - `status: WarehouseRequestStatus`
  - `WarehouseAudiobookQueuePage`
    - `items: WarehouseAudiobookQueueItem[]`
- [ ] Extend `WarehouseRequestPayloadSummary` with audiobook-native fields:
  - optional `title`
  - optional `author`
- [ ] Add `SubmitWarehouseAudiobookRequestDto`:
  - trims `title` and `author`
  - requires non-empty `title`
  - limits `title` to 256 chars and `author` to 160 chars
  - rejects non-string titles
- [ ] Extend request mapper summaries so audiobook payloads expose only safe `title` and optional safe `author`.
- [ ] Reuse `normalizeWarehouseRequestStatus`.
- [ ] Keep public mappers stripping unsafe provider/source/warehouse/upstream text, URLs, hostnames, API-key text, bearer/auth text, and opaque token-shaped values.

### Tests

- [ ] DTO tests reject missing/blank/non-string audiobook title and trim accepted title/author.
- [ ] Mapper tests cover safe audiobook payload summary.
- [ ] Mapper tests cover unsafe audiobook title/author are omitted from payload summary and unsafe row title falls back to `Catalog request`.
- [ ] Shared package build passes.

### Verification

```bash
pnpm --filter @bookorbit/types build
pnpm --filter server test src/modules/warehouse/dto/warehouse-request.dto.test.ts src/modules/warehouse/warehouse-request.mapper.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add packages/types/src/warehouse.ts server/src/modules/warehouse/dto/warehouse-request.dto.ts server/src/modules/warehouse/dto/warehouse-request.dto.test.ts server/src/modules/warehouse/warehouse-request.mapper.ts server/src/modules/warehouse/warehouse-request.mapper.test.ts
git commit -m "feat: add audiobook request contracts"
```

### Status

- Completed with shared audiobook request, external search, and queue contracts plus `SubmitWarehouseAudiobookRequestDto`.
- Public request mappers now expose audiobook payload summaries as safe `title` and optional `author` only; ebook payload summaries remain ebook-only.
- Review checkpoints: spec approved after removing stray ebook fields from audiobook payload summaries; quality/privacy approved after widening upstream-backed discovery and queue fields to allow `null`.
- Verification: `pnpm --filter @bookorbit/types build`, `pnpm --filter server test src/modules/warehouse/dto/warehouse-request.dto.test.ts src/modules/warehouse/warehouse-request.mapper.test.ts`, and `pnpm --filter server type-check` passed.

---

## Task 2: Upstream Audiobook Request Client

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-client.service.ts`
- Modify: `server/src/modules/warehouse/warehouse-client.service.test.ts`
- Modify: `server/src/modules/warehouse/__fixtures__/audiobook-request.json`
- Create: `server/src/modules/warehouse/__fixtures__/audiobook-request-queue.json`

### Requirements

- [ ] Keep existing methods and harden their response types:
  - `searchExternalAudiobooks({ baseUrl, apiKey, q })`
  - `searchAbiplayerAudiobooks({ baseUrl, apiKey, q })`
  - `requestAudiobook({ baseUrl, apiKey, title, author? })`
- [ ] Add `listAudiobookRequests({ baseUrl, apiKey, status?, limit? })`.
  - Calls `GET /audiobooks/abiplayer/requests`.
  - Sends only `status` and `limit` query params when present.
  - Accepts bare arrays and wrappers `{ items }`, `{ requests }`, `{ queue }`, `{ results }`.
- [ ] Add `listAudiobookRequestQueue({ baseUrl, apiKey })`.
  - Calls `GET /audiobooks/abiplayer/queue`.
  - Accepts bare arrays and wrappers `{ items }`, `{ requests }`, `{ queue }`, `{ results }`.
- [ ] Normalize upstream audiobook request rows to a server-only shape with optional `id`, safe raw `title`, optional `author`, optional `status`.
- [ ] Use `X-API-Key`, never query-string auth.
- [ ] Do not expose raw `Response` objects to controllers.
- [ ] Upstream errors must use `WarehouseApiError` with API keys and base URLs scrubbed.

### Tests

- [ ] `searchExternalAudiobooks` and `searchAbiplayerAudiobooks` encode `q` and send only `X-API-Key`.
- [ ] `requestAudiobook` posts only `title` and optional `author`.
- [ ] `requestAudiobook` omits undefined/blank author.
- [ ] `listAudiobookRequests` encodes `status`/`limit`, accepts array and wrapper shapes, and sends no API key query param.
- [ ] `listAudiobookRequestQueue` accepts array and wrapper shapes.
- [ ] Upstream error JSON maps to safe `WarehouseApiError` text with no key/base URL.

### Verification

```bash
pnpm --filter server test src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-client.service.ts server/src/modules/warehouse/warehouse-client.service.test.ts server/src/modules/warehouse/__fixtures__/audiobook-request.json server/src/modules/warehouse/__fixtures__/audiobook-request-queue.json
git commit -m "feat: add audiobook request upstream client"
```

### Status

- Completed with upstream audiobook request submission, status-list, and queue client methods using native BookOrbit-safe request shapes.
- Audiobook request client calls now use `X-API-Key` only, omit blank authors, tolerate array and wrapper list responses, and treat top-level `null` list payloads as empty pages.
- Review checkpoints: spec approved; quality/privacy required hardening raw rejected fetch errors and null list payloads, then approved after fixes.
- Verification: `pnpm --filter server test src/modules/warehouse/warehouse-client.service.test.ts` and `pnpm --filter server type-check` passed.

---

## Task 3: Server Audiobook Request Service And Controller

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-request.service.ts`
- Modify: `server/src/modules/warehouse/warehouse-request.service.test.ts`
- Modify: `server/src/modules/warehouse/warehouse-request.controller.ts`
- Modify: `server/src/modules/warehouse/warehouse-request.controller.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts`
- Modify: `packages/types/src/notification.ts`

### Requirements

- [ ] Add regular-user native routes:
  - `GET /api/v1/catalog/requests/audiobooks/search?q=...`
  - `GET /api/v1/catalog/requests/audiobooks/candidates?q=...`
  - `POST /api/v1/catalog/requests/audiobooks`
  - `GET /api/v1/catalog/requests/audiobooks`
  - `POST /api/v1/catalog/requests/audiobooks/refresh`
  - `GET /api/v1/catalog/requests/audiobooks/queue`
- [ ] Keep existing ebook routes working.
- [ ] `searchAudiobooks` calls upstream Audible discovery and returns `WarehouseAudiobookExternalSearchPage`.
- [ ] `searchAudiobookCandidates` calls upstream acquisition candidate search and returns `WarehouseAudiobookExternalSearchPage`.
- [ ] Search result mapper strips provider/source labels, cover URLs, URLs, hostnames, API-key text, bearer/auth text, and opaque token-shaped values.
- [ ] `submitAudiobookRequest`:
  - validates title and optional author.
  - calls upstream request endpoint with `title` and optional `author`.
  - mirrors a local `warehouse_requests` row with `mediaType: "audiobook"`, current user id, upstream request id when provided, normalized status, safe title/author, and requested payload `{ title, author? }`.
  - returns public `WarehouseRequestDetail` without upstream ids.
- [ ] `listAudiobookRequests`:
  - attempts an upstream status sync for the current user's existing local audiobook rows.
  - never creates local rows for upstream requests that do not match an existing current-user mirror by upstream request id.
  - reads from local mirror scoped to current user and `mediaType: "audiobook"`.
- [ ] `refreshAudiobookRequests`:
  - syncs upstream request-list rows into current user's matching local audiobook mirrors.
  - preserves existing local title/author/upstream id when upstream rows are partial or unsafe.
  - returns the current user's local audiobook request page.
- [ ] `getAudiobookQueue`:
  - returns safe queue items only.
  - does not persist queue-only rows.
- [ ] Add notification types:
  - `NotificationType.CatalogRequestCompleted = "catalog_request_completed"`
  - `NotificationType.CatalogRequestFailed = "catalog_request_failed"`
  - category `catalogRequests`.
- [ ] Send a notification to the requesting user when an existing local audiobook request changes from a non-terminal status to `completed` or `failed` during sync.
- [ ] Do not send duplicate notifications when status is unchanged.
- [ ] Do not add audiobook cancel or stream behavior.

### Tests

- [ ] Controller normalizes audiobook search, candidate search, submit, list, refresh, and queue routes.
- [ ] Service rejects empty search and empty submit title with safe native errors.
- [ ] Service uses safe credentials and returns `Catalog requests are temporarily unavailable.` for upstream/secret failures.
- [ ] Service submit mirrors user-owned audiobook row and strips unsafe metadata.
- [ ] Service list/sync updates only current-user audiobook rows by upstream id and does not create rows from unknown upstream requests.
- [ ] Service refresh preserves local metadata on partial/unsafe upstream rows.
- [ ] Service queue strips unsafe queue item values.
- [ ] Service sends completed/failed notifications only on status transition.
- [ ] Existing ebook request tests still pass.

### Verification

```bash
pnpm --filter server test src/modules/warehouse/warehouse-request.service.test.ts src/modules/warehouse/warehouse-request.controller.test.ts src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-request.service.ts server/src/modules/warehouse/warehouse-request.service.test.ts server/src/modules/warehouse/warehouse-request.controller.ts server/src/modules/warehouse/warehouse-request.controller.test.ts server/src/modules/warehouse/warehouse.module.ts packages/types/src/notification.ts
git commit -m "feat: expose audiobook request api"
```

### Status

- Completed with native regular-user audiobook request search, candidate search, submit, list, refresh, and queue routes.
- Audiobook request service now mirrors submitted title/author requests as user-scoped local rows, syncs only existing local audiobook mirrors by upstream id, returns sanitized queue/search data, and does not add audiobook cancel or stream behavior.
- Completion/failure request notifications were added for audiobook status transitions; notification dispatch failures are isolated so list/refresh sync still completes.
- Review checkpoints: spec required preserving opaque upstream request ids and unfiltered status sync; quality required isolating notification failures. Both re-reviews passed after fixes.
- Verification: `pnpm --filter server test src/modules/warehouse/warehouse-request.service.test.ts src/modules/warehouse/warehouse-request.controller.test.ts src/modules/warehouse/warehouse-client.service.test.ts` and `pnpm --filter server type-check` passed.

---

## Task 4: Client Audiobook Request API And Composable

**Files:**

- Modify: `client/src/features/warehouse/api/catalog-source.api.ts`
- Create: `client/src/features/warehouse/composables/useCatalogSourceAudiobookRequests.ts`
- Create: `client/src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts`

### Requirements

- [ ] Add API functions:
  - `searchCatalogSourceRequestAudiobooks(q: string): Promise<WarehouseAudiobookExternalSearchPage>`
  - `searchCatalogSourceRequestAudiobookCandidates(q: string): Promise<WarehouseAudiobookExternalSearchPage>`
  - `submitCatalogSourceAudiobookRequest(payload: WarehouseAudiobookRequestSubmitPayload): Promise<WarehouseRequestDetail>`
  - `fetchCatalogSourceAudiobookRequests(query: WarehouseRequestListQuery): Promise<WarehouseRequestPage>`
  - `refreshCatalogSourceAudiobookRequests(query?: WarehouseRequestListQuery): Promise<WarehouseRequestPage>`
  - `fetchCatalogSourceAudiobookRequestQueue(): Promise<WarehouseAudiobookQueuePage>`
- [ ] API paths:
  - `/api/v1/catalog/requests/audiobooks/search`
  - `/api/v1/catalog/requests/audiobooks/candidates`
  - `/api/v1/catalog/requests/audiobooks`
  - `/api/v1/catalog/requests/audiobooks/refresh`
  - `/api/v1/catalog/requests/audiobooks/queue`
- [ ] Submit sends JSON with `Content-Type: application/json`.
- [ ] Query builders encode `q`, `status`, `page`, and `limit`, and omit undefined/null/blank values.
- [ ] Add `useCatalogSourceAudiobookRequests(initialQuery?)`.
- [ ] Composable state:
  - request page, queue page, loading flags, error string.
  - exposes `refresh`, `setPage`, `searchExternal`, `searchCandidates`, `submit`, `refreshQueue`, and `refreshStatuses`.
  - preserves stale request list and stale queue on failures.
  - protects against older in-flight list loads overwriting newer submit/status refresh mutations.
- [ ] Safe fallback errors:
  - `Failed to load requests`
  - `Failed to search catalog`
  - `Failed to search candidates`
  - `Failed to submit request`
  - `Failed to refresh requests`
  - `Failed to load queue`

### Tests

- [ ] API tests verify endpoint paths, query encoding, JSON headers, and omitted blank params.
- [ ] Submit test asserts payload sends `title` and optional `author` only.
- [ ] Composable loads initial audiobook request page and queue.
- [ ] Composable searches both discovery endpoints.
- [ ] Composable submits and upserts the returned request.
- [ ] Composable refreshes status page and queue.
- [ ] Composable preserves stale list/queue on failures and safe errors.
- [ ] Composable prevents stale list loads from overwriting newer submit/status mutations.
- [ ] Visible copy constants do not contain Book Warehouse, warehouse, upstream, third-party, provider, source, or vendor wording.

### Verification

```bash
pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts
pnpm --filter client type-check
pnpm --filter client lint:check
```

### Commit

```bash
git add client/src/features/warehouse/api/catalog-source.api.ts client/src/features/warehouse/composables/useCatalogSourceAudiobookRequests.ts client/src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts
git commit -m "feat: add audiobook request client api"
```

### Status

- Completed with audiobook request API helpers for search, candidates, submit, list, refresh, and queue using native request routes.
- Added `useCatalogSourceAudiobookRequests` with initial request/queue loading, stale-data preservation, submit upsert, status refresh, queue refresh, and stale in-flight list protection.
- Review checkpoints: spec approved; quality initially questioned queue failure handling after status refresh, and the added regression test verified the existing behavior preserves the refreshed page and surfaces `Failed to load queue`.
- Verification: `pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts`, `pnpm --filter client type-check`, and `pnpm --filter client lint:check` passed.

---

## Task 5: Full Audiobook Request Phase Verification

- [x] Run shared type build.
- [x] Run focused server audiobook request tests.
- [x] Run focused client audiobook request tests.
- [x] Run repo-wide typecheck.
- [x] Run repo-wide lint.
- [x] Run visible-copy guard on user-facing string literals in new client request API/composable files.
- [x] Dispatch final full-phase reviewer.
- [x] Update this plan and `progress.txt`.

### Verification

```bash
pnpm --filter @bookorbit/types build
pnpm --filter server test src/modules/warehouse/warehouse-client.service.test.ts src/modules/warehouse/warehouse-request.service.test.ts src/modules/warehouse/warehouse-request.controller.test.ts src/modules/warehouse/warehouse-request.mapper.test.ts src/modules/warehouse/dto/warehouse-request.dto.test.ts
pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts
pnpm run typecheck
pnpm run lint:check
node -e "const fs=require('fs');const files=['client/src/features/warehouse/api/catalog-source.api.ts','client/src/features/warehouse/composables/useCatalogSourceAudiobookRequests.ts'];const strings=[];for(const file of files){const text=fs.readFileSync(file,'utf8');for(const match of text.matchAll(/\"[^\"]*\"|'[^']*'/g)) strings.push(match[0]);}const visible=strings.filter((value)=>/Failed|Request|Queue|Search|Submit|Refresh|Available|Processing|Completed|Cancelled|Canceled/i.test(value)).join('\\n');if(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i.test(visible)) throw new Error('audiobook request visible copy leaks provider wording');console.log('audiobook request visible copy check passed')"
```

If verification creates no file changes, do not commit. If generated metadata changes appear, inspect and commit only real changes.

### Status

- Completed final verification for the audiobook request phase.
- Full-phase review found queue privacy and bounding issues: the queue route was global, queue items exposed upstream IDs, and queue responses were unbounded.
- Fixed queue handling so `GET /api/v1/catalog/requests/audiobooks/queue` passes the current user, matches upstream queue rows only to that user's local audiobook mirrors by private upstream request id, returns local safe title/author with normalized status, omits all public queue IDs, skips upstream calls when no user-owned mirrored upstream IDs exist, requests `limit: 100`, and defensively caps mapped queue rows at 100.
- Re-review passed after the queue fix.
- Verification passed:
  - `pnpm --filter @bookorbit/types build`
  - `pnpm --filter server test src/modules/warehouse/warehouse-client.service.test.ts src/modules/warehouse/warehouse-request.service.test.ts src/modules/warehouse/warehouse-request.controller.test.ts src/modules/warehouse/warehouse-request.mapper.test.ts src/modules/warehouse/dto/warehouse-request.dto.test.ts` (133 tests)
  - `pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts` (15 tests)
  - `pnpm run typecheck`
  - `pnpm run lint:check`
  - visible-copy guard

---

## After This Phase

Next phases should be separate plans:

1. Request dialogs and My Requests UI for ebook and audiobook flows.
2. Scheduled request status sync jobs and completion mapping to synced catalog items.
3. Cached cover storage and refresh policies for ebook/audiobook catalog items.
4. Source-backed item integration into native library/search/dashboard/reader surfaces.
