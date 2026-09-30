/**
 * An image that already exists on disk joins the document the same way a
 * pasted one does (ADR-0001 §2.5 本地路径插入, §2.8 图片入 `./assets/`).
 *
 * §2.5 lists three ways in — 粘贴 / 拖拽 / 本地路径插入 — and §2.8 gives one
 * destination for all of them: `./assets/`, referenced relatively. The third
 * one is the trap. Its bytes are already readable, so the tempting shortcut is
 * to write whatever path the reader picked straight into the Markdown:
 *
 *   - an absolute path survives a round trip byte-perfect and breaks the
 *     moment the folder moves or the document is read on another machine;
 *   - a path outside the document's directory is not copyable with the folder
 *     at all, which is the whole reason §2.8 rejects 「引用原位置」.
 *
 * So the file is copied first and the copy is what the Markdown points at.
 *
 * What makes this different from pasting is that the source has a name the
 * reader chose, and that name is worth keeping — `Screenshot 2026-09-30.png`
 * means something where `20260930-142231-8f3a1c02.png` does not. It is kept
 * unless keeping it would put a second file on top of a first.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveLocalImage, type ImageTarget } from "../src/editor/paste-image";
import { resetPlatform, setPlatform } from "../src/platform";
import type { JsonValue, PlatformAdapter, WriteResult } from "../src/platform/types";

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const TARGET: ImageTarget = { docPath: "/ws/notes/todo.md", dirName: "assets" };

/** Everything the fake disk was asked to do. */
let created: string[] = [];
let written: { path: string; bytes: Uint8Array }[] = [];
/** Sources that exist, by path. */
let present: string[] = [];
/** Bytes at `present`'s paths. */
let sources: Record<string, Uint8Array> = {};

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
    pathExists: async (path) => present.includes(path),
    pathJoin: (base, relative) => `${base.replace(/[\\/]+$/, "")}/${relative}`,
    pathParent: (path) => path.slice(0, path.lastIndexOf("/")) || null,
    pathFileName: (path) => path.slice(path.lastIndexOf("/") + 1),
    pathExtension: (path) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      const dot = name.lastIndexOf(".");
      return dot > 0 ? name.slice(dot + 1) : null;
    },
    readAppData: async (): Promise<JsonValue | null> => null,
    writeAppData: async () => {},
    deleteAppData: async () => {},
    // The one this file exists for.
    readBinaryFile: async (path) => {
      const bytes = sources[path];
      if (!bytes) throw new Error(`no such file: ${path}`);
      return bytes;
    },
  } satisfies PlatformAdapter;
}

beforeEach(() => {
  created = [];
  written = [];
  present = [];
  sources = {};
  setPlatform(fakePlatform());
});

afterEach(() => {
  resetPlatform();
});

/** Lay a file down at `path` on the fake disk. */
function put(path: string, bytes: Uint8Array = BYTES): void {
  present.push(path);
  sources[path] = bytes;
}

describe("inserting an image that is already on disk", () => {
  it("copies it into ./assets/ and points at the copy", async () => {
    put("/photos/Screenshot 2026-09-30.png");

    const relative = await saveLocalImage(TARGET, "/photos/Screenshot 2026-09-30.png");

    // The name is the one the reader gave the file: a timestamped hash would
    // say nothing about which picture it is the next time the folder is read.
    expect(relative).toBe("./assets/Screenshot 2026-09-30.png");
    expect(created).toEqual(["/ws/notes/assets"]);
    expect(written).toHaveLength(1);
    expect(written[0]!.path).toBe("/ws/notes/assets/Screenshot 2026-09-30.png");
    expect(Array.from(written[0]!.bytes)).toEqual(Array.from(BYTES));
  });

  it("keeps the ADR's timestamped name when that name is already taken", async () => {
    // A different `logo.png` already sits in `./assets/`. Writing over it would
    // silently repoint every other document that references it.
    put("/photos/logo.png", new Uint8Array([1, 2, 3]));
    present.push("/ws/notes/assets/logo.png");

    const relative = await saveLocalImage(TARGET, "/photos/logo.png");

    expect(relative).toMatch(/^\.\/assets\/\d{8}-\d{6}-[0-9a-f]{8}\.png$/);
    expect(written).toHaveLength(1);
    expect(written[0]!.path).toMatch(/\/assets\/\d{8}-\d{6}-[0-9a-f]{8}\.png$/);
    expect(Array.from(written[0]!.bytes)).toEqual([1, 2, 3]);
  });

  it("copies nothing when the image already sits in ./assets/", async () => {
    put("/ws/notes/assets/already.png");

    const relative = await saveLocalImage(TARGET, "/ws/notes/assets/already.png");

    expect(relative).toBe("./assets/already.png");
    // Copying a file onto itself is a round trip through memory that can only
    // ever go wrong.
    expect(written).toEqual([]);
    expect(created).toEqual([]);
  });

  it("says so when the source cannot be read", async () => {
    await expect(saveLocalImage(TARGET, "/photos/missing.png")).rejects.toThrow(
      "no such file: /photos/missing.png",
    );
    expect(written).toEqual([]);
  });

  it("refuses when the document has no directory to put a copy beside", async () => {
    put("/photos/a.png");
    setPlatform({
      ...fakePlatform(),
      pathParent: () => null,
    });

    await expect(saveLocalImage(TARGET, "/photos/a.png")).rejects.toThrow(
      "No directory to place an image beside",
    );
    expect(written).toEqual([]);
  });
});
