/**
 * Configurable shortcuts (ADR-0001 §4 M4 快捷键配置, §2.11 「默认对齐
 * Typora / VS Code 习惯，设置面板可改」).
 *
 * The tests that matter are the two halves of that sentence taken apart: the
 * defaults are fixed values a reader recognises, and a binding is only data —
 * the same chord arriving from the keyboard resolves to whatever the settings
 * say it resolves to. A helper that hardcoded `key === "s"` would pass the
 * first half and make the second impossible, which is why nothing here looks at
 * an action id until the index has been built from the settings.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  chordOfEvent,
  formatChord,
  hotkeyIndex,
  mergeHotkeys,
  normalizeChord,
  type HotkeyActionId,
} from "../src/hotkeys";

describe("default shortcuts", () => {
  it("are the bindings Typora and VS Code readers already have in their fingers", () => {
    expect(DEFAULT_HOTKEYS.save).toBe("Mod+S");
    expect(DEFAULT_HOTKEYS.saveAs).toBe("Mod+Shift+S");
    expect(DEFAULT_HOTKEYS.openFile).toBe("Mod+O");
    expect(DEFAULT_HOTKEYS.openFolder).toBe("Mod+Shift+O");
    expect(DEFAULT_HOTKEYS.find).toBe("Mod+F");
    expect(DEFAULT_HOTKEYS.replace).toBe("Mod+H");
    expect(DEFAULT_HOTKEYS.closeDocument).toBe("Mod+W");
    expect(DEFAULT_HOTKEYS.toggleSidebar).toBe("Mod+B");
    expect(DEFAULT_HOTKEYS.settings).toBe("Mod+,");
  });

  it("cover every action with a name, so the panel has a row to rebind", () => {
    expect(HOTKEY_ACTIONS.length).toBeGreaterThan(0);
    for (const action of HOTKEY_ACTIONS) {
      expect(DEFAULT_HOTKEYS[action.id]).toBe(action.defaultBinding);
      expect(action.labelKey).toMatch(/^hotkeys\./);
    }
  });

  it("marks which shortcuts still fire with the caret in the text", () => {
    const inside = HOTKEY_ACTIONS.filter((action) => action.firesInEditable).map((a) => a.id);
    // A save that stands down while the caret sits in the document is a save
    // the reader cannot reach at all, and find must open from a search box.
    expect(inside).toContain("save");
    expect(inside).toContain("find");
    expect(inside).not.toContain("closeDocument");
  });
});

describe("normalising a chord", () => {
  it("folds Ctrl and Cmd into Mod and puts the modifiers in one order", () => {
    expect(normalizeChord("shift+ctrl+s")).toBe("Mod+Shift+S");
    expect(normalizeChord("Cmd+S")).toBe("Mod+S");
    expect(normalizeChord("Alt+Mod+b")).toBe("Mod+Alt+B");
  });

  it("leaves punctuation keys alone, because they are not letters", () => {
    expect(normalizeChord("mod+,")).toBe("Mod+,");
    expect(normalizeChord("Mod+/")).toBe("Mod+/");
  });

  it("reads an empty binding as unbound rather than as a chord", () => {
    expect(normalizeChord("")).toBe("");
    expect(hotkeyIndex({ ...DEFAULT_HOTKEYS, save: "" }).get("Mod+S")).toBeUndefined();
    expect(hotkeyIndex(DEFAULT_HOTKEYS).get("Mod+S")).toBe("save");
  });
});

describe("spelling a chord for the reader", () => {
  it("says Ctrl, because that is what the app says everywhere else", () => {
    // Every existing tooltip in the app reads "Ctrl+S", and the app is shipped
    // for desktop keyboards where that is the key. A binding shown as "Mod+S"
    // would be the only place in the UI that spoke in the settings file rather
    // than in front of the reader.
    expect(formatChord("Mod+S")).toBe("Ctrl+S");
    expect(formatChord("Mod+Shift+O")).toBe("Ctrl+Shift+O");
    expect(formatChord("Mod+,")).toBe("Ctrl+,");
  });

  it("shows nothing rather than a bare plus for a shortcut nobody has bound", () => {
    expect(formatChord("")).toBe("");
  });
});

describe("reading a chord off a key event", () => {
  const press = (
    key: string,
    mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {},
  ) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("reports Mod for either Ctrl or Cmd, so one binding covers both keyboards", () => {
    expect(chordOfEvent(press("s", { ctrlKey: true }))).toBe("Mod+S");
    expect(chordOfEvent(press("s", { metaKey: true }))).toBe("Mod+S");
  });

  it("keeps Shift, because it is what tells save apart from save-as", () => {
    expect(chordOfEvent(press("S", { ctrlKey: true, shiftKey: true }))).toBe("Mod+Shift+S");
  });

  it("records punctuation the way the settings spell it", () => {
    expect(chordOfEvent(press(",", { ctrlKey: true }))).toBe("Mod+,");
    expect(chordOfEvent(press("/", { ctrlKey: true }))).toBe("Mod+/");
  });
});

describe("resolving a chord to an action", () => {
  it("answers with the action the settings say owns that chord", () => {
    const index = hotkeyIndex({ ...DEFAULT_HOTKEYS, save: "Mod+Alt+S" });
    expect(index.get("Mod+Alt+S")).toBe("save");
    expect(index.get("Mod+S")).toBeUndefined();
  });

  it("gives a contested chord to the first action that claims it", () => {
    const index = hotkeyIndex({ ...DEFAULT_HOTKEYS, save: "Mod+Q", reload: "Mod+Q" });
    const claimed = [...index.entries()].filter(([, id]) => id === "save" || id === "reload");
    expect(claimed).toEqual([["Mod+Q", "save"]]);
  });
});

describe("taking a stored binding back", () => {
  it("keeps what is a chord, drops what is not, and restores what is missing", () => {
    const stored = {
      save: "Mod+Alt+S",
      reload: 42,
      settings: "Mod+.",
      nonsense: "Mod+Z",
    };
    const merged = mergeHotkeys(stored);
    expect(merged.save).toBe("Mod+Alt+S");
    expect(merged.settings).toBe("Mod+.");
    expect(merged.reload).toBe(DEFAULT_HOTKEYS.reload);
    expect(Object.keys(merged).sort()).toEqual(
      (Object.keys(DEFAULT_HOTKEYS) as HotkeyActionId[]).sort(),
    );
    expect(merged).not.toHaveProperty("nonsense");
  });

  it("keeps a binding the reader deliberately cleared", () => {
    // Clearing a row is how someone says "I do not want this shortcut".
    // Reading the empty value back as a default would hand the action to them
    // again on the next launch, with no way left to take it away.
    const merged = mergeHotkeys({ ...DEFAULT_HOTKEYS, save: "" });
    expect(merged.save).toBe("");
  });

  it("falls back wholesale when the stored value is not an object", () => {
    expect(mergeHotkeys("Mod+S")).toEqual(DEFAULT_HOTKEYS);
    expect(mergeHotkeys(null)).toEqual(DEFAULT_HOTKEYS);
  });
});
