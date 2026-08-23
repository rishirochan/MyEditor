import assert from "node:assert/strict";
import { extractClaudeStreamResult } from "./cliClaude";

assert.equal(
  extractClaudeStreamResult(
    [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: '{"reply":"done"}' }),
    ].join("\n")
  ),
  '{"reply":"done"}'
);

assert.throws(() => extractClaudeStreamResult('{"type":"system"}'));
