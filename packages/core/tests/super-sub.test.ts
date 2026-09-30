/**
 * `^sup^` and `~sub~` in the WYSIWYG surface (ADR-0001 §2.4 常用扩展, §4 M5).
 *
 * The round-trip gate cannot see these either, and the reason is worse than for
 * `==highlight==`: GFM's strikethrough recognises a *single* tilde, so `H~2~O`
 * parses as strikethrough and would sail through a byte-identity check while
 * rendering the subscript as struck-through text. What is asserted here is the
 * element the engine actually built.
 *
 * `~~gone~~` rides along on purpose — it is the pair the single-tilde change
 * must not swallow.
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

Water is H~2~O and 10^3^ is a thousand.

==E = mc^2^== keeps its superscript.

~~gone~~ is still a strike, not a subscript.
`;

describe("superscript and subscript in the WYSIWYG surface", () => {
  it("builds <sup> and <sub> rather than typing the delimiters", async () => {
    const { host } = await mount(DOC);

    expect([...host.querySelectorAll("sup")].map((node) => node.textContent)).toEqual(["3", "2"]);
    expect([...host.querySelectorAll("sub")].map((node) => node.textContent)).toEqual(["2"]);
    // The delimiters are gone from the rendered text entirely: a literal `~`
    // left behind would mean one pair was swallowed as strikethrough instead.
    expect(host.textContent).not.toMatch(/[~^]/);
  });

  it("keeps a superscript inside the highlight that wraps it", async () => {
    const { host } = await mount(DOC);

    const mark = host.querySelector("mark");
    expect(mark?.querySelector("sup")?.textContent).toBe("2");
    expect(mark?.textContent).toBe("E = mc2");
  });

  it("still strikes through a double tilde", async () => {
    const { host } = await mount(DOC);

    expect(host.querySelector("del")?.textContent).toBe("gone");
    // Exactly one subscript, the "2" of H~2~O: the strikethrough must not have
    // been reinterpreted as one.
    expect([...host.querySelectorAll("sub")].map((node) => node.textContent)).toEqual(["2"]);
  });

  it("writes the source back unchanged", async () => {
    const { handle } = await mount(DOC);

    expect(handle.getContent()).toBe(DOC);
  });
});
