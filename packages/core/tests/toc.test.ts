/**
 * The `[TOC]` directive, on the bytes side (ADR-0002 §2.1–§2.3).
 *
 * This one is unusual: the feature is not "render a table of contents", it is
 * "stop corrupting files that contain `[TOC]`". `remark-stringify` escapes a
 * `[` in ordinary prose — `mdast-util-to-markdown` registers
 * `{character: '[', inConstruct: 'phrasing', …}` unconditionally — so today a
 * document holding a standalone `[TOC]` comes back as `\[TOC]` on the next
 * save. The golden corpus never caught it because no corpus file contains one.
 *
 * So the assertions here are about bytes and about which node a spelling
 * became. Nothing in this file reaches for an editor: the merge gate and the
 * engine share this half (`editor/toc.ts`), and this is the gate's view of it.
 *
 * The engine's half — a `toc` schema so the node survives the hop into
 * ProseMirror — is a later slice, which is why the corpus file is not here yet:
 * adding it now would turn `engine-roundtrip` red and leave it red.
 */
import { describe, expect, it } from "vitest";
import { parseTransformed, roundTrip } from "../src/editor/markdown";
import { nodeTypes } from "./golden";

/** Every node type the pipeline produced for `markdown`, both stages merged. */
function types(markdown: string): string[] {
  return [...new Set(nodeTypes(parseTransformed(markdown)))];
}

describe("a standalone [TOC] survives a round trip", () => {
  it("gives the marker back byte for byte", () => {
    expect(roundTrip("[TOC]\n")).toBe("[TOC]\n");
  });

  it("gives it back inside a document that has headings", () => {
    const doc = "# Title\n\n[TOC]\n\n## Section\n";
    expect(roundTrip(doc)).toBe(doc);
  });

  it("keeps the author's own spelling of the marker", () => {
    // Lower case is the same directive, and normalising it to `[TOC]` would be
    // an edit nobody asked for — the same rule the rest of the serializer
    // follows about not rewriting what the reader typed.
    expect(roundTrip("[toc]\n")).toBe("[toc]\n");
  });

  it("leaves two of them alone", () => {
    const doc = "[TOC]\n\n[TOC]\n";
    expect(roundTrip(doc)).toBe(doc);
  });
});

describe("a standalone [TOC] becomes a node of its own", () => {
  it("is a `toc` node, not a paragraph holding text", () => {
    // The golden corpus declares the node types a file exists to exercise, so
    // this is the type the corpus entry has to name. A `paragraph` here would
    // mean the marker was never recognised and the byte fix is a coincidence.
    expect(types("[TOC]\n")).toContain("toc");
  });

  it("carries the marker it was written with", () => {
    const tree = parseTransformed("[toc]\n");
    const toc = tree.children[0] as unknown as { type: string; value?: string };
    expect(toc.type).toBe("toc");
    expect(toc.value).toBe("[toc]");
  });
});

describe("spellings that are not the directive", () => {
  it("does not claim one that shares its line with other text", () => {
    expect(types("[TOC] trailing\n\n")).not.toContain("toc");
  });

  it("does not claim one inside a list item or a block quote", () => {
    // Both are ordinary paragraphs to mdast, so "a paragraph whose whole text
    // is the marker" alone would swallow them. The directive is a block of the
    // document, not a block of a block.
    expect(types("- [TOC]\n")).not.toContain("toc");
    expect(types("> [TOC]\n")).not.toContain("toc");
  });

  it("does not claim one wearing a mark", () => {
    expect(types("**[TOC]**\n")).not.toContain("toc");
    expect(types("==[TOC]==\n")).not.toContain("toc");
  });

  it("does not claim one inside a code span", () => {
    // The escape hatch: this is how a document writes about the directive
    // without invoking it (ADR-0002 §3).
    expect(types("Use `[TOC]` to add a table of contents.\n")).not.toContain("toc");
  });

  it("does not claim one that is a code span and nothing else", () => {
    // The hardest version of the line above, and the one that matters: a
    // paragraph whose *plain text* is the marker but whose content is a code
    // span. Reading the text back out of the tree rather than checking the
    // node itself would claim this and turn someone's example into a real
    // table of contents.
    expect(types("`[TOC]`\n")).not.toContain("toc");
  });

  it("is a link when the author defined [TOC] as one", () => {
    // `[TOC]: url` makes every `[TOC]` a link reference, and link resolution
    // runs before this directive does — so an author who defines the label
    // keeps their link. Ordering is the whole mechanism here.
    const doc = "[TOC]: https://example.com\n\n[TOC]\n";
    expect(types(doc)).not.toContain("toc");
    expect(roundTrip(doc)).toContain("(https://example.com)");
  });
});
