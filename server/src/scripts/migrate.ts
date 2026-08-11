import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { createPostgresClientConfig } from '../db/postgres-connection-config';
import { installPostgresExtensions } from './postgres-extensions';

export const WAREHOUSE_MIGRATIONS_TABLE = '__drizzle_warehouse_migrations';

type MigrationJournal = {
  entries: {
    when: number;
    tag: string;
  }[];
};

export type MigrationLedgerEntry = {
  createdAt: number;
  hash: string;
};

export function collectWarehouseMigrationLedgerSeeds({
  warehouseMigrations,
  mainLedgerCreatedAts,
  warehouseLedgerCreatedAts,
}: {
  warehouseMigrations: MigrationLedgerEntry[];
  mainLedgerCreatedAts: ReadonlySet<number>;
  warehouseLedgerCreatedAts: ReadonlySet<number>;
}): MigrationLedgerEntry[] {
  return warehouseMigrations.filter(
    (migration) => mainLedgerCreatedAts.has(migration.createdAt) && !warehouseLedgerCreatedAts.has(migration.createdAt),
  );
}

export function readMigrationLedgerEntries(migrationsFolder: string): MigrationLedgerEntry[] {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as MigrationJournal;

  return journal.entries.map((entry) => {
    const sql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8');

    return {
      createdAt: entry.when,
      hash: createHash('sha256').update(sql).digest('hex'),
    };
  });
}

function resolveFolder(label: string, candidates: string[]): string {
  const match = candidates.find((path) => existsSync(path));
  if (!match) {
    throw new Error(`Unable to locate ${label} folder. Checked: ${candidates.join(', ')}`);
  }
  return match;
}

export function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, '..', '..', 'migrations'),
    join(__dirname, '..', 'db', 'migrations'),
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'src', 'db', 'migrations'),
  ];

  return resolveFolder('migrations', candidates);
}

export function resolveWarehouseMigrationsFolder(): string {
  const candidates = [
    join(__dirname, '..', '..', 'warehouse-migrations'),
    join(__dirname, '..', 'db', 'warehouse-migrations'),
    join(process.cwd(), 'warehouse-migrations'),
    join(process.cwd(), 'src', 'db', 'warehouse-migrations'),
  ];

  return resolveFolder('warehouse migrations', candidates);
}

async function seedWarehouseMigrationLedger(pool: Pool, warehouseMigrationsFolder: string) {
  const warehouseMigrations = readMigrationLedgerEntries(warehouseMigrationsFolder);
  const createdAts = warehouseMigrations.map((migration) => migration.createdAt);

  if (createdAts.length === 0) return;

  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS "drizzle";
    CREATE TABLE IF NOT EXISTS "drizzle"."${WAREHOUSE_MIGRATIONS_TABLE}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  const [mainLedger, warehouseLedger] = await Promise.all([
    pool.query<{ created_at: string }>('SELECT created_at FROM "drizzle"."__drizzle_migrations" WHERE created_at = ANY($1::bigint[])', [createdAts]),
    pool.query<{ created_at: string }>(`SELECT created_at FROM "drizzle"."${WAREHOUSE_MIGRATIONS_TABLE}" WHERE created_at = ANY($1::bigint[])`, [
      createdAts,
    ]),
  ]);

  const seeds = collectWarehouseMigrationLedgerSeeds({
    warehouseMigrations,
    mainLedgerCreatedAts: new Set(mainLedger.rows.map((row) => Number(row.created_at))),
    warehouseLedgerCreatedAts: new Set(warehouseLedger.rows.map((row) => Number(row.created_at))),
  });

  for (const seed of seeds) {
    await pool.query(
      `INSERT INTO "drizzle"."${WAREHOUSE_MIGRATIONS_TABLE}" ("hash", "created_at")
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM "drizzle"."${WAREHOUSE_MIGRATIONS_TABLE}" WHERE "created_at" = $2
       )`,
      [seed.hash, seed.createdAt],
    );
  }
}

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool(
    createPostgresClientConfig(connectionString, {
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    }),
  );

  try {
    await installPostgresExtensions(pool);

    const database = drizzle(pool);
    const migrationsFolder = resolveMigrationsFolder();
    const warehouseMigrationsFolder = resolveWarehouseMigrationsFolder();

    await migrate(database, { migrationsFolder });
    await seedWarehouseMigrationLedger(pool, warehouseMigrationsFolder);
    await migrate(database, { migrationsFolder: warehouseMigrationsFolder, migrationsTable: WAREHOUSE_MIGRATIONS_TABLE });
    await ensureWarehouseReadingSessions(pool);

    console.log(`Migrations applied successfully from ${migrationsFolder} and ${warehouseMigrationsFolder}`);
  } finally {
    await pool.end();
  }
}

async function ensureWarehouseReadingSessions(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "warehouse_reading_sessions" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
      "media_type" "warehouse_media_type" NOT NULL,
      "remote_id" varchar(128) NOT NULL,
      "session_id" varchar(64) NOT NULL,
      "started_at" timestamp with time zone NOT NULL,
      "ended_at" timestamp with time zone NOT NULL,
      "duration_seconds" integer NOT NULL,
      "progress_delta" real,
      "end_progress" real,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "warehouse_reading_sessions_duration_seconds_nonnegative_chk" CHECK ("duration_seconds" >= 0),
      CONSTRAINT "warehouse_reading_sessions_end_progress_range_chk" CHECK ("end_progress" is null or ("end_progress" >= 0 and "end_progress" <= 100)),
      CONSTRAINT "warehouse_reading_sessions_ended_after_started_chk" CHECK ("ended_at" >= "started_at")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "wrs_user_session_id_uidx" ON "warehouse_reading_sessions" USING btree ("user_id","session_id");
    CREATE INDEX IF NOT EXISTS "wrs_user_item_started_idx" ON "warehouse_reading_sessions" USING btree ("user_id","media_type","remote_id","started_at");
    CREATE INDEX IF NOT EXISTS "wrs_item_started_idx" ON "warehouse_reading_sessions" USING btree ("media_type","remote_id","started_at");
  `);
}

if (require.main === module) {
  void runMigrations();
}
