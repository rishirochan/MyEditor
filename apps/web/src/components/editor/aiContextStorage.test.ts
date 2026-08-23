import assert from "node:assert/strict";
import { parseStoredContextIds } from "./aiContextStorage";

const availableIds = new Set(["swe", "ai"]);

assert.deepEqual(parseStoredContextIds('["swe","ai"]', availableIds), [
  "swe",
  "ai",
]);
assert.deepEqual(parseStoredContextIds('["swe","deleted"]', availableIds), [
  "swe",
]);
assert.equal(parseStoredContextIds('["swe","ai","extra"]', availableIds), null);
assert.equal(parseStoredContextIds("not json", availableIds), null);
