# Unified library: Book Warehouse plus local filesystem, and magazines

Date: 2026-08-10
Status: Approved design, not yet planned

## Problem

BookOrbit currently presents three virtual libraries (Books, Audiobooks, Comics) built by
`LibraryService.getSourceBackedLibraries()`. They are backed entirely by
`warehouse_catalog_items`, which is a synced mirror of the Book Warehouse API. The native
`libraries` and `books` tables exist but hold zero rows on the production instance.

The Book Warehouse ingests from a CephFS share that BookOrbit can also see. That share holds
a substantial amount of content the warehouse never indexed, so the libraries in BookOrbit are
an incomplete view of what actually exists.

### Measured gap

Measured on CT139 against the live catalogue on 2026-08-10.

| Media | Source path (under `/mnt/sharedrives/zd-storage-ceph-books`) | On disk, absent from warehouse | In warehouse, absent from disk |
| --- | --- | --- | --- |
| ebook | `ebooks/Books_English` | 7,108 | 25 |
| audiobook | `audiobooks/Audiobooks_English` | 58,102 | 452 |
| comic | `comics/English` | about 7 | 0 |
| magazine | `magazines/Magazines_English` | about 74,400 (all of it) | not applicable |

Roughly 139,600 items are invisible in BookOrbit today. The 477 reverse cases are catalogue rows
whose files have moved or been deleted.

## Goals

1. Each media type is presented as ONE library that merges warehouse content and local
   filesystem content, deduplicated, so a title present in both appears once.
2. Magazines become a first class media type, sourced entirely from the filesystem.
3. Local items are fully usable: readable, downloadable, and available over OPDS and Kobo.

## Non-goals

- Changing Book Warehouse itself. BookOrbit is the union layer.
- Indexing the whole share. Only the four paths above are in scope. Directories such as
  `AI_deleted_books`, `*_Duplicates`, `*_backup`, `incoming`, `temp` and `Unsorted` are excluded.
- Writing to the share. It is mounted read only and stays that way.

## Key finding that shapes the design

`ebooks/Books_English` is not a separate collection. It IS the Calibre library the warehouse
ingests from. A catalogue row's `raw_payload.calibre_path` (for example
`Diana Xarissa/Joy and Jealousy (17937)`) resolves exactly as a directory on the share.
Audiobooks carry the equivalent in `raw_payload.files[].storage_key`, an absolute path under
`/media/zd-storage-ceph-books/...` that maps onto `/mnt/sharedrives/zd-storage-ceph-books/...`.

Deduplication is therefore an exact key join for ebooks and audiobooks, not fuzzy matching.
Filename matching is useless and must not be used: the warehouse stores
`Author/Series/NN - Title.epub` while Calibre stores `Title - Author.epub`, and a whole-share
filename comparison found only 10 names in common out of 698,013.

## Design

### Storage

Add a `source` column to `warehouse_catalog_items`, typed as a new pg enum
`catalog_item_source` with values `warehouse` and `local`, defaulting to `warehouse`.

Local rows use a namespaced identifier: `remote_id = 'local:' || sha256(absolute_path)`.

This choice keeps every local item inside the table that already carries about 20 tuned indexes,
the pagination, the sorting, the trigram search, collections, achievements and statistics.
There is no second table, no query time union, and no in memory merging, which matters because
`CLAUDE.md` forbids unbounded queries and client side processing over full result sets.
Deduplication is enforced structurally by the existing
`warehouse_catalog_items_media_remote_unique` constraint on `(media_type, remote_id)`.

This is safe because the sync is upsert only. `WarehouseRepository` inserts catalogue items with
`onConflictDoUpdate` on `(media_type, remote_id)` and there is no delete, prune, or
`notInArray` cleanup of `warehouse_catalog_items` anywhere in the codebase. A warehouse sync
cannot remove local rows. A test must lock this property in place, because a future prune would
silently destroy local content.

### New column for path resolution

Local rows need their file location. Add `local_path` (text, nullable), holding the absolute
path on the mount. It is null for warehouse rows and required for local rows, enforced with a
check constraint: `source = 'local'` implies `local_path is not null`.

### Scanning and matching

A new module `server/src/modules/local-scan/` owns discovery. It walks each configured root,
builds the media specific key, and inserts only unmatched items.

Matching strategy per media type, behind a `LocalMatchStrategy` interface so each rule is
independently testable:

| Media | Key on the catalogue side | Key on the disk side |
| --- | --- | --- |
| ebook | `raw_payload.calibre_path` | book directory relative to `Books_English` |
| audiobook | `raw_payload.files[].storage_key`, prefix rewritten | book directory relative to `Audiobooks_English` |
| comic | `title` plus `issueNumber` | `.cbz` filename, parsed |
| magazine | none, the warehouse has no magazine concept | every file is local |

Comics are the weak case. Their payload is only
`{id, title, language, seriesId, publisher, issueNumber}` with no path and no hash, so the match
is heuristic. The population is tiny (4,831 on disk against 4,824 catalogued), so the risk is a
handful of duplicates rather than a systemic problem. Any comic that fails to match is inserted
as local and flagged for review rather than silently merged.

Excluded directory patterns are configuration, not hardcoded, and default to the list in
Non-goals. Calibre internals `.caltrash/` and `.calnotes/` are always excluded.

### Magazines

Magazines require:

1. `magazine` added to `warehouseMediaTypeEnum`.
2. A fourth entry in `getSourceBackedLibraries()` with its own icon, `displayOrder`, and a
   `coverAspectRatio` suited to periodicals.
3. A fourth key in `WarehouseSourceBackedLibraryIcons`, which is
   `Record<WarehouseMediaType, string>` and so fails to typecheck until updated. That is the
   desired behaviour: the compiler will enumerate the call sites that need attention.

The magazines tree is organised by year (`2004`, `2005`, and so on), not by author or series, and
is 73,137 pdf, 918 cbr and 346 cbz. Model publication title as `series` and issue as
`series_index`, leaving `authors` empty.

Migration ordering constraint: PostgreSQL will not accept a new enum value and a statement that
uses that value in the same transaction. The enum addition and its first use must therefore be
two separate Drizzle migrations. Per `CLAUDE.md`, both are generated with `pnpm db:generate`
from schema edits and never hand written.

### Content serving

This is the largest and riskiest part of the work, and it is not the row inserts.

Every content path currently resolves bytes through `warehouse-client.service`. A local item has
no warehouse to fetch from, so each path needs a branch on `source`:

- reader (epub, pdf, cbz)
- download
- OPDS
- Kobo sync
- cover cache (`warehouse-catalog-cover-cache.service`)

The branch belongs behind a single `CatalogContentResolver` that takes a catalogue row and
returns a stream, so the `source` check exists in exactly one place rather than five. Local
resolution reads from `local_path` and must reject any path that escapes the configured roots
after normalisation, since `local_path` reaches the filesystem layer.

Consequence to accept deliberately: the mount becomes a hard runtime dependency for local items.
If `/mnt/sharedrives` is unavailable, local items fail while warehouse items keep working. The
resolver returns a clear error for that case rather than a generic 500.

## Data flow

1. Operator configures roots per media type and triggers a scan, or a cron does.
2. `local-scan` walks a root, batching directory entries rather than loading the tree.
3. For each candidate it builds the media specific key and looks it up against existing
   catalogue keys, loaded once per run into a set.
4. Unmatched candidates are inserted with `source = 'local'`, `remote_id = 'local:<sha256>'`,
   and `local_path`.
5. Library queries are unchanged, because local rows live in the table they already read.
6. Content requests route through `CatalogContentResolver`, which branches on `source`.

## Testing

- Unit tests per match strategy, including the known traps: filename matching must not be used,
  the `/media/` to `/mnt/sharedrives/` rewrite, and `.caltrash` and `.calnotes` exclusion.
- A regression test asserting the sync performs no delete against `warehouse_catalog_items`,
  protecting local rows.
- A path traversal test on `local_path` resolution.
- Scanner tests over a fixture tree covering all four media types, asserting that an item present
  in both the fixture catalogue and the fixture tree yields exactly one row.
- Migration test covering the two step enum change.

## Risks

| Risk | Mitigation |
| --- | --- |
| A future warehouse sync gains a prune and deletes local rows | Regression test on the no delete property, plus scope any future prune to `source = 'warehouse'` |
| Comic heuristic creates duplicates | Population is about 4,831; unmatched comics are flagged, not silently merged |
| Scale: about 139,600 new rows and a 1.5M file walk | Batched inserts, streamed directory walking, resumable runs with progress logging per the logging conventions |
| Mount unavailability breaks local items | Explicit error from the resolver, warehouse items unaffected |
| Path traversal through `local_path` | Normalise and confine to configured roots before any read |

## Open questions

None blocking. The comic matching heuristic is the weakest element and may need revisiting once
real duplicate counts are observed.
