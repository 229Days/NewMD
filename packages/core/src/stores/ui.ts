import { create } from "zustand";
import type { HeadingTarget, MarkdownEditorMode } from "../editor/handle";
import type { ResolvedTheme } from "../types";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  /**
   * Already-translated copy. Toasts live for three to six seconds, so they are
   * resolved at `notify()` time rather than retranslated at render.
   */
  message: string;
}

/**
 * The outline asking the editor to show a heading (ADR-0001 §4 大纲点击可跳转).
 *
 * The sidebar holds no reference to the surface — it is a sibling of the pane
 * that does — so the request travels the way `findOpen` does: through the store,
 * which both can see. `seq` is what makes it a *request* rather than a value:
 * clicking the same heading twice is two jumps, and a store that only held the
 * target would see one.
 */
export interface RevealRequest {
  target: HeadingTarget;
  seq: number;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface UiState {
  /** Resolved theme actually painted on the document root. */
  theme: ResolvedTheme;
  sidebarOpen: boolean;
  statusBarOpen: boolean;
  settingsOpen: boolean;
  /** True once settings and the previous session have been restored. */
  ready: boolean;
  /** True while a blocking platform call is in flight. */
  busy: boolean;
  toast: Toast | null;
  cursor: CursorPosition;
  /**
   * Which surface is showing the document (ADR-0001 §2.9).
   *
   * A mirror of `MarkdownSurface.mode`, not the source of truth: the surface is
   * the thing that actually swaps engines. This exists so the status bar can
   * name the mode and `Ctrl+/` can flip it without holding a ref to the editor.
   */
  mode: MarkdownEditorMode;
  /**
   * Whether the find/replace bar is showing (ADR-0001 §2.11).
   *
   * `Ctrl+F` opens it from anywhere and `Escape` closes it from inside the
   * editor, and neither has a reference to the component — so the flag lives
   * here and the bar renders off it. The query text stays with the bar: a
   * global copy of what someone typed into a text field outlives the field.
   */
  findOpen: boolean;
  reveal: RevealRequest | null;

  setTheme(theme: ResolvedTheme): void;
  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  setStatusBarOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setReady(ready: boolean): void;
  setBusy(busy: boolean): void;
  setCursor(line: number, column: number): void;
  setMode(mode: MarkdownEditorMode): void;
  toggleMode(): void;
  setFindOpen(open: boolean): void;
  requestReveal(target: HeadingTarget): void;
  notify(kind: Toast["kind"], message: string): void;
  dismissToast(): void;
}

let toastSeq = 0;
let revealSeq = 0;

export const useUi = create<UiState>()((set, get) => ({
  theme: "light",
  sidebarOpen: true,
  statusBarOpen: true,
  settingsOpen: false,
  ready: false,
  busy: false,
  toast: null,
  cursor: { line: 1, column: 1 },
  mode: "wysiwyg",
  findOpen: false,
  reveal: null,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setStatusBarOpen: (statusBarOpen) => set({ statusBarOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setReady: (ready) => set({ ready }),
  setBusy: (busy) => set({ busy }),
  setCursor: (line, column) => set({ cursor: { line, column } }),
  setMode: (mode) => set({ mode }),
  toggleMode: () => set({ mode: get().mode === "wysiwyg" ? "source" : "wysiwyg" }),
  setFindOpen: (findOpen) => set({ findOpen }),
  requestReveal: (target) => set({ reveal: { target, seq: ++revealSeq } }),

  notify(kind, message) {
    set({ toast: { id: ++toastSeq, kind, message } });
    // Errors linger so the user can actually read them.
    const ttl = kind === "error" ? 6000 : 3000;
    globalThis.setTimeout(() => {
      if (get().toast?.id === toastSeq) set({ toast: null });
    }, ttl);
  },

  dismissToast: () => set({ toast: null }),
}));
