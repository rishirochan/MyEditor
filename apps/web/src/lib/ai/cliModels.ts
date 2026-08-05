import {
  resolveCodexBinary,
  runCommandCapture,
} from "@/lib/ai/cliDetect";
import {
  CLAUDE_LATEST_FAMILY,
  CODEX_LATEST_FALLBACK,
  EFFORT_DESCRIPTIONS,
  type CliModelOption,
  type CliReasoningLevel,
} from "@/lib/ai/cliModelCatalog";

export type { CliModelOption, CliReasoningLevel };

const PLANETARY_RE = /^(gpt-(\d+(?:\.\d+)?))-(sol|terra|luna)$/i;
const FAMILY_ORDER = ["sol", "terra", "luna"] as const;

let codexModelsCache: { at: number; models: CliModelOption[] } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

function uniqueOptions(options: CliModelOption[]): CliModelOption[] {
  const seen = new Set<string>();
  const out: CliModelOption[] = [];
  for (const option of options) {
    const id = option.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: option.label.trim() || id,
      defaultEffort: option.defaultEffort,
      efforts: option.efforts,
    });
  }
  return out;
}

function compareVersion(a: string, b: string): number {
  const as = a.split(".").map((part) => Number(part) || 0);
  const bs = b.split(".").map((part) => Number(part) || 0);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const diff = (as[i] ?? 0) - (bs[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function withEffortDescriptions(
  efforts: CliReasoningLevel[]
): CliReasoningLevel[] {
  return efforts.map((level) => ({
    ...level,
    description:
      level.description || EFFORT_DESCRIPTIONS[level.effort] || undefined,
  }));
}

function displayNameForPlanetary(slug: string, displayName?: string): string {
  if (displayName?.trim()) {
    // Prefer CLI display name, normalize "GPT-5.6-Sol" → "GPT-5.6 Sol".
    return displayName.trim().replace(/-(Sol|Terra|Luna)$/i, " $1");
  }
  const match = slug.match(PLANETARY_RE);
  if (!match) return slug;
  const version = match[2]!;
  const member = match[3]!;
  return `GPT-${version} ${member.charAt(0).toUpperCase()}${member.slice(1).toLowerCase()}`;
}

function parseReasoningLevels(raw: unknown): {
  defaultEffort?: string;
  efforts?: CliReasoningLevel[];
} {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const defaultEffort =
    (typeof record.default_reasoning_level === "string" &&
      record.default_reasoning_level) ||
    (typeof record.defaultReasoningEffort === "string" &&
      record.defaultReasoningEffort) ||
    undefined;

  const levelsRaw =
    record.supported_reasoning_levels ?? record.supportedReasoningEfforts;
  const efforts: CliReasoningLevel[] = [];
  if (Array.isArray(levelsRaw)) {
    for (const item of levelsRaw) {
      if (typeof item === "string") {
        efforts.push({
          effort: item,
          description: EFFORT_DESCRIPTIONS[item],
        });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const level = item as Record<string, unknown>;
      const effort =
        (typeof level.effort === "string" && level.effort) ||
        (typeof level.value === "string" && level.value) ||
        null;
      if (!effort) continue;
      efforts.push({
        effort,
        description:
          (typeof level.description === "string" && level.description) ||
          EFFORT_DESCRIPTIONS[effort],
      });
    }
  }

  return {
    defaultEffort,
    efforts: efforts.length > 0 ? efforts : undefined,
  };
}

/** Keep only the highest gpt-X.Y sol/terra/luna family. */
export function filterLatestCodexFamily(
  models: CliModelOption[]
): CliModelOption[] {
  const planetary: Array<{
    option: CliModelOption;
    version: string;
    member: string;
  }> = [];

  for (const option of models) {
    const match = option.id.match(PLANETARY_RE);
    if (!match) continue;
    planetary.push({
      option,
      version: match[2]!,
      member: match[3]!.toLowerCase(),
    });
  }

  if (planetary.length === 0) {
    return CODEX_LATEST_FALLBACK.map((option) => ({
      ...option,
      efforts: option.efforts ? withEffortDescriptions(option.efforts) : [],
    }));
  }

  let latestVersion = planetary[0]!.version;
  for (const item of planetary) {
    if (compareVersion(item.version, latestVersion) > 0) {
      latestVersion = item.version;
    }
  }

  const latest = planetary.filter((item) => item.version === latestVersion);
  const byMember = new Map(latest.map((item) => [item.member, item.option]));

  const ordered: CliModelOption[] = [];
  for (const member of FAMILY_ORDER) {
    const option = byMember.get(member);
    if (!option) continue;
    const fallback = CODEX_LATEST_FALLBACK.find((item) =>
      item.id.endsWith(`-${member}`)
    );
    const efforts =
      option.efforts && option.efforts.length > 0
        ? withEffortDescriptions(option.efforts)
        : fallback?.efforts
          ? withEffortDescriptions(fallback.efforts)
          : [];
    ordered.push({
      ...option,
      label: displayNameForPlanetary(option.id, option.label),
      defaultEffort:
        option.defaultEffort ||
        fallback?.defaultEffort ||
        (member === "sol" ? "low" : "medium"),
      efforts,
    });
  }

  return ordered.length > 0
    ? ordered
    : CODEX_LATEST_FALLBACK.map((option) => ({
        ...option,
        efforts: option.efforts ? withEffortDescriptions(option.efforts) : [],
      }));
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

// ponytail: curated constant, not read from the CLI. Scanning the Claude
// binary was a multi-100MB read on every settings load; bump
// CLAUDE_LATEST_FAMILY when a new family ships.
export async function listClaudeCliModels(): Promise<CliModelOption[]> {
  return CLAUDE_LATEST_FAMILY.map((option) => ({
    ...option,
    efforts: option.efforts ? [...option.efforts] : [],
  }));
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
    const reasoning = parseReasoningLevels(record);
    options.push({
      id,
      label,
      defaultEffort: reasoning.defaultEffort,
      efforts: reasoning.efforts,
    });
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

  const filtered = filterLatestCodexFamily(
    models.length > 0 ? models : CODEX_LATEST_FALLBACK
  );
  codexModelsCache = { at: now, models: filtered };
  return filtered;
}

export async function listCliModels(params: {
  codexBinaryPath?: string | null;
}): Promise<{ claude: CliModelOption[]; codex: CliModelOption[] }> {
  const [claude, codex] = await Promise.all([
    listClaudeCliModels(),
    listCodexCliModels(params.codexBinaryPath),
  ]);
  return { claude, codex };
}
