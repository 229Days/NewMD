import { useUi } from "@newmd/core";
import { useT } from "../hooks/useT";

/**
 * Toast copy is translated when the notification is raised, not here: it lives
 * for three to six seconds, so it never outlives a trip to the settings panel.
 */
export function Toast() {
  const t = useT();
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);

  if (!toast) return null;

  const borderColour =
    toast.kind === "error"
      ? "var(--danger)"
      : toast.kind === "success"
        ? "var(--success)"
        : "var(--accent)";

  return (
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2">
      <div
        role="status"
        className="toast-enter pointer-events-auto flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 shadow-[var(--shadow)]"
        style={{ borderLeft: `3px solid ${borderColour}` }}
      >
        <span className="text-[13px] text-[var(--fg)]">{toast.message}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common.dismiss")}
          className="text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}
