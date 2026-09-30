import { create } from "zustand";
import { getPlatform } from "../platform";
import type { JsonValue } from "../platform/types";
import {
  applyNewlines,
  detectLineEnding,
  isDocumentDirty,
  MAX_RECENT_ENTRIES,
  normalizeNewlines,
  type OpenDocument,
  type RecentEntry,
} from "../types";

const RECENT_KEY = "recent";

let untitledSeq = 0;

function makeUntitled(): OpenDocument {
  untitledSeq += 1;
  return {
    path: null,
    fileName: untitledSeq === 1 ? "Untitled.md" : `Untitled-${untitledSeq}.md`,
    content: "",
    savedContent: "",
    // New files are written with LF; the setting lands in M4.
    lineEnding: "\n",
    modifiedAt: null,
  };
}

export interface EditorState {
  /** Every open document, in tab order. This is the truth (ADR-0001 §4 M3). */
  tabs: OpenDocument[];
  /** Which tab is showing. `-1` when no tab is open. */
  activeIndex: number;
  /**
   * The active document — exactly `tabs[activeIndex]`, or null.
   *
   * A mirror rather than a second source of truth, so the twenty-odd readers of
   * "what is open" keep working untouched. Every writer here goes through
   * `commit`, which publishes both fields together: they cannot disagree unless
   * someone calls `setState` behind this module's back.
   */
  doc: OpenDocument | null;
  recent: RecentEntry[];

  /**
   * Open a file from disk in its own tab.
   *
   * A path that is already open focuses the tab it is in rather than opening a
   * second copy of it: two tabs on one file is two buffers that disagree about
   * what the file says, and the last save wins.
   */
  openPath(path: string): Promise<void>;
  /** Open a new untitled tab and make it active. */
  newDocument(): void;
  /** Show the tab at `index`, leaving the others exactly as they are. */
  setActive(index: number): void;
  /** Close the tab at `index`, leaving the others exactly as they are. */
  closeTab(index: number): void;
  updateContent(content: string): void;
  /** Persist the active tab, asking for a path only when it has none. */
  save(): Promise<boolean>;
  /** Pick a path and persist. Returns false if the dialog was cancelled. */
  saveAs(defaultName?: string): Promise<boolean>;
  /** Persist the tab at `index`, wherever the reader happens to be looking. */
  saveTab(index: number): Promise<boolean>;
  /** Close the active tab. */
  close(): void;
  /** Re-read the active tab from disk, discarding edits. */
  reloadFromDisk(): Promise<void>;
  loadRecent(): Promise<void>;
  forgetRecent(path: string): Promise<void>;
}

type Set = (partial: Partial<EditorState>) => void;
type Get = () => EditorState;

/**
 * Publish a new tab list.
 *
 * The one place `doc` is written, so it always lands on `tabs[activeIndex]`
 * rather than near it. Index -1 is meaningful — no tab open — so it survives
 * the clamp instead of being folded into zero.
 */
function commit(set: Set, tabs: OpenDocument[], activeIndex: number): void {
  const at = tabs.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), tabs.length - 1);
  set({
    tabs,
    activeIndex: at,
    doc: at === -1 ? null : (tabs[at] ?? null),
  });
}

/**
 * `(path, fileName)` identifies a tab.
 *
 * Indexes are not identities: an await is enough for the user to close a tab
 * and move every later one, and a writer holding a captured index would then
 * edit whatever slid into its place. Paths are unique because `openPath` refuses
 * to duplicate one, and untitled buffers are unique by their numbered name — so
 * a document addressed this way still addresses the same document when the
 * writer finally lands.
 */
function sameTab(a: OpenDocument, b: OpenDocument): boolean {
  return a.path === b.path && a.fileName === b.fileName;
}

function replaceTab(
  tabs: OpenDocument[],
  target: OpenDocument,
  patch: Partial<OpenDocument>,
): OpenDocument[] {
  // First match only: after a `save as` onto a path another tab already holds,
  // the two would share a key, and patching every match would write the change
  // into a document that was not saved.
  const at = tabs.findIndex((tab) => sameTab(tab, target));
  const found = at === -1 ? undefined : tabs[at];
  if (!found) return tabs;
  const next = [...tabs];
  next[at] = { ...found, ...patch };
  return next;
}

/** The active document, if there is one. */
function activeTab(get: Get): OpenDocument | null {
  const { tabs, activeIndex } = get();
  return activeIndex < 0 ? null : (tabs[activeIndex] ?? null);
}

async function recordRecent(set: Set, get: Get, path: string, name: string): Promise<void> {
  const existing = get().recent.filter((e) => e.path !== path);
  const recent = [{ path, name, openedAt: Date.now() }, ...existing].slice(0, MAX_RECENT_ENTRIES);
  set({ recent });
  try {
    await getPlatform().writeAppData(RECENT_KEY, recent);
  } catch {
    // Recent list is a convenience; never fail the actual save over it.
  }
}

/**
 * Write one document out and clear its dirty flag.
 *
 * Works on the document rather than the active index, so a background tab can
 * be saved without the reader's view flicking over to it first. A document with
 * no path is asked for one — which is what `save` has always done for a buffer
 * that has never been written out.
 */
async function persistDoc(
  set: Set,
  get: Get,
  doc: OpenDocument | null,
  forceDialog: boolean,
  defaultName?: string,
): Promise<boolean> {
  if (!doc) return false;
  const platform = getPlatform();
  let path = doc.path;
  let fileName = doc.fileName;
  if (forceDialog || path === null) {
    const chosen = await platform.pickSavePath(defaultName ?? fileName, [
      { name: "Markdown", extensions: ["md", "markdown"] },
    ]);
    if (!chosen) return false;
    path = chosen;
    fileName = platform.pathFileName(chosen) ?? fileName;
  }

  // Captured before the write: what lands on disk is what was here when the
  // save was asked for, and an edit that arrives mid-write keeps the tab dirty.
  const written = doc.content;
  const result = await platform.writeTextFile(path, applyNewlines(written, doc.lineEnding));
  commit(
    set,
    replaceTab(get().tabs, doc, {
      path,
      fileName,
      savedContent: written,
      modifiedAt: result.modifiedAt,
    }),
    get().activeIndex,
  );
  await recordRecent(set, get, path, fileName);
  return true;
}

/**
 * Save the active tab, asking for a path only when it needs one.
 *
 * `save` keeps its own path and `saveAs` always asks. A buffer that has never
 * been saved has no path to keep, so `save` falls through to the dialog — which
 * is what it did before tabs existed, under the name `saveAs(doc.fileName)`.
 */
function persistActive(
  set: Set,
  get: Get,
  pickPath: boolean,
  defaultName?: string,
): Promise<boolean> {
  return persistDoc(set, get, activeTab(get), pickPath, defaultName);
}

export const useEditor = create<EditorState>()((set, get) => ({
  tabs: [],
  activeIndex: -1,
  doc: null,
  recent: [],

  async openPath(path) {
    const already = get().tabs.findIndex((tab) => tab.path === path);
    if (already >= 0) {
      commit(set, get().tabs, already);
      return;
    }

    const platform = getPlatform();
    const file = await platform.readTextFile(path);
    const fileName = platform.pathFileName(path) ?? path;
    const tabs = get().tabs;
    commit(
      set,
      [
        ...tabs,
        {
          path,
          fileName,
          content: normalizeNewlines(file.content),
          savedContent: normalizeNewlines(file.content),
          lineEnding: detectLineEnding(file.content),
          modifiedAt: file.modifiedAt,
        },
      ],
      tabs.length,
    );
    await recordRecent(set, get, path, fileName);
  },

  newDocument() {
    const tabs = get().tabs;
    commit(set, [...tabs, makeUntitled()], tabs.length);
  },

  setActive(index) {
    commit(set, get().tabs, index);
  },

  closeTab(index) {
    const { tabs, activeIndex } = get();
    if (index < 0 || index >= tabs.length) return;
    const next = tabs.filter((_, i) => i !== index);
    // Closing a tab that is not the active one must not disturb the active one.
    // Closing the active one hands focus to whatever is next to it — the tab
    // that slid into its place — and then to the one before, at the end.
    const nextActive =
      next.length === 0
        ? -1
        : index < activeIndex
          ? activeIndex - 1
          : Math.min(activeIndex, next.length - 1);
    commit(set, next, nextActive);
  },

  updateContent(content) {
    const doc = activeTab(get);
    if (!doc) return;
    const normalized = normalizeNewlines(content);
    if (doc.content === normalized) return;
    commit(set, replaceTab(get().tabs, doc, { content: normalized }), get().activeIndex);
  },

  async save() {
    return persistActive(set, get, false);
  },

  async saveAs(defaultName) {
    return persistActive(set, get, true, defaultName);
  },

  async saveTab(index) {
    return persistDoc(set, get, get().tabs[index] ?? null, false);
  },

  close() {
    get().closeTab(get().activeIndex);
  },

  async reloadFromDisk() {
    const doc = activeTab(get);
    if (!doc?.path) return;
    const file = await getPlatform().readTextFile(doc.path);
    const content = normalizeNewlines(file.content);
    commit(
      set,
      replaceTab(get().tabs, doc, {
        content,
        savedContent: content,
        lineEnding: detectLineEnding(file.content),
        modifiedAt: file.modifiedAt,
      }),
      get().activeIndex,
    );
  },

  async loadRecent() {
    try {
      const stored = await getPlatform().readAppData(RECENT_KEY);
      if (!Array.isArray(stored)) {
        set({ recent: [] });
        return;
      }
      const recent = stored
        .filter((e): e is RecentEntry => {
          const rec = e as Partial<RecentEntry> | null;
          return (
            typeof rec?.path === "string" &&
            typeof rec?.name === "string" &&
            typeof rec?.openedAt === "number"
          );
        })
        .slice(0, MAX_RECENT_ENTRIES);
      set({ recent });
    } catch {
      // A bad recent list is not worth failing startup over.
      set({ recent: [] });
    }
  },

  async forgetRecent(path) {
    const recent = get().recent.filter((e) => e.path !== path);
    set({ recent });
    await getPlatform().writeAppData(RECENT_KEY, recent);
  },
}));

/** Convenience selector: is the active buffer modified but unsaved? */
export function useIsDirty(): boolean {
  return useEditor((s) => isDocumentDirty(s.doc));
}

/**
 * Is any open tab modified but unsaved?
 *
 * This is the one that gates quitting and closing the window. The active tab is
 * the one the reader can see; the others are the ones they have forgotten they
 * edited, which is exactly where losing work happens.
 */
export function useAnyDirty(): boolean {
  return useEditor((s) => s.tabs.some(isDocumentDirty));
}

/** `useAnyDirty`, for callers that are not a component. */
export function anyDocumentDirty(): boolean {
  return useEditor.getState().tabs.some(isDocumentDirty);
}

/** Persist every dirty tab that has a path. Used by autosave. */
export async function saveAllDirty(): Promise<void> {
  // The list is copied first: each write publishes a new array, and iterating
  // the live one would skip the tab after every save.
  for (const tab of [...useEditor.getState().tabs]) {
    if (!tab.path || !isDocumentDirty(tab)) continue;
    await persistDoc(useEditor.setState, useEditor.getState, tab, false);
  }
}
