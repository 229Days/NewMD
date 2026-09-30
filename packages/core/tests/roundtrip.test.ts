/**
 * Round-trip golden corpus (ADR-0001 §2.5: Markdown 往返序列化是最大技术风险).
 *
 * Every file under tests/golden/ is Markdown a person could hand us, and the
 * gate is strict: parse it and write it back, and the bytes must not move.
 * Anything less means saving silently rewrites the user's file.
 *
 * Not every spelling can survive, though — mdast does not record every
 * distinction the syntax allows, so some inputs parse to the same tree and a
 * round trip has to pick one spelling. Those cases are not quietly blessed:
 * they carry a sibling `NAME.expected.md` showing exactly what comes back, so
 * every accepted rewrite is visible in the repo and gated like any other
 * output. A file with no pair promises byte identity.
 */
import { describe, expect, it } from "vitest";
import { parse, parseTransformed, roundTrip } from "../src/editor/markdown";
import { goldenCases, nodeTypes } from "./golden";

describe("the golden corpus survives a round trip", () => {
  const cases = goldenCases();

  it("has something in it", () => {
    expect(cases).not.toEqual([]);
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "round-trips %s exactly as declared",
    (_name, testCase) => {
      expect(roundTrip(testCase.input)).toBe(testCase.expected);
    },
  );

  // Once written out, a document must be stable: a second save may not move
  // bytes again. This is what keeps an accepted normalisation from cascading.
  it.each(cases.map((c) => [c.name, c] as const))(
    "settles %s after one pass",
    (_name, testCase) => {
      expect(roundTrip(testCase.expected)).toBe(testCase.expected);
    },
  );
});

/**
 * Byte identity alone is not enough: a construct the parser does not recognise
 * round-trips as literal text and stays perfectly "preserved" while being
 * completely wrong on screen. Every corpus file therefore also declares the
 * mdast nodes it exists to exercise, and that map doubles as the list of syntax
 * M2 claims to support — adding a file without declaring it is a failure.
 */
const EXERCISES: Record<string, string[]> = {
  "blockquote.md": ["blockquote"],
  "fenced-code.md": ["code"],
  "headings.md": ["heading"],
  "highlight.md": ["mark"],
  "horizontal-rule.md": ["thematicBreak"],
  "images.md": ["image", "imageReference", "definition"],
  "inline-code.md": ["inlineCode"],
  "lists.md": ["list", "listItem"],
  "paragraph.md": ["paragraph"],
  "strikethrough.md": ["delete"],
  "subscript.md": ["sub", "sup"],
  "no-trailing-newline.md": ["paragraph"],
  "table.md": ["table", "tableRow", "tableCell"],
  "trailing-blank-lines.md": ["paragraph"],
};

describe("the corpus exercises the syntax M2 claims to support", () => {
  const cases = goldenCases();

  it("declares every corpus file", () => {
    expect(cases.map((c) => c.name).sort()).toEqual(Object.keys(EXERCISES).sort());
  });

  it.each(cases.map((c) => [c.name, c] as const))("parses %s into real nodes", (name, testCase) => {
    // Both stages, on purpose. A construct the tokenizer understands shows up
    // in the raw tree and is often consumed by a transformer afterwards —
    // `![a][ref]` is an `imageReference` until link resolution rewrites it —
    // while a construct only the transformers understand (`==highlight==`)
    // never appears in the raw tree at all. Either one is the pipeline
    // recognising the file, so the declaration is checked against both.
    const found = new Set([
      ...nodeTypes(parse(testCase.input)),
      ...nodeTypes(parseTransformed(testCase.input)),
    ]);
    for (const required of EXERCISES[name] ?? []) {
      expect([...found]).toContain(required);
    }
  });
});
