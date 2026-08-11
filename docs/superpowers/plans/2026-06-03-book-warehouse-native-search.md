# Book Warehouse Native Search Plan

**Goal:** Make owned synced catalog ebooks and audiobooks participate in BookOrbit global search without exposing the upstream warehouse implementation to regular users.

**Architecture:** Keep global search on local cached SQL data. Search regular local books through `BookRepository.searchAcrossLibraries()` and user-owned synced catalog items through `WarehouseRepository.searchUserCatalogItems()`, then merge them into a typed shared `GlobalSearchResult` union. Client search renders local books and catalog items distinctly while preserving native BookOrbit copy and routes catalog items to a small native detail view.

**Scope:**

- Add SQL-backed owned catalog item search over `warehouse_user_items` joined to `warehouse_catalog_items`.
- Return typed local book and catalog item results from `/api/v1/books/search`.
- Update the app header search dropdown to render and navigate both result types.
- Add a native catalog item detail route with library/favorite/rating/read-state controls and audiobook stream/download actions.

**Out of scope for this loop:**

- Dashboard shelves, smart scopes, recommendations, collections, Kobo, KOReader, OPDS, and reader session parity.
- Live external discovery from global search.
- Exposing raw remote IDs, upstream URLs, API keys, or provider wording in normal user-facing UI.

## Tasks

1. **Repository Search**
   - [x] Add `WarehouseRepository.searchUserCatalogItems(userId, q, limit)`.
   - [x] Scope results through `warehouse_user_items.user_id`.
   - [x] Search title, authors, narrators, series, identifiers, format, language, and publisher from cached rows.

2. **Global Search API**
   - [x] Add shared `GlobalSearchResult` union types.
   - [x] Inject the catalog repository into `BookService`.
   - [x] Merge local book and owned catalog hits, sort by title, and cap to the requested limit.

3. **Client Search And Detail**
   - [x] Use the shared search result type in `useGlobalSearch`.
   - [x] Add pure helpers for result keys and routes.
   - [x] Render local book covers, catalog audiobook covers, and media placeholders in `AppHeader`.
   - [x] Add `/catalog/:mediaType/:remoteId` native detail route.
   - [x] Add `CatalogItemDetailView` with safe metadata, user state controls, and audiobook media actions.

4. **Verification**
   - [x] Focused repository, service, route-helper, and router tests pass.
   - [x] Typecheck passes.
   - [x] Lint passes.
   - [x] Final full verification passes.

## Acceptance Criteria

- Global search includes only catalog items the current user has added to their library.
- Global search uses local cached SQL rows and does not perform live external discovery.
- Search results do not overload local book IDs with remote catalog IDs.
- User-visible copy uses native BookOrbit concepts such as Catalog, Library, Ebook, Audiobook, Listen, Download, Favorite, and Read status.
- Catalog item detail surfaces do not show upstream IDs, URLs, API keys, or provider/warehouse wording.
