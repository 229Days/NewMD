/**
 * The `[TOC]` block in the WYSIWYG surface (ADR-0002 §2.4–§2.7).
 *
 * Two surfaces are reachable here that the gate cannot see. The first is the
 * reader's: typing `[TOC]` is the only way to get a table of contents, and the
 * Markdown round trip would be perfectly happy with a paragraph of five
 * characters that never became one. The second is the opposite direction —
 * deleting a character from the marker has to put the block back, or the
 * document holds a `toc` node that says something the reader no longer sees.
 *
 * The transform runs on every document change rather than on a key press, which
 * is why these tests type and delete through the DOM instead of dispatching
 * transactions: the path a keystroke takes is the thing under test.
 */
// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { MarkdownEditorHandle } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";

// jsdom has no layout, and ProseMirror measures the caret to decide where it
// goes — the same stubs `wysiwyg-input.test.ts` drives real typing with.
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

async function mount(
  doc: string,
  onCursorChange?: (line: number, column: number) => void,
): Promise<{ handle: MarkdownEditorHandle; surface: HTMLElement }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = await createWysiwygEditor({
    parent: host,
    doc,
    onChange: () => {},
    onCursorChange,
  });
  cleanups.push(
    () => handle.destroy(),
    () => host.remove(),
  );
  const surface = host.querySelector<HTMLElement>("[contenteditable]");
  if (!surface) throw new Error("no editable surface mounted");
  return { handle, surface };
}

/** The block, if the document is currently holding one. */
function block(surface: HTMLElement): HTMLElement | null {
  return surface.querySelector<HTMLElement>("[data-newmd-toc]");
}

/** The source half of the block — the five characters, and the contentDOM. */
function source(surface: HTMLElement): HTMLElement | null {
  return surface.querySelector<HTMLElement>("[data-newmd-toc-source]");
}

/** The entry buttons the block is currently showing, in order. */
function entries(surface: HTMLElement): HTMLElement[] {
  return [...surface.querySelectorAll<HTMLElement>("[data-newmd-toc-entry]")];
}

/** Let ProseMirror's DOM observer run — it reads changes in a microtask. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Type `text` one character at a time, the way a keyboard would.
 *
 * The trailing characters matter as much as the whole: a rule that waits for a
 * closing keystroke would leave `[TOC` as a paragraph, and this is the only
 * place that difference shows.
 *
 * `into` names the block to type at the end of, defaulting to the last one in
 * the document. A test that has to reach a specific block — the heading above a
 * table of contents — says so rather than arranging the document around it.
 */
async function type(surface: HTMLElement, text: string, into?: HTMLElement): Promise<void> {
  for (const character of text) {
    const range = document.createRange();
    const last = into ?? surface.lastElementChild ?? surface;
    range.selectNodeContents(last);
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
    await settle();
  }
}

/**
 * Click an entry the way a pointer does: the press, then the click.
 *
 * Both are dispatched because the block listens for both — the press is what
 * the browser would otherwise move the selection on, and the click is what it
 * acts on. Returns whether the press was cancelled.
 */
function clickEntry(entry: HTMLElement): boolean {
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  entry.dispatchEvent(press);
  entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return press.defaultPrevented;
}

/**
 * Put the caret inside `element`, the way clicking or arrowing into it would.
 *
 * The DOM selection and its event, in that order, because that is what a
 * browser does and what ProseMirror listens for — it reads the selection off
 * the document rather than off a transaction. The editor has to be focused
 * first: a selection in an unfocused editor is not one ProseMirror will adopt,
 * which is exactly how a reader gets a selection that does not move the caret.
 */
async function caretIn(surface: HTMLElement, element: HTMLElement): Promise<void> {
  surface.focus();
  const range = document.createRange();
  const text = element.firstChild ?? element;
  range.selectNodeContents(text);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await settle();
}

/**
 * Delete the last character of `element`, the way Backspace would.
 *
 * The DOM edit comes first and the event second, which is the order a browser
 * uses — ProseMirror reads the change back out of the DOM rather than off the
 * event.
 */
async function backspace(element: HTMLElement): Promise<void> {
  const text = element.lastChild;
  if (text === null || text.nodeType !== Node.TEXT_NODE) throw new Error("nothing to delete");
  text.textContent = (text.textContent ?? "").slice(0, -1);
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }),
  );
  await settle();
}

describe("typing the directive", () => {
  it("becomes a table-of-contents block without leaving the editor", async () => {
    const { handle, surface } = await mount("");

    await type(surface, "[TOC]");

    // The block itself, not the five characters: a paragraph holding `[TOC]`
    // would satisfy `getContent()` and be the whole bug this slice exists for.
    expect(block(surface)).not.toBeNull();
    expect(handle.getContent()).toBe("[TOC]\n");
  });

  it("keeps the spelling it was typed with", async () => {
    const { handle, surface } = await mount("");

    await type(surface, "[toc]");

    expect(block(surface)).not.toBeNull();
    // Normalising to `[TOC]` here would be an edit nobody asked for, and the
    // file is the place it would show up.
    expect(handle.getContent()).toBe("[toc]\n");
  });

  it("needs to be the whole paragraph", async () => {
    const { surface } = await mount("");

    await type(surface, "see [TOC] here");

    expect(block(surface)).toBeNull();
  });

  it("needs to be plain, not wearing a mark", async () => {
    const { surface } = await mount("");

    await type(surface, "**[TOC]**");

    // The engine's copy of the rule, and it is a copy — this one reads
    // ProseMirror nodes rather than mdast, so the marks it has to refuse are
    // marks the reader typed, not ones already in the tree. A rule that read
    // `textContent` would claim this and drop the bold on the way in.
    expect(block(surface)).toBeNull();
    expect(surface.querySelector("strong")?.textContent).toBe("[TOC]");
  });
});

describe("editing the marker back out", () => {
  it("turns the block back into a paragraph", async () => {
    const { surface } = await mount("[TOC]\n");

    const toc = block(surface);
    if (toc === null) throw new Error("the document did not open as a table of contents");
    // Backspace deletes from the text the caret is in, and once the block has a
    // rendered half that is the source div rather than the block's own root.
    const marker = source(surface);
    if (marker === null) throw new Error("the block has no editable half");
    await backspace(marker);

    // The invariant this pair of rules exists to hold: a `toc` node always
    // holds exactly the marker, so what the block claims and what it shows can
    // never come apart.
    expect(block(surface)).toBeNull();
    expect(surface.textContent).toBe("[TOC");
  });
});

describe("where the directive is not", () => {
  it("does not claim one inside a list item", async () => {
    const { surface } = await mount("- [TOC]\n");

    // A paragraph to mdast, so the engine's own predicate is the only thing
    // standing between this and a table of contents inside a bullet.
    expect(block(surface)).toBeNull();
  });

  it("does not claim one inside a block quote", async () => {
    const { surface } = await mount("> [TOC]\n");

    expect(block(surface)).toBeNull();
  });
});

/**
 * The rendered half (ADR-0002 §2.5–§2.7).
 *
 * The block shows a table of contents and keeps the five characters beside it,
 * because the entries are what a reader reads and the marker is what a reader
 * edits. Nothing here is in the file: the entries are computed from the
 * document every time the headings change, so they cannot go stale in a save.
 */
describe("the table of contents the block shows", () => {
  it("lists every heading, in document order", async () => {
    const { surface } = await mount("# One\n\n[TOC]\n\n## Two\n\n### Three\n");

    expect(entries(surface).map((entry) => entry.textContent)).toEqual(["One", "Two", "Three"]);
    expect(entries(surface).map((entry) => entry.getAttribute("data-level"))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("counts repeated headings so a jump can tell them apart", async () => {
    const { surface } = await mount("# Same\n\n[TOC]\n\n# Same\n");

    // The same arithmetic `outlineOf` does, and it has to stay the same
    // arithmetic: an entry numbered differently from the outline's would send
    // the reader to the other heading of that name.
    expect(entries(surface).map((entry) => entry.getAttribute("data-text"))).toEqual([
      "Same",
      "Same",
    ]);
    expect(entries(surface).map((entry) => entry.getAttribute("data-occurrence"))).toEqual([
      "0",
      "1",
    ]);
  });

  it("keeps the marker beside the list, where the caret can reach it", async () => {
    const { surface } = await mount("# One\n\n[TOC]\n");

    expect(source(surface)?.textContent).toBe("[TOC]");
  });

  it("redraws when a heading changes", async () => {
    const { handle, surface } = await mount("# Alpha\n\n[TOC]\n\n## Beta\n");
    expect(entries(surface).map((entry) => entry.textContent)).toEqual(["Alpha", "Beta"]);

    const heading = surface.querySelector("h1");
    if (heading === null) throw new Error("no heading to type into");
    await type(surface, "!", heading);

    expect(entries(surface).map((entry) => entry.textContent)).toEqual(["Alpha!", "Beta"]);
    // The redraw writes into DOM that ProseMirror is watching, and a list left
    // un-ignored would be read back as an edit to the document it describes.
    expect(handle.getContent()).toBe("# Alpha!\n\n[TOC]\n\n## Beta\n");
  });

  it("redraws the list in place, without rebuilding the block", async () => {
    const { surface } = await mount("# Alpha\n\n[TOC]\n\n## Beta\n");
    const list = surface.querySelector("[data-newmd-toc-list]");

    const heading = surface.querySelector("h1");
    if (heading === null) throw new Error("no heading to type into");
    await type(surface, "!", heading);

    // Identity, not equality: a list that came back as a different element has
    // been thrown away and drawn again, and so has everything the reader had
    // reached for inside it. A redraw that is supposed to touch one line of
    // text is not allowed to cost the block.
    expect(surface.querySelector("[data-newmd-toc-list]")).toBe(list);
  });

  it("shows an empty list when there is nothing to list", async () => {
    const { surface } = await mount("[TOC]\n");

    // Empty rather than absent, and with no copy of its own: the reader typed
    // the directive, and a document with no headings has nothing to say.
    expect(entries(surface)).toEqual([]);
    expect(surface.querySelector("[data-newmd-toc-list] ul")).not.toBeNull();
  });
});

/**
 * The switch between the two halves (ADR-0002 §2.5).
 *
 * `data-mode="preview"` is the whole mechanism: the stylesheet hides one half
 * when it is there and the other half when it is not, so the attribute *is* the
 * state. Absent means source, which is the safe default — a decoration that
 * went missing would leave the reader looking at what the file says rather than
 * at a table of contents drawn from a document that may have moved on.
 *
 * jsdom applies no cascade, so what is on screen cannot be asked here. What can
 * is which of the two the editor has decided to show.
 */
describe("the two states of the block", () => {
  it("shows the table of contents while the caret is elsewhere", async () => {
    const { surface } = await mount("# One\n\n[TOC]\n");

    // The caret opens at the start of the document, which is inside the
    // heading — so this is also the plain case: opening a file shows a table of
    // contents rather than five characters.
    expect(block(surface)?.getAttribute("data-mode")).toBe("preview");
  });

  it("shows the marker itself once the caret is inside", async () => {
    const { surface } = await mount("# One\n\n[TOC]\n");
    await caretIn(surface, source(surface) as HTMLElement);

    // Gone rather than set to something else: source is the state with no
    // decoration, so there is no second spelling of it to keep in step.
    expect(block(surface)?.hasAttribute("data-mode")).toBe(false);
  });

  it("decides each block on its own", async () => {
    const { surface } = await mount("# One\n\n[TOC]\n\nMiddle\n\n[TOC]\n");
    const shown = (): (string | null)[] =>
      [...surface.querySelectorAll("[data-newmd-toc]")].map((node) =>
        node.getAttribute("data-mode"),
      );

    expect(shown()).toEqual(["preview", "preview"]);

    const second = surface.querySelectorAll("[data-newmd-toc]")[1];
    if (second === undefined) throw new Error("the document did not open with two blocks");
    await caretIn(surface, second.querySelector("[data-newmd-toc-source]") as HTMLElement);

    // The caret is in one of them, and both have to say the right thing: a rule
    // that marked every block but the last, or the first one only, would pass
    // any test that had just the one.
    expect(shown()).toEqual(["preview", null]);
  });
});

/**
 * Clicking an entry (ADR-0002 §2.6).
 *
 * Observed through `onCursorChange`'s line rather than through the DOM
 * selection, the way `handle-contract.test.ts` observes a jump: the caret is
 * the engine's, and the report is what a reader's status bar shows. The line is
 * the WYSIWYG surface's own — a line of the *rendered* document, which keeps no
 * node for a blank line — so a fixture written with the blocks hard against each
 * other is the one whose numbers can be read off the source.
 */
describe("entries the reader can click", () => {
  it("moves the caret to the heading the entry names", async () => {
    const seen: number[] = [];
    const { surface } = await mount("# One\n[TOC]\n## Two\n### Three\n", (line) => seen.push(line));

    const third = entries(surface)[2];
    if (third === undefined) throw new Error("no entry for the third heading");
    clickEntry(third);

    expect(seen.at(-1)).toBe(4);
  });

  it("lands on the heading it names, not the first one that reads alike", async () => {
    const seen: number[] = [];
    const { surface } = await mount("## Same\n[TOC]\n## Same\n", (line) => seen.push(line));

    const second = entries(surface)[1];
    if (second === undefined) throw new Error("no second entry");
    clickEntry(second);

    // Only the occurrence tells the two headings apart, and it travels to the
    // click as an attribute — `revealHeading` resolves it with the same walk
    // the entry was drawn from.
    expect(seen.at(-1)).toBe(3);
  });

  it("cancels the press, so the caret does not follow the pointer into the block", async () => {
    const { surface } = await mount("# One\n[TOC]\n");
    const entry = entries(surface)[0];
    if (entry === undefined) throw new Error("no entry to press");

    // What the browser would otherwise do with the press — collapse the
    // selection into the block — is not something jsdom performs, so this is the
    // contract rather than the outcome. Without it the block would be in its
    // source state by the time the click was handled, and the reader would watch
    // the list turn into five characters under the pointer.
    expect(clickEntry(entry)).toBe(true);
  });
});

/**
 * The other half of the switch (ADR-0002 §2.8).
 *
 * `data-mode` decides nothing on its own — it is the rules in `toc.css` that
 * hide one half or the other, which is why they ship inside core rather than
 * with the block's looks. jsdom applies no cascade and lays nothing out, so
 * which half is visible cannot be asked behaviourally here; what can be checked
 * is that the rules ship at all. A missing one is a block showing two versions
 * of itself at once, with nothing on screen to say which is the file.
 */
describe("the rules that read the mode", () => {
  it("hides the half that is not the state", async () => {
    // By path from the package root rather than from `import.meta.url`: under
    // jsdom the test module's own URL is the dev server's, not a file:// one.
    const css = await readFile("src/editor/toc.css", "utf8");

    expect(css).toContain('[data-newmd-toc][data-mode="preview"] [data-newmd-toc-source]');
    // The other direction is the one a missing decoration falls into, so it has
    // to be a rule about the *absence* of the attribute rather than about a
    // second value of it.
    expect(css).toContain(":not([data-mode=");
    expect(css).toContain("[data-newmd-toc-list]");
  });
});
