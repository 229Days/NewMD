/**
 * Renaming a file or folder from the tree (ADR-0003 §2.3, §2.10).
 *
 * The rewrite underneath is tested in core. What is only testable here is the
 * way a reader reaches it, and the four ways that goes wrong:
 *
 *   - the row opens instead of renaming. A click on a file row already means
 *     "open it", so a rename bound to the same event is a rename nobody can
 *     reach — or, worse, one that fires every time a document is opened;
 *   - a name that cannot be taken is taken anyway. `rename(2)` replaces the
 *     destination on POSIX, so a refusal that never happens is a file gone;
 *   - Escape leaves the name changed. The field is the reader's way out of a
 *     typo, and one that commits on the way out is not an escape;
 *   - a case-only rename is read as a collision with itself, which is what a
 *     case-insensitive filesystem would say about `a.md` → `A.md` if the row
 *     being renamed were not recognised as the row being renamed.
 */
// @vitest-environment jsdom
import {
  DEFAULT_SETTINGS,
  initI18n,
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
  resetI18n,
  resetPlatform,
  setPlatform,
  t,
  useEditor,
  useSettings,
  useUi,
  useWorkspace,
} from "@newmd/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sidebar } from "../src/components/Sidebar";
import { fakePlatform } from "./helpers/platform";

interface Move {
  from: string;
  to: string;
}

let files: Map<string, string>;
let moves: Move[];
let written: string[];

function installPlatform(): void {
  setPlatform({
    ...fakePlatform(),
    listDir: async (dir) => {
      const found = new Map<string, { path: string; name: string; kind: "file" | "dir" }>();
      for (const path of files.keys()) {
        if (!path.startsWith(`${dir}/`)) continue;
        const rest = path.slice(dir.length + 1);
        const cut = rest.indexOf("/");
        const name = cut < 0 ? rest : rest.slice(0, cut);
        const child = `${dir}/${name}`;
        found.set(child, { path: child, name, kind: cut < 0 ? "file" : "dir" });
      }
      return [...found.values()];
    },
    readTextFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return { path, content, modifiedAt: 1 };
    },
    writeTextFile: async (path, content) => {
      written.push(path);
      files.set(path, content);
      return { path, modifiedAt: 2 };
    },
    renamePath: async (from, to) => {
      moves.push({ from, to });
      for (const path of [...files.keys()]) {
        if (path !== from && !path.startsWith(`${from}/`)) continue;
        const content = files.get(path)!;
        files.delete(path);
        files.set(to + path.slice(from.length), content);
      }
    },
    // The real arithmetic, so the paths the tree computes are the ones core's
    // own tests compute.
    pathJoin,
    pathParent,
    pathFileName,
    pathExtension,
  });
}

/** The listing the sidebar was given; the fake disk holds the same files. */
function showTree(): void {
  useWorkspace.setState({
    rootPath: "/ws",
    rootName: "ws",
    entries: {
      "/ws": [
        { path: "/ws/notes", name: "notes", kind: "dir" },
        { path: "/ws/index.md", name: "index.md", kind: "file" },
      ],
      "/ws/notes": [
        { path: "/ws/notes/a.md", name: "a.md", kind: "file" },
        { path: "/ws/notes/b.md", name: "b.md", kind: "file" },
      ],
    },
    expanded: ["/ws/notes"],
    loading: false,
  });
}

/**
 * The row button for an entry, by the name it shows.
 *
 * Scoped to the tree, because a document that is open is in the recents list
 * under the same name — the other button with that label is a different thing.
 */
function row(name: string): HTMLElement {
  return within(screen.getByRole("list", { name: t("sidebar.filesIn", { name: "ws" }) })).getByRole(
    "button",
    { name },
  );
}

/** Double-click a row, type a new name, and press Enter. */
async function renameTo(name: string, next: string): Promise<void> {
  fireEvent.doubleClick(row(name));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: next } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

beforeEach(async () => {
  files = new Map([
    ["/ws/index.md", "# Index\n\n[a](./notes/a.md)\n"],
    ["/ws/notes/a.md", "# A\n"],
    ["/ws/notes/b.md", "# B\n"],
  ]);
  moves = [];
  written = [];
  await initI18n();
  installPlatform();
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
  useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  useUi.setState({ busy: false, toast: null, reveal: null, imageInsert: null });
  showTree();
  render(<Sidebar />);
});

afterEach(() => {
  cleanup();
  resetI18n();
  resetPlatform();
  useWorkspace.setState({ rootPath: null, rootName: null, entries: {}, expanded: [] });
  useUi.setState({ toast: null, busy: false });
});

describe("renaming from the file tree", () => {
  it("turns the row into a field holding the name it has", () => {
    fireEvent.doubleClick(row("a.md"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("a.md");
    // The row itself is gone: two places to read the same name is how they come
    // to disagree, and the reader is being asked about one of them.
    expect(screen.queryByRole("button", { name: "a.md" })).toBeNull();
  });

  it("still opens a document on a single click", () => {
    // The rename must not have taken the click that already meant something.
    fireEvent.click(row("a.md"));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(moves).toEqual([]);
  });

  it("marks the row that was clicked, and only it", () => {
    // §2.3: the tree had no notion of a chosen row, because a click already
    // meant "open". It needs one now — a rename is about a row, not about
    // whatever happens to be in the editor.
    fireEvent.click(row("b.md"));

    expect(row("b.md").getAttribute("aria-current")).toBe("true");
    expect(row("a.md").getAttribute("aria-current")).toBeNull();
  });

  it("renames the file and names it in the confirmation", async () => {
    await renameTo("a.md", "c.md");

    expect(moves).toEqual([{ from: "/ws/notes/a.md", to: "/ws/notes/c.md" }]);
    expect(files.has("/ws/notes/c.md")).toBe(true);
    expect(useUi.getState().toast?.kind).toBe("success");
    // The link in `index.md` was respelled, and the reader is told: a rename
    // that silently edited three other files is the thing they would want to
    // know about. `count` is in the message, which is why this is the exact key.
    expect(useUi.getState().toast?.message).toBe(
      t("actions.renamedWithLinks", { name: "c.md", count: 1 }),
    );
  });

  it("says only that it was renamed when nothing pointed at it", async () => {
    await renameTo("b.md", "d.md");

    expect(useUi.getState().toast?.message).toBe(t("actions.renamed", { name: "d.md" }));
  });

  it("refuses a name taken by a file the tree has not seen", async () => {
    // The tree's listing is a cache. Judging the name against it would hand a
    // taken name to the filesystem, and on POSIX that replaces the file it
    // lands on — so the folder is read again before the name is decided.
    files.set("/ws/notes/e.md", "# E\n");

    await renameTo("a.md", "e.md");

    expect(moves).toEqual([]);
    expect(files.get("/ws/notes/e.md")).toBe("# E\n");
    expect(useUi.getState().toast?.message).toBe(t("sidebar.renameTaken", { name: "e.md" }));
  });

  it("gives up when the field loses focus", async () => {
    fireEvent.doubleClick(row("a.md"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "c.md" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(moves).toEqual([]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(row("a.md")).toBeTruthy();
  });

  it("rewrites the references that pointed at it", async () => {
    await renameTo("a.md", "c.md");

    expect(files.get("/ws/index.md")).toBe("# Index\n\n[a](./notes/c.md)\n");
  });

  it("renames a folder too", async () => {
    await renameTo("notes", "posts");

    expect(moves).toEqual([{ from: "/ws/notes", to: "/ws/posts" }]);
    expect(files.has("/ws/posts/a.md")).toBe(true);
  });

  it("keeps the field open and says why when the name is taken", async () => {
    await renameTo("a.md", "b.md");

    expect(moves).toEqual([]);
    expect(useUi.getState().toast?.kind).toBe("error");
    expect(useUi.getState().toast?.message).toBe(t("sidebar.renameTaken", { name: "b.md" }));
    // Still there to be corrected: the reader's next keystroke is a fix, not a
    // second attempt at opening the field.
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("b.md");
  });

  it("refuses a name that is only whitespace without touching the disk", async () => {
    await renameTo("a.md", "   ");

    expect(moves).toEqual([]);
    expect(useUi.getState().toast?.message).toBe(t("sidebar.renameEmpty"));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("   ");
  });

  it("refuses a name that would move the file into another folder", async () => {
    // §2.2 keeps moving out of this slice, and a field that quietly performed
    // one would be doing more than it said on the tin.
    await renameTo("a.md", "sub/c.md");

    expect(moves).toEqual([]);
    expect(useUi.getState().toast?.message).toBe(t("sidebar.renameSeparator"));
  });

  it("lets a name change nothing but its case", async () => {
    await renameTo("a.md", "A.md");

    expect(moves).toEqual([{ from: "/ws/notes/a.md", to: "/ws/notes/A.md" }]);
  });

  it("gives up on Escape without renaming", async () => {
    fireEvent.doubleClick(row("a.md"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "c.md" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(moves).toEqual([]);
    expect(screen.getByRole("button", { name: "a.md" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps the editor on the document it was showing, under its new path", async () => {
    // The pane is where the reader notices: a tab left on the old path saves
    // the file back into existence on the next autosave tick.
    await act(async () => {
      await useEditor.getState().openPath("/ws/notes/a.md");
    });

    await renameTo("a.md", "c.md");

    await waitFor(() => {
      expect(useEditor.getState().tabs[0]?.path).toBe("/ws/notes/c.md");
    });
  });
});
