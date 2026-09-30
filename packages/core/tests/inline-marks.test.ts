/**
 * `==highlight==` as an editable mark (ADR-0001 §2.4 常用扩展, §4 M5).
 *
 * The round-trip gate cannot see a failure here. If the WYSIWYG engine does not
 * know the syntax, it stores `==marked==` as ordinary text and hands those very
 * bytes back — byte-perfect, and lit up as literal equals signs on screen. That
 * is the false pass this file exists to rule out, so what it asserts is the
 * document the engine actually built, not the string it can reprint.
 *
 * The remark half of the same feature is `tests/roundtrip.test.ts`; this covers
 * the half only the engine can answer for.
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

/**
 * The text of `root` that a `<mark>` covers, in document order.
 *
 * Written this way rather than by counting `<mark>` elements because the
 * highlight is a ProseMirror *range*, not a nested element: `==a **b** c==`
 * renders as `<mark>a </mark><strong><mark>b</mark></strong><mark> c</mark>`,
 * and asking for one enclosing `<mark>` would fail on a perfectly correct
 * document. What matters is which characters are lit up, not how many elements
 * the serializer needed to say so.
 */
function covered(root: ParentNode | null | undefined): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement?.closest("mark")) out += node.textContent ?? "";
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  if (root) walk(root);
  return out;
}

const DOC = "# Notes\n\nA ==marked== word.\n\n==a **bold** span== too.\n";

describe("highlight in the WYSIWYG surface", () => {
  it("builds the span as a highlight rather than typing the delimiters", async () => {
    const { host } = await mount(DOC);

    // `<mark>` is what the schema has to put in the DOM. Finding it is the
    // only way to tell a real span from the literal characters stored as text,
    // since both serialize back to the same bytes.
    expect(host.textContent).not.toContain("==");
    const first = host.querySelector("p");
    expect(first?.textContent).toBe("A marked word.");
    expect(covered(first)).toBe("marked");
    expect(covered(host.querySelectorAll("p")[1])).toBe("a bold span");
  });

  it("keeps the bold inside the highlight it wraps", async () => {
    const { host } = await mount(DOC);

    const strong = host.querySelector("strong");
    expect(strong?.textContent).toBe("bold");
    // The proof the highlight actually wraps it. ProseMirror stores marks as a
    // range per text run, so the span is three `<mark>` elements rather than one
    // around the bold — the bold carries a mark of its own, which is what
    // `covered` reads.
    expect(covered(strong)).toBe("bold");
  });

  it("writes the source back unchanged", async () => {
    const { handle } = await mount(DOC);

    expect(handle.getContent()).toBe(DOC);
  });
});
