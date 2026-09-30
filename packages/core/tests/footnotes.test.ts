/**
 * Footnotes in the WYSIWYG surface (ADR-0001 §2.4 常用扩展, §4 M5).
 *
 * remark-gfm already parses these and Milkdown's gfm preset already ships a
 * schema for both halves, so the risk here is not building the feature — it is
 * discovering that one half of the pair was dropped on the floor. A reference
 * with no definition, or a definition rendered as literal `[^1]:` text, still
 * round-trips perfectly, so what is asserted is the document the engine built.
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

A claim that needs a source.[^1]

[^1]: The first source.
`;

describe("footnotes in the WYSIWYG surface", () => {
  it("renders the reference as a marker rather than literal brackets", async () => {
    const { host } = await mount(DOC);

    expect(host.textContent).not.toContain("[^1]");
    expect(host.querySelector("sup[data-label]")?.textContent).toBe("1");
  });

  it("renders the definition rather than leaving its spelling as text", async () => {
    const { host } = await mount(DOC);

    const definition = host.querySelector("dl[data-label]");
    expect(definition?.querySelector("dt")?.textContent).toBe("1");
    expect(definition?.querySelector("dd")?.textContent).toBe("The first source.");
    expect(host.textContent).not.toContain("[^1]:");
  });

  it("writes the source back unchanged", async () => {
    const { handle } = await mount(DOC);

    expect(handle.getContent()).toBe(DOC);
  });
});
