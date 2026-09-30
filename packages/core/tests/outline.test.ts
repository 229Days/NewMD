/**
 * The outline (ADR-0001 §4 M4: 大纲侧栏).
 *
 * The outline is a table of contents for the reader to click, so two things
 * have to be true at once: it must list what Markdown actually calls a heading,
 * and clicking one must land on *that* heading rather than on the first heading
 * that looks like it.
 *
 * The second requirement is why the anchor is (level, text, occurrence) and not
 * a line number. A line number is meaningful to the Markdown text and to
 * nothing else: the WYSIWYG surface has no Markdown text at all — it holds
 * ProseMirror nodes with no lines — so an anchor expressed in lines could only
 * ever be resolved by the source engine, and the acceptance criterion for this
 * milestone (「大纲点击可跳转」) would quietly stop holding the moment the reader
 * was in WYSIWYG, which is the mode the app opens in.
 *
 * The three places that read headings — this module, the source engine, and the
 * WYSIWYG schema — all reach for the same parse, so they cannot disagree about
 * what a heading is. `outlineOf` counts occurrences among headings *matching
 * the target*, not among all headings, which keeps the count stable even if
 * some other construct moves around.
 */
import { describe, expect, it } from "vitest";
import { outlineOf } from "../src/outline";

const shapes: Array<[string, string, Array<[number, string, number]>]> = [
  [
    "depth and order",
    "# One\n\n## Two\n\n### Three\n",
    [
      [1, "One", 0],
      [2, "Two", 0],
      [3, "Three", 0],
    ],
  ],
  [
    "markers stripped from the text",
    "## With closing hashes ##\n\n## With *emphasis* in it\n",
    [
      [2, "With closing hashes", 0],
      [2, "With emphasis in it", 0],
    ],
  ],
  [
    "setext headings count too",
    "Title\n=====\n\nSub\n---\n",
    [
      [1, "Title", 0],
      [2, "Sub", 0],
    ],
  ],
  [
    "a fenced code block is not an outline",
    "# Real\n\n```sh\n# not a heading\n# also not\n```\n\n## Also real\n",
    [
      [1, "Real", 0],
      [2, "Also real", 0],
    ],
  ],
  [
    "an indented code block is not an outline",
    "# Real\n\n    # four spaces is code\n",
    [[1, "Real", 0]],
  ],
  ["a hash with no space is not a heading", "#hashtag and ######six\n", []],
  [
    "repeated headings get their own anchor",
    "## Same\n\n# Other\n\n## Same\n",
    [
      [2, "Same", 0],
      [1, "Other", 0],
      [2, "Same", 1],
    ],
  ],
];

describe("the outline", () => {
  for (const [name, markdown, expected] of shapes) {
    it(`reads ${name}`, () => {
      expect(outlineOf(markdown)).toEqual(
        expected.map(([level, text, occurrence]) => ({ level, text, occurrence })),
      );
    });
  }

  it("has nothing to show for a document without headings", () => {
    expect(outlineOf("just some prose\n")).toEqual([]);
  });

  it("treats an empty document as having no outline", () => {
    expect(outlineOf("")).toEqual([]);
  });

  it("does not invent an anchor for a heading that is not there", () => {
    // The same heading text at a different depth is a different heading to a
    // reader clicking the outline, so the two must not share an occurrence.
    const outline = outlineOf("## Same\n\n### Same\n");
    expect(outline).toEqual([
      { level: 2, text: "Same", occurrence: 0 },
      { level: 3, text: "Same", occurrence: 0 },
    ]);
  });
});
