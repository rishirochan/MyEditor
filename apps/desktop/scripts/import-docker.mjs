// One-time move of the old Docker stack's data into the desktop app.
// Needs Docker running, the old stack stopped, and MyEditor.app closed.
//   pnpm desktop:import            refuses if the app already has users
//   pnpm desktop:import --force    replaces whatever the app has
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { databaseUrl, startPostgres } from "../src/postgres.mjs";

const PG_VOLUME = process.env.PG_VOLUME || "myeditor_postgres-data";
const FILES_VOLUME = process.env.FILES_VOLUME || "backslash-project-data";
const IMAGE = "postgres:16-alpine";
const CONTAINER = "myeditor-import";
const force = process.argv.includes("--force");

const repoRoot = path.join(import.meta.dirname, "../../..");
const userData = path.join(os.homedir(), "Library/Application Support/MyEditor");

const docker = (...args) =>
  execFileSync("docker", args, { maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "inherit"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Must match what the Docker app encrypted saved AI keys with.
function dockerSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const env = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
  return env.match(/^SESSION_SECRET=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "")
    || "change-me-to-a-random-64-char-string"; // docker-compose's default
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ── 1. Read everything out of Docker before touching the app's data ──

if (docker("ps", "-q", "--filter", `volume=${PG_VOLUME}`).toString().trim()) {
  throw new Error(`A container is using ${PG_VOLUME}. Stop the old stack first: docker compose down`);
}

console.log(`Dumping database from volume ${PG_VOLUME}...`);
docker("run", "-d", "--rm", "--name", CONTAINER, "-v", `${PG_VOLUME}:/var/lib/postgresql/data`, IMAGE);
let dump;
try {
  for (let i = 0; ; i++) {
    try {
      docker("exec", CONTAINER, "pg_isready", "-U", "backslash");
      break;
    } catch (err) {
      if (i > 30) throw err;
      await sleep(1000);
    }
  }
  dump = docker(
    "exec", CONTAINER, "pg_dump", "-U", "backslash",
    "--inserts", "--no-owner", "--no-privileges", "backslash"
  ).toString();
} finally {
  docker("stop", CONTAINER);
}

console.log(`Copying project files from volume ${FILES_VOLUME}...`);
const filesTar = docker("run", "--rm", "-v", `${FILES_VOLUME}:/data:ro`, IMAGE, "tar", "c", "-C", "/data", "projects");

// ── 2. Load it into the desktop app ──

fs.mkdirSync(userData, { recursive: true });
const port = await freePort();
const pg = await startPostgres(path.join(userData, "postgres"), port);
const sql = postgres(databaseUrl(port), { max: 1, onnotice: () => {} });
try {
  const [{ hasTable }] = await sql`SELECT to_regclass('public.users') IS NOT NULL AS "hasTable"`;
  const hasUsers = hasTable && (await sql`SELECT 1 FROM users LIMIT 1`).length > 0;
  if (hasUsers && !force) {
    throw new Error("MyEditor already has data. Re-run with --force to replace it.");
  }

  console.log("Restoring database...");
  await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE;");
  if (!/^CREATE SCHEMA public;/m.test(dump)) await sql.unsafe("CREATE SCHEMA public;");
  // pg_dump emits psql-only \restrict lines; the rest is plain SQL, applied as one transaction.
  await sql.unsafe(dump.replace(/^\\.*$/gm, ""));
  await sql.unsafe("RESET search_path"); // the dump blanks it for this session

  const storage = path.join(userData, "data");
  fs.mkdirSync(storage, { recursive: true });
  execFileSync("tar", ["x", "-C", storage], { input: filesTar });

  fs.writeFileSync(path.join(userData, "session-secret"), dockerSessionSecret(), { mode: 0o600 });

  const [{ users, projects }] = await sql`
    SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM projects)::int AS projects`;
  console.log(`Imported ${users} user(s) and ${projects} project(s) into ${userData}`);
} finally {
  await sql.end();
  await pg.stop();
}
