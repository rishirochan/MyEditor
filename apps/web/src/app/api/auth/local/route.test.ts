// Run with: node --experimental-strip-types apps/web/src/app/api/auth/local/route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
let user: { id: string } | null = { id: "local-user" };
const exports: { GET?: (request: Request) => Promise<Response> } = {};
runInNewContext(ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports, URL,
  require: (name: string) => {
    if (name === "@/lib/db/queries/users") return { findLocalUser: async () => user };
    if (name === "@/lib/auth/session") return {
      createSession: async () => "session",
      setSessionCookie: async () => {},
    };
    return require(name);
  },
});

const origin = "http://localhost:3000";
for (const [redirect, expected] of [
  ["/projects/123?tab=source", "/projects/123?tab=source"],
  ["/\\evil.example", "/dashboard"],
  ["//evil.example", "/dashboard"],
  ["https://evil.example", "/dashboard"],
  ["/\\evil.example:invalid", "/dashboard"],
  ["", "/dashboard"],
]) {
  const request = new NextRequest(`${origin}/api/auth/local?redirect=${encodeURIComponent(redirect)}`);
  const response = await exports.GET!(request);
  assert.equal(response.headers.get("location"), `${origin}${expected}`);
}
user = null;
assert.equal((await exports.GET!(new NextRequest(`${origin}/api/auth/local`))).headers.get("location"), `${origin}/welcome`);
