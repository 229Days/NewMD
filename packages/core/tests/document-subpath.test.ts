/**
 * `@newmd/core/document` — the subpath the export reaches the document side by
 * (ADR-0005 §2.4).
 *
 * `@newmd/core/editor` is deliberately narrow: one factory and one contract, so
 * that UI code cannot grow an opinion about which engine is running. The export
 * needs the opposite end of the same package — the remark chain, the three
 * renderers, the stylesheet — and none of it is engine-shaped. Widening
 * `./editor` would have undone the reason it is narrow, so this is a second
 * door with a rule attached to it: **it opens onto the document, never onto the
 * engine.**
 *
 * That rule is what this file is for. A subpath is a promise about every module
 * it can reach, and the way it breaks is one convenient re-export at a time —
 * `parseTransformed` is here, so why not the schema that goes with it? By then
 * the export imports Milkdown, and nothing on screen says so. So the graph is
 * walked rather than the export list read.
 */
// @vitest-environment node
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What must not be reachable from the subpath, in the shape of an import
 * specifier.
 *
 * The engines themselves rather than a list of this repo's files: the boundary
 * ADR-0001 §2.3 draws is about who may call Milkdown, and a module that reaches
 * it through a new file of its own is the same violation one step further out.
 */
const ENGINE = /^@milkdown\/|^@codemirror\/|^prosemirror-/;

const ENTRY = "src/document/index.ts";

/** Where a relative specifier can land. Order is Vite's: exact, then typed, then a barrel. */
const SUFFIXES = ["", ".ts", ".tsx", ".css", "/index.ts", "/index.tsx"];

/** Every specifier in `source`, static or dynamic, without its query string. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    if (specifier !== undefined) found.push(specifier.replace(/\?.*$/, ""));
  }
  return found;
}

/** Read the file a relative specifier points at, or `null` when nothing is there. */
async function resolve(from: string, specifier: string): Promise<string | null> {
  const base = posix.join(posix.dirname(from), specifier);
  for (const suffix of SUFFIXES) {
    const candidate = `${base}${suffix}`;
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Not this one. A specifier that resolves to nothing at all is an error
      // rather than a skip — a resolver that quietly drops what it cannot find
      // is a test that passes because it stopped looking.
    }
  }
  return null;
}

interface Graph {
  /** Every repo file reached, in the order it was first seen. */
  files: string[];
  /** Every specifier seen anywhere in the graph, bare ones included. */
  specifiers: string[];
}

/** Everything `entry` can reach through relative imports. */
async function graphFrom(entry: string): Promise<Graph> {
  const files: string[] = [];
  const specifiers: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    files.push(file);

    const source = await readFile(file, "utf8");
    for (const specifier of specifiersOf(source)) {
      specifiers.push(specifier);
      if (!specifier.startsWith(".")) continue;
      const target = await resolve(file, specifier);
      if (target === null) {
        throw new Error(`${file} imports "${specifier}", which is not a file in this package`);
      }
      if (!seen.has(target)) queue.push(target);
    }
  }

  return { files, specifiers };
}

describe("@newmd/core/document", () => {
  it("reaches no editing engine", async () => {
    const { specifiers } = await graphFrom(ENTRY);

    const engine = specifiers.filter((specifier) => ENGINE.test(specifier));
    expect(engine).toEqual([]);
  });

  it("reaches the document side, and is still looking", async () => {
    const { files } = await graphFrom(ENTRY);

    // The other half of the assertion above: a graph that resolved almost
    // nothing would satisfy it while saying nothing about the subpath. These are
    // the modules the promise is actually made of.
    for (const expected of [
      ENTRY,
      "src/document/stylesheet.ts",
      "src/editor/markdown.ts",
      "src/editor/inline-marks.ts",
      "src/editor/toc.ts",
      "src/editor/highlight.ts",
      "src/editor/highlight.css",
      "src/document.css",
      "src/theme.css",
    ]) {
      expect(files).toContain(expected);
    }
    // And not this one, which is the file an engine call would arrive through.
    expect(files).not.toContain("src/editor/wysiwyg.ts");
  });

  it("hands out the parser the editor parses with, not a second one", async () => {
    const subpath = await import("../src/document/index");
    const markdown = await import("../src/editor/markdown");

    // Identity, not equality of behaviour: a copy that agreed today would be a
    // copy that disagreed the first time either side learned a new construct,
    // and the merge gate is not a place to find that out.
    expect(subpath.parseTransformed).toBe(markdown.parseTransformed);
  });

  it("hands out the stylesheets the editor's document is dressed by", async () => {
    const { documentCss, themeCss, highlightCss } = await import("../src/document/index");

    expect(documentCss).toContain("[data-newmd-document]");
    expect(documentCss).toContain("box-sizing: border-box");
    expect(themeCss).toContain("--fg:");
    expect(themeCss).toContain('[data-theme="dark"]');
    expect(highlightCss).toContain("--shiki-dark");
  });

  it("hands out the node types the two pipelines agreed on", async () => {
    const { INLINE_MARKS } = await import("../src/document/index");

    // The export has to recognise `==mark==`, `~sub~` and `^sup^` because no
    // other package declares them — mdast has no such node types. Reading the
    // table rather than a list spelled out again is what keeps the export from
    // missing the next mark added to it.
    expect(INLINE_MARKS.map((syntax) => syntax.type)).toEqual(["mark", "sub", "sup"]);
  });
});
