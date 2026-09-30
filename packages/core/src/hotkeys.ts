/**
 * Shortcuts, as data (ADR-0001 §4 M4 快捷键配置, §2.11 「默认对齐 Typora /
 * VS Code 习惯，设置面板可改」).
 *
 * The two halves of that sentence pull in opposite directions. "Defaults a
 * reader recognises" wants fixed, boring values; "the panel can change them"
 * wants nothing to be fixed at all. The way through is to keep the defaults as
 * a table and resolve every keypress against the settings rather than against
 * the table — so this module never asks *which* action a chord means, only
 * *what the settings say* it means. A helper that compared `event.key` to
 * `"s"` would satisfy the first half and make the second impossible.
 *
 * `Mod` is Ctrl on Windows and Cmd on macOS. One spelling for both, because the
 * reader of this app never chose which keyboard is plugged in, and the settings
 * file has to be readable across both.
 */

/** Every shortcut the app owns. The panel shows one row per id. */
export type HotkeyActionId =
  | "newDocument"
  | "openFile"
  | "openFolder"
  | "save"
  | "saveAs"
  | "closeDocument"
  | "reload"
  | "find"
  | "replace"
  | "insertImage"
  | "toggleMode"
  | "toggleSidebar"
  | "settings";

export interface HotkeyAction {
  id: HotkeyActionId;
  /** The binding before anyone has changed it, already in canonical form. */
  defaultBinding: string;
  /** i18n key naming the action in the settings panel. */
  labelKey: string;
  /**
   * Whether the shortcut still fires while the caret sits in editable text.
   *
   * Saving and finding have to: a save that stands down while the reader is
   * typing is a save they cannot reach. Closing and switching tabs must not —
   * they would fire on every Ctrl+W meant for the editor.
   */
  firesInEditable: boolean;
}

/**
 * The defaults, in the order Typora and VS Code readers already have them.
 *
 * Written as one table rather than next to the handlers so that a binding is a
 * value someone can read, diff and rebind — not a branch buried in a switch.
 */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  {
    id: "newDocument",
    defaultBinding: "Mod+N",
    labelKey: "hotkeys.newDocument",
    firesInEditable: true,
  },
  { id: "openFile", defaultBinding: "Mod+O", labelKey: "hotkeys.openFile", firesInEditable: true },
  {
    id: "openFolder",
    defaultBinding: "Mod+Shift+O",
    labelKey: "hotkeys.openFolder",
    firesInEditable: true,
  },
  { id: "save", defaultBinding: "Mod+S", labelKey: "hotkeys.save", firesInEditable: true },
  {
    id: "saveAs",
    defaultBinding: "Mod+Shift+S",
    labelKey: "hotkeys.saveAs",
    firesInEditable: true,
  },
  {
    id: "closeDocument",
    defaultBinding: "Mod+W",
    labelKey: "hotkeys.closeDocument",
    firesInEditable: false,
  },
  { id: "reload", defaultBinding: "Mod+R", labelKey: "hotkeys.reload", firesInEditable: false },
  { id: "find", defaultBinding: "Mod+F", labelKey: "hotkeys.find", firesInEditable: true },
  { id: "replace", defaultBinding: "Mod+H", labelKey: "hotkeys.replace", firesInEditable: true },
  {
    id: "insertImage",
    defaultBinding: "Mod+Shift+I",
    labelKey: "hotkeys.insertImage",
    firesInEditable: true,
  },
  {
    id: "toggleMode",
    defaultBinding: "Mod+/",
    labelKey: "hotkeys.toggleMode",
    firesInEditable: true,
  },
  {
    id: "toggleSidebar",
    defaultBinding: "Mod+B",
    labelKey: "hotkeys.toggleSidebar",
    firesInEditable: false,
  },
  { id: "settings", defaultBinding: "Mod+,", labelKey: "hotkeys.settings", firesInEditable: false },
];

export type Hotkeys = Record<HotkeyActionId, string>;

export const DEFAULT_HOTKEYS: Hotkeys = HOTKEY_ACTIONS.reduce((out, action) => {
  out[action.id] = action.defaultBinding;
  return out;
}, {} as Hotkeys);

/** Only the modifiers this app can tell apart, in the order they are spelled. */
const MODIFIER_ORDER = ["Mod", "Alt", "Shift"] as const;

/**
 * Put a chord in the one form everything else compares against.
 *
 * Ctrl and Cmd both collapse into `Mod`, so a binding written on a Windows
 * keyboard still resolves on a Mac and back. An empty chord stays empty rather
 * than becoming a bare key: "unbound" is a setting a reader can choose, and
 * folding it into `+S` would hand the action back to them.
 */
export function normalizeChord(chord: string): string {
  const trimmed = chord.trim();
  if (trimmed === "") return "";

  const held = new Set<string>();
  let key = "";
  for (const part of trimmed.split("+")) {
    const token = part.trim();
    if (token === "") continue;
    const lower = token.toLowerCase();
    if (
      lower === "mod" ||
      lower === "ctrl" ||
      lower === "control" ||
      lower === "meta" ||
      lower === "cmd"
    ) {
      held.add("Mod");
    } else if (lower === "alt" || lower === "option") {
      held.add("Alt");
    } else if (lower === "shift") {
      held.add("Shift");
    } else {
      key = token;
    }
  }
  if (key === "") return "";

  const modifiers = MODIFIER_ORDER.filter((modifier) => held.has(modifier));
  // A single letter is case-insensitive by nature; `s` and `S` are the same
  // key, and only the Shift held alongside it is a different chord.
  const spelled = key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key;
  return [...modifiers, spelled].join("+");
}

/**
 * Put a chord in front of a reader rather than in front of a settings file.
 *
 * `Mod` is the portable spelling; `Ctrl` is the one this app has always used in
 * its tooltips, so the shortcut row and the tooltip beside it name the same key.
 * An unbound chord formats to nothing, because an empty string is not a key and
 * a bare "+" would be a worse answer than no answer.
 */
export function formatChord(chord: string): string {
  const canonical = normalizeChord(chord);
  if (canonical === "") return "";
  return canonical.replace(/^Mod\+/, "Ctrl+").replace(/^Mod$/, "Ctrl");
}

/** The subset of `KeyboardEvent` a chord is read from. */
export interface HotkeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The chord a keypress *is*, in the same spelling as a binding.
 *
 * Both Ctrl and Cmd report as `Mod`: which one the reader pressed is a detail
 * of the keyboard in front of them, not of the command they meant to give.
 */
export function chordOfEvent(event: HotkeyEventLike): string {
  const held: string[] = [];
  if (event.ctrlKey || event.metaKey) held.push("Mod");
  if (event.altKey) held.push("Alt");
  if (event.shiftKey) held.push("Shift");

  const key = event.key;
  const spelled = key.length === 1 && /[a-z]/i.test(key) ? key.toUpperCase() : key;
  if (spelled === "") return "";
  return [...held, spelled].join("+");
}

/**
 * Chord to action, built from whatever the settings currently hold.
 *
 * The order of `HOTKEY_ACTIONS` is the order of first claim: two rows bound to
 * the same chord is a mistake the panel should make visible, and the reader
 * should see the one they bound first keep firing rather than a coin flip.
 * A chord no event can produce — the empty one — is left out of the index
 * entirely, which is how an unbound action stays unbound.
 */
export function hotkeyIndex(hotkeys: Hotkeys): Map<string, HotkeyActionId> {
  const index = new Map<string, HotkeyActionId>();
  for (const action of HOTKEY_ACTIONS) {
    const chord = normalizeChord(hotkeys[action.id]);
    if (chord === "") continue;
    if (!index.has(chord)) index.set(chord, action.id);
  }
  return index;
}

/**
 * What a persisted `hotkeys` blob is allowed to become.
 *
 * The store writes the whole settings object, so this has to defend against
 * anything: a value of the wrong type, an id no longer in the table, a chord
 * someone hand-edited into something unreadable. Anything it does not keep
 * falls back to the default rather than leaving the action with no way to run
 * at all.
 */
export function mergeHotkeys(raw: unknown): Hotkeys {
  const out: Hotkeys = { ...DEFAULT_HOTKEYS };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;

  const stored = raw as Record<string, unknown>;
  for (const action of HOTKEY_ACTIONS) {
    const value = stored[action.id];
    if (typeof value !== "string") continue;
    // An empty string is a binding the reader took away on purpose, so it is
    // kept. Anything else that reads back as no chord is junk and falls to the
    // default, which is the one way the action stays reachable at all.
    if (value.trim() === "") {
      out[action.id] = "";
      continue;
    }
    const chord = normalizeChord(value);
    if (chord !== "") out[action.id] = chord;
  }
  return out;
}
