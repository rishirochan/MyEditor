import type { CliStatusSnapshot } from "@/lib/ai/cliDetect";

const STATUS_TIMEOUT_MS = 20_000;
const COMPLETION_TIMEOUT_MS = 130_000;

type CliBridgeProvider = "claude-cli" | "codex-cli";

function bridgeUrl(): string | null {
  const value = process.env.CLI_BRIDGE_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

export function isCliBridgeConfigured(): boolean {
  return bridgeUrl() !== null && Boolean(process.env.CLI_BRIDGE_TOKEN?.trim());
}

async function requestBridge(
  path: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<unknown> {
  const baseUrl = bridgeUrl();
  if (!baseUrl) throw new Error("CLI_BRIDGE_URL is not configured");

  const token = process.env.CLI_BRIDGE_TOKEN?.trim();
  if (!token) throw new Error("CLI_BRIDGE_TOKEN is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw new Error(`CLI bridge timed out after ${timeoutMs}ms`);
    }
    throw new Error(
      "CLI bridge is unavailable. Start it with `pnpm bridge` and try again."
    );
  }

  try {
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `CLI bridge request failed (${response.status}): ${body || response.statusText}`
      );
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error("CLI bridge returned invalid JSON");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCliBridgeStatus(): Promise<CliStatusSnapshot> {
  const result = await requestBridge("/v1/status", STATUS_TIMEOUT_MS);
  if (
    !result ||
    typeof result !== "object" ||
    !("claude" in result) ||
    !("codex" in result) ||
    !("models" in result)
  ) {
    throw new Error("CLI bridge returned an invalid status response");
  }
  return result as CliStatusSnapshot;
}

export async function completeWithCliBridge(params: {
  provider: CliBridgeProvider;
  model: string;
  effort?: string | null;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const result = await requestBridge("/v1/complete", COMPLETION_TIMEOUT_MS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text =
    result &&
    typeof result === "object" &&
    "text" in result &&
    typeof result.text === "string"
      ? result.text.trim()
      : "";
  if (!text) throw new Error("CLI bridge returned no completion content");
  return text;
}
