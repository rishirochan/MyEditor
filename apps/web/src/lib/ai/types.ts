export type AiProvider = "openai" | "openrouter" | "anthropic" | "custom";

export type AiPurpose = "buildFix" | "latexWriter";

export interface AiModelSettings {
  provider: AiProvider;
  model: string;
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
  endpoint: string | null;
  apiKeySet: boolean;
}

export interface PublicUserAiSettings {
  enabled: boolean;
  buildFix: PublicAiModelSettings;
  latexWriter: PublicAiModelSettings;
}
