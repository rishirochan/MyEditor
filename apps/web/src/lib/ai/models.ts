import type { AiProvider } from "@/lib/ai/types";

export const MODEL_OPTIONS: Record<
  Exclude<AiProvider, "custom">,
  readonly string[]
> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"],
  anthropic: [
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
    "claude-sonnet-4-0",
    "claude-opus-4-0",
  ],
  openrouter: [
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "anthropic/claude-3.5-sonnet",
    "google/gemini-2.0-flash-001",
    "meta-llama/llama-3.3-70b-instruct",
  ],
  // CLI lists are loaded live from the installed CLIs; these are offline fallbacks.
  "claude-cli": [
    "sonnet",
    "opus",
    "haiku",
    "fable",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-fable-5",
  ],
  "codex-cli": [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
  ],
};

export function defaultModelForProvider(provider: AiProvider): string {
  switch (provider) {
    case "claude-cli":
      return "sonnet";
    case "codex-cli":
      return "gpt-5.6-sol";
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "openrouter":
      return "openai/gpt-4o-mini";
    default:
      return "gpt-4o-mini";
  }
}

/** Curated models for a provider, prepending the saved value when it is not listed. */
export function modelsForProvider(
  provider: AiProvider,
  currentModel?: string
): string[] {
  if (provider === "custom") {
    return [];
  }

  const base = [...MODEL_OPTIONS[provider]];
  const trimmed = currentModel?.trim();
  if (trimmed && !base.includes(trimmed)) {
    return [trimmed, ...base];
  }
  return base;
}
