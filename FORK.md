# BookOrbit fork — what our copy does differently

Written 2026-08-05. This fork does **not** run the published
`ghcr.io/bookorbit/bookorbit` image. It runs a locally built image, from a
source snapshot rather than a clone. This file records how that source differs
from upstream, because nothing else in the tree says so.

## Provenance

|                  |                                                   |
| ---------------- | ------------------------------------------------- |
| Upstream project | https://github.com/bookorbit/bookorbit            |
| Our base         | **v2.3.0** (released 2026-07-18)                  |
| Source           | `book-orbit-main.zip`, downloaded 2026-07-30      |
| Git history      | **none** — the zip is a plain snapshot, no `.git` |

The base was identified by diffing the snapshot against every plausible upstream
ref and taking the closest match. v2.3.0 differs by 322 entries; the next best
candidate differs by 900+. That gap is decisive, so v2.3.0 is the base.

Note the snapshot is named `-main` but does **not** match upstream `main` as of
its download date — upstream `main` had already moved past v2.3.0 by 2026-07-28.
Either it came from a fork whose `main` sat at v2.3.0, or it was taken from the
tag. Worth resolving if the origin ever matters.

## What we added: Book Warehouse

The bulk of the delta is one coherent feature that **does not exist upstream**.
Verified against a clean checkout of upstream `main` (88c42123): no
`warehouse-migrations` directory, one incidental use of the word "warehouse" in
the entire tree, and no warehouse keys in `.env.example`.

Ours, by contrast:

- **16 dedicated migrations**, `server/src/db/warehouse-migrations/0032`–`0047`,
  entirely separate from the app's own migration chain
- **229 source files** referencing warehouse
- **54 planning documents** under `docs/superpowers/plans/`
- **`progress.txt`** — a dated build log running from 2026-06-03

What it covers, read off the migrations and plan documents:

- Catalog of ebooks and audiobooks sourced from an external warehouse API
- Request flows for both media types, with completed-request linking
- Cover caching and download/cover proxying
- Kobo and KOReader catalog bridges; Audiobookshelf compatibility mapping
- Reading sessions, bookmarks, annotations, resume/playback progress
- Admin cache status/clear UI
- Catalog discovery, genres, recommendations, dashboard integration

It is wired in through config rather than hardcoded:
`APP_WAREHOUSE_ENABLED`, `APP_WAREHOUSE_BASE_URL`, `APP_WAREHOUSE_API_KEY`,
`WAREHOUSE_ENCRYPTION_KEY`. `WAREHOUSE_ENCRYPTION_KEY` must be set before
warehouse/catalog API keys can be saved.

Other local additions: `.gitlab-ci.yml` (+341 lines) and the
`docs/superpowers/` tree (+7,976 lines).

## Build deviation — read this before rebuilding

The image was **not** built from the Dockerfile as shipped. Upstream's
Dockerfile runs `pnpm install --frozen-lockfile`, which fails against this snapshot:

```
ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY  Broken lockfile:
no entry for 'ajv-keywords@3.5.2(ajv@6.15.0)' in pnpm-lock.yaml
```

`pnpm-lock.yaml` is out of sync with `package.json` — the signature of editing
dependencies without regenerating the lockfile. To get a build, the Dockerfile
was patched to `--no-frozen-lockfile`. The original is preserved alongside it as
`Dockerfile.orig`.

**Consequence:** dependency versions are no longer pinned. This build resolved
transitive dependencies fresh and may not match what upstream intended. If the
frontend misbehaves in ways the code doesn't explain, suspect this first. The
real fix is to regenerate the lockfile in the source and restore
`--frozen-lockfile`.

## Cost of updating

Measured, not estimated — by committing our snapshot onto v2.3.0 and dry-running
a merge of upstream `main`:

|                                      |        |
| ------------------------------------ | ------ |
| Files we changed vs v2.3.0           | 516    |
| Files upstream changed v2.3.0 → main | 922    |
| Files touched by both                | 87     |
| **Files that actually conflict**     | **28** |

28 conflicts is real work but tractable. They cluster in the places Book
Warehouse hooks into core services:

- `server/src` (16) — authors, series, book, dashboard, kobo, koreader, opds,
  recommendation, smart-scope services; `scripts/migrate.ts`
- `client/src` (8) — `AppSidebar.vue`, `ViewHeader.vue`, `router/index.ts`,
  book table/filter components, CBZ reader
- `packages/types` (2) — `book.ts`, `notification.ts`
- plus `README.md` and an e2e route manifest

`server/src/scripts/migrate.ts` deserves care: we run a second migration chain
and upstream has been changing migration handling.

## Updating: the procedure

There is no upgrade path via image pull — the published image does not contain
Book Warehouse. Updating means merging upstream into our source:

1. `git clone https://github.com/bookorbit/bookorbit.git`
2. `git checkout -B fork v2.3.0` and overlay the deployment source onto it, then
   commit (use `--no-verify`; the husky pre-commit hook rejects the snapshot)
3. `git merge origin/main` and resolve the 28 conflicts, keeping warehouse
   integration points intact
4. Regenerate `pnpm-lock.yaml` so `--frozen-lockfile` works again
5. Rebuild: `docker build -t bookorbit:custom .`
6. `docker compose up -d` in the deployment source directory

**Back up the database first.** The warehouse migration chain is ours; an
upstream migration change could interact with it badly, and 0032–0047 have no
upstream counterpart to fall back on.

# Merge log — 2026-08-05: upstream `main` (v2.4.0-era) merged in

Merged upstream `main` (88c42123) into the v2.3.0-based fork, preserving Book
Warehouse. 28 conflicts.

## How conflicts were resolved

| Approach                                        | Count |
| ----------------------------------------------- | ----- |
| Kept both sides (each added something distinct) | 12    |
| Took ours (warehouse-critical)                  | 8     |
| Took upstream (dead or refactored code)         | 6     |
| Hand-merged                                     | 2     |

## Two files needed rebuilding, not patching

`opds-book.service.ts` and `dashboard.service.ts` could not be resolved
hunk-by-hunk. Upstream refactored both, and the surrounding auto-merged code
already spoke upstream's API — so keeping our version left callers referencing
methods that no longer existed (`paginatedBookQuery`, `resolveSeriesFilter`,
`getScrollerBookIds`, `getSmartScopeBookIds`). The first build failed on exactly
that.

Both were rebuilt with upstream as the base:

- **opds-book.service.ts** — kept upstream's 7 new methods; swapped in our 7
  warehouse-aware overrides (`constructor`, `getBooksPage`, `getRandomBooks`,
  `getDistinctAuthors`, `getDistinctSeries`, `getUserCollections`,
  `getAccessibleLibraries`); grafted our 19 warehouse-only methods.
- **dashboard.service.ts** — kept upstream's `getScrollerBookIds`,
  `getSmartScopeBookIds`, `findScrollerBookIds`, `assertSmartScopeId` (the
  koreader catalog service calls these); swapped in our `constructor`,
  `getScroller`, `loadCardsByIds`; grafted our 6 catalog scrollers.

**If you merge upstream again, expect these two files to need the same
treatment.** They are where Book Warehouse binds most tightly to core services.

## Deliberate losses

- **`AppSidebar.vue` — upstream's sidebar restructuring was discarded** in
  favour of ours, which carries the catalog/library navigation. The most
  visible user-facing regression from this merge.
- **`smart-scope.service.ts` took upstream's refactor**, so its `bookService.
globalQuery` calls became `bookReadService.countWhere` /
  `executeBooksQuery`. `BookReadService` had to be added to the constructor.

## Notification categories

Upstream replaced `NOTIFICATION_CATEGORY_LABELS` with i18n keys. Our
`catalogRequests` category had no translation and would have rendered as a raw
key; an `en.json` entry was added. **The other locales (es, fr, it, pl) still
lack it** and will show the raw key until translated.

## Traps hit (worth knowing before the next merge)

Git conflicts here routinely place two _different_ methods against each other,
with the closing brace as shared trailing context. Naively keeping both sides
nests one method inside the other — it compiles as far as brace counting goes
but is structurally wrong. It happened in `series.repository.ts` (caught by
inspection) and again in `opds-book.service.ts` (caught only by the build).

Check after any resolution:

1. no conflict markers
2. brace balance zero
3. **every `this.x()` call resolves to a definition in the file**
4. no duplicate module imports

Item 3 is the one that catches the nesting bug. Brace balance alone does not.
