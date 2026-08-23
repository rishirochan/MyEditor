import { spawn } from "child_process";
import {
  completeWithCliBridge,
  isCliBridgeConfigured,
} from "@/lib/ai/cliBridge";
import { resolveClaudeBinary } from "@/lib/ai/cliDetect";
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

export async function completeWithClaudeCli(params: {
  model: string;
  effort?: string | null;
  systemPrompt: string;
  userPrompt: string;
  images?: AiImageInput[];
}): Promise<string> {
  if (isCliBridgeConfigured()) {
    return completeWithCliBridge({ provider: "claude-cli", ...params });
  }

  const binaryPath = await resolveClaudeBinary();
  const hasImages = Boolean(params.images?.length);

  const args = [
    "-p",
    ...(hasImages ? ["--input-format", "stream-json"] : [params.userPrompt]),
    "--output-format",
    hasImages ? "stream-json" : "text",
    ...(hasImages ? ["--verbose"] : []),
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
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Claude CLI timed out after ${CLAUDE_TIMEOUT_MS}ms`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start Claude CLI: ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

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
        resolve(hasImages ? extractClaudeStreamResult(text) : text);
      } catch (error) {
        reject(error);
      }
    });
  });
}
