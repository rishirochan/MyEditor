// Run with: node --experimental-strip-types apps/web/src/lib/compiler/tex.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { TexInstallState } from "./tex";

const require = createRequire(import.meta.url);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "myeditor-tex-test-"));
try {
  await fs.mkdir(path.join(root, "TinyTeX"));
  await fs.writeFile(path.join(root, "TinyTeX", "installed.txt"), "test archive");
  const archive = path.join(root, "tinytex.tar.xz");
  execFileSync("tar", ["cJf", archive, "-C", root, "TinyTeX"]);
  const destination = path.join(root, "missing", "parent", "TinyTeX");
  const exports: { startTexInstall?: () => TexInstallState } = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("./tex.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, {
    exports, require, console,
    process: { env: { ...process.env, TINYTEX_DIR: destination } },
    fetch: async (url: string) => url.endsWith("/latest")
      ? Response.json({ assets: [{ name: "TinyTeX-darwin-v1.tar.xz", browser_download_url: "https://test.invalid/archive" }] })
      : new Response(await fs.readFile(archive)),
  });
  const state = exports.startTexInstall!();
  const deadline = Date.now() + 5000;
  while (["downloading", "extracting"].includes(state.status) && Date.now() < deadline) {
    await setTimeout(10);
  }
  assert.equal(state.status, "done", state.error ?? "Install timed out");
  assert.equal(await fs.readFile(path.join(destination, "installed.txt"), "utf8"), "test archive");
  assert.deepEqual(await fs.readdir(path.dirname(destination)), ["TinyTeX"]);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
