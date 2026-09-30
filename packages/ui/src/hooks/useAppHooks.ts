import {
  HOTKEY_ACTIONS,
  chordOfEvent,
  hotkeyIndex,
  useEditor,
  useSettings,
  useUi,
  type HotkeyActionId,
} from "@newmd/core";
import { useEffect } from "react";
import {
  handleCloseDocument,
  handleNewDocument,
  handleOpenFile,
  handleOpenFolder,
  handleReloadFromDisk,
  handleSave,
  handleSaveAs,
  toggleSidebar,
} from "../actions";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

/**
 * What each shortcut does, keyed by id.
 *
 * Written out here rather than read off a name in the settings: the panel owns
 * *which key*, and this owns *what pressing it means*. Keeping the two apart is
 * what lets a binding be data while the command stays code.
 */
const HOTKEY_COMMANDS: Record<HotkeyActionId, () => void> = {
  newDocument: () => void handleNewDocument(),
  openFile: () => void handleOpenFile(),
  openFolder: () => void handleOpenFolder(),
  save: () => void handleSave(),
  saveAs: () => void handleSaveAs(),
  closeDocument: () => void handleCloseDocument(),
  reload: () => void handleReloadFromDisk(),
  find: () => useUi.getState().setFindOpen(true),
  // Find and replace share one bar, so the second key opens the same thing the
  // first does — the fields are both on screen already.
  replace: () => useUi.getState().setFindOpen(true),
  toggleMode: () => useUi.getState().toggleMode(),
  toggleSidebar: () => toggleSidebar(),
  settings: () => useUi.getState().setSettingsOpen(true),
};

const ACTION_BY_ID = new Map(HOTKEY_ACTIONS.map((action) => [action.id, action]));

/**
 * Global shortcuts. The editor has its own keymap (Ctrl+F etc.); this layer only
 * owns the ones that must work no matter where focus is.
 *
 * The chord is looked up in the settings rather than in `HOTKEY_ACTIONS`, so a
 * rebind takes effect on the next keypress: a listener that kept the default
 * mapping would make 「设置面板可改」 a setting that changes nothing.
 */
export function useHotkeys(): void {
  const hotkeys = useSettings((s) => s.settings.hotkeys);

  useEffect(() => {
    const index = hotkeyIndex(hotkeys);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      const id = index.get(chordOfEvent(event));
      if (id === undefined) return;

      const action = ACTION_BY_ID.get(id);
      const command = HOTKEY_COMMANDS[id];
      if (action === undefined || command === undefined) return;

      // Whether a shortcut stands down while the caret sits in text is a
      // property of the command, not of the key that runs it — which is what
      // stops it from moving when the reader rebinds.
      if (!action.firesInEditable && isEditableTarget(event.target)) return;

      event.preventDefault();
      command();
    };

    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [hotkeys]);
}

/** Mirror the current document into the native window title. */
export function useWindowTitle(): void {
  const fileName = useEditor((s) => s.doc?.fileName ?? null);
  const dirty = useEditor((s) => {
    const doc = s.doc;
    return doc !== null && doc.content !== doc.savedContent;
  });
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    const parts = ["NewMD"];
    if (fileName) parts.push(dirty ? `• ${fileName}` : fileName);
    document.title = parts.join(" — ");
    document.documentElement.dataset.theme = theme;
  }, [fileName, dirty, theme]);
}

/** Push user typography settings into the CSS variable layer. */
export function useTypographyVariables(): void {
  const settings = useSettings((s) => s.settings);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--editor-line-height", String(settings.lineHeight));
    root.style.setProperty("--editor-max-width", `${settings.editorMaxWidth}px`);
    root.style.setProperty("--font-editor", settings.fontFamily);
    root.style.setProperty("--font-ui", '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif');
  }, [settings.fontSize, settings.lineHeight, settings.editorMaxWidth, settings.fontFamily]);
}

/**
 * The reader's own stylesheet, live (ADR-0001 §2.11 用户自定义 CSS).
 *
 * Its own `<style>` element rather than a merge into the theme, because the box
 * is edited one keystroke at a time: the whole stylesheet is replaced each time,
 * and an element that is thrown away when the box empties is the only form in
 * which "clear the CSS" actually turns it off. A stylesheet that outlives the
 * text that wrote it is a setting the reader cannot switch off.
 */
export function useUserCss(): void {
  const css = useSettings((s) => s.settings.customCss);

  useEffect(() => {
    if (css === "") {
      document.getElementById("user-css")?.remove();
      return;
    }
    const tag = document.createElement("style");
    tag.id = "user-css";
    tag.textContent = css;
    document.head.appendChild(tag);
    return () => {
      document.getElementById("user-css")?.remove();
    };
  }, [css]);
}
