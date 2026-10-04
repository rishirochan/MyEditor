import { app, BrowserWindow, dialog, shell, utilityProcess } from "electron";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { databaseUrl, startPostgres } from "./postgres.mjs";

const resources = app.isPackaged
  ? process.resourcesPath
  : path.join(import.meta.dirname, "../build");
const userData = app.getPath("userData");
const logFile = path.join(userData, "server.log");

let pg = null;
let server = null;

// Apps launched from Finder get a bare PATH, so latexmk and the claude/codex
// CLIs wouldn't be found. Borrow the login shell's PATH, plus MacTeX's bin.
function fixPath() {
  let shellPath = "";
  try {
    const out = execFileSync(
      process.env.SHELL || "/bin/zsh",
      ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'],
      { encoding: "utf8", timeout: 5000 }
    );
    shellPath = out.match(/__PATH__(.*)__PATH__/)?.[1] ?? "";
  } catch {
    // fall back to the defaults below
  }
  process.env.PATH = [
    shellPath,
    "/Library/TeX/texbin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH,
  ].filter(Boolean).join(":");
}

function listen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(null));
    srv.listen(port, "127.0.0.1", () => {
      const bound = srv.address().port;
      srv.close(() => resolve(bound));
    });
  });
}

// The web UI connects its socket to the web port + 1, so both must be free.
async function freePortPair() {
  for (;;) {
    const port = await listen(0);
    if (port && (await listen(port + 1))) return port;
  }
}

// Encrypts saved AI keys, so it must survive restarts.
function sessionSecret() {
  const file = path.join(userData, "session-secret");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, randomBytes(48).toString("hex"), { mode: 0o600 });
  }
  return fs.readFileSync(file, "utf8").trim();
}

async function waitForServer(url, child) {
  let exited = false;
  child.once("exit", () => { exited = true; });
  for (let i = 0; i < 240 && !exited; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(exited ? "The app server exited during startup." : "The app server did not start in time.");
}

async function start() {
  fixPath();
  fs.mkdirSync(userData, { recursive: true });

  const pgPort = await listen(0);
  pg = await startPostgres(path.join(userData, "postgres"), pgPort);

  const port = await freePortPair();
  const log = fs.createWriteStream(logFile, { flags: "a" });
  server = utilityProcess.fork(path.join(resources, "server/apps/web/server.js"), [], {
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      WS_PORT: String(port + 1),
      DATABASE_URL: databaseUrl(pgPort),
      STORAGE_PATH: path.join(userData, "data"),
      TEMPLATES_PATH: path.join(resources, "templates"),
      SESSION_SECRET: sessionSecret(),
    },
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);

  const origin = `http://localhost:${port}`;
  await waitForServer(`${origin}/api/health`, server);
  server.once("exit", (code) => {
    if (!app.isQuitting) {
      dialog.showErrorBox("MyEditor stopped", `The app server exited (code ${code}). See ${logFile}`);
      app.quit();
    }
  });

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "MyEditor",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links meant for a new tab open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: url.startsWith(origin) ? "allow" : "deny" };
  });
  await win.loadURL(`${origin}/dashboard`);
}

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight the first over the database files.
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox("MyEditor failed to start", `${err?.message ?? err}\n\nLog: ${logFile}`);
    app.quit();
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (app.isQuitting) return;
    app.isQuitting = true;
    event.preventDefault();
    server?.kill();
    Promise.resolve(pg?.stop()).catch(() => {}).finally(() => app.exit(0));
  });
}
