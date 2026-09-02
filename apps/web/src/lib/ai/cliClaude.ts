import { spawn } from "child_process";
import { abortError } from "@/lib/ai/abort";
import {
  completeWithCliBridge,
  isCliBridgeConfigured,
} from "@/lib/ai/cliBridge";
import { resolveClaudeBinary } from "@/lib/ai/cliDetect";
import type { CodexProgressEvent } from "@/lib/ai/cliCodex";
import type { AiImageInput } from "@/lib/ai/imageInput";

const CLAUDE_TIMEOUT_MS = 45_000;

export function extractClaudeStreamResult(raw: string): string {
  for (const line of raw.trim().split("\n").reverse()) {
    try {
      const event = JSON.parse(line) as { type?: string; result?: unknown };
      if (event.type === "result" && typeof event.result === "string") {
        return event.result.trim();
      }
    } catch {
      continue;
    }
  }
  throw new Error("Claude CLI returned no completion content");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function emitFromContentBlock(
  block: Record<string, unknown>,
  onProgress: (event: CodexProgressEvent) => void
) {
  const type = typeof block.type === "string" ? block.type : "";
  if (type === "tool_use" || type === "server_tool_use") {
    const name = typeof block.name === "string" ? block.name.trim() : "";
    if (name) onProgress({ type: "tool_call", name });
    return;
  }
  if (type === "thinking") {
    const text =
      typeof block.thinking === "string"
        ? block.thinking
        : typeof block.text === "string"
          ? block.text
          : "";
    if (text) onProgress({ type: "reasoning_summary", text });
  }
}

export function emitClaudeStreamProgress(
  line: string,
  onProgress: (event: CodexProgressEvent) => void
): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return;
  }

  const type = typeof event.type === "string" ? event.type : "";
  if (type === "assistant") {
    const message = asRecord(event.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const item of content) {
      const block = asRecord(item);
      if (block) emitFromContentBlock(block, onProgress);
    }
    return;
  }

  if (type === "content_block_start") {
    const block = asRecord(event.content_block);
    if (block) emitFromContentBlock(block, onProgress);
    return;
  }

  if (type === "content_block_delta") {
    const delta = asRecord(event.delta);
    const thinking =
      typeof delta?.thinking === "string"
        ? delta.thinking
        : typeof delta?.text === "string" && delta.type === "thinking_delta"
          ? delta.text
          : "";
    if (thinking) onProgress({ type: "reasoning_summary", text: thinking });
    return;
  }

  if (type === "stream_event") {
    const nested = asRecord(event.event);
    if (!nested) return;
    emitClaudeStreamProgress(JSON.stringify(nested), onProgress);
  }
}

export async function completeWithClaudeCli(params: {
  model: string;
  effort?: string | null;
  systemPrompt: string;
  userPrompt: string;
  images?: AiImageInput[];
  onProgress?: (event: CodexProgressEvent) => void;
  signal?: AbortSignal;
}): Promise<string> {
  if (isCliBridgeConfigured()) {
    return completeWithCliBridge({
      provider: "claude-cli",
      model: params.model,
      effort: params.effort,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      images: params.images,
      signal: params.signal,
    });
  }

  const binaryPath = await resolveClaudeBinary();
  const hasImages = Boolean(params.images?.length);
  const streamOutput = hasImages || Boolean(params.onProgress);

  const args = [
    "-p",
    ...(hasImages ? ["--input-format", "stream-json"] : [params.userPrompt]),
    "--output-format",
    streamOutput ? "stream-json" : "text",
    ...(streamOutput ? ["--verbose"] : []),
    "--tools",
    "",
    "--system-prompt",
    params.systemPrompt,
    "--model",
    params.model,
  ];

  const effort = params.effort?.trim();
  if (effort) {
    args.push("--effort", effort);
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      env: process.env,
      stdio: [hasImages ? "pipe" : "ignore", "pipe", "pipe"],
    });

    if (hasImages) {
      child.stdin?.end(
        `${JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              ...(params.images?.map((image) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mediaType,
                  data: image.data,
                },
              })) ?? []),
              { type: "text", text: params.userPrompt },
            ],
          },
        })}\n`
      );
    }

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let settled = false;

    function onAbort() {
      finish(() => {
        child.kill("SIGTERM");
        reject(abortError());
      });
    }

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
      action();
    }

    const timer = setTimeout(() => {
      finish(() => {
        child.kill("SIGTERM");
        reject(new Error(`Claude CLI timed out after ${CLAUDE_TIMEOUT_MS}ms`));
      });
    }, CLAUDE_TIMEOUT_MS);

    if (params.signal?.aborted) {
      onAbort();
      return;
    }
    params.signal?.addEventListener("abort", onAbort);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (!params.onProgress) return;
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        emitClaudeStreamProgress(line, params.onProgress);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      finish(() => {
        reject(new Error(`Failed to start Claude CLI: ${error.message}`));
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const text = stdout.trim();
        if (code !== 0) {
          reject(
            new Error(
              `Claude CLI failed (exit ${code ?? "unknown"}): ${
                stderr.trim() || text || "no output"
              }. If not logged in, run Log in in Settings or \`claude auth login\`.`
            )
          );
          return;
        }

        if (!text) {
          reject(
            new Error(
              `Claude CLI returned empty output${
                stderr.trim() ? `: ${stderr.trim()}` : ""
              }`
            )
          );
          return;
        }

        try {
          resolve(streamOutput ? extractClaudeStreamResult(text) : text);
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}
