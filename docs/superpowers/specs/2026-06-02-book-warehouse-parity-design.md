# Book Warehouse Parity Design

Date: 2026-06-02

## Status

Approved direction: build full Book Warehouse parity in BookOrbit.

The parity boundary is the public user-level Book Warehouse API documented at https://wiki-bookwarehouse.zenterprise.org. Grimmory's warehouse work is an implementation reference for caching, materialization, request status sync, reader integration, and performance behavior, but Grimmory's internal `/api/v1/warehouse/...` routes are not upstream Book Warehouse endpoints.

## Source Contract

Book Warehouse exposes a REST API under `/api/v1`, with `/health` at the root. Requests authenticate with `X-API-Key`; the `api_key` query fallback exists upstream but BookOrbit should not use it because query keys can be logged.

BookOrbit must support these upstream user-key capabilities:

- Ebooks: `GET /books`, `GET /books/search`, `GET /books/{id}`, `GET /books/{id}/download`, and `GET /books/{id}/cover/{size}`.
- Ebook filters: `author`, `title`, `format`, `genre`, `series`, `language`, `publisher`, `tag`, `has_cover`, `enriched`, `calibre_enriched`, `min_rating`, `max_rating`, `calibre_id`, `sort`, and `order`.
- Audiobooks: `GET /audiobooks`, `GET /audiobooks/search`, `GET /audiobooks/{id}`, `GET /audiobooks/{id}/stream`, `GET /audiobooks/{id}/cover`, `GET /audiobooks/{id}/download`, and `GET /audiobooks/{id}/files/{file_id}/download`.
- Audiobook browse dimensions: `GET /audiobooks/authors`, `GET /audiobooks/authors/{id}`, `GET /audiobooks/series`, `GET /audiobooks/series/{id}`, and `GET /audiobooks/narrators`.
- Genres: `GET /genres` and `GET /genres/{id}/books`.
- External discovery: `GET /search/external`, `GET /audiobooks/search/external`, and `GET /audiobooks/abiplayer/search`.
- Ebook requests: `POST /monitoring/add`, `GET /monitoring`, `GET /monitoring/{id}`, `GET /monitoring/{id}/stream`, and `DELETE /monitoring/{id}`.
- Audiobook requests: `POST /audiobooks/abiplayer/requests`, `GET /audiobooks/abiplayer/requests`, and `GET /audiobooks/abiplayer/queue`.
- Comics: `GET /comics/items`, `GET /comics/items/{id}`, `GET /comics/items/{id}/download`, `GET /comics/items/{id}/pages`, `GET /comics/items/{id}/pages/{page}`, `GET /comics/series`, `GET /comics/series/search`, `GET /comics/series/{id}/items`, `POST /comics/requests`, and `GET /comics/requests`.
- Errors: upstream failures return JSON with an `error` field and standard HTTP status codes. BookOrbit should preserve the meaning while mapping responses to local API error conventions.

Book Warehouse paginated lists use one-based `page` and `limit`; documented limits max at 100. Search endpoints take `q`; audiobook request list accepts optional `status` and `limit`.

## Goals

BookOrbit should use Book Warehouse as an invisible backend catalog/acquisition source while making the experience feel native to BookOrbit:

- Admins can configure the upstream connection without exposing secrets in logs, committed files, browser URLs, or screenshots.
- Regular users can browse and search synced ebooks and audiobooks from BookOrbit surfaces without knowing a third-party warehouse exists.
- Users can request missing ebooks and audiobooks, track status, and cancel ebook monitoring requests where upstream allows it.
- 2026-06-04 implementation note: completed request actions now open source-backed titles through native Ebook Library and Audio Library item detail URLs (`/library/ebooks/items/:remoteId` and `/library/audiobooks/items/:remoteId`) while preserving legacy catalog and negative-id detail routes as compatibility.
- 2026-06-04 implementation note: dashboard Library Overview navigation treats source-backed Ebook Library and Audio Library rows as normal libraries when choosing the Books destination.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now carry publisher metadata through native library query results so normal publisher sorting works across filesystem and source-backed libraries.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now carry per-user rating metadata through native library query results so normal rating sorting works across filesystem and source-backed libraries.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now carry per-user read-progress metadata through native library query results so normal read-progress sorting works across filesystem and source-backed libraries.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now carry per-user last-read activity through native library query results so normal last-read sorting works across filesystem and source-backed libraries.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now carry per-user finished-date metadata through native library query results so normal finished-date sorting works across filesystem and source-backed libraries.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now carry per-user read-status metadata through native library query results and Smart Scope mixed-result sorting so normal read-status sorting works across filesystem and source-backed libraries.
- 2026-06-04 implementation note: Smart Scope mixed-result sorting now uses source-backed publisher metadata the same way as filesystem books, preserving publisher sort parity after the client combines local and source-backed results.
- 2026-06-04 implementation note: Smart Scope mixed-result sorting now uses source-backed per-user ratings the same way as filesystem books, preserving rating sort parity after the client combines local and source-backed results.
- 2026-06-04 implementation note: Smart Scope mixed-result sorting now uses source-backed read-progress metadata the same way as filesystem books, preserving progress sort parity after the client combines local and source-backed results.
- 2026-06-04 implementation note: Smart Scope mixed-result sorting now uses source-backed last-read activity the same way as filesystem books, preserving last-read sort parity after the client combines local and source-backed results.
- 2026-06-04 implementation note: Smart Scope mixed-result sorting now uses source-backed finished-date metadata the same way as filesystem books, preserving finished-date sort parity after the client combines local and source-backed results.
- 2026-06-04 implementation note: Smart Scope mixed-result sorting now uses source-backed series index metadata the same way as filesystem books, preserving series-index sort parity after the client combines local and source-backed results.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now derive publication years from cached source metadata for native library queries and Smart Scope mixed-result sorting, preserving published-year sort parity without adding schema.
- 2026-06-04 implementation note: source-backed Ebook Library and Audio Library items now derive page counts from cached source metadata or audiobook duration for native library queries and Smart Scope mixed-result sorting, preserving page-count sort parity without adding schema.
- Synced catalog items can participate in dashboards, collections, smart scopes, metadata views, readers, progress, favorites, ratings, and device integrations where BookOrbit can serve them safely.
- Hot user-facing browse, search, dashboard, and device paths use local SQL-backed data, not live upstream calls.
- Live upstream calls remain reserved for sync, external discovery, request mutations/status, streaming/download, covers/detail refresh, health checks, and repair.

## Product Visibility

End users should not see Book Warehouse, `warehouse`, remote-source, or upstream API terminology in normal product surfaces. This should feel like BookOrbit has a larger native catalog and request system, similar to Grimmory's user experience.

- 2026-06-05 implementation note: notification preferences now label request completion/failure notifications as `Library Requests` while preserving the existing `catalogRequests` preference key and notification type values for compatibility.

User-visible naming should use BookOrbit-native concepts:

- Catalog, Library, Discover, Requests, Available, Processing, Requested, Completed, Failed, Download, Read, Listen.
- "External search" may be described as discovery for missing books/audiobooks, but should not expose provider implementation details.
- Completed upstream items should appear as normal BookOrbit catalog items with availability/readiness states, not as third-party records.

Book Warehouse terminology is acceptable only in admin-only integration settings, logs, internal code/module names, database tables, developer docs, and troubleshooting details.

## Non-Goals

- Do not implement Book Warehouse operator/admin capabilities that are not available to user-level keys.
- Do not invent upstream endpoints, request parameters, or body fields beyond the wiki contract.
- Do not expose unsynced catalog-source items in global search, dashboard, Kobo, KOReader, OPDS, or ABS-style surfaces until BookOrbit can authorize, represent, and serve them locally.
- Do not store the upstream API key in client-side state or return it from API responses.
- Do not add a regular user-facing "Warehouse" page, badge, tab, route, or source label.

## Architecture

Add a first-class internal `warehouse` server module and matching Vue feature area. These are implementation names; user-facing route labels and copy should use native BookOrbit concepts.

Server modules:

- `warehouse-settings`: stores encrypted base URL, API key, enablement, sync cadence, and feature flags.
- `warehouse-client`: typed upstream REST client with `X-API-Key`, bounded pagination, timeout, retry/backoff for transient failures, and error normalization.
- `warehouse-catalog`: syncs ebook and audiobook catalog pages, details, covers, genres, authors, narrators, series, and search text into local tables.
- `warehouse-requests`: manages ebook monitoring requests, audiobook acquisition requests, status sync, SSE fanout for ebook monitoring, and user-visible request history.
- `warehouse-library`: maps source-backed items to BookOrbit user ownership, local collections, shelves, smart scopes, favorites, ratings, read status, and progress.
- `warehouse-content`: streams/proxies ebook downloads, audiobook streams/downloads, single-file audiobook downloads, and covers with safe header handling.
- `warehouse-admin`: exposes cache status, manual refresh, clear/rebuild, repair, telemetry, and health-check actions to authorized admins. 2026-06-03 implementation note: admin integration settings now show aggregate cover-cache status, can clear cached covers using native admin copy, poll running catalog sync counts while manual sync requests are in flight, and recover stale interrupted database-running sync rows after owner/progress metadata ages out. Catalog page syncs use a longer batch-job request timeout, retry transient page fetch failures, and persist page/attempt timing metadata for slow source pages.

Shared types:

- Add `packages/types/src/warehouse.ts` for Book Warehouse DTOs, local cache DTOs, request DTOs, status enums, progress payloads, and UI query/result contracts.
- Keep upstream DTO names distinct from local BookOrbit DTO names so mappers make boundary changes obvious.

Client features:

- Add `client/src/features/warehouse` with API methods, composables, request dialogs, cache/admin panels, and detail integrations. Public page titles, nav entries, and action labels must avoid "warehouse" language for regular users.
- Reuse existing BookOrbit layout, filters, display settings, cover, audiobook reader, notifications, and settings patterns.

## Data Model

Add Drizzle schema and migrations for:

- `warehouse_settings`: one active connection profile for now, designed to allow future multi-profile support.
- `warehouse_catalog_items`: canonical synced source item rows for ebooks and audiobooks, including `remote_id`, `media_type`, title, subtitle, authors, narrators, series, genres, tags, language, publisher, identifiers, format, dates, ratings, cover availability, upstream timestamps, and raw payload.
- `warehouse_catalog_details`: cached full detail payloads keyed by `media_type` and `remote_id`.
- `warehouse_audiobook_files` and `warehouse_audiobook_chapters`: normalized detail data needed for streaming, ABS-style mapping, and reader UI.
- `warehouse_catalog_dimensions`: derived author, narrator, series, genre, tag, publisher, and language facets.
- `warehouse_catalog_search`: normalized search text and sort keys for local browse/search.
- `warehouse_catalog_sync_runs`: sync metadata, counts, timings, error summaries, and freshness state.
- `warehouse_user_items`: local user ownership/library membership for synced source items.
- `warehouse_user_state`: favorite, rating, read status, last read/listened time, ebook progress, audiobook progress, Kobo/KOReader progress bridges, and source timestamps.
- `warehouse_requests`: local mirror of ebook monitoring and audiobook request records, including upstream request ID, media type, status, status reason, requested payload, completed source item ID, and user ID.
- `warehouse_reading_sessions`, `warehouse_bookmarks`, `warehouse_annotations`, `warehouse_reviews`, and `warehouse_reader_preferences`: local reader state for source-backed items where BookOrbit does not already have a compatible generic table.

Indexes must support:

- `(media_type, remote_id)` uniqueness.
- Search by normalized title/authors/series/narrators/identifiers/tags/genres.
- Facets by media type and dimension.
- Newest-first, added-date, title, author, series, language, publisher, format, rating, progress, favorite, and read-status sorts.
- Permission-filtered user item joins.
- Request queries by `user_id`, `media_type`, `status`, and upstream request ID.

## Sync And Caching

BookOrbit should run sync in two modes:

- Full refresh: page through `/books` and `/audiobooks` with `limit=100`, upsert catalog rows, refresh derived indexes, and record a sync run.
- Incremental repair/detail refresh: fetch details and covers for specific remote IDs when a detail page, reader, download, or repair action needs fresher data.

Sync rules:

- Never request undocumented filters during sync.
- Preserve unknown upstream fields in raw JSON payload columns for forward compatibility.
- Keep media type explicit in every cache row, derived table, and DTO.
- Treat upstream pages, detail responses, and request-list wrappers tolerantly, because Grimmory found wrapper shapes can vary.
- Prefer local detail cache for detail pages and dashboard surfaces; refresh in the background when stale.
- Add bounded concurrency for catalog page/detail/cover refreshes.
- Keep cache invalidation explicit through admin actions and scheduled freshness checks.

## Request System

Ebook requests:

- Users can search external books with `/search/external`.
- Users can submit a request by ISBN, optional `preferred_format`, or a whole `search_result` object.
- BookOrbit stores the submitted payload and upstream monitoring ID.
- BookOrbit mirrors upstream monitoring status with scheduled sync and on-demand refresh.
- BookOrbit supports cancellation with upstream `DELETE /monitoring/{id}`.
- BookOrbit can proxy or consume upstream SSE `/monitoring/{id}/stream` to update local state and UI progress.

Audiobook requests:

- Users can search Audible discovery with `/audiobooks/search/external` and AudiobookBay candidates with `/audiobooks/abiplayer/search`.
- Users can submit only `title` and optional `author`; title is required.
- BookOrbit mirrors request status through `/audiobooks/abiplayer/requests` and shows active queue state from `/audiobooks/abiplayer/queue`.
- There is no per-request stream or cancel endpoint for audiobooks; the UI must not imply those actions exist.

Comic requests:

- 2026-06-10 implementation note: BookOrbit now mirrors comic request status through the normal request sync job using `/comics/requests`, updates only existing local mirrors, sends native request completion/failure notifications, blocks `/media/` and `ceph://` path leaks from synced request metadata, and triggers at most one Comic Library catalog sync when completed comic IDs are missing locally.
- 2026-06-10 implementation note: the Requests view now exposes completed comic requests through a native Comics tab backed by `/catalog/requests/comics`; comic request submission uses the documented normal-user `/catalog/requests/comics` route with only supported fields, and completed comic quick details identify completed items as `Comic Library` instead of falling back to Ebook Library labels.
- 2026-06-11 implementation note: normal-user comic parity is limited to read/download/page/request capabilities through native BookOrbit routes; admin/system ingestion endpoints such as import scans remain outside user surfaces.
- 2026-06-11 implementation note: BookOrbit now also exposes normal-user Book Warehouse-compatible `/api/v1/comics/items`, `/api/v1/comics/items/:id/pages`, `/api/v1/comics/items/:id/download`, `/api/v1/comics/series`, and `/api/v1/comics/requests` aliases. These delegate to the same cached Comic Library read/download/request services and do not expose admin import routes.
  - 2026-06-11 implementation note: Book Warehouse-compatible comic aliases now have normal-user contract coverage for safe JSON, request submission/listing, series browsing, archive/page Range forwarding, 206 partial response headers, and authorization-matrix inventory visibility without adding admin import endpoints.
  - 2026-06-11 implementation note: cached Comic Library item detail JSON now promotes safe comic metadata (`seriesId`, `issueNumber`, and numeric `year`) from the stored Book Warehouse identifiers while continuing to hide raw payload, `/media/`, Ceph, and storage path fields.
  - 2026-06-11 implementation note: Book Warehouse-compatible `/api/v1/comics/items` list/detail aliases now strip internal `source: "catalog-source"` fields and expose the remote comic id as `id` for the documented `.items[0].id` detail/pages/download flow, while preserving native Comic Library routes and metadata.

Notifications:

- Use BookOrbit notifications when request status changes, when a request completes and maps to a synced item, or when a request fails.
- Avoid duplicate notifications by recording last-notified status per local request row.

## Local User Experience

Settings:

- Add an admin-only Book Warehouse settings panel under integrations. Regular users should not see this integration name.
- Fields: enabled, base URL, API key, connection test, sync cadence, last sync status, request sync status, and cache actions.
- Mask stored keys and never return them through client APIs.
- 2026-06-05 implementation note: Settings > Libraries now loads Ebook Library and Audio Library through the normal source-aware library list, renders them as read-only native library cards with friendly library links, hides filesystem-only edit/delete/cover/file-write controls, excludes them from Scan All, and uses their source-backed sync actions only for users with app-settings permission.
- 2026-06-10 implementation note: Book Warehouse admin settings and Settings > Libraries can now manually sync Comic Library through the comic catalog sync action, while source-backed Comic Library cards stay read-only and never fall back to filesystem scans or ebook sync.
- 2026-06-05 implementation note: Settings > Integrations now uses `tab=book-warehouse` as the canonical Book Warehouse tab URL while preserving `tab=catalog-source` as a legacy compatibility alias.

Browse and search:

- Do not add a regular user-facing Warehouse page. Fold synced items into native BookOrbit Library, Discover, Search, Requests, and reader surfaces.
- Treat source-backed libraries as real BookOrbit libraries, equivalent to filesystem libraries in user-facing behavior. Their only distinction is where metadata and files are sourced; Authors, Series, Dashboard, Search, Collections, Smart Scopes, Requests, and reader-state workflows should include them through native library semantics rather than a separate catalog island.
- 2026-06-04 implementation note: Ebook Library and Audio Library are now opt-in native library rows from `/api/v1/libraries?includeSourceBacked=true`, use friendly `/library/ebooks` and `/library/audiobooks` route aliases from user-facing navigation, and remain excluded from filesystem-only admin library calls by default.
- 2026-06-05 implementation note: public auth redirects now canonicalize legacy `/library/-1` and `/library/-2` targets before rendering login routes, keeping negative virtual library ids as internal compatibility details rather than browser-visible BookOrbit URLs.
- 2026-06-04 implementation note: the sidebar Libraries section now renders Ebook Library, Audio Library, and filesystem libraries through one ordered library list and one navigation template. Mixed source-backed/filesystem drag order is persisted locally for the sidebar, while positive filesystem library display order continues to sync through the existing server reorder endpoint.
- 2026-06-04 implementation note: source-backed ebook and audiobook library browse pages now guard their native cover-grid layout in tests and use library-native empty-state copy without sync/source wording.
- 2026-06-04 implementation note: source-backed ebook and audiobook library browse pages now honor the native library grid/list display mode, keeping the existing cover-grid layout and adding list rows with the same title, creator, series/subtitle, language, duration, and format cues.
- 2026-06-04 implementation note: source-backed ebook and audiobook library browse pages now query through a native library-shaped `BookQuery` endpoint (`/api/v1/libraries/-1/catalog-items/query` and `/api/v1/libraries/-2/catalog-items/query`) backed by current-user-owned warehouse rows, including search, title sort, pagination, content filters, and supported native filter-builder fields/operators without creating fake filesystem book rows or schema migrations.
- 2026-06-04 implementation note: shared book filter builders now load Ebook Library and Audio Library as normal library filter choices, so Home search, source-backed library browse filters, and Smart Scope rule editing no longer present filesystem-only library options.
- 2026-06-04 implementation note: source-backed library detail and stats routes now treat `-1` and `-2` as read-only viewer libraries, returning native library detail/counts when the catalog source is enabled while editor/owner filesystem routes remain blocked even for superusers.
- 2026-06-04 implementation note: the legacy native `/api/v1/libraries/-1/books` and `/api/v1/libraries/-2/books` query routes now dispatch through source-backed library rows and return a size-compatible `LibraryBooksPage` union, preserving cloud catalog item identity without falling into local filesystem book queries.
- 2026-06-04 implementation note: the normal library route shell (`HomeView`) now renders Ebook Library and Audio Library through the same grid/list/table controls and `/api/v1/libraries/:id/books` data flow as filesystem libraries; only scan/live-upload subscriptions remain filesystem-only.
- 2026-06-05 implementation note: the normal source-backed library route shell now has a regression guard proving `/library/ebooks` uses the native infinite-scroll sentinel and `useLibraryBooks.load()` path without rendering legacy catalog previous/next page controls.
- 2026-06-05 implementation note: Ebook Library and Audio Library browse now query all locally synced Book Warehouse catalog rows as their normal library contents, overlaying per-user state when present, so visible library inventory no longer depends on `warehouse_user_items` interaction rows.
- 2026-06-05 implementation note: Ebook Library and Audio Library browse load failures now surface native library copy (`Failed to load Ebook Library` / `Failed to load Audio Library`) instead of catalog wording.
- 2026-06-05 implementation note: native library infinite-scroll state now treats a valid uninitialized library as loadable, so Ebook Library and Audio Library mounts can fetch their first page even before a total count is known.
- 2026-06-05 implementation note: virtual source-backed route ids (`-1` and `-2`) now resolve to `Ebook Library` and `Audio Library` in route and page titles before library metadata hydrates, while positive filesystem library ids keep their existing numeric loading fallback.
- 2026-06-05 implementation note: legacy audiobook catalog browse wrappers and redirect metadata now use the native `Audio Library` name instead of the older `Audiobook Library` label.
- 2026-06-05 implementation note: Ebook Library and Audio Library grid/list/table browse rows now expose native quick details sidebars with cover, creator, series/publisher/language/duration metadata, read/listen, details, and collection actions without exposing source terminology; full item clicks still open the native library detail route.
- 2026-06-05 implementation note: Ebook Library and Audio Library quick/detail item surfaces no longer expose separate add/remove library membership controls; source-backed items are already native library contents, while favorite, rating, read status, progress, collections, reader, download, and email actions remain available through normal library-item state.
- 2026-06-05 implementation note: sidebar navigation, legacy catalog redirects, source-backed item links, and source-backed reader links now generate friendly `ebooks` and `audiobooks` library route params while parsing those aliases back to the internal virtual ids for API/query state, keeping negative ids out of normal generated library URLs without migrations. Existing `/library/-1...`, `/library/-2...`, `/read/library/-1...`, and `/read/library/-2...` URLs remain compatible.
- 2026-06-11 implementation note: statistics, My Reading, and bulk query-selection flows now accept and emit the friendly `comics` alias for Comic Library alongside `ebooks` and `audiobooks`, keeping the internal `-3` virtual id out of normal query payloads while preserving numeric compatibility.
- 2026-06-11 implementation note: the shared global book query and global search paths now include accessible Comic Library rows alongside filesystem, Ebook Library, and Audio Library rows, and source-backed comic search results are labeled `Comic Library` instead of falling through to ebook naming.
- 2026-06-05 implementation note: compatibility source-backed library URLs that still use the internal negative ids (`/library/-1`, `/library/-2`, item detail, and reader variants) now normalize at the router boundary and production SPA fallback to `/library/ebooks` or `/library/audiobooks` while preserving query strings and hashes.
- 2026-06-05 implementation note: author and series library filters now render friendly `ebooks` and `audiobooks` option values and parse them back to internal virtual ids, preventing source-backed library sentinels from leaking through user-facing filter controls.
- 2026-06-05 implementation note: auth redirects, OIDC redirects, and Authors/Series library filter query strings now canonicalize source-backed library ids to `ebooks` and `audiobooks` in user-facing URLs while parsing those aliases back to internal virtual ids for API calls.
- 2026-06-05 implementation note: the dashboard Library Overview Books tile now uses the same friendly library route helper, so source-backed-only installs navigate to `/library/ebooks` or `/library/audiobooks` instead of exposing virtual negative ids.
- 2026-06-05 implementation note: new-library redirects and upload-complete `View in Library` actions now use the friendly library route helper, keeping generated Ebook Library and Audio Library navigation on `/library/ebooks` and `/library/audiobooks`.
- 2026-06-04 implementation note: legacy `/catalog/:mediaType/:remoteId` item links now redirect to `/library/:id/items/:remoteId`, preserving query/hash context and mapping ebook/audiobook media segments to the native virtual library ids instead of rendering a separate catalog item route.
- 2026-06-04 implementation note: the native global `/api/v1/books/query` route now includes accessible Ebook Library and Audio Library rows through the `LibraryBooksPage` union, merging local `BookCard` results with source-backed catalog item rows while keeping negative cloud library ids out of local filesystem SQL queries and preserving title-default pagination semantics.
- 2026-06-05 implementation note: source-backed Ebook Library and Audio Library rows now sort by series index through both the source-backed catalog SQL window and the final mixed `/api/v1/books/query` merge, so series-number sorting behaves like filesystem libraries even across paged source-backed result windows.
- 2026-06-05 implementation note: metadata export preflight and all-matching exports now treat Ebook Library and Audio Library query selections as native library selections, resolving rows through the source-backed library query path and serializing cached catalog metadata without requiring local filesystem book ids.
- 2026-06-05 implementation note: source-backed library all-matching selections now expose the normal metadata export action from the selection bar and open the export dialog in all-matching mode only, avoiding any selected remote-id-as-local-book-id path.
- Use BookOrbit's existing filter builder patterns for local cached filters.
- 2026-06-04 implementation note: global search now labels source-backed results with native media library names (`Ebook Library` and `Audio Library`) instead of a separate catalog/source bucket.
- 2026-06-04 implementation note: global search previews now render source-backed ebook covers through the native ebook cover proxy, matching audiobook preview behavior.
- 2026-06-04 implementation note: global search now searches synced Ebook Library and Audio Library rows directly through the local cache, gated by the catalog enabled setting and user content filters, so cloud libraries behave like normal searchable libraries without live upstream calls.
- 2026-06-04 implementation note: global search result rows now display audiobook narrators when Audio Library results have no authors, so narrator-only matches expose the same creator signal as normal audiobook library surfaces.
- 2026-06-05 implementation note: global search result rows now expose the native source-backed quick-details sidebar from an icon action while preserving row navigation to friendly Ebook Library and Audio Library detail routes.
- 2026-06-05 implementation note: source-backed item clicks from global search, dashboard shelves/widgets, recommendations, library browse, Authors, Series, Collections, and Smart Scopes now resolve to friendly native library item routes (`/library/ebooks/items/:remoteId` or `/library/audiobooks/items/:remoteId`) through a shared route helper, while legacy catalog and negative-id detail routes remain compatibility-only.
- 2026-06-05 implementation note: dashboard shelf config normalization now upgrades old default source-backed shelf labels (`Catalog Additions`, `Explore Catalog`) to native library wording while preserving custom user shelf names.
- 2026-06-05 implementation note: Authors list navigation now preserves selected Ebook Library and Audio Library filters into author detail routes, and author detail hydrates the source-backed library filter before its first books load.
- 2026-06-04 implementation note: local book detail source-backed recommendation rows now use native library wording (`More From Libraries`) so Ebook Library and Audio Library recommendations do not appear as a separate catalog island.
- 2026-06-04 implementation note: source-backed recommendation DTOs now carry native `Ebook Library` or `Audio Library` library names instead of a generic Catalog label, keeping downstream dashboard/detail/search-style consumers aligned with normal library semantics.
- 2026-06-04 implementation note: local book detail source-backed recommendations now derive their Ebook Library/Audio Library media scope from the user's actual accessible virtual libraries, skip the warehouse recommendation query when neither virtual library is accessible, and pass content filters into the owned-catalog query.
- 2026-06-05 implementation note: local book detail source-backed recommendations now query accessible locally cached Ebook Library and Audio Library inventory with user-state overlays instead of requiring source-backed membership rows.
- 2026-06-04 implementation note: local book detail source-backed recommendation component fixtures now model `Ebook Library` and `Audio Library` payloads, keeping regression tests aligned with the native library contract instead of the old generic Catalog label.
- 2026-06-05 implementation note: local book detail source-backed recommendation rows now expose the native library quick-details sidebar from the Details action while preserving normal item-click navigation to friendly Ebook Library and Audio Library detail routes.
- 2026-06-04 implementation note: source-backed collection members now render in the main collection surface instead of a separate side shelf, using native collection grid/list/table affordances and `Ebook Library`/`Audio Library` naming without catalog/source wording.
- 2026-06-04 implementation note: source-backed collection catalog-item rows now carry `Ebook Library` or `Audio Library` from their media type at the service mapper, so collection cards no longer receive a generic Catalog library label.
- 2026-06-05 implementation note: source-backed collection add/selection failures now use native library item wording instead of catalog item terminology when requested refs are missing or the selection is empty.
- 2026-06-05 implementation note: source-backed rows in Collection and Smart Scope mixed grid/list/table surfaces now expose the native library quick-details sidebar, so Ebook Library and Audio Library items can be inspected without leaving those normal library views.
- 2026-06-05 implementation note: source-backed rows in mixed Collection grid/list/table surfaces now participate in selection mode with native check controls, selected counts, Add to Collection, and Remove from Collection actions backed by catalog item refs instead of pretending remote ids are local book ids.
- 2026-06-05 implementation note: source-backed rows in mixed Smart Scope grid/list/table surfaces now participate in selection mode with native check controls, selected counts, and Add to Collection actions backed by catalog item refs while suppressing book-only bulk actions for selected source-backed rows.
- 2026-06-05 implementation note: mixed Collection and Smart Scope source-backed selections now expose normal Set Status and Set Rating actions, patching Ebook Library and Audio Library user state through the catalog item state API while preserving local-book bulk actions for local selections.
- 2026-06-05 implementation note: mixed Collection source-backed pages now pass the active table sort through the normal collection catalog-item endpoint and order cached Ebook Library and Audio Library rows by supported native fields such as title, author, series, series index, collection-added date, updated date, publisher, format, and language with stable title/remote-id tie breakers.
- 2026-06-05 implementation note: source-backed Collection rows now include the same user-state and derived metadata fields as source-backed library browse rows, including rating, read progress, read status, read activity, finished date, published year, page count, file size, metadata score, duration, publisher, and language; Collection catalog-item sorting now supports those native fields as well.
- 2026-06-05 implementation note: source-backed Collection membership now uses the same available-library media gate as native library, Smart Scope, and global search queries. Users can only add/read Ebook Library or Audio Library collection rows when that source-backed library is available, and disabled/unavailable media types return an empty native page instead of leaking cached rows.
- 2026-06-05 implementation note: mixed Collection grid/list/table surfaces now apply the shared native library item sorter after combining loaded filesystem and source-backed rows, matching Smart Scope behavior for visible loaded results instead of rendering all local books before Ebook Library or Audio Library items.
- 2026-06-05 implementation note: source-backed rows in mixed DashboardScroller shelves now expose the native library quick-details sidebar from the Details action while preserving normal item-click navigation to friendly Ebook Library and Audio Library detail routes.
- 2026-06-05 implementation note: source-backed rows in catalog-only DashboardCatalogScroller additions/discovery shelves now expose the same native library quick-details sidebar from the Details action while preserving normal card navigation to friendly Ebook Library and Audio Library detail routes.
- 2026-06-11 implementation note: dashboard catalog additions, discovery, and source-backed scroller item mapping now labels comic rows as `Comic Library`, preserving safe cached dashboard DTOs without leaking `/media/`, Ceph, or storage path metadata.
- 2026-06-11 implementation note: Comic Library now has normal library shell/sidebar parity coverage, including `/library/comics` lazy-scroll rendering, friendly redirect routing, sidebar ordering/navigation, and active state on library detail and reader routes.
- 2026-06-11 implementation note: Comic Library grid cards now use the comic media badge icon in the normal library shell instead of falling back to the ebook badge.
- 2026-06-05 implementation note: source-backed rows in the Currently Reading dashboard widget now expose the native library quick-details sidebar from the Details action while preserving normal card detail navigation and native reader continuation.
- 2026-06-05 implementation note: source-backed Highlight of the Day rows now expose the native library quick-details sidebar from the Details action while preserving normal highlight row navigation to friendly Ebook Library and Audio Library detail routes.
- 2026-06-05 implementation note: the mixed local/source-backed Highlight of the Day service regression now pins its deterministic date fixture, keeping source-backed offset selection stable across calendar days.
- 2026-06-05 implementation note: source-backed Long Wait dashboard rows now expose the native library quick-details sidebar from the Details action while preserving cover/title detail navigation and native reader start actions.
- 2026-06-05 implementation note: source-backed Neglected Gems dashboard rows now expose the native library quick-details sidebar from the Details action while preserving cover/title detail navigation and queue-state actions.
- 2026-06-04 implementation note: the normal Series list now merges filesystem and source-backed library series summaries, including users with no filesystem libraries, with combined read counts, authors, sorting, completion filtering, and pagination at the native `/api/v1/series` boundary. Series detail now returns one shared, size-bounded library-item page, so source-backed library entries render in the normal Books section across grid/list/table modes, can be filtered through the native Ebook Library and Audio Library choices, open their native detail route, and can be added to collections through the same collection sheet.
- 2026-06-04 implementation note: the normal Authors list now merges filesystem authors with synced Ebook Library and Audio Library author summaries, including cloud-only users and virtual-library filtering, using stable negative virtual author ids. Cloud-only author detail resolves read-only through the native author route. Author detail book pages now return mixed local/source-backed library items through the native `/authors/:id/books` contract, including virtual Ebook Library and Audio Library filters, and render those source-backed titles with the normal author Books grid/list affordances.
- 2026-06-05 implementation note: source-backed Authors and Series browse/detail rows now treat all locally synced Ebook Library and Audio Library catalog rows as normal library inventory, overlaying per-user added/read/rating/progress state when present instead of requiring `warehouse_user_items` membership rows.
- 2026-06-04 implementation note: Authors and Series now gate source-backed summary/detail/item queries through the user's actual accessible Ebook Library and Audio Library ids, keeping negative virtual library ids out of local SQL and preventing unavailable cloud libraries from contributing native author or series rows.
- 2026-06-04 implementation note: source-backed series item rows now preserve catalog `seriesIndex` through native library item DTOs, repository ordering, service-level mixed local/cloud sorting, dashboard/collection/smart-scope item mappers, and the Series detail lead-book preview.
- 2026-06-04 implementation note: Authors route query hydration now accepts the virtual Ebook Library and Audio Library ids, so direct links and sidebar/filter navigation preserve source-backed library scope instead of falling back to all libraries.
- 2026-06-04 implementation note: source-backed authors remain normal read-only author/library rows in Authors and Author detail surfaces, while local-only metadata refresh, delete, image, edit, and merge actions now accept only mutable filesystem author ids so warehouse-backed author data is never posted to local author mutation endpoints.
- 2026-06-05 implementation note: source-backed author identities now canonicalize simple `Last, First` and `First Last` variants in read-model aggregates, author virtual ids, series author chips/detail summaries, statistics counts, top-author rows, search, and Smart Scope author filters. Raw cached upstream author arrays remain unchanged to avoid schema churn and upstream-development conflicts.
- 2026-06-05 implementation note: author deletion confirmations now use native library wording instead of catalog wording, keeping author management copy aligned with source-backed libraries behaving as normal libraries.
- 2026-06-05 implementation note: source-backed rows in Author detail and Series detail now expose the native library quick-details sidebar, so mixed local/source-backed book surfaces can inspect Ebook Library and Audio Library items without full navigation.
- 2026-06-05 implementation note: Author detail mixed local/source-backed book sorting now uses cached Ebook Library and Audio Library published years, so source-backed rows sort by published year alongside filesystem books instead of falling back to unknown-year ordering.
- 2026-06-04 implementation note: Statistics library filters now load Ebook Library and Audio Library alongside filesystem libraries. The core summary plus Top Authors, Genre Distribution, and Top Series charts merge local books with current-user-owned source-backed rows, scope source-backed counts by selected virtual library ids, and avoid falling back to all local statistics when only source-backed libraries are selected.
- 2026-06-05 implementation note: Statistics Format Distribution now treats Ebook Library and Audio Library as normal cached library inventory, merging source-backed cached formats with filesystem formats instead of returning an empty chart for virtual-library-only scopes.
- 2026-06-05 implementation note: Statistics Language Distribution now merges locally cached Ebook Library and Audio Library languages with filesystem language counts, including unknown-language totals, so mixed and source-backed-only scopes behave like normal libraries.
- 2026-06-05 implementation note: Statistics Books Added Over Time now merges locally cached Ebook Library and Audio Library added-date buckets with filesystem buckets, using cached upstream-created/synced timestamps so source-backed-only library scopes populate the normal timeline chart.
- 2026-06-05 implementation note: Statistics Publication Decade and Publication Year Timeline now merge locally cached Ebook Library and Audio Library publication-year buckets with filesystem buckets, using the same cached source publication-year extraction as native source-backed library sorting.
- 2026-06-05 implementation note: Statistics Largest Books now merges cached Ebook Library and Audio Library file-size rows with filesystem rows, using cached source file-size metadata and the normal top-50 ordering without adding migrations.
- 2026-06-05 implementation note: Statistics Metadata Score Distribution now merges cached Ebook Library and Audio Library metadata-score buckets with filesystem metadata-score buckets, including unknown totals and merged percentile estimates without adding migrations.
- 2026-06-05 implementation note: Statistics Storage By Format now merges cached Ebook Library and Audio Library file-size totals with filesystem storage totals, using cached source file-size metadata and normal top-format clipping without adding migrations.
- 2026-06-05 implementation note: Statistics and My Reading statistics library filters now serialize source-backed library query params as friendly `ebooks` and `audiobooks` aliases and parse those aliases back to internal virtual ids, while preserving legacy numeric values.
- 2026-06-05 implementation note: My Reading statistics Summary and Progress Funnel now treat Ebook Library and Audio Library as normal selectable libraries, merging filesystem reading state with source-backed `warehouse_user_items`/`warehouse_user_state` progress without adding migrations.
- 2026-06-05 implementation note: native achievement library-inventory progress now includes locally cached Ebook Library and Audio Library catalog rows for accessible source-backed libraries, so library-builder and multi-format achievement counters treat cloud-sourced inventory like filesystem inventory.
- 2026-06-05 implementation note: native finished-book achievement progress now includes completed Ebook Library and Audio Library user-state rows scoped by accessible virtual libraries, including total, yearly, and monthly finished-book counters.
- 2026-06-05 implementation note: native genre-explorer and polyglot achievement progress now dedupes completed Ebook Library and Audio Library genre/language metadata with filesystem read metadata through accessible virtual-library scope.
- 2026-06-05 implementation note: native genre-explorer achievement progress now resolves filesystem read genre names instead of local genre ids before merging with completed Ebook Library and Audio Library genre arrays through the shared trimmed lowercase genre key.
- 2026-06-05 implementation note: native polyglot achievement progress now trims and lowercases filesystem and completed Ebook Library/Audio Library language metadata before counting distinct languages, preventing source-backed case/whitespace variants from inflating progress.
- 2026-06-05 implementation note: native first-series achievement backfill now checks completed Ebook Library and Audio Library rows with cached series metadata when no filesystem read series book matches, scoped through accessible virtual libraries without adding migrations.
- 2026-06-05 implementation note: native trilogy-master achievement progress now falls back to completed Ebook Library and Audio Library series groups, counting cached source-backed items by series and requiring every cached item in a target-size series to be read.
- 2026-06-05 implementation note: native century-span and decade-sampler achievement progress now dedupes completed Ebook Library and Audio Library publication years with filesystem read metadata through accessible virtual-library scope, parsing cached source payloads without adding migrations.
- 2026-06-05 implementation note: native short-book and thick/thin achievement progress now includes completed Ebook Library and Audio Library page counts from cached payload metadata and audiobook duration-derived virtual pages, preserving filesystem threshold semantics without adding migrations.
- 2026-06-05 implementation note: native old-soul and new-release achievement backfill checks now include completed Ebook Library and Audio Library publication years from cached source payload metadata, preserving the existing before-year and exact-year semantics without adding migrations.
- 2026-06-05 implementation note: native same-author achievement progress now merges completed Ebook Library and Audio Library author arrays with filesystem read authors through the established comma-form canonical author key, so simple `Last, First` and `First Last` variants count together without adding migrations.
- 2026-06-05 implementation note: native same-genre achievement progress now merges completed Ebook Library and Audio Library genre arrays with filesystem read genres through the established trimmed lowercase genre key, counting duplicate genre spellings on a single source-backed item once without adding migrations.
- 2026-06-04 implementation note: Smart Scope source-backed previews now use native Library Matches copy and library-item count/error wording, avoiding separate catalog language in the normal smart-scope results surface.
- 2026-06-05 implementation note: Smart Scope source-backed match queries now use locally cached Ebook Library and Audio Library inventory for the user's accessible source-backed libraries, overlaying user state and content filters instead of requiring per-user membership rows.
- Keep external search visually separate from local synced catalog search.
- Show availability and request status indicators without naming the upstream source. Use labels like Available, Requested, Processing, Completed, and Failed.
- 2026-06-04 implementation note: Request search failures now use native title-search copy (`Failed to search titles`) across ebook and audiobook request dialogs/composables instead of catalog wording.
- 2026-06-04 implementation note: Untitled request rows now fall back to `Library request`, so request history never exposes catalog wording when upstream metadata is missing.

Detail and reader:

- Source-backed item details should show synced metadata, request/readiness state, actions, progress, related items, and download/stream actions as native BookOrbit catalog details. 2026-06-03 implementation note: ebook catalog detail pages now render native cover and download actions through the user-scoped media routes; audiobook detail pages now surface native per-file download actions from cached detail files. 2026-06-05 update: source-backed item detail download actions now generate native `/api/v1/libraries/ebooks/items/:remoteId/download`, `/api/v1/libraries/audiobooks/items/:remoteId/download`, and `/api/v1/libraries/audiobooks/items/:remoteId/files/:fileId/download` media URLs while preserving the legacy catalog media routes. 2026-06-05 update: source-backed cover/poster helpers now generate native `/api/v1/libraries/ebooks/items/:remoteId/cover/:size` and `/api/v1/libraries/audiobooks/items/:remoteId/cover` URLs for detail, quick-details, search, dashboard, author, series, collection, and smart-scope surfaces while preserving legacy catalog cover routes.
- 2026-06-04 implementation note: source-backed item detail pages now present the title as part of `Ebook Library` or `Audio Library`, and unavailable-item plus detail-load failure copy uses native library item wording instead of a separate catalog-item concept.
- 2026-06-05 implementation note: source-backed item detail and quick-details surfaces no longer expose separate add/remove library membership controls because all synced Ebook Library and Audio Library rows are normal library inventory; user-state actions stay focused on favorite, rating, read status, progress, collections, reader, download, and email actions.
- 2026-06-05 implementation note: source-backed Ebook Library downloads and Audio Library stream/download routes now authorize against cached catalog item availability instead of legacy `warehouse_user_items` membership rows, so visible cached library inventory can be read, listened to, downloaded, and emailed even before the user has created per-item state.
- 2026-06-04 implementation note: source-backed item detail pages now load same-library related items from the native source-backed library query endpoint using the item's series/authors, render them as `More From Libraries`, and exclude the current remote item without exposing warehouse/source wording.
- Ebooks should open through existing EPUB/PDF/CBZ reader paths only when content can be served safely.
- Audiobooks should open through the existing audiobook reader and persist position, track index, percentage, and status through `warehouse_user_state`. 2026-06-04 implementation note: source-backed audiobook detail and dashboard Continue actions now route into the native audiobook reader using catalog-backed stream/progress/bookmark adapters, canonical reader-format normalization for extension and MIME-like audio formats, stale resume-position clamping, and explicit read-status preservation.
- 2026-06-04 implementation note: source-backed library items now have native bookmark contracts backed by `warehouse_bookmarks`, scoped by user/media/remote item, exposed through regular catalog item routes, mirrored in client API helpers with secret/raw-field stripping, and wired into the visible EPUB/audiobook bookmark controls used by filesystem libraries.
- 2026-06-04 implementation note: source-backed EPUB detail pages now expose the normal Read action and open through the existing EPUB reader using the authenticated user-scoped download proxy. Reader progress and elapsed session saves persist through `warehouse_user_state`, visible bookmark controls persist through `warehouse_bookmarks`, per-item reader settings use remote-aware local storage keys without `/reader/preferences/0`, and unsupported source-backed reader formats show a native unavailable state instead of entering local file readers.
- 2026-06-05 implementation note: source-backed reader unavailable and unsupported-format failures now use native library item wording instead of catalog ebook copy, keeping reader errors aligned with normal library semantics.
- 2026-06-04 implementation note: source-backed EPUB highlights and notes now use the same visible reader controls as filesystem EPUBs, backed by additive `warehouse_annotations` rows scoped by user/media/remote item and native catalog item annotation routes. The client injects a catalog annotation store only for catalog readers, so local filesystem annotations continue using the existing local book endpoints.
- 2026-06-04 implementation note: source-backed PDF detail pages now expose the normal Read action and open through the existing PDF reader using the authenticated user-scoped download proxy. PDF progress and elapsed session saves persist through `warehouse_user_state`, per-item PDF reader settings use remote-aware local storage keys without `/reader/preferences/0`, and PDF peek mode stays on the native library reader route. Source-backed CBZ/CBR/CB7 detail pages now expose the normal Read action and open through the existing comic reader using authorized source-backed page count/image routes, remote-aware reader settings, and `warehouse_user_state` progress/session persistence. 2026-06-05 update: server reader regressions now cover source-backed CBR and CB7 archive page counts/streams through the cached Ebook Library download path, matching the existing source-backed CBZ guard.
- 2026-06-04 implementation note: source-backed reader launches now use `/read/library/:id/items/:remoteId` with Ebook Library or Audio Library ids across item detail, dashboard Continue, The Long Wait, PDF, comic, and audiobook readers. Legacy `/read/catalog/:mediaType/:remoteId` links remain compatibility redirects that preserve query/hash context.
- 2026-06-11 implementation note: Comic Library reader launches and details now route through the first-class Comic Library id/alias, fetch comic detail/page imagery/downloads through native BookOrbit endpoints, and persist comic progress/read status through the same `warehouse_user_state` service as Ebook Library and Audio Library items.

Requests:

- Add request dialogs for ebook and audiobook flows.
- Ebook dialog supports ISBN and external-search-result requests.
- Audiobook dialog supports title/author and candidate-search prefill.
- My Requests page shows ebook and audiobook request status, queue information, completed links, retry/resubmit behavior where local policy supports it, and cancellation only for ebook monitoring. 2026-06-03 implementation note: completed ebook and audiobook request rows now expose a native Open item action only when a sanitized completed catalog item id is available, routing to the existing catalog detail page without integration wording or private request ids. 2026-06-04 implementation note: completed ebook request rows now expose a native Download action through the existing request stream proxy, while audiobook rows continue to avoid unsupported stream/download/cancel actions. 2026-06-05 implementation note: completed ebook and audiobook request rows now expose a native quick-details action for the completed Ebook Library or Audio Library item without navigating away from Requests. 2026-06-05 update: completed ebook request downloads now generate native `/api/v1/requests/:id/stream` URLs while the legacy `/api/v1/catalog/requests/:id/stream` route remains mounted for compatibility.

## Integrations

Dashboard:

- Add synced source-backed ebooks to Continue Reading, Recently Added, Discover, and relevant recommendation shelves where BookOrbit can serve them.
- Add synced source-backed audiobooks to Continue Listening, Trending Audiobooks, Discover, and audiobook-specific widgets.
- Use bounded SQL candidate windows for dashboard queries.
- 2026-06-04 implementation note: the Currently Reading dashboard widget now merges filesystem book progress with source-backed Ebook Library and Audio Library progress from local user state, sorts the combined native widget by recent activity, and routes source-backed cards to the native item detail page without exposing integration wording.
- 2026-06-04 implementation note: the Currently Reading dashboard widget now routes source-backed EPUB/PDF/CBZ/CBR/CB7 and audiobook Continue actions directly into the native catalog reader while keeping item-card clicks on native detail and unsupported ebook formats on detail until their readers are source-backed-safe. The Long Wait dashboard widget now starts readable source-backed comic formats through the same native catalog reader path and labels Audio Library launch actions as listening.
- 2026-06-11 implementation note: dashboard source-backed comic rows now launch readable CBZ/CBR/CB7 items through the first-class Comic Library reader route and use Comic Library cover/quick-view labeling, instead of treating warehouse comics as Ebook Library items.
- 2026-06-11 implementation note: Neglected Gems and Long Wait dashboard mappers now preserve Comic Library media identity from cached Book Warehouse rows, so normal-user comic items keep comic covers, Comic Library quick-details labels, native `/library/comics` routing, and comic user-state queue updates instead of falling through to Ebook Library behavior.
- 2026-06-11 implementation note: generic dashboard source-backed shelves and global search previews now resolve Comic Library cards through comic page-image URLs and Comic fallback labels instead of the Ebook Library cover/label helpers.
- 2026-06-04 implementation note: Currently Reading now scopes source-backed progress to the user's actual accessible Ebook Library and Audio Library ids before merging with filesystem progress, so unavailable virtual libraries cannot contribute dashboard rows while catalog cards keep native routes, cover proxies, and reader actions without migration changes.
- 2026-06-04 implementation note: dashboard source-backed shelves now use native labels (`Library Additions`, `Explore Libraries`) and dashboard item badges report `Ebook Library` or `Audio Library` instead of a catalog/source bucket.
- 2026-06-04 implementation note: dashboard source-backed scroller empty states now use native library copy (`No library additions yet.` / `No library discoveries yet.`) instead of catalog wording.
- 2026-06-05 implementation note: dashboard source-backed shelf load failures now use native library wording (`Failed to fetch library additions` / `Failed to fetch library discovery`) instead of catalog wording.
- 2026-06-05 implementation note: generic dashboard scroller requests for the dedicated source-backed additions/discovery shelves now return native library endpoint guidance instead of catalog endpoint wording.
- 2026-06-05 implementation note: dashboard generic scroller route errors now refer to library additions and library discovery endpoints instead of catalog additions/discovery terminology.
- 2026-06-04 implementation note: dashboard catalog shelves now render source-backed ebook covers through the native ebook cover proxy, matching audiobook cover behavior without adding schema changes.
- 2026-06-04 implementation note: local book detail catalog recommendation shelves now render source-backed ebook covers through the same native cover proxy used by catalog browse and dashboard shelves.
- 2026-06-05 implementation note: Ebook Library and Audio Library cover endpoints now serve posters for cached library inventory without requiring a per-user `warehouse_user_items` row, while downloads and streams remain on the stricter user-state path.
- 2026-06-04 implementation note: dashboard library overview counts now merge filesystem libraries with synced Ebook Library and Audio Library inventory through native library overview semantics, keeping storage bytes filesystem-only because source-backed items do not occupy local library storage.
- 2026-06-05 implementation note: dashboard library overview source-backed counts now use locally cached Ebook Library and Audio Library inventory scoped by the user's accessible virtual library ids, instead of requiring per-user source-backed membership rows.
- 2026-06-04 implementation note: the dashboard shell now includes source-backed Ebook Library and Audio Library rows when deciding whether the user has any libraries, so cloud-only library users get the normal dashboard instead of the first-library welcome state.
- 2026-06-04 implementation note: the normal Continue Reading dashboard scroller now merges filesystem progress with user-owned Ebook Library and Audio Library progress, scopes source-backed rows by the user's actual virtual library access, sorts the mixed shelf by latest reading/listening activity, and returns native library item rows without exposing source terminology.
- 2026-06-05 implementation note: the native Recently Added dashboard scroller composes local `BookCard` rows with accessible Ebook Library and Audio Library catalog cache rows, while the dedicated Library Additions shelf is now scoped to the user's source-backed library membership so it does not surface raw warehouse cache rows outside the user's libraries.
- 2026-06-04 implementation note: the Reading Goal dashboard widget now sums filesystem completions with source-backed Ebook Library and Audio Library completions. Source-backed user state has an additive nullable `finished_at` timestamp, stamped when read status becomes `read` or `skimmed`, preserved on repeated completed updates, cleared when the item returns to an incomplete state, and counted through the same current-year/content-filter semantics as local library books. 2026-06-04 update: source-backed Reading Goal counts are now scoped to the user's actual accessible Ebook Library and Audio Library ids, so unavailable virtual libraries do not contribute completions.
- 2026-06-04 implementation note: the normal Random dashboard scroller now mixes filesystem library cards with accessible Ebook Library and Audio Library catalog rows, derives source-backed media scope from the user's actual `-1`/`-2` library access, keeps negative library ids out of local SQL, allocates random shelf slots by local/source-backed candidate population, and filters source-backed random candidates to unstarted user state.
- 2026-06-05 implementation note: the separate Explore Libraries dashboard discovery shelf now samples the user's source-backed Ebook Library and Audio Library membership rows, keeping the high-visibility dashboard discovery surface aligned with normal library access instead of the raw warehouse cache.
- 2026-06-04 implementation note: the normal Up Next In Series dashboard scroller now treats accessible Ebook Library and Audio Library rows as normal libraries. Synced catalog items promote an additive nullable `series_index` through migration `0023`, source-backed candidates use user-owned catalog membership plus `warehouse_user_state` completion/progress semantics, and the final shelf merges local and source-backed candidates by the previous volume's completion recency while keeping negative library ids out of filesystem SQL.
- 2026-06-04 implementation note: Highlight of the Day now samples filesystem annotations and source-backed Ebook Library/Audio Library annotations as one native dashboard pool. Source-backed highlights are scoped through current-user-owned catalog membership, use native library names, render through catalog cover proxies, and route to catalog item detail pages without warehouse/source wording. 2026-06-04 update: source-backed highlight counts and offset selection are now scoped to the user's actual accessible Ebook Library and Audio Library ids, so unavailable virtual libraries do not contribute annotations.
- 2026-06-04 implementation note: Reading Streak now computes over filesystem daily reading stats plus user-owned Ebook Library and Audio Library activity days from source-backed user state. Source-backed streak days are scoped by the user's actual accessible virtual libraries and content filters, so warehouse-backed reading/listening contributes through normal library semantics without adding migrations.
- 2026-06-04 implementation note: Reading Rhythm now builds its 14-day activity pulse from local reading seconds plus source-backed Ebook Library and Audio Library activity days scoped by actual virtual-library access and content filters, keeping local seconds authoritative when both sources are active on the same day.
- 2026-06-04 implementation note: Diversity Score now merges filesystem diversity inputs with user-owned Ebook Library and Audio Library diversity inputs scoped by actual virtual-library access and content filters, carrying normalized genre, author, and language identities so overlapping local/source-backed values are counted once in the normal dashboard widget.
- 2026-06-04 implementation note: Year Projection now merges filesystem completion pace with user-owned Ebook Library and Audio Library completion pace scoped by actual virtual-library access and content filters. Source-backed completions contribute YTD/last-30 book counts, cached ebook page metadata contributes projected pages where available, and cached audiobook duration contributes projected hours without adding new migration state.
- 2026-06-04 implementation note: Reading DNA now merges filesystem DNA traits with user-owned Ebook Library and Audio Library traits scoped by actual virtual-library access and content filters. Source-backed rows contribute completed-book counts, normalized genres, activity days, peak activity hour, ebook page counts, and duration-derived audiobook length without adding migration state; speed remains `N/A` for source-backed-only activity until cloud reader sessions expose page/duration deltas.
- 2026-06-04 implementation note: Monthly Challenge now merges filesystem challenge patterns with user-owned Ebook Library and Audio Library patterns scoped by actual virtual-library access and content filters. Source-backed rows contribute month/last-six-month completion, genre, author, page, backlog, and activity-day signals through normal dashboard challenge semantics, with normalized genre/author/day identities deduped across local and source-backed libraries and no migration changes.
- 2026-06-04 implementation note: Neglected Gems now merges filesystem high-rated unread books with user-owned Ebook Library and Audio Library high-rated unread catalog rows scoped by actual virtual-library access and content filters. Source-backed gems use native catalog detail routes, cover proxies, and user-state queue updates while the widget keeps normal library wording and no migration changes.
- 2026-06-04 implementation note: The Long Wait now chooses the oldest unstarted item across filesystem libraries and user-owned Ebook Library/Audio Library rows scoped by actual virtual-library access and content filters. Source-backed candidates use catalog detail routes, cover proxies, and native catalog-reader start actions when the cached format is readable, with no migration changes.

Global search:

- Search local synced source-backed items using local search tables.
- Do not perform live external discovery or upstream catalog search from global search.
- 2026-06-03 implementation note: `/api/v1/books/search` now merges regular local book hits with synced catalog items from local SQL cache only, returning typed results so the client can route catalog items without pretending remote IDs are local book IDs.
- 2026-06-04 implementation note: `/api/v1/books/query` now composes native local books and accessible source-backed library items for filter-builder/global book queries without sending negative cloud library ids into local book SQL.
- 2026-06-04 implementation note: `/api/v1/books/search` now derives source-backed search scope from the user's accessible Ebook Library and Audio Library ids, applies content filters, and avoids broad catalog discovery when those libraries are disabled.
- 2026-06-05 implementation note: global search now treats Ebook Library and Audio Library as cached library inventory, searching locally synced catalog rows through media-scoped catalog cache search instead of requiring per-user source-backed membership rows.

Collections and smart scopes:

- Allow synced source-backed items to join collections and smart scopes through local `warehouse_user_items` and derived metadata. 2026-06-03 implementation note: collections now have an additive source-backed membership join table and the existing Manage Collections sheet can add/remove catalog item refs from native detail pages without treating remote IDs as local book IDs. 2026-06-04 implementation note: collection pages now load source-backed collection titles from that membership table and render them in the main collection grid/list/table surface alongside local books, including search-filtered counts, source-backed pagination, native catalog detail routing, and direct source-backed removal without fake local book ids. Smart scope catalog previews now render source-backed ebook covers through the native catalog cover proxy, matching audiobook cover behavior. 2026-06-04 implementation note: Smart Scope pages now render source-backed Ebook Library and Audio Library matches in the main grid/list/table result surface instead of a separate Catalog Matches rail, share header totals/loading with local books, support source-backed paging in mixed table mode, and sort the currently loaded mixed result set with nulls kept last. 2026-06-04 implementation note: Smart Scope counts and `/api/v1/smart-scopes/:id/books/query` now delegate to the unified source-aware library query path, returning `LibraryBooksPage` results so source-backed Ebook Library and Audio Library matches use the same filtering, sorting, pagination, and count semantics as normal library book queries. 2026-06-05 implementation note: Smart Scope library-match preview cards now expose the native source-backed quick-details sidebar from an icon action while preserving card navigation to the friendly library item detail route. 2026-06-05 update: mixed Collection and Smart Scope selection bars now expose normal status/rating bulk actions for selected Ebook Library and Audio Library rows, updating cached user state through the source-backed item API. 2026-06-05 update: source-backed Smart Scope/filter-builder collection rules now compile against catalog collection membership, so collection include/exclude/empty rules no longer drop Ebook Library or Audio Library matches. 2026-06-11 update: Comic Library catalog refs now pass through the same native collection membership DTOs, filters, existence checks, and card labeling as Ebook Library and Audio Library refs.
- Keep rules media-type aware.

Migration stack note:

- 2026-06-04 implementation note: imported upstream `0013_add_series_ids.sql` and renumbered the warehouse migration stack to `0014`-`0019`, with the Drizzle journal and snapshot chain updated so duplicate migration tags do not ship.
- 2026-06-04 implementation note: appended `0020_add_warehouse_bookmarks.sql` after the reconciled stack; it is additive and keeps the Drizzle journal/snapshot chain monotonic.
- 2026-06-04 implementation note: appended `0023_add_warehouse_catalog_series_index.sql` as an additive, idempotent warehouse catalog metadata migration so source-backed series ordering can participate in native Up Next In Series dashboard behavior without conflicting with filesystem schema.

Kobo and KOReader:

- Expose only synced, user-authorized, servable remote ebooks.
- Maintain stable remote-aware identifiers and map progress through local warehouse user state.
- 2026-06-03 implementation note: Kobo now syncs current-user-owned catalog ebooks through opaque BookOrbit catalog IDs, user-scoped metadata/cover/download routes, and catalog-backed reading state without exposing upstream source identifiers.
- 2026-06-05 implementation note: Kobo source-backed ebook sync now preserves the existing conservative content-filter behavior used by OPDS: when a user has active content filters, catalog-backed Ebook Library rows are withheld from snapshot eligibility and direct Kobo metadata lookup so devices do not see titles hidden from normal library views.
- 2026-06-05 implementation note: Kobo source-backed ebook snapshot, metadata, cover, download, and reading-state remote-id resolution now start from cached Ebook Library inventory instead of legacy `warehouse_user_items` membership rows, while still overlaying user state and withholding source-backed rows when active content filters are present.
- 2026-06-03 implementation note: KOReader has no catalog/list protocol in BookOrbit, so compatibility is implemented as a document-hash progress bridge. Full OPDS catalog ebook downloads record the KOReader document hash for current-user-owned catalog ebooks, and KOReader progress sync maps that hash to catalog-backed user state without exposing upstream source identifiers.
- 2026-06-05 implementation note: KOReader document-hash mapping and progress reads now resolve cached Ebook Library inventory and current-user source-backed state directly instead of requiring legacy `warehouse_user_items` membership rows, so visible/downloadable Ebook Library items can sync progress without a separate ownership row.

OPDS and ABS-style clients:

- Treat source-backed audiobooks as eligible only after sync and local representation.
- Preserve BookOrbit's existing client contracts while adding remote-aware mapping tests.
- 2026-06-03 implementation note: OPDS now exposes current-user-owned synced catalog ebooks through a native Catalog Ebooks acquisition feed, with OPDS-authenticated cover/download routes and remote-aware OPDS identifiers that do not reveal integration wording or private upstream URLs. OPDS All Books/search and Recent feeds now merge those owned catalog ebooks when catalog access is enabled and the request is not scoped to local-only library or smart-scope filters. 2026-06-05 update: OPDS collection navigation and collection-scoped catalog feeds now count and merge current-user-owned Ebook Library members from native collection membership, without adding schema. 2026-06-05 update: OPDS author and series navigation now merge current-user-owned Ebook Library authors/series with filesystem summaries, including cloud-only users. 2026-06-05 update: OPDS Surprise now samples locally cached Ebook Library inventory alongside filesystem books. 2026-06-05 update: OPDS Smart Scope catalog feeds now merge locally cached Ebook Library matches through the source-backed smart-scope query path, including cloud-only users.
- 2026-06-05 implementation note: OPDS All Books/search, Recent, Surprise, Authors, and Series now apply user content filters to cached Ebook Library rows instead of dropping source-backed rows whenever filters are active, matching normal library visibility semantics.
- 2026-06-04 implementation note: OPDS now presents source-backed ebooks through the normal Libraries navigation as `Ebook Library` and accepts `/api/v1/opds/catalog?libraryId=ebooks` as the canonical library-scoped acquisition feed while preserving `/api/v1/opds/catalog?libraryId=-1` as legacy compatibility input. The older `/api/v1/opds/catalog-ebooks` route remains compatibility-only and is no longer advertised from root navigation.
- 2026-06-05 implementation note: OPDS Ebook Library acquisition pages now start from locally cached Ebook Library inventory instead of requiring per-user source-backed membership rows, overlay user timestamps when present, and apply catalog tag/genre content filters instead of dropping the source-backed library feed.
- 2026-06-05 implementation note: the legacy `/api/v1/opds/catalog-ebooks` compatibility feed now forwards the OPDS user's content filters into the same cached Ebook Library query path, so direct legacy feed access cannot bypass normal library visibility rules.
- 2026-06-05 implementation note: OPDS Authors and Series navigation now count locally cached Ebook Library inventory directly instead of requiring per-user source-backed membership rows, while preserving the active-content-filter guard.
- 2026-06-05 implementation note: OPDS Surprise random picks now sample locally cached Ebook Library rows directly and overlay per-user timestamps when available instead of requiring source-backed membership rows.
- 2026-06-05 implementation note: OPDS Smart Scope feeds now pass user content filters into the source-backed smart-scope catalog query instead of falling back to local-only results.
- 2026-06-05 implementation note: OPDS Smart Scope navigation now uses the same owner-or-public visibility model and display-order/name sorting as the normal Smart Scope list, so shared/public scopes can be browsed through OPDS when their execution path is otherwise accessible.
- 2026-06-03 implementation note: ABS-style audiobook compatibility now exposes a read-only current-user-owned catalog audiobook item mapping through opaque BookOrbit IDs, synthetic track/chapter/progress identifiers, synthetic file names, cached chapter/file metadata, and local user progress. This is a compatibility mapping slice, not a full Audiobookshelf server or progress mutation API.

Email and downloads:

- Reuse BookOrbit email/download services where possible, with source-backed content served through the warehouse content proxy.
- 2026-06-05 implementation note: source-backed Ebook Library item detail pages now expose the normal Send via Email action for users with email-send permission. Sends reuse `/api/v1/email/send` with explicit catalog ebook refs, stream attachments through the existing user-scoped ebook download proxy, build native template context with catalog metadata/cover URLs, and log `bookId`/`bookFileId` as null so remote ids are not treated as filesystem book ids. 2026-06-05 update: email send logs now retain a nullable source-backed ebook ref for catalog sends, and resend reconstructs the same user-scoped ebook send path after a current access preflight.

## Security And Reliability

- Encrypt or otherwise protect the API key at rest using BookOrbit's existing secret-storage approach.
- Redact API keys in logs, audit entries, telemetry, screenshots, and errors.
- Use `X-API-Key` only, not query-string keys.
- Apply BookOrbit permissions before returning local cached warehouse data.
- Add rate limiting or queueing around upstream sync, external search, and request mutations.
- Normalize upstream errors into actionable UI messages while preserving status meaning.
- Support `429` retry/backoff and avoid tight retry loops.
- For downloads and streams, preserve byte-range behavior where possible and avoid buffering whole files in memory. 2026-06-03 implementation note: native catalog binary proxies now forward validated single byte-range requests, strip proxied content-type parameters, require valid partial-content metadata for `206`, and return safe `416`, `Content-Range`, and `Accept-Ranges` metadata without exposing upstream headers, URLs, or credentials. 2026-06-05 update: source-backed Audio Library playback now emits the native `/api/v1/libraries/audiobooks/items/:remoteId/stream` URL and serves it through the same safe range-aware binary proxy while keeping `/api/v1/catalog/audiobooks/:remoteId/stream` as compatibility.

## Testing

Server tests:

- Upstream client request construction: paths, allowed params, auth header, no query-string keys.
- Error mapping for `400`, `401`, `403`, `404`, `429`, and `5xx`.
- Catalog sync pagination, wrapper tolerance, media-type separation, raw payload preservation, and derived index refresh.
- Browse/search/facet queries, including documented filters and sort behavior.
- Request submit/list/status/cancel flows for ebooks.
- Audiobook request submit/list/queue flows, including no cancel/stream behavior.
- User state persistence for progress, favorite, rating, read status, bookmarks, notes, sessions, and preferences.
- Permission filtering for browse, detail, dashboard, device, download, and stream paths.

Client tests:

- Settings validation and key masking.
- Local search versus external discovery separation.
- Ebook and audiobook request dialogs.
- Request status/queue UI states.
- Source-backed detail actions by media type/readiness.
- Dashboard and reader integration edge cases.

Contract fixtures:

- Keep small golden fixtures for upstream book, audiobook, genre, external search, monitoring, audiobook request, queue, and error responses.
- Update fixtures only when the wiki or observed upstream API changes.

## Rollout Plan

1. Settings, encrypted credentials, connection test, and typed upstream client.
2. Warehouse schema, migrations, shared types, and fixtures.
3. Ebooks catalog sync/cache/browse/search/details/covers/download. Native user-scoped ebook download proxy, range-aware binary handling, cover proxy, persistent cover cache, detail-page media actions, first-class Ebook Library browse/search navigation under the Libraries section, running sync progress telemetry, formatted large totals, loading-first browse states, local-library-style shelf layout, grid/list display modes, and native library-query filters completed 2026-06-04.
   - 2026-06-05 implementation note: source-backed Ebook Library routes now tolerate numeric internal route params during programmatic navigation and still canonicalize user-facing URLs to `/library/ebooks`.
   - 2026-06-05 implementation note: production SPA fallback now redirects legacy source-backed numeric library URLs such as `/library/-1` to `/library/ebooks` before serving `index.html`, so stale or unauthenticated loads do not expose internal ids.
   - 2026-06-05 implementation note: production SPA fallback canonicalization now preserves query and hash context for legacy source-backed library URLs when the helper receives them, matching the client router normalizer.
   - 2026-06-05 implementation note: source-backed Ebook Library table rows now render native cover artwork through the cached cover proxy, matching grid/list poster behavior.
4. Audiobooks catalog sync/cache/browse/search/details/covers/stream/download/file-download. Native user-scoped range-aware audiobook binary routes, persistent cover cache, detail-page file download actions, first-class Audiobook Library browse/search navigation under the Libraries section, running sync progress telemetry, interrupted-sync recovery, formatted totals, loading-first browse states, local-library-style shelf layout, grid/list display modes, and native library-query filters completed 2026-06-04.
   - 2026-06-05 implementation note: source-backed Audio Library routes now tolerate numeric internal route params during programmatic navigation and still canonicalize user-facing URLs to `/library/audiobooks`.
   - 2026-06-05 implementation note: production SPA fallback now redirects legacy source-backed numeric library and reader URLs such as `/library/-2` and `/read/library/-2/items/:remoteId` to friendly Audio Library aliases before serving `index.html`.
   - 2026-06-05 implementation note: source-backed audiobook covers now keep square Audio Library framing when they appear in mixed collection, Smart Scope, and series grid/list surfaces.
   - 2026-06-05 implementation note: source-backed Audio Library table rows now render native square cover artwork through the cached cover proxy, matching grid/list poster behavior.
   - 2026-06-05 implementation note: ABS-compatible Audio Library item lookup now resolves cached audiobook inventory by catalog item id instead of requiring legacy user membership rows, while still overlaying per-user progress state when present.
   - 2026-06-05 implementation note: mixed series table rows now render source-backed Ebook Library and Audio Library cover cells through the native cached cover proxies, including square Audio Library artwork, instead of showing source-backed metadata without poster art.
5. Genres, authors, narrators, series, and derived facets. Audiobook author, narrator, and series browse dimensions from local catalog rows completed 2026-06-03. Ebook and audiobook genre extraction, dimensions, and genre-filtered listings completed 2026-06-03.
   - 2026-06-05 implementation note: source-backed series detail now contributes cached series indices to native gap detection, so warehouse-only or mixed series can show the same missing-volume banner as filesystem libraries.
6. Ebook request monitoring with external search, submit, list, detail, SSE, cancel, and local notifications.
7. Audiobook request flow with candidate search, submit, list/status, queue, and notifications.
   - 2026-06-04 implementation note: request notification titles and sanitized row fallbacks now use native request/library copy (`Request completed`, `Request failed`, `Library request`) instead of catalog request terminology while preserving notification type identifiers.
   - 2026-06-04 implementation note: request lookup/search/submit unavailable errors now use native request copy (`Requests are temporarily unavailable`, `Request is not available`) instead of catalog request terminology.
8. Local user state: ownership, collections, favorites, ratings, read status, progress, sessions, bookmarks, notes, preferences. Source-backed audiobook native reader progress/bookmark/session adapters completed 2026-06-04; source-backed EPUB reader progress, session persistence, visible bookmarks, remote-aware local reader settings, highlights, and notes completed 2026-06-04; source-backed PDF reader progress, session persistence, and remote-aware local reader settings completed 2026-06-04; user-state load/save failures now use native library item copy instead of catalog state terminology.
   - 2026-06-05 implementation note: source-backed Ebook Library and Audio Library read-status transitions into `read` now emit native achievement backfill evaluation for the current user, matching filesystem completion timing without using remote ids as local book ids.
   - 2026-06-05 implementation note: source-backed library grid, list, and table modes now support loaded-item selection for Add to Collection by passing catalog item refs to the native collection sheet while keeping local-only bulk metadata actions out of the source-backed action bar.
   - 2026-06-05 implementation note: source-backed bookmark and annotation missing-item or unsupported-media errors now use native library item wording instead of catalog item terminology while preserving the same HTTP semantics.
   - 2026-06-05 implementation note: all-matching bulk status, rating, metadata edit, and metadata export payloads now serialize Ebook Library and Audio Library query selections as `ebooks`/`audiobooks` while server bulk DTOs continue to accept legacy `-1`/`-2` ids.
9. Dashboard, global search, smart scopes, recommendations, and trending integrations. Global search owned-catalog slice completed 2026-06-03; dashboard catalog additions shelf completed 2026-06-03; Smart Scope catalog preview completed 2026-06-03; catalog recommendations completed 2026-06-03; native catalog discovery shelf completed 2026-06-03.
   - 2026-06-05 implementation note: mixed collection, Smart Scope, and series result surfaces now apply native audio-library cover geometry to source-backed audiobooks instead of portrait ebook framing.
   - 2026-06-05 implementation note: mixed collection table rows now render source-backed Ebook Library and Audio Library cover cells, including square audiobook artwork, instead of dropping posters in table mode.
   - 2026-06-05 implementation note: mixed collection table mode now keeps the native lazy-load sentinel active when source-backed members are present, preserving endless loading for additional Ebook Library and Audio Library collection pages.
   - 2026-06-05 implementation note: mixed Smart Scope table mode now uses the native lazy-load sentinel for source-backed results instead of an explicit Load more button, preserving endless loading for additional Ebook Library and Audio Library matches.
   - 2026-06-05 implementation note: mixed Smart Scope grid/list/table rows now select source-backed Ebook Library and Audio Library members as native collection item refs for Add to Collection without treating remote ids as local book ids.
   - 2026-06-04 implementation note: native library queries, Smart Scope mixed-result sorting, and Smart Scope catalog previews now sort source-backed Ebook/Audio Library items by cached catalog `updated_at` without adding schema; read-activity sorting continues to use user-state timestamps.
   - 2026-06-04 implementation note: native library queries, Smart Scope mixed-result sorting, and Smart Scope catalog previews now sort source-backed Ebook/Audio Library items by cached primary file size metadata from list/detail payloads without adding schema.
   - 2026-06-04 implementation note: native library queries, Smart Scope mixed-result sorting, and Smart Scope catalog previews now sort source-backed Ebook/Audio Library items by cache-derived metadata completeness scores without adding schema or exposing raw payloads.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support read-status includes/excludes/empty operators through existing user state, and OR groups keep supported source-backed predicates when mixed with local-only rules.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support rating comparison and empty/not-empty operators through existing per-user rating state, including numeric-string rule values, without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support unread/in-progress/finished progress operators through existing per-user progress state, with totals using the same user-state join as page rows.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope title filters now support not-contains and not-equals operators through native cached title matching without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope publisher filters now support includes/excludes set operators through exact cached publisher values without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support published-year numeric and empty/not-empty operators through cached raw publication metadata without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support page-count comparison, between, and empty/not-empty operators through cached raw page metadata and audiobook duration-derived virtual pages without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support metadata-score comparison, between, and empty/not-empty operators through the existing cache-derived score expression without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support format includes/excludes operators through exact cached format values without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support ISBN equality and empty/not-empty operators through cached identifiers and raw detail payloads without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support exact author membership includes/all/excludes and empty/not-empty operators through cached author arrays without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support exact genre membership includes/all/excludes and empty/not-empty operators through cached genre arrays without adding schema.
   - 2026-06-04 implementation note: source-backed Ebook/Audio Library Smart Scope filters now support exact tag membership includes/all/excludes and empty/not-empty operators through cached tag arrays without adding schema.
   - 2026-06-05 implementation note: Format Share Over Time now merges cached Ebook Library and Audio Library format timeline buckets with filesystem statistics using cached source timestamps and native top-format/OTHER grouping.
   - 2026-06-05 implementation note: Library Metadata Completeness now includes cached Ebook Library and Audio Library completeness rows beside filesystem libraries using cached catalog metadata without adding migrations.
   - 2026-06-05 implementation note: Page Count Distribution now merges cached Ebook Library and Audio Library page-count quantiles and unknown totals with filesystem statistics, using cached source page metadata and audiobook duration-derived virtual pages without adding migrations.
   - 2026-06-05 implementation note: Metadata Completeness now merges cached Ebook Library and Audio Library metadata presence counts with filesystem totals using cached catalog completeness aggregates without adding migrations.
   - 2026-06-05 implementation note: Metadata Freshness Gauge now merges cached Ebook Library and Audio Library freshness buckets with filesystem totals using cached source update/sync timestamps and identifier presence without adding migrations.
   - 2026-06-05 implementation note: Metadata Freshness Gauge now merges cached Ebook Library and Audio Library sync-age freshness buckets with filesystem metadata-fetch freshness buckets without adding schema.
   - 2026-06-05 implementation note: Library Integrity Gauge now merges cached Ebook Library and Audio Library inventory, format, and detail-row availability counts with filesystem integrity totals without adding schema.
   - 2026-06-05 implementation note: Acquisition Lag Scatter now merges cached Ebook Library and Audio Library source-added/published-year lag buckets with filesystem lag buckets without adding schema.
   - 2026-06-05 implementation note: Acquisition Lag Scatter now merges cached Ebook Library and Audio Library added-year versus published-year lag buckets with filesystem scatter rows without adding schema.
   - 2026-06-05 implementation note: Genre Cooccurrence now merges cached Ebook Library and Audio Library genre chord nodes and unordered pair links with filesystem co-occurrence data without adding schema.
   - 2026-06-05 implementation note: My Reading Completion Timeline and Goal Trajectory now merge Ebook Library and Audio Library monthly completions from cached user finished-state rows with filesystem monthly completions, preserving normal library filters and content filters without adding schema.
   - 2026-06-05 implementation note: My Reading Completion Latency now merges Ebook Library and Audio Library added-to-finished latency values from cached source-backed user state with filesystem latency values, preserving normal library filters and content filters without adding schema.
   - 2026-06-05 implementation note: My Reading Reading Survival now merges Ebook Library and Audio Library current/max progress from cached source-backed user state with filesystem session-derived max progress, preserving normal library filters and content filters without inventing source-backed session history.
   - 2026-06-05 implementation note: My Reading session-history-only charts (Completion Race, Session Archetypes, Genre Reading Time, Reading Pace, and Author/Genre Chord) now strip Ebook Library and Audio Library ids before querying filesystem reading sessions and return native empty chart data for source-backed-only scopes instead of leaking virtual ids into local SQL.
   - 2026-06-05 implementation note: My Reading Session Timeline and timeline drag/edit lookups now strip Ebook Library and Audio Library ids before querying filesystem reading sessions and return the native empty week/not-found behavior for source-backed-only scopes.
   - 2026-06-10 implementation note: Book Warehouse comics now enter BookOrbit as a first-class Comic Library (`/library/comics`) backed by locally cached catalog rows. Normal users get read/download/page-image and request routes only; admin/system comic import endpoints remain unexposed. Comic rows flow through native library browse, collections, dashboard/search-style aggregates, authors, series, smart scopes, and request labels without exposing upstream storage paths or `/media/` URLs.
   - 2026-06-10 implementation note: the Book Warehouse client now covers the normal-user comic series endpoints (`/comics/series`, `/comics/series/search`, and `/comics/series/:id/items`) with encoded ids, bounded pagination, `X-API-Key` auth, and sanitized DTOs.
   - 2026-06-11 implementation note: BookOrbit now exposes those comic series browse/search/items endpoints through native normal-user catalog routes under `/api/v1/catalog/comics/series...`, preserving safe empty pages when Book Warehouse is disabled and wrapping upstream failures in native media-unavailable copy.
   - 2026-06-11 implementation note: the direct Book Dock import UI route now carries `book_dock_access` metadata and the global auth guard enforces route permissions client-side, matching the server controller guard so normal users cannot browse import/admin surfaces.
   - 2026-06-11 implementation note: Comic Library collection membership now uses the same native source-backed collection ref flow as Ebook Library and Audio Library, including request validation, collection filtering, cached-item verification, and `Comic Library` card labels.
   - 2026-06-11 implementation note: Requests now expose a normal-user Request Comic dialog that submits the supported Book Warehouse comic request fields through native BookOrbit APIs and refreshes the Comics tab without exposing provider wording.
   - 2026-06-11 implementation note: Comic request status refresh now has normal-user parity with Audio Library requests through `/catalog/requests/comics/refresh`, syncing only the current user's mirrored upstream ids, preserving safe local metadata, notifying native request transitions, and triggering Comic Library sync when a completed remote id is missing locally.
   - 2026-06-11 implementation note: Server-side SPA route canonicalization now recognizes Comic Library ids and aliases, redirecting legacy `/library/-3`, reader paths, and `libraryId=comic/-3` query filters to the friendly `comics` route alias.
   - 2026-06-11 implementation note: Comic Library dashboard widget rows now preserve the `comic` media type through Neglected Gems and Long Wait aggregation, keeping normal-user read/download/request semantics and native Comic Library presentation without exposing admin/system comic import routes.
   - 2026-06-11 implementation note: Comic Library dashboard shelves and global search previews now use first-class comic media helpers for card imagery and labels, keeping normal browse/search surfaces aligned with the cached Comic Library rather than Ebook Library fallbacks.
   - 2026-06-11 implementation note: the native normal-user library namespace now includes Comic Library JSON aliases at `/api/v1/libraries/comics/items` and `/api/v1/libraries/comics/items/:remoteId`, delegating to sanitized cached catalog list/detail data alongside the existing page-image and download media routes.
   - 2026-06-11 implementation note: the generic normal-user request list now honors `mediaType=comic`, routing through the same current-user comic request sync/list path as the dedicated Comics tab instead of falling back to ebook request mirrors.
   - 2026-06-11 implementation note: Author detail source-backed book cards now render Comic Library rows with comic page-image covers, `Comic` detail labels, `CBZ` format fallback badges, and comic fallback icons instead of Ebook Library visual fallbacks.
   - 2026-06-11 implementation note: Series detail source-backed book cards now render Comic Library rows with comic page-image covers, `Comic` detail labels, `CBZ` grid fallback badges, and comic fallback icons instead of Ebook Library visual fallbacks.
   - 2026-06-11 implementation note: Source-backed catalog recommendation rows now render Comic Library recommendations with comic page-image covers, `Comic` fallback labels, and comic fallback icons instead of Ebook Library visual fallbacks.
   - 2026-06-11 implementation note: Smart Scope catalog preview cards now render Comic Library matches with comic page-image covers, `Comic` fallback labels, and comic fallback icons instead of Ebook Library visual fallbacks.
   - 2026-06-11 implementation note: Collection mixed grid, list, and table views now render no-cover Comic Library rows with the comic fallback icon instead of the ebook icon while preserving existing comic cover, label, and format helpers.
   - 2026-06-11 implementation note: completed Comic Library request rows now expose native archive downloads through `/api/v1/libraries/comics/items/:remoteId/download` when Book Warehouse returns a completed remote id, matching normal Comic Library download behavior without exposing admin import routes.
   - 2026-06-11 implementation note: Smart Scope mixed grid and list views now render no-cover Comic Library rows with the comic fallback icon instead of the ebook icon while leaving table rows unchanged because that branch has no cover/icon cell.
   - 2026-06-11 implementation note: guarded library viewer routes now accept Comic Library as a read-only source-backed library, matching Ebook Library and Audio Library access behavior while continuing to reject editor/owner access.
   - 2026-06-11 implementation note: router regression coverage now locks Comic Library title resolution, legacy `-3` URL normalization, `comic`/`comics` route aliases, and `libraryId=comics` query parsing to the same friendly route behavior as Ebook Library and Audio Library.
   - 2026-06-11 implementation note: Highlight of the Day now renders source-backed Comic Library highlights through the native comic page-image route instead of the Ebook Library cover proxy while preserving native quick-detail and item-detail routing.
   - 2026-06-11 implementation note: shared catalog item route regression coverage now locks `mediaType=comic` to the native Comic Library `comics` route for item details and reader links, preventing helper consumers from falling back to Ebook Library routes.
   - 2026-06-11 implementation note: global search and dashboard source-backed shelves now render no-cover Comic Library rows with comic fallback icons in both desktop/mobile search results and dashboard shelf cards instead of ebook icons.
   - 2026-06-11 implementation note: the shared source-backed browse view now treats `mediaType=comic` as Comic Library, using `-3`/`comics` routing, comic page-image covers, comic icons, and `comic` count copy instead of falling back to Ebook Library behavior.
   - 2026-06-11 implementation note: the Comic Library enum migration is now listed in Drizzle's migration journal, so runtime installs apply `warehouse_media_type='comic'` and `warehouse_sync_media_type='comic'` before comic catalog syncs. Local compose smoke verified a normal-user Comic Library sync cached 4,824 rows, rendered `/library/comics`, opened quick view/reader routes, returned JSON-only page metadata, proxied page/archive range reads with `206`, allowed normal request access, and rejected normal-user admin sync with `403`.
10. Kobo, KOReader, OPDS, and ABS-style remote-aware compatibility. OPDS catalog ebook acquisition feed and merged OPDS catalog/search/recent ebook coverage completed 2026-06-03; Kobo catalog ebook compatibility completed 2026-06-03; KOReader catalog ebook progress compatibility completed 2026-06-03; ABS-style read-only owned audiobook item mapping completed 2026-06-03.
    - 2026-06-04 implementation note: OPDS root navigation and OpenSearch descriptions now describe merged local/source-backed inventory as the user's library instead of a catalog while preserving stable OPDS `/catalog` route URLs and MIME types.
    - 2026-06-04 implementation note: source-backed library item and media availability failures now share native library copy across web catalog routes, OPDS, Kobo, request stream proxies, and user-state writes while keeping internal catalog route names stable.
11. Admin cache status, refresh, repair, materialization rebuild, and telemetry. Aggregate cover cache status, clear action, and admin cache UI completed 2026-06-03.
12. Performance pass: indexes, bounded dashboard windows, stream/download memory checks, and route-level observability. Ebook and audiobook cover cache completed 2026-06-03.

## Open Decisions

- Whether BookOrbit should support multiple Book Warehouse connection profiles in the first release or keep the schema future-ready with one active profile.
- Whether local source-backed items should reuse `books`/`book_files` rows immediately or stay in warehouse-specific tables until a later unification pass.
- Whether completed requests should auto-add synced source-backed items to the requesting user's native BookOrbit library by default.

## Source Links

- Book Warehouse home: https://wiki-bookwarehouse.zenterprise.org/
- Authentication: https://wiki-bookwarehouse.zenterprise.org/getting-started/authentication/
- Books: https://wiki-bookwarehouse.zenterprise.org/books/
- Audiobooks: https://wiki-bookwarehouse.zenterprise.org/audiobooks/
- Genres: https://wiki-bookwarehouse.zenterprise.org/genres/
- External search: https://wiki-bookwarehouse.zenterprise.org/search/
- Request a book: https://wiki-bookwarehouse.zenterprise.org/requests/
- Request an audiobook: https://wiki-bookwarehouse.zenterprise.org/requests-audiobook/
- Endpoint index: https://wiki-bookwarehouse.zenterprise.org/reference/endpoint-index/
- Errors: https://wiki-bookwarehouse.zenterprise.org/reference/errors/
- Grimmory ADR reference: /Users/jonathanfinley/Developer/GitHub/relictiohosting/grimmory/docs/adr/0001-synced-warehouse-catalog-and-abs-boundary.md
- Grimmory audiobook request PRD: /Users/jonathanfinley/Developer/GitHub/relictiohosting/grimmory/docs/prds/warehouse-audiobook-requests.md
- Grimmory performance PRD: /Users/jonathanfinley/Developer/GitHub/relictiohosting/grimmory/docs/prds/warehouse-dashboard-performance-ux-optimizations.md
