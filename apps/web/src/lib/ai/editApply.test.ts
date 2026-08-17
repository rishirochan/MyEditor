import assert from "node:assert/strict";
import { applyTextEdit } from "./editApply";

const applied = applyTextEdit("first\nRishi Potipireddi\nlast", {
  filePath: "ResumeAI.tex",
  oldText: "Rishi Potipireddi",
  newText: "Rishi",
});

assert.equal(applied.applied, true);
if (applied.applied) {
  assert.equal(applied.content, "first\nRishi\nlast");
  assert.deepEqual(applied.edit, {
    filePath: "ResumeAI.tex",
    originalText: "Rishi Potipireddi",
    replacementText: "Rishi",
    startIndex: 6,
    resultingLine: 2,
  });
}

assert.equal(
  applyTextEdit("Rishi\nRishi", {
    filePath: "ResumeAI.tex",
    oldText: "Rishi",
    newText: "R",
  }).applied,
  false
);

assert.equal(
  applyTextEdit("Rishi", {
    filePath: "ResumeAI.tex",
    oldText: "Potipireddi",
    newText: "",
  }).applied,
  false
);

const undo = applyTextEdit("first\nRishi\nRishi", {
  filePath: "ResumeAI.tex",
  oldText: "Rishi",
  newText: "Rishi Potipireddi",
  startIndex: 6,
});
assert.equal(undo.applied, true);
if (undo.applied) {
  assert.equal(undo.content, "first\nRishi Potipireddi\nRishi");
}

assert.equal(
  applyTextEdit("changed\nRishi", {
    filePath: "ResumeAI.tex",
    oldText: "Rishi",
    newText: "Rishi Potipireddi",
    startIndex: 6,
  }).applied,
  false
);
