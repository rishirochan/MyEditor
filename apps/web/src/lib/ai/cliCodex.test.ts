import assert from "node:assert/strict";
import { extractTextFromSse, parseCodexSseEvent } from "./cliCodex";

const summary = parseCodexSseEvent(
  'data: {"type":"response.reasoning_summary_text.delta","delta":"Checking the target"}'
);
assert.deepEqual(summary, {
  type: "response.reasoning_summary_text.delta",
  delta: "Checking the target",
});

const output = [
  'data: {"type":"response.output_text.delta","delta":"{\\"reply\\":"}',
  "",
  'data: {"type":"response.output_text.delta","delta":"\\"done\\"}"}',
  "",
  "data: [DONE]",
].join("\n");
assert.equal(extractTextFromSse(output), '{"reply":"done"}');
