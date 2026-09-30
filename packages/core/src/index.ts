// Platform abstraction — the only way core reaches the host.
export * from "./platform/types";
export {
  createBrowserAdapter,
  getPlatform,
  isPlatformRegistered,
  resetPlatform,
  setPlatform,
} from "./platform";
export {
  isAbsolute,
  pathBaseName,
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
} from "./platform/path";

// i18n — 中文优先 (ADR-0001 §2.11).
export { getI18n, getLocale, initI18n, resetI18n, setLocale, SUPPORTED_LOCALES, t } from "./i18n";

// Shared domain types.
export {
  applyNewlines,
  DEFAULT_SETTINGS,
  detectLineEnding,
  isDocumentDirty,
  isMarkdownFile,
  MAX_RECENT_ENTRIES,
  normalizeNewlines,
  type AppSettings,
  type FileEntry,
  type LineEnding,
  type Locale,
  type OpenDocument,
  type RecentEntry,
  type ResolvedTheme,
  type SessionSnapshot,
  type ThemePreference,
} from "./types";

// State.
export * from "./stores";

// Lifecycle.
export {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  chordOfEvent,
  formatChord,
  hotkeyIndex,
  mergeHotkeys,
  normalizeChord,
  type HotkeyAction,
  type HotkeyActionId,
  type Hotkeys,
} from "./hotkeys";
export { headingsOf, outlineOf, type HeadingTarget, type LocatedHeading } from "./outline";
export { bootstrapCore, resolveTheme, watchTheme, type BootstrapResult } from "./bootstrap";
export { flushAutosave, saveRecoveryBuffer, startAutosave, stopAutosave } from "./autosave";
export {
  restoreSession,
  snapshotSession,
  startSessionPersistence,
  stopSessionPersistence,
} from "./session";
