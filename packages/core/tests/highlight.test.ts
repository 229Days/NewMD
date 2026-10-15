/**
 * Shiki highlighting for fenced code (ADR-0001 §2.6 行 117, §2.11 行 189).
 *
 * The round-trip gate is blind to this one: a block that never gets a colour
 * still hands its bytes back word for word, so `engine-roundtrip.test.ts` is
 * happy either way. What only the surface can be asked is whether the fence
 * the reader typed comes out tokenised — and whether the two halves of the
 * theme ride along, which is what makes a theme switch free.
 *
 * Real Shiki runs here, unmocked. The library is not what is in doubt; the
 * mapping from its token offsets onto document positions is.
 */
// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownEditorHandle } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";

// jsdom has no layout, and ProseMirror measures the caret and its neighbours to
// work out where one is — the same stubs `wysiwyg-input.test.ts` drives real
// typing with. Zero rects are enough; nothing here is scrolled or hit-tested.
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

const hosts: HTMLElement[] = [];
const handles: MarkdownEditorHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

/** Mount the engine on `markdown` and hand back both the host and the handle. */
async function mount(
  markdown: string,
): Promise<{ host: HTMLElement; handle: MarkdownEditorHandle }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const handle = await createWysiwygEditor({ parent: host, doc: markdown, onChange: () => {} });
  handles.push(handle);
  return { host, handle };
}

/** The coloured pieces of a fenced block — one per token Shiki handed back. */
function tokens(host: HTMLElement, language?: string): HTMLElement[] {
  const scope = language ? `pre[data-language="${language}"]` : "pre";
  return Array.from(host.querySelectorAll(`${scope} code span`)).filter(
    (span): span is HTMLElement => span instanceof HTMLElement,
  );
}

/** The text those tokens account for, in document order. */
function coloured(host: HTMLElement): string {
  return tokens(host)
    .map((span) => span.textContent ?? "")
    .join("");
}

/**
 * Type `text` at the end of the fence's own text, the way a keyboard would.
 *
 * The caret goes inside the `<code>` element — that is where a code block's
 * text actually lives — and the `input` event afterwards is the path
 * ProseMirror watches to diff the DOM back into a transaction. Dispatching a
 * transaction by hand would skip exactly the thing under test: what the engine
 * makes of a document the browser changed underneath it.
 */
async function typeIntoFence(code: HTMLElement, text: string): Promise<void> {
  const range = document.createRange();
  range.selectNodeContents(code);
  range.collapse(false);
  const inserted = document.createTextNode(text);
  range.insertNode(inserted);
  range.setStartAfter(inserted);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  code.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
  );
  // ProseMirror does not listen for `input`; it watches the DOM with a
  // MutationObserver and reads the change back in a microtask. Nothing has
  // reached the document until that has run.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The fence's editable text element. */
function fenceCode(host: HTMLElement, language: string): HTMLElement {
  const code = host.querySelector(`pre[data-language="${language}"] code`);
  if (!(code instanceof HTMLElement)) throw new Error(`no ${language} fence is mounted`);
  return code;
}

const DOC = [
  "# Code",
  "",
  "```ts",
  "const answer: number = 42;",
  "console.log(answer);",
  "```",
  "",
].join("\n");

/**
 * Two fences, one of which Shiki has no grammar for.
 *
 * `output` is the everyday version of this: a README showing what a command
 * printed, which is text rather than a language. Shiki does not carry it and
 * says so by throwing.
 */
const MIXED = [
  "# Build",
  "",
  "```output",
  "npm run build",
  "ready",
  "```",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
].join("\n");

describe("a fenced code block in the WYSIWYG surface", () => {
  it("colours the text by the language on the fence", async () => {
    const { host } = await mount(DOC);

    await vi.waitFor(() => expect(tokens(host).length).toBeGreaterThan(0));

    // The keyword is its own token, so it has to be its own piece of the block
    // rather than the whole thing tinted at once.
    const keyword = tokens(host).find((span) => span.textContent === "const");
    expect(keyword).toBeDefined();
    expect(keyword?.style.getPropertyValue("color")).not.toBe("");
  });

  it("carries both halves of the theme, so a switch re-highlights nothing", async () => {
    const { host } = await mount(DOC);

    await vi.waitFor(() => expect(tokens(host).length).toBeGreaterThan(0));

    // Light in `color`, dark in `--shiki-dark`: the app's theme is a `[data-theme]`
    // flip on the root, and one CSS rule reading this custom property is what
    // turns that into a dark code block. Re-tokenising on every switch would be
    // the alternative, and it would be async work in the middle of a repaint.
    const keyword = tokens(host).find((span) => span.textContent === "const");
    expect(keyword?.style.getPropertyValue("--shiki-dark")).not.toBe("");
    expect(keyword?.style.getPropertyValue("--shiki-dark")).not.toBe(
      keyword?.style.getPropertyValue("color"),
    );
  });

  it("leaves the source it read alone", async () => {
    const { handle } = await mount(DOC);

    // Colouring is a way of drawing the block, not a rewrite of it: the fence
    // has to come back exactly as it went in, meta string and all.
    expect(handle.getContent()).toBe(DOC);
  });

  it("recolours a block the reader has just typed into", async () => {
    const { host, handle } = await mount(DOC);

    await vi.waitFor(() => expect(tokens(host).length).toBeGreaterThan(0));
    await typeIntoFence(fenceCode(host, "ts"), "\nconst extra = 1;");

    expect(handle.getContent()).toContain("const extra = 1;");
    // The characters just typed are the ones no decoration can be covering yet
    // — the old tokens were read from a block that did not have them. So this
    // only becomes true if the second pass actually ran: a stale paint would
    // leave the new text uncoloured, and a document the reader cannot type into
    // would leave it missing from the source altogether.
    await vi.waitFor(() => expect(coloured(host)).toContain("extra"));
    expect(handle.getContent()).toBe(DOC.replace("```\n", "const extra = 1;\n```\n"));
  });

  it("leaves a fence in a language it cannot read as plain text", async () => {
    const { host, handle } = await mount(MIXED);

    // The readable fence is the clock. Nothing is painted until every fence in
    // the document has an answer, so once this one is coloured the other one's
    // attempt is over too — and Shiki answers an unreadable language by
    // throwing, which is what would take the editor down with it.
    await vi.waitFor(() => expect(tokens(host, "ts").length).toBeGreaterThan(0));

    expect(tokens(host, "output")).toHaveLength(0);
    expect(fenceCode(host, "output").textContent).toBe("npm run build\nready");
    expect(handle.getContent()).toBe(MIXED);
  });

  it("ships the rule that reads the dark half it wrote", async () => {
    // jsdom resolves no custom properties and applies no `var()`, so the half of
    // this mechanism that only exists after a cascade cannot be asked
    // behaviourally here. What can be checked is that it ships: `--shiki-dark`
    // on a span is inert by itself, no other stylesheet in the project names it,
    // and a missing rule is a dark document lit by a light theme with nothing
    // on screen to say so.
    // By path from the package root rather than from `import.meta.url`: under
    // jsdom the test module's own URL is the dev server's, not a file:// one.
    const css = await readFile("src/editor/highlight.css", "utf8");

    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("var(--shiki-dark)");
    expect(css).toContain("[data-newmd-token]");
  });
});
