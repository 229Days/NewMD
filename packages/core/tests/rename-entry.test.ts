/**
 * Renaming a file or folder, from the reader's point of view (ADR-0003 §2.2, §2.8).
 *
 * Four things have to happen, and the order between them is not a preference:
 *
 *   1. the open tabs' paths move;
 *   2. the file moves on disk;
 *   3. the tree's cached listings move;
 *   4. the references that pointed at it are rewritten.
 *
 * Step 1 before step 2 is the one with a failure mode. Autosave writes whatever
 * path a tab is holding, and the filesystem call underneath creates missing
 * parent folders — so a tab still pointing at the old path puts the file back
 * there on the next 800ms tick, and the rename quietly undoes itself. And step
 * 3 after step 2, because the listings it refreshes have to be read from a disk
 * the move has already happened on.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPlatform, setPlatform } from "../src/platform";
import type { FileEntry, PlatformAdapter, TextFile, WriteResult } from "../src/platform/types";
import { renameEntry } from "../src/rename";
import { useEditor } from "../src/stores/editor";
import { useWorkspace, visibleTree } from "../src/stores/workspace";

interface Disk {
  files: Map<string, string>;
  /** What the tabs pointed at each time the disk was asked to move something. */
  atMove: { from: string; to: string; tabs: (string | null)[]; onDisk: boolean }[];
  written: string[];
  /** Let the next `renamePath` refuse, the way a browser adapter always does. */
  failMove?: Error;
}

function fakeDisk(initial: Record<string, string>): { adapter: PlatformAdapter; disk: Disk } {
  const disk: Disk = { files: new Map(Object.entries(initial)), atMove: [], written: [] };
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
    listDir: async (dir) => childrenOf(dir),
    readTextFile: async (path): Promise<TextFile> => {
      const content = disk.files.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return { path, content, modifiedAt: 1 };
    },
    readBinaryFile: unused,
    writeTextFile: async (path, content): Promise<WriteResult> => {
      disk.written.push(path);
      disk.files.set(path, content);
      return { path, modifiedAt: 2 };
    },
    writeBinaryFile: unused,
    // The move itself, with the fake disk keeping up: everything at or under
    // `from` is now at or under `to`, which is what a real rename does and what
    // makes the listings worth re-reading afterwards.
    renamePath: async (from, to) => {
      disk.atMove.push({
        from,
        to,
        tabs: useEditor.getState().tabs.map((tab) => tab.path),
        onDisk: disk.files.has(from),
      });
      if (disk.failMove) throw disk.failMove;
      for (const path of [...disk.files.keys()]) {
        if (path !== from && !path.startsWith(`${from}/`)) continue;
        const content = disk.files.get(path)!;
        disk.files.delete(path);
        disk.files.set(to + path.slice(from.length), content);
      }
    },
    removePath: unused,
    pathExists: unused,
    createDir: unused,
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

const WORKSPACE: Record<string, string> = {
  "/ws/index.md": "# Index\n\n[a](./notes/a.md)\n",
  "/ws/notes/a.md": "# A\n",
  "/ws/notes/b.md": "# B\n",
};

describe("renaming an entry", () => {
  let disk: Disk;

  function open(initial: Record<string, string> = {}, on: Record<string, string> = {}): void {
    const fake = fakeDisk({ ...WORKSPACE, ...initial, ...on });
    disk = fake.disk;
    setPlatform(fake.adapter);
    useWorkspace.setState({ rootPath: "/ws", rootName: "ws", entries: {}, expanded: [] });
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  }

  beforeEach(() => open());

  afterEach(() => {
    resetPlatform();
    useWorkspace.setState({ rootPath: null, rootName: null, entries: {}, expanded: [] });
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  });

  it("moves the tab's path before it moves the file", async () => {
    await useEditor.getState().openPath("/ws/notes/a.md");

    await renameEntry("/ws/notes/a.md", "/ws/notes/renamed.md");

    expect(disk.atMove).toEqual([
      {
        from: "/ws/notes/a.md",
        to: "/ws/notes/renamed.md",
        tabs: ["/ws/notes/renamed.md"],
        onDisk: true,
      },
    ]);
  });

  it("keeps the reader in the document, edits and all", async () => {
    await useEditor.getState().openPath("/ws/notes/a.md");
    useEditor.getState().updateContent("# A\n\nan edit that was never saved\n");

    await renameEntry("/ws/notes/a.md", "/ws/notes/renamed.md");

    const tab = useEditor.getState().tabs[0]!;
    expect(tab.path).toBe("/ws/notes/renamed.md");
    expect(tab.fileName).toBe("renamed.md");
    expect(tab.content).toBe("# A\n\nan edit that was never saved\n");
    expect(useEditor.getState().activeIndex).toBe(0);
    expect(useEditor.getState().doc?.path).toBe("/ws/notes/renamed.md");
  });

  it("carries every tab under a folder that moved", async () => {
    await useEditor.getState().openPath("/ws/notes/a.md");
    await useEditor.getState().openPath("/ws/notes/b.md");

    await renameEntry("/ws/notes", "/ws/posts");

    expect(useEditor.getState().tabs.map((tab) => tab.path)).toEqual([
      "/ws/posts/a.md",
      "/ws/posts/b.md",
    ]);
    // A new folder name is not a new file name.
    expect(useEditor.getState().tabs.map((tab) => tab.fileName)).toEqual(["a.md", "b.md"]);
  });

  it("leaves a document the move did not reach where it is", async () => {
    await useEditor.getState().openPath("/ws/index.md");

    await renameEntry("/ws/notes/a.md", "/ws/notes/renamed.md");

    expect(useEditor.getState().tabs[0]!.path).toBe("/ws/index.md");
  });

  it("puts the tabs back when the disk refuses the move", async () => {
    // The move can fail for reasons that are not the reader's: another volume,
    // a name taken between the check and the call, a browser adapter that has
    // no rename at all. The tabs are the only thing that moved by then, and a
    // tab left on a path that does not exist writes the file back into being.
    await useEditor.getState().openPath("/ws/notes/a.md");
    disk.failMove = new Error("the disk said no");

    await expect(renameEntry("/ws/notes/a.md", "/ws/notes/renamed.md")).rejects.toThrow(
      "the disk said no",
    );

    expect(useEditor.getState().tabs[0]!.path).toBe("/ws/notes/a.md");
    expect(disk.files.has("/ws/notes/a.md")).toBe(true);
    expect(disk.written).toEqual([]);
  });

  it("follows the recent list", async () => {
    await useEditor.getState().openPath("/ws/notes/a.md");

    await renameEntry("/ws/notes/a.md", "/ws/notes/renamed.md");

    expect(useEditor.getState().recent[0]).toMatchObject({
      path: "/ws/notes/renamed.md",
      name: "renamed.md",
    });
  });

  it("moves the tree's cached listings with a folder", async () => {
    useWorkspace.setState({
      entries: {
        "/ws": [
          { path: "/ws/index.md", name: "index.md", kind: "file" },
          { path: "/ws/notes", name: "notes", kind: "dir" },
        ],
        "/ws/notes": [
          { path: "/ws/notes/a.md", name: "a.md", kind: "file" },
          { path: "/ws/notes/b.md", name: "b.md", kind: "file" },
        ],
      },
      expanded: ["/ws/notes"],
    });

    await renameEntry("/ws/notes", "/ws/posts");

    const { entries, expanded, rootPath } = useWorkspace.getState();
    expect(Object.keys(entries).sort()).toEqual(["/ws", "/ws/posts"]);
    // The listing under the folder came along, and its rows point where the
    // files are now — a stale path there is a row that opens nothing.
    expect(entries["/ws/posts"]!.map((entry) => entry.path)).toEqual([
      "/ws/posts/a.md",
      "/ws/posts/b.md",
    ]);
    expect(expanded).toEqual(["/ws/posts"]);
    // And the folder it left was re-read, so the name on its row is the new one.
    // Relocating the keys alone would leave that row claiming to be `notes`.
    expect(entries["/ws"]!.map((entry) => entry.path)).toEqual(["/ws/index.md", "/ws/posts"]);
    expect(entries["/ws"]!.map((entry) => entry.name)).toEqual(["index.md", "posts"]);
    expect(visibleTree(entries, expanded, rootPath).map((row) => row.path)).toEqual([
      "/ws/posts",
      "/ws/posts/a.md",
      "/ws/posts/b.md",
      "/ws/index.md",
    ]);
  });

  it("rewrites the references that pointed at it", async () => {
    const report = await renameEntry("/ws/notes/a.md", "/ws/notes/renamed.md");

    expect(disk.files.get("/ws/index.md")).toBe("# Index\n\n[a](./notes/renamed.md)\n");
    expect(report).toEqual({ documents: 1, rewritten: 1, unrewritten: 0 });
  });
});
