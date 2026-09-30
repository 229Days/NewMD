/**
 * Switching between WYSIWYG and source mode (ADR-0001 §2.9).
 *
 * The switch is a full surface swap — Milkdown is unmounted, CodeMirror is
 * mounted in its place — so the thing that can go wrong is the hand-off: a
 * truncated buffer, a serialisation that only runs one way, a callback left
 * pointing at the editor that was just thrown away. The ADR names the failure
 * outright: 切换 1000 行文档无丢内容.
 *
 * Comparisons are against the engine's own text either side of the switch
 * rather than against the fixture string. The WYSIWYG side serialises through
 * remark, which normalises Markdown as it writes it back out, so a raw fixture
 * would measure that normalisation instead of the switch. What has to hold is
 * that the swap itself costs nothing.
 */
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownSurface } from "../src/editor";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function mount(
  doc: string,
  onChange: (text: string) => void = () => {},
): Promise<{
  surface: MarkdownSurface;
  host: HTMLElement;
}> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const surface = await createMarkdownEditor({ parent: host, doc, onChange });
  cleanups.push(
    () => surface.destroy(),
    () => host.remove(),
  );
  return { surface, host };
}

/** A realistic document of exactly 1000 lines, in the ADR's own terms. */
function thousandLines(): string {
  const lines: string[] = [];
  while (lines.length < 1000) {
    const n = lines.length + 1;
    lines.push(`## Section ${n}`);
    lines.push(`Body line ${n}, with \`inline code\` and **bold**.`);
    lines.push(`- list item ${n}`);
    lines.push(`> quote ${n}`);
  }
  // Trim the tail rather than pad it: a file stops at its last line, so the
  // fixture has to stop at exactly 1000 of them.
  lines.length = 1000;
  return lines.join("\n") + "\n";
}

it("says which mode it is in", async () => {
  const { surface } = await mount("text\n");
  expect(surface.mode).toBe("wysiwyg");
  await surface.setMode("source");
  expect(surface.mode).toBe("source");
});

it("carries a 1000-line document across a switch, both ways", async () => {
  const doc = thousandLines();
  expect(doc.split("\n").length - 1).toBe(1000);

  const { surface } = await mount(doc);
  const before = surface.getContent();

  await surface.setMode("source");
  expect(surface.mode).toBe("source");
  expect(surface.getContent()).toBe(before);

  await surface.setMode("wysiwyg");
  expect(surface.mode).toBe("wysiwyg");
  expect(surface.getContent()).toBe(before);
});

it("keeps reporting edits after a switch", async () => {
  const seen: string[] = [];
  const { surface } = await mount("one\n", (text) => seen.push(text));

  // `insertImage` is the probe rather than `setContent`: the latter is a
  // programmatic replacement and is deliberately silent (see
  // `handle-contract.test.ts`), so it cannot tell a live callback from a stale
  // one. What has to survive the swap is the reporting of real edits.
  await surface.setMode("source");
  surface.insertImage({ alt: "a", url: "b.png" });
  expect(seen.at(-1)).toBe(surface.getContent());
  expect(seen.at(-1)).toContain("![a](b.png)");

  await surface.setMode("wysiwyg");
  const reported = seen.length;
  surface.insertImage({ alt: "c", url: "d.png" });
  expect(seen.length).toBe(reported + 1);
  expect(seen.at(-1)).toBe(surface.getContent());
});

it("switching to the mode it is already in leaves the surface alone", async () => {
  const { surface } = await mount("text\n");
  const before = surface.getContent();
  await surface.setMode("wysiwyg");
  expect(surface.getContent()).toBe(before);
});

it("serialises swaps that arrive before the last one finished", async () => {
  // `setMode` destroys the current engine and mounts another one, so two calls
  // that overlap would both reach for the same handle: the second destroys what
  // the first is still tearing down, and the document the first one read
  // out of it is nowhere any more. A shortcut key is exactly how you get two
  // of them in the same tick.
  const { surface, host } = await mount("text\n");
  const before = surface.getContent();

  await Promise.all([surface.setMode("source"), surface.setMode("wysiwyg")]);

  expect(surface.mode).toBe("wysiwyg");
  expect(surface.getContent()).toBe(before);
  // ...and the surface that lost the race must not be left in the DOM.
  expect(host.querySelectorAll("[contenteditable]").length).toBe(1);
});

it("does not report an edit it did not receive when it swaps engines", async () => {
  // The swap carries the text over by hand and then rebuilds. Nothing about
  // that is a user edit, so a clean document has to come out of it still clean —
  // otherwise every `Ctrl+/` leaves a save prompt behind it. Mounting is
  // already silent by contract; this pins that the swap stays that way.
  const seen: string[] = [];
  const { surface } = await mount("cat dog cat\n", (text) => seen.push(text));

  await surface.setMode("source");
  await surface.setMode("wysiwyg");

  expect(seen).toEqual([]);
});

it("keeps find and replace working across a switch", async () => {
  // A swap throws the engine away and builds another one, and match positions
  // are coordinates in the engine's own document — the very thing the swap
  // invalidates. If the handle kept answering from the engine it just
  // destroyed, this is where it would show.
  const { surface } = await mount("cat dog cat\n");

  await surface.setMode("source");
  expect(surface.replaceAll({ query: "cat", replacement: "bird" })).toBe(2);
  expect(surface.getContent()).toBe("bird dog bird\n");

  await surface.setMode("wysiwyg");
  expect(surface.replaceAll({ query: "bird", replacement: "cat" })).toBe(2);
  expect(surface.getContent()).toBe("cat dog cat\n");
});
