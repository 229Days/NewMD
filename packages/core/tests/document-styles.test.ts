/**
 * The document stylesheet (ADR-0005 §2.5, §2.15 ①).
 *
 * The WYSIWYG body has never had typography. `--editor-font-size` and the other
 * three look variables reached CodeMirror alone, and the front matter, mermaid
 * and `[TOC]` blocks carried their only styles in `packages/ui`. This slice
 * writes the body rules and moves those three into core, so the editor and the
 * HTML export can be handed one file.
 *
 * Only half of that is askable here. jsdom resolves no custom property and
 * applies no cascade, so no rule can be shown to win. What can be shown is that
 * the element the rules are scoped to is the editable the engine itself builds
 * and that it contains every block the rules name — which is the failure that
 * would be silent in a browser: a scope that misses the content leaves a
 * document unstyled, with nothing on screen to say why.
 */
// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownEditorHandle } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";

// Only the block's *place* in the document is under test here — a diagram that
// never draws still leaves its host where the stylesheet has to reach it.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-diagram="yes"></svg>', diagramType: "mermaid" })),
  },
}));

// jsdom has no layout, and ProseMirror measures the caret to decide where it
// goes — the same stubs `toc-block.test.ts` types through.
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
const noRects = () => [] as unknown as DOMRectList;
for (const proto of [
  window.Text.prototype,
  window.Element.prototype,
  window.Range.prototype,
] as unknown as Record<string, unknown>[]) {
  proto.getClientRects = noRects;
  proto.getBoundingClientRect = zeroRect;
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * One of every block and inline the stylesheet has a rule for.
 *
 * Written as lines rather than as a template literal so the fence and the
 * inline span can spell their backticks without escaping.
 */
const SAMPLE = [
  "# One",
  "",
  "## Two",
  "",
  "### Three",
  "",
  "#### Four",
  "",
  "##### Five",
  "",
  "###### Six",
  "",
  "A paragraph with `code`, a [link](https://example.com) and an ![map](./assets/map.png).",
  "",
  "- first",
  "- second",
  "",
  "1. one",
  "2. two",
  "",
  "> quoted",
  "",
  "| left | right |",
  "| ---- | ----- |",
  "| a    | b     |",
  "",
  "---",
  "",
  "```js",
  "const one = 1;",
  "```",
  "",
].join("\n");

/**
 * What the sample is expected to render as, inside the scope.
 *
 * `document.css` writes `[data-newmd-document] <name>` for each of these, and
 * the scoped rule only ever fires on DOM that looks like this — so the two
 * halves of this test are one statement about the pair.
 */
const DRESSED = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "table",
  "hr",
  "pre",
  "code",
  "a",
  "img",
];

/** The blocks whose styles moved out of `packages/ui` in this slice. */
const MOVED = [
  "[data-newmd-frontmatter]",
  "[data-newmd-mermaid]",
  "[data-newmd-toc-list]",
  "[data-newmd-toc-entry]",
];

/** One of each of the three, since the move is what put them behind a scope. */
const MOVED_SAMPLE = [
  "---",
  "title: Sample",
  "---",
  "",
  "[TOC]",
  "",
  "# One",
  "",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "```",
  "",
].join("\n");

async function mount(doc: string): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle: MarkdownEditorHandle = await createWysiwygEditor({
    parent: host,
    doc,
    onChange: () => {},
  });
  cleanups.push(
    () => handle.destroy(),
    () => host.remove(),
  );
  return host;
}

describe("the element the document stylesheet is scoped to", () => {
  it("is the editable the engine builds, not a wrapper around it", async () => {
    const host = await mount("# One\n");
    const surface = host.querySelector<HTMLElement>("[data-newmd-document]");

    expect(surface).not.toBeNull();
    // The editable itself: a rule scoped to a `div` that merely *contains* the
    // editable would style nothing at all.
    expect(surface?.getAttribute("contenteditable")).toBe("true");
    expect(surface?.querySelector("h1")?.textContent).toBe("One");
  });

  it("holds every block the rules name", async () => {
    const host = await mount(SAMPLE);
    const surface = host.querySelector<HTMLElement>("[data-newmd-document]");
    expect(surface).not.toBeNull();

    const missing = DRESSED.filter((selector) => surface?.querySelector(selector) == null);
    expect(missing).toEqual([]);
  });

  it("holds the blocks that arrived from @newmd/ui", async () => {
    // These three are the reason the scope exists at all. They used to be
    // dressed by unscoped rules in the app's stylesheet; a scope that stopped
    // short of them would leave the app's own look for them with nothing to
    // say the rules had been left behind.
    const host = await mount(MOVED_SAMPLE);
    const surface = host.querySelector<HTMLElement>("[data-newmd-document]");
    expect(surface).not.toBeNull();

    const missing = MOVED.filter((selector) => surface?.querySelector(selector) == null);
    expect(missing).toEqual([]);
  });
});

describe("the rules the document stylesheet ships", () => {
  it("dresses every block the engine can put in a document", async () => {
    // By path from the package root rather than from `import.meta.url`: under
    // jsdom the test module's own URL is the dev server's, not a file:// one.
    const css = await readFile("src/document.css", "utf8");

    const missing = DRESSED.filter((name) => !css.includes(`[data-newmd-document] ${name}`));
    expect(missing).toEqual([]);
  });

  it("reads the four look variables the source surface already reads", async () => {
    // A body that ignores the reader's font size is a settings panel that
    // applies to one of the two modes.
    const css = await readFile("src/document.css", "utf8");

    for (const variable of [
      "--editor-font-size",
      "--editor-line-height",
      "--font-editor",
      "--editor-max-width",
    ]) {
      expect(css).toContain(`var(${variable})`);
    }
  });

  it("keeps the blocks that moved out of @newmd/ui", async () => {
    const css = await readFile("src/document.css", "utf8");

    const missing = MOVED.filter((selector) => !css.includes(selector));
    expect(missing).toEqual([]);
  });

  it("carries the reset it depends on", async () => {
    // This file is inlined into the exported HTML on its own — no Tailwind, no
    // preflight under it — so anything it relies on has to be in it. `border-box`
    // is the one that matters: every padded box below is sized by it.
    const css = await readFile("src/document.css", "utf8");

    expect(css).toContain("[data-newmd-document] *");
    expect(css).toContain("box-sizing: border-box");
  });
});
