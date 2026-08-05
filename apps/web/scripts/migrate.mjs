#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const LOCK_KEY_1 = 2085062334;
const LOCK_KEY_2 = 1804289383;
const IGNORED_NOTICE_CODES = new Set(["42P06", "42P07"]);

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@backslash-postgres:5432/backslash";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Docker runtime, standalone output does not expose workspace node_modules in
// a regular layout. Keep a dedicated migration dependency folder as fallback.
const migrateDeps = fs.existsSync("/migrate-deps/node_modules")
  ? createRequire("/migrate-deps/node_modules/")
  : createRequire(import.meta.url);

const postgres = migrateDeps("postgres");
const { drizzle } = migrateDeps("drizzle-orm/postgres-js");
const { migrate } = migrateDeps("drizzle-orm/postgres-js/migrator");

function findMigrationsFolder() {
  const candidates = [
    path.resolve(__dirname, "../drizzle/migrations"),
    path.resolve(process.cwd(), "drizzle/migrations"),
    path.resolve(process.cwd(), "apps/web/drizzle/migrations"),
    path.resolve("/app/apps/web/drizzle/migrations"),
  ];

  return candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "meta/_journal.json"))
  ) ?? null;
}

function readJournal(migrationsFolder) {
  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const content = fs.readFileSync(journalPath, "utf-8");
  return JSON.parse(content);
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

async function tableExists(client, tableName) {
  const rows = await client`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

async function ensureMigrationsTable(client) {
  await client.unsafe(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);
}

/**
 * Older versions tracked migrations in public.__drizzle_migrations, where
 * `drizzle-kit push` sees it as a stray table and drops it — after which this
 * script re-applies every migration against an already-migrated database.
 * Move it into the `drizzle` schema, which push never touches.
 */
async function moveTrackingTableOutOfPublic(client) {
  if (!(await tableExists(client, "__drizzle_migrations"))) return;

  await client.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);

  // Merging two histories that disagree would let the runtime skip or replay
  // migrations depending on which created_at wins. Only merge when the
  // destination is empty or already identical; otherwise stop and keep both.
  const [publicHashes, drizzleHashes] = await Promise.all([
    client`SELECT hash FROM public.__drizzle_migrations ORDER BY hash`,
    client`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY hash`,
  ]);
  if (drizzleHashes.length > 0) {
    const a = publicHashes.map((row) => row.hash).join(",");
    const b = drizzleHashes.map((row) => row.hash).join(",");
    if (a !== b) {
      throw fatal(
        "Both public.__drizzle_migrations and drizzle.__drizzle_migrations " +
          `exist with different histories (${publicHashes.length} vs ` +
          `${drizzleHashes.length} rows). Refusing to merge them automatically. ` +
          "Inspect both tables, keep the one that matches the real schema, and " +
          "drop the other."
      );
    }
  }

  await client.unsafe(`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    SELECT hash, created_at FROM public.__drizzle_migrations
    WHERE hash NOT IN (SELECT hash FROM drizzle.__drizzle_migrations);
    DROP TABLE public.__drizzle_migrations;
  `);
  console.log("[migrate] Moved migration tracking to the drizzle schema");
}

async function insertMigrationHash(client, hash, createdAt) {
  await client`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${createdAt})
  `;
}

async function hasMigrationHash(client, hash) {
  const rows = await client`
    SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash} LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * A database with app tables but no migration history (created by `db:push`, or
 * left over from before migrations existed) cannot be versioned by looking at
 * it, and replaying migrations onto it fails on the first CREATE TABLE. Refuse,
 * and tell the operator how to declare where the schema actually stands:
 *
 *   DRIZZLE_BASELINE=latest            — schema already matches schema.ts
 *   DRIZZLE_BASELINE=0002_ai_settings  — applied up to and including this tag
 *
 * Setting it also repairs a history that is behind the real schema, which is
 * how databases baselined by earlier versions of this script were left.
 */
async function baselineIfNeeded(client, migrationsFolder) {
  if (!(await tableExists(client, "users"))) return; // fresh DB: migrate() builds it

  const baseline = process.env.DRIZZLE_BASELINE;
  const tracked = await client`SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1`;
  const hasHistory = tracked.length > 0;

  if (!baseline) {
    if (hasHistory) return;

    throw fatal(
      "Database has application tables but no migration history. Re-run with " +
        "DRIZZLE_BASELINE=latest if its schema is already up to date (e.g. it " +
        "was created with `db:push`), or DRIZZLE_BASELINE=<migration tag> to " +
        "record migrations up to that point."
    );
  }

  const entries = readJournal(migrationsFolder).entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw fatal("Migration journal is empty");
  }

  // "latest" is a moving target. Left set in a deploy environment it would mark
  // each future migration as applied without ever running its SQL, so it is
  // only accepted for the one case it is meant for: adopting a database that
  // has no history at all. Repairs must name an immutable tag.
  if (baseline === "latest" && hasHistory) {
    throw fatal(
      "DRIZZLE_BASELINE=latest is only allowed on a database with no migration " +
        "history. This one already has some. Re-run with the exact tag you mean, " +
        `e.g. DRIZZLE_BASELINE=${entries[entries.length - 1].tag}.`
    );
  }

  const upTo =
    baseline === "latest"
      ? entries.length - 1
      : entries.findIndex((e) => e.tag === baseline);
  if (upTo < 0) {
    throw fatal(
      `Unknown DRIZZLE_BASELINE tag: ${baseline}. Tags: ${entries
        .map((e) => e.tag)
        .join(", ")}`
    );
  }

  // One transaction: a half-written baseline looks like "some history" on the
  // next run, which would silently skip the rest.
  await client.begin(async (tx) => {
    for (const entry of entries.slice(0, upTo + 1)) {
      const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const hash = sha256File(sqlPath);
      if (await hasMigrationHash(tx, hash)) continue;
      await insertMigrationHash(tx, hash, Number(entry.when ?? Date.now()));
      console.log(`[migrate] Baseline recorded for ${entry.tag}`);
    }
  });
}

/** An error retrying cannot fix — stop the attempt loop immediately. */
function fatal(message) {
  return Object.assign(new Error(message), { fatal: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(raw, fallback) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value) || value < 1) {
    if (raw !== undefined) {
      console.warn(`[migrate] Ignoring invalid value "${raw}", using ${fallback}`);
    }
    return fallback;
  }
  return Math.floor(value);
}

async function main() {
  const migrationsFolder = findMigrationsFolder();
  if (!migrationsFolder) {
    console.error("[migrate] Could not find migrations folder");
    process.exit(1);
    return;
  }

  console.log(`[migrate] Using migrations from: ${migrationsFolder}`);

  // A bad value here must not skip the loop entirely and exit 0 having migrated
  // nothing, which is what Number("x") <= 0 would do.
  const maxAttempts = positiveInt(process.env.MIGRATE_MAX_ATTEMPTS, 30);
  const retryDelaySeconds = positiveInt(
    process.env.MIGRATE_RETRY_DELAY_SECONDS,
    2
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = postgres(DATABASE_URL, {
      max: 1,
      onnotice: (notice) => {
        if (notice?.code && IGNORED_NOTICE_CODES.has(notice.code)) return;
        console.warn("[migrate] PostgreSQL notice:", notice);
      },
    });
    let lockAcquired = false;

    try {
      console.log(
        `[migrate] Running database migrations (attempt ${attempt}/${maxAttempts})...`
      );

      await client`SELECT pg_advisory_lock(${LOCK_KEY_1}, ${LOCK_KEY_2})`;
      lockAcquired = true;
      console.log("[migrate] Migration lock acquired");

      await ensureMigrationsTable(client);
      await moveTrackingTableOutOfPublic(client);
      await baselineIfNeeded(client, migrationsFolder);

      const db = drizzle(client);
      await migrate(db, { migrationsFolder });

      console.log("[migrate] Pending migrations applied successfully");
      await client.end();
      process.exit(0);
    } catch (error) {
      const msg = error?.message || String(error);

      if (error?.fatal || attempt === maxAttempts) {
        console.error(`[migrate] Migrations failed: ${msg}`);
        await client.end();
        process.exit(1);
      }

      console.warn(
        `[migrate] Attempt ${attempt} failed (${msg}), retrying in ${retryDelaySeconds}s...`
      );
    } finally {
      if (lockAcquired) {
        try {
          await client`SELECT pg_advisory_unlock(${LOCK_KEY_1}, ${LOCK_KEY_2})`;
          console.log("[migrate] Migration lock released");
        } catch {
          // lock released on disconnect anyway
        }
      }
      await client.end();
    }

    await sleep(retryDelaySeconds * 1000);
  }
}

await main();
