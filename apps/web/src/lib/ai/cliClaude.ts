import { spawn } from "child_process";
import { resolveClaudeBinary } from "@/lib/ai/cliDetect";

const CLAUDE_TIMEOUT_MS = 45_000;

export async function completeWithClaudeCli(params: {
  model: string;
  effort?: string | null;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const binaryPath = await resolveClaudeBinary();

  const args = [
    "-p",
    params.userPrompt,
    "--output-format",
    "text",
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
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Claude CLI timed out after ${CLAUDE_TIMEOUT_MS}ms`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
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

      resolve(text);
    });
  });
}
