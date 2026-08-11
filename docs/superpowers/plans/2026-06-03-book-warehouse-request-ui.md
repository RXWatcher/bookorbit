# Book Warehouse Request UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** Add native BookOrbit request dialogs and a My Requests page for ebook and audiobook acquisition without exposing the upstream provider to regular users.

**Architecture:** Build a client-only UI layer on top of the already-implemented request APIs and composables. Keep request state in `client/src/features/warehouse/composables`, reusable display helpers in `client/src/features/warehouse/lib`, request dialogs in `client/src/features/warehouse/components`, and the route page in `client/src/features/warehouse/views`. The route and sidebar use the native label `Requests`; implementation names may keep `warehouse`.

**Tech Stack:** Vue 3, Vue Router, Vitest, `@vue/test-utils`, lucide-vue-next, existing BookOrbit CSS/shadcn-style primitives, `@bookorbit/types`.

---

## Sources

- Design: `docs/superpowers/specs/2026-06-02-book-warehouse-parity-design.md`
- Request API/composables:
  - `client/src/features/warehouse/api/catalog-source.api.ts`
  - `client/src/features/warehouse/composables/useCatalogSourceRequests.ts`
  - `client/src/features/warehouse/composables/useCatalogSourceAudiobookRequests.ts`
- UI patterns:
  - `client/src/features/collection/components/CreateCollectionDialog.vue`
  - `client/src/features/collection/components/AddToCollectionSheet.vue`
  - `client/src/features/email/components/SendBookDialog.vue`
  - `client/src/components/AppSidebar.vue`
  - `client/src/router/index.ts`

## Boundaries

- No regular user-facing `Book Warehouse`, `warehouse`, `third-party`, `upstream`, `provider`, `source`, or `vendor` copy.
- Native visible copy only: Requests, Request Book, Request Audiobook, Search, Submit, Refresh, Cancel, Queue, Requested, Processing, Completed, Failed, Available.
- Do not add global search, dashboard, BookCard, BookDetail, reader, OPDS, Kobo, KOReader, collections, or scheduled sync integration in this plan.
- Do not add audiobook cancel or stream controls.
- Do not show raw request IDs, upstream IDs, upstream URLs, API keys, or implementation labels.
- Admin-only settings may keep existing catalog-source wording; this plan touches regular-user request UI only.

## Review Checkpoints

- [x] Fresh implementer subagent per task.
- [x] Spec compliance reviewer after each task.
- [x] Code quality/security reviewer after spec approval.
- [x] Controller runs verification before marking a task complete.
- [x] Final full-phase reviewer before deeper integrations.

---

## Task 1: Request UI Display Helpers

**Files:**

- Create: `client/src/features/warehouse/lib/catalog-request-ui.ts`
- Create: `client/src/features/warehouse/lib/__tests__/catalog-request-ui.spec.ts`

### Requirements

- [x] Export `REQUEST_STATUS_LABELS` mapping every `WarehouseRequestStatus` to native copy:
  - `pending` -> `Requested`
  - `processing` -> `Processing`
  - `completed` -> `Completed`
  - `failed` -> `Failed`
  - `cancelled` -> `Cancelled`
  - `unknown` -> `Requested`
- [x] Export `REQUEST_STATUS_TONE` with stable tone strings: `neutral`, `info`, `success`, `danger`, `muted`.
- [x] Export `REQUEST_MEDIA_LABELS`:
  - `ebook` -> `Book`
  - `audiobook` -> `Audiobook`
- [x] Export `formatRequestDate(value: string | null | undefined): string` that returns `Unknown` for empty/invalid dates and a short local date for valid ISO strings.
- [x] Export `requestDisplayTitle(request)` that returns safe `request.title` or `Catalog request`.
- [x] Export `requestDisplayAuthor(request)` that returns safe `request.author` or `null`.
- [x] Export `visibleRequestCopySnapshot()` returning all user-visible strings from this helper for copy-guard testing.
- [x] Helper must not include provider/source/warehouse wording in visible string values.

### Tests

- [x] Status labels map all statuses to native copy.
- [x] Media labels map media types to native copy.
- [x] Date formatting handles valid, invalid, and empty values.
- [x] Display title/author fall back safely.
- [x] Copy snapshot does not match `/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i`.

### Verification

```bash
pnpm --filter client test:unit --run src/features/warehouse/lib/__tests__/catalog-request-ui.spec.ts
pnpm --filter client type-check
```

### Commit

```bash
git add client/src/features/warehouse/lib/catalog-request-ui.ts client/src/features/warehouse/lib/__tests__/catalog-request-ui.spec.ts
git commit -m "feat: add request ui helpers"
```

---

## Task 2: Ebook Request Dialog

**Files:**

- Create: `client/src/features/warehouse/components/CatalogEbookRequestDialog.vue`
- Create: `client/src/features/warehouse/components/__tests__/CatalogEbookRequestDialog.spec.ts`

### Requirements

- [x] Props:
  - `open: boolean`
- [x] Emits:
  - `close`
  - `submitted` with `WarehouseRequestDetail`
- [x] Uses `useCatalogSourceRequests()`.
- [x] Provides a compact modal with title `Request Book`.
- [x] Supports manual ISBN request:
  - ISBN input placeholder `ISBN`
  - Submit button `Submit request`
  - trims input and disables submit while blank/saving.
  - calls `submit({ isbn })`.
- [x] Supports discovery request:
  - search input placeholder `Title, author, or ISBN`
  - button `Search`
  - calls `searchExternal(query)`.
  - lists safe result title, author, and ISBN when present.
  - each result has `Request` action that calls `submit({ searchResult: result, isbn: result.isbn })` when ISBN exists, otherwise `submit({ searchResult: result })`.
- [x] Shows native loading/error/empty states:
  - `Searching...`
  - `No matches found`
  - `Failed to search catalog`
  - `Failed to submit request`
- [x] On successful submit:
  - clears ISBN/search form state.
  - emits `submitted` with returned request.
  - emits `close`.
- [x] Closes on overlay click, close icon, and `Cancel`.
- [x] Does not expose provider/source/warehouse wording.

### Tests

- [x] Closed dialog renders nothing.
- [x] Manual ISBN submit trims and calls `submit({ isbn })`, then emits `submitted` and `close`.
- [x] Blank ISBN submit is disabled or surfaces `ISBN is required`.
- [x] Search trims query, calls `searchExternal`, and renders returned results.
- [x] Result request submits the selected search result without leaking unsupported fields into visible copy.
- [x] Search and submit failures show safe messages.
- [x] Visible component text does not match `/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i`.

### Verification

```bash
pnpm --filter client test:unit --run src/features/warehouse/components/__tests__/CatalogEbookRequestDialog.spec.ts
pnpm --filter client type-check
```

### Commit

```bash
git add client/src/features/warehouse/components/CatalogEbookRequestDialog.vue client/src/features/warehouse/components/__tests__/CatalogEbookRequestDialog.spec.ts
git commit -m "feat: add ebook request dialog"
```

---

## Task 3: Audiobook Request Dialog

**Files:**

- Create: `client/src/features/warehouse/components/CatalogAudiobookRequestDialog.vue`
- Create: `client/src/features/warehouse/components/__tests__/CatalogAudiobookRequestDialog.spec.ts`

### Requirements

- [x] Props:
  - `open: boolean`
- [x] Emits:
  - `close`
  - `submitted` with `WarehouseRequestDetail`
- [x] Uses `useCatalogSourceAudiobookRequests()`.
- [x] Provides a compact modal with title `Request Audiobook`.
- [x] Supports direct title/author request:
  - title input placeholder `Title`
  - author input placeholder `Author`
  - button `Submit request`
  - trims both fields, requires non-empty title, omits blank author.
  - calls `submit({ title, author? })`.
- [x] Supports discovery and candidate search:
  - search input placeholder `Title or author`
  - segmented buttons `Discover` and `Candidates`.
  - `Discover` calls `searchExternal(query)`.
  - `Candidates` calls `searchCandidates(query)`.
  - result `Use` action pre-fills title and author from the selected result.
  - result `Request` action submits title and optional author from the selected result.
- [x] Shows native loading/error/empty states:
  - `Searching...`
  - `No matches found`
  - `Failed to search catalog`
  - `Failed to search candidates`
  - `Failed to submit request`
- [x] On successful submit:
  - clears title/author/search state.
  - emits `submitted` with returned request.
  - emits `close`.
- [x] No cancel or stream controls.
- [x] Does not expose provider/source/warehouse wording.

### Tests

- [x] Closed dialog renders nothing.
- [x] Direct submit trims title/author and omits blank author.
- [x] Blank title submit is disabled or surfaces `Title is required`.
- [x] Discover and Candidates buttons call the correct composable functions.
- [x] `Use` pre-fills title/author from a result.
- [x] `Request` submits the selected result title/author.
- [x] Search and submit failures show safe messages.
- [x] Component has no cancel/stream actions and no provider wording in visible text.

### Verification

```bash
pnpm --filter client test:unit --run src/features/warehouse/components/__tests__/CatalogAudiobookRequestDialog.spec.ts
pnpm --filter client type-check
```

### Commit

```bash
git add client/src/features/warehouse/components/CatalogAudiobookRequestDialog.vue client/src/features/warehouse/components/__tests__/CatalogAudiobookRequestDialog.spec.ts
git commit -m "feat: add audiobook request dialog"
```

---

## Task 4: My Requests Page, Route, And Sidebar

**Files:**

- Create: `client/src/features/warehouse/views/CatalogRequestsView.vue`
- Create: `client/src/features/warehouse/views/__tests__/CatalogRequestsView.spec.ts`
- Modify: `client/src/router/index.ts`
- Modify: `client/src/router/__tests__/route-meta-title.spec.ts`
- Modify: `client/src/components/AppSidebar.vue`
- Create: `client/src/components/__tests__/AppSidebar.requests.spec.ts`

### Requirements

- [x] Add route:
  - path `/requests`
  - name `requests`
  - component `CatalogRequestsView`
  - meta title `Requests`
- [x] Add sidebar nav item:
  - label `Requests`
  - tooltip `Requests`
  - icon `Inbox` or `ListChecks`
  - active when route name is `requests`
  - visible to regular authenticated users.
- [x] Page layout:
  - heading `Requests`
  - primary actions `Request Book` and `Request Audiobook`.
  - segmented media switch: `Books`, `Audiobooks`.
  - status filter buttons: `All`, `Requested`, `Processing`, `Completed`, `Failed`, `Cancelled`.
- [x] Ebook tab:
  - uses `useCatalogSourceRequests({ page: 1, limit: 24 })`.
  - displays request title, author, media label, status label, requested date, and updated date.
  - actions: `Refresh` for each row, `Cancel` only for ebook rows with non-terminal statuses.
  - opens `CatalogEbookRequestDialog` from `Request Book`.
- [x] Audiobook tab:
  - uses `useCatalogSourceAudiobookRequests({ page: 1, limit: 24 })`.
  - displays audiobook request rows with same native labels.
  - top action `Refresh statuses`.
  - queue section titled `Queue` using `queueItems`.
  - no per-row cancel or stream action.
  - opens `CatalogAudiobookRequestDialog` from `Request Audiobook`.
- [x] Pagination:
  - show `Previous` and `Next` when total exceeds limit.
  - call the active composable `setPage`.
- [x] Empty/error states:
  - `No requests yet`
  - `No requests match this filter`
  - `Failed to load requests`
  - `Failed to load queue`
- [x] Dialog submitted events update visible rows through the composables and leave the page on the active tab.
- [x] No provider/source/warehouse wording in visible regular-user copy.

### Tests

- [x] Router test includes `/requests` with title `Requests`.
- [x] Sidebar test renders `Requests`, navigates to route `requests`, and marks it active.
- [x] Page test renders ebook rows, status labels, and cancel button only for cancellable ebook rows.
- [x] Page test renders audiobook rows, queue items, and no audiobook cancel/stream buttons.
- [x] Page test opens both dialogs and calls refresh/status/queue actions.
- [x] Page test filters rows by native status tabs and paginates through active composable.
- [x] Copy guard over `CatalogRequestsView`, both dialogs, and request helper visible string constants does not match provider wording.

### Verification

```bash
pnpm --filter client test:unit --run src/features/warehouse/views/__tests__/CatalogRequestsView.spec.ts src/components/__tests__/AppSidebar.requests.spec.ts src/router/__tests__/route-meta-title.spec.ts
pnpm --filter client type-check
pnpm --filter client lint:check
```

### Commit

```bash
git add client/src/features/warehouse/views/CatalogRequestsView.vue client/src/features/warehouse/views/__tests__/CatalogRequestsView.spec.ts client/src/router/index.ts client/src/router/__tests__/route-meta-title.spec.ts client/src/components/AppSidebar.vue client/src/components/__tests__/AppSidebar.requests.spec.ts
git commit -m "feat: add requests page"
```

---

## Task 5: Request UI Phase Verification

- [x] Run focused helper, dialog, view, sidebar, and router tests.
- [x] Run focused request composable tests.
- [x] Run repo-wide typecheck.
- [x] Run repo-wide lint.
- [x] Run visible-copy guard over new regular-user request UI files.
- [x] Dispatch final full-phase reviewer.
- [x] Update this plan and `2026-06-03-book-warehouse-request-ui.progress.txt`.

### Verification

```bash
pnpm --filter client test:unit --run src/features/warehouse/lib/__tests__/catalog-request-ui.spec.ts src/features/warehouse/components/__tests__/CatalogEbookRequestDialog.spec.ts src/features/warehouse/components/__tests__/CatalogAudiobookRequestDialog.spec.ts src/features/warehouse/views/__tests__/CatalogRequestsView.spec.ts src/components/__tests__/AppSidebar.requests.spec.ts src/router/__tests__/route-meta-title.spec.ts src/features/warehouse/composables/__tests__/useCatalogSourceRequests.spec.ts src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts
pnpm run typecheck
pnpm run lint:check
node -e "const fs=require('fs');const files=['client/src/features/warehouse/lib/catalog-request-ui.ts','client/src/features/warehouse/components/CatalogEbookRequestDialog.vue','client/src/features/warehouse/components/CatalogAudiobookRequestDialog.vue','client/src/features/warehouse/views/CatalogRequestsView.vue','client/src/components/AppSidebar.vue'];const text=files.map((file)=>fs.readFileSync(file,'utf8')).join('\\n');const visible=[...text.matchAll(/>([^<{}][^<]*)<|placeholder=\"([^\"]*)\"|title=\"([^\"]*)\"|label: '([^']*)'|tooltip=\"([^\"]*)\"/g)].map((match)=>match.slice(1).find(Boolean)).filter(Boolean).join('\\n');if(/Book Warehouse|warehouse|third-party|upstream|provider|source|vendor/i.test(visible)) throw new Error('request UI visible copy leaks provider wording');console.log('request UI visible copy check passed')"
```

If verification creates no file changes, do not commit. If generated metadata changes appear, inspect and commit only real changes.

## Status

Completed on 2026-06-03.

Implemented commits:

- `619c2223 feat: add request ui helpers`
- `aa3c194c feat: add ebook request dialog`
- `5ec9a11b feat: add audiobook request dialog`
- `2dab6b6c feat: add requests page`
- `5ebf996e fix: clean request dialog lint`
- `e4d96b53 fix: harden requests page behavior`
- 2026-06-03 extension in current parity branch: completed request rows now show a native Open item link when the public DTO contains a sanitized completed catalog item id.

Final verification:

- `pnpm --filter client test:unit --run src/features/warehouse/lib/__tests__/catalog-request-ui.spec.ts src/features/warehouse/components/__tests__/CatalogEbookRequestDialog.spec.ts src/features/warehouse/components/__tests__/CatalogAudiobookRequestDialog.spec.ts src/features/warehouse/views/__tests__/CatalogRequestsView.spec.ts src/components/__tests__/AppSidebar.requests.spec.ts src/router/__tests__/route-meta-title.spec.ts src/features/warehouse/composables/__tests__/useCatalogSourceRequests.spec.ts src/features/warehouse/composables/__tests__/useCatalogSourceAudiobookRequests.spec.ts` passed: 8 files, 72 tests.
- `pnpm --filter server exec vitest run src/modules/warehouse/warehouse-request.service.test.ts --testNamePattern "sends audiobook status notifications"` passed: 1 test, 30 skipped by pattern.
- `pnpm run typecheck` passed.
- `pnpm run lint:check` passed.
- Corrected visible-copy guard passed after stripping Vue `<script setup>` blocks before scanning rendered copy.

Review checkpoints:

- Task 1 helper spec and quality reviews passed; date-only parsing was hardened.
- Task 2 ebook dialog spec and quality reviews passed; stale async paths, no auto-load, and payload whitelisting were hardened.
- Task 3 audiobook dialog spec and quality reviews passed; no cancel/stream controls and no hidden auto-load were verified.
- Task 4 page/route/sidebar spec and quality reviews passed after hardening server-side status filters, caught action errors, lazy audiobook loading, loading states, stale tab-filter reapplication, and notification routing to `/requests`.
- Final full-phase review approved with no blocking findings.
- Completed-request link extension review caught unsafe route-id wording and modified-click interception; both were fixed before full verification.

Residual risk:

- The server public-text sanitizer intentionally blocks implementation words broadly. This protects the provider-hiding requirement, but a follow-up product decision/test should decide whether legitimate book titles containing words such as `warehouse`, `source`, `provider`, or `vendor` should display unchanged.

---

## After This Phase

Next phases should be separate plans:

1. Scheduled request status sync jobs and completion mapping to synced catalog items.
2. Cached cover storage and refresh policies for ebook/audiobook catalog items.
3. Source-backed item integration into native library/search/dashboard/reader surfaces.
