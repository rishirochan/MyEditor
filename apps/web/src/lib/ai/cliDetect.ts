import { access, constants } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import {
  getCliBridgeStatus,
  isCliBridgeConfigured,
} from "@/lib/ai/cliBridge";
import type { CliModelOption } from "@/lib/ai/cliModels";

export type { CliModelOption };

export interface CliProviderStatus {
  installed: boolean;
  authenticated: boolean;
  binaryPath: string | null;
  email: string | null;
  subscriptionType: string | null;
  detail: string | null;
}

export interface CliStatusSnapshot {
  claude: CliProviderStatus;
  codex: CliProviderStatus;
  models: {
    claude: CliModelOption[];
    codex: CliModelOption[];
  };
}

const CLAUDE_CANDIDATES = [
  process.env.CLAUDE_CLI_PATH,
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "claude",
].filter((value): value is string => Boolean(value));

const CODEX_CANDIDATES = [
  process.env.CODEX_CLI_PATH,
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "codex",
].filter((value): value is string => Boolean(value));

function emptyStatus(): CliProviderStatus {
  return {
    installed: false,
    authenticated: false,
    binaryPath: null,
    email: null,
    subscriptionType: null,
    detail: null,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBinary(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) || candidate.startsWith("/")) {
      if (await pathExists(candidate)) return candidate;
      continue;
    }

    const whichPath = await runCommandCapture("which", [candidate], 5_000);
    if (whichPath.ok && whichPath.stdout.trim()) {
      return whichPath.stdout.trim().split("\n")[0] ?? null;
    }
  }
  return null;
}

interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCommandCapture(
  command: string,
  args: string[],
  timeoutMs: number,
  options?: { detached?: boolean; stdio?: "ignore" | "pipe" }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: options?.stdio === "ignore" ? "ignore" : ["ignore", "pipe", "pipe"],
      detached: options?.detached ?? false,
    });

    if (options?.detached) {
      child.unref();
      resolve({ ok: true, code: 0, stdout: "", stderr: "" });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: stderr || `Timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    id_token?: string;
  };
  auth_mode?: string;
}

export function getCodexAuthPath(): string {
  return path.join(homedir(), ".codex", "auth.json");
}

export async function readCodexAuth(): Promise<CodexAuthFile | null> {
  try {
    const raw = await readFile(getCodexAuthPath(), "utf8");
    return JSON.parse(raw) as CodexAuthFile;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function detectClaude(): Promise<CliProviderStatus> {
  const status = emptyStatus();
  const binaryPath = await resolveBinary(CLAUDE_CANDIDATES);
  if (!binaryPath) {
    status.detail = "Claude CLI not found. Install Claude Code, then retry.";
    return status;
  }

  status.installed = true;
  status.binaryPath = binaryPath;

  const result = await runCommandCapture(binaryPath, ["auth", "status", "--json"], 12_000);
  if (!result.ok && !result.stdout.trim()) {
    status.detail =
      result.stderr.trim() ||
      "Could not read Claude auth status. Run `claude auth login`.";
    return status;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string;
    };
    status.authenticated = Boolean(parsed.loggedIn);
    status.email = parsed.email ?? null;
    status.subscriptionType = parsed.subscriptionType ?? null;
    status.detail = status.authenticated
      ? null
      : "Claude CLI is installed but not logged in. Run Log in below.";
  } catch {
    status.detail = "Failed to parse Claude auth status output.";
  }

  return status;
}

async function detectCodex(): Promise<CliProviderStatus> {
  const status = emptyStatus();
  const binaryPath = await resolveBinary(CODEX_CANDIDATES);
  if (!binaryPath) {
    status.detail = "Codex CLI not found. Install Codex CLI, then retry.";
    return status;
  }

  status.installed = true;
  status.binaryPath = binaryPath;

  const auth = await readCodexAuth();
  const accessToken = auth?.tokens?.access_token?.trim();
  const accountId = auth?.tokens?.account_id?.trim();
  if (!accessToken || !accountId) {
    status.detail =
      "Codex CLI is installed but no ChatGPT login was found. Run Log in below.";
    return status;
  }

  status.authenticated = true;
  const payload = decodeJwtPayload(auth?.tokens?.id_token || accessToken);
  const emailCandidate =
    (typeof payload?.email === "string" && payload.email) ||
    (typeof payload?.preferred_username === "string" &&
      payload.preferred_username) ||
    null;
  status.email = emailCandidate;
  status.subscriptionType = auth?.auth_mode ?? "chatgpt";
  status.detail = null;
  return status;
}

export async function detectCliStatus(): Promise<CliStatusSnapshot> {
  if (isCliBridgeConfigured()) return getCliBridgeStatus();

  const [claude, codex] = await Promise.all([detectClaude(), detectCodex()]);
  const { listCliModels } = await import("@/lib/ai/cliModels");
  const models = await listCliModels({ codexBinaryPath: codex.binaryPath });
  return { claude, codex, models };
}

export async function startCliLogin(
  provider: "claude-cli" | "codex-cli"
): Promise<{ ok: boolean; message: string }> {
  if (isCliBridgeConfigured()) {
    const command =
      provider === "claude-cli" ? "claude auth login" : "codex login";
    return {
      ok: false,
      message: `Run \`${command}\` on the Mac running the CLI bridge, then refresh status.`,
    };
  }

  if (provider === "claude-cli") {
    const binaryPath = await resolveBinary(CLAUDE_CANDIDATES);
    if (!binaryPath) {
      return {
        ok: false,
        message: "Claude CLI not found. Install Claude Code first.",
      };
    }
    await runCommandCapture(binaryPath, ["auth", "login"], 1_000, {
      detached: true,
      stdio: "ignore",
    });
    return {
      ok: true,
      message: "Opened Claude login in your browser. Refresh status after finishing.",
    };
  }

  const binaryPath = await resolveBinary(CODEX_CANDIDATES);
  if (!binaryPath) {
    return {
      ok: false,
      message: "Codex CLI not found. Install Codex CLI first.",
    };
  }
  await runCommandCapture(binaryPath, ["login"], 1_000, {
    detached: true,
    stdio: "ignore",
  });
  return {
    ok: true,
    message: "Opened Codex login in your browser. Refresh status after finishing.",
  };
}

export async function resolveClaudeBinary(): Promise<string> {
  const binaryPath = await resolveBinary(CLAUDE_CANDIDATES);
  if (!binaryPath) {
    throw new Error(
      "Claude CLI not found. Install Claude Code and run `claude auth login`."
    );
  }
  return binaryPath;
}

export async function resolveCodexBinary(): Promise<string | null> {
  return resolveBinary(CODEX_CANDIDATES);
}

export { runCommandCapture };
