import { randomUUID } from "crypto";
import {
  completeWithCliBridge,
  isCliBridgeConfigured,
} from "@/lib/ai/cliBridge";
import { readCodexAuth } from "@/lib/ai/cliDetect";

const CODEX_TIMEOUT_MS = 45_000;
const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL ||
  "https://chatgpt.com/backend-api/codex/responses";

interface CodexAuthTokens {
  accessToken: string;
  accountId: string;
}

export type CodexProgressEvent =
  | {
      type: "status";
      status:
        | "response.created"
        | "response.in_progress"
        | "response.completed"
        | "response.failed"
        | "response.incomplete";
    }
  | { type: "reasoning_summary"; text: string };

type CodexProgressCallback = (event: CodexProgressEvent) => void;

async function loadCodexTokens(): Promise<CodexAuthTokens> {
  const auth = await readCodexAuth();
  const accessToken = auth?.tokens?.access_token?.trim();
  const accountId = auth?.tokens?.account_id?.trim();
  if (!accessToken || !accountId) {
    throw new Error(
      "Codex CLI login not found. Run Log in in Settings or `codex login`."
    );
  }
  return { accessToken, accountId };
}

export function extractTextFromSse(raw: string): string {
  let doneText = "";
  const deltaPieces: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof parsed.type === "string" ? parsed.type : "";

    if (type === "response.output_text.done" && typeof parsed.text === "string") {
      doneText = parsed.text;
      continue;
    }

    if (type === "response.output_text.delta" && typeof parsed.delta === "string") {
      deltaPieces.push(parsed.delta);
      continue;
    }

    if (type === "response.output_item.done") {
      const item = parsed.item as Record<string, unknown> | undefined;
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "output_text" &&
            typeof (part as { text?: string }).text === "string"
          ) {
            doneText = (part as { text: string }).text;
          }
        }
      }
    }
  }

  if (doneText.trim()) return doneText;
  return deltaPieces.join("");
}

export function parseCodexSseEvent(record: string): Record<string, unknown> | null {
  const data = record
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return null;

  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emitCodexProgress(
  event: Record<string, unknown>,
  onProgress: CodexProgressCallback | undefined,
  summaryDeltaKeys: Set<string>
): void {
  if (!onProgress || typeof event.type !== "string") return;

  switch (event.type) {
    case "response.created":
    case "response.in_progress":
    case "response.completed":
    case "response.failed":
    case "response.incomplete":
      onProgress({ type: "status", status: event.type });
      return;
    case "response.reasoning_summary_text.delta": {
      if (typeof event.delta !== "string" || !event.delta) return;
      summaryDeltaKeys.add(`${event.item_id ?? ""}:${event.summary_index ?? ""}`);
      onProgress({ type: "reasoning_summary", text: event.delta });
      return;
    }
    case "response.reasoning_summary_text.done": {
      if (typeof event.text !== "string" || !event.text) return;
      const key = `${event.item_id ?? ""}:${event.summary_index ?? ""}`;
      if (!summaryDeltaKeys.has(key)) {
        onProgress({ type: "reasoning_summary", text: event.text });
      }
    }
  }
}

async function readResponseBody(
  body: ReadableStream<Uint8Array> | null,
  onProgress?: CodexProgressCallback
): Promise<string> {
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const summaryDeltaKeys = new Set<string>();
  let raw = "";
  let sseBuffer = "";

  const processSseRecord = (record: string) => {
    const event = parseCodexSseEvent(record);
    if (event) emitCodexProgress(event, onProgress, summaryDeltaKeys);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    sseBuffer += chunk;

    let separator = sseBuffer.match(/\r?\n\r?\n/);
    while (separator?.index !== undefined) {
      processSseRecord(sseBuffer.slice(0, separator.index));
      sseBuffer = sseBuffer.slice(separator.index + separator[0].length);
      separator = sseBuffer.match(/\r?\n\r?\n/);
    }
  }

  const tail = decoder.decode();
  raw += tail;
  sseBuffer += tail;
  processSseRecord(sseBuffer);
  return raw;
}

function extractAssistantText(rawBody: string, contentType: string | null): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new Error("Codex returned an empty response");
  }

  if (contentType?.includes("text/event-stream") || trimmed.includes("data:")) {
    const fromSse = extractTextFromSse(trimmed).trim();
    if (fromSse) return fromSse;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.output_text === "string" && parsed.output_text.trim()) {
      return parsed.output_text;
    }
    const output = parsed.output;
    if (Array.isArray(output)) {
      const pieces: string[] = [];
      for (const item of output) {
        if (!item || typeof item !== "object") continue;
        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "output_text" &&
            typeof (part as { text?: string }).text === "string"
          ) {
            pieces.push((part as { text: string }).text);
          }
        }
      }
      const joined = pieces.join("").trim();
      if (joined) return joined;
    }
  } catch {
    // Fall through to raw text.
  }

  return trimmed;
}

export async function completeWithCodexCli(params: {
  model: string;
  effort?: string | null;
  systemPrompt: string;
  userPrompt: string;
  onProgress?: CodexProgressCallback;
}): Promise<string> {
  if (isCliBridgeConfigured()) {
    params.onProgress?.({
      type: "status",
      status: "response.in_progress",
    });
    try {
      const text = await completeWithCliBridge({
        provider: "codex-cli",
        model: params.model,
        effort: params.effort,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
      });
      params.onProgress?.({
        type: "status",
        status: "response.completed",
      });
      return text;
    } catch (error) {
      params.onProgress?.({ type: "status", status: "response.failed" });
      throw error;
    }
  }

  const { accessToken, accountId } = await loadCodexTokens();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CODEX_TIMEOUT_MS);

  try {
    const effort = params.effort?.trim();
    const requestBody: Record<string, unknown> = {
      model: params.model,
      stream: true,
      store: false,
      instructions: params.systemPrompt,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: params.userPrompt,
            },
          ],
        },
      ],
    };
    requestBody.reasoning = {
      summary: "auto",
      ...(effort ? { effort } : {}),
    };

    const res = await fetch(CODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-ID": accountId,
        "OpenAI-Beta": "responses=v1",
        originator: "myeditor",
        Accept: "text/event-stream",
        "session_id": randomUUID(),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const responseBody = await readResponseBody(res.body, params.onProgress);
    if (!res.ok) {
      throw new Error(
        `Codex request failed (${res.status}): ${responseBody || res.statusText}. If login expired, run Log in in Settings or \`codex login\`.`
      );
    }

    const text = extractAssistantText(
      responseBody,
      res.headers.get("content-type")
    );
    if (!text.trim()) {
      throw new Error("Codex returned no completion content");
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
