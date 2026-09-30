/**
 * Undo and redo across documents (ADR-0001 §4 M3: 撤销重做一致性).
 *
 * Two things have to hold, and they fail in opposite directions. Undo must
 * still undo inside a document, and it must never reach *across* one: swapping
 * tabs is a document replacement, and a history that survived it would put the
 * previous tab's text into the current one at the press of Ctrl+Z. That is not
 * a lost undo step, it is content arriving in the wrong file.
 *
 * `undo`/`redo` are on the handle for the same reason find and replace are:
 * the machinery is per-engine — CodeMirror's `history`, ProseMirror's — and
 * ADR §2.3 says the app drives it without learning which one is running.
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
): Promise<MarkdownEditorHandle> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = await create({ parent: host, doc, onChange: () => {} });
  cleanups.push(
    () => handle.destroy(),
    () => host.remove(),
  );
  return handle;
}

const engines = [
  ["source mode", createSourceEditor],
  ["WYSIWYG", createWysiwygEditor],
] as const;

describe.each(engines)("the %s surface keeps undo inside one document", (_name, create) => {
  it("undoes an edit it was asked to make", async () => {
    const handle = await mount(create, "alpha\n");
    const before = handle.getContent();
    handle.insertImage({ alt: "a", url: "b.png" });
    expect(handle.getContent()).not.toBe(before);

    handle.undo();
    expect(handle.getContent()).toBe(before);
  });

  it("redoes an edit that was undone", async () => {
    const handle = await mount(create, "alpha\n");
    handle.insertImage({ alt: "a", url: "b.png" });
    const edited = handle.getContent();

    handle.undo();
    handle.redo();
    expect(handle.getContent()).toBe(edited);
  });

  it("does not reach back into the document it replaced", async () => {
    // The tab-switch failure: the second document is loaded into the same
    // surface, and a history still holding the first one's edits would hand
    // them to the reader as undo steps of the file they are now looking at.
    const handle = await mount(create, "alpha\n");
    handle.insertImage({ alt: "a", url: "b.png" });

    handle.setContent("beta\n");
    expect(handle.getContent()).toBe("beta\n");

    handle.undo();
    expect(handle.getContent()).toBe("beta\n");
    handle.undo();
    expect(handle.getContent()).toBe("beta\n");
    handle.redo();
    expect(handle.getContent()).toBe("beta\n");
  });

  it("starts fresh for a document that happens to hold the same text", async () => {
    // Two empty tabs are the mundane case of the same bug, and the one an
    // early return on equal text walks straight into: nothing about the
    // document changed, so nothing resets the history, and the two share one.
    const handle = await mount(create, "");
    handle.insertImage({ alt: "a", url: "b.png" });

    handle.setContent("");
    const empty = handle.getContent();

    handle.undo();
    expect(handle.getContent()).toBe(empty);
  });
});
