import { formatChord, useEditor, useSettings, useUi } from "@newmd/core";
import type { MarkdownSurface } from "@newmd/core/editor";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useT } from "../hooks/useT";

/**
 * The find/replace bar (ADR-0001 §2.11 查找替换).
 *
 * One panel for both modes on purpose. The search machinery is an engine
 * detail — CodeMirror's own cursor in source mode, `prosemirror-search` in
 * WYSIWYG — but `MarkdownEditorHandle` hides that, so this bar never learns
 * which one it is driving and `Ctrl+F` looks the same in both. A find bar per
 * engine would be the boundary of ADR §2.3 leaking back out through the UI.
 *
 * The query lives here rather than in the store: it is a text field, and a
 * global copy of what someone typed into a text field outlives the field.
 */
export function FindReplace({ surfaceRef }: { surfaceRef: RefObject<MarkdownSurface | null> }) {
  const t = useT();
  const open = useUi((s) => s.findOpen);
  const hasDocument = useEditor((s) => s.doc !== null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [missed, setMissed] = useState(false);
  const findRef = useRef<HTMLInputElement | null>(null);
  // The replace button is named after the key that reaches it, so a rebind
  // has to be visible here too.
  const replaceBinding = useSettings((s) => formatChord(s.settings.hotkeys.replace));

  // Opened by a hotkey from anywhere, so the caret has to be handed over here —
  // nothing else knows when the bar appeared.
  useEffect(() => {
    if (open) findRef.current?.select();
  }, [open]);

  if (!open || !hasDocument) return null;

  const surface = surfaceRef.current;

  function seek(step: "forward" | "backward"): void {
    if (!surface || query.length === 0) return;
    const request = { query, caseSensitive };
    const match = step === "forward" ? surface.findNext(request) : surface.findPrevious(request);
    setMissed(match === null);
  }

  function onQueryChange(value: string): void {
    setQuery(value);
    // Jump to the first match as the reader types rather than making them press
    // Enter to find out whether the word is there at all.
    if (value.length === 0 || !surface) {
      setMissed(false);
      return;
    }
    setMissed(surface.findNext({ query: value, caseSensitive }) === null);
  }

  function onReplace(): void {
    if (!surface || query.length === 0) return;
    // No `missed` update: an untouched document here means "nothing was lit
    // yet", which is the first press of the loop rather than a failed search.
    surface.replace({ query, replacement, caseSensitive });
  }

  function onReplaceAll(): void {
    if (!surface || query.length === 0) return;
    setMissed(surface.replaceAll({ query, replacement, caseSensitive }) === 0);
  }

  function onKeydown(event: ReactKeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      useUi.getState().setFindOpen(false);
      surface?.focus();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.currentTarget === findRef.current) seek(event.shiftKey ? "backward" : "forward");
    else onReplace();
  }

  return (
    <div
      onKeyDown={onKeydown}
      className="absolute right-4 top-4 z-20 w-[min(28rem,calc(100%-2rem))] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-md)]"
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={findRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("find.placeholder")}
          aria-label={t("find.placeholder")}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => setCaseSensitive(!caseSensitive)}
          title={t("find.caseSensitive")}
          aria-pressed={caseSensitive}
          className={
            caseSensitive
              ? "shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent)] px-1.5 py-1 text-[11px] text-[var(--accent-fg)]"
              : "shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] text-[var(--fg-subtle)] hover:bg-[var(--bg-hover)]"
          }
        >
          {t("find.caseSensitive")}
        </button>
        <button
          type="button"
          onClick={() => seek("backward")}
          title={t("find.previous")}
          aria-label={t("find.previous")}
          className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] text-[var(--fg-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          {"↑"}
        </button>
        <button
          type="button"
          onClick={() => seek("forward")}
          title={t("find.next")}
          aria-label={t("find.next")}
          className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] text-[var(--fg-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          {"↓"}
        </button>
        <button
          type="button"
          onClick={() => useUi.getState().setFindOpen(false)}
          title={t("find.close")}
          aria-label={t("find.close")}
          className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] text-[var(--fg-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          {"✕"}
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          placeholder={t("find.replacePlaceholder")}
          aria-label={t("find.replacePlaceholder")}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={onReplace}
          title={t("find.replaceHint", { binding: replaceBinding })}
          className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg)] hover:bg-[var(--bg-hover)]"
        >
          {t("find.replace")}
        </button>
        <button
          type="button"
          onClick={onReplaceAll}
          title={t("find.replaceAll")}
          className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg)] hover:bg-[var(--bg-hover)]"
        >
          {t("find.replaceAll")}
        </button>
      </div>

      {missed && (
        <p className="mt-1.5 text-[11px] text-[var(--fg-subtle)]">{t("find.noMatches")}</p>
      )}
    </div>
  );
}
