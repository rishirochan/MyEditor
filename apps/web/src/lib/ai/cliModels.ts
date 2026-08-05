import { readFile } from "fs/promises";
import {
  resolveClaudeBinary,
  resolveCodexBinary,
  runCommandCapture,
} from "@/lib/ai/cliDetect";

export interface CliModelOption {
  id: string;
  label: string;
}

const CLAUDE_ALIASES: CliModelOption[] = [
  { id: "sonnet", label: "sonnet (latest)" },
  { id: "opus", label: "opus (latest)" },
  { id: "haiku", label: "haiku (latest)" },
  { id: "fable", label: "fable (latest)" },
];

const CLAUDE_FALLBACK_IDS = [
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-opus-4-6",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-fable-5",
  "claude-haiku-4-5",
];

const CODEX_FALLBACK_IDS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.2",
];

let claudeModelsCache: { at: number; models: CliModelOption[] } | null = null;
let codexModelsCache: { at: number; models: CliModelOption[] } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

function uniqueOptions(options: CliModelOption[]): CliModelOption[] {
  const seen = new Set<string>();
  const out: CliModelOption[] = [];
  for (const option of options) {
    const id = option.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: option.label.trim() || id });
  }
  return out;
}

function extractClaudeIdsFromBinary(buffer: Buffer): string[] {
  const text = buffer.toString("latin1");
  const re =
    /claude-(?:sonnet|opus|haiku|fable)-[0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?/g;
  const found = new Set<string>();
  for (const match of text.matchAll(re)) {
    const id = match[0];
    if (/-\d{8}/.test(id)) continue;
    if (id.endsWith("-v1")) continue;
    found.add(id);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function parseFirstJsonValue(raw: string): unknown {
  const lines = raw.split("\n");
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      startLine = i;
      break;
    }
  }
  const text = lines.slice(startLine).join("\n");
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    if (firstBrace < 0) throw new Error("No JSON object found");
    let depth = 0;
    let end = -1;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) throw new Error("Unbalanced JSON object");
    return JSON.parse(text.slice(firstBrace, end));
  }
}

export async function listClaudeCliModels(
  binaryPath?: string | null
): Promise<CliModelOption[]> {
  const now = Date.now();
  if (claudeModelsCache && now - claudeModelsCache.at < CACHE_TTL_MS) {
    return claudeModelsCache.models;
  }

  let ids: string[] = [];
  try {
    const resolved = binaryPath || (await resolveClaudeBinary());
    const buffer = await readFile(resolved);
    ids = extractClaudeIdsFromBinary(buffer);
  } catch {
    ids = [...CLAUDE_FALLBACK_IDS];
  }

  if (ids.length === 0) {
    ids = [...CLAUDE_FALLBACK_IDS];
  }

  const models = uniqueOptions([
    ...CLAUDE_ALIASES,
    ...ids.map((id) => ({ id, label: id })),
  ]);
  claudeModelsCache = { at: now, models };
  return models;
}

function parseCodexModels(raw: string): CliModelOption[] {
  const parsed = parseFirstJsonValue(raw);
  const options: CliModelOption[] = [];
  const models =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { models?: unknown }).models)
      ? (parsed as { models: unknown[] }).models
      : Array.isArray(parsed)
        ? parsed
        : [];

  for (const item of models) {
    if (typeof item === "string") {
      options.push({ id: item, label: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id =
      (typeof record.slug === "string" && record.slug) ||
      (typeof record.id === "string" && record.id) ||
      (typeof record.model === "string" && record.model) ||
      null;
    if (!id) continue;
    const label =
      (typeof record.display_name === "string" && record.display_name) ||
      (typeof record.name === "string" && record.name) ||
      id;
    options.push({ id, label });
  }

  return uniqueOptions(options);
}

export async function listCodexCliModels(
  binaryPath?: string | null
): Promise<CliModelOption[]> {
  const now = Date.now();
  if (codexModelsCache && now - codexModelsCache.at < CACHE_TTL_MS) {
    return codexModelsCache.models;
  }

  let models: CliModelOption[] = [];
  try {
    const resolved = binaryPath || (await resolveCodexBinary());
    if (!resolved) {
      throw new Error("Codex binary missing");
    }
    const result = await runCommandCapture(
      resolved,
      ["debug", "models"],
      25_000
    );
    models = parseCodexModels(`${result.stdout}\n${result.stderr}`);
  } catch {
    models = [];
  }

  if (models.length === 0) {
    models = CODEX_FALLBACK_IDS.map((id) => ({ id, label: id }));
  }

  codexModelsCache = { at: now, models };
  return models;
}

export async function listCliModels(params: {
  claudeBinaryPath?: string | null;
  codexBinaryPath?: string | null;
}): Promise<{ claude: CliModelOption[]; codex: CliModelOption[] }> {
  const [claude, codex] = await Promise.all([
    listClaudeCliModels(params.claudeBinaryPath),
    listCodexCliModels(params.codexBinaryPath),
  ]);
  return { claude, codex };
}
