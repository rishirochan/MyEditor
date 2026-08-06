import assert from "node:assert/strict";
import test from "node:test";
import { stripLatex } from "./linkedin.ts";
import { linkedinResponseSchema } from "./linkedinSchema.ts";

test("stripLatex unwraps formatting macros", () => {
  assert.equal(stripLatex("\\textbf{Senior Engineer}"), "Senior Engineer");
  assert.equal(stripLatex("\\textbf{\\emph{Staff Engineer}}"), "Staff Engineer");
  assert.equal(stripLatex("\\item Led the migration"), "Led the migration");
});

test("stripLatex unescapes special characters", () => {
  assert.equal(stripLatex("Cut costs by 40\\%"), "Cut costs by 40%");
  assert.equal(stripLatex("R\\&D lead"), "R&D lead");
  assert.equal(stripLatex("user\\_service owner"), "user_service owner");
  assert.equal(stripLatex("Acme~Corp"), "Acme Corp");
  assert.equal(stripLatex("Built \\{internal\\} tools"), "Built {internal} tools");
});

test("stripLatex keeps every escaped dollar amount", () => {
  // Naive inline-math handling eats the text between two escaped dollars.
  assert.equal(
    stripLatex("Saved \\$2M in year one and \\$3M in year two"),
    "Saved $2M in year one and $3M in year two"
  );
  // A placeholder that relied on surrounding spaces broke here, because the
  // newline rule trims the space next to it.
  assert.equal(stripLatex("Impact:\\\\\\$5M saved"), "Impact:\n$5M saved");
});

test("stripLatex preserves math operators that carry meaning", () => {
  assert.equal(
    stripLatex("Improved lookup from $O(n)$ to $O(\\log n)$"),
    "Improved lookup from O(n) to O(log n)"
  );
  assert.equal(stripLatex("Sorted in $O(n \\log n)$"), "Sorted in O(n log n)");
  assert.equal(stripLatex("Scaled $10 \\times$ throughput"), "Scaled 10 × throughput");
});

test("stripLatex discards layout macro arguments but keeps content ones", () => {
  assert.equal(stripLatex("Shipped it \\vspace{1em}"), "Shipped it");
  assert.equal(stripLatex("\\rule{\\linewidth}{0.4pt}Team lead"), "Team lead");
  // Custom template macros wrap real prose, so their argument must survive.
  assert.equal(stripLatex("\\resumeItem{Led the rewrite}"), "Led the rewrite");
});

test("stripLatex resolves links, including formatted link text", () => {
  assert.equal(stripLatex("\\href{https://acme.com}{Acme}"), "Acme");
  assert.equal(
    stripLatex("\\href{https://acme.com}{\\textbf{Acme}}"),
    "Acme"
  );
});

test("stripLatex removes list environments without leaking their names", () => {
  assert.equal(
    stripLatex("\\begin{itemize}\\item Led migration\\end{itemize}"),
    "Led migration"
  );
});

test("stripLatex keeps accented names intact", () => {
  assert.equal(stripLatex('M\\"{u}ller'), "Müller");
  assert.equal(stripLatex("Jos\\'{e} Familia"), "José Familia");
  assert.equal(stripLatex("Fran\\c{c}ois"), "François");
});

test("stripLatex resolves dashes", () => {
  assert.equal(stripLatex("2020--2024"), "2020–2024");
  assert.equal(stripLatex("scope---wide"), "scope—wide");
});

test("stripLatex turns LaTeX breaks into newlines and trims noise", () => {
  assert.equal(stripLatex("Line one \\\\ Line two"), "Line one\nLine two");
  assert.equal(
    stripLatex("Acme Corp \\\\[2pt] Senior Engineer"),
    "Acme Corp\nSenior Engineer"
  );
  assert.equal(stripLatex("  padded   text  "), "padded text");
});

test("response schema strips LaTeX out of proposed text", () => {
  const parsed = linkedinResponseSchema.parse({
    reply: "Two changes.",
    updates: [
      {
        section: "headline",
        label: "Headline",
        current: "Software Engineer",
        proposed: "\\textbf{Senior Engineer} at Acme, cut p99 by 40\\%",
      },
    ],
  });

  assert.equal(
    parsed.updates[0].proposed,
    "Senior Engineer at Acme, cut p99 by 40%"
  );
});

test("response schema drops updates that strip down to nothing", () => {
  const parsed = linkedinResponseSchema.parse({
    reply: "Nothing worth changing.",
    updates: [
      { section: "about", label: "About", current: "", proposed: "\\vspace{1em}" },
    ],
  });

  assert.deepEqual(parsed.updates, []);
});

test("response schema defaults a missing current to empty", () => {
  const parsed = linkedinResponseSchema.parse({
    reply: "One new entry.",
    updates: [{ section: "skills", label: "Skills", proposed: "Go, Rust" }],
  });

  assert.equal(parsed.updates[0].current, "");
});
