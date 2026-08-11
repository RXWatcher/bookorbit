# Meilisearch Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve BookOrbit search from one Meilisearch index holding both book sources, with typo tolerance and real ranking, falling back to the existing SQL search when Meilisearch is unavailable.

**Architecture:** A `BookSearchProvider` interface with two implementations, Meilisearch and the existing SQL path. Documents from `warehouse_catalog_items` and `books` share one index, which removes the JavaScript merge in `BookService.globalQuery`. Index freshness comes from a transactional outbox table drained by a background job, plus a rebuild command that writes a new index and flips a settings pointer.

**Tech Stack:** NestJS 11 (Fastify), Drizzle ORM, PostgreSQL, Meilisearch 1.48.3, Vitest, pnpm workspace.

## Global Constraints

- Tables under `warehouse_*` and any new table referencing `warehouse_media_type` live in the hand managed lineage `server/src/db/warehouse-migrations/`, NOT `server/src/db/migrations/`. Hand write the SQL following the existing hand written migrations there, and add a `_journal.json` entry. Do not run `pnpm db:generate` for them. Do not add a snapshot file.
- There is no local PostgreSQL in this environment, so `pnpm db:migrate` cannot run and must NOT be attempted. Migrations are committed unapplied.
- The Meilisearch server is the search host at `http://<meili-host>:7700`, version 1.48.3. It already holds the other product's index. Do not run destructive Meili operations against it during development.
- Never use em dashes in any output: code, comments, strings, commit messages, docs.
- Never add a `Co-authored-by` trailer to any commit. Hard repo rule.
- Test files use `.test.ts`. Vitest globals are available, so do not import `describe`, `it`, `expect` or `vi`.
- Use `vi.fn()`, `vi.mock()`, `vi.spyOn()`. Never `jest.*`.
- Log format: `[event] [phase] key=value ... - short message`, phases are `[start]`, `[end]`, `[fail]` only.
- Wrap any dynamic value inside a quoted log field with `sanitizeLogValue()` from `server/src/common/utils/log-sanitize.utils`.
- Throw NestJS `HttpException` subclasses, never raw `Error`.
- Never add unnecessary comments. Only genuinely non-obvious logic gets one.
- Run `npx prettier --write .` and `npx eslint .` in `server/` before every commit.
- `npx prettier --write .` in `server/` reformats `server/src/db/warehouse-migrations/meta/0047_snapshot.json` as a side effect. If it shows modified, revert it with `git checkout -- server/src/db/warehouse-migrations/meta/0047_snapshot.json` and do NOT commit it.
- One test fails on a clean tree and is NOT yours to fix: `src/modules/warehouse/warehouse-catalog.mapper.test.ts` "tolerates missing optional fields".
- The API key is a credential. It is stored encrypted and must never be returned in plaintext by any endpoint.

## File Structure

| File                                                                  | Responsibility                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `server/src/db/schema/search-index.ts`                                | `searchIndexEvents` outbox table                                                |
| `server/src/db/warehouse-migrations/0054_add_search_index_events.sql` | Hand written migration for it                                                   |
| `server/src/modules/book-search/book-search.types.ts`                 | `BookSearchDocument`, `BookSearchQuery`, `BookSearchPage`, `BookSearchProvider` |
| `server/src/modules/book-search/book-search-document.mapper.ts`       | Catalogue row and native book row to document                                   |
| `server/src/modules/book-search/meilisearch.client.ts`                | Thin HTTP client: settings, documents, search, index create                     |
| `server/src/modules/book-search/meilisearch.provider.ts`              | `BookSearchProvider` over the client                                            |
| `server/src/modules/book-search/sql-search.provider.ts`               | `BookSearchProvider` over the existing SQL path                                 |
| `server/src/modules/book-search/book-search.service.ts`               | Provider selection and fallback                                                 |
| `server/src/modules/book-search/search-index.repository.ts`           | Outbox enqueue, claim, delete; document loading                                 |
| `server/src/modules/book-search/search-indexer.service.ts`            | Outbox drain and rebuild with swap                                              |
| `server/src/modules/book-search/book-search.settings.ts`              | Read and write encrypted settings in `app_settings`                             |
| `server/src/modules/book-search/book-search.controller.ts`            | Admin status, rebuild trigger, connection test                                  |
| `server/src/modules/book-search/book-search.module.ts`                | Wiring                                                                          |

---

### Task 1: Outbox table

**Files:**

- Create: `server/src/db/schema/search-index.ts`
- Create: `server/src/db/warehouse-migrations/0054_add_search_index_events.sql`
- Modify: `server/src/db/schema/index.ts`
- Modify: `server/src/db/warehouse-migrations/meta/_journal.json`
- Test: `server/src/db/schema/schema.test.ts`

**Interfaces:**

- Produces: `searchIndexEvents` table with columns `id`, `entityType`, `entityId`, `operation`, `enqueuedAt`; `searchIndexEntityTypeEnum` with values `['catalog_item', 'native_book']`; `searchIndexOperationEnum` with values `['upsert', 'delete']`.

- [ ] **Step 1: Write the failing test**

Append to `server/src/db/schema/schema.test.ts`:

```typescript
describe("searchIndexEvents", () => {
  it("records what changed and how, one row per change", () => {
    expect(searchIndexEntityTypeEnum.enumValues).toEqual([
      "catalog_item",
      "native_book",
    ]);
    expect(searchIndexOperationEnum.enumValues).toEqual(["upsert", "delete"]);
    expect(searchIndexEvents.entityId.notNull).toBe(true);
    expect(searchIndexEvents.enqueuedAt.notNull).toBe(true);
  });
});
```

Add `searchIndexEvents`, `searchIndexEntityTypeEnum` and `searchIndexOperationEnum` to the existing named import from `./index` at the top of that file, matching how the other tables are imported there.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/schema/schema.test.ts -t 'records what changed'`
Expected: FAIL, the names are not exported.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/db/schema/search-index.ts`:

```typescript
import {
  index,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const searchIndexEntityTypeEnum = pgEnum("search_index_entity_type", [
  "catalog_item",
  "native_book",
]);

export const searchIndexOperationEnum = pgEnum("search_index_operation", [
  "upsert",
  "delete",
]);

export const searchIndexEvents = pgTable(
  "search_index_events",
  {
    id: serial("id").primaryKey(),
    entityType: searchIndexEntityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    operation: searchIndexOperationEnum("operation").notNull(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("search_index_events_enqueued_idx").on(t.enqueuedAt, t.id)],
);
```

Add to `server/src/db/schema/index.ts`, following the existing re-export style:

```typescript
export * from "./search-index";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/schema/schema.test.ts -t 'records what changed'`
Expected: PASS.

- [ ] **Step 5: Hand write the migration**

Do NOT run `pnpm db:generate` or `pnpm db:migrate`.

Create `server/src/db/warehouse-migrations/0054_add_search_index_events.sql`:

```sql
-- Outbox for the search index. Rows are written in the same transaction as the data change,
-- so the index cannot silently drift from the database, and a failed drain simply retries.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'search_index_entity_type') THEN
    CREATE TYPE "search_index_entity_type" AS ENUM ('catalog_item', 'native_book');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'search_index_operation') THEN
    CREATE TYPE "search_index_operation" AS ENUM ('upsert', 'delete');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "search_index_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" "search_index_entity_type" NOT NULL,
  "entity_id" text NOT NULL,
  "operation" "search_index_operation" NOT NULL,
  "enqueued_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "search_index_events_enqueued_idx"
  ON "search_index_events" ("enqueued_at", "id");
```

Append to `server/src/db/warehouse-migrations/meta/_journal.json`, matching the shape of the existing entries exactly:

```json
{
  "idx": 54,
  "version": "7",
  "when": 1786106000000,
  "tag": "0054_add_search_index_events",
  "breakpoints": true
}
```

Confirm the file is still valid JSON after editing. Do not add a snapshot file.

- [ ] **Step 6: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git checkout -- src/db/warehouse-migrations/meta/0047_snapshot.json
cd .. && git add server/src/db/schema server/src/db/warehouse-migrations
git commit -m "feat(search): add the search index outbox table"
```

---

### Task 2: Search types and the document mapper

**Files:**

- Create: `server/src/modules/book-search/book-search.types.ts`
- Create: `server/src/modules/book-search/book-search-document.mapper.ts`
- Test: `server/src/modules/book-search/book-search-document.mapper.test.ts`

**Interfaces:**

- Produces:
  - `type BookSearchSource = 'catalog' | 'native'`
  - `interface BookSearchDocument { id: string; source: BookSearchSource; mediaType: string; title: string; sortTitle: string | null; authors: string[]; narrators: string[]; series: string | null; seriesIndex: number | null; publisher: string | null; language: string | null; tags: string[]; genres: string[]; identifiers: string[]; format: string | null; publishedYear: number | null; hasCover: boolean; durationSeconds: number | null; fileSizeBytes: number | null; libraryId: number | null; addedAt: number | null }`
  - `interface BookSearchQuery { q: string; page: number; size: number; mediaTypes?: string[]; libraryIds?: number[] }`
  - `interface BookSearchPage { ids: string[]; total: number; page: number; size: number }`
  - `interface BookSearchProvider { readonly name: 'meilisearch' | 'sql'; isAvailable(): Promise<boolean>; search(query: BookSearchQuery): Promise<BookSearchPage> }`
  - `catalogDocumentId(mediaType: string, remoteId: string): string`
  - `nativeDocumentId(bookId: number): string`
  - `mapCatalogRowToDocument(row: CatalogDocumentRow): BookSearchDocument`
  - `mapNativeBookToDocument(row: NativeDocumentRow): BookSearchDocument`

`NativeDocumentRow` mirrors what the native stream can cheaply produce. The `books` table holds
no title: it lives in `book_metadata`, and format and size live on `book_files`. So the row
type carries `format`, `hasCover` and `fileSizeBytes` as nullable and phase 1 leaves them
empty rather than adding two more joins.

Note `identifiers` is a `string[]` in the document even though the database column is a JSON object. Meili searches arrays of strings well and does not need the keys, so the mapper flattens values.

`BookSearchPage` returns ids only. The service already knows how to load rows by id, and returning ids keeps the provider seam narrow.

- [ ] **Step 1: Write the failing test**

```typescript
import {
  catalogDocumentId,
  mapCatalogRowToDocument,
  mapNativeBookToDocument,
  nativeDocumentId,
} from "./book-search-document.mapper";

const CATALOG_ROW = {
  mediaType: "audiobook",
  remoteId: "abc-123",
  title: "The Will of the Many",
  sortTitle: "Will of the Many, The",
  authors: ["James Islington"],
  narrators: ["Euan Morton"],
  series: "Hierarchy",
  seriesIndex: 1,
  publisher: "Saga Press",
  language: "english",
  tags: ["fantasy"],
  genres: ["Fiction"],
  identifiers: { isbn: "9781250767000", asin: "B0BS3K9T2Z" },
  format: "m4b",
  publishedYear: 2023,
  hasCover: true,
  durationSeconds: 91234,
  fileSizeBytes: 512000,
  syncedAt: new Date("2026-08-01T00:00:00Z"),
};

describe("book search document mapper", () => {
  it("namespaces catalogue and native ids so they cannot collide", () => {
    expect(catalogDocumentId("audiobook", "abc-123")).toBe(
      "catalog:audiobook:abc-123",
    );
    expect(nativeDocumentId(42)).toBe("native:42");
  });

  it("maps a catalogue row onto the document shape", () => {
    const doc = mapCatalogRowToDocument(CATALOG_ROW);

    expect(doc.id).toBe("catalog:audiobook:abc-123");
    expect(doc.source).toBe("catalog");
    expect(doc.title).toBe("The Will of the Many");
    expect(doc.authors).toEqual(["James Islington"]);
    expect(doc.narrators).toEqual(["Euan Morton"]);
    expect(doc.libraryId).toBeNull();
  });

  it("flattens identifiers to values, because the keys are not searched", () => {
    expect(mapCatalogRowToDocument(CATALOG_ROW).identifiers).toEqual([
      "9781250767000",
      "B0BS3K9T2Z",
    ]);
  });

  it("tolerates a sparse row rather than throwing", () => {
    const doc = mapCatalogRowToDocument({
      mediaType: "ebook",
      remoteId: "x",
      title: "Bare",
      sortTitle: null,
      authors: [],
      narrators: [],
      series: null,
      seriesIndex: null,
      publisher: null,
      language: null,
      tags: [],
      genres: [],
      identifiers: {},
      format: null,
      publishedYear: null,
      hasCover: false,
      durationSeconds: null,
      fileSizeBytes: null,
      syncedAt: null,
    });

    expect(doc.title).toBe("Bare");
    expect(doc.identifiers).toEqual([]);
    expect(doc.addedAt).toBeNull();
  });

  it("maps a native book, carrying its library id", () => {
    const doc = mapNativeBookToDocument({
      id: 42,
      libraryId: 7,
      title: "Local Book",
      sortTitle: null,
      authors: ["Someone"],
      series: null,
      seriesIndex: null,
      publisher: null,
      language: "en",
      format: "epub",
      publishedYear: 2001,
      hasCover: true,
      fileSizeBytes: 100,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(doc.id).toBe("native:42");
    expect(doc.source).toBe("native");
    expect(doc.mediaType).toBe("ebook");
    expect(doc.libraryId).toBe(7);
    expect(doc.narrators).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/book-search-document.mapper.test.ts`
Expected: FAIL, cannot find module `./book-search-document.mapper`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/modules/book-search/book-search.types.ts`:

```typescript
export type BookSearchSource = "catalog" | "native";

export interface BookSearchDocument {
  id: string;
  source: BookSearchSource;
  mediaType: string;
  title: string;
  sortTitle: string | null;
  authors: string[];
  narrators: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  language: string | null;
  tags: string[];
  genres: string[];
  identifiers: string[];
  format: string | null;
  publishedYear: number | null;
  hasCover: boolean;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  libraryId: number | null;
  addedAt: number | null;
}

export interface BookSearchQuery {
  q: string;
  page: number;
  size: number;
  mediaTypes?: string[];
  libraryIds?: number[];
}

export interface BookSearchPage {
  ids: string[];
  total: number;
  page: number;
  size: number;
}

export interface BookSearchProvider {
  readonly name: "meilisearch" | "sql";
  isAvailable(): Promise<boolean>;
  search(query: BookSearchQuery): Promise<BookSearchPage>;
}
```

Create `server/src/modules/book-search/book-search-document.mapper.ts`:

```typescript
import type { BookSearchDocument } from "./book-search.types";

export interface CatalogDocumentRow {
  mediaType: string;
  remoteId: string;
  title: string;
  sortTitle: string | null;
  authors: string[];
  narrators: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  language: string | null;
  tags: string[];
  genres: string[];
  identifiers: Record<string, string>;
  format: string | null;
  publishedYear: number | null;
  hasCover: boolean;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  syncedAt: Date | null;
}

export interface NativeDocumentRow {
  id: number;
  libraryId: number;
  title: string;
  sortTitle: string | null;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  language: string | null;
  format: string | null;
  publishedYear: number | null;
  hasCover: boolean;
  fileSizeBytes: number | null;
  createdAt: Date | null;
}

export function catalogDocumentId(mediaType: string, remoteId: string): string {
  return `catalog:${mediaType}:${remoteId}`;
}

export function nativeDocumentId(bookId: number): string {
  return `native:${bookId}`;
}

/** Meili searches arrays of strings, and the identifier keys carry no query value. */
function identifierValues(
  identifiers: Record<string, string> | null | undefined,
): string[] {
  if (!identifiers) return [];
  return Object.values(identifiers).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function mapCatalogRowToDocument(
  row: CatalogDocumentRow,
): BookSearchDocument {
  return {
    id: catalogDocumentId(row.mediaType, row.remoteId),
    source: "catalog",
    mediaType: row.mediaType,
    title: row.title,
    sortTitle: row.sortTitle,
    authors: row.authors ?? [],
    narrators: row.narrators ?? [],
    series: row.series,
    seriesIndex: row.seriesIndex,
    publisher: row.publisher,
    language: row.language,
    tags: row.tags ?? [],
    genres: row.genres ?? [],
    identifiers: identifierValues(row.identifiers),
    format: row.format,
    publishedYear: row.publishedYear,
    hasCover: row.hasCover,
    durationSeconds: row.durationSeconds,
    fileSizeBytes: row.fileSizeBytes,
    libraryId: null,
    addedAt: row.syncedAt ? row.syncedAt.getTime() : null,
  };
}

export function mapNativeBookToDocument(
  row: NativeDocumentRow,
): BookSearchDocument {
  return {
    id: nativeDocumentId(row.id),
    source: "native",
    mediaType: "ebook",
    title: row.title,
    sortTitle: row.sortTitle,
    authors: row.authors ?? [],
    narrators: [],
    series: row.series,
    seriesIndex: row.seriesIndex,
    publisher: row.publisher,
    language: row.language,
    tags: [],
    genres: [],
    identifiers: [],
    format: row.format,
    publishedYear: row.publishedYear,
    hasCover: row.hasCover,
    durationSeconds: null,
    fileSizeBytes: row.fileSizeBytes,
    libraryId: row.libraryId,
    addedAt: row.createdAt ? row.createdAt.getTime() : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/book-search-document.mapper.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src/modules/book-search
git commit -m "feat(search): add search document types and mapper"
```

---

### Task 3: Meilisearch HTTP client

**Files:**

- Create: `server/src/modules/book-search/meilisearch.client.ts`
- Test: `server/src/modules/book-search/meilisearch.client.test.ts`

**Interfaces:**

- Consumes: `BookSearchDocument` from Task 2.
- Produces: `class MeilisearchClient` constructed as `new MeilisearchClient({ url: string; apiKey: string; timeoutMs?: number })`, with methods:
  - `health(): Promise<boolean>`
  - `applySettings(index: string): Promise<void>`
  - `addDocuments(index: string, documents: BookSearchDocument[]): Promise<void>`
  - `deleteDocuments(index: string, ids: string[]): Promise<void>`
  - `search(index: string, params: { q: string; offset: number; limit: number; filter?: string[] }): Promise<{ ids: string[]; total: number }>`

The client uses the global `fetch` per the repo's HTTP convention. No Meilisearch SDK dependency is added, because the surface used here is five endpoints and a dependency would be a larger fork divergence than the code it saves.

- [ ] **Step 1: Write the failing test**

```typescript
import { MeilisearchClient } from "./meilisearch.client";

function mockFetch(
  handler: (
    url: string,
    init: RequestInit,
  ) => { status?: number; body?: unknown },
) {
  return vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const { status = 200, body = {} } = handler(url, init);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });
}

describe("MeilisearchClient", () => {
  it("reports health from the health endpoint", async () => {
    const fetchMock = mockFetch(() => ({ body: { status: "available" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new MeilisearchClient({ url: "http://meili:7700", apiKey: "k" }).health(),
    ).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("http://meili:7700/health");
  });

  it("reports unhealthy rather than throwing when the server errors", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ status: 500 })),
    );

    await expect(
      new MeilisearchClient({ url: "http://meili:7700", apiKey: "k" }).health(),
    ).resolves.toBe(false);
  });

  it("sends the api key as a bearer token", async () => {
    const fetchMock = mockFetch(() => ({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await new MeilisearchClient({
      url: "http://meili:7700",
      apiKey: "secret-key",
    }).addDocuments("books", []);

    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer secret-key");
  });

  it("puts documents on the index documents endpoint", async () => {
    const fetchMock = mockFetch(() => ({ body: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await new MeilisearchClient({
      url: "http://meili:7700",
      apiKey: "k",
    }).addDocuments("books", []);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://meili:7700/indexes/books/documents",
    );
  });

  it("returns hit ids and the estimated total from a search", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({
        body: {
          hits: [{ id: "catalog:ebook:1" }, { id: "native:2" }],
          estimatedTotalHits: 2,
        },
      })),
    );

    await expect(
      new MeilisearchClient({ url: "http://meili:7700", apiKey: "k" }).search(
        "books",
        { q: "dune", offset: 0, limit: 10 },
      ),
    ).resolves.toEqual({ ids: ["catalog:ebook:1", "native:2"], total: 2 });
  });

  it("raises a bad gateway when the server rejects a write", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ status: 403, body: { message: "invalid api key" } })),
    );

    await expect(
      new MeilisearchClient({
        url: "http://meili:7700",
        apiKey: "bad",
      }).addDocuments("books", []),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/meilisearch.client.test.ts`
Expected: FAIL, cannot find module `./meilisearch.client`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { BadGatewayException } from "@nestjs/common";

import type { BookSearchDocument } from "./book-search.types";

interface MeilisearchClientOptions {
  url: string;
  apiKey: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class MeilisearchClient {
  constructor(private readonly options: MeilisearchClientOptions) {}

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${this.options.url}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `Search server returned ${response.status}`,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.request<{ status: string }>("/health", { method: "GET" });
      return true;
    } catch {
      return false;
    }
  }

  /** Attribute order is the ranking lever: a title match outranks a publisher match. */
  async applySettings(index: string): Promise<void> {
    await this.request(`/indexes/${index}/settings`, {
      method: "PATCH",
      body: {
        searchableAttributes: [
          "title",
          "sortTitle",
          "authors",
          "series",
          "narrators",
          "publisher",
          "tags",
          "genres",
          "identifiers",
        ],
        filterableAttributes: [
          "mediaType",
          "source",
          "language",
          "format",
          "publishedYear",
          "libraryId",
          "hasCover",
        ],
        sortableAttributes: [
          "sortTitle",
          "publishedYear",
          "addedAt",
          "durationSeconds",
        ],
      },
    });
  }

  async createIndex(index: string): Promise<void> {
    await this.request("/indexes", {
      method: "POST",
      body: { uid: index, primaryKey: "id" },
    });
  }

  async addDocuments(
    index: string,
    documents: BookSearchDocument[],
  ): Promise<void> {
    await this.request(`/indexes/${index}/documents`, {
      method: "PUT",
      body: documents,
    });
  }

  async deleteDocuments(index: string, ids: string[]): Promise<void> {
    await this.request(`/indexes/${index}/documents/delete-batch`, {
      method: "POST",
      body: ids,
    });
  }

  async search(
    index: string,
    params: { q: string; offset: number; limit: number; filter?: string[] },
  ): Promise<{ ids: string[]; total: number }> {
    const body = await this.request<{
      hits: Array<{ id: string }>;
      estimatedTotalHits: number;
    }>(`/indexes/${index}/search`, {
      method: "POST",
      body: {
        q: params.q,
        offset: params.offset,
        limit: params.limit,
        filter: params.filter,
        attributesToRetrieve: ["id"],
      },
    });

    return {
      ids: body.hits.map((hit) => hit.id),
      total: body.estimatedTotalHits ?? 0,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/meilisearch.client.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src/modules/book-search
git commit -m "feat(search): add a Meilisearch http client"
```

---

### Task 4: Settings storage

**Files:**

- Create: `server/src/modules/book-search/book-search.settings.ts`
- Test: `server/src/modules/book-search/book-search.settings.test.ts`

**Interfaces:**

- Consumes: `WarehouseSecretService` from `server/src/modules/warehouse/warehouse-secret.service`, which exposes `encrypt(value: string): { ciphertext: string; nonce: string; tag: string }` and `decrypt(secret): string`.
- Produces: `class BookSearchSettingsService` with
  - `get(): Promise<{ enabled: boolean; url: string; activeIndex: string; hasApiKey: boolean }>`
  - `getApiKey(): Promise<string | null>`
  - `save(input: { enabled?: boolean; url?: string; activeIndex?: string; apiKey?: string }): Promise<void>`

Settings live in `app_settings` under the key `book_search_config`, following the pattern `metadata_provider_config` already uses. `get()` deliberately returns `hasApiKey` rather than the key, so no endpoint can leak it. That is the defect present in `GET /api/v1/metadata-preferences/providers`, which returns provider keys in clear text, and it must not be repeated here.

- [ ] **Step 1: Write the failing test**

```typescript
import { BookSearchSettingsService } from "./book-search.settings";

function makeDb(stored: string | null) {
  const rows =
    stored === null ? [] : [{ key: "book_search_config", value: stored }];
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return {
    db: {
      query: { appSettings: { findFirst: vi.fn().mockResolvedValue(rows[0]) } },
      insert: vi.fn().mockReturnValue({ values }),
    } as never,
    values,
  };
}

const secret = {
  encrypt: vi.fn().mockReturnValue({ ciphertext: "ct", nonce: "n", tag: "t" }),
  decrypt: vi.fn().mockReturnValue("plain-key"),
} as never;

describe("BookSearchSettingsService", () => {
  it("reports defaults when nothing is stored", async () => {
    const { db } = makeDb(null);

    await expect(
      new BookSearchSettingsService(db, secret).get(),
    ).resolves.toEqual({
      enabled: false,
      url: "",
      activeIndex: "bookorbit_books",
      hasApiKey: false,
    });
  });

  it("never returns the api key from get", async () => {
    const { db } = makeDb(
      JSON.stringify({
        enabled: true,
        url: "http://m:7700",
        activeIndex: "i",
        apiKey: { ciphertext: "ct", nonce: "n", tag: "t" },
      }),
    );

    const result = await new BookSearchSettingsService(db, secret).get();

    expect(result.hasApiKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain("ct");
    expect(JSON.stringify(result)).not.toContain("plain-key");
  });

  it("decrypts the api key only through getApiKey", async () => {
    const { db } = makeDb(
      JSON.stringify({
        enabled: true,
        url: "http://m:7700",
        activeIndex: "i",
        apiKey: { ciphertext: "ct", nonce: "n", tag: "t" },
      }),
    );

    await expect(
      new BookSearchSettingsService(db, secret).getApiKey(),
    ).resolves.toBe("plain-key");
  });

  it("encrypts an api key before storing it", async () => {
    const { db, values } = makeDb(null);

    await new BookSearchSettingsService(db, secret).save({ apiKey: "new-key" });

    const written = JSON.parse(
      (values.mock.calls[0][0] as { value: string }).value,
    ) as Record<string, unknown>;
    expect(written.apiKey).toEqual({ ciphertext: "ct", nonce: "n", tag: "t" });
    expect(JSON.stringify(written)).not.toContain("new-key");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/book-search.settings.test.ts`
Expected: FAIL, cannot find module `./book-search.settings`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DB } from "../../db";
import * as schema from "../../db/schema";
import {
  WarehouseSecretService,
  type EncryptedWarehouseSecret,
} from "../warehouse/warehouse-secret.service";

type Db = NodePgDatabase<typeof schema>;

const SETTINGS_KEY = "book_search_config";
const DEFAULT_INDEX = "bookorbit_books";

interface StoredConfig {
  enabled: boolean;
  url: string;
  activeIndex: string;
  apiKey: EncryptedWarehouseSecret | null;
}

export interface BookSearchSettings {
  enabled: boolean;
  url: string;
  activeIndex: string;
  hasApiKey: boolean;
}

@Injectable()
export class BookSearchSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly secret: WarehouseSecretService,
  ) {}

  private async read(): Promise<StoredConfig> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, SETTINGS_KEY),
    });
    if (!row?.value)
      return {
        enabled: false,
        url: "",
        activeIndex: DEFAULT_INDEX,
        apiKey: null,
      };

    try {
      const parsed = JSON.parse(row.value) as Partial<StoredConfig>;
      return {
        enabled: parsed.enabled === true,
        url: typeof parsed.url === "string" ? parsed.url : "",
        activeIndex:
          typeof parsed.activeIndex === "string" && parsed.activeIndex
            ? parsed.activeIndex
            : DEFAULT_INDEX,
        apiKey: parsed.apiKey ?? null,
      };
    } catch {
      return {
        enabled: false,
        url: "",
        activeIndex: DEFAULT_INDEX,
        apiKey: null,
      };
    }
  }

  async get(): Promise<BookSearchSettings> {
    const config = await this.read();
    return {
      enabled: config.enabled,
      url: config.url,
      activeIndex: config.activeIndex,
      hasApiKey: config.apiKey !== null,
    };
  }

  async getApiKey(): Promise<string | null> {
    const config = await this.read();
    if (!config.apiKey) return null;

    try {
      return this.secret.decrypt(config.apiKey);
    } catch {
      return null;
    }
  }

  async save(input: {
    enabled?: boolean;
    url?: string;
    activeIndex?: string;
    apiKey?: string;
  }): Promise<void> {
    const current = await this.read();
    const next: StoredConfig = {
      enabled: input.enabled ?? current.enabled,
      url: input.url ?? current.url,
      activeIndex: input.activeIndex ?? current.activeIndex,
      apiKey: input.apiKey ? this.secret.encrypt(input.apiKey) : current.apiKey,
    };

    await this.db
      .insert(schema.appSettings)
      .values({ key: SETTINGS_KEY, value: JSON.stringify(next) })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: JSON.stringify(next) },
      });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/book-search.settings.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src/modules/book-search
git commit -m "feat(search): store search settings with an encrypted api key"
```

---

### Task 5: Outbox repository

**Files:**

- Create: `server/src/modules/book-search/search-index.repository.ts`
- Test: `server/src/modules/book-search/search-index.repository.test.ts`

**Interfaces:**

- Consumes: `searchIndexEvents` from Task 1; `CatalogDocumentRow` and `NativeDocumentRow` from Task 2.
- Produces: `class SearchIndexRepository` with
  - `enqueue(events: Array<{ entityType: 'catalog_item' | 'native_book'; entityId: string; operation: 'upsert' | 'delete' }>, tx?: unknown): Promise<void>`
  - `claimBatch(limit: number): Promise<Array<{ id: number; entityType: string; entityId: string; operation: string }>>`
  - `deleteEvents(ids: number[]): Promise<void>`
  - `streamCatalogDocuments(batchSize: number): AsyncGenerator<CatalogDocumentRow[]>`
  - `streamNativeDocuments(batchSize: number): AsyncGenerator<NativeDocumentRow[]>`

`enqueue` accepts an optional transaction so callers can write the event in the same transaction as the data change, which is the property the whole design rests on.

- [ ] **Step 1: Write the failing test**

```typescript
import { SearchIndexRepository } from "./search-index.repository";

function makeDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values };
}

describe("SearchIndexRepository", () => {
  it("enqueues one row per change", async () => {
    const { db, values } = makeDb();

    await new SearchIndexRepository(db).enqueue([
      {
        entityType: "catalog_item",
        entityId: "catalog:ebook:1",
        operation: "upsert",
      },
      { entityType: "native_book", entityId: "native:2", operation: "delete" },
    ]);

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        entityType: "catalog_item",
        entityId: "catalog:ebook:1",
        operation: "upsert",
      }),
      expect.objectContaining({
        entityType: "native_book",
        entityId: "native:2",
        operation: "delete",
      }),
    ]);
  });

  it("does nothing for an empty batch", async () => {
    const { db, insert } = makeDb();

    await new SearchIndexRepository(db).enqueue([]);

    expect(insert).not.toHaveBeenCalled();
  });

  it("writes through a supplied transaction so the event shares the caller commit", async () => {
    const { db } = makeDb();
    const txValues = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn().mockReturnValue({ values: txValues }) };

    await new SearchIndexRepository(db).enqueue(
      [
        {
          entityType: "catalog_item",
          entityId: "catalog:ebook:1",
          operation: "upsert",
        },
      ],
      tx,
    );

    expect(txValues).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/search-index.repository.test.ts`
Expected: FAIL, cannot find module `./search-index.repository`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, gt, inArray } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DB } from "../../db";
import * as schema from "../../db/schema";
import type {
  CatalogDocumentRow,
  NativeDocumentRow,
} from "./book-search-document.mapper";

type Db = NodePgDatabase<typeof schema>;

export interface SearchIndexEventInput {
  entityType: "catalog_item" | "native_book";
  entityId: string;
  operation: "upsert" | "delete";
}

type Writer = Pick<Db, "insert">;

@Injectable()
export class SearchIndexRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async enqueue(events: SearchIndexEventInput[], tx?: unknown): Promise<void> {
    if (events.length === 0) return;

    const writer = (tx as Writer | undefined) ?? this.db;
    await writer
      .insert(schema.searchIndexEvents)
      .values(events.map((event) => ({ ...event })));
  }

  async claimBatch(limit: number) {
    return this.db
      .select({
        id: schema.searchIndexEvents.id,
        entityType: schema.searchIndexEvents.entityType,
        entityId: schema.searchIndexEvents.entityId,
        operation: schema.searchIndexEvents.operation,
      })
      .from(schema.searchIndexEvents)
      .orderBy(asc(schema.searchIndexEvents.id))
      .limit(limit);
  }

  async deleteEvents(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(schema.searchIndexEvents)
      .where(inArray(schema.searchIndexEvents.id, ids));
  }

  async *streamCatalogDocuments(
    batchSize: number,
  ): AsyncGenerator<CatalogDocumentRow[]> {
    let cursor = 0;

    for (;;) {
      const rows = await this.db
        .select({
          id: schema.warehouseCatalogItems.id,
          mediaType: schema.warehouseCatalogItems.mediaType,
          remoteId: schema.warehouseCatalogItems.remoteId,
          title: schema.warehouseCatalogItems.title,
          sortTitle: schema.warehouseCatalogItems.sortTitle,
          authors: schema.warehouseCatalogItems.authors,
          narrators: schema.warehouseCatalogItems.narrators,
          series: schema.warehouseCatalogItems.series,
          seriesIndex: schema.warehouseCatalogItems.seriesIndex,
          publisher: schema.warehouseCatalogItems.publisher,
          language: schema.warehouseCatalogItems.language,
          tags: schema.warehouseCatalogItems.tags,
          genres: schema.warehouseCatalogItems.genres,
          identifiers: schema.warehouseCatalogItems.identifiers,
          format: schema.warehouseCatalogItems.format,
          publishedYear: schema.warehouseCatalogItems.publishedYear,
          hasCover: schema.warehouseCatalogItems.hasCover,
          durationSeconds: schema.warehouseCatalogItems.durationSeconds,
          fileSizeBytes: schema.warehouseCatalogItems.fileSizeBytes,
          syncedAt: schema.warehouseCatalogItems.syncedAt,
        })
        .from(schema.warehouseCatalogItems)
        .where(gt(schema.warehouseCatalogItems.id, cursor))
        .orderBy(asc(schema.warehouseCatalogItems.id))
        .limit(batchSize);

      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].id;
      yield rows;
    }
  }

  async *streamNativeDocuments(
    batchSize: number,
  ): AsyncGenerator<NativeDocumentRow[]> {
    let cursor = 0;

    for (;;) {
      const rows = await this.db
        .select({
          id: schema.books.id,
          libraryId: schema.books.libraryId,
          title: schema.bookMetadata.title,
          sortTitle: schema.books.primaryAuthorSortName,
          series: schema.bookMetadata.seriesName,
          seriesIndex: schema.bookMetadata.seriesIndex,
          publisher: schema.bookMetadata.publisher,
          language: schema.bookMetadata.language,
          publishedYear: schema.bookMetadata.publishedYear,
          createdAt: schema.books.addedAt,
        })
        .from(schema.books)
        .leftJoin(
          schema.bookMetadata,
          eq(schema.bookMetadata.bookId, schema.books.id),
        )
        .where(gt(schema.books.id, cursor))
        .orderBy(asc(schema.books.id))
        .limit(batchSize);

      if (rows.length === 0) return;
      cursor = rows[rows.length - 1].id;

      // Native books keep their title in book_metadata, their format and size on book_files,
      // and their authors in a join table. Format, size, cover and authors are left empty
      // here and filled in phase 2 rather than adding two more joins to this stream.
      yield rows.map((row) => ({
        ...row,
        title: row.title ?? "(untitled)",
        authors: [],
        format: null,
        hasCover: false,
        fileSizeBytes: null,
      }));
    }
  }
}
```

The `books` table is thin: it holds `id`, `libraryId`, `libraryFolderId`, `primaryFileId`, `primaryAuthorSortName`, `folderPath`, `status`, `addedAt` and `updatedAt`. Title, publisher, language, published year and series live in `book_metadata`, keyed by `bookId`, which is why the stream joins. Format and size live on `book_files`. Do not add columns to `books`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/search-index.repository.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src/modules/book-search
git commit -m "feat(search): add the outbox repository and document streams"
```

---

### Task 6: Providers and fallback

**Files:**

- Create: `server/src/modules/book-search/meilisearch.provider.ts`
- Create: `server/src/modules/book-search/sql-search.provider.ts`
- Create: `server/src/modules/book-search/book-search.service.ts`
- Test: `server/src/modules/book-search/book-search.service.test.ts`

**Interfaces:**

- Consumes: `BookSearchProvider`, `BookSearchQuery`, `BookSearchPage` from Task 2; `MeilisearchClient` from Task 3; `BookSearchSettingsService` from Task 4.
- Produces: `class BookSearchService` with `search(query: BookSearchQuery): Promise<BookSearchPage & { provider: 'meilisearch' | 'sql' }>` and `lastProvider(): 'meilisearch' | 'sql' | null`.

`SqlSearchProvider` wraps the existing repository search rather than reimplementing it, so the fallback is the code already running in production. It takes `WarehouseRepository` and calls `queryUserCatalogItems`, mapping the rows to ids with `catalogDocumentId`.

- [ ] **Step 1: Write the failing test**

```typescript
import { BookSearchService } from "./book-search.service";

const QUERY = { q: "dune", page: 0, size: 10 };

function makeService(
  meili: Partial<{ isAvailable: unknown; search: unknown }>,
  sqlSearch = vi
    .fn()
    .mockResolvedValue({ ids: ["sql:1"], total: 1, page: 0, size: 10 }),
) {
  const meiliProvider = {
    name: "meilisearch" as const,
    isAvailable: meili.isAvailable ?? vi.fn().mockResolvedValue(true),
    search:
      meili.search ??
      vi
        .fn()
        .mockResolvedValue({ ids: ["meili:1"], total: 1, page: 0, size: 10 }),
  };
  const sqlProvider = {
    name: "sql" as const,
    isAvailable: vi.fn().mockResolvedValue(true),
    search: sqlSearch,
  };
  const settings = {
    get: vi.fn().mockResolvedValue({
      enabled: true,
      url: "http://m:7700",
      activeIndex: "i",
      hasApiKey: true,
    }),
  };
  return {
    service: new BookSearchService(
      meiliProvider as never,
      sqlProvider as never,
      settings as never,
    ),
    meiliProvider,
    sqlProvider,
  };
}

describe("BookSearchService", () => {
  it("uses Meilisearch when it is enabled and available", async () => {
    const { service, sqlProvider } = makeService({});

    await expect(service.search(QUERY)).resolves.toMatchObject({
      ids: ["meili:1"],
      provider: "meilisearch",
    });
    expect(sqlProvider.search).not.toHaveBeenCalled();
  });

  it("falls back to SQL when Meilisearch is unavailable", async () => {
    const { service } = makeService({
      isAvailable: vi.fn().mockResolvedValue(false),
    });

    await expect(service.search(QUERY)).resolves.toMatchObject({
      ids: ["sql:1"],
      provider: "sql",
    });
  });

  it("falls back to SQL when the Meilisearch search throws", async () => {
    const { service } = makeService({
      search: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    await expect(service.search(QUERY)).resolves.toMatchObject({
      ids: ["sql:1"],
      provider: "sql",
    });
  });

  it("uses SQL without calling Meilisearch when the integration is disabled", async () => {
    const { service, meiliProvider } = makeService({});
    (
      service as unknown as { settings: { get: ReturnType<typeof vi.fn> } }
    ).settings.get.mockResolvedValue({
      enabled: false,
      url: "",
      activeIndex: "i",
      hasApiKey: false,
    });

    await expect(service.search(QUERY)).resolves.toMatchObject({
      provider: "sql",
    });
    expect(meiliProvider.search).not.toHaveBeenCalled();
  });

  it("reports which provider served the last search", async () => {
    const { service } = makeService({
      isAvailable: vi.fn().mockResolvedValue(false),
    });

    await service.search(QUERY);

    expect(service.lastProvider()).toBe("sql");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/book-search.service.test.ts`
Expected: FAIL, cannot find module `./book-search.service`.

- [ ] **Step 3: Write minimal implementation**

`book-search.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";

import { sanitizeLogValue } from "../../common/utils/log-sanitize.utils";
import { BookSearchSettingsService } from "./book-search.settings";
import { MeilisearchProvider } from "./meilisearch.provider";
import { SqlSearchProvider } from "./sql-search.provider";
import type { BookSearchPage, BookSearchQuery } from "./book-search.types";

type ProviderName = "meilisearch" | "sql";

@Injectable()
export class BookSearchService {
  private readonly logger = new Logger(BookSearchService.name);
  private last: ProviderName | null = null;

  constructor(
    private readonly meili: MeilisearchProvider,
    private readonly sql: SqlSearchProvider,
    private readonly settings: BookSearchSettingsService,
  ) {}

  lastProvider(): ProviderName | null {
    return this.last;
  }

  async search(
    query: BookSearchQuery,
  ): Promise<BookSearchPage & { provider: ProviderName }> {
    const config = await this.settings.get();

    if (config.enabled) {
      try {
        if (await this.meili.isAvailable()) {
          const page = await this.meili.search(query);
          this.last = "meilisearch";
          return { ...page, provider: "meilisearch" };
        }
        this.logger.warn(
          "[book_search.fallback] [end] reason=unavailable - search fell back to sql",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[book_search.fallback] [fail] reason=error error="${sanitizeLogValue(message)}" - search fell back to sql`,
        );
      }
    }

    const page = await this.sql.search(query);
    this.last = "sql";
    return { ...page, provider: "sql" };
  }
}
```

`meilisearch.provider.ts` builds a client from settings and calls `client.search`, translating `page`/`size` into `offset`/`limit` and `mediaTypes`/`libraryIds` into Meili filter strings such as `mediaType IN [ebook, audiobook]`. It returns `{ ids, total, page, size }`. `isAvailable()` returns false when settings are incomplete, otherwise delegates to `client.health()`.

`sql-search.provider.ts` calls `warehouseRepository.queryUserCatalogItems` with the same query and maps each row through `catalogDocumentId(row.mediaType, row.remoteId)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/book-search.service.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src/modules/book-search
git commit -m "feat(search): add search providers with a sql fallback"
```

---

### Task 7: Indexer, drain and rebuild

**Files:**

- Create: `server/src/modules/book-search/search-indexer.service.ts`
- Test: `server/src/modules/book-search/search-indexer.service.test.ts`

**Interfaces:**

- Consumes: `SearchIndexRepository` from Task 5; `MeilisearchClient` from Task 3; `BookSearchSettingsService` from Task 4; the mappers from Task 2.
- Produces: `class SearchIndexerService` with `drain(): Promise<{ applied: number; failed: number }>` and `rebuild(): Promise<{ indexed: number; index: string }>`.

`rebuild()` writes into `bookorbit_books_rebuild_<timestamp>`, applies settings, streams every catalogue and native row into it, and only then saves the new name as `activeIndex`. A failure leaves the previous index active and untouched. The timestamp comes from `Date.now()` at call time.

- [ ] **Step 1: Write the failing test**

```typescript
import { SearchIndexerService } from "./search-indexer.service";

function makeDeps(overrides: Record<string, unknown> = {}) {
  const repository = {
    claimBatch: vi.fn().mockResolvedValue([]),
    deleteEvents: vi.fn().mockResolvedValue(undefined),
    streamCatalogDocuments: vi.fn().mockImplementation(async function* () {
      await Promise.resolve();
    }),
    streamNativeDocuments: vi.fn().mockImplementation(async function* () {
      await Promise.resolve();
    }),
    ...overrides,
  };
  const client = {
    addDocuments: vi.fn().mockResolvedValue(undefined),
    deleteDocuments: vi.fn().mockResolvedValue(undefined),
    createIndex: vi.fn().mockResolvedValue(undefined),
    applySettings: vi.fn().mockResolvedValue(undefined),
  };
  const settings = {
    get: vi.fn().mockResolvedValue({
      enabled: true,
      url: "http://m:7700",
      activeIndex: "books",
      hasApiKey: true,
    }),
    getApiKey: vi.fn().mockResolvedValue("key"),
    save: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, client, settings };
}

describe("SearchIndexerService", () => {
  it("does nothing when the outbox is empty", async () => {
    const { repository, client, settings } = makeDeps();
    const service = new SearchIndexerService(
      repository as never,
      settings as never,
    );
    (service as unknown as { clientFor: () => unknown }).clientFor = () =>
      client;

    await expect(service.drain()).resolves.toEqual({ applied: 0, failed: 0 });
    expect(client.addDocuments).not.toHaveBeenCalled();
  });

  it("leaves events in the outbox when the write fails, so they retry", async () => {
    const { repository, client, settings } = makeDeps({
      claimBatch: vi.fn().mockResolvedValue([
        {
          id: 1,
          entityType: "catalog_item",
          entityId: "catalog:ebook:1",
          operation: "delete",
        },
      ]),
    });
    client.deleteDocuments.mockRejectedValue(new Error("meili down"));
    const service = new SearchIndexerService(
      repository as never,
      settings as never,
    );
    (service as unknown as { clientFor: () => unknown }).clientFor = () =>
      client;

    const result = await service.drain();

    expect(result.failed).toBeGreaterThan(0);
    expect(repository.deleteEvents).not.toHaveBeenCalled();
  });

  it("only activates the new index after the rebuild finishes", async () => {
    const { repository, client, settings } = makeDeps();
    const service = new SearchIndexerService(
      repository as never,
      settings as never,
    );
    (service as unknown as { clientFor: () => unknown }).clientFor = () =>
      client;

    await service.rebuild();

    const saveOrder = settings.save.mock.invocationCallOrder[0];
    const settingsOrder = client.applySettings.mock.invocationCallOrder[0];
    expect(saveOrder).toBeGreaterThan(settingsOrder);
    expect(settings.save).toHaveBeenCalledWith(
      expect.objectContaining({
        activeIndex: expect.stringContaining("bookorbit_books_rebuild_"),
      }),
    );
  });

  it("leaves the active index alone when the rebuild throws", async () => {
    const { repository, client, settings } = makeDeps();
    client.createIndex.mockRejectedValue(new Error("cannot create"));
    const service = new SearchIndexerService(
      repository as never,
      settings as never,
    );
    (service as unknown as { clientFor: () => unknown }).clientFor = () =>
      client;

    await expect(service.rebuild()).rejects.toThrow();
    expect(settings.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/search-indexer.service.test.ts`
Expected: FAIL, cannot find module `./search-indexer.service`.

- [ ] **Step 3: Write minimal implementation**

Implement `SearchIndexerService` with a private `clientFor()` that builds a `MeilisearchClient` from settings and the decrypted key, so the tests can replace it. `drain()` claims a batch, groups events by operation, calls `addDocuments` for upserts and `deleteDocuments` for deletes, and only calls `deleteEvents` for the events whose write succeeded. `rebuild()` creates the timestamped index, applies settings, streams both document sources through the mappers in batches of 1000, and saves the new `activeIndex` last.

Upsert events carry a document id, so the indexer must load the underlying row to build the document. Load catalogue rows by `(mediaType, remoteId)` parsed from the id, and native rows by the numeric id.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/search-indexer.service.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src/modules/book-search
git commit -m "feat(search): add the outbox drainer and index rebuild"
```

---

### Task 8: Enqueue on every write path

**Files:**

- Modify: `server/src/modules/warehouse/warehouse.repository.ts:496`
- Modify: `server/src/modules/local-scan/local-scan.repository.ts:84`
- Modify: `server/src/modules/local-scan/local-scan.repository.ts:203`
- Test: `server/src/modules/book-search/search-index-enqueue.test.ts`

**Interfaces:**

- Consumes: `SearchIndexRepository.enqueue` from Task 5.

The three write sites are the catalogue sync upsert, the local scan insert, and the enrichment batch update. Each must enqueue an `upsert` event for every row it wrote, in the same transaction where one exists.

- [ ] **Step 1: Write the failing test**

```typescript
import { readFileSync } from "fs";
import { join } from "path";

const WAREHOUSE_REPO = join(
  __dirname,
  "..",
  "warehouse",
  "warehouse.repository.ts",
);
const LOCAL_SCAN_REPO = join(
  __dirname,
  "..",
  "local-scan",
  "local-scan.repository.ts",
);

describe("search index enqueue coverage", () => {
  it("enqueues from the catalogue upsert", () => {
    expect(readFileSync(WAREHOUSE_REPO, "utf8")).toContain("searchIndexEvents");
  });

  it("enqueues from the local scan insert and the enrichment update", () => {
    const source = readFileSync(LOCAL_SCAN_REPO, "utf8");
    const occurrences = source.split("searchIndexEvents").length - 1;

    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
```

This is a coverage guard in the spirit of `warehouse-catalog-sync.no-delete.test.ts`, which already guards a structural property this way. It catches a future write path that forgets to enqueue.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/search-index-enqueue.test.ts`
Expected: FAIL, the writes do not enqueue yet.

- [ ] **Step 3: Write minimal implementation**

In each of the three write sites, after the existing write, insert `searchIndexEvents` rows for the affected entity ids using the same `this.db` or transaction handle the write used. Build ids with `catalogDocumentId(mediaType, remoteId)`.

For `applyEnrichmentBatch`, which already writes with a single `UPDATE ... FROM (VALUES ...)`, add a second statement in the same call inserting one event per updated id.

Keep each addition to a few lines and do not restructure the surrounding method.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/search-index-enqueue.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the local-scan and warehouse suites**

Run: `cd server && npx vitest run src/modules/local-scan src/modules/warehouse`
Expected: PASS apart from the known `warehouse-catalog.mapper.test.ts` failure.

- [ ] **Step 6: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git checkout -- src/db/warehouse-migrations/meta/0047_snapshot.json
cd .. && git add server/src
git commit -m "feat(search): enqueue index events from every catalogue write"
```

---

### Task 9: Admin endpoints and module wiring

**Files:**

- Create: `server/src/modules/book-search/book-search.controller.ts`
- Create: `server/src/modules/book-search/book-search.module.ts`
- Create: `server/src/modules/book-search/book-search.controller.test.ts`
- Modify: `server/src/app.module.ts`

**Interfaces:**

- Consumes: `BookSearchSettingsService`, `SearchIndexerService`, `BookSearchService`.
- Produces: `GET /api/v1/book-search/settings`, `PUT /api/v1/book-search/settings`, `POST /api/v1/book-search/test`, `POST /api/v1/book-search/rebuild`.

All routes are gated with `@RequirePermission(Permission.ManageAppSettings)` applied at class level, following `server/src/modules/account-activity/account-activity.controller.ts` for the decorator style. Rebuild is detached and returns 202, following `server/src/modules/local-scan/local-scan.controller.ts`, because a full reindex of 410k documents takes minutes.

- [ ] **Step 1: Write the failing test**

```typescript
import { BookSearchController } from "./book-search.controller";

describe("BookSearchController", () => {
  it("returns settings without the api key", async () => {
    const settings = {
      get: vi.fn().mockResolvedValue({
        enabled: true,
        url: "http://m:7700",
        activeIndex: "i",
        hasApiKey: true,
      }),
      save: vi.fn(),
    };
    const controller = new BookSearchController(
      settings as never,
      { rebuildInBackground: vi.fn() } as never,
      { lastProvider: vi.fn() } as never,
    );

    const result = await controller.getSettings();

    expect(result).toMatchObject({ hasApiKey: true });
    expect(JSON.stringify(result)).not.toContain('apiKey"');
  });

  it("detaches a rebuild and answers accepted", () => {
    const indexer = { rebuildInBackground: vi.fn() };
    const controller = new BookSearchController(
      { get: vi.fn(), save: vi.fn() } as never,
      indexer as never,
      { lastProvider: vi.fn() } as never,
    );

    expect(controller.rebuild()).toEqual({ started: true });
    expect(indexer.rebuildInBackground).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book-search/book-search.controller.test.ts`
Expected: FAIL, cannot find module `./book-search.controller`.

- [ ] **Step 3: Write minimal implementation**

Create the controller with those four routes, a `book-search.module.ts` declaring every provider from Tasks 3 to 7 and exporting `BookSearchService`, and register `BookSearchModule` in `server/src/app.module.ts` alongside the other feature modules. Add `rebuildInBackground()` to `SearchIndexerService`, mirroring `LocalScanService.runInBackground`, which logs failures rather than losing them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book-search/book-search.controller.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS apart from the known `warehouse-catalog.mapper.test.ts` failure. Baseline before this plan is 2008 passing with that single failure.

- [ ] **Step 6: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src
git commit -m "feat(search): expose search admin endpoints"
```

---

### Task 10: Route global search through the provider

**Files:**

- Modify: `server/src/modules/book/book.service.ts:1284` (`globalQuery`)
- Modify: `server/src/modules/book/book.module.ts`
- Test: `server/src/modules/book/global-query-search.test.ts`

**Interfaces:**

- Consumes: `BookSearchService.search` from Task 6.

This is the task that removes the defect. When a search term is present and the provider is Meilisearch, `globalQuery` asks the provider for one ranked page of ids, loads those rows, and returns them **in the provider's order**. The JavaScript merge and re-sort is skipped entirely for that path. With no search term, or when the provider is SQL, the existing merge runs unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
describe("globalQuery search routing", () => {
  it("returns provider order rather than re-sorting when Meilisearch served the search", async () => {
    // Provider returns the relevant book first; the old merge would have sorted it by title
    // and buried it, which is the defect this task removes.
    const ids = [
      "catalog:audiobook:relevant",
      "catalog:ebook:aaa-alphabetically-first",
    ];
    // Assemble the service with a stub BookSearchService returning those ids in that order,
    // and stub row loading to return titles 'Relevant Book' and 'AAA Book'.
    // Assert the returned items are ['Relevant Book', 'AAA Book'].
  });

  it("keeps the existing merge when there is no search term", async () => {
    // Assert BookSearchService.search is not called and the local plus source merge runs.
  });

  it("keeps the existing merge when the provider fell back to sql", async () => {
    // Provider reports provider: 'sql'; assert the merge path is used so SQL ordering rules apply.
  });
});
```

Fill each body using the mocking style already used in `book.service.test.ts` for `globalQuery`, which spies on `executeBooksQuery` and `warehouseCatalog.queryLibraryItems`. Read that file first and follow its setup exactly rather than inventing a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/book/global-query-search.test.ts`
Expected: FAIL, `globalQuery` does not consult the provider.

- [ ] **Step 3: Write minimal implementation**

In `globalQuery`, when `query.q` is non-empty, call `bookSearchService.search`. If the result's `provider` is `meilisearch`, load rows for the returned ids and return them in that order with the provider's `total`. Otherwise fall through to the existing code path unchanged.

Inject `BookSearchService` into `BookService` and import `BookSearchModule` in `book.module.ts`. Make the dependency `@Optional()` so `BookModule` still constructs when search is not configured, following how `warehouse-catalog.service.ts` takes `LocalContentService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/book`
Expected: PASS, including the existing 1381 tests in that module.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
cd .. && git add server/src
git commit -m "feat(search): serve global search from the provider when available"
```

---

### Task 11: Deploy, index and verify against the live server

**Files:**

- No source changes. This task is operational and runs against the application host and the search host.

- [ ] **Step 1: Create an index scoped key on the search host**

Create a key limited to this integration's indexes rather than reusing the other product's master key, which can modify the other product's a large existing index:

```bash
curl -s -X POST http://<meili-host>:7700/keys \
  -H "Authorization: Bearer <another product master key>" -H 'Content-Type: application/json' \
  -d '{"description":"bookorbit","actions":["search","documents.*","indexes.*","settings.*","tasks.get"],"indexes":["bookorbit_books*"],"expiresAt":null}'
```

Record the returned key. Do not print it into a shared transcript.

- [ ] **Step 2: Deploy the build to the application host**

Follow the deploy recipe: `git archive` to a tarball, `scp` to ns18, `pct push` into 139, extract to a new directory, `docker build`, tag as `bookorbit:merged`, `docker compose up -d` from `/opt/bookorbit`. Tag a rollback image first.

- [ ] **Step 3: Configure and rebuild**

`PUT /api/v1/book-search/settings` with the url, the scoped key and `enabled: true`, then `POST /api/v1/book-search/rebuild`. Poll `GET /api/v1/book-search/settings` until `activeIndex` changes to the new timestamped name.

- [ ] **Step 4: Verify the two failures that motivated this work**

```
POST /api/v1/books/query  {"q":"The Will of Many","sort":[{"field":"title","dir":"asc"}],"pagination":{"page":0,"size":5}}
POST /api/v1/books/query  {"q":"Islingtn","sort":[{"field":"title","dir":"asc"}],"pagination":{"page":0,"size":5}}
```

Expected: the first returns "The Will of the Many" first. The second returns James Islington's books, which no SQL implementation could do. If either fails, the ranking or the index settings are wrong; do not accept the result.

- [ ] **Step 5: Verify the fallback**

Set `enabled: false` and repeat the first query. It must still return results, served by SQL. Set it back to true.

---

## Out of scope for this plan

- Author and series indexes. Phase 2.
- Hybrid semantic search using the `<embedder-name>` embedder. Phase 3.
- A UI for these settings. The endpoints are admin only and callable directly, matching how local-scan shipped before its UI.
