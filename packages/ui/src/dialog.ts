/**
 * Promise-based confirmation dialog.
 *
 * Tauri's WebView does not implement `window.confirm`, so the app owns this.
 * Supports a third action so "save / don't save / cancel" is expressible —
 * a plain boolean confirm cannot express the standard dirty-close prompt.
 *
 * Options carry i18n keys rather than copy: a dialog can sit open indefinitely,
 * and it must follow a language switch instead of freezing the old wording.
 */
import { create } from "zustand";

export type DialogAnswer = "confirm" | "cancel" | "alternative";

export interface ConfirmOptions {
  titleKey: string;
  messageKey: string;
  messageParams?: Record<string, unknown>;
  /** Defaults to `common.ok`. */
  confirmKey?: string;
  /** Defaults to `common.cancel`. */
  cancelKey?: string;
  /** Optional middle action, e.g. "Don't save". */
  alternativeKey?: string;
  /** Renders the confirm button in the danger colour. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: DialogAnswer) => void;
}

interface DialogState {
  pending: PendingConfirm | null;
  open: (options: ConfirmOptions) => Promise<DialogAnswer>;
  settle: (value: DialogAnswer) => void;
}

export const useDialog = create<DialogState>()((set, get) => ({
  pending: null,

  open(options) {
    // Only one confirmation at a time; a new call supersedes any pending one.
    get().pending?.resolve("cancel");
    return new Promise<DialogAnswer>((resolve) => {
      set({ pending: { ...options, resolve } });
    });
  },

  settle(value) {
    get().pending?.resolve(value);
    set({ pending: null });
  },
}));

/** Convenience wrapper for callers that do not need the store. */
export function confirmAction(options: ConfirmOptions): Promise<DialogAnswer> {
  return useDialog.getState().open(options);
}
