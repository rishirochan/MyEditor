import path from "path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

// Applies pending migrations on startup, so the desktop app's database is
// always current. Bookkeeping lives in the `drizzle` schema, matching what
// scripts/migrate.mjs set up on databases created under Docker.
export async function runMigrations(): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle/migrations"),
  });
  console.log("[DB] Migrations up to date");
}
