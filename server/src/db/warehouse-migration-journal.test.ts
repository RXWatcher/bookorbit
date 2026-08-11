import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

type MigrationJournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: MigrationJournalEntry[];
};

const warehouseMigrationsDirUrl = new URL('./warehouse-migrations/', import.meta.url);
const journalPath = fileURLToPath(new URL('./meta/_journal.json', warehouseMigrationsDirUrl));
const warehouseMigrationsDir = fileURLToPath(warehouseMigrationsDirUrl);
const LEGACY_WAREHOUSE_TIMESTAMPS = new Map<string, number>([
  ['0032_add_warehouse_foundation', 1780441770800],
  ['0033_add_warehouse_catalog_duration', 1780457629340],
  ['0034_add_warehouse_user_state', 1780488876663],
  ['0035_kobo_catalog_snapshot_books', 1780521343986],
  ['0036_koreader_catalog_bridge', 1780523156824],
  ['0037_collection_catalog_items', 1780545302466],
  ['0038_add_warehouse_bookmarks', 1780550837989],
  ['0039_add_warehouse_annotations', 1780561802783],
  ['0040_add_warehouse_user_state_finished_at', 1780572934252],
  ['0041_add_warehouse_catalog_series_index', 1780575600000],
  ['0042_add_email_send_log_catalog_ref', 1780667172156],
  ['0043_add_warehouse_comic_media_type', 1780700100000],
  ['0044_add_warehouse_reading_sessions', 1780700200000],
  ['0045_index_warehouse_catalog_rows', 1782421105748],
  ['0046_backfill_warehouse_catalog_series', 1782421105749],
  ['0047_add_warehouse_library_icons', 1783180800000],
]);

function readJournal(): MigrationJournal {
  return JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
}

function migrationPrefix(idx: number): string {
  return idx.toString().padStart(4, '0');
}

describe('Book Warehouse migration journal', () => {
  it('preserves the original warehouse migration timestamps in a separate journal', () => {
    const journal = readJournal();
    const legacyCount = LEGACY_WAREHOUSE_TIMESTAMPS.size;

    // The lineage this pins is closed: these are the migrations Drizzle generated,
    // each with a meta/ snapshot. Everything after them is hand written and has no
    // snapshot by design, so only the leading run is compared tag for tag.
    expect(journal.entries.slice(0, legacyCount).map((entry) => entry.tag)).toEqual([...LEGACY_WAREHOUSE_TIMESTAMPS.keys()]);

    for (const entry of journal.entries) {
      const prefix = migrationPrefix(entry.idx);

      expect(entry.tag.startsWith(`${prefix}_`)).toBe(true);
      expect(existsSync(fileURLToPath(new URL(`./${entry.tag}.sql`, warehouseMigrationsDirUrl)))).toBe(true);

      if (!LEGACY_WAREHOUSE_TIMESTAMPS.has(entry.tag)) continue;

      expect(entry.when).toBe(LEGACY_WAREHOUSE_TIMESTAMPS.get(entry.tag));
      expect(existsSync(fileURLToPath(new URL(`./meta/${prefix}_snapshot.json`, warehouseMigrationsDirUrl)))).toBe(true);
    }
  });

  it('keeps the warehouse journal in sync with warehouse SQL files', () => {
    const journalTags = readJournal().entries.map((entry) => entry.tag);
    const fileTags = readdirSync(warehouseMigrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => basename(file, '.sql'))
      .sort();

    expect(journalTags).toEqual(fileTags);
    expect(new Set(journalTags).size).toBe(journalTags.length);
  });
});
