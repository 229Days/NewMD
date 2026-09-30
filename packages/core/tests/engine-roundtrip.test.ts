/**
 * The M2 acceptance gate: edit -> save -> reopen leaves no difference.
 *
 * tests/roundtrip.test.ts proves the remark serializer keeps its promises. That
 * is necessary and not sufficient: the bytes a user actually gets back come out
 * of the WYSIWYG engine, and the engine sits on a ProseMirror schema of its own
 * in between. A schema that quietly drops a node — a table flattened to text,
 * an image reduced to its alt string — would leave every serializer test green
 * while the app corrupted files on every save.
 *
 * So this runs the corpus through the engine itself and reads it back, and it
 * has to come back as the very bytes the corpus promised. Same corpus, same
 * expectations, one reader (tests/golden.ts): two of those would drift.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { MarkdownEditorHandle } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";
import { goldenCases } from "./golden";

const hosts: HTMLElement[] = [];
const handles: MarkdownEditorHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

/** Mount the engine on `markdown` and read the document back out. */
async function throughTheEngine(markdown: string): Promise<string> {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  hosts.push(parent);

  const handle = await createWysiwygEditor({ parent, doc: markdown, onChange: () => {} });
  handles.push(handle);
  return handle.getContent();
}

describe("the WYSIWYG engine gives the corpus back untouched", () => {
  const cases = goldenCases();

  it("has something in it", () => {
    expect(cases).not.toEqual([]);
  });

  // The user's file must not move. This is the whole milestone: what goes into
  // the editor is what comes out of it, so saving cannot rewrite their document.
  it.each(cases.map((c) => [c.name, c] as const))(
    "gives %s back exactly as declared",
    async (_name, testCase) => {
      expect(await throughTheEngine(testCase.input)).toBe(testCase.expected);
    },
  );

  // Loading an already-saved file has to be a fixed point too, or a file would
  // drift a little further on every open-save cycle until it was unrecognisable.
  it.each(cases.map((c) => [c.name, c] as const))(
    "settles %s after one pass",
    async (_name, testCase) => {
      expect(await throughTheEngine(testCase.expected)).toBe(testCase.expected);
    },
  );
});
