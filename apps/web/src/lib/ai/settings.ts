import { db } from "@/lib/db";
import { userAiSettings } from "@/lib/db/schema";
import type {
  AiModelSettings,
  AiProvider,
  AiPurpose,
  PublicUserAiSettings,
  UserAiSettings,
} from "@/lib/ai/types";
import { isCliProvider } from "@/lib/ai/types";
import {
  CLAUDE_LATEST_FAMILY,
  CODEX_LATEST_FALLBACK,
  EFFORT_DESCRIPTIONS,
  normalizeEffort,
} from "@/lib/ai/cliModelCatalog";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";

const AI_PROVIDERS = [
  "openai",
  "openrouter",
  "anthropic",
  "custom",
  "claude-cli",
  "codex-cli",
] as const;

function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decryptStoredApiKey(value: string | null | undefined): string | null {
  const normalized = normalizeNullable(value);
  if (!normalized) return null;
  try {
    return decryptSecret(normalized);
  } catch (err) {
    console.error("[ai/settings] Failed to decrypt stored API key:", err);
    return null;
  }
}

function encryptApiKeyForStorage(value: string | null | undefined): string | null {
  const normalized = normalizeNullable(value);
  if (!normalized) return null;
  // If caller passed an already-encrypted value (e.g. pass-through from read),
  // don't re-encrypt.
  if (normalized.startsWith("enc:v1:")) return normalized;
  return encryptSecret(normalized);
}

function defaultModelFor(provider: AiProvider, purpose: AiPurpose): string {
  if (provider === "claude-cli") {
    return process.env.AI_CLAUDE_CLI_MODEL || "sonnet";
  }
  if (provider === "codex-cli") {
    return process.env.AI_CODEX_CLI_MODEL || "gpt-5.6-sol";
  }

  if (purpose === "buildFix") {
    if (provider === "openrouter") {
      return process.env.AI_BUILD_FIX_MODEL_OPENROUTER || "openai/gpt-4o-mini";
    }
    if (provider === "anthropic") {
      return process.env.AI_BUILD_FIX_MODEL_ANTHROPIC || "claude-3-5-sonnet-latest";
    }
    return process.env.AI_BUILD_FIX_MODEL || "gpt-4o-mini";
  }

  if (provider === "openrouter") {
    return process.env.AI_LATEX_WRITER_MODEL_OPENROUTER || "openai/gpt-4o-mini";
  }
  if (provider === "anthropic") {
    return process.env.AI_LATEX_WRITER_MODEL_ANTHROPIC || "claude-3-5-sonnet-latest";
  }
  return process.env.AI_LATEX_WRITER_MODEL || "gpt-4o-mini";
}

export function defaultAiSettings(): UserAiSettings {
  const defaultProvider: AiProvider = "openai";
  return {
    enabled: true,
    buildFix: {
      provider: defaultProvider,
      model: defaultModelFor(defaultProvider, "buildFix"),
      effort: null,
      endpoint: null,
      apiKey: null,
    },
    latexWriter: {
      provider: defaultProvider,
      model: defaultModelFor(defaultProvider, "latexWriter"),
      effort: null,
      endpoint: null,
      apiKey: null,
    },
  };
}

type UserAiSettingsRow = typeof userAiSettings.$inferSelect;

function normalizeCliEffort(
  provider: AiProvider,
  model: string,
  effort: string | null | undefined
): string | null {
  if (!isCliProvider(provider)) return null;

  const catalog =
    provider === "claude-cli" ? CLAUDE_LATEST_FAMILY : CODEX_LATEST_FALLBACK;
  if (!catalog.some((option) => option.id === model)) {
    // Live/legacy model we have no effort list for: keep it only if it is a
    // known level, or the CLI rejects every request with an opaque failure.
    const trimmed = normalizeNullable(effort);
    return trimmed && trimmed in EFFORT_DESCRIPTIONS ? trimmed : null;
  }
  return normalizeEffort(effort, catalog, model);
}

function rowToSettings(row: UserAiSettingsRow | null): UserAiSettings {
  const defaults = defaultAiSettings();
  if (!row) return defaults;

  const buildProvider = isAiProvider(row.buildProvider)
    ? row.buildProvider
    : defaults.buildFix.provider;
  const writerProvider = isAiProvider(row.writerProvider)
    ? row.writerProvider
    : defaults.latexWriter.provider;

  return {
    enabled: true,
    buildFix: {
      provider: buildProvider,
      model: row.buildModel?.trim() || defaultModelFor(buildProvider, "buildFix"),
      effort: normalizeCliEffort(
        buildProvider,
        row.buildModel?.trim() || defaultModelFor(buildProvider, "buildFix"),
        row.buildEffort
      ),
      endpoint: normalizeNullable(row.buildEndpoint),
      apiKey: decryptStoredApiKey(row.buildApiKey),
    },
    latexWriter: {
      provider: writerProvider,
      model: row.writerModel?.trim() || defaultModelFor(writerProvider, "latexWriter"),
      effort: normalizeCliEffort(
        writerProvider,
        row.writerModel?.trim() ||
          defaultModelFor(writerProvider, "latexWriter"),
        row.writerEffort
      ),
      endpoint: normalizeNullable(row.writerEndpoint),
      apiKey: decryptStoredApiKey(row.writerApiKey),
    },
  };
}

export async function getStoredUserAiSettingsRow(
  userId: string
): Promise<UserAiSettingsRow | null> {
  const [row] = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, userId))
    .limit(1);

  return row ?? null;
}

export async function getUserAiSettings(userId: string): Promise<UserAiSettings> {
  const row = await getStoredUserAiSettingsRow(userId);
  return rowToSettings(row);
}

export async function upsertUserAiSettings(
  userId: string,
  settings: UserAiSettings
): Promise<UserAiSettings> {
  const encryptedBuildKey = encryptApiKeyForStorage(settings.buildFix.apiKey);
  const encryptedWriterKey = encryptApiKeyForStorage(settings.latexWriter.apiKey);

  await db
    .insert(userAiSettings)
    .values({
      userId,
      aiEnabled: true,
      buildProvider: settings.buildFix.provider,
      buildModel: settings.buildFix.model,
      buildEffort: normalizeCliEffort(
        settings.buildFix.provider,
        settings.buildFix.model,
        settings.buildFix.effort
      ),
      buildEndpoint: normalizeNullable(settings.buildFix.endpoint),
      buildApiKey: encryptedBuildKey,
      writerProvider: settings.latexWriter.provider,
      writerModel: settings.latexWriter.model,
      writerEffort: normalizeCliEffort(
        settings.latexWriter.provider,
        settings.latexWriter.model,
        settings.latexWriter.effort
      ),
      writerEndpoint: normalizeNullable(settings.latexWriter.endpoint),
      writerApiKey: encryptedWriterKey,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userAiSettings.userId,
      set: {
        aiEnabled: true,
        buildProvider: settings.buildFix.provider,
        buildModel: settings.buildFix.model,
        buildEffort: normalizeCliEffort(
          settings.buildFix.provider,
          settings.buildFix.model,
          settings.buildFix.effort
        ),
        buildEndpoint: normalizeNullable(settings.buildFix.endpoint),
        buildApiKey: encryptedBuildKey,
        writerProvider: settings.latexWriter.provider,
        writerModel: settings.latexWriter.model,
        writerEffort: normalizeCliEffort(
          settings.latexWriter.provider,
          settings.latexWriter.model,
          settings.latexWriter.effort
        ),
        writerEndpoint: normalizeNullable(settings.latexWriter.endpoint),
        writerApiKey: encryptedWriterKey,
        updatedAt: new Date(),
      },
    });

  const latest = await getUserAiSettings(userId);
  return latest;
}

export function toPublicAiSettings(settings: UserAiSettings): PublicUserAiSettings {
  return {
    enabled: true,
    buildFix: {
      provider: settings.buildFix.provider,
      model: settings.buildFix.model,
      effort: settings.buildFix.effort,
      endpoint: settings.buildFix.endpoint,
      apiKeySet: isCliProvider(settings.buildFix.provider)
        ? false
        : Boolean(settings.buildFix.apiKey),
    },
    latexWriter: {
      provider: settings.latexWriter.provider,
      model: settings.latexWriter.model,
      effort: settings.latexWriter.effort,
      endpoint: settings.latexWriter.endpoint,
      apiKeySet: isCliProvider(settings.latexWriter.provider)
        ? false
        : Boolean(settings.latexWriter.apiKey),
    },
  };
}

export function resolveAiApiKey(modelSettings: AiModelSettings): string | null {
  if (isCliProvider(modelSettings.provider)) {
    return null;
  }

  if (modelSettings.apiKey?.trim()) {
    return modelSettings.apiKey.trim();
  }

  switch (modelSettings.provider) {
    case "openai":
      return process.env.OPENAI_API_KEY ?? null;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY ?? null;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ?? null;
    case "custom":
      return process.env.CUSTOM_AI_API_KEY ?? null;
    default:
      return null;
  }
}

export function resolveAiBaseUrl(modelSettings: AiModelSettings): string {
  if (isCliProvider(modelSettings.provider)) {
    return "";
  }

  const custom = normalizeNullable(modelSettings.endpoint);
  if (custom) return custom;

  switch (modelSettings.provider) {
    case "openai":
      return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    case "openrouter":
      return process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    case "anthropic":
      return process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1";
    case "custom":
      return process.env.CUSTOM_AI_BASE_URL || "";
    default:
      return "";
  }
}
