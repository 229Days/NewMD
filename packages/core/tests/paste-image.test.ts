/**
 * A pasted image lands in `./assets/` beside the file (ADR-0001 §2.8, §4 M5).
 *
 * The acceptance for M5 is 「粘贴图片生成相对路径」, and the reason that has to be
 * asserted rather than assumed is the one §2.5 spends the whole milestone on:
 * a pasted image is *bytes the document does not contain*. The browser will
 * happily hand the editor a `blob:` URL, the editor will happily write that
 * into the `.md`, and the file will open with a picture in it and be broken the
 * next day — with a round trip that still reports byte-perfect, because nothing
 * was lost, only never had the file it points at.
 *
 * So what is under test is the whole trip: bytes off the clipboard, a file on
 * disk under the document's own directory, and a path in the Markdown that is
 * relative to the document rather than to wherever the app happens to live.
 *
 * Both surfaces get the same treatment through `describe.each`, reached the way
 * the app reaches them — through `createMarkdownEditor`, which is where the
 * paste listener lives. A reader who switches to source mode and pastes there
 * has the same expectation, and `tests/handle-contract.test.ts` is what keeps
 * the two engines interchangeable once the path is in the document.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMarkdownEditor, type MarkdownSurface } from "../src/editor";
import { imageFileName } from "../src/editor/paste-image";
import { resetPlatform, setPlatform } from "../src/platform";
import type { JsonValue, PlatformAdapter, WriteResult } from "../src/platform/types";

/** Not a real PNG; the editor never looks at the pixels, only at the bytes. */
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const DOC = "type here";

/** A pasted image's path, in the spelling ADR-0001 §2.8 asks for. */
const RELATIVE = /!\[[^\]]*\]\(\.\/assets\/\d{8}-\d{6}-[0-9a-f]{8}\.png\)/;

/** Everything the fake disk was asked to hold. */
let created: string[] = [];
let written: { path: string; bytes: Uint8Array }[] = [];

function fakePlatform(): PlatformAdapter {
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  return {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: unused,
    readTextFile: unused,
    writeTextFile: unused,
    writeBinaryFile: async (path, bytes) => {
      written.push({ path, bytes });
      return { path, modifiedAt: 0 } satisfies WriteResult;
    },
    createDir: async (path) => {
      created.push(path);
    },
    renamePath: unused,
    removePath: unused,
    pathExists: async () => false,
    pathJoin: (base, relative) => `${base.replace(/[\\/]+$/, "")}/${relative}`,
    pathParent: (path) => path.slice(0, path.lastIndexOf("/")) || null,
    pathFileName: (path) => path.slice(path.lastIndexOf("/") + 1),
    pathExtension: unused,
    readAppData: async (): Promise<JsonValue | null> => null,
    writeAppData: async () => {},
    deleteAppData: async () => {},
  };
}

const hosts: HTMLElement[] = [];
const surfaces: MarkdownSurface[] = [];

beforeEach(() => {
  created = [];
  written = [];
  setPlatform(fakePlatform());
});

afterEach(async () => {
  for (const surface of surfaces.splice(0)) await surface.destroy();
  for (const host of hosts.splice(0)) host.remove();
  resetPlatform();
});

/**
 * Fire a paste carrying `file` and/or `text` at the surface's editable element.
 *
 * jsdom has no `ClipboardEvent`, so the event is built by hand. `getData` is on
 * it because the engines read the clipboard themselves whenever they are the
 * ones handling the paste, and a clipboard without it is not a clipboard — it
 * is a `TypeError` from inside a listener.
 *
 * Whether anyone called `preventDefault` is deliberately not returned: the
 * engines call it for a paste they handle, so it says nothing about whether
 * *this* module claimed the event. The document does.
 */
async function paste(
  mode: "wysiwyg" | "source",
  clipboard: { file?: File; text?: string },
  extra: { imageTarget?: () => { docPath: string; dirName: string } | null } = {},
): Promise<MarkdownSurface> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const surface = await createMarkdownEditor({
    parent: host,
    doc: DOC,
    mode,
    onChange: () => {},
    imageTarget: () => ({ docPath: "/ws/notes/todo.md", dirName: "assets" }),
    ...extra,
  });
  surfaces.push(surface);

  const editable = host.querySelector("[contenteditable]");
  if (!(editable instanceof HTMLElement)) throw new Error("no editable surface mounted");
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: clipboard.file ? [clipboard.file] : [],
      getData: (type: string) => (type === "text/plain" ? (clipboard.text ?? "") : ""),
    },
  });
  editable.dispatchEvent(event);
  return surface;
}

const modes = ["wysiwyg", "source"] as const;

describe.each(modes)("pasting an image into %s", (mode) => {
  it("writes it beside the file and puts a relative path in the Markdown", async () => {
    const file = new File([BYTES], "shot.png", { type: "image/png" });
    const surface = await paste(mode, { file });

    await vi.waitFor(() => expect(surface.getContent()).toMatch(RELATIVE));
    expect(created).toEqual(["/ws/notes/assets"]);
    expect(written).toHaveLength(1);
    expect(written[0]!.path).toMatch(/^\/ws\/notes\/assets\/\d{8}-\d{6}-[0-9a-f]{8}\.png$/);
    expect(Array.from(written[0]!.bytes)).toEqual(Array.from(BYTES));
  });

  it("leaves a paste with no image on it to the engine", async () => {
    const surface = await paste(mode, { text: "hello" });
    await vi.waitFor(() => expect(surface.getContent()).toContain("hello"));
    expect(written).toEqual([]);
    expect(created).toEqual([]);
    expect(surface.getContent()).not.toContain("./assets/");
  });

  it("writes nothing for a buffer that has never been saved", async () => {
    const file = new File([BYTES], "shot.png", { type: "image/png" });
    const surface = await paste(mode, { file, text: "hello" }, { imageTarget: () => null });

    // Nothing was written, and the paste was not swallowed either: with no
    // `./assets/` to write into, taking the event would drop the picture and
    // the text with it.
    await vi.waitFor(() => expect(surface.getContent()).toContain("hello"));
    expect(written).toEqual([]);
    expect(created).toEqual([]);
    expect(surface.getContent()).not.toContain("./assets/");
  });

  it("says so when the image cannot be written", async () => {
    const errors: unknown[] = [];
    setPlatform({
      ...fakePlatform(),
      writeBinaryFile: async () => {
        throw new Error("disk full");
      },
    });
    const file = new File([BYTES], "shot.png", { type: "image/png" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const surface = await createMarkdownEditor({
      parent: host,
      doc: DOC,
      mode,
      onChange: () => {},
      imageTarget: () => ({ docPath: "/ws/notes/todo.md", dirName: "assets" }),
      onImageError: (error) => errors.push(error),
    });
    surfaces.push(surface);

    const editable = host.querySelector("[contenteditable]");
    if (!(editable instanceof HTMLElement)) throw new Error("no editable surface mounted");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [file], getData: () => "" },
    });
    editable.dispatchEvent(event);

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect((errors[0] as Error).message).toContain("disk full");
    // Claimed and failed: no half-written reference pointing at a file that
    // is not there.
    expect(surface.getContent()).not.toContain("./assets/");
  });
});

describe("the name a pasted image gets", () => {
  it("follows YYYYMMDD-HHmmss-<hash8> and depends on the bytes", () => {
    const at = new Date("2026-09-30T19:52:17");
    const same = imageFileName(BYTES, "png", at);
    expect(same).toBe(imageFileName(BYTES, "png", at));
    expect(same).toMatch(/^\d{8}-\d{6}-[0-9a-f]{8}\.png$/);
    expect(imageFileName(new Uint8Array([9, 9, 9]), "png", at)).not.toBe(same);
    expect(imageFileName(BYTES, "png", new Date("2026-09-30T19:52:18"))).not.toBe(same);
  });
});
