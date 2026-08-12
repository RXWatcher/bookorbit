# ABS warehouse backing: implementation plan

**Problem.** Upstream PR #728's ABS adapter reads only the native `books`/`libraries` tables. On
CT139 those hold 0 rows; all 410,121 items live in `warehouse_catalog_items`. So an ABS client
logs in successfully and sees an empty server.

Two independent causes, both confirmed on the live box:

1. `abs-libraries.controller.ts:35` calls `libraryService.findAll(user)` without
   `{ includeSourceBacked: true }`, so the three virtual warehouse libraries never appear.
2. All 20 methods of `AbsReadRepository` query native tables. The ABS module has zero warehouse
   awareness (`grep -r warehouse server/src/modules/abs` returns nothing).

**Goal.** Browse, search, and play warehouse content from ABS clients: 61,422 items with a
`local_path` stream from disk, the remaining ~348,699 proxy to the upstream source.

## What already exists (do not rebuild)

`WarehouseCatalogService` already covers nearly everything:

| Need                           | Existing method                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| Paged/sorted/filtered browse   | `queryLibraryItems(user, mediaType, query)`                         |
| Search                         | `searchCatalogItems`                                                |
| Single item + access check     | `findAccessibleCatalogItemById`                                     |
| Batch by id                    | `getCatalogItemsByRemoteIds`                                        |
| Authors                        | `listAuthorSummaryPage`, `listAuthorItems`, `findAuthorSummaryById` |
| Series                         | `listSeriesSummaryPage`, `listSeriesItems`                          |
| Audio streaming (remote proxy) | `streamAudiobook`, `downloadAudiobook`, `downloadAudiobookFile`     |
| Local file bytes               | `localBinary`                                                       |
| Covers                         | `getAudiobookCover`, `getEbookCover`, `getComicCover`               |
| Library counts                 | `getUserLibraryOverview`                                            |

So this is an adapter, not a rewrite. The remote proxy is already built and in production use by
the web UI.

## Design

**Route by library id sign.** Virtual warehouse libraries are `-1/-2/-3`
(`CLOUD_EBOOK_LIBRARY_ID` etc.); native libraries are positive. A negative library id means
warehouse, positive means native. This supports a mixed deployment rather than an either/or mode.

**Reuse the existing negative-id convention; do not invent one.** The app already represents
warehouse catalog items as negative synthetic book ids via `encodeWarehouseBookId(mediaType, id)`
in `warehouse-book-card.mapper.ts`, blocked by media-type ordinal and reversed by
`decodeWarehouseBookId`. The web UI uses this throughout. ABS must use the same scheme, so
dispatch is uniformly by id sign for both libraries and items, and no new id space appears.

**Blocker fixed first:** `decodeAbsId` required `/^\d+$/` and `id > 0`, so it could not round-trip
either the negative virtual library ids or the negative warehouse item ids. Widened to
`/^-?\d+$/` with `id !== 0`, with tests proving `lib_-1` and a `encodeWarehouseBookId` value both
round-trip, and that `lib_0`, `lib_-0`, `lib_-1.5` and `lib_--1` stay rejected.

**Keep the existing controllers, services and mappers.** Introduce
`AbsWarehouseReadRepository` returning the _same_ shapes the native repo returns
(`AbsItemRow`, `AbsItemRelations`, `AbsAudioFileRow`), and an `AbsSourceRepository` facade that
dispatches per call by library id sign / id prefix. Everything downstream of the repository is
already tested and stays untouched.

## Task sequence

Each task leaves the tree green and is committed separately.

### Task 1: id codec + library list

- Widen `decodeAbsId` for negative ids; add `warehouseItem` prefix. Tests for both.
- `abs-libraries.controller.ts`: pass `{ includeSourceBacked: true }` to `findAll`.
- `assertLibraryAccess`: treat negative (source-backed) library ids as accessible when the catalog
  is enabled, since `findAccessibleLibraryIds` only knows native libraries.
- Verify: an ABS client lists three libraries with correct counts.

### Task 2: warehouse-backed browse

- `AbsWarehouseReadRepository.listItems/countItems` delegating to `queryLibraryItems`, mapping
  `DashboardCatalogItem` to `AbsItemRow`, and `mediaType` from the library id.
- `findItem`, `findItemsByIds` via `findAccessibleCatalogItemById` / `getCatalogItemsByRemoteIds`.
- Relations: authors from `warehouse_catalog_item_authors`; narrators/series from the item row.
- `AbsSourceRepository` facade dispatching by id prefix and library id.
- Verify: client browses, paginates and opens an item.

### Task 3: search, authors, series

- `searchItems` -> `searchCatalogItems`; `authorsInLibrary` -> `listAuthorSummaryPage`;
  `seriesInLibrary` -> `listSeriesSummaryPage`; `findAuthor`, `bookIdsForAuthor`.
- `collectionsForUser` returns `[]` (warehouse has no ABS-shaped collections yet).
- `filterData` from the warehouse dimension helpers.

### Task 4: playback

- `audioFilesByBookId` synthesises one `AbsAudioFileRow` per warehouse audiobook. `absolutePath`
  is meaningless for remote items, so carry a source discriminator instead and resolve bytes in
  the stream layer.
- `AbsStreamService`/`getItemFile`: `local_path` present -> stream from disk (`localBinary`);
  otherwise proxy via `streamAudiobook` preserving Range headers.
- Covers: route `/api/items/:id/cover` to the warehouse cover cache for `wi_` ids.
- Verify on the live box with a real ABS client: play, seek, and resume.

## Verification gates

Per repo rules: `pnpm run lint:check`, both typechecks, both test suites before each commit.
Deploy per `bookorbit-ct139-instance` memory, remembering `.env` `APP_IMAGE` decides what runs and
compose output is not proof.
