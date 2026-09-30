/**
 * The typed path into a WYSIWYG document: `![alt](src)` becomes an image.
 *
 * This is the one insert path a Markdown author actually has — there is no
 * toolbar yet, so typing the syntax is the feature. It lives outside
 * `handle-contract.test.ts` because it is WYSIWYG-only (in source mode the typed
 * text already *is* the Markdown) and because it needs jsdom layout stubs to
 * drive real text input.
 *
 * Every assertion here is structural. `getContent()` cannot tell the two states
 * apart: a paragraph of the literal characters `![a](b.png)` and a paragraph
 * holding an image node both serialize to `![a](b.png)`. Asserting on the bytes
 * would pass before the feature existed.
 */
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { MarkdownEditorHandle } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";

// jsdom has no layout. ProseMirror measures the caret and the text around it to
// decide where the cursor goes, and asks nodes and ranges for client rects that
// this environment does not implement at all. Zero rects are enough: nothing
// here is scrolled or hit-tested.
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

async function mount(doc: string): Promise<{ handle: MarkdownEditorHandle; surface: HTMLElement }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = await createWysiwygEditor({ parent: host, doc, onChange: () => {} });
  cleanups.push(
    () => handle.destroy(),
    () => host.remove(),
  );
  const surface = host.querySelector<HTMLElement>("[contenteditable]");
  if (!surface) throw new Error("no editable surface mounted");
  return { handle, surface };
}

/**
 * Type `text` one character at a time, the way a keyboard would.
 *
 * Each character is a DOM insertion followed by the `input` event a browser
 * fires — that is the path ProseMirror watches to diff the DOM back into
 * transactions, and the only path that runs input rules. Dispatching a
 * transaction with `insertText` would silently skip them.
 */
async function type(surface: HTMLElement, text: string): Promise<void> {
  for (const character of text) {
    const range = document.createRange();
    const block = surface.lastChild ?? surface;
    range.selectNodeContents(block);
    range.collapse(false);
    const node = document.createTextNode(character);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    surface.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: character }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

it("turns typed image syntax into an image node", async () => {
  const { handle, surface } = await mount("");
  await type(surface, "![a](b.png)");

  const img = surface.querySelector("img[src]");
  expect(img?.getAttribute("src")).toBe("b.png");
  expect(img?.getAttribute("alt")).toBe("a");
  // ...and it survives the trip out to Markdown.
  expect(handle.getContent()).toBe("![a](b.png)\n");
});

it("keeps the title of a typed image", async () => {
  const { handle, surface } = await mount("");
  await type(surface, '![a](b.png "The title")');

  const img = surface.querySelector("img[src]");
  expect(img?.getAttribute("src")).toBe("b.png");
  expect(img?.getAttribute("title")).toBe("The title");
  expect(handle.getContent()).toBe('![a](b.png "The title")\n');
});
