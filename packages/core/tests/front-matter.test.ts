/**
 * YAML front matter as a visible block (ADR-0001 §2.4 常用扩展, §4 M5).
 *
 * Without a plugin that knows the construct, the three leading dashes parse as
 * a horizontal rule, the metadata as a paragraph, and the closing dashes as a
 * setext underline under it — so the document comes back as `## title: My Doc`
 * and the reader's front matter has silently become a heading. The round-trip
 * gate catches the rewriting; what it cannot catch is whether the engine shows
 * the metadata *as* metadata, which is what this file asserts.
 *
 * The remark half of the same feature is `tests/roundtrip.test.ts`.
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

const DOC = `---
title: My Doc
tags:
  - notes
  - yaml
description: Ships in 2 days
# a comment survives
---

Body text after the metadata.
`;

describe("front matter in the WYSIWYG surface", () => {
  it("shows the metadata as a block of its own", async () => {
    const { host } = await mount(DOC);

    const panel = host.querySelector("[data-newmd-frontmatter]");
    expect(panel).not.toBeNull();
    // One row per source line, so an indented list or a comment is still on
    // screen rather than folded into a key the reader never wrote.
    const rows = panel?.querySelectorAll("[data-line]") ?? [];
    expect(rows).toHaveLength(6);
    expect(rows[0]?.textContent).toBe("title: My Doc");
    expect(rows[2]?.textContent).toBe("  - notes");
    expect(rows[4]?.textContent).toBe("description: Ships in 2 days");
    expect(rows[5]?.textContent).toBe("# a comment survives");
  });

  it("is metadata, not a heading wearing the dashes", async () => {
    const { host } = await mount(DOC);

    // The fallback parse turns the closing fence into a setext underline and
    // hands back `## title: My Doc` — the rewriting the corpus already fails
    // on, and the shape this rules out on screen too.
    expect(host.querySelector("h2")).toBeNull();
    // The fences belong to the construct, not to what it shows.
    expect(host.textContent).not.toContain("---");
    expect(host.textContent).toContain("Body text after the metadata.");
  });

  it("writes the source back unchanged", async () => {
    const { handle } = await mount(DOC);

    expect(handle.getContent()).toBe(DOC);
  });
});
