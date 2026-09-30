/**
 * Debounced autosave for dirty buffers that already have a path on disk.
 *
 * Untitled buffers are not autosaved to disk — they are captured by the session
 * snapshot instead, so a crash still loses nothing.
 */
import { t } from "./i18n";
import { getPlatform } from "./platform";
import type { JsonValue } from "./platform/types";
import { saveAllDirty, useEditor } from "./stores/editor";
import { useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";
import { isDocumentDirty } from "./types";

const RECOVERY_KEY = "recovery";

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let inFlight = false;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

async function performSave(): Promise<void> {
  // Every dirty tab with a path, not just the one on screen. A background tab
  // is the one nobody is watching, so it is the one autosave has to reach.
  if (inFlight) return;
  inFlight = true;
  try {
    await saveAllDirty();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useUi.getState().notify("error", t("core.autosaveFailed", { message }));
  } finally {
    inFlight = false;
  }
}

function schedule(): void {
  clearTimer();
  const { autoSave, autoSaveIntervalMs } = useSettings.getState().settings;
  if (!autoSave) return;
  timer = setTimeout(
    () => {
      timer = null;
      void performSave();
    },
    Math.max(100, autoSaveIntervalMs),
  );
}

/** Write any pending change immediately. Call on blur, save hotkey and shutdown. */
export async function flushAutosave(): Promise<void> {
  clearTimer();
  await performSave();
}

/** Watch the editor buffer and keep the file on disk in sync. */
export function startAutosave(): () => void {
  if (unsubscribe) return unsubscribe;

  // Content per tab rather than the active buffer: an edit in a background tab
  // is an edit that needs saving just as much, and nothing else would notice.
  let lastContents = useEditor.getState().tabs.map((t) => t.content);

  unsubscribe = useEditor.subscribe((state) => {
    const contents = state.tabs.map((t) => t.content);
    const unchanged =
      contents.length === lastContents.length && contents.every((c, i) => c === lastContents[i]);
    if (unchanged) return;
    lastContents = contents;
    schedule();
  });

  return unsubscribe;
}

export function stopAutosave(): void {
  clearTimer();
  unsubscribe?.();
  unsubscribe = null;
}

/** Persist an unsaved buffer so a crash cannot lose work. Cheap, caller throttles. */
export async function saveRecoveryBuffer(): Promise<void> {
  const doc = useEditor.getState().doc;
  if (!doc || !isDocumentDirty(doc)) return;
  try {
    const buffer: JsonValue = {
      path: doc.path,
      fileName: doc.fileName,
      content: doc.content,
      savedAt: Date.now(),
    };
    await getPlatform().writeAppData(RECOVERY_KEY, buffer);
  } catch {
    // Recovery buffer is best-effort.
  }
}
