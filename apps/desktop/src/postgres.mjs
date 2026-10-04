import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

export const PG_USER = "myeditor";
export const PG_PASSWORD = "myeditor";
export const PG_DATABASE = "myeditor";

/** Starts (initialising on first run) a Postgres cluster stored in `dir`. */
export async function startPostgres(dir, port) {
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: PG_USER,
    password: PG_PASSWORD,
    persistent: true,
    onLog: () => {},
    onError: (message) => console.error("[postgres]", message),
  });

  if (!fs.existsSync(path.join(dir, "PG_VERSION"))) {
    await pg.initialise();
  }
  await pg.start();

  // Not pg.createDatabase(): it leaks its client when the DB already exists,
  // and that client then crashes the process when Postgres stops.
  const client = pg.getPgClient();
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [PG_DATABASE]
    );
    if (!rowCount) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(PG_DATABASE)}`);
    }
  } finally {
    await client.end();
  }

  return pg;
}

export function databaseUrl(port) {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/${PG_DATABASE}`;
}
