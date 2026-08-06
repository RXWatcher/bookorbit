# Book Warehouse Request Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduled request status sync and completed-request catalog reconciliation so BookOrbit request state keeps moving without a user opening the Requests page.

**Architecture:** Keep this as a server-only slice. Add repository selection for stale open request mirrors, a request sync service that consumes documented Book Warehouse request list endpoints, and a small cron job that delegates cadence/skip logic to the service. Use existing `warehouse_requests.completed_remote_id`, `warehouse_requests.last_status_synced_at`, `warehouse_settings.sync_cadence_minutes`, and existing catalog sync methods; do not add a migration in this phase.

**Tech Stack:** NestJS, `@nestjs/schedule`, Drizzle, Vitest, existing `WarehouseRepository`, `WarehouseClientService`, `WarehouseSecretService`, `WarehouseCatalogSyncService`, and `NotificationService`.

---

## Sources

- Design: `docs/superpowers/specs/2026-06-02-book-warehouse-parity-design.md`
- Request service: `server/src/modules/warehouse/warehouse-request.service.ts`
- Request mapper: `server/src/modules/warehouse/warehouse-request.mapper.ts`
- Upstream client: `server/src/modules/warehouse/warehouse-client.service.ts`
- Repository/schema: `server/src/modules/warehouse/warehouse.repository.ts`, `server/src/db/schema/warehouse.ts`
- Catalog sync: `server/src/modules/warehouse/warehouse-catalog-sync.service.ts`
- Scheduler patterns: `server/src/modules/audit/audit-cleanup.job.ts`, `server/src/modules/user-statistics/user-statistics-aggregation.job.ts`

## Baseline

- [x] `pnpm run typecheck` passed before planning.
- [x] `pnpm run test` passed before planning: server 481 files / 5998 tests, client 189 files / 2184 tests.

## Progress

- [x] Task 1: Repository request sync candidate query.
- [x] Task 2: Request sync service, including review hardening for audiobook remote IDs, terminal-row filtering, user-refresh remote IDs, and completed-refresh catalog sync triggers.
- [x] Task 3: Scheduled request sync job, including non-overlap guard.
- [x] Task 4: Request sync phase verification.

## Boundaries

- Use documented upstream endpoints only:
  - Ebook request list: `GET /monitoring`.
  - Ebook request detail remains in the existing on-demand flow.
  - Audiobook request list: `GET /audiobooks/abiplayer/requests`.
  - Audiobook queue remains in the existing UI/queue flow.
- Continue using `X-API-Key` through `WarehouseClientService`; do not introduce query-string API keys.
- Do not add regular-user visible Book Warehouse/provider/source/warehouse wording.
- Do not add audiobook cancel or stream behavior.
- Do not add catalog item detail routes, dashboard/search integrations, or reader/device integrations in this plan.
- Do not add a migration unless implementation proves the existing request/catalog columns are insufficient.
- Do not send duplicate terminal-status notifications; only notify transitions from `pending`, `processing`, or `unknown` into `completed` or `failed`.

## Review Checkpoints

- [ ] Fresh implementer subagent per task.
- [ ] Spec compliance reviewer after each task.
- [ ] Code quality/security reviewer after spec approval.
- [ ] Controller runs verification before marking a task complete.
- [ ] Final full-phase reviewer before moving to the next parity phase.

---

## Task 1: Repository Request Sync Candidate Query

**Files:**

- Modify: `server/src/modules/warehouse/warehouse.repository.ts`
- Modify: `server/src/modules/warehouse/warehouse.repository.test.ts`

### Requirements

- [ ] Add an exported internal options type:

```ts
export type RequestSyncCandidateQuery = {
  mediaType?: WarehouseMediaType;
  staleBefore?: Date;
  limit?: number;
};
```

- [ ] Add `WarehouseRepository.listRequestMirrorsForSync(query: RequestSyncCandidateQuery): Promise<WarehouseRequestRow[]>`.
- [ ] Candidate rows must satisfy:
  - `userId` is not null.
  - `upstreamRequestId` is not null.
  - status is one of `pending`, `processing`, or `unknown`.
  - optional `mediaType` filter when supplied.
  - stale filter when `staleBefore` is supplied: `lastStatusSyncedAt is null OR lastStatusSyncedAt < staleBefore`.
- [ ] Clamp `limit` using the existing page-limit rules and cap at `100`.
- [ ] Order by `lastStatusSyncedAt ASC NULLS FIRST` and then `id ASC` so older requests sync first.
- [ ] Do not return terminal `completed`, `failed`, or `cancelled` rows.

### Tests

- [ ] Add a repository unit test that renders the generated SQL and asserts it contains:
  - `user_id is not null`
  - `upstream_request_id is not null`
  - `status in (...)`
  - `last_status_synced_at is null OR last_status_synced_at < ...`
  - `media_type` only when a media filter is supplied.
- [ ] Add a test that verifies `limit` is capped at `100` and ordering uses stale-first semantics.

### Verification

```bash
pnpm --filter server exec vitest run src/modules/warehouse/warehouse.repository.test.ts --testNamePattern "request sync"
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse.repository.ts server/src/modules/warehouse/warehouse.repository.test.ts
git commit -m "feat: select request sync candidates"
```

---

## Task 2: Request Sync Service

**Files:**

- Create: `server/src/modules/warehouse/warehouse-request-sync.service.ts`
- Create: `server/src/modules/warehouse/warehouse-request-sync.service.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts`

### Requirements

- [ ] Add `WarehouseRequestSyncService` and register/export it from `WarehouseModule`.
- [ ] Export a summary type from the service file:

```ts
export type WarehouseRequestSyncSummary = {
  status: "skipped" | "completed" | "failed";
  scannedCount: number;
  updatedCount: number;
  notifiedCount: number;
  catalogSyncCount: number;
  errorCount: number;
  skippedReason?:
    | "disabled"
    | "missing-credentials"
    | "unreadable-credentials"
    | "no-candidates";
};
```

- [ ] Add `syncDueRequests(now = new Date()): Promise<WarehouseRequestSyncSummary>`.
- [ ] `syncDueRequests` must:
  - Load settings through `WarehouseRepository.findSettings()`.
  - Return `skipped/disabled` when settings are missing or disabled.
  - Return `skipped/missing-credentials` when encrypted API key fields are incomplete.
  - Return `skipped/unreadable-credentials` when decryption fails.
  - Compute `staleBefore = now - syncCadenceMinutes`.
  - Call `listRequestMirrorsForSync({ staleBefore, limit: 100 })`.
  - Return `skipped/no-candidates` if there are no rows.
  - Call `WarehouseClientService.listBookRequests` at most once when there are ebook candidates.
  - Call `WarehouseClientService.listAudiobookRequests({ limit: 100 })` at most once when there are audiobook candidates.
  - Match upstream rows by `upstreamRequestId` only; never create request mirrors for unknown upstream rows.
  - Update only matched local rows with normalized status, safe title/author/isbn fields, `completedRemoteId` when upstream provides it, and `lastStatusSyncedAt`.
  - Preserve local title/author/isbn when upstream values are unsafe or missing.
  - Send BookOrbit notifications for non-terminal to completed/failed transitions with `actionUrl: '/requests'` and no upstream IDs in `meta`.
  - Continue syncing other rows when notification dispatch fails; count the notification error but keep the status update.
  - If a completed row has a `completedRemoteId` and `WarehouseRepository.findCatalogItem(mediaType, completedRemoteId)` returns null, call the matching `WarehouseCatalogSyncService.syncEbooks()` or `syncAudiobooks()` once per media type.
  - If a catalog sync call fails, keep request updates and count an error; do not throw raw upstream details.
- [ ] Add `syncAllOpenRequests(now = new Date()): Promise<WarehouseRequestSyncSummary>` for manual/admin use and tests. It should use the same flow but omit the `staleBefore` filter.
- [ ] Keep helper functions private to this service unless a reviewer asks for extraction.

### Tests

- [ ] Skips safely when settings are disabled, credentials are missing, or credentials cannot be decrypted.
- [ ] Returns `skipped/no-candidates` without upstream calls when the repository has no stale open requests.
- [ ] Syncs ebook and audiobook candidates from their list endpoints, updates only matching local rows, and never upserts unknown upstream rows.
- [ ] Sends completed/failed notifications only for non-terminal transitions and suppresses duplicate terminal notifications.
- [ ] Preserves local safe metadata when upstream metadata is unsafe.
- [ ] Sets `completedRemoteId` from upstream `completedRemoteId`, `completed_remote_id`, `remoteId`, or `remote_id`.
- [ ] Triggers at most one catalog sync per media type when completed remote IDs are missing from the local catalog cache.
- [ ] Continues after notification or catalog sync failures and returns a `failed` summary with `errorCount > 0`.

### Verification

```bash
pnpm --filter server exec vitest run src/modules/warehouse/warehouse-request-sync.service.test.ts
pnpm --filter server exec vitest run src/modules/warehouse/warehouse-request.service.test.ts --testNamePattern "audiobook status notifications|refreshes only after local ownership"
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-request-sync.service.ts server/src/modules/warehouse/warehouse-request-sync.service.test.ts server/src/modules/warehouse/warehouse.module.ts
git commit -m "feat: sync request status mirrors"
```

---

## Task 3: Scheduled Request Sync Job

**Files:**

- Create: `server/src/modules/warehouse/warehouse-request-sync.job.ts`
- Create: `server/src/modules/warehouse/warehouse-request-sync.job.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts`

### Requirements

- [ ] Add injectable `WarehouseRequestSyncJob`.
- [ ] Add `@Cron('*/5 * * * *') async runRequestSync()` so the app checks for due request sync work every five minutes.
- [ ] The cron method must call `WarehouseRequestSyncService.syncDueRequests()`.
- [ ] The cron method must catch all thrown errors and log a sanitized message, matching existing job style.
- [ ] The cron method must not log secrets, base URLs, API keys, upstream IDs, or raw upstream errors.
- [ ] Register the job in `WarehouseModule.providers`.

### Tests

- [ ] Job calls `syncDueRequests`.
- [ ] Job catches service errors and does not rethrow.
- [ ] Job logs a summary when work completes with `updatedCount > 0` or `errorCount > 0`.
- [ ] Job stays quiet for `skipped/no-candidates`.

### Verification

```bash
pnpm --filter server exec vitest run src/modules/warehouse/warehouse-request-sync.job.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-request-sync.job.ts server/src/modules/warehouse/warehouse-request-sync.job.test.ts server/src/modules/warehouse/warehouse.module.ts
git commit -m "feat: schedule request status sync"
```

---

## Task 4: Request Sync Phase Verification

- [ ] Run focused repository, service, job, and existing request-service tests.
- [ ] Run repo-wide typecheck.
- [ ] Run repo-wide lint.
- [ ] Dispatch final full-phase reviewer.
- [ ] Update this plan and `2026-06-03-book-warehouse-request-sync.progress.txt`.

### Verification

```bash
pnpm --filter server exec vitest run src/modules/warehouse/warehouse.repository.test.ts --testNamePattern "request sync"
pnpm --filter server exec vitest run src/modules/warehouse/warehouse-request-sync.service.test.ts src/modules/warehouse/warehouse-request-sync.job.test.ts
pnpm --filter server exec vitest run src/modules/warehouse/warehouse-request.service.test.ts --testNamePattern "audiobook status notifications|refreshes only after local ownership|lists audiobook requests"
pnpm run typecheck
pnpm run lint:check
```

If verification creates no file changes, do not commit. If generated metadata changes appear, inspect and commit only real changes.

---

## After This Phase

Next phases should be separate plans:

1. Cached cover storage and refresh policies for ebook/audiobook catalog items.
2. Source-backed item integration into native library/search/dashboard/reader surfaces.
3. Completed request links/actions once source-backed catalog detail routes are available.
