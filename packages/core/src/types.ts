import { DEFAULT_HOTKEYS, type Hotkeys } from "./hotkeys";
import type { FileEntry } from "./platform/types";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type Locale = "zh-CN" | "en-US";

/*
 * Types that are written to the platform store are type aliases, not
 * interfaces: a type alias of an object literal gains the implicit index
 * signature that `JsonValue`'s object arm requires, so values can be handed to
 * the store without a cast.
 */
export type AppSettings = {
  theme: ThemePreference;
  locale: Locale;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  editorMaxWidth: number;
  /** The reader's own stylesheet, injected verbatim (ADR-0001 §2.11). */
  customCss: string;
  /** Which chord runs which command; defaults in `hotkeys.ts`. */
  hotkeys: Hotkeys;
  autoSave: boolean;
  /** Debounce window for autosave, in milliseconds. */
  autoSaveIntervalMs: number;
  showSidebar: boolean;
  showStatusBar: boolean;
  spellcheck: boolean;
  /** Where pasted images land, relative to the markdown file. */
  imageDirName: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  locale: "zh-CN",
  fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
  fontSize: 16,
  lineHeight: 1.75,
  editorMaxWidth: 820,
  customCss: "",
  hotkeys: DEFAULT_HOTKEYS,
  autoSave: true,
  autoSaveIntervalMs: 800,
  showSidebar: true,
  showStatusBar: true,
  spellcheck: true,
  imageDirName: "assets",
};

export type LineEnding = "\n" | "\r\n";

/** A markdown buffer currently open in the editor. */
export interface OpenDocument {
  /** Absolute path on disk, or null when the buffer has never been saved. */
  path: string | null;
  fileName: string;
  /**
   * Live buffer content. Always newline-normalised to `\n` — the editor
   * requires it. The file's real line endings are held in `lineEnding` and
   * re-applied on write, so saving never rewrites a CRLF file as LF.
   */
  content: string;
  /** Content as last persisted to disk. Dirty state is derived from these two. */
  savedContent: string;
  /** Line ending the file used on disk; preserved across saves. */
  lineEnding: LineEnding;
  modifiedAt: number | null;
}

/**
 * Pick the dominant line ending so mixed files settle on the majority style.
 * Single pass: this runs on every file open, and documents can be large.
 */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let loneLf = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf += 1;
      else loneLf += 1;
    }
  }
  return crlf > loneLf ? "\r\n" : "\n";
}

/** CRLF / bare CR -> LF. The editor works in this form. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Re-apply the file's original line endings before writing to disk. */
export function applyNewlines(text: string, ending: LineEnding): string {
  return ending === "\n" ? text : text.replace(/\n/g, "\r\n");
}

export function isDocumentDirty(doc: OpenDocument | null): boolean {
  if (doc === null) return false;
  if (doc.path === null) return doc.content.length > 0;
  return doc.content !== doc.savedContent;
}

export type RecentEntry = {
  path: string;
  name: string;
  openedAt: number;
};

/** One tab of a session snapshot: where it lived and what was not saved yet. */
export type SessionTab = {
  /** Absolute path on disk, or null when the buffer was never saved. */
  path: string | null;
  fileName: string;
  /** Unsaved content, or null when the tab was clean and only the path matters. */
  unsavedContent: string | null;
};

/** Persisted across restarts so we can restore the last session. */
export type SessionSnapshot = {
  workspacePath: string | null;
  openFilePath: string | null;
  /** Unsaved buffer for the open file, used for crash recovery. */
  unsavedContent: string | null;
  /**
   * Every tab that was open, in order.
   *
   * Optional on the way in: a snapshot written before tabs existed describes
   * one buffer in the two fields above, and that session is still worth
   * returning to. `null` for a snapshot of nothing open.
   */
  tabs: SessionTab[] | null;
  /** Which tab was showing. `null` when there were none or when `tabs` is. */
  activeIndex: number | null;
  sidebarOpen: boolean;
  savedAt: number;
};

export const MAX_RECENT_ENTRIES = 12;

export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}

export type { FileEntry };
