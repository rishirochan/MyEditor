import assert from "node:assert/strict";
import {
  emitClaudeStreamProgress,
  extractClaudeStreamResult,
} from "./cliClaude";

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

const progress: Array<{ type: string; name?: string; text?: string }> = [];
emitClaudeStreamProgress(
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "Checking the intro" },
        { type: "tool_use", name: "Read" },
      ],
    },
  }),
  (event) => progress.push(event)
);
assert.deepEqual(progress, [
  { type: "reasoning_summary", text: "Checking the intro" },
  { type: "tool_call", name: "Read" },
]);

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
