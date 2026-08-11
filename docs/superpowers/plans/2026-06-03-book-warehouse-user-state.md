# Book Warehouse User State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the local user/library state substrate for synced catalog ebooks and audiobooks so source-backed items can behave like native BookOrbit items.

**Architecture:** Keep this phase focused on local state, not dashboard/search/device integration. Add SQL-backed membership and per-user state tables keyed by `user_id`, `media_type`, and `remote_id`, then expose native `catalog` APIs for library membership, favorite/rating/read-status, and progress. Later phases can join these tables into dashboard, global search, smart scopes, readers, Kobo, KOReader, OPDS, and ABS-style clients.

**Tech Stack:** NestJS, Drizzle, PostgreSQL migrations, Vitest, Vue composables, `@bookorbit/types`, existing `WarehouseRepository`, `WarehouseCatalogService`, and `client/src/features/warehouse` API patterns.

---

## Sources

- Design: `docs/superpowers/specs/2026-06-02-book-warehouse-parity-design.md`
- Current catalog routes: `server/src/modules/warehouse/warehouse-catalog.controller.ts`
- Current catalog service: `server/src/modules/warehouse/warehouse-catalog.service.ts`
- Current warehouse schema: `server/src/db/schema/warehouse.ts`
- Native reader/user state schema reference: `server/src/db/schema/reader.ts`
- Native collections schema reference: `server/src/db/schema/collections.ts`
- Client catalog API: `client/src/features/warehouse/api/catalog-source.api.ts`

## Baseline

- [x] `pnpm run typecheck` passed after request-sync phase completion.
- [x] `pnpm run lint:check` passed after request-sync phase completion.

## Boundaries

- Do not join these records into dashboard, global search, smart scopes, device sync, OPDS, ABS-style clients, or native reader launch in this phase.
- Do not create a regular-user page or label that says Book Warehouse, warehouse, upstream, provider, source, or third-party.
- Do not store upstream API keys, URLs, raw upstream errors, or upstream request IDs in user-state responses.
- Do not require a synced item to be in a native `books` row; this phase keys by `mediaType + remoteId`.
- Validate that a catalog item exists before creating membership/state.
- Treat all state writes as user-scoped.

## Progress

- [x] Task 1: User state schema, migration, and shared contracts.
- [x] Task 2: Repository user-state methods.
- [x] Task 3: Server service/controller for native catalog state routes.
- [x] Task 4: Client API and composable.
- [x] Task 5: User state phase verification.

## Review Checkpoints

- [ ] Fresh implementer subagent per task.
- [ ] Spec compliance reviewer after each task.
- [ ] Code quality/security reviewer after spec approval.
- [ ] Controller runs verification before marking a task complete.
- [ ] Final full-phase reviewer before moving to dashboard/search/reader integration.

---

## Task 1: User State Schema, Migration, And Shared Contracts

**Files:**

- Modify: `packages/types/src/warehouse.ts`
- Modify: `server/src/db/schema/warehouse.ts`
- Create: `server/src/db/migrations/0015_add_warehouse_user_state.sql`
- Modify: `server/src/db/migrations/meta/_journal.json`
- Create or update: `server/src/db/migrations/meta/0015_snapshot.json`
- Modify: `server/src/db/schema/schema.test.ts`

### Requirements

- [ ] Add shared user-state contracts to `packages/types/src/warehouse.ts`:

```ts
export type WarehouseUserReadStatus =
  | "unread"
  | "want_to_read"
  | "reading"
  | "on_hold"
  | "rereading"
  | "read"
  | "skimmed"
  | "abandoned";

export interface WarehouseUserCatalogState {
  mediaType: WarehouseMediaType;
  remoteId: string;
  inLibrary: boolean;
  favorite: boolean;
  rating: number | null;
  readStatus: WarehouseUserReadStatus | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  updatedAt: string | null;
}

export interface WarehouseUserCatalogStatePatch {
  inLibrary?: boolean;
  favorite?: boolean;
  rating?: number | null;
  readStatus?: WarehouseUserReadStatus | null;
  progressPercent?: number | null;
  positionSeconds?: number | null;
}
```

- [ ] Add `warehouseUserItems` table in `server/src/db/schema/warehouse.ts`:
  - `user_id integer not null references users(id) on delete cascade`
  - `media_type warehouse_media_type not null`
  - `remote_id varchar(128) not null`
  - `added_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
  - primary key `(user_id, media_type, remote_id)`
  - index `warehouse_user_items_user_media_idx` on `(user_id, media_type, added_at)`
  - index `warehouse_user_items_media_remote_idx` on `(media_type, remote_id)`
- [ ] Add `warehouseUserState` table:
  - same composite primary key `(user_id, media_type, remote_id)`
  - `favorite boolean not null default false`
  - `rating integer`
  - `read_status varchar(20)`
  - `progress_percent real`
  - `position_seconds real`
  - `updated_at timestamptz not null default now()`
  - rating check `rating is null or rating between 1 and 5`
  - read-status check matching `WarehouseUserReadStatus`
  - progress check `progress_percent is null or progress_percent between 0 and 100`
  - position check `position_seconds is null or position_seconds >= 0`
  - index `warehouse_user_state_user_media_updated_idx` on `(user_id, media_type, updated_at)`
  - index `warehouse_user_state_media_remote_idx` on `(media_type, remote_id)`
- [ ] Export row and insert types for both tables.
- [ ] Migration `0015_add_warehouse_user_state.sql` must use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and explicit check constraints.
- [ ] Update migration journal/snapshot using the repo's migration metadata convention.
- [ ] Add schema tests that assert composite primary keys, indexes, defaults, and check constraint names.

### Verification

```bash
pnpm --filter server exec vitest run src/db/schema/schema.test.ts src/db/schema/reader.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add packages/types/src/warehouse.ts server/src/db/schema/warehouse.ts server/src/db/schema/schema.test.ts server/src/db/migrations/0015_add_warehouse_user_state.sql server/src/db/migrations/meta/_journal.json server/src/db/migrations/meta/0015_snapshot.json
git commit -m "feat: add catalog user state schema"
```

---

## Task 2: Repository User-State Methods

**Files:**

- Modify: `server/src/modules/warehouse/warehouse.repository.ts`
- Modify: `server/src/modules/warehouse/warehouse.repository.test.ts`

### Requirements

- [ ] Add repository input types:

```ts
export type WarehouseUserStatePatch = {
  inLibrary?: boolean;
  favorite?: boolean;
  rating?: number | null;
  readStatus?: WarehouseUserReadStatus | null;
  progressPercent?: number | null;
  positionSeconds?: number | null;
};

export type WarehouseUserCatalogStateRow = {
  mediaType: WarehouseMediaType;
  remoteId: string;
  inLibrary: boolean;
  favorite: boolean;
  rating: number | null;
  readStatus: WarehouseUserReadStatus | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  updatedAt: Date | null;
};
```

- [ ] Add `getUserCatalogState(userId, mediaType, remoteId)`.
  - It should read `warehouse_user_items` and `warehouse_user_state`.
  - Return default state when neither row exists:
    - `inLibrary: false`
    - `favorite: false`
    - `rating: null`
    - `readStatus: null`
    - `progressPercent: null`
    - `positionSeconds: null`
    - `updatedAt: null`
- [ ] Add `upsertUserCatalogState(userId, mediaType, remoteId, patch)`.
  - When `patch.inLibrary === true`, upsert `warehouse_user_items`.
  - When `patch.inLibrary === false`, delete only that user's membership row, but leave personal state intact.
  - For `favorite`, `rating`, `readStatus`, `progressPercent`, or `positionSeconds`, upsert `warehouse_user_state`.
  - Normalize/clamp values before writing:
    - `rating` must be integer 1-5 or null.
    - `progressPercent` must be finite 0-100 or null.
    - `positionSeconds` must be finite >= 0 or null.
    - invalid `readStatus` becomes null only when explicitly null; otherwise reject in service in Task 3.
  - Return `getUserCatalogState(...)`.
- [ ] Add `listUserCatalogItems(userId, mediaType, limit = 100)` for later integration tests.
  - Join user items to catalog items by `media_type + remote_id`.
  - Sort `warehouse_user_items.updated_at desc`.
  - Limit max 100.

### Tests

- [ ] `getUserCatalogState` returns defaults when no membership/state rows exist.
- [ ] `upsertUserCatalogState` upserts membership and state without cross-user writes.
- [ ] Clearing membership does not clear favorite/rating/progress.
- [ ] Invalid numeric values are normalized or omitted before SQL writes according to the requirements.
- [ ] `listUserCatalogItems` joins on media/remote and caps limit at 100.

### Verification

```bash
pnpm --filter server exec vitest run src/modules/warehouse/warehouse.repository.test.ts --testNamePattern "user catalog state|user catalog items"
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse.repository.ts server/src/modules/warehouse/warehouse.repository.test.ts
git commit -m "feat: store catalog user state"
```

---

## Task 3: Server Native Catalog State Routes

**Files:**

- Create: `server/src/modules/warehouse/warehouse-user-state.service.ts`
- Create: `server/src/modules/warehouse/warehouse-user-state.service.test.ts`
- Create: `server/src/modules/warehouse/warehouse-user-state.controller.ts`
- Create: `server/src/modules/warehouse/warehouse-user-state.controller.test.ts`
- Modify: `server/src/modules/warehouse/warehouse.module.ts`

### Requirements

- [ ] Add `WarehouseUserStateService`.
- [ ] Service must validate the synced catalog item exists through `WarehouseRepository.findCatalogItem(mediaType, remoteId)` before writes.
- [ ] Service must expose:
  - `getState(user, mediaType, remoteId): Promise<WarehouseUserCatalogState>`
  - `patchState(user, mediaType, remoteId, patch): Promise<WarehouseUserCatalogState>`
- [ ] `patchState` must reject:
  - invalid media type
  - blank remote ID
  - rating outside 1-5
  - progress outside 0-100
  - position below 0
  - read status outside the allowed status set
- [ ] Errors must be native and safe:
  - missing catalog item: `NotFoundException('Catalog item is not available.')`
  - invalid patch: `BadRequestException` with native field wording only.
- [ ] Add controller routes under native catalog paths:
  - `GET /api/v1/catalog/items/:mediaType/:remoteId/state`
  - `PATCH /api/v1/catalog/items/:mediaType/:remoteId/state`
- [ ] Controller must use the current authenticated user and must not expose upstream IDs beyond the path's local `remoteId`.
- [ ] Register service/controller in `WarehouseModule`.

### Tests

- [ ] Service returns default state for existing catalog item with no user rows.
- [ ] Service rejects missing catalog item before writing state.
- [ ] Service validates all patch fields.
- [ ] Service writes only through repository user-state methods.
- [ ] Controller delegates with current user and normalized params.
- [ ] Controller response contains no API key/base URL/upstream request ID/raw payload fields.

### Verification

```bash
pnpm --filter server exec vitest run src/modules/warehouse/warehouse-user-state.service.test.ts src/modules/warehouse/warehouse-user-state.controller.test.ts
pnpm --filter server type-check
```

### Commit

```bash
git add server/src/modules/warehouse/warehouse-user-state.service.ts server/src/modules/warehouse/warehouse-user-state.service.test.ts server/src/modules/warehouse/warehouse-user-state.controller.ts server/src/modules/warehouse/warehouse-user-state.controller.test.ts server/src/modules/warehouse/warehouse.module.ts
git commit -m "feat: expose catalog user state api"
```

---

## Task 4: Client API And Composable

**Files:**

- Modify: `client/src/features/warehouse/api/catalog-source.api.ts`
- Create: `client/src/features/warehouse/composables/useCatalogSourceUserState.ts`
- Create: `client/src/features/warehouse/composables/__tests__/useCatalogSourceUserState.spec.ts`

### Requirements

- [ ] Add API methods:
  - `fetchCatalogSourceUserState(mediaType, remoteId)`
  - `patchCatalogSourceUserState(mediaType, remoteId, patch)`
- [ ] Encode media type and remote ID with `encodeURIComponent`.
- [ ] Strip unknown fields from the patch before sending.
- [ ] Add composable:
  - reactive `state`, `loading`, `saving`, and `error`
  - `load()`
  - `save(patch)`
  - optimistic update for `favorite`, `rating`, `readStatus`, `progressPercent`, `positionSeconds`, and `inLibrary`
  - rollback optimistic state on API failure
- [ ] No visible copy should contain Book Warehouse, warehouse, upstream, provider, source, or third-party wording.

2026-06-03 detail follow-up:

- Catalog audiobook detail playback persists paused position, progress percent, and `reading` status through the existing native catalog state composable.
- This is a detail-page progress slice only; full audiobook reader launch, track index persistence, and session/bookmark parity remain separate reader/device work.

### Tests

- [ ] API builds the native catalog state URL and sends only allowed patch fields.
- [ ] Composable loads default state.
- [ ] Composable applies optimistic update and then server response.
- [ ] Composable rolls back optimistic state on failure.
- [ ] Visible-copy guard scans this new composable/API for forbidden user-facing provider wording.

### Verification

```bash
pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceUserState.spec.ts
pnpm --filter client type-check
pnpm --filter client lint:check
```

### Commit

```bash
git add client/src/features/warehouse/api/catalog-source.api.ts client/src/features/warehouse/composables/useCatalogSourceUserState.ts client/src/features/warehouse/composables/__tests__/useCatalogSourceUserState.spec.ts
git commit -m "feat: add catalog user state client api"
```

---

## Task 5: User State Phase Verification

- [ ] Run focused schema, repository, service/controller, and client composable tests.
- [ ] Run repo-wide typecheck.
- [ ] Run repo-wide lint.
- [ ] Run visible-copy guard for new user-state client/server files.
- [ ] Dispatch final full-phase reviewer.
- [ ] Update this plan and create `docs/superpowers/plans/2026-06-03-book-warehouse-user-state.progress.txt`.

### Verification

```bash
pnpm --filter server exec vitest run src/db/schema/schema.test.ts src/modules/warehouse/warehouse.repository.test.ts --testNamePattern "user catalog state|user catalog items|warehouse user"
pnpm --filter server exec vitest run src/modules/warehouse/warehouse-user-state.service.test.ts src/modules/warehouse/warehouse-user-state.controller.test.ts
pnpm --filter client test:unit --run src/features/warehouse/composables/__tests__/useCatalogSourceUserState.spec.ts
pnpm run typecheck
pnpm run lint:check
node - <<'JS'
const fs = require('fs');
const files = [
  'client/src/features/warehouse/api/catalog-source.api.ts',
  'client/src/features/warehouse/composables/useCatalogSourceUserState.ts',
  'server/src/modules/warehouse/warehouse-user-state.controller.ts',
  'server/src/modules/warehouse/warehouse-user-state.service.ts',
];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (/Book Warehouse|third-party|upstream|provider/i.test(text)) {
    throw new Error(`${file} leaks provider wording`);
  }
}
console.log('user state visible copy check passed');
JS
```

### Commit

```bash
git add docs/superpowers/plans/2026-06-03-book-warehouse-user-state.md docs/superpowers/plans/2026-06-03-book-warehouse-user-state.progress.txt
git commit -m "docs: complete catalog user state phase"
```

## Self-Review

- Spec coverage: This plan covers the rollout item for local user state substrate: membership, favorite, rating, read status, and progress. It intentionally leaves dashboard/search/smart-scope/device/reader integration for later phases.
- Placeholder scan: No task uses TBD/TODO/fill-in language.
- Type consistency: Shared type names, repository method names, service names, and route paths are consistent across tasks.
