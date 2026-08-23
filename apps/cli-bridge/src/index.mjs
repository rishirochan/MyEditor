import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { access, constants, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const BODY_LIMIT_BYTES = 16 * 1024 * 1024;
const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_CONCURRENT_COMPLETIONS = 2;
const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 10 * 1024 * 1024;

const EFFORT_DESCRIPTIONS = {
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Greater reasoning depth for complex problems",
  xhigh: "Extra high reasoning depth for complex problems",
  max: "Maximum reasoning depth for the hardest problems",
  ultra: "Maximum reasoning with automatic task delegation",
};

function effortOptions(names) {
  return names.map((effort) => ({ effort, description: EFFORT_DESCRIPTIONS[effort] }));
}

const CLAUDE_MODELS = [
  { id: "opus", label: "Opus 5", defaultEffort: "high", efforts: effortOptions(["low", "medium", "high", "xhigh", "max"]) },
  { id: "sonnet", label: "Sonnet 5", defaultEffort: "high", efforts: effortOptions(["low", "medium", "high", "xhigh", "max"]) },
  { id: "haiku", label: "Haiku 4.5", efforts: [] },
];

const CODEX_MODELS = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", defaultEffort: "low", efforts: effortOptions(["low", "medium", "high", "xhigh", "max", "ultra"]) },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", defaultEffort: "medium", efforts: effortOptions(["low", "medium", "high", "xhigh", "max", "ultra"]) },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", defaultEffort: "medium", efforts: effortOptions(["low", "medium", "high", "xhigh", "max"]) },
];

function emptyStatus(detail) {
  return {
    installed: false,
    authenticated: false,
    binaryPath: null,
    email: null,
    subscriptionType: null,
    detail,
  };
}

async function resolveBinary(name, configuredPath) {
  const candidates = [
    configuredPath,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    ...(process.env.PATH ?? "").split(delimiter).map((directory) => join(directory, name)),
  ].filter(Boolean);

  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  return null;
}

function cliEnvironment() {
  const allowed = [
    "HOME",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "USER",
    "LOGNAME",
    "SHELL",
    "XDG_CONFIG_HOME",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
  ];
  return Object.fromEntries(allowed.flatMap((name) =>
    process.env[name] === undefined ? [] : [[name, process.env[name]]]
  ));
}

function runCommand(command, args, input = "", timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: tmpdir(),
      detached: true,
      env: cliEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let forceKillTimer;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    const stop = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      forceKillTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 2_000);
      forceKillTimer.unref();
    };
    const appendOutput = (target, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > OUTPUT_LIMIT_BYTES) {
        stop();
        finish(new Error("CLI output exceeded the 2 MB limit"));
        return target;
      }
      return target + chunk.toString("utf8");
    };
    const timeout = setTimeout(() => {
      stop();
      finish(new Error(`CLI timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      clearTimeout(forceKillTimer);
      finish(null, { code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : null;
  } catch {
    return null;
  }
}

async function readCodexAuthMetadata() {
  try {
    const auth = JSON.parse(await readFile(join(homedir(), ".codex", "auth.json"), "utf8"));
    const accessToken = auth?.tokens?.access_token;
    const accountId = auth?.tokens?.account_id;
    const payload = decodeJwtPayload(auth?.tokens?.id_token ?? accessToken ?? "");
    return {
      authenticated: typeof accessToken === "string" && Boolean(accessToken.trim()) &&
        typeof accountId === "string" && Boolean(accountId.trim()),
      email: typeof payload?.email === "string" ? payload.email : null,
      subscriptionType: typeof auth?.auth_mode === "string" ? auth.auth_mode : null,
    };
  } catch {
    return { authenticated: false, email: null, subscriptionType: null };
  }
}

async function detectClaude() {
  const binaryPath = await resolveBinary("claude", process.env.CLAUDE_CLI_PATH);
  if (!binaryPath) return emptyStatus("Claude CLI not found on the Mac.");

  try {
    const result = await runCommand(binaryPath, ["auth", "status", "--json"], "", 12_000);
    const auth = JSON.parse(result.stdout.trim());
    const authenticated = result.code === 0 && auth.loggedIn === true;
    return {
      installed: true,
      authenticated,
      binaryPath,
      email: typeof auth.email === "string" ? auth.email : null,
      subscriptionType: typeof auth.subscriptionType === "string" ? auth.subscriptionType : null,
      detail: authenticated ? null : "Claude CLI is installed but not logged in.",
    };
  } catch {
    return { ...emptyStatus("Could not read Claude login status."), installed: true, binaryPath };
  }
}

async function detectCodex() {
  const binaryPath = await resolveBinary("codex", process.env.CODEX_CLI_PATH);
  if (!binaryPath) return emptyStatus("Codex CLI not found on the Mac.");

  try {
    const [result, auth] = await Promise.all([
      runCommand(binaryPath, ["login", "status"], "", 12_000),
      readCodexAuthMetadata(),
    ]);
    const authenticated = result.code === 0 || auth.authenticated;
    return {
      installed: true,
      authenticated,
      binaryPath,
      email: auth.email,
      subscriptionType: auth.subscriptionType ?? (authenticated ? "chatgpt" : null),
      detail: authenticated ? null : "Codex CLI is installed but not logged in.",
    };
  } catch {
    return { ...emptyStatus("Could not read Codex login status."), installed: true, binaryPath };
  }
}

async function getStatus() {
  const [claude, codex] = await Promise.all([detectClaude(), detectCodex()]);
  return { claude, codex, models: { claude: CLAUDE_MODELS, codex: CODEX_MODELS } };
}

export function validateCompletionBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  const allowedKeys = new Set(["provider", "model", "effort", "systemPrompt", "userPrompt", "images"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Request body contains an unsupported field");
  }
  if (value.provider !== "claude-cli" && value.provider !== "codex-cli") {
    throw new Error("provider must be claude-cli or codex-cli");
  }
  if (typeof value.model !== "string" || !MODEL_PATTERN.test(value.model)) {
    throw new Error("model is invalid");
  }
  if (value.effort !== null && value.effort !== undefined &&
      (typeof value.effort !== "string" || !ALLOWED_EFFORTS.has(value.effort))) {
    throw new Error("effort is invalid");
  }
  if (typeof value.systemPrompt !== "string" || value.systemPrompt.length > 65_536) {
    throw new Error("systemPrompt must be a string no longer than 65,536 characters");
  }
  if (typeof value.userPrompt !== "string" || !value.userPrompt.trim() || value.userPrompt.length > 262_144) {
    throw new Error("userPrompt must be a non-empty string no longer than 262,144 characters");
  }
  validateImages(value.images);
  return value;
}

function validateImages(images) {
  if (images === undefined) return;
  if (!Array.isArray(images) || images.length > MAX_IMAGES) {
    throw new Error(`images must contain at most ${MAX_IMAGES} items`);
  }
  let totalBytes = 0;
  for (const image of images) {
    if (!image || typeof image !== "object" || Array.isArray(image) ||
        Object.keys(image).some((key) => key !== "mediaType" && key !== "data") ||
        !IMAGE_MEDIA_TYPES.has(image.mediaType) || typeof image.data !== "string" ||
        !isValidImage(image)) {
      throw new Error("images contains invalid image data");
    }
    totalBytes += base64ByteLength(image.data);
  }
  if (totalBytes > MAX_IMAGE_TOTAL_BYTES) {
    throw new Error("images must total 10 MB or less");
  }
}

function base64ByteLength(data) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length * 3) / 4 - padding;
}

function isValidImage(image) {
  if (!image.data || image.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) ||
      base64ByteLength(image.data) > MAX_IMAGE_BYTES) return false;
  const bytes = Buffer.from(image.data.slice(0, 24), "base64");
  if (image.mediaType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (image.mediaType === "image/webp") {
    return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  }
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function extractClaudeStreamResult(raw) {
  for (const line of raw.trim().split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && typeof event.result === "string") return event.result.trim();
    } catch {
      continue;
    }
  }
  throw new Error("Claude CLI returned no completion content");
}

async function complete(request) {
  if (request.provider === "claude-cli") {
    const binaryPath = await resolveBinary("claude", process.env.CLAUDE_CLI_PATH);
    if (!binaryPath) throw new Error("Claude CLI is not installed on the Mac");
    const args = [
      "--print",
      ...(request.images?.length ? ["--input-format", "stream-json"] : []),
      "--output-format", request.images?.length ? "stream-json" : "text",
      ...(request.images?.length ? ["--verbose"] : []),
      "--tools", "",
      "--safe-mode",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--no-chrome",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      "--system-prompt", request.systemPrompt,
      "--model", request.model,
    ];
    if (request.effort) args.push("--effort", request.effort);
    const input = request.images?.length
      ? `${JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              ...request.images.map((image) => ({
                type: "image",
                source: { type: "base64", media_type: image.mediaType, data: image.data },
              })),
              { type: "text", text: request.userPrompt },
            ],
          },
        })}\n`
      : request.userPrompt;
    const text = await runCompletion(binaryPath, args, input, "Claude");
    return request.images?.length ? extractClaudeStreamResult(text) : text;
  }

  const binaryPath = await resolveBinary("codex", process.env.CODEX_CLI_PATH);
  if (!binaryPath) throw new Error("Codex CLI is not installed on the Mac");
  const args = [
    "exec",
    "--sandbox", "read-only",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-rules",
    "--ignore-user-config",
    "--color", "never",
  ];
  let imageDirectory;
  try {
    if (request.images?.length) {
      imageDirectory = await mkdtemp(join(tmpdir(), "myeditor-images-"));
      const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
      const imagePaths = [];
      for (const [index, image] of request.images.entries()) {
        const imagePath = join(imageDirectory, `screenshot-${index + 1}.${extensions[image.mediaType]}`);
        await writeFile(imagePath, Buffer.from(image.data, "base64"), { mode: 0o600 });
        imagePaths.push(imagePath);
      }
      args.push("--image", ...imagePaths);
    }
    args.push("--model", request.model);
    if (request.effort) {
      args.push("--config", `model_reasoning_effort=${JSON.stringify(request.effort)}`);
    }
    args.push("-");
    const prompt = `${request.systemPrompt}\n\nUser request:\n${request.userPrompt}`;
    return await runCompletion(binaryPath, args, prompt, "Codex");
  } finally {
    if (imageDirectory) {
      await rm(imageDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function runCompletion(binaryPath, args, input, providerName) {
  const result = await runCommand(binaryPath, args, input);
  const text = result.stdout.trim();
  if (result.code !== 0) {
    throw new Error(`${providerName} CLI failed: ${(result.stderr || text || "no output").trim().slice(0, 4_000)}`);
  }
  if (!text) throw new Error(`${providerName} CLI returned no text`);
  return text;
}

function sendJson(response, status, body) {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(json);
}

function isAuthorized(request, token) {
  const supplied = request.headers.authorization;
  if (typeof supplied !== "string" || !supplied.startsWith("Bearer ")) return false;
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied.slice(7));
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > BODY_LIMIT_BYTES) {
      throw Object.assign(new Error("Request body is too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
}

export function createBridgeServer({ token }) {
  const secret = typeof token === "string" ? token.trim() : "";
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("CLI_BRIDGE_TOKEN must be at least 32 characters");
  }
  let activeJobs = 0;

  async function withJobSlot(response, work) {
    if (activeJobs >= MAX_CONCURRENT_COMPLETIONS) {
      return sendJson(response, 429, { error: "CLI bridge is busy" });
    }
    activeJobs += 1;
    try {
      return await work();
    } finally {
      activeJobs -= 1;
    }
  }

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true });
    }
    if ((url.pathname === "/v1" || url.pathname.startsWith("/v1/")) && !isAuthorized(request, secret)) {
      return sendJson(response, 401, { error: "Unauthorized" });
    }

    try {
      if (request.method === "GET" && url.pathname === "/v1/status") {
        return withJobSlot(response, async () => sendJson(response, 200, await getStatus()));
      }
      if (request.method === "POST" && url.pathname === "/v1/complete") {
        return withJobSlot(response, async () => {
          let body;
          try {
            body = validateCompletionBody(await readJson(request));
          } catch (error) {
            if (error?.status) throw error;
            return sendJson(response, 400, {
              error: error instanceof Error ? error.message : "Invalid request",
            });
          }
          return sendJson(response, 200, { text: await complete(body) });
        });
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return sendJson(response, status, { error: error instanceof Error ? error.message : "Request failed" });
    }
  });
}

function start() {
  const host = process.env.CLI_BRIDGE_HOST || "0.0.0.0";
  const port = Number(process.env.CLI_BRIDGE_PORT || 4141);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CLI_BRIDGE_PORT must be a valid port");
  }
  const server = createBridgeServer({ token: process.env.CLI_BRIDGE_TOKEN });
  server.listen(port, host, () => console.log(`CLI bridge listening on http://${host}:${port}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
