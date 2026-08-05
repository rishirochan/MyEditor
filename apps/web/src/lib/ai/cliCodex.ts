import { randomUUID } from "crypto";
import { readCodexAuth } from "@/lib/ai/cliDetect";

const CODEX_TIMEOUT_MS = 45_000;
const CODEX_RESPONSES_URL =
  process.env.CODEX_RESPONSES_URL ||
  "https://chatgpt.com/backend-api/codex/responses";

interface CodexAuthTokens {
  accessToken: string;
  accountId: string;
}

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

function extractTextFromSse(raw: string): string {
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
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const { accessToken, accountId } = await loadCodexTokens();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CODEX_TIMEOUT_MS);

  try {
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
      body: JSON.stringify({
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
      }),
      signal: controller.signal,
    });

    const body = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(
        `Codex request failed (${res.status}): ${body || res.statusText}. If login expired, run Log in in Settings or \`codex login\`.`
      );
    }

    const text = extractAssistantText(body, res.headers.get("content-type"));
    if (!text.trim()) {
      throw new Error("Codex returned no completion content");
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
