/**
 * A ` ```mermaid ` fence as a diagram (ADR-0001 §2.4 可选扩展, §4 M5).
 *
 * The round-trip gate cannot see a failure here either: a fence the engine
 * leaves as an ordinary code block hands its bytes straight back while the
 * reader looks at source instead of a chart. So this asserts the document the
 * engine built, and pins the one thing the corpus cannot — that a fence
 * carrying a meta string (` ```ts title=x `) survives a trip through
 * WYSIWYG, which the preset's own serializer used to drop.
 *
 * Mermaid itself is mocked: what is under test is that the fence reaches the
 * renderer and the result lands in the document, not a third-party library's
 * ability to lay out a graph.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import type { MarkdownEditorHandle } from "../src/editor/handle";
import { createWysiwygEditor } from "../src/editor/wysiwyg";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-diagram="yes"></svg>', diagramType: "mermaid" })),
  },
}));

const hosts: HTMLElement[] = [];
const handles: MarkdownEditorHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.destroy();
  for (const host of hosts.splice(0)) host.remove();
  document.documentElement.dataset.theme = "light";
  vi.mocked(mermaid.render).mockClear();
  vi.mocked(mermaid.render).mockImplementation(async () => ({
    svg: '<svg data-diagram="yes"></svg>',
    diagramType: "mermaid",
  }));
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

const DOC = [
  "# Diagrams",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B{Decide}",
  "```",
  "",
  "```ts title=answer.ts",
  "const answer = 42;",
  "```",
  "",
].join("\n");

describe("a mermaid fence in the WYSIWYG surface", () => {
  it("draws the diagram rather than showing the source as an editable block", async () => {
    const { host } = await mount(DOC);

    await vi.waitFor(() => expect(host.querySelector("[data-diagram]")).not.toBeNull());
    const block = host.querySelector("[data-newmd-mermaid]");
    expect(block?.getAttribute("data-rendered")).toBe("ok");
    // The source stays in the DOM behind the drawing — it is what an export
    // without Mermaid falls back to (§2.4 互操作策略), and what the reader sees
    // if the diagram will not draw.
    expect(block?.querySelector("code")?.textContent).toContain("A[Start]");
  });

  it("leaves an ordinary fence alone", async () => {
    const { host } = await mount(DOC);

    const plain = host.querySelector('pre[data-language="ts"]');
    expect(plain).not.toBeNull();
    expect(plain?.closest("[data-newmd-mermaid]")).toBeNull();
    expect(plain?.textContent).toContain("const answer = 42;");
    expect(host.querySelector("[data-newmd-mermaid]")).not.toBe(null);
  });

  it("keeps the source on screen when the diagram will not draw", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("bad diagram"));
    const { host } = await mount(DOC);

    await vi.waitFor(() =>
      expect(host.querySelector("[data-newmd-mermaid]")?.getAttribute("data-rendered")).toBe(
        "error",
      ),
    );
    expect(host.querySelector("[data-diagram]")).toBeNull();
    expect(host.querySelector("[data-newmd-mermaid] code")?.textContent).toContain("graph TD");
  });

  it("draws in the reader's current theme", async () => {
    document.documentElement.dataset.theme = "dark";
    const { host } = await mount(DOC);

    await vi.waitFor(() => expect(host.querySelector("[data-diagram]")).not.toBeNull());
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("writes the source back unchanged, meta string and all", async () => {
    const { handle } = await mount(DOC);

    expect(handle.getContent()).toBe(DOC);
  });
});
