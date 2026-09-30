/**
 * KaTeX math in the WYSIWYG surface (ADR-0001 §2.4 常用扩展, §4 M5).
 *
 * The two halves of the risk are different from the marks above. Round-trip
 * fidelity is the merge gate's job, but what only the engine can answer is
 * whether the formula arrived as a *formula*: an unrecognized `$$…$$` is
 * stored as text, printed back byte for byte, and shown to the reader as
 * dollar signs. This file asserts the KaTeX markup the engine produced.
 *
 * KaTeX renders synchronously into the element the schema hands ProseMirror,
 * so the assertions can be made against the mounted document.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { MarkdownEditorHandle } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";

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

const DOC = `# Notes

Inline $x^2$ sits in a sentence.

$$
a^2 + b^2 = c^2
$$
`;

describe("math in the WYSIWYG surface", () => {
  it("renders inline math rather than showing the dollars", async () => {
    const { host } = await mount(DOC);

    const inline = host.querySelector('[data-newmd-math="inline"]');
    expect(inline?.querySelector(".katex")).not.toBeNull();
    expect(inline?.classList.contains("katex-display")).toBe(false);
    expect(host.textContent).not.toContain("$");
  });

  it("renders a display block as its own block", async () => {
    const { host } = await mount(DOC);

    const display = host.querySelector('[data-newmd-math="display"]');
    expect(display?.querySelector(".katex-display")).not.toBeNull();
    expect(display?.closest("p")).toBeNull();
  });

  it("writes the source back unchanged", async () => {
    const { handle } = await mount(DOC);

    expect(handle.getContent()).toBe(DOC);
  });
});
