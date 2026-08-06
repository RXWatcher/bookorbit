# Book Warehouse Ebook Request Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use review checkpoints after every task.

**Goal:** Add native ebook request monitoring foundations: external discovery, request submission, local request mirror, status refresh, cancellation, and safe progress-stream proxying without exposing the upstream provider to regular users.

**Architecture:** Keep the existing internal `warehouse` module boundary, but expose regular-user APIs with native `catalog/request` concepts. Upstream calls are allowed for external discovery and request actions/status refresh; local request history reads use the `warehouse_requests` mirror. User-facing responses must never contain API keys, upstream URLs, raw upstream errors, or provider-specific copy.

**Tech Stack:** NestJS, Drizzle/Postgres, Fastify, Vue 3 client API/composable plumbing, Vitest, shared `@bookorbit/types`.

---

## Sources

- Design: `docs/superpowers/specs/2026-06-02-book-warehouse-parity-design.md`
- Upstream docs:
  - External search: `GET /api/v1/search/external?q=...`
  - Submit ebook request: `POST /api/v1/monitoring/add` with either `{ "isbn": "..." }` plus optional `{ "preferred_format": "epub" }`, or `{ "search_result": <external result> }`
  - List requests: `GET /api/v1/monitoring`
  - Detail/status: `GET /api/v1/monitoring/{id}`
  - Progress stream: `GET /api/v1/monitoring/{id}/stream`
  - Cancel request: `DELETE /api/v1/monitoring/{id}`
  - All API routes live under `/api/v1`; auth uses `X-API-Key`.

## Important Boundaries

- Do not add a regular user-facing Warehouse page, tab, badge, source label, or visible provider name.
- Native user copy only: Requests, Requested, Processing, Completed, Failed, Cancel, Refresh, Available.
- Do not expose raw upstream request objects, raw upstream errors, upstream URLs, or API keys.
- Do not use `api_key` query parameters.
- Do not invent upstream request body fields. Ebook submit accepts ISBN/preferred format or a whole external search result object.
- Do not wire requests into BookCard, BookDetail, dashboards, OPDS, Kobo, KOReader, smart scopes, collections, or global search in this phase.
- Do not implement audiobook request flows in this plan; use a separate audiobook request plan because upstream has different list/queue behavior and no cancel/stream endpoint.

## Review Checkpoints

Use the same subagent-driven workflow as prior phases:

1. Fresh implementer subagent per task.
2. Spec compliance reviewer after each task.
3. Code-quality/security reviewer after spec approval.
4. Controller runs verification before marking a task complete.
5. Final reviewer for the full ebook request phase before moving to audiobook requests.

---

## Task 1: Ebook Request Contracts

**Files:**

- Modify: `packages/types/src/warehouse.ts`
- Modify: `server/src/modules/warehouse/dto/index.ts` if needed for exports
- Create: `server/src/modules/warehouse/dto/warehouse-request.dto.ts`
- Create: `server/src/modules/warehouse/warehouse-request.mapper.ts`
- Create: `server/src/modules/warehouse/warehouse-request.mapper.test.ts`

### Requirements

Shared types:

- `WarehouseEbookExternalSearchQuery`
  - `q: string`
- `WarehouseEbookExternalSearchPage`
  - `results: WarehouseExternalBookSearchResult[]`
- `WarehouseEbookRequestSubmitPayload`
  - optional `isbn`
  - optional `preferredFormat`
  - optional `searchResult: WarehouseExternalBookSearchResult & Record<string, unknown>`
  - validation rule: either trimmed `isbn` or `searchResult` is required.
- `WarehouseRequestListQuery`
  - optional `status`, `page`, `limit`, `mediaType`
- `WarehouseRequestItem`
  - `id`, `mediaType`, `status`, `title`, `author`, `isbn`, `completedRemoteId`, `requestedAt`, `updatedAt`, `lastStatusSyncedAt`
  - optional `upstreamRequestId` only for admin/internal DTOs; regular user response should not need it.
- `WarehouseRequestDetail`
  - extends item with safe `requestedPayload` summary only: no raw upstream response.
- `WarehouseRequestPage`
  - `items`, `page`, `limit`, `total`

Server DTOs:

- `SubmitWarehouseEbookRequestDto`
  - `isbn?: string`
  - `preferredFormat?: string`
  - `searchResult?: Record<string, unknown>`
- `ListWarehouseRequestsDto`
  - `status?: WarehouseRequestStatus`
  - `page?: number`
  - `limit?: number`

Mapper:

- Add `normalizeWarehouseRequestStatus(value)` mapping tolerant upstream statuses into existing `WarehouseRequestStatus`.
- Add `mapWarehouseRequestRow(row)` returning native public DTO without secrets/raw upstream errors.
- Add `mapExternalBookSearchResult(raw)` only if existing client mapper is not reusable; keep `source` from upstream result internal/client-safe if it is metadata-source label, not provider connection identity.

### Tests

- Shared package build must pass.
- Mapper tests cover:
  - unknown status maps to `"unknown"`
  - processing/downloading/queued-like upstream values map to `"processing"`
  - completed/succeeded/available-like values map to `"completed"`
  - failed/error-like values map to `"failed"`
  - cancelled/canceled-like values map to `"cancelled"`
  - public DTO omits raw payload and upstream URLs/API keys.

### Verification

Run:

```bash
pnpm --filter @bookorbit/types build
pnpm --filter server test src/modules/warehouse/warehouse-request.mapper.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add packages/types/src/warehouse.ts server/src/modules/warehouse/dto/index.ts server/src/modules/warehouse/dto/warehouse-request.dto.ts server/src/modules/warehouse/warehouse-request.mapper.ts server/src/modules/warehouse/warehouse-request.mapper.test.ts
git commit -m "feat: add ebook request contracts"
```

---

## Task 2: Upstream Ebook Request Client

**Files:**

- Modify: `server/src/modules/warehouse/warehouse-client.service.ts`
- Modify: `server/src/modules/warehouse/warehouse-client.service.test.ts`
- Create or update fixture: `server/src/modules/warehouse/__fixtures__/ebook-request.json`

### Requirements

Extend `WarehouseClientService` with:

- `searchExternalBooks({ baseUrl, apiKey, q })` already exists; harden tests for request-system use.
- `requestBook({ baseUrl, apiKey, isbn?, preferred_format?, search_result? })`
  - already exists; ensure body compacts undefined fields, sends no extra fields, uses `X-API-Key`.
- `listBookRequests({ baseUrl, apiKey })`
  - `GET /monitoring`
  - tolerant wrappers: array, `{ items }`, `{ requests }`, `{ monitoring }`, `{ results }`
- `getBookRequest({ baseUrl, apiKey, id })`
  - `GET /monitoring/{id}`
  - id path segment encoded.
- `cancelBookRequest({ baseUrl, apiKey, id })`
  - `DELETE /monitoring/{id}`
  - returns a safe server-only status wrapper.
- `streamBookRequest({ baseUrl, apiKey, id })`
  - `GET /monitoring/{id}/stream`
  - returns a server-only binary/text wrapper or safe stream wrapper following the existing fetch style.

Security:

- Always use `X-API-Key` header.
- Never put keys in query strings.
- Sanitize upstream errors through `WarehouseApiError` without preserving API keys or upstream URLs.
- Do not expose raw `Response` objects to controllers.

### Tests

- `searchExternalBooks` uses `/api/v1/search/external?q=...`, encodes q, and sends only `X-API-Key`.
- `requestBook` posts only `isbn`, `preferred_format`, and/or `search_result`.
- `listBookRequests` accepts array and wrapper shapes.
- `getBookRequest`, `cancelBookRequest`, and `streamBookRequest` encode ids.
- upstream error JSON maps to safe `WarehouseApiError` text with no key/base URL.

### Verification

Run:

```bash
pnpm --filter server test src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-client.service.ts server/src/modules/warehouse/warehouse-client.service.test.ts server/src/modules/warehouse/__fixtures__/ebook-request.json
git commit -m "feat: add ebook request upstream client"
```

### Status

- Completed in `b726d3e4` with quality hardening in `c74cbbb1`.
- Review checkpoints: spec approved; quality/privacy approved after stream-safe binary wrapping and broader upstream error scrubbing.
- Verification: `pnpm --filter server test src/modules/warehouse/warehouse-client.service.test.ts src/modules/warehouse/warehouse-catalog.controller.test.ts` and `pnpm --filter server type-check` passed.

---

## Task 3: Request Repository Mirror

**Files:**

- Modify: `server/src/modules/warehouse/warehouse.repository.ts`
- Modify: `server/src/modules/warehouse/warehouse.repository.test.ts`

### Requirements

Add repository methods:

- `createRequestMirror(data)`
  - inserts local `warehouse_requests` row.
  - stores `userId`, `mediaType: "ebook"`, `upstreamRequestId`, normalized `status`, `title`, `author`, `isbn`, `requestedPayload`, `completedRemoteId`, `lastStatusSyncedAt`.
- `upsertRequestMirror(data)`
  - upserts by `upstreamRequestId` when present, otherwise updates by local id in service.
- `listRequestsForUser(userId, query)`
  - filters by user id.
  - defaults to ebook requests unless media type is explicitly supplied.
  - supports status filter and pagination.
  - sorts newest first.
- `findRequestForUser(id, userId)`
  - returns only the requesting user's row.
- `findRequestByUpstreamId(upstreamRequestId)`
  - used to avoid duplicate local rows after submit/status sync.
- `updateRequestMirror(id, data)`
  - updates status/completed id/payload/lastStatusSyncedAt safely.
- `deleteRequestMirror(id, userId)`
  - deletes or marks cancelled after upstream cancel succeeds. Prefer update to `cancelled` so history remains visible.

### Tests

- insert values include `mediaType: "ebook"` and user id.
- list query filters by user id and status.
- find-by-user includes user id in where clause.
- update sets `lastStatusSyncedAt`.
- cancel/update does not delete other users' rows.
- no raw upstream URL/API key is stored in error/status fields.

### Verification

Run:

```bash
pnpm --filter server test src/modules/warehouse/warehouse.repository.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse.repository.ts server/src/modules/warehouse/warehouse.repository.test.ts
git commit -m "feat: mirror ebook requests"
```

### Status

- Completed with scoped request mirror repository methods for create, upsert, list, find, update, and cancel-preserving history.
- Review checkpoints: spec approved; quality/privacy approved after upsert/find/update paths were scoped by user/media type and `requestedPayload` storage sanitization was hardened for provider/source/warehouse identifiers, secrets, errors, URLs, hostnames, opaque tokens, and nested arrays.
- Verification: `pnpm --filter server test src/modules/warehouse/warehouse.repository.test.ts` and `pnpm --filter server type-check` passed.

---

## Task 4: Ebook Request Service And Controller

**Files:**

- Create: `server/src/modules/warehouse/warehouse-request.service.ts`
- Create: `server/src/modules/warehouse/warehouse-request.service.test.ts`
- Create: `server/src/modules/warehouse/warehouse-request.controller.ts`
- Create: `server/src/modules/warehouse/warehouse-request.controller.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts`

### Requirements

Service:

- Loads enabled catalog-source settings and decrypts credentials through existing services.
- `searchExternalBooks(q)` calls upstream external search, returns native results, and converts failures to safe native errors.
- `submitEbookRequest(user, payload)` validates payload, submits upstream, creates/updates local mirror, and returns native `WarehouseRequestDetail`.
- `listRequests(user, query)` reads local mirror only.
- `getRequest(user, id)` reads local mirror only.
- `refreshRequest(user, id)` calls upstream detail by stored upstream id, updates local mirror, returns native detail.
- `cancelRequest(user, id)` calls upstream delete by stored upstream id, marks local mirror `cancelled`, returns native detail.
- `streamRequest(user, id)` verifies ownership and credentials, calls upstream stream, and returns a safe server-only stream wrapper. If this is too risky for this phase, expose the controller route but return safe 404 and keep SSE for a follow-up task; do not silently omit the route from the plan.

Controller:

- `GET /api/v1/catalog/requests/ebooks/search?q=...`
- `POST /api/v1/catalog/requests/ebooks`
- `GET /api/v1/catalog/requests`
- `GET /api/v1/catalog/requests/:id`
- `POST /api/v1/catalog/requests/:id/refresh`
- `DELETE /api/v1/catalog/requests/:id`
- `GET /api/v1/catalog/requests/:id/stream`

Access:

- Use `@CurrentUser()` for ownership.
- Do not attach admin settings permission metadata.
- Rely on existing auth guard behavior like catalog reads.

Errors:

- Missing disabled settings: safe native errors.
- Missing request row: safe 404.
- Upstream failures: safe native 502/500 without raw provider text.

### Tests

Service:

- disabled/missing/decrypt-failed settings reject safely.
- search calls upstream only and returns safe native results.
- submit by ISBN and by search result create mirror rows.
- submit rejects when both ISBN and search result are missing.
- list/detail use repository only, not upstream.
- refresh updates local mirror from upstream status.
- cancel calls upstream delete and marks cancelled locally.
- ownership is enforced through repository user id filters.

Controller:

- no admin permission metadata on routes.
- normalizes q/status/page/limit.
- delegates submit/list/detail/refresh/cancel/stream.
- returns safe 404 for missing local request.
- does not expose upstream ids in regular DTOs unless intentionally included in internal admin-only shape.

### Verification

Run:

```bash
pnpm --filter server test \
  src/modules/warehouse/warehouse-request.service.test.ts \
  src/modules/warehouse/warehouse-request.controller.test.ts \
  src/modules/warehouse/warehouse.repository.test.ts \
  src/modules/warehouse/warehouse-client.service.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-request.service.ts server/src/modules/warehouse/warehouse-request.service.test.ts server/src/modules/warehouse/warehouse-request.controller.ts server/src/modules/warehouse/warehouse-request.controller.test.ts server/src/modules/warehouse/warehouse.module.ts
git commit -m "feat: expose ebook request api"
```

### Status

- Completed with native regular-user request routes and service methods for ebook request search, submit, list, detail, refresh, cancel, and a safe unavailable stream fallback.
- Public request/search contracts were narrowed so regular DTOs omit upstream ids, completed remote ids, source/provider labels, cover/upstream URLs, and raw upstream details; mapper/service output now sanitizes provider/warehouse/source wording, URLs, hostnames, API-key text, bearer/auth text, and opaque token-shaped values.
- Review checkpoints: spec approved; quality/privacy approved after current-user search routing, top-level DTO sanitization, ebook media-type enforcement before refresh/cancel upstream calls, and public text sanitizer hardening.
- Verification: `pnpm --filter server test src/modules/warehouse/warehouse-request.service.test.ts src/modules/warehouse/warehouse-request.controller.test.ts src/modules/warehouse/warehouse.repository.test.ts src/modules/warehouse/warehouse-client.service.test.ts src/modules/warehouse/warehouse-request.mapper.test.ts src/modules/warehouse/dto/warehouse-request.dto.test.ts` and `pnpm --filter server type-check` passed.

---

## Task 5: Client Ebook Request API And Composable

**Files:**

- Modify: `client/src/features/warehouse/api/catalog-source.api.ts`
- Create: `client/src/features/warehouse/composables/useCatalogSourceRequests.ts`
- Create: `client/src/features/warehouse/composables/__tests__/useCatalogSourceRequests.spec.ts`

### Requirements

API functions:

- `searchCatalogSourceRequestBooks(q: string): Promise<WarehouseEbookExternalSearchPage>`
- `submitCatalogSourceEbookRequest(payload: WarehouseEbookRequestSubmitPayload): Promise<WarehouseRequestDetail>`
- `fetchCatalogSourceRequests(query: WarehouseRequestListQuery): Promise<WarehouseRequestPage>`
- `fetchCatalogSourceRequest(id: number): Promise<WarehouseRequestDetail | null>`
- `refreshCatalogSourceRequest(id: number): Promise<WarehouseRequestDetail>`
- `cancelCatalogSourceRequest(id: number): Promise<WarehouseRequestDetail>`
- `catalogSourceRequestStreamUrl(id: number): string`

Composable:

- `useCatalogSourceRequests(initialQuery?)`
- manages loading/error/page state.
- exposes `refresh`, `searchExternal`, `submit`, `setPage`, `refreshRequest`, and `cancelRequest`.
- preserves stale request list on failures.
- uses native fallback errors:
  - `Failed to load requests`
  - `Failed to search catalog`
  - `Failed to submit request`
  - `Failed to refresh request`
  - `Failed to cancel request`

### Tests

- API encodes q/status/page/limit and omits undefined/null.
- submit sends only native payload fields with `preferred_format` conversion handled server-side, not client-side.
- detail returns null on 404.
- stream URL encodes id.
- composable loads initial page, searches external candidates, submits, refreshes one request, cancels, paginates, and preserves safe stale state on failures.
- no visible Book Warehouse/upstream/third-party copy.

### Verification

Run:

```bash
pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceRequests.spec.ts
pnpm --filter client type-check
pnpm --filter client lint:check
```

### Commit

```bash
git add client/src/features/warehouse/api/catalog-source.api.ts client/src/features/warehouse/composables/useCatalogSourceRequests.ts client/src/features/warehouse/composables/__tests__/useCatalogSourceRequests.spec.ts
git commit -m "feat: add ebook request client api"
```

### Status

- Completed with native client request API helpers for external ebook discovery, submit, list, detail, refresh, cancel, and stream URL generation.
- Added `useCatalogSourceRequests` for request list state, external candidate search, submit, per-request refresh/cancel updates, pagination, stale-list preservation on failures, and safe native fallback errors.
- Review checkpoints: spec approved; quality/privacy approved after adding the explicit JSON content type header for request submission and locking it in the client API test.
- Verification: `pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceRequests.spec.ts`, `pnpm --filter client type-check`, and `pnpm --filter client lint:check` passed.

---

## Task 6: Full Ebook Request Phase Verification

Run:

```bash
pnpm --filter @bookorbit/types build
pnpm --filter server test \
  src/modules/warehouse/warehouse-request.mapper.test.ts \
  src/modules/warehouse/warehouse-client.service.test.ts \
  src/modules/warehouse/warehouse.repository.test.ts \
  src/modules/warehouse/warehouse-request.service.test.ts \
  src/modules/warehouse/warehouse-request.controller.test.ts
pnpm --filter client test:unit --run \
  src/features/warehouse/composables/__tests__/useCatalogSourceRequests.spec.ts
pnpm run typecheck
pnpm run lint:check
```

Visible-copy check:

```bash
node -e "const fs=require('fs');const files=['client/src/features/warehouse/api/catalog-source.api.ts','client/src/features/warehouse/composables/useCatalogSourceRequests.ts'];for(const file of files){const text=fs.readFileSync(file,'utf8');if(/Book Warehouse|third-party|upstream/i.test(text)) throw new Error(file+' leaks provider wording');}console.log('request visible copy check passed')"
```

If verification creates no file changes, do not commit. If generated metadata changes appear, inspect and commit only real changes.

### Status

- Completed with full ebook request phase verification passing across shared types, focused server request tests, focused client request tests, repo-wide typecheck, repo-wide lint, and visible-copy guard.
- Final full-phase review approved after preserving existing request mirror metadata on partial/unsafe upstream refresh responses and preventing stale in-flight client list loads from overwriting newer submit/refresh/cancel mutations.

---

## After This Phase

Next phases should be separate plans:

1. Audiobook request flow with candidate search, submit, list/status, queue, and notifications.
2. Request dialogs and My Requests UI once both ebook and audiobook request APIs are proven.
3. Notification/status sync jobs for request completion/failure.
4. Local user ownership and source-backed detail/readiness integrations.
