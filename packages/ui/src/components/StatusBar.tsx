import {
  formatChord,
  isDocumentDirty,
  useEditor,
  useSettings,
  useUi,
  useWorkspace,
} from "@newmd/core";
import { useT } from "../hooks/useT";

export function StatusBar() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  const dirty = useEditor((s) => isDocumentDirty(s.doc));
  const cursor = useUi((s) => s.cursor);
  const busy = useUi((s) => s.busy);
  const mode = useUi((s) => s.mode);
  const rootName = useWorkspace((s) => s.rootName);
  const visible = useUi((s) => s.statusBarOpen);
  // The mode toggle is only reachable two ways — this button and its key —
  // so the key it names has to be the one that works.
  const modeBinding = useSettings((s) => formatChord(s.settings.hotkeys.toggleMode));

  if (!visible) return null;

  const text = doc?.content ?? "";
  const lines = text.length === 0 ? 0 : text.split("\n").length;

  const status = busy
    ? t("statusBar.working")
    : doc
      ? dirty
        ? t("statusBar.unsaved")
        : t("statusBar.saved")
      : t("statusBar.ready");

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[11px] text-[var(--fg-subtle)]">
      <span className="truncate" title={doc?.path ?? undefined}>
        {doc?.path ?? "—"}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-4">
        {/* Clickable as well as hotkeyed: `Ctrl+/` is undiscoverable otherwise. */}
        <button
          type="button"
          onClick={() => useUi.getState().toggleMode()}
          title={t("statusBar.switchMode", { binding: modeBinding })}
          className="rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
        >
          {t(mode === "source" ? "statusBar.modeSource" : "statusBar.modeWysiwyg")}
        </button>
        {rootName && <span title={t("statusBar.workspace")}>{rootName}</span>}
        <span>{t("statusBar.position", { line: cursor.line, column: cursor.column })}</span>
        <span>{t("statusBar.lines", { count: lines })}</span>
        <span>{t("statusBar.chars", { count: text.length })}</span>
        <span
          className={
            doc
              ? dirty
                ? "text-[var(--accent)]"
                : "text-[var(--success)]"
              : "text-[var(--fg-subtle)]"
          }
        >
          {status}
        </span>
      </span>
    </footer>
  );
}
