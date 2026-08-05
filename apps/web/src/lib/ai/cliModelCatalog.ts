export interface CliReasoningLevel {
  effort: string;
  description?: string;
}

export interface CliModelOption {
  id: string;
  label: string;
  defaultEffort?: string;
  efforts?: CliReasoningLevel[];
}

export const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Greater reasoning depth for complex problems",
  xhigh: "Extra high reasoning depth for complex problems",
  max: "Maximum reasoning depth for the hardest problems",
  ultra: "Maximum reasoning with automatic task delegation",
};

const FULL_CLAUDE_EFFORTS: CliReasoningLevel[] = [
  { effort: "low", description: EFFORT_DESCRIPTIONS.low },
  { effort: "medium", description: EFFORT_DESCRIPTIONS.medium },
  { effort: "high", description: EFFORT_DESCRIPTIONS.high },
  { effort: "xhigh", description: EFFORT_DESCRIPTIONS.xhigh },
  { effort: "max", description: EFFORT_DESCRIPTIONS.max },
];

/** Offline fallback for Claude's latest family aliases. */
export const CLAUDE_LATEST_FAMILY: CliModelOption[] = [
  {
    id: "opus",
    label: "Opus 5",
    defaultEffort: "high",
    efforts: FULL_CLAUDE_EFFORTS,
  },
  {
    id: "sonnet",
    label: "Sonnet 5",
    defaultEffort: "high",
    efforts: FULL_CLAUDE_EFFORTS,
  },
  {
    // Haiku 4.5 has no effort capability in current Claude CLI.
    id: "haiku",
    label: "Haiku 4.5",
    efforts: [],
  },
];

/** Offline fallback for Codex's latest planetary family. */
export const CODEX_LATEST_FALLBACK: CliModelOption[] = [
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    defaultEffort: "low",
    efforts: [
      { effort: "low", description: EFFORT_DESCRIPTIONS.low },
      { effort: "medium", description: EFFORT_DESCRIPTIONS.medium },
      { effort: "high", description: EFFORT_DESCRIPTIONS.high },
      { effort: "xhigh", description: EFFORT_DESCRIPTIONS.xhigh },
      { effort: "max", description: EFFORT_DESCRIPTIONS.max },
      { effort: "ultra", description: EFFORT_DESCRIPTIONS.ultra },
    ],
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    defaultEffort: "medium",
    efforts: [
      { effort: "low", description: EFFORT_DESCRIPTIONS.low },
      { effort: "medium", description: EFFORT_DESCRIPTIONS.medium },
      { effort: "high", description: EFFORT_DESCRIPTIONS.high },
      { effort: "xhigh", description: EFFORT_DESCRIPTIONS.xhigh },
      { effort: "max", description: EFFORT_DESCRIPTIONS.max },
      { effort: "ultra", description: EFFORT_DESCRIPTIONS.ultra },
    ],
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    defaultEffort: "medium",
    efforts: [
      { effort: "low", description: EFFORT_DESCRIPTIONS.low },
      { effort: "medium", description: EFFORT_DESCRIPTIONS.medium },
      { effort: "high", description: EFFORT_DESCRIPTIONS.high },
      { effort: "xhigh", description: EFFORT_DESCRIPTIONS.xhigh },
      { effort: "max", description: EFFORT_DESCRIPTIONS.max },
    ],
  },
];

/** Derive Claude effort levels from model capability flags. */
export function effortsFromClaudeCapabilities(
  capabilities: string[],
  defaultEffort?: string | null
): { efforts: CliReasoningLevel[]; defaultEffort?: string } {
  if (!capabilities.includes("effort")) {
    return { efforts: [] };
  }

  const efforts: CliReasoningLevel[] = [
    { effort: "low", description: EFFORT_DESCRIPTIONS.low },
    { effort: "medium", description: EFFORT_DESCRIPTIONS.medium },
    { effort: "high", description: EFFORT_DESCRIPTIONS.high },
  ];
  if (capabilities.includes("xhigh_effort")) {
    efforts.push({
      effort: "xhigh",
      description: EFFORT_DESCRIPTIONS.xhigh,
    });
  }
  if (capabilities.includes("max_effort")) {
    efforts.push({ effort: "max", description: EFFORT_DESCRIPTIONS.max });
  }

  const preferred = defaultEffort?.trim();
  const resolvedDefault =
    preferred && efforts.some((level) => level.effort === preferred)
      ? preferred
      : "high";

  return { efforts, defaultEffort: resolvedDefault };
}

export function effortsForModel(
  models: CliModelOption[] | null | undefined,
  modelId: string
): { efforts: CliReasoningLevel[]; defaultEffort: string | null } {
  const match = models?.find((option) => option.id === modelId);
  const efforts = match?.efforts ?? [];
  return {
    efforts,
    defaultEffort: match?.defaultEffort ?? efforts[0]?.effort ?? null,
  };
}

export function normalizeEffort(
  effort: string | null | undefined,
  models: CliModelOption[] | null | undefined,
  modelId: string
): string | null {
  const { efforts, defaultEffort } = effortsForModel(models, modelId);
  if (efforts.length === 0) return null;
  const trimmed = effort?.trim();
  if (trimmed && efforts.some((level) => level.effort === trimmed)) {
    return trimmed;
  }
  return defaultEffort;
}
