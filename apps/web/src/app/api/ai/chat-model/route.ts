import { withAuth } from "@/lib/auth/middleware";
import {
  CLAUDE_LATEST_FAMILY,
  CODEX_LATEST_FALLBACK,
  normalizeEffort,
  type CliModelOption,
} from "@/lib/ai/cliModelCatalog";
import { detectCliStatus, type CliStatusSnapshot } from "@/lib/ai/cliDetect";
import { defaultModelForProvider, modelsForProvider, providerLabel } from "@/lib/ai/models";
import { getUserAiSettings, upsertUserAiSettings } from "@/lib/ai/settings";
import { isCliProvider, type AiProvider, type UserAiSettings } from "@/lib/ai/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CLI_PROVIDERS = ["claude-cli", "codex-cli"] as const;

const patchSchema = z.object({
  provider: z.enum(CLI_PROVIDERS).optional(),
  model: z.string().trim().min(1).max(255).optional(),
  effort: z.string().trim().min(1).max(32).nullable().optional(),
});

async function loadCliSnapshot(): Promise<CliStatusSnapshot | null> {
  try {
    return await detectCliStatus();
  } catch {
    return null;
  }
}

function isCliReady(
  snapshot: CliStatusSnapshot | null,
  provider: (typeof CLI_PROVIDERS)[number]
): boolean {
  const status = provider === "claude-cli" ? snapshot?.claude : snapshot?.codex;
  return Boolean(status?.installed && status?.authenticated);
}

/* Only CLI services are offered as quick switches. An API provider stores one
   key per purpose, so switching to a different one would reuse the previous
   provider's key. Those switches stay in Settings, where a key is entered. */
function availableProviders(
  current: AiProvider,
  snapshot: CliStatusSnapshot | null
): AiProvider[] {
  const ready = CLI_PROVIDERS.filter((provider) => isCliReady(snapshot, provider));
  return ready.includes(current as (typeof CLI_PROVIDERS)[number])
    ? [...ready]
    : [current, ...ready];
}

function modelsFor(
  provider: AiProvider,
  currentModel: string,
  snapshot: CliStatusSnapshot | null
): CliModelOption[] {
  if (!isCliProvider(provider)) {
    const curated = modelsForProvider(provider, currentModel).map((id) => ({
      id,
      label: id,
      efforts: [],
    }));
    return curated.length > 0
      ? curated
      : [{ id: currentModel, label: currentModel, efforts: [] }];
  }

  const live =
    provider === "claude-cli" ? snapshot?.models.claude : snapshot?.models.codex;
  if (live && live.length > 0) return live;
  return provider === "claude-cli" ? CLAUDE_LATEST_FAMILY : CODEX_LATEST_FALLBACK;
}

function chatModelPayload(params: {
  settings: UserAiSettings;
  providers: AiProvider[];
  options: CliModelOption[];
}) {
  const { latexWriter } = params.settings;
  return {
    provider: latexWriter.provider,
    model: latexWriter.model,
    effort: latexWriter.effort,
    services: params.providers.map((provider) => ({
      id: provider,
      label: providerLabel(provider),
    })),
    options: params.options.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.defaultEffort ? { defaultEffort: option.defaultEffort } : {}),
      efforts: option.efforts ?? [],
    })),
  };
}

export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, user) => {
    const settings = await getUserAiSettings(user.id);
    const snapshot = await loadCliSnapshot();
    const { provider, model } = settings.latexWriter;

    return NextResponse.json(
      chatModelPayload({
        settings,
        providers: availableProviders(provider, snapshot),
        options: modelsFor(provider, model, snapshot),
      })
    );
  });
}

export async function PATCH(request: NextRequest) {
  return withAuth(request, async (req, user) => {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }

    const settings = await getUserAiSettings(user.id);
    const snapshot = await loadCliSnapshot();
    const providers = availableProviders(settings.latexWriter.provider, snapshot);

    const provider = parsed.data.provider ?? settings.latexWriter.provider;
    if (!providers.includes(provider)) {
      return NextResponse.json(
        { error: `${providerLabel(provider)} is not ready to use` },
        { status: 400 }
      );
    }

    const switchedProvider = provider !== settings.latexWriter.provider;
    const options = modelsFor(provider, settings.latexWriter.model, snapshot);

    const requestedModel =
      parsed.data.model ??
      (switchedProvider ? defaultModelForProvider(provider) : settings.latexWriter.model);
    const model = options.some((option) => option.id === requestedModel)
      ? requestedModel
      : (options[0]?.id ?? requestedModel);

    if (parsed.data.model && parsed.data.model !== model) {
      return NextResponse.json(
        { error: `Model is not available for ${providerLabel(provider)}` },
        { status: 400 }
      );
    }

    const requestedEffort = switchedProvider
      ? (parsed.data.effort ?? null)
      : (parsed.data.effort ?? settings.latexWriter.effort);
    const effort = isCliProvider(provider)
      ? normalizeEffort(requestedEffort, options, model)
      : null;

    /* Endpoint and API key stay untouched: they belong to the provider stored
       before this switch, so switching back to it keeps working. */
    const saved = await upsertUserAiSettings(user.id, {
      ...settings,
      latexWriter: { ...settings.latexWriter, provider, model, effort },
    });

    return NextResponse.json(
      chatModelPayload({
        settings: saved,
        providers: availableProviders(saved.latexWriter.provider, snapshot),
        options: modelsFor(saved.latexWriter.provider, saved.latexWriter.model, snapshot),
      })
    );
  });
}
