import { createTimeoutSignal } from "@/lib/ai/abort";
import type { AiModelSettings } from "@/lib/ai/types";
import type { AiImageInput } from "@/lib/ai/imageInput";
import { isCliProvider } from "@/lib/ai/types";
import { resolveAiApiKey, resolveAiBaseUrl } from "@/lib/ai/settings";
import { completeWithClaudeCli } from "@/lib/ai/cliClaude";
import {
  completeWithCodexCli,
  type CodexProgressEvent,
} from "@/lib/ai/cliCodex";

export type AiProgressCallback = (event: CodexProgressEvent) => void;

export interface StrictJsonCompletionParams {
  modelSettings: AiModelSettings;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  images?: AiImageInput[];
  onProgress?: AiProgressCallback;
  signal?: AbortSignal;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function extractJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("AI returned an empty response");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue trying to recover JSON from fenced or mixed responses.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    throw new Error("AI response did not contain valid JSON");
  }

  const sliced = trimmed.slice(firstBrace, lastBrace + 1);
  return JSON.parse(sliced);
}

async function callOpenAiCompatible(
  params: StrictJsonCompletionParams,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  const { signal, dispose } = createTimeoutSignal(45_000, params.signal);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    if (params.modelSettings.provider === "openrouter") {
      headers["HTTP-Referer"] = process.env.APP_BASE_URL || "http://localhost:3000";
      headers["X-Title"] = "MyEditor";
    }

    const res = await fetch(`${trimTrailingSlash(baseUrl)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: params.modelSettings.model,
        temperature: params.temperature ?? 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: params.systemPrompt,
          },
          {
            role: "user",
            content: params.images?.length
              ? [
                  { type: "text", text: params.userPrompt },
                  ...params.images.map((image) => ({
                    type: "image_url",
                    image_url: {
                      url: `data:${image.mediaType};base64,${image.data}`,
                    },
                  })),
                ]
              : params.userPrompt,
          },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `AI provider request failed (${res.status}): ${body || res.statusText}`
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("AI provider returned no completion content");
    }

    return content;
  } finally {
    dispose();
  }
}

async function callAnthropic(
  params: StrictJsonCompletionParams,
  apiKey: string,
  baseUrl: string
): Promise<string> {
  const { signal, dispose } = createTimeoutSignal(45_000, params.signal);

  try {
    const res = await fetch(`${trimTrailingSlash(baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.modelSettings.model,
        max_tokens: params.maxTokens ?? 2_000,
        temperature: params.temperature ?? 0.1,
        system: params.systemPrompt,
        messages: [
          {
            role: "user",
            content: params.images?.length
              ? [
                  ...params.images.map((image) => ({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: image.mediaType,
                      data: image.data,
                    },
                  })),
                  { type: "text", text: params.userPrompt },
                ]
              : params.userPrompt,
          },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Anthropic request failed (${res.status}): ${body || res.statusText}`
      );
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const firstText = json.content?.find((item) => item.type === "text")?.text;
    if (!firstText) {
      throw new Error("Anthropic returned no text content");
    }

    return firstText;
  } finally {
    dispose();
  }
}

async function callCliProvider(
  params: StrictJsonCompletionParams
): Promise<string> {
  if (params.modelSettings.provider === "claude-cli") {
    return completeWithClaudeCli({
      model: params.modelSettings.model,
      effort: params.modelSettings.effort,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      images: params.images,
      onProgress: params.onProgress,
      signal: params.signal,
    });
  }

  return completeWithCodexCli({
    model: params.modelSettings.model,
    effort: params.modelSettings.effort,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    images: params.images,
    onProgress: params.onProgress,
    signal: params.signal,
  });
}

export async function completeStrictJson(
  params: StrictJsonCompletionParams
): Promise<unknown> {
  if (isCliProvider(params.modelSettings.provider)) {
    const text = await callCliProvider(params);
    return extractJsonPayload(text);
  }

  const apiKey = resolveAiApiKey(params.modelSettings);
  if (!apiKey) {
    throw new Error(
      `Missing API key for provider "${params.modelSettings.provider}". Set it in Settings or environment variables.`
    );
  }

  const baseUrl = resolveAiBaseUrl(params.modelSettings);
  if (!baseUrl) {
    throw new Error(
      `Missing API endpoint for provider "${params.modelSettings.provider}".`
    );
  }

  const text =
    params.modelSettings.provider === "anthropic"
      ? await callAnthropic(params, apiKey, baseUrl)
      : await callOpenAiCompatible(params, apiKey, baseUrl);

  return extractJsonPayload(text);
}
