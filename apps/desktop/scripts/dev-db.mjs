// Postgres for `pnpm dev`, no Docker needed. Runs until Ctrl+C.
import path from "node:path";
import { databaseUrl, startPostgres } from "../src/postgres.mjs";

const port = Number(process.env.PG_PORT || 5432);
const pg = await startPostgres(path.join(import.meta.dirname, "../../../.pg-dev"), port);
console.log(`Postgres ready. Put this in .env:\nDATABASE_URL=${databaseUrl(port)}`);

const stop = () => pg.stop().finally(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
