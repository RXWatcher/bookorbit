# Meilisearch integration, phase 1: a unified book index

Date: 2026-08-11
Status: Approved design, not yet planned

## Problem

Search is implemented three times in this codebase and none of the copies can do what a
search engine does.

1. `buildCatalogSearchWhere` in `warehouse.repository.ts`, used by `queryUserCatalogItems`.
2. The three list builders, `buildEbookCatalogWhere`, `buildComicCatalogWhere` and
   `buildAudiobookCatalogWhere`, which each carried their own duplicated copy until they were
   unified on 2026-08-10.
3. `BookService.globalQuery`, which merges local books with each catalogue media type and then
   **re-sorts the merged list in JavaScript**, discarding whatever order the database produced.

Layer 3 is the one that decides what a user sees, and it is why a fix applied only to the SQL
never reached the UI. Searching "The Will of Many" returned nothing when the catalogue held
"The Will of the Many"; after word matching was added it returned the book third, below
unrelated titles sharing the same words.

The current implementation, after that work, uses ILIKE per word plus a hand written relevance
tier list and a shorter-title tiebreak. It cannot do typo tolerance at all.

Measured against the live catalogue:

| Capability                        | ILIKE, today           | Postgres FTS                                                         | Meilisearch     |
| --------------------------------- | ---------------------- | -------------------------------------------------------------------- | --------------- |
| "The Will of Many" finds the book | yes, after three fixes | **no**, `will` is an english stopword so the query reduces to `mani` | yes             |
| Typo "Islingtn" finds Islington   | no                     | no                                                                   | yes             |
| Ranking                           | hand written tiers     | `ts_rank`, wrong for stopword titles                                 | built in        |
| Author versus title priority      | special cased          | attribute weights                                                    | attribute order |

Postgres FTS was tested and rejected: `plainto_tsquery('english', 'The Will of Many')` produces
the single lexeme `'mani'`, because "will" is a modal verb in the english dictionary. Book
titles are frequently built from stopwords, so FTS is the wrong primary matcher here.

## Verified environment

Checked on 2026-08-11, not assumed:

- **CT115 `silo-meilisearch`**, 8 cores, 32GB RAM, Meilisearch **1.48.3**.
- Reachable from CT139: `GET /health` returns 200.
- Existing load: one index, `silo_media_items_rebuild_1785187701`, 1,584,819 documents, 16GB.
- Headroom: 583MB of 32GB memory in use, 17G of 98G disk.
- BookOrbit's catalogue is 410,095 rows, roughly a quarter of what that server already holds.

Capacity is not a constraint. The API key is encrypted at rest under silo's `SECRET_KEY`
with AAD `server_settings:<key>`, so it is readable but must not be reused (see Security).

## Goals

1. One ranked result list for a search, instead of a JavaScript merge of separately sorted
   sources.
2. Typo tolerance and real relevance ranking.
3. Search continues to work when Meilisearch does not.

## Non-goals for phase 1

- Author and series indexes. Those browse pages keep using SQL. Phase 2.
- Semantic or hybrid search. Silo already has an embedder named `silo_recommendations` and
  BookOrbit's database has pgvector, so this is available later. Phase 3.
- Replacing the SQL search code. It stays as the fallback.

## Architecture

### One index for both book sources

The single most valuable change is that `books` and `warehouse_catalog_items` become documents
in the same index. `globalQuery`'s JavaScript merge and re-sort then has nothing to do: Meili
returns one list, already ranked, already paginated.

Native `books` is empty on the production instance today. It is still indexed, because
indexing it is what removes the merge, and the merge is the defect.

Index name: `bookorbit_books`. Document id: `catalog:<mediaType>:<remoteId>` for catalogue rows
and `native:<bookId>` for native rows, so the two namespaces cannot collide.

Document fields: `source`, `mediaType`, `title`, `sortTitle`, `authors`, `narrators`, `series`,
`seriesIndex`, `publisher`, `language`, `tags`, `genres`, `identifiers`, `format`,
`publishedYear`, `hasCover`, `durationSeconds`, `fileSizeBytes`, `libraryId`, `addedAt`,
`syncedAt`.

`rawPayload` is deliberately excluded. It is large, and nothing in the read path reads it.

### Settings

- `searchableAttributes`, in this order: `title`, `sortTitle`, `authors`, `series`, `narrators`,
  `publisher`, `tags`, `genres`, `identifiers`. Meili ranks by attribute position, so this is
  what makes a title match outrank a publisher match. It replaces the hand written tier list
  and fixes the author versus title case structurally.
- `filterableAttributes`: `mediaType`, `source`, `language`, `format`, `publishedYear`,
  `libraryId`, `hasCover`.
- `sortableAttributes`: `sortTitle`, `publishedYear`, `addedAt`, `durationSeconds`.
- Typo tolerance: Meili's defaults.
- Ranking rules: Meili's defaults (`words`, `typo`, `proximity`, `attribute`, `sort`,
  `exactness`).

### Provider interface and fallback

```ts
interface BookSearchProvider {
  readonly name: "meilisearch" | "sql";
  isAvailable(): Promise<boolean>;
  search(query: BookSearchQuery): Promise<BookSearchPage>;
}
```

`BookSearchService` holds both implementations. It calls Meili when the integration is enabled
and healthy, and falls through to the SQL provider on a disabled setting, a connection error,
or a timeout. Every fallback is logged at warn with the reason, so silent degradation is
visible.

The SQL provider is the existing search path, extracted behind the interface rather than
rewritten. That keeps the fallback honest: it is the code that is running today.

### Sync, using an outbox

Silo's pattern, which is proven on 1.58M documents:

- `search_index_events` table: `(id, entity_type, entity_id, operation, enqueued_at)`.
- Rows are enqueued **in the same transaction** as the data change: catalogue sync upserts,
  local scan inserts, enrichment updates, native book writes. Transactional enqueue is what
  prevents drift, and drift is the main risk of a second source of truth.
- A background drainer batches events to Meili and deletes what it has applied.
- `rebuild()` writes a fresh `bookorbit_books_rebuild_<timestamp>` index, then flips the active
  index name in settings. Meili has no alias, so the settings pointer is the swap. This mirrors
  what silo does, which is why its live index carries a `_rebuild_` name.

Failure handling: a drain failure leaves events in the table and retries on the next tick, so
the outbox is the retry queue. A rebuild that fails leaves the old index active and untouched.

### Configuration

Stored in `app_settings`, following the existing `metadata_provider_config` pattern:
url, active index name, enabled flag, and the API key.

## Security

BookOrbit gets its **own index-scoped key**, created through Meili's `/keys` API and limited to
`bookorbit_books*`. It must not reuse silo's master key: a bug or a leak in BookOrbit would
otherwise be able to modify or delete silo's 1.58M-document index.

The key is a credential and must be stored encrypted, using the same
`apiKeyEncrypted`/`apiKeyNonce`/`apiKeyTag` scheme `warehouse_settings` already uses. It must
not be returned in plaintext by any endpoint. Note that the existing
`GET /api/v1/metadata-preferences/providers` returns provider API keys in clear text, which is
a separate defect and should not be copied.

## Testing

- Document mapping: a catalogue row and a native book row each produce the expected document,
  with the expected id namespace.
- Provider fallback: Meili unavailable, Meili timing out, and integration disabled all fall
  through to SQL and log the reason.
- Outbox: a catalogue upsert and a local scan insert each enqueue an event; a failed drain
  leaves the events in place.
- Ranking, as an integration test against a real index seeded with the known cases:
  "The Will of Many" ranks "The Will of the Many" first, and "Islingtn" finds Islington. These
  are the two failures that motivated the work, so they belong in the suite.
- Rebuild and swap: the active index name only changes after the new index is fully populated.

## Risks

| Risk                                         | Mitigation                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Index drifts from the database               | Transactional outbox rather than best effort writes, plus a rebuild command to resynchronise                                             |
| CT115 becomes a hard dependency              | SQL fallback, which is the code path running today                                                                                       |
| BookOrbit damages silo's index               | Index scoped key, separate index, never the master key                                                                                   |
| Fork divergence makes upstream merges harder | Confined to a new module plus a provider seam in `BookService`; the v2.5.0 merge cost 83 conflicts, so keeping the surface small matters |
| Two search behaviours to reason about        | Fallback is logged, and the admin UI shows which provider served the last search                                                         |

## Open questions

None blocking. Phase 2 and phase 3 are deliberately deferred.
