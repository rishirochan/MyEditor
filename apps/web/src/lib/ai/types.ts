export type AiProvider =
  | "openai"
  | "openrouter"
  | "anthropic"
  | "custom"
  | "claude-cli"
  | "codex-cli";

export type AiPurpose = "buildFix" | "latexWriter";

export interface AiModelSettings {
  provider: AiProvider;
  model: string;
  /** Reasoning / intelligence effort for CLI providers (e.g. low, medium, high). */
  effort: string | null;
  endpoint: string | null;
  apiKey: string | null;
}

export interface UserAiSettings {
  enabled: boolean;
  buildFix: AiModelSettings;
  latexWriter: AiModelSettings;
}

export interface PublicAiModelSettings {
  provider: AiProvider;
  model: string;
  effort: string | null;
  endpoint: string | null;
  apiKeySet: boolean;
}

export interface PublicUserAiSettings {
  enabled: boolean;
  buildFix: PublicAiModelSettings;
  latexWriter: PublicAiModelSettings;
}

export function isCliProvider(
  provider: AiProvider
): provider is "claude-cli" | "codex-cli" {
  return provider === "claude-cli" || provider === "codex-cli";
}
