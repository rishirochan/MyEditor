// Run with: node --experimental-strip-types apps/web/src/app/api/setup/route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const origin = "http://localhost:3000";
for (const route of ["./route.ts", "./user/route.ts"]) {
  let calls = 0;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(route, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports, URL,
    require: (name: string) => {
      if (name === "@/lib/db/queries/users") return {
        findLocalUser: async () => { calls++; return { id: "existing" }; },
      };
      if (name === "@/lib/compiler/tex") return {
        isTexInstalled: async () => { calls++; return false; },
        startTexInstall: () => { calls++; return { status: "downloading" }; },
      };
      if (name === "@/lib/auth/session") return {};
      return require(name);
    },
  });
  for (const requestOrigin of ["https://evil.example", "http://localhost:3001", "null", null]) {
    const request = new NextRequest(`${origin}/api/setup`, {
      method: "POST",
      headers: requestOrigin ? { origin: requestOrigin } : {},
      body: '{"name":"attacker="}',
    });
    const response = await exports.POST!(request);
    assert.equal(response.status, 403, `${route}: ${requestOrigin}`);
    assert.equal(request.bodyUsed, false);
    assert.equal(calls, 0);
  }
  const response = await exports.POST!(new NextRequest(`${origin}/api/setup`, {
    method: "POST", headers: { origin }, body: '{"name":"Ada"}',
  }));
  assert.equal(response.status, route === "./route.ts" ? 200 : 409);
  assert.ok(calls > 0);
}
