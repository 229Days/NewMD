/**
 * Landing a rename's consequences on every document it reached (ADR-0003 §2.8, §2.9).
 *
 * `reference-rewrite` says what one document's text becomes. This is the part
 * that decides *which* documents there are, and — the part with teeth — how
 * each one is written back. An open document has an in-memory text that is
 * newer than its file, so going to disk for it would rewrite the wrong text and
 * save a version the reader never wrote; writing it back at all would throw
 * away edits that were never saved. An unopened document has no memory to
 * prefer, and has to be read and written.
 *
 * Every file in the workspace gets read, which is the cost §2.9 accepts. What
 * it must not do is read things that are not the reader's documents.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPlatform, setPlatform } from "../src/platform";
import type { FileEntry, PlatformAdapter, TextFile, WriteResult } from "../src/platform/types";
import { rewriteAfterRename } from "../src/rename";
import { useEditor } from "../src/stores/editor";
import { useWorkspace } from "../src/stores/workspace";
import { isDocumentDirty } from "../src/types";

interface Disk {
  /** Text at each path. */
  files: Map<string, string>;
  /** Every directory the scan asked about. */
  listed: string[];
  /** Every file whose text was read. */
  read: string[];
  /** Every file written back, in order. */
  written: string[];
}

/**
 * A disk made of the paths it holds.
 *
 * Directories are derived rather than declared, so a file at
 * `/ws/node_modules/x/a.md` makes `node_modules` and `node_modules/x` exist
 * without the test having to say so.
 */
function fakeDisk(initial: Record<string, string>): { adapter: PlatformAdapter; disk: Disk } {
  const disk: Disk = {
    files: new Map(Object.entries(initial)),
    listed: [],
    read: [],
    written: [],
  };
  const unused = (): never => {
    throw new Error("not used by this test");
  };

  const childrenOf = (dir: string): FileEntry[] => {
    const found = new Map<string, FileEntry>();
    for (const path of disk.files.keys()) {
      if (!path.startsWith(`${dir}/`)) continue;
      const rest = path.slice(dir.length + 1);
      const cut = rest.indexOf("/");
      const name = cut < 0 ? rest : rest.slice(0, cut);
      const child = `${dir}/${name}`;
      found.set(child, { path: child, name, kind: cut < 0 ? "file" : "dir" });
    }
    return [...found.values()];
  };

  const adapter: PlatformAdapter = {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: async (dir) => {
      disk.listed.push(dir);
      return childrenOf(dir);
    },
    readTextFile: async (path): Promise<TextFile> => {
      const content = disk.files.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      disk.read.push(path);
      return { path, content, modifiedAt: 1 };
    },
    readBinaryFile: unused,
    writeTextFile: async (path, content): Promise<WriteResult> => {
      disk.written.push(path);
      disk.files.set(path, content);
      return { path, modifiedAt: 2 };
    },
    writeBinaryFile: unused,
    createDir: unused,
    renamePath: unused,
    removePath: unused,
    pathExists: unused,
    pathJoin: (base, relative) => `${base.replace(/[\\/]+$/, "")}/${relative}`,
    pathParent: (path) => path.slice(0, path.lastIndexOf("/")) || null,
    pathFileName: (path) => path.slice(path.lastIndexOf("/") + 1),
    pathExtension: (path) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      const dot = name.lastIndexOf(".");
      return dot > 0 ? name.slice(dot + 1) : null;
    },
    readAppData: async () => null,
    writeAppData: async () => undefined,
    deleteAppData: async () => undefined,
  };
  return { adapter, disk };
}

/** A workspace with one document that links to the file about to move. */
const WORKSPACE: Record<string, string> = {
  "/ws/index.md": "# Index\n\n[a](./notes/a.md)\n",
  "/ws/notes/a.md": "# A\n\n![x](./assets/x.png)\n",
  "/ws/notes/assets/x.png": "not really a png",
  "/ws/notes/other.md": "# Other\n",
};

describe("rewriting the workspace after a rename", () => {
  let disk: Disk;

  function open(on: Record<string, string>): void {
    const fake = fakeDisk({ ...WORKSPACE, ...on });
    disk = fake.disk;
    setPlatform(fake.adapter);
    useWorkspace.setState({ rootPath: "/ws", rootName: "ws", entries: {}, expanded: [] });
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  }

  beforeEach(() => open({}));

  afterEach(() => {
    resetPlatform();
    useWorkspace.setState({ rootPath: null, rootName: null, entries: {}, expanded: [] });
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  });

  it("rewrites a document it never had to open", async () => {
    const report = await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    expect(disk.files.get("/ws/index.md")).toBe("# Index\n\n[a](./notes/sub/a.md)\n");
    expect(disk.written).toEqual(["/ws/index.md"]);
    expect(report).toEqual({ documents: 1, rewritten: 1, unrewritten: 0 });
  });

  it("does not write a document that had nothing to say about it", async () => {
    await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    expect(disk.written).not.toContain("/ws/notes/other.md");
  });

  it("respells the links of the document that moved", async () => {
    // The scan runs after the file has landed (ADR-0003 §2.8's order), so the
    // moved document is found at its new path — which is also the only path
    // from which its own relative links resolve correctly: it must be read as
    // living in `notes/sub/`, not in `notes/`.
    const text = disk.files.get("/ws/notes/a.md")!;
    disk.files.delete("/ws/notes/a.md");
    disk.files.set("/ws/notes/sub/a.md", text);

    const report = await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    expect(disk.files.get("/ws/notes/sub/a.md")).toBe("# A\n\n![x](../assets/x.png)\n");
    expect(report.documents).toBe(2);
  });

  it("patches an open document in memory and leaves it dirty", async () => {
    await useEditor.getState().openPath("/ws/index.md");
    disk.read.length = 0;

    const report = await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    const tab = useEditor.getState().tabs[0]!;
    expect(tab.content).toBe("# Index\n\n[a](./notes/sub/a.md)\n");
    expect(tab.savedContent).toBe("# Index\n\n[a](./notes/a.md)\n");
    expect(isDocumentDirty(tab)).toBe(true);
    // The disk copy is the reader's to overwrite, on their save and their terms.
    expect(disk.files.get("/ws/index.md")).toBe("# Index\n\n[a](./notes/a.md)\n");
    expect(disk.written).not.toContain("/ws/index.md");
    expect(report).toEqual({ documents: 1, rewritten: 1, unrewritten: 0 });
  });

  it("rewrites what the open document says now, not what its file says", async () => {
    // An unsaved edit is the reader's current text. Reading the file instead
    // would rewrite a version they no longer have and hand it back to them.
    await useEditor.getState().openPath("/ws/index.md");
    useEditor.getState().updateContent("# Index\n\n[a](./notes/a.md) edited\n");
    disk.read.length = 0;

    await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    expect(useEditor.getState().tabs[0]!.content).toBe("# Index\n\n[a](./notes/sub/a.md) edited\n");
    expect(disk.read).not.toContain("/ws/index.md");
  });

  it("reaches an open document from outside the workspace", async () => {
    // The links that break are the ones in the documents that were not being
    // looked at — and a note opened from outside this folder is one of those.
    open({ "/elsewhere/notes.md": "[a](../ws/notes/a.md)\n" });
    await useEditor.getState().openPath("/elsewhere/notes.md");
    disk.read.length = 0;

    const report = await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    expect(useEditor.getState().tabs[0]!.content).toBe("[a](../ws/notes/sub/a.md)\n");
    expect(disk.files.get("/elsewhere/notes.md")).toBe("[a](../ws/notes/a.md)\n");
    // Read through memory, not through the file it was opened from.
    expect(disk.read).not.toContain("/elsewhere/notes.md");
    expect(report).toEqual({ documents: 2, rewritten: 2, unrewritten: 0 });
  });

  it("reads nothing that is not a document of the reader's", async () => {
    open({
      "/ws/node_modules/pkg/readme.md": "[a](./notes/a.md)\n",
      "/ws/.git/COMMIT_EDITMSG": "[a](./notes/a.md)\n",
      "/ws/.notes/hidden.md": "[a](./notes/a.md)\n",
      "/ws/notes/a.txt": "[a](./a.md)\n",
    });

    await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    expect(disk.listed).not.toContain("/ws/node_modules");
    expect(disk.listed).not.toContain("/ws/.git");
    expect(disk.listed).not.toContain("/ws/.notes");
    expect(disk.read).not.toContain("/ws/notes/a.txt");
  });

  it("counts what it could not rewrite and leaves the document alone", async () => {
    // Another drive: the link is left exactly as it was, and the count is what
    // the reader gets instead of a wrong link.
    const report = await rewriteAfterRename("/ws/notes/a.md", "D:/elsewhere/a.md");

    expect(disk.written).toEqual([]);
    expect(report).toEqual({ documents: 0, rewritten: 0, unrewritten: 1 });
  });

  it("touches nothing when no workspace is open and no tab refers to it", async () => {
    useWorkspace.setState({ rootPath: null });

    const report = await rewriteAfterRename("/ws/notes/a.md", "/ws/notes/sub/a.md");

    expect(disk.read).toEqual([]);
    expect(report).toEqual({ documents: 0, rewritten: 0, unrewritten: 0 });
  });
});
