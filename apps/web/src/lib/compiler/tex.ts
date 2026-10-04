import { execFile } from "child_process";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import type { ReadableStream } from "stream/web";
import { pipeline } from "stream/promises";
import { promisify } from "util";

const run = promisify(execFile);

// TinyTeX's standard per-user location: installing needs no admin rights, and
// an existing TinyTeX (e.g. from R) is reused.
const TINYTEX_DIR = process.env.TINYTEX_DIR || path.join(os.homedir(), "Library/TinyTeX");
const TINYTEX_BIN = path.join(TINYTEX_DIR, "bin/universal-darwin");
const TLMGR = path.join(TINYTEX_BIN, "tlmgr");
const MACTEX_BIN = "/Library/TeX/texbin";
const RELEASES_URL = "https://api.github.com/repos/rstudio/tinytex-releases/releases/latest";

/** PATH for TeX tools: the user's own TeX first, then MacTeX, then TinyTeX. */
export function texPath(): string {
  return [process.env.PATH, MACTEX_BIN, TINYTEX_BIN].filter(Boolean).join(path.delimiter);
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isTexInstalled(): Promise<boolean> {
  for (const dir of texPath().split(path.delimiter)) {
    if (await isExecutable(path.join(dir, "latexmk"))) return true;
  }
  return false;
}

// ─── First-run install ─────────────────────────────

export interface TexInstallState {
  status: "idle" | "downloading" | "extracting" | "done" | "error";
  /** 0..1 while downloading */
  progress: number;
  error: string | null;
}

// Route bundles don't share module state; globalThis is process-wide.
const globalForTex = globalThis as typeof globalThis & {
  __myeditorTexInstall?: TexInstallState;
};

export function getTexInstallState(): TexInstallState {
  return (globalForTex.__myeditorTexInstall ??= { status: "idle", progress: 0, error: null });
}

/** Starts installing TinyTeX in the background; a no-op if already running. */
export function startTexInstall(): TexInstallState {
  const state = getTexInstallState();
  if (state.status === "downloading" || state.status === "extracting") return state;

  Object.assign(state, { status: "downloading", progress: 0, error: null });
  installTinyTex(state)
    .then(() => Object.assign(state, { status: "done", progress: 1 }))
    .catch((err) => {
      console.error("[TeX] Install failed:", err);
      Object.assign(state, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  return state;
}

async function installTinyTex(state: TexInstallState): Promise<void> {
  const release = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
  if (!release.ok) throw new Error(`Couldn't reach GitHub to download LaTeX (HTTP ${release.status}).`);
  const { assets } = (await release.json()) as {
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = assets.find((a) => /^TinyTeX-darwin-v.*\.tar\.xz$/.test(a.name));
  if (!asset) throw new Error("The latest TinyTeX release has no macOS build.");

  const res = await fetch(asset.browser_download_url);
  if (!res.ok || !res.body) throw new Error(`LaTeX download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;

  // Stage next to the target so the final rename is atomic: a half-finished
  // install never looks like a working one.
  const staging = await fs.mkdtemp(path.join(path.dirname(TINYTEX_DIR), ".tinytex-"));
  try {
    const archive = path.join(staging, "tinytex.tar.xz");
    const body = Readable.fromWeb(res.body as ReadableStream);
    let received = 0;
    body.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (total) state.progress = received / total;
    });
    await pipeline(body, createWriteStream(archive));

    state.status = "extracting";
    await run("tar", ["xf", archive, "-C", staging]);
    await fs.rename(path.join(staging, "TinyTeX"), TINYTEX_DIR);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

// ─── Missing packages ──────────────────────────────

const MISSING_FILE = /! LaTeX Error: File `([^']+)' not found/;

/**
 * If the build failed on a missing .sty/.cls and TinyTeX is installed, installs
 * the package that provides it. Returns the package name, or null if nothing
 * was installed.
 */
export async function installMissingPackage(logs: string): Promise<string | null> {
  const file = logs.match(MISSING_FILE)?.[1];
  if (!file || !(await isExecutable(TLMGR))) return null;

  const env = { ...process.env, PATH: texPath() };
  try {
    const { stdout } = await run(TLMGR, ["search", "--global", "--file", `/${file}`], { env });
    const pkg = stdout.match(/^([\w.-]+):$/m)?.[1];
    if (!pkg) return null;
    await run(TLMGR, ["install", pkg], { env, timeout: 5 * 60_000 });
    console.log(`[TeX] Installed ${pkg} for ${file}`);
    return pkg;
  } catch (err) {
    console.error(`[TeX] Couldn't install a package for ${file}:`, err);
    return null;
  }
}
