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
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("lets the reader edit a line where it stands", async () => {
    const { host, handle } = await mount(DOC);

    const row = host.querySelector("[data-newmd-frontmatter] [data-line]");
    if (!(row instanceof HTMLElement)) throw new Error("no front matter row");

    // A row the reader cannot put a caret into is a picture of metadata, not
    // metadata they can fix — so the edit below is only meaningful if this
    // holds. It is also what tells the schema's plain `toDOM` rows (which a
    // copy or an export walks) apart from the node view's rows.
    expect(row.getAttribute("contenteditable")).toBe("true");

    row.textContent = "title: My Renamed Doc";
    row.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(handle.getContent()).toContain("title: My Renamed Doc");
    });
    // The reader typed one line. Every other line has to come back as it was —
    // a comment, an indented list item, the description, the body — because an
    // edit that also rewrites its neighbours is a save the reader never asked
    // for. This is the same promise `front-matter.md` makes on the corpus side.
    expect(handle.getContent().startsWith("---\ntitle: My Renamed Doc\n")).toBe(true);
    expect(handle.getContent()).toContain("  - notes");
    expect(handle.getContent()).toContain("# a comment survives");
    expect(handle.getContent()).toContain("Body text after the metadata.");

    // And the block is still standing: the row the reader is typing into has to
    // survive the edit it caused. Rebuilt from the new value it would look
    // right in a snapshot and drop the caret on every keystroke.
    expect(host.querySelector("[data-newmd-frontmatter] [data-line]")).toBe(row);
  });

  it("takes Enter as a new line of metadata", async () => {
    const { host, handle } = await mount(DOC);

    const row = host.querySelector("[data-newmd-frontmatter] [data-line]");
    if (!(row instanceof HTMLElement)) throw new Error("no front matter row");

    // The caret at the end of `title: My Doc`, which is where a reader who
    // wants another key underneath it would be.
    const range = document.createRange();
    range.selectNodeContents(row);
    range.collapse(false);
    const selection = window.getSelection();
    if (!selection) throw new Error("no selection to place");
    selection.removeAllRanges();
    selection.addRange(range);

    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      expect(handle.getContent().startsWith("---\ntitle: My Doc\n\ntags:\n")).toBe(true);
    });
    // The line the reader just opened has to be one of the rows. Left to the
    // browser it would be a second `div` beside the first, carrying no
    // `data-line` — and a line the rows do not hold is a line the next save
    // drops without saying so.
    expect(row.textContent).toBe("title: My Doc\n");
    expect(handle.getContent()).toContain("  - notes");
    expect(handle.getContent()).toContain("# a comment survives");
  });

  it("lets a keystroke in a row be the row's own", async () => {
    const { host, handle } = await mount(DOC);

    const row = host.querySelector("[data-newmd-frontmatter] [data-line]");
    if (!(row instanceof HTMLElement)) throw new Error("no front matter row");

    // Backspace is the preset's own binding — it joins a block into the one
    // above. A reader deleting a character inside a line of metadata means the
    // character, so the event has to stop at the panel rather than reach the
    // editor behind it.
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
    );

    expect(handle.getContent()).toBe(DOC);
  });
});
