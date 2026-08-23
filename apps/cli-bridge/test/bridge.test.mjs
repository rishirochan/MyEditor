import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createBridgeServer, validateCompletionBody } from "../src/index.mjs";

const token = "test-token-at-least-32-characters-long";
const server = createBridgeServer({ token });
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("health is public and v1 routes require the bearer token", async () => {
  assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { ok: true });
  assert.equal((await fetch(`${baseUrl}/v1/status`)).status, 401);
  const wrongToken = "x".repeat(token.length);
  assert.equal(
    (await fetch(`${baseUrl}/v1/status`, {
      headers: { Authorization: `Bearer ${wrongToken}` },
    })).status,
    401
  );
  const invalid = await fetch(`${baseUrl}/v1/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "shell", command: "whoami" }),
  });
  assert.equal(invalid.status, 400);
});

test("completion validation rejects commands and unknown fields", () => {
  assert.throws(() => validateCompletionBody({ provider: "shell", command: "whoami" }));
  assert.throws(() => validateCompletionBody({
    provider: "claude-cli",
    model: "sonnet",
    effort: null,
    systemPrompt: "Be concise.",
    userPrompt: "Hello",
    cwd: "/",
  }));
});

test("completion validation accepts real screenshots and rejects mismatched types", () => {
  const request = {
    provider: "codex-cli",
    model: "gpt-5.6-sol",
    effort: "low",
    systemPrompt: "Return JSON.",
    userPrompt: "Use this screenshot as context.",
    images: [{
      mediaType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    }],
  };

  assert.equal(validateCompletionBody(request), request);
  assert.throws(() => validateCompletionBody({
    ...request,
    images: [{ ...request.images[0], mediaType: "image/jpeg" }],
  }));
});
