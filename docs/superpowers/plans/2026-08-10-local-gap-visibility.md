# Local Gap Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the roughly 65,200 ebooks, audiobooks and comics that exist on the CephFS share but are absent from the Book Warehouse, as deduplicated rows in the libraries BookOrbit already shows.

**Architecture:** Local items are stored as rows in `warehouse_catalog_items` marked `source = 'local'`, so they inherit the existing indexes, pagination, sorting, search and statistics rather than needing a second table or a query time union. A new `local-scan` module walks configured roots, derives a media specific key for each filesystem candidate, compares it against the same key derived from catalogue rows, and inserts only the unmatched ones.

**Tech Stack:** NestJS 11 (Fastify), Drizzle ORM, PostgreSQL, Vitest, pnpm workspace.

## Global Constraints

- Node >= 24, pnpm >= 9.
- Tables under `warehouse_*` live in the hand managed lineage `server/src/db/warehouse-migrations/`, NOT in `server/src/db/migrations/`. For those, hand write the SQL following the eleven existing hand written migrations there, and add a `_journal.json` entry. Do not run `pnpm db:generate` for them. The repo rule against hand written migrations governs the primary lineage that drizzle-kit actually manages.
- There is no local PostgreSQL in this environment, so `pnpm db:migrate` cannot run and must NOT be attempted. Migrations are committed unapplied. Every test in this plan is pure or mocked and needs no database.
- Never use em dashes in any output: code, comments, strings, commit messages, docs.
- Never add a `Co-authored-by` trailer to any commit.
- Test files use `.test.ts`. Vitest globals are available, so do not import `describe`, `it`, `expect` or `vi`.
- Use `vi.fn()`, `vi.mock()`, `vi.spyOn()`. Never `jest.*`.
- Log format: `[event] [phase] key=value ... - short message`, phases are `[start]`, `[end]`, `[fail]` only.
- Wrap any dynamic value inside a quoted log field with `sanitizeLogValue()` from `server/src/common/utils/log-sanitize.utils`.
- Throw NestJS `HttpException` subclasses, never raw `Error`.
- Inject the typed config, never read `process.env` directly in a service.
- Destructive or sensitive endpoints are gated with `@RequirePermission(...)`.
- Run `npx prettier --write .` and `npx eslint .` in `server/` before every commit.
- Assume tens of thousands of rows. No unbounded queries, no loading whole collections into memory.

## File Structure

| File                                                                   | Responsibility                                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `server/src/db/schema/warehouse.ts`                                    | Add `catalogItemSourceEnum`, `source` and `localPath` columns, check constraint, source index |
| `server/src/db/schema/local-scan.ts`                                   | New `localScanRoots` table                                                                    |
| `server/src/modules/local-scan/local-scan.types.ts`                    | `LocalCandidate`, `LocalMatchStrategy`, `LocalScanSummary`                                    |
| `server/src/modules/local-scan/strategies/ebook-match.strategy.ts`     | Calibre path matching                                                                         |
| `server/src/modules/local-scan/strategies/audiobook-match.strategy.ts` | `storage_key` path matching                                                                   |
| `server/src/modules/local-scan/strategies/comic-match.strategy.ts`     | Title plus issue heuristic                                                                    |
| `server/src/modules/local-scan/local-scan.walker.ts`                   | Streaming directory walk with exclusions                                                      |
| `server/src/modules/local-scan/local-scan.repository.ts`               | Root CRUD, catalogue key loading, batched inserts                                             |
| `server/src/modules/local-scan/local-scan.service.ts`                  | Orchestration                                                                                 |
| `server/src/modules/local-scan/local-scan.controller.ts`               | Admin trigger and status                                                                      |
| `server/src/modules/local-scan/local-scan.module.ts`                   | Wiring                                                                                        |

---

### Task 1: Catalogue source columns

**Files:**

- Modify: `server/src/db/schema/warehouse.ts`
- Test: `server/src/db/schema/schema.test.ts`

**Interfaces:**

- Produces: `catalogItemSourceEnum` with values `['warehouse', 'local']`; `warehouseCatalogItems.source`; `warehouseCatalogItems.localPath`.

- [ ] **Step 1: Write the failing test**

Append to `server/src/db/schema/schema.test.ts`, inside the existing describe block that covers `warehouseCatalogItems`:

```typescript
it("marks catalog item origin and requires a path for local rows", () => {
  expect(schema.catalogItemSourceEnum.enumValues).toEqual([
    "warehouse",
    "local",
  ]);
  expect(schema.warehouseCatalogItems.source.notNull).toBe(true);
  expect(schema.warehouseCatalogItems.source.default).toBe("warehouse");
  expect(schema.warehouseCatalogItems.localPath.notNull).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/schema/schema.test.ts -t 'marks catalog item origin'`
Expected: FAIL, `catalogItemSourceEnum` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `server/src/db/schema/warehouse.ts`, add after `warehouseMediaTypeEnum` (line 24):

```typescript
export const catalogItemSourceEnum = pgEnum("catalog_item_source", [
  "warehouse",
  "local",
]);
```

Inside the `warehouseCatalogItems` column block, directly after `hasCover`:

```typescript
    source: catalogItemSourceEnum('source').notNull().default('warehouse'),
    localPath: text('local_path'),
```

In the same table's constraint array, alongside the existing `check(...)` entries:

```typescript
    index('warehouse_catalog_items_source_idx').on(t.mediaType, t.source),
    check('warehouse_catalog_items_local_path_chk', sql`${t.source} <> 'local' or ${t.localPath} is not null`),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/schema/schema.test.ts -t 'marks catalog item origin'`
Expected: PASS.

- [ ] **Step 5: Hand write the migration**

Do NOT run `pnpm db:generate` and do NOT run `pnpm db:migrate`.

`warehouse_catalog_items` belongs to a second, hand managed migration lineage at
`server/src/db/warehouse-migrations/`, applied at runtime by `server/src/scripts/migrate.ts`
against its own ledger table. `drizzle.config.ts` does not point at that folder, its `meta/`
snapshots have been stale since 0042, and 0048 through 0050 have no snapshot at all. Eleven of
its nineteen migrations are hand written, identifiable by `IF NOT EXISTS`, which drizzle-kit
never emits. Follow that precedent. `0048_add_catalog_item_file_size.sql` is the closest model.

Create `server/src/db/warehouse-migrations/0051_add_catalog_item_source.sql`:

```sql
-- Distinguish rows synced from the Book Warehouse from rows discovered by
-- scanning the local filesystem, so the two can share one table and one set of
-- indexes without a query time union.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'catalog_item_source') THEN
    CREATE TYPE "catalog_item_source" AS ENUM ('warehouse', 'local');
  END IF;
END
$$;

ALTER TABLE "warehouse_catalog_items"
  ADD COLUMN IF NOT EXISTS "source" "catalog_item_source" DEFAULT 'warehouse' NOT NULL;

ALTER TABLE "warehouse_catalog_items"
  ADD COLUMN IF NOT EXISTS "local_path" text;

CREATE INDEX IF NOT EXISTS "warehouse_catalog_items_source_idx"
  ON "warehouse_catalog_items" ("media_type", "source");

ALTER TABLE "warehouse_catalog_items"
  DROP CONSTRAINT IF EXISTS "warehouse_catalog_items_local_path_chk";

ALTER TABLE "warehouse_catalog_items"
  ADD CONSTRAINT "warehouse_catalog_items_local_path_chk"
  CHECK ("source" <> 'local' OR "local_path" IS NOT NULL);
```

Then append an entry to `server/src/db/warehouse-migrations/meta/_journal.json`, matching the
shape of the existing entries exactly:

```json
{
  "idx": 51,
  "version": "7",
  "when": 1786103000000,
  "tag": "0051_add_catalog_item_source",
  "breakpoints": true
}
```

Do not add a snapshot file. 0048, 0049 and 0050 have none, and inventing one would make the
stale chain worse.

- [ ] **Step 6: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/db/schema/warehouse.ts server/src/db/schema/schema.test.ts server/src/db/migrations
git commit -m "feat(catalog): add source and local_path to catalog items"
```

---

### Task 2: Lock the no delete property

The entire design depends on the catalogue sync never deleting rows. If a future change adds a prune, local content is destroyed silently. This test makes that regression loud.

**Files:**

- Create: `server/src/modules/warehouse/warehouse-catalog-sync.no-delete.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```typescript
import { readFileSync } from "fs";
import { join } from "path";

const REPOSITORY = join(__dirname, "warehouse.repository.ts");
const SYNC_SERVICE = join(__dirname, "warehouse-catalog-sync.service.ts");

describe("catalog sync never deletes catalog items", () => {
  it("has no delete against warehouseCatalogItems", () => {
    const sources = [
      readFileSync(REPOSITORY, "utf8"),
      readFileSync(SYNC_SERVICE, "utf8"),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(
        /delete\(\s*schema\.warehouseCatalogItems\s*\)/,
      );
      expect(source).not.toMatch(/notInArray\([^)]*warehouseCatalogItems/);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd server && npx vitest run src/modules/warehouse/warehouse-catalog-sync.no-delete.test.ts`
Expected: PASS immediately. This test guards existing behaviour rather than driving new code, so a pass here is correct. Confirm it is meaningful by temporarily adding `await this.db.delete(schema.warehouseCatalogItems);` to `warehouse.repository.ts`, re-running to see it FAIL, then removing the line.

- [ ] **Step 3: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/warehouse/warehouse-catalog-sync.no-delete.test.ts
git commit -m "test(warehouse): guard catalog items against sync deletion"
```

---

### Task 3: Scan roots table

**Files:**

- Create: `server/src/db/schema/local-scan.ts`
- Modify: `server/src/db/schema/index.ts`
- Test: `server/src/db/schema/schema.test.ts`

**Interfaces:**

- Produces: `localScanRoots` table with columns `id`, `mediaType`, `absolutePath`, `enabled`, `excludePatterns`, `lastScanStartedAt`, `lastScanFinishedAt`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write the failing test**

Append to `server/src/db/schema/schema.test.ts`:

```typescript
describe("localScanRoots", () => {
  it("is unique per media type and path", () => {
    expect(schema.localScanRoots.absolutePath.notNull).toBe(true);
    expect(schema.localScanRoots.enabled.default).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/db/schema/schema.test.ts -t 'is unique per media type and path'`
Expected: FAIL, `localScanRoots` is undefined.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/db/schema/local-scan.ts`:

```typescript
import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { warehouseMediaTypeEnum } from "./warehouse";

export const localScanRoots = pgTable(
  "local_scan_roots",
  {
    id: serial("id").primaryKey(),
    mediaType: warehouseMediaTypeEnum("media_type").notNull(),
    absolutePath: text("absolute_path").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    excludePatterns: jsonb("exclude_patterns")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastScanStartedAt: timestamp("last_scan_started_at", {
      withTimezone: true,
    }),
    lastScanFinishedAt: timestamp("last_scan_finished_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique("local_scan_roots_media_path_unique").on(
      t.mediaType,
      t.absolutePath,
    ),
  ],
);
```

Add to `server/src/db/schema/index.ts`, following the existing re-export style:

```typescript
export * from "./local-scan";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/db/schema/schema.test.ts -t 'is unique per media type and path'`
Expected: PASS.

- [ ] **Step 5: Hand write the migration**

Do NOT run `pnpm db:generate` and do NOT run `pnpm db:migrate`.

`local_scan_roots` has a column typed `warehouse_media_type`, an enum owned by the hand managed
lineage, so this table belongs there too. Generating it into the primary lineage would emit SQL
referencing a type that lineage has never heard of.

Create `server/src/db/warehouse-migrations/0052_add_local_scan_roots.sql`:

```sql
-- Configured filesystem roots the local scanner walks, one per media type.
CREATE TABLE IF NOT EXISTS "local_scan_roots" (
  "id" serial PRIMARY KEY NOT NULL,
  "media_type" "warehouse_media_type" NOT NULL,
  "absolute_path" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_scan_started_at" timestamp with time zone,
  "last_scan_finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "local_scan_roots_media_path_unique" UNIQUE ("media_type", "absolute_path")
);
```

Then append to `server/src/db/warehouse-migrations/meta/_journal.json`, matching the existing
entry shape exactly:

```json
{
  "idx": 52,
  "version": "7",
  "when": 1786104000000,
  "tag": "0052_add_local_scan_roots",
  "breakpoints": true
}
```

Do not add a snapshot file.

- [ ] **Step 6: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/db/schema/local-scan.ts server/src/db/schema/index.ts server/src/db/schema/schema.test.ts server/src/db/migrations
git commit -m "feat(local-scan): add local scan roots table"
```

---

### Task 4: Shared types and the strategy contract

**Files:**

- Create: `server/src/modules/local-scan/local-scan.types.ts`

**Interfaces:**

- Produces:
  - `LocalCandidate = { absolutePath: string; relativePath: string; fileName: string }`
  - `CatalogKeyRow = { remoteId: string; title: string; rawPayload: Record<string, unknown> }`
  - `LocalMatchStrategy` with `mediaType: WarehouseMediaType`, `catalogKey(row: CatalogKeyRow): string | null`, `diskKey(candidate: LocalCandidate): string | null`, `titleFor(candidate: LocalCandidate): string`
  - `LocalScanSummary = { rootId: number; scanned: number; matched: number; inserted: number; skipped: number }`

- [ ] **Step 1: Write the implementation**

There is no behaviour to test in a types only file, so this task has no test step.

Create `server/src/modules/local-scan/local-scan.types.ts`:

```typescript
import type { WarehouseMediaType } from "@bookorbit/types";

export interface LocalCandidate {
  absolutePath: string;
  relativePath: string;
  fileName: string;
}

export interface CatalogKeyRow {
  remoteId: string;
  title: string;
  rawPayload: Record<string, unknown>;
}

export interface LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType;
  catalogKey(row: CatalogKeyRow): string | null;
  diskKey(candidate: LocalCandidate): string | null;
  titleFor(candidate: LocalCandidate): string;
}

export interface LocalScanSummary {
  rootId: number;
  scanned: number;
  matched: number;
  inserted: number;
  skipped: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan/local-scan.types.ts
git commit -m "feat(local-scan): add scan types and match strategy contract"
```

---

### Task 5: Ebook match strategy

Catalogue side key is `raw_payload.calibre_path`, for example `Diana Xarissa/Joy and Jealousy (17937)`. Disk side key is the book directory relative to the scan root. Filename matching must never be used: the warehouse names files `Author/Series/NN - Title.epub` while Calibre names them `Title - Author.epub`, and a whole share comparison found only 10 matching names out of 698,013.

**Files:**

- Create: `server/src/modules/local-scan/strategies/ebook-match.strategy.ts`
- Test: `server/src/modules/local-scan/strategies/ebook-match.strategy.test.ts`

**Interfaces:**

- Consumes: `LocalMatchStrategy`, `LocalCandidate`, `CatalogKeyRow` from Task 4.
- Produces: `EbookMatchStrategy` class implementing `LocalMatchStrategy`.

- [ ] **Step 1: Write the failing test**

```typescript
import { EbookMatchStrategy } from "./ebook-match.strategy";

describe("EbookMatchStrategy", () => {
  const strategy = new EbookMatchStrategy();

  it("keys catalogue rows on calibre_path", () => {
    expect(
      strategy.catalogKey({
        remoteId: "abc",
        title: "Joy and Jealousy",
        rawPayload: { calibre_path: "Diana Xarissa/Joy and Jealousy (17937)" },
      }),
    ).toBe("Diana Xarissa/Joy and Jealousy (17937)");
  });

  it("strips leading slashes so both sides agree", () => {
    expect(
      strategy.catalogKey({
        remoteId: "a",
        title: "t",
        rawPayload: { calibre_path: "/Author/Book (1)" },
      }),
    ).toBe("Author/Book (1)");
  });

  it("returns null when the row carries no calibre_path", () => {
    expect(
      strategy.catalogKey({ remoteId: "a", title: "t", rawPayload: {} }),
    ).toBeNull();
  });

  it("keys disk candidates on the book directory", () => {
    expect(
      strategy.diskKey({
        absolutePath:
          "/mnt/books/Diana Xarissa/Joy and Jealousy (17937)/Joy and Jealousy - Diana Xarissa.epub",
        relativePath:
          "Diana Xarissa/Joy and Jealousy (17937)/Joy and Jealousy - Diana Xarissa.epub",
        fileName: "Joy and Jealousy - Diana Xarissa.epub",
      }),
    ).toBe("Diana Xarissa/Joy and Jealousy (17937)");
  });

  it("ignores calibre internal directories", () => {
    expect(
      strategy.diskKey({
        absolutePath: "/mnt/books/.caltrash/b/x.epub",
        relativePath: ".caltrash/b/x.epub",
        fileName: "x.epub",
      }),
    ).toBeNull();
    expect(
      strategy.diskKey({
        absolutePath: "/mnt/books/.calnotes/backup/x.epub",
        relativePath: ".calnotes/backup/x.epub",
        fileName: "x.epub",
      }),
    ).toBeNull();
  });

  it("derives a title from the book directory", () => {
    expect(
      strategy.titleFor({
        absolutePath:
          "/mnt/books/Diana Xarissa/Joy and Jealousy (17937)/x.epub",
        relativePath: "Diana Xarissa/Joy and Jealousy (17937)/x.epub",
        fileName: "x.epub",
      }),
    ).toBe("Joy and Jealousy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/local-scan/strategies/ebook-match.strategy.test.ts`
Expected: FAIL, cannot find module `./ebook-match.strategy`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { WarehouseMediaType } from "@bookorbit/types";

import type {
  CatalogKeyRow,
  LocalCandidate,
  LocalMatchStrategy,
} from "../local-scan.types";

const CALIBRE_INTERNAL_PREFIXES = [".caltrash/", ".calnotes/"];
const TRAILING_CALIBRE_ID = / \(\d+\)$/;

export class EbookMatchStrategy implements LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType = "ebook";

  catalogKey(row: CatalogKeyRow): string | null {
    const value = row.rawPayload.calibre_path;
    if (typeof value !== "string" || value.length === 0) return null;
    return value.replace(/^\/+/, "");
  }

  diskKey(candidate: LocalCandidate): string | null {
    const relative = candidate.relativePath.replace(/^\/+/, "");
    if (CALIBRE_INTERNAL_PREFIXES.some((prefix) => relative.startsWith(prefix)))
      return null;

    const segments = relative.split("/");
    if (segments.length < 3) return null;
    return segments.slice(0, 2).join("/");
  }

  titleFor(candidate: LocalCandidate): string {
    const key = this.diskKey(candidate);
    if (!key) return candidate.fileName;
    const bookDirectory = key.split("/")[1] ?? candidate.fileName;
    return bookDirectory.replace(TRAILING_CALIBRE_ID, "");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/local-scan/strategies/ebook-match.strategy.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan/strategies/ebook-match.strategy.ts server/src/modules/local-scan/strategies/ebook-match.strategy.test.ts
git commit -m "feat(local-scan): add ebook calibre path match strategy"
```

---

### Task 6: Audiobook match strategy

Catalogue side key is the directory part of `raw_payload.files[].storage_key`, which is absolute and prefixed `/media/zd-storage-ceph-books/audiobooks/Audiobooks_English/`. That prefix maps onto the scan root, so it is stripped to produce a root relative key.

**Files:**

- Create: `server/src/modules/local-scan/strategies/audiobook-match.strategy.ts`
- Test: `server/src/modules/local-scan/strategies/audiobook-match.strategy.test.ts`

**Interfaces:**

- Consumes: `LocalMatchStrategy`, `LocalCandidate`, `CatalogKeyRow` from Task 4.
- Produces: `AudiobookMatchStrategy`, constructed as `new AudiobookMatchStrategy(remotePrefix: string)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { AudiobookMatchStrategy } from "./audiobook-match.strategy";

const PREFIX = "/media/zd-storage-ceph-books/audiobooks/Audiobooks_English/";

describe("AudiobookMatchStrategy", () => {
  const strategy = new AudiobookMatchStrategy(PREFIX);

  it("keys catalogue rows on the storage_key directory with the prefix removed", () => {
    expect(
      strategy.catalogKey({
        remoteId: "abc",
        title: "Lightseekers",
        rawPayload: {
          files: [
            {
              storage_key: `${PREFIX}Femi Kayode/Lightseekers (2021)/Femi Kayode - Lightseekers (2021).m4b`,
            },
          ],
        },
      }),
    ).toBe("Femi Kayode/Lightseekers (2021)");
  });

  it("returns null when storage_key sits outside the configured prefix", () => {
    expect(
      strategy.catalogKey({
        remoteId: "abc",
        title: "Other",
        rawPayload: {
          files: [
            { storage_key: "/media/somewhere-else/Author/Book/file.m4b" },
          ],
        },
      }),
    ).toBeNull();
  });

  it("returns null when there are no files", () => {
    expect(
      strategy.catalogKey({
        remoteId: "a",
        title: "t",
        rawPayload: { files: [] },
      }),
    ).toBeNull();
    expect(
      strategy.catalogKey({ remoteId: "a", title: "t", rawPayload: {} }),
    ).toBeNull();
  });

  it("keys disk candidates on the book directory", () => {
    expect(
      strategy.diskKey({
        absolutePath: "/mnt/ab/Femi Kayode/Lightseekers (2021)/file.m4b",
        relativePath: "Femi Kayode/Lightseekers (2021)/file.m4b",
        fileName: "file.m4b",
      }),
    ).toBe("Femi Kayode/Lightseekers (2021)");
  });

  it("derives a title from the book directory", () => {
    expect(
      strategy.titleFor({
        absolutePath: "/mnt/ab/Femi Kayode/Lightseekers (2021)/file.m4b",
        relativePath: "Femi Kayode/Lightseekers (2021)/file.m4b",
        fileName: "file.m4b",
      }),
    ).toBe("Lightseekers (2021)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/local-scan/strategies/audiobook-match.strategy.test.ts`
Expected: FAIL, cannot find module `./audiobook-match.strategy`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { WarehouseMediaType } from "@bookorbit/types";

import type {
  CatalogKeyRow,
  LocalCandidate,
  LocalMatchStrategy,
} from "../local-scan.types";

export class AudiobookMatchStrategy implements LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType = "audiobook";

  constructor(private readonly remotePrefix: string) {}

  catalogKey(row: CatalogKeyRow): string | null {
    const files = row.rawPayload.files;
    if (!Array.isArray(files)) return null;

    for (const file of files) {
      const storageKey = (file as { storage_key?: unknown }).storage_key;
      if (typeof storageKey !== "string") continue;
      if (!storageKey.startsWith(this.remotePrefix)) continue;

      const relative = storageKey.slice(this.remotePrefix.length);
      const segments = relative.split("/");
      if (segments.length < 2) continue;
      return segments.slice(0, segments.length - 1).join("/");
    }

    return null;
  }

  diskKey(candidate: LocalCandidate): string | null {
    const relative = candidate.relativePath.replace(/^\/+/, "");
    const segments = relative.split("/");
    if (segments.length < 2) return null;
    return segments.slice(0, segments.length - 1).join("/");
  }

  titleFor(candidate: LocalCandidate): string {
    const key = this.diskKey(candidate);
    if (!key) return candidate.fileName;
    const segments = key.split("/");
    return segments[segments.length - 1] ?? candidate.fileName;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/local-scan/strategies/audiobook-match.strategy.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan/strategies/audiobook-match.strategy.ts server/src/modules/local-scan/strategies/audiobook-match.strategy.test.ts
git commit -m "feat(local-scan): add audiobook storage key match strategy"
```

---

### Task 7: Comic match strategy

Comic payloads carry no path and no hash, only `{id, title, language, seriesId, publisher, issueNumber}`. Matching is therefore a heuristic on title plus issue number. The population is small, 4,831 files against 4,824 catalogue rows, so the downside is a handful of duplicates rather than a systemic problem.

**Files:**

- Create: `server/src/modules/local-scan/strategies/comic-match.strategy.ts`
- Test: `server/src/modules/local-scan/strategies/comic-match.strategy.test.ts`

**Interfaces:**

- Consumes: `LocalMatchStrategy`, `LocalCandidate`, `CatalogKeyRow` from Task 4.
- Produces: `ComicMatchStrategy`.

- [ ] **Step 1: Write the failing test**

```typescript
import { ComicMatchStrategy } from "./comic-match.strategy";

describe("ComicMatchStrategy", () => {
  const strategy = new ComicMatchStrategy();

  it("keys catalogue rows on normalised title and issue", () => {
    expect(
      strategy.catalogKey({
        remoteId: "abc",
        title: "Wolverines 13",
        rawPayload: { title: "Wolverines 13", issueNumber: "13" },
      }),
    ).toBe("wolverines|13");
  });

  it("returns null when the issue number is missing", () => {
    expect(
      strategy.catalogKey({
        remoteId: "a",
        title: "Wolverines",
        rawPayload: { title: "Wolverines" },
      }),
    ).toBeNull();
  });

  it("keys disk candidates parsed from the filename", () => {
    expect(
      strategy.diskKey({
        absolutePath: "/mnt/c/Wolverines 013.cbz",
        relativePath: "Wolverines 013.cbz",
        fileName: "Wolverines 013.cbz",
      }),
    ).toBe("wolverines|13");
  });

  it("returns null when the filename carries no trailing issue number", () => {
    expect(
      strategy.diskKey({
        absolutePath: "/mnt/c/Wolverines.cbz",
        relativePath: "Wolverines.cbz",
        fileName: "Wolverines.cbz",
      }),
    ).toBeNull();
  });

  it("derives a title from the filename without the extension", () => {
    expect(
      strategy.titleFor({
        absolutePath: "/mnt/c/Wolverines 013.cbz",
        relativePath: "Wolverines 013.cbz",
        fileName: "Wolverines 013.cbz",
      }),
    ).toBe("Wolverines 013");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/local-scan/strategies/comic-match.strategy.test.ts`
Expected: FAIL, cannot find module `./comic-match.strategy`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { WarehouseMediaType } from "@bookorbit/types";

import type {
  CatalogKeyRow,
  LocalCandidate,
  LocalMatchStrategy,
} from "../local-scan.types";

const TRAILING_ISSUE = /^(.*?)[\s_-]+(\d{1,5})$/;

function normaliseTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildKey(title: string, issue: string): string {
  return `${normaliseTitle(title)}|${String(Number(issue))}`;
}

export class ComicMatchStrategy implements LocalMatchStrategy {
  readonly mediaType: WarehouseMediaType = "comic";

  catalogKey(row: CatalogKeyRow): string | null {
    const issue = row.rawPayload.issueNumber;
    if (typeof issue !== "string" || issue.length === 0) return null;

    const rawTitle =
      typeof row.rawPayload.title === "string"
        ? row.rawPayload.title
        : row.title;
    const stripped = TRAILING_ISSUE.exec(rawTitle.trim());
    const seriesTitle = stripped ? stripped[1] : rawTitle;
    return buildKey(seriesTitle, issue);
  }

  diskKey(candidate: LocalCandidate): string | null {
    const base = candidate.fileName.replace(/\.[^.]+$/, "");
    const match = TRAILING_ISSUE.exec(base.trim());
    if (!match) return null;
    return buildKey(match[1], match[2]);
  }

  titleFor(candidate: LocalCandidate): string {
    return candidate.fileName.replace(/\.[^.]+$/, "");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/local-scan/strategies/comic-match.strategy.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan/strategies/comic-match.strategy.ts server/src/modules/local-scan/strategies/comic-match.strategy.test.ts
git commit -m "feat(local-scan): add comic title and issue match strategy"
```

---

### Task 8: Streaming directory walker

The ebook root alone holds 513,374 files and the audiobook root 971,388, so the walk streams with `fs.opendir` and never builds a full file list in memory.

**Files:**

- Create: `server/src/modules/local-scan/local-scan.walker.ts`
- Test: `server/src/modules/local-scan/local-scan.walker.test.ts`

**Interfaces:**

- Consumes: `LocalCandidate` from Task 4.
- Produces: `async function* walkFiles(root: string, options: { extensions: string[]; excludePatterns: string[] }): AsyncGenerator<LocalCandidate>`

- [ ] **Step 1: Write the failing test**

```typescript
import * as fs from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { walkFiles } from "./local-scan.walker";

async function collect(
  root: string,
  extensions: string[],
  excludePatterns: string[] = [],
): Promise<string[]> {
  const found: string[] = [];
  for await (const candidate of walkFiles(root, {
    extensions,
    excludePatterns,
  })) {
    found.push(candidate.relativePath);
  }
  return found.sort();
}

describe("walkFiles", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "bookorbit-walker-"));
    await fs.mkdir(join(root, "Author", "Book (1)"), { recursive: true });
    await fs.mkdir(join(root, ".caltrash", "b"), { recursive: true });
    await fs.writeFile(join(root, "Author", "Book (1)", "book.epub"), "x");
    await fs.writeFile(join(root, "Author", "Book (1)", "cover.jpg"), "x");
    await fs.writeFile(join(root, ".caltrash", "b", "junk.epub"), "x");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("yields only files with the requested extensions", async () => {
    await expect(collect(root, [".epub"])).resolves.toEqual([
      ".caltrash/b/junk.epub",
      "Author/Book (1)/book.epub",
    ]);
  });

  it("skips excluded directories", async () => {
    await expect(collect(root, [".epub"], [".caltrash"])).resolves.toEqual([
      "Author/Book (1)/book.epub",
    ]);
  });

  it("matches extensions case insensitively", async () => {
    await fs.writeFile(join(root, "Author", "Book (1)", "other.EPUB"), "x");
    const found = await collect(root, [".epub"], [".caltrash"]);
    expect(found).toContain("Author/Book (1)/other.EPUB");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.walker.test.ts`
Expected: FAIL, cannot find module `./local-scan.walker`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { opendir } from "fs/promises";
import { join, relative, sep } from "path";

import type { LocalCandidate } from "./local-scan.types";

interface WalkOptions {
  extensions: string[];
  excludePatterns: string[];
}

function toPosix(value: string): string {
  return sep === "/" ? value : value.split(sep).join("/");
}

export async function* walkFiles(
  root: string,
  options: WalkOptions,
): AsyncGenerator<LocalCandidate> {
  const extensions = options.extensions.map((extension) =>
    extension.toLowerCase(),
  );
  const excluded = new Set(options.excludePatterns);
  const pending: string[] = [root];

  while (pending.length > 0) {
    const directory = pending.pop() as string;
    let handle;

    try {
      handle = await opendir(directory);
    } catch {
      continue;
    }

    for await (const entry of handle) {
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        pending.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const lowerName = entry.name.toLowerCase();
      if (!extensions.some((extension) => lowerName.endsWith(extension)))
        continue;

      yield {
        absolutePath,
        relativePath: toPosix(relative(root, absolutePath)),
        fileName: entry.name,
      };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.walker.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan/local-scan.walker.ts server/src/modules/local-scan/local-scan.walker.test.ts
git commit -m "feat(local-scan): add streaming directory walker"
```

---

### Task 9: Repository

**Files:**

- Create: `server/src/modules/local-scan/local-scan.repository.ts`
- Test: `server/src/modules/local-scan/local-scan.repository.test.ts`

**Interfaces:**

- Consumes: `CatalogKeyRow` from Task 4.
- Produces: `LocalScanRepository` with:
  - `findEnabledRoots(): Promise<Array<{ id: number; mediaType: WarehouseMediaType; absolutePath: string; excludePatterns: string[] }>>`
  - `streamCatalogKeyRows(mediaType: WarehouseMediaType, batchSize: number): AsyncGenerator<CatalogKeyRow[]>`
  - `insertLocalItems(rows: NewLocalCatalogItem[]): Promise<number>` where `NewLocalCatalogItem = { mediaType: WarehouseMediaType; remoteId: string; title: string; localPath: string; format: string | null; fileSizeBytes: number | null }`
  - `markScanStarted(rootId: number): Promise<void>` and `markScanFinished(rootId: number): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
import { LocalScanRepository } from "./local-scan.repository";

function makeDb() {
  const onConflictDoNothing = vi.fn().mockResolvedValue({ rowCount: 2 });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values, onConflictDoNothing };
}

describe("LocalScanRepository", () => {
  it("inserts local rows with source local and ignores duplicates", async () => {
    const { db, values, onConflictDoNothing } = makeDb();
    const repository = new LocalScanRepository(db);

    await repository.insertLocalItems([
      {
        mediaType: "ebook",
        remoteId: "local:aaa",
        title: "Book",
        localPath: "/mnt/books/a/b.epub",
        format: "epub",
        fileSizeBytes: 10,
      },
    ]);

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        source: "local",
        remoteId: "local:aaa",
        localPath: "/mnt/books/a/b.epub",
      }),
    ]);
    expect(onConflictDoNothing).toHaveBeenCalled();
  });

  it("does nothing when given an empty batch", async () => {
    const { db, insert } = makeDb();
    const repository = new LocalScanRepository(db);

    await expect(repository.insertLocalItems([])).resolves.toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.repository.test.ts`
Expected: FAIL, cannot find module `./local-scan.repository`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Inject, Injectable } from "@nestjs/common";
import type { WarehouseMediaType } from "@bookorbit/types";
import { and, asc, eq, gt } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DB } from "../../db";
import * as schema from "../../db/schema";
import type { CatalogKeyRow } from "./local-scan.types";

type Db = NodePgDatabase<typeof schema>;

export interface NewLocalCatalogItem {
  mediaType: WarehouseMediaType;
  remoteId: string;
  title: string;
  localPath: string;
  format: string | null;
  fileSizeBytes: number | null;
}

@Injectable()
export class LocalScanRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findEnabledRoots() {
    return this.db
      .select({
        id: schema.localScanRoots.id,
        mediaType: schema.localScanRoots.mediaType,
        absolutePath: schema.localScanRoots.absolutePath,
        excludePatterns: schema.localScanRoots.excludePatterns,
      })
      .from(schema.localScanRoots)
      .where(eq(schema.localScanRoots.enabled, true))
      .orderBy(asc(schema.localScanRoots.id));
  }

  async *streamCatalogKeyRows(
    mediaType: WarehouseMediaType,
    batchSize: number,
  ): AsyncGenerator<CatalogKeyRow[]> {
    let cursor = 0;

    for (;;) {
      const batch = await this.db
        .select({
          id: schema.warehouseCatalogItems.id,
          remoteId: schema.warehouseCatalogItems.remoteId,
          title: schema.warehouseCatalogItems.title,
          rawPayload: schema.warehouseCatalogItems.rawPayload,
        })
        .from(schema.warehouseCatalogItems)
        .where(
          and(
            eq(schema.warehouseCatalogItems.mediaType, mediaType),
            gt(schema.warehouseCatalogItems.id, cursor),
          ),
        )
        .orderBy(asc(schema.warehouseCatalogItems.id))
        .limit(batchSize);

      if (batch.length === 0) return;

      cursor = batch[batch.length - 1].id;
      yield batch.map(({ remoteId, title, rawPayload }) => ({
        remoteId,
        title,
        rawPayload,
      }));
    }
  }

  async insertLocalItems(rows: NewLocalCatalogItem[]): Promise<number> {
    if (rows.length === 0) return 0;

    await this.db
      .insert(schema.warehouseCatalogItems)
      .values(rows.map((row) => ({ ...row, source: "local" as const })))
      .onConflictDoNothing({
        target: [
          schema.warehouseCatalogItems.mediaType,
          schema.warehouseCatalogItems.remoteId,
        ],
      });

    return rows.length;
  }

  async markScanStarted(rootId: number): Promise<void> {
    await this.db
      .update(schema.localScanRoots)
      .set({ lastScanStartedAt: new Date() })
      .where(eq(schema.localScanRoots.id, rootId));
  }

  async markScanFinished(rootId: number): Promise<void> {
    await this.db
      .update(schema.localScanRoots)
      .set({ lastScanFinishedAt: new Date() })
      .where(eq(schema.localScanRoots.id, rootId));
  }
}
```

The `Db` type is declared locally in each repository rather than imported, matching `server/src/modules/collection/collection.repository.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.repository.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan/local-scan.repository.ts server/src/modules/local-scan/local-scan.repository.test.ts
git commit -m "feat(local-scan): add local scan repository"
```

---

### Task 10: Scan orchestration service

**Files:**

- Create: `server/src/modules/local-scan/local-scan.service.ts`
- Test: `server/src/modules/local-scan/local-scan.service.test.ts`

**Interfaces:**

- Consumes: `LocalScanRepository` (Task 9), `walkFiles` (Task 8), the three strategies (Tasks 5 to 7), `LocalScanSummary` (Task 4).
- Produces: `LocalScanService.scanRoot(rootId: number): Promise<LocalScanSummary>` and `LocalScanService.scanAll(): Promise<LocalScanSummary[]>`

- [ ] **Step 1: Write the failing test**

```typescript
import * as fs from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { LocalScanService } from "./local-scan.service";

describe("LocalScanService", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "bookorbit-local-scan-"));
    await fs.mkdir(join(root, "Author", "Known (1)"), { recursive: true });
    await fs.mkdir(join(root, "Author", "Missing (2)"), { recursive: true });
    await fs.writeFile(join(root, "Author", "Known (1)", "a.epub"), "x");
    await fs.writeFile(join(root, "Author", "Missing (2)", "b.epub"), "x");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("inserts only the books the catalogue does not already have", async () => {
    const inserted: unknown[] = [];
    const repository = {
      findEnabledRoots: vi.fn().mockResolvedValue([
        {
          id: 7,
          mediaType: "ebook",
          absolutePath: root,
          excludePatterns: [],
        },
      ]),
      streamCatalogKeyRows: vi.fn().mockImplementation(async function* () {
        yield [
          {
            remoteId: "r1",
            title: "Known",
            rawPayload: { calibre_path: "Author/Known (1)" },
          },
        ];
      }),
      insertLocalItems: vi.fn().mockImplementation(async (rows: unknown[]) => {
        inserted.push(...rows);
        return rows.length;
      }),
      markScanStarted: vi.fn().mockResolvedValue(undefined),
      markScanFinished: vi.fn().mockResolvedValue(undefined),
    };

    const service = new LocalScanService(repository as never);
    const summary = await service.scanRoot(7);

    expect(summary.inserted).toBe(1);
    expect(summary.matched).toBe(1);
    expect(inserted).toEqual([
      expect.objectContaining({
        mediaType: "ebook",
        title: "Missing",
        localPath: join(root, "Author", "Missing (2)", "b.epub"),
      }),
    ]);
  });

  it("gives every local row a deterministic namespaced remote id", async () => {
    const inserted: Array<{ remoteId: string }> = [];
    const repository = {
      findEnabledRoots: vi.fn().mockResolvedValue([
        {
          id: 7,
          mediaType: "ebook",
          absolutePath: root,
          excludePatterns: [],
        },
      ]),
      streamCatalogKeyRows: vi.fn().mockImplementation(async function* () {
        yield [];
      }),
      insertLocalItems: vi
        .fn()
        .mockImplementation(async (rows: Array<{ remoteId: string }>) => {
          inserted.push(...rows);
          return rows.length;
        }),
      markScanStarted: vi.fn().mockResolvedValue(undefined),
      markScanFinished: vi.fn().mockResolvedValue(undefined),
    };

    const service = new LocalScanService(repository as never);
    await service.scanRoot(7);

    expect(inserted).toHaveLength(2);
    for (const row of inserted) {
      expect(row.remoteId).toMatch(/^local:[0-9a-f]{64}$/);
    }
  });

  it("throws NotFoundException for an unknown root", async () => {
    const repository = {
      findEnabledRoots: vi.fn().mockResolvedValue([]),
      streamCatalogKeyRows: vi.fn(),
      insertLocalItems: vi.fn(),
      markScanStarted: vi.fn(),
      markScanFinished: vi.fn(),
    };

    const service = new LocalScanService(repository as never);
    await expect(service.scanRoot(99)).rejects.toThrow(
      "Scan root 99 not found or disabled",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.service.test.ts`
Expected: FAIL, cannot find module `./local-scan.service`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { createHash } from "crypto";
import { stat } from "fs/promises";
import { extname } from "path";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { WarehouseMediaType } from "@bookorbit/types";

import { sanitizeLogValue } from "../../common/utils/log-sanitize.utils";
import {
  LocalScanRepository,
  type NewLocalCatalogItem,
} from "./local-scan.repository";
import { AudiobookMatchStrategy } from "./strategies/audiobook-match.strategy";
import { ComicMatchStrategy } from "./strategies/comic-match.strategy";
import { EbookMatchStrategy } from "./strategies/ebook-match.strategy";
import type { LocalMatchStrategy, LocalScanSummary } from "./local-scan.types";
import { walkFiles } from "./local-scan.walker";

const AUDIOBOOK_REMOTE_PREFIX =
  "/media/zd-storage-ceph-books/audiobooks/Audiobooks_English/";
const CATALOG_BATCH_SIZE = 5000;
const INSERT_BATCH_SIZE = 500;
const DEFAULT_EXCLUDES = [".caltrash", ".calnotes"];

const EXTENSIONS: Record<WarehouseMediaType, string[]> = {
  ebook: [".epub", ".mobi", ".azw3", ".azw", ".pdf", ".fb2"],
  audiobook: [".m4b", ".mp3", ".m4a", ".opus", ".ogg", ".flac"],
  comic: [".cbz", ".cbr", ".cb7"],
};

@Injectable()
export class LocalScanService {
  private readonly logger = new Logger(LocalScanService.name);

  constructor(private readonly repository: LocalScanRepository) {}

  private strategyFor(mediaType: WarehouseMediaType): LocalMatchStrategy {
    if (mediaType === "ebook") return new EbookMatchStrategy();
    if (mediaType === "audiobook")
      return new AudiobookMatchStrategy(AUDIOBOOK_REMOTE_PREFIX);
    return new ComicMatchStrategy();
  }

  async scanAll(): Promise<LocalScanSummary[]> {
    const roots = await this.repository.findEnabledRoots();
    const summaries: LocalScanSummary[] = [];
    for (const root of roots) {
      summaries.push(await this.scanRoot(root.id));
    }
    return summaries;
  }

  async scanRoot(rootId: number): Promise<LocalScanSummary> {
    const roots = await this.repository.findEnabledRoots();
    const root = roots.find((candidate) => candidate.id === rootId);
    if (!root)
      throw new NotFoundException(`Scan root ${rootId} not found or disabled`);

    const startedAt = Date.now();
    this.logger.log(
      `[local_scan.root] [start] rootId=${rootId} mediaType=${root.mediaType} - local scan started`,
    );
    await this.repository.markScanStarted(rootId);

    const strategy = this.strategyFor(root.mediaType);

    const catalogKeys = new Set<string>();
    for await (const batch of this.repository.streamCatalogKeyRows(
      root.mediaType,
      CATALOG_BATCH_SIZE,
    )) {
      for (const row of batch) {
        const key = strategy.catalogKey(row);
        if (key) catalogKeys.add(key);
      }
    }

    const summary: LocalScanSummary = {
      rootId,
      scanned: 0,
      matched: 0,
      inserted: 0,
      skipped: 0,
    };
    const seen = new Set<string>();
    let pending: NewLocalCatalogItem[] = [];

    const flush = async () => {
      if (pending.length === 0) return;
      summary.inserted += await this.repository.insertLocalItems(pending);
      pending = [];
    };

    try {
      const excludePatterns = [...DEFAULT_EXCLUDES, ...root.excludePatterns];

      for await (const candidate of walkFiles(root.absolutePath, {
        extensions: EXTENSIONS[root.mediaType],
        excludePatterns,
      })) {
        summary.scanned += 1;

        const key = strategy.diskKey(candidate);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        if (catalogKeys.has(key)) {
          summary.matched += 1;
          continue;
        }
        if (seen.has(key)) {
          summary.skipped += 1;
          continue;
        }
        seen.add(key);

        let fileSizeBytes: number | null = null;
        try {
          fileSizeBytes = (await stat(candidate.absolutePath)).size;
        } catch {
          fileSizeBytes = null;
        }

        pending.push({
          mediaType: root.mediaType,
          remoteId: `local:${createHash("sha256").update(candidate.absolutePath).digest("hex")}`,
          title: strategy.titleFor(candidate),
          localPath: candidate.absolutePath,
          format:
            extname(candidate.fileName).replace(".", "").toLowerCase() || null,
          fileSizeBytes,
        });

        if (pending.length >= INSERT_BATCH_SIZE) await flush();
      }

      await flush();
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[local_scan.root] [fail] rootId=${rootId} durationMs=${durationMs} errorClass=${error instanceof Error ? error.constructor.name : "Unknown"} error="${sanitizeLogValue(message)}" - local scan failed`,
      );
      throw error;
    }

    await this.repository.markScanFinished(rootId);
    this.logger.log(
      `[local_scan.root] [end] rootId=${rootId} durationMs=${Date.now() - startedAt} scanned=${summary.scanned} matched=${summary.matched} inserted=${summary.inserted} skipped=${summary.skipped} - local scan completed`,
    );

    return summary;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.service.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan/local-scan.service.ts server/src/modules/local-scan/local-scan.service.test.ts
git commit -m "feat(local-scan): add scan orchestration service"
```

---

### Task 11: Controller and module wiring

**Files:**

- Create: `server/src/modules/local-scan/local-scan.controller.ts`
- Create: `server/src/modules/local-scan/local-scan.module.ts`
- Create: `server/src/modules/local-scan/local-scan.controller.test.ts`
- Modify: `server/src/app.module.ts`

**Interfaces:**

- Consumes: `LocalScanService` (Task 10), `LocalScanRepository` (Task 9).
- Produces: `POST /api/v1/local-scan/roots/:id/scan` and `POST /api/v1/local-scan/scan`.

The permission gate is `Permission.ManageLibraries`, applied at class level. `server/src/modules/account-activity/account-activity.controller.ts` is the reference for the decorator style.

- [ ] **Step 1: Write the failing test**

```typescript
import { LocalScanController } from "./local-scan.controller";

describe("LocalScanController", () => {
  it("delegates a single root scan to the service", async () => {
    const service = {
      scanRoot: vi.fn().mockResolvedValue({
        rootId: 7,
        scanned: 1,
        matched: 0,
        inserted: 1,
        skipped: 0,
      }),
      scanAll: vi.fn(),
    };
    const controller = new LocalScanController(service as never);

    await expect(controller.scanRoot(7)).resolves.toEqual({
      rootId: 7,
      scanned: 1,
      matched: 0,
      inserted: 1,
      skipped: 0,
    });
    expect(service.scanRoot).toHaveBeenCalledWith(7);
  });

  it("delegates a full scan to the service", async () => {
    const service = {
      scanRoot: vi.fn(),
      scanAll: vi.fn().mockResolvedValue([]),
    };
    const controller = new LocalScanController(service as never);

    await expect(controller.scanAll()).resolves.toEqual([]);
    expect(service.scanAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.controller.test.ts`
Expected: FAIL, cannot find module `./local-scan.controller`.

- [ ] **Step 3: Write minimal implementation**

`local-scan.controller.ts`:

```typescript
import { Controller, Param, ParseIntPipe, Post } from "@nestjs/common";
import { Permission } from "@bookorbit/types";

import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { LocalScanService } from "./local-scan.service";
import type { LocalScanSummary } from "./local-scan.types";

@Controller("local-scan")
@RequirePermission(Permission.ManageLibraries)
export class LocalScanController {
  constructor(private readonly localScanService: LocalScanService) {}

  @Post("scan")
  scanAll(): Promise<LocalScanSummary[]> {
    return this.localScanService.scanAll();
  }

  @Post("roots/:id/scan")
  scanRoot(@Param("id", ParseIntPipe) id: number): Promise<LocalScanSummary> {
    return this.localScanService.scanRoot(id);
  }
}
```

`local-scan.module.ts`:

```typescript
import { Module } from "@nestjs/common";

import { LocalScanController } from "./local-scan.controller";
import { LocalScanRepository } from "./local-scan.repository";
import { LocalScanService } from "./local-scan.service";

@Module({
  controllers: [LocalScanController],
  providers: [LocalScanService, LocalScanRepository],
  exports: [LocalScanService],
})
export class LocalScanModule {}
```

Register `LocalScanModule` in `server/src/app.module.ts` alongside the other feature modules.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/modules/local-scan/local-scan.controller.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS. Baseline before this plan is 10576 passed and 5 failed. Those same 5 pre-existing failures are acceptable; any new failure is not.

- [ ] **Step 6: Commit**

```bash
cd server && npx prettier --write . && npx eslint .
git add server/src/modules/local-scan server/src/app.module.ts
git commit -m "feat(local-scan): expose admin scan endpoints"
```

---

### Task 12: Seed the production roots

**Files:**

- No source changes. This task is operational and CANNOT be executed in the development environment, because it needs the migrations applied and the server running. Do not dispatch an implementer for it. It runs against the application host after Plan 1 is deployed, and is recorded here so the verification numbers are not lost.

- [ ] **Step 1: Insert the roots**

The three in scope roots for this plan, on the application host. The magazines root is deliberately excluded here because `magazine` is not yet a valid media type; it arrives in Plan 2.

```sql
insert into local_scan_roots (media_type, absolute_path) values
  ('ebook',     '/mnt/sharedrives/zd-storage-ceph-books/ebooks/Books_English'),
  ('audiobook', '/mnt/sharedrives/zd-storage-ceph-books/audiobooks/Audiobooks_English'),
  ('comic',     '/mnt/sharedrives/zd-storage-ceph-books/comics/English')
on conflict do nothing;
```

- [ ] **Step 2: Run a scan and check the numbers**

Trigger `POST /api/v1/local-scan/scan` and compare the reported counts against the measurements taken on 2026-08-10:

| Media     | Expected inserted |
| --------- | ----------------- |
| ebook     | about 7,108       |
| audiobook | about 58,102      |
| comic     | about 7           |

A materially different number means a match strategy is wrong. Investigate before accepting the result. In particular, an inserted count close to the full disk count means the catalogue key returned null for most rows and nothing matched.

- [ ] **Step 3: Verify deduplication held**

```sql
select source, media_type, count(*) from warehouse_catalog_items group by 1, 2 order by 1, 2;
```

`source = 'warehouse'` counts must be unchanged from before the scan: ebook 159,150, audiobook 184,500, comic 4,824.

---

## Out of scope for this plan

- Magazines, including the `magazine` enum value and its library. Plan 2.
- Serving local content: reader, download, OPDS, Kobo and covers. Plan 3. Until then, local items are visible with metadata but their content endpoints will fail, because `warehouse-catalog.service.ts` resolves bytes through the warehouse client only.
