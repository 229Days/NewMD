import { isDocumentDirty, useEditor } from "@newmd/core";
import { handleCloseTab, handleNewDocument } from "../actions";
import { useT } from "../hooks/useT";

/**
 * The tab strip (ADR-0001 §4 M3: 多标签).
 *
 * Per-document dirty state is where the model pays off, and it is the M3
 * acceptance criterion 「多标签下脏状态指示正确」: a tab the reader is not
 * looking at still shows the dot, which is the whole reason the state lives on
 * the document rather than on the window.
 *
 * The name and the close control are sibling buttons rather than one button
 * with a nested one. A button inside a button is not valid HTML, and assistive
 * technology stops at the outer one — so the close control would be unreachable
 * by keyboard exactly when someone needed to close a dirty tab.
 */
export function TabStrip() {
  const t = useT();
  const tabs = useEditor((s) => s.tabs);
  const activeIndex = useEditor((s) => s.activeIndex);

  // Nothing open is the empty state's own screen; a strip of zero tabs would
  // only be a bar of chrome above it.
  if (tabs.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t("tabs.label")}
      className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1 pt-1"
    >
      {tabs.map((tab, index) => {
        const active = index === activeIndex;
        return (
          <div
            // `(path, fileName)` is a tab's identity — see `stores/editor.ts`.
            // Index keys would reuse a row's DOM for a different tab whenever
            // one before it closed. Stringifying the pair keeps the separator
            // out of the paths themselves.
            key={JSON.stringify([tab.path, tab.fileName])}
            className={
              active
                ? "flex min-w-0 max-w-[14rem] shrink-0 items-center gap-1 rounded-t-[var(--radius-sm)] border border-b-0 border-[var(--border)] bg-[var(--bg)]"
                : "flex min-w-0 max-w-[14rem] shrink-0 items-center gap-1 rounded-t-[var(--radius-sm)] border border-transparent hover:bg-[var(--bg-hover)]"
            }
          >
            <button
              type="button"
              onClick={() => useEditor.getState().setActive(index)}
              aria-current={active}
              className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-[12px] text-[var(--fg-muted)]"
            >
              {isDocumentDirty(tab) ? (
                // A glyph rather than a word: it is a mark on the tab, not a
                // sentence, and it stays legible in a strip a few pixels tall.
                <span
                  role="img"
                  title={t("tabs.dirty")}
                  aria-label={t("tabs.dirty")}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                />
              ) : null}
              <span
                className={active ? "truncate text-[var(--fg)]" : "truncate"}
                title={tab.fileName}
              >
                {tab.fileName}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleCloseTab(index)}
              title={t("tabs.close")}
              aria-label={t("tabs.close")}
              className="shrink-0 rounded-[var(--radius-sm)] px-1 py-0.5 text-[11px] text-[var(--fg-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            >
              {"✕"}
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => void handleNewDocument()}
        title={t("tabs.new")}
        aria-label={t("tabs.new")}
        className="shrink-0 self-center rounded-[var(--radius-sm)] px-1.5 py-1 text-[13px] text-[var(--fg-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
      >
        {"＋"}
      </button>
    </div>
  );
}
