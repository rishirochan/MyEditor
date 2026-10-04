import { spawn } from "child_process";
import { readFile } from "fs/promises";
import path from "path";
import { ENGINE_FLAGS, LIMITS } from "@myeditor/shared";
import type { Engine } from "@myeditor/shared";
import { installMissingPackage, texPath } from "./tex";

const COMPILE_TIMEOUT = parseInt(
  process.env.COMPILE_TIMEOUT || String(LIMITS.COMPILE_TIMEOUT_DEFAULT),
  10
);

const LATEX_MISSING_MESSAGE =
  "LaTeX is not installed yet. Restart MyEditor to finish setting it up.";

// Each round can install one package; documents rarely miss more than a few.
const MAX_PACKAGE_INSTALLS = 5;

export interface CompileOptions {
  projectDir: string;
  mainFile: string;
  engine?: Engine;
  signal?: AbortSignal;
}

export interface CompileResult {
  exitCode: number;
  logs: string;
  timedOut: boolean;
  canceled: boolean;
  engineUsed: Exclude<Engine, "auto">;
}

/**
 * Detects the best LaTeX engine by reading the main .tex file.
 * - luacode / directlua / luatextra → lualatex
 * - fontspec / unicode-math / polyglossia → xelatex
 * - everything else → pdflatex
 */
export async function detectEngine(
  projectDir: string,
  mainFile: string
): Promise<Exclude<Engine, "auto">> {
  try {
    const content = await readFile(path.join(projectDir, mainFile), "utf-8");

    if (/\\usepackage\{luacode\}|\\directlua\b|\\usepackage\{luatextra\}/.test(content)) {
      return "lualatex";
    }
    if (/\\usepackage\{fontspec\}|\\usepackage\{unicode-math\}|\\usepackage\{polyglossia\}/.test(content)) {
      return "xelatex";
    }
  } catch {
    // If we can't read the file, fall back to pdflatex
  }
  return "pdflatex";
}

/**
 * Compiles, installing any LaTeX package the document needs but TinyTeX
 * lacks, then retrying.
 */
export async function runCompile(options: CompileOptions): Promise<CompileResult> {
  let result = await runLatexmk(options);
  const installed: string[] = [];

  while (
    result.exitCode !== 0 &&
    !result.canceled &&
    !result.timedOut &&
    installed.length < MAX_PACKAGE_INSTALLS
  ) {
    const pkg = await installMissingPackage(result.logs);
    if (!pkg || installed.includes(pkg)) break;
    installed.push(pkg);
    result = await runLatexmk(options);
  }

  if (installed.length > 0) {
    result.logs = `[MyEditor] Installed missing LaTeX packages: ${installed.join(", ")}\n\n${result.logs}`;
  }
  return result;
}

/**
 * Runs latexmk in projectDir. The process is spawned in its own process group
 * so cancel/timeout can kill latexmk and the engine it launched together.
 */
async function runLatexmk(options: CompileOptions): Promise<CompileResult> {
  const { projectDir, mainFile, engine: requestedEngine, signal } = options;

  const engineUsed: Exclude<Engine, "auto"> = requestedEngine && requestedEngine !== "auto"
    ? requestedEngine
    : await detectEngine(projectDir, mainFile);

  if (signal?.aborted) {
    return { exitCode: -1, logs: "Build canceled by user.", timedOut: false, canceled: true, engineUsed };
  }

  const args = [
    ENGINE_FLAGS[engineUsed],
    "-gg",
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    "-no-shell-escape",
    mainFile,
  ];

  return new Promise<CompileResult>((resolve) => {
    const chunks: Buffer[] = [];
    let timedOut = false;
    let canceled = false;
    let settled = false;

    const child = spawn("latexmk", args, {
      cwd: projectDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: texPath() },
    });

    const killGroup = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already exited
      }
    };
    const onAbort = () => {
      canceled = true;
      killGroup();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, COMPILE_TIMEOUT * 1000);
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (result: Omit<CompileResult, "engineUsed" | "timedOut" | "canceled">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ...result, timedOut, canceled, engineUsed });
    };

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

    child.on("error", (err: NodeJS.ErrnoException) => {
      const logs = err.code === "ENOENT"
        ? LATEX_MISSING_MESSAGE
        : `Failed to run latexmk: ${err.message}`;
      finish({ exitCode: -1, logs });
    });

    child.on("close", (code) => {
      // Strip null bytes that PostgreSQL rejects
      const logs = Buffer.concat(chunks).toString("utf-8").replace(/\0/g, "");
      finish({ exitCode: timedOut || canceled ? -1 : code ?? -1, logs });
    });
  });
}
