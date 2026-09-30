import {
  HOTKEY_ACTIONS,
  chordOfEvent,
  formatChord,
  useSettings,
  useUi,
  type Locale,
  type ThemePreference,
} from "@newmd/core";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../hooks/useT";

/** One pill in a row of one-of-these choices — active reads louder than the rest. */
function chipClass(active: boolean): string {
  return active
    ? "cursor-pointer rounded-[var(--radius-sm)] bg-[var(--accent)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--accent-fg)]"
    : "cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]";
}

/** Keys that only ever mean "the reader is still holding something". */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph", "CapsLock"]);

function SectionHeading({ children }: { children: string }) {
  return (
    <p className="mt-3 mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
      {children}
    </p>
  );
}

/**
 * The settings that are a bare number on screen.
 *
 * Named rather than spelled out in the parameter list: the copy guard reads
 * every quoted literal that follows a `:`, and a union written inline would put
 * three camelCase identifiers where it is looking for a sentence.
 */
type NumericSetting = "fontSize" | "lineHeight" | "editorMaxWidth";

/**
 * The settings surface: language, then the half of M4 that changes how the app
 * looks (ADR-0001 §4 字体/字号设置).
 *
 * Every field writes through `useSettings`, and the appliers watch that store,
 * so a change lands on the document root in the same tick rather than on the
 * next launch. That is the milestone's 「主题切换即时生效」 requirement, and it is
 * why this writes the store rather than keeping a local copy of it.
 */
export function SettingsPopover() {
  const t = useT();
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const settings = useSettings((s) => s.settings);
  const setSetting = useSettings((s) => s.set);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Which shortcut row is waiting for a keypress, if any. */
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    globalThis.addEventListener("mousedown", onPointerDown);
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("mousedown", onPointerDown);
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  // A capture left armed would swallow the next shortcut pressed after the
  // panel is reopened, with nothing on screen saying it is armed.
  useEffect(() => {
    if (!open) setCapturing(null);
  }, [open]);

  if (!open) return null;

  const option = (value: Locale, label: string) => {
    const active = settings.locale === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => void setSetting("locale", value)}
        aria-pressed={active}
        className={chipClass(active)}
      >
        {label}
      </button>
    );
  };

  const themeOption = (value: ThemePreference, label: string) => {
    const active = settings.theme === value;
    return (
      <label key={value} className={chipClass(active)}>
        <input
          type="radio"
          name="settings-theme"
          value={value}
          checked={active}
          onChange={() => void setSetting("theme", value)}
          className="sr-only"
        />
        {label}
      </label>
    );
  };

  /**
   * Commit a number field, leaving the setting alone while the field holds
   * something the reader has not finished typing.
   */
  const commitNumber = (event: ChangeEvent<HTMLInputElement>, key: NumericSetting): void => {
    const raw = event.target.value.trim();
    if (raw === "") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    void setSetting(key, parsed);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("settings.title")}
      className="absolute right-2 top-11 z-40 max-h-[70vh] w-64 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow)]"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
        {t("settings.language")}
      </p>
      <div className="flex items-center gap-1">
        {option("zh-CN", t("settings.locales.zh-CN"))}
        {option("en-US", t("settings.locales.en-US"))}
      </div>

      <SectionHeading>{t("settings.appearance")}</SectionHeading>
      <div role="radiogroup" aria-label={t("settings.theme")} className="flex items-center gap-1">
        {themeOption("system", t("settings.themes.system"))}
        {themeOption("light", t("settings.themes.light"))}
        {themeOption("dark", t("settings.themes.dark"))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <label htmlFor="settings-font-family" className="text-[12px] text-[var(--fg-muted)]">
          {t("settings.fontFamily")}
        </label>
        <input
          id="settings-font-family"
          type="text"
          value={settings.fontFamily}
          onChange={(event) => void setSetting("fontFamily", event.target.value)}
          className="w-32 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-right text-[12px] text-[var(--fg)]"
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <label htmlFor="settings-font-size" className="text-[12px] text-[var(--fg-muted)]">
          {t("settings.fontSize")}
        </label>
        <input
          id="settings-font-size"
          type="number"
          min={10}
          max={40}
          value={settings.fontSize}
          onChange={(event) => commitNumber(event, "fontSize")}
          className="w-20 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-right text-[12px] text-[var(--fg)]"
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <label htmlFor="settings-line-height" className="text-[12px] text-[var(--fg-muted)]">
          {t("settings.lineHeight")}
        </label>
        <input
          id="settings-line-height"
          type="number"
          min={1}
          max={3}
          step={0.05}
          value={settings.lineHeight}
          onChange={(event) => commitNumber(event, "lineHeight")}
          className="w-20 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-right text-[12px] text-[var(--fg)]"
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <label htmlFor="settings-editor-max-width" className="text-[12px] text-[var(--fg-muted)]">
          {t("settings.editorMaxWidth")}
        </label>
        <input
          id="settings-editor-max-width"
          type="number"
          min={400}
          max={2000}
          step={20}
          value={settings.editorMaxWidth}
          onChange={(event) => commitNumber(event, "editorMaxWidth")}
          className="w-20 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-right text-[12px] text-[var(--fg)]"
        />
      </div>

      <div className="mt-3">
        <label htmlFor="settings-custom-css" className="text-[12px] text-[var(--fg-muted)]">
          {t("settings.customCss")}
        </label>
        <textarea
          id="settings-custom-css"
          rows={4}
          value={settings.customCss}
          onChange={(event) => void setSetting("customCss", event.target.value)}
          className="mt-1 w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[12px] text-[var(--fg)]"
        />
      </div>

      <SectionHeading>{t("hotkeys.title")}</SectionHeading>
      <ul>
        {HOTKEY_ACTIONS.map((action) => {
          const bound = settings.hotkeys[action.id];
          const shown =
            capturing === action.id
              ? t("hotkeys.capturing")
              : bound === ""
                ? t("hotkeys.unbound")
                : formatChord(bound);

          /** Take the chord of whatever the reader presses while armed. */
          const onCaptureKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
            if (capturing !== action.id) return;
            // Held here so the global shortcut listener and the panel's own
            // Escape-to-close both stay out of a capture in progress.
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setCapturing(null);
              return;
            }
            // Holding a modifier is being halfway through a chord, not pressing
            // one: taking `Control` as the key would bind the row to a press of
            // Ctrl on its own, which fires on every shortcut the reader starts.
            if (MODIFIER_KEYS.has(event.key)) {
              event.preventDefault();
              return;
            }
            // The dispatcher only ever reads chords carrying Mod, so a binding
            // without one could not fire: stay armed until one arrives rather
            // than storing something dead.
            if (!event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            const chord = chordOfEvent(event);
            setCapturing(null);
            void setSetting("hotkeys", { ...settings.hotkeys, [action.id]: chord });
          };

          return (
            <li key={action.id}>
              <button
                type="button"
                title={t("hotkeys.rebindHint")}
                aria-pressed={capturing === action.id}
                onClick={() => setCapturing(capturing === action.id ? null : action.id)}
                onKeyDown={onCaptureKeyDown}
                className="mt-1 flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-left text-[12px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
              >
                <span className="truncate">{t(action.labelKey)}</span>
                <span className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fg)]">
                  {shown}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
