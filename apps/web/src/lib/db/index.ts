import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://backslash:backslash@backslash-postgres:5432/backslash";

if (!process.env.DATABASE_URL && process.env.NEXT_PHASE !== "phase-production-build") {
  console.warn(
    "[DB] DATABASE_URL is not set — falling back to bundled postgres default"
  );
}

const globalForDb = globalThis as typeof globalThis & {
  __myeditorPg?: ReturnType<typeof postgres>;
};

// Cap the pool and reuse across Next.js HMR reloads so we don't exhaust
// local Postgres max_connections ("sorry, too many clients already").
const client =
  globalForDb.__myeditorPg ??
  postgres(connectionString, {
    max: Number(process.env.DB_POOL_MAX || 5),
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__myeditorPg = client;
}

export const db = drizzle(client, { schema });
