/**
 * Find and replace (ADR-0001 §2.11: 源码模式用 CodeMirror 内建；WYSIWYG 用 ProseMirror search).
 *
 * The engines search with their own machinery, but the app must not know that.
 * §2.3 keeps every engine call inside the adapter layer, so the capability is
 * spelled once here on the shared handle and both surfaces are held to it. If
 * search leaked through as a CodeMirror `SearchQuery` or a ProseMirror command,
 * the UI would grow an opinion about which engine is running and the swap in
 * `editor/surface.ts` would stop being a one-file change.
 *
 * Assertions are behavioural — did that occurrence change? — rather than
 * positional. Match offsets are document offsets in the engine's own document,
 * and a ProseMirror doc puts a paragraph node in front of its text where source
 * mode has raw characters, so the same match does not have the same `from` in
 * both engines. A test pinned to `from === 3` would pin a layout detail and
 * learn nothing about whether find works.
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

describe.each(engines)("find and replace in %s", (_name, create) => {
  it("locates a match", async () => {
    const handle = await mount(create, "cat dog cat\n");
    const match = handle.findNext({ query: "dog" });
    expect(match).not.toBeNull();
  });

  it("reports no match for text that is not there", async () => {
    const handle = await mount(create, "cat dog cat\n");
    expect(handle.findNext({ query: "moose" })).toBeNull();
  });

  it("steps forward through matches and wraps at the end", async () => {
    const handle = await mount(create, "cat dog cat\n");
    expect(handle.findNext({ query: "cat" })).not.toBeNull();
    expect(handle.findNext({ query: "cat" })).not.toBeNull();
    // Third call: only two occurrences, so this is the first one again.
    expect(handle.findNext({ query: "cat" })).not.toBeNull();
  });

  it("steps backward through matches and wraps at the start", async () => {
    const handle = await mount(create, "cat dog cat\n");
    expect(handle.findNext({ query: "cat" })).not.toBeNull();
    expect(handle.findPrevious({ query: "cat" })).not.toBeNull();
    expect(handle.findPrevious({ query: "cat" })).not.toBeNull();
  });

  it("replaces the match the selection is on, and only that one", async () => {
    const handle = await mount(create, "cat dog cat\n");
    handle.findNext({ query: "cat" });
    expect(handle.replace({ query: "cat", replacement: "bird" })).toBe(true);
    expect(handle.getContent()).toBe("bird dog cat\n");
  });

  it("advances without replacing when the selection is not a match", async () => {
    const handle = await mount(create, "cat dog cat\n");
    expect(handle.replace({ query: "cat", replacement: "bird" })).toBe(false);
    expect(handle.getContent()).toBe("cat dog cat\n");
  });

  it("replaces every match at once", async () => {
    const handle = await mount(create, "cat dog cat\n");
    expect(handle.replaceAll({ query: "cat", replacement: "bird" })).toBe(2);
    expect(handle.getContent()).toBe("bird dog bird\n");
  });

  it("replaces nothing when nothing matches", async () => {
    const handle = await mount(create, "cat dog cat\n");
    expect(handle.replaceAll({ query: "moose", replacement: "bird" })).toBe(0);
    expect(handle.getContent()).toBe("cat dog cat\n");
  });

  it("is case-insensitive unless told otherwise", async () => {
    const handle = await mount(create, "Cat dog cat\n");
    expect(handle.replaceAll({ query: "cat", replacement: "bird" })).toBe(2);
    expect(handle.getContent()).toBe("bird dog bird\n");
  });

  it("honours case sensitivity when asked", async () => {
    const handle = await mount(create, "Cat dog cat\n");
    expect(handle.replaceAll({ query: "cat", replacement: "bird", caseSensitive: true })).toBe(1);
    expect(handle.getContent()).toBe("Cat dog bird\n");
  });
});
