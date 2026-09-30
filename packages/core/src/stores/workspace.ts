import { create } from "zustand";
import { getPlatform } from "../platform";
import { isMarkdownFile, type FileEntry } from "../types";
import { useEditor } from "./editor";

/** One row the sidebar renders: an entry, plus how far in it sits. */
export type TreeRow = {
  path: string;
  name: string;
  kind: "dir" | "file";
  depth: number;
};

/**
 * What is worth showing: every folder, and the files this editor can open.
 *
 * Folders are kept unconditionally because that is how the reader navigates —
 * a folder with no markdown in it yet is still where the markdown is going to
 * land. Non-markdown files are dropped at the door rather than filtered at
 * render, so the tree holds no rows nobody can click.
 */
function usable(entries: FileEntry[]): FileEntry[] {
  return entries.filter((entry) => entry.kind === "dir" || isMarkdownFile(entry.name));
}

/**
 * Folders first, then files, each group alphabetically.
 *
 * Ordering is applied when the rows are derived rather than when they are
 * read, so a refresh does not have to re-sort anything and the tree reads the
 * same way no matter what order the platform happened to return.
 */
function ordered(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
}

/**
 * Flatten the tree into the rows that should be on screen.
 *
 * Derived rather than stored: what the sidebar shows is a function of (what
 * each directory holds, which are open), and keeping it in two places is how a
 * tree and its state come to disagree. A directory with no entry has never been
 * read, so it contributes nothing — which is what makes the on-demand listing
 * below work without a separate "loading" flag per folder.
 */
export function visibleTree(
  entries: Record<string, FileEntry[]>,
  expanded: readonly string[],
  rootPath: string | null,
): TreeRow[] {
  if (rootPath === null) return [];
  const rows: TreeRow[] = [];
  const open = new Set(expanded);

  const walk = (dirPath: string, depth: number): void => {
    const children = entries[dirPath];
    if (children === undefined) return;
    for (const entry of ordered(usable(children))) {
      rows.push({ path: entry.path, name: entry.name, kind: entry.kind, depth });
      if (entry.kind === "dir" && open.has(entry.path)) walk(entry.path, depth + 1);
    }
  };

  walk(rootPath, 0);
  return rows;
}

export interface WorkspaceState {
  /** Absolute path of the open folder, or null when no workspace is open. */
  rootPath: string | null;
  rootName: string | null;
  /**
   * Directory contents by absolute path. A path that is absent has never been
   * read — which is the point: opening a workspace lists its root, not every
   * folder underneath it (ADR-0001 §4 M4: 文件树).
   */
  entries: Record<string, FileEntry[]>;
  /** Directories whose children are showing. The root is walked regardless. */
  expanded: string[];
  loading: boolean;

  /** Native folder picker + load. Returns false if the user cancelled. */
  pickAndOpen(): Promise<boolean>;
  /** Open a known folder path (used when restoring a session). */
  openRoot(path: string): Promise<void>;
  /** Re-read every directory the tree is holding, so new files show up. */
  refresh(): Promise<void>;
  close(): void;
  /** Open a file inside this workspace in the editor. */
  openFile(path: string): Promise<void>;
  /** Show a folder's children, or hide them again. Reads it on the first open. */
  toggleDir(path: string): Promise<void>;
}

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  rootPath: null,
  rootName: null,
  entries: {},
  expanded: [],
  loading: false,

  async pickAndOpen() {
    const platform = getPlatform();
    const path = await platform.pickFolder();
    if (!path) return false;
    await get().openRoot(path);
    return true;
  },

  async openRoot(path) {
    const platform = getPlatform();
    set({ loading: true, rootPath: path, rootName: platform.pathFileName(path) ?? path });
    try {
      const listed = await platform.listDir(path);
      set({ entries: { [path]: usable(listed) }, expanded: [], loading: false });
    } catch (err) {
      set({ entries: {}, expanded: [], loading: false, rootPath: null, rootName: null });
      throw err;
    }
  },

  async refresh() {
    const { rootPath, entries } = get();
    if (rootPath === null) return;
    const platform = getPlatform();
    const fresh: Record<string, FileEntry[]> = {};
    // Every directory the tree is holding, open or shut. Reopening one is served
    // from this cache, so a directory left stale here would stay stale for as
    // long as the reader did not expand it.
    for (const dirPath of Object.keys(entries)) {
      try {
        fresh[dirPath] = usable(await platform.listDir(dirPath));
      } catch {
        // Gone from under us: drop it rather than keep serving a listing that
        // no longer describes anything.
      }
    }
    set({ entries: fresh });
  },

  close() {
    set({ rootPath: null, rootName: null, entries: {}, expanded: [], loading: false });
  },

  async openFile(path) {
    await useEditor.getState().openPath(path);
  },

  async toggleDir(path) {
    const { entries, expanded } = get();

    if (expanded.includes(path)) {
      set({ expanded: expanded.filter((entry) => entry !== path) });
      return;
    }

    const next = [...expanded, path];
    // Marked open first: the row answers the click immediately, and a folder
    // with no entry yet simply contributes no children until it arrives.
    set({ expanded: next });
    if (entries[path] !== undefined) return;

    try {
      const listed = await getPlatform().listDir(path);
      set({ entries: { ...get().entries, [path]: usable(listed) } });
    } catch {
      // Unreadable or gone: put the row back the way it was rather than leave
      // it claiming to be open over an empty listing.
      set({ expanded: get().expanded.filter((entry) => entry !== path) });
    }
  },
}));
