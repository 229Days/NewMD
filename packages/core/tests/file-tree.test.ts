/**
 * The workspace as a tree (ADR-0001 §4 M4: 文件树).
 *
 * M1 listed the markdown files sitting in the workspace root, flat. That is not
 * a smaller version of a tree — it is a different thing, and in a real
 * workspace the notes are one or two directories down where a flat list cannot
 * see them.
 *
 * Two choices are pinned here, because both break on a large folder if they are
 * left to the renderer:
 *
 *   - **read a directory when it opens, not when the workspace does.** Walking
 *     the whole tree up front turns "open this folder" into a scan of every
 *     file the reader owns, and the sidebar is not worth that wait.
 *   - **remember what was read.** Collapsing and reopening a folder is what
 *     people do while hunting for something; doing that against the disk every
 *     time makes the sidebar feel like it is reloading at them.
 *
 * The rows themselves are derived rather than stored, so what the panel shows
 * is a pure function of (what each directory holds, which are open).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetPlatform, setPlatform } from "../src/platform";
import type { FileEntry, JsonValue, PlatformAdapter } from "../src/platform/types";
import { useWorkspace, visibleTree, type TreeRow } from "../src/stores/workspace";

const ROOT = "/workspace";

/** A workspace with the shape a flat list gets wrong. */
function layout(): Map<string, FileEntry[]> {
  const dir = (path: string, name: string): FileEntry => ({ path, name, kind: "dir" });
  const file = (path: string, name: string): FileEntry => ({ path, name, kind: "file" });
  return new Map<string, FileEntry[]>([
    [
      ROOT,
      [
        dir(`${ROOT}/notes`, "notes"),
        dir(`${ROOT}/other`, "other"),
        file(`${ROOT}/b.md`, "b.md"),
        file(`${ROOT}/skip.txt`, "skip.txt"),
      ],
    ],
    [`${ROOT}/notes`, [file(`${ROOT}/notes/a.md`, "a.md"), dir(`${ROOT}/notes/deep`, "deep")]],
    [`${ROOT}/notes/deep`, [file(`${ROOT}/notes/deep/d.md`, "d.md")]],
    [`${ROOT}/other`, []],
  ]);
}

function fakePlatform(dirs: Map<string, FileEntry[]>): {
  adapter: PlatformAdapter;
  listed: string[];
} {
  const listed: string[] = [];
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  const adapter: PlatformAdapter = {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: async (path) => {
      listed.push(path);
      return dirs.get(path) ?? [];
    },
    readTextFile: unused,
    writeTextFile: unused,
    createDir: unused,
    renamePath: unused,
    removePath: unused,
    pathExists: async (path) => dirs.has(path),
    pathJoin: (a, b) => `${a}/${b}`,
    pathParent: (p) => p.slice(0, p.lastIndexOf("/")),
    pathFileName: (p) => p.slice(p.lastIndexOf("/") + 1),
    pathExtension: unused,
    readAppData: async (): Promise<JsonValue | null> => null,
    writeAppData: async () => {},
    deleteAppData: async () => {},
  };
  return { adapter, listed };
}

/** What the sidebar would render, as rows in order. */
function rows(): TreeRow[] {
  const { entries, expanded, rootPath } = useWorkspace.getState();
  return visibleTree(entries, expanded, rootPath);
}

function names(): string[] {
  return rows().map((row) => row.name);
}

describe("the workspace file tree", () => {
  let dirs: Map<string, FileEntry[]>;
  let listed: string[];

  beforeEach(async () => {
    dirs = layout();
    const fake = fakePlatform(dirs);
    listed = fake.listed;
    setPlatform(fake.adapter);
    useWorkspace.setState({
      rootPath: null,
      rootName: null,
      entries: {},
      expanded: [],
      loading: false,
    });
    await useWorkspace.getState().openRoot(ROOT);
  });

  it("shows folders before files, and leaves other files out", () => {
    expect(names()).toEqual(["notes", "other", "b.md"]);
  });

  it("keeps a folder shut until it is asked to open", () => {
    expect(names()).not.toContain("a.md");
    expect(names()).not.toContain("d.md");
  });

  it("reads a folder only when it is opened", async () => {
    // One listing — the root. Walking `notes` and `other` up front is the cost
    // this design exists to avoid.
    expect(listed).toEqual([ROOT]);

    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);

    expect(listed).toEqual([ROOT, `${ROOT}/notes`]);
    expect(names()).toContain("a.md");
  });

  it("remembers a folder it has already read across a collapse", async () => {
    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);
    expect(names()).toContain("a.md");

    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);
    expect(names()).not.toContain("a.md");

    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);
    expect(names()).toContain("a.md");
    // Twice in total, once per directory: collapsing is a view change, not a
    // reason to go back to the disk.
    expect(listed).toEqual([ROOT, `${ROOT}/notes`]);
  });

  it("nests to whatever depth the folder has", async () => {
    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);
    await useWorkspace.getState().toggleDir(`${ROOT}/notes/deep`);

    expect(rows().map((row) => [row.name, row.depth])).toEqual([
      ["notes", 0],
      ["deep", 1],
      ["d.md", 2],
      ["a.md", 1],
      ["other", 0],
      ["b.md", 0],
    ]);
  });

  it("picks up new files in open and shut folders when refreshed", async () => {
    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);
    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);
    dirs.get(ROOT)?.push({ path: `${ROOT}/c.md`, name: "c.md", kind: "file" });
    dirs.get(`${ROOT}/notes`)?.push({
      path: `${ROOT}/notes/new.md`,
      name: "new.md",
      kind: "file",
    });

    await useWorkspace.getState().refresh();

    expect(names()).toContain("c.md");
    // The folder is collapsed, so the new file is not on screen — but reopening
    // it must not serve the listing that predates the refresh.
    expect(names()).not.toContain("new.md");
    await useWorkspace.getState().toggleDir(`${ROOT}/notes`);
    expect(names()).toContain("new.md");
  });
});
