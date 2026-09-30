/**
 * The engine-agnostic handle contract, checked against both editing surfaces.
 *
 * `editor/handle.ts` says what every editor owes the app. ADR-0001 §2.3 promises
 * that swapping engines is a one-file change in the adapter layer — a promise
 * that is only worth anything if it is enforced, so this mounts each engine and
 * asks it for the same things. A surface that quietly stops filling the contract
 * fails here instead of at the call site that trusted it.
 *
 * Spellcheck is read off the editable element rather than off the handle on
 * purpose: `view.dom`, `view.contentDOM` and a `contenteditable` attribute are
 * engine details, and a handle that leaked one would be a handle that already
 * broke the boundary this file exists to police. The fixture documents end in a
 * newline because that is what a Markdown file looks like — byte fidelity is
 * `tests/roundtrip.test.ts`'s job, not this one's.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createSourceEditor } from "../src/editor/codemirror";
import type { MarkdownEditorHandle, MarkdownEditorOptions } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function mount(
  create: (options: MarkdownEditorOptions) => MarkdownEditorHandle | Promise<MarkdownEditorHandle>,
  doc: string,
  extra: Partial<MarkdownEditorOptions> = {},
): Promise<{ handle: MarkdownEditorHandle; host: HTMLElement }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = await create({ parent: host, doc, onChange: () => {}, ...extra });
  cleanups.push(
    () => handle.destroy(),
    () => host.remove(),
  );
  return { handle, host };
}

function editable(host: HTMLElement): HTMLElement {
  const el = host.querySelector("[contenteditable]");
  if (!(el instanceof HTMLElement)) throw new Error("no editable surface mounted");
  return el;
}

const engines = [
  ["source mode", createSourceEditor],
  ["WYSIWYG", createWysiwygEditor],
] as const;

describe.each(engines)("the %s surface fills the shared handle", (_name, create) => {
  it("gives back the document it was mounted with", async () => {
    const { handle } = await mount(create, "plain text\n");
    expect(handle.getContent()).toBe("plain text\n");
  });

  it("replaces the document on setContent", async () => {
    const { handle } = await mount(create, "old\n");
    handle.setContent("new\n");
    expect(handle.getContent()).toBe("new\n");
  });

  it("leaves the document alone when setContent repeats it", async () => {
    const { handle } = await mount(create, "same\n");
    handle.setContent("same\n");
    expect(handle.getContent()).toBe("same\n");
  });

  it("does not report a change for a document it was handed", async () => {
    // `setContent` is a programmatic replacement, not an edit. A store pushing
    // content into the editor must not have it bounced straight back at itself
    // — and, worse, must not have a fresh document counted as unsaved work. The
    // two engines disagreed on this: source mode reported it, WYSIWYG stayed
    // quiet. That is exactly the drift this file exists to catch.
    const seen: string[] = [];
    const { handle } = await mount(create, "old\n", { onChange: (text) => seen.push(text) });
    handle.setContent("new\n");
    expect(seen).toEqual([]);
  });

  it("reports a change the user made", async () => {
    const seen: string[] = [];
    const { handle } = await mount(create, "", { onChange: (text) => seen.push(text) });
    handle.insertImage({ alt: "a", url: "b.png" });
    expect(seen.at(-1)).toBe(handle.getContent());
  });

  it("mounts with the spellcheck it was asked for", async () => {
    const { host } = await mount(create, "text\n", { spellcheck: false });
    expect(editable(host).spellcheck).toBe(false);
  });

  it("turns spellcheck off and back on without a rebuild", async () => {
    const { handle, host } = await mount(create, "text\n");
    expect(editable(host).spellcheck).toBe(true);

    handle.setSpellcheck(false);
    expect(editable(host).spellcheck).toBe(false);

    handle.setSpellcheck(true);
    expect(editable(host).spellcheck).toBe(true);
  });

  it("inserts an image at the cursor", async () => {
    const { handle } = await mount(create, "");
    handle.insertImage({ alt: "alt text", url: "images/pic.png", title: "The title" });
    expect(handle.getContent()).toContain('![alt text](images/pic.png "The title")');
  });

  it("writes an image with no title as no title", async () => {
    const { handle } = await mount(create, "");
    handle.insertImage({ alt: "a", url: "b.png" });
    expect(handle.getContent()).toContain("![a](b.png)");
    expect(handle.getContent()).not.toContain('"');
  });

  it("moves the caret to the heading it was asked for", async () => {
    // The line, not the column. The two engines report the caret against
    // different texts — source mode against the Markdown, WYSIWYG against the
    // ProseMirror document — and the column WYSIWYG reports is a document
    // position rather than a text offset, so the two columns were never going
    // to agree. The line is the same number on both sides only because the
    // fixture writes one source line per rendered line: no blank lines
    // (ProseMirror keeps no node for one) and no list markers to strip away.
    // What is pinned is that both engines land on the *same heading*, which is
    // what 「大纲点击可跳转」 asks of either mode.
    const seen: number[] = [];
    const { handle } = await mount(create, "# Alpha\n## Target\nBody\n", {
      onCursorChange: (line) => seen.push(line),
    });

    expect(handle.revealHeading({ level: 2, text: "Target", occurrence: 0 })).toBe(true);

    expect(seen.at(-1)).toBe(2);
  });

  it("lands on the second of two headings that read alike", async () => {
    const seen: number[] = [];
    const { handle } = await mount(create, "## Same\n## Same\n", {
      onCursorChange: (line) => seen.push(line),
    });

    expect(handle.revealHeading({ level: 2, text: "Same", occurrence: 1 })).toBe(true);

    // The second line, not the first: the two headings read alike, so only the
    // occurrence tells them apart.
    expect(seen.at(-1)).toBe(2);
  });

  it("leaves the caret alone when the heading is not in the document", async () => {
    const seen: number[] = [];
    const { handle } = await mount(create, "# Alpha\n", {
      onCursorChange: (line) => seen.push(line),
    });
    const before = seen.length;

    expect(handle.revealHeading({ level: 2, text: "Missing", occurrence: 0 })).toBe(false);

    expect(seen.length).toBe(before);
  });

  it("releases the surface on destroy", async () => {
    const { handle, host } = await mount(create, "text\n");
    await handle.destroy();
    expect(host.querySelector("[contenteditable]")).toBeNull();
  });
});

describe("the WYSIWYG surface builds an image node, not the text of one", () => {
  it("renders an img element for an inserted image", async () => {
    const { handle, host } = await mount(createWysiwygEditor, "");
    handle.insertImage({ alt: "alt text", url: "images/pic.png" });
    // `img[src]` rather than `img`: ProseMirror keeps an empty separator image
    // in the document for a Firefox line-breaking quirk, and a bare tag match
    // asserts on that instead of on the image the user just inserted.
    const img = host.querySelector("img[src]");
    expect(img?.getAttribute("src")).toBe("images/pic.png");
    expect(img?.getAttribute("alt")).toBe("alt text");
  });
});
