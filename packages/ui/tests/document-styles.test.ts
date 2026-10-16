/**
 * Where the document styles live (ADR-0005 §2.5).
 *
 * The front matter, mermaid and `[TOC]` blocks used to be dressed here, and the
 * reader's body type was written nowhere at all. Both moved into
 * `packages/core/src/document.css`, which HTML export has to inline: core is
 * the one package the editor and the export both depend on, and `packages/export`
 * depending on this React package would be an edge pointing the wrong way up
 * the graph.
 *
 * What that buys is one owner per rule, and one owner is exactly what a test
 * can hold on to. Removing the import leaves the editor unstyled and nothing
 * red; leaving a copy behind lets the two drift, and the copy here would be the
 * one the editor sees.
 */
// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const MOVED = [
  "[data-newmd-frontmatter]",
  "[data-newmd-mermaid]",
  "[data-newmd-toc-list]",
  "[data-newmd-toc-entry]",
];

describe("@newmd/ui's stylesheet", () => {
  it("imports the document stylesheet core owns", async () => {
    // By path from the package root rather than from `import.meta.url`: under
    // jsdom the test module's own URL is the dev server's, not a file:// one.
    const css = await readFile("src/styles.css", "utf8");

    expect(css).toMatch(/@import\s+"\.\.\/\.\.\/core\/src\/document\.css"/);
  });

  it("no longer declares the blocks that moved to core", async () => {
    const css = await readFile("src/styles.css", "utf8");

    const duplicated = MOVED.filter((selector) => css.includes(selector));
    expect(duplicated).toEqual([]);
  });
});
