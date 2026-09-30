import { useEffect, useRef } from "react";
import { useDialog } from "../dialog";
import { useT } from "../hooks/useT";

/**
 * Three-way confirmation. Rendered once at the app root and driven by
 * `confirmAction()`; answering resolves the pending promise.
 *
 * Copy is resolved here, not at the call site, so a dialog that is still open
 * retranslates the moment the language changes.
 */
export function ConfirmDialog() {
  const t = useT();
  const pending = useDialog((s) => s.pending);
  const settle = useDialog((s) => s.settle);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Focus the safe action first — cancelling should never cost the user work.
  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle("cancel");
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            settle("cancel");
          }
        }}
      >
        <h2 id="confirm-dialog-title" className="mb-2 text-[15px] font-semibold text-[var(--fg)]">
          {t(pending.titleKey)}
        </h2>
        <p className="mb-5 text-[13px] leading-relaxed text-[var(--fg-muted)]">
          {t(pending.messageKey, pending.messageParams)}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => settle("cancel")}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            {t(pending.cancelKey ?? "common.cancel")}
          </button>

          {pending.alternativeKey && (
            <button
              type="button"
              onClick={() => settle("alternative")}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              {t(pending.alternativeKey)}
            </button>
          )}

          <button
            ref={confirmRef}
            type="button"
            onClick={() => settle("confirm")}
            className={
              pending.danger
                ? "rounded-[var(--radius-sm)] bg-[var(--danger)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--danger-hover)]"
                : "rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
            }
          >
            {t(pending.confirmKey ?? "common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
