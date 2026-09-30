/**
 * Session snapshot: which workspace was open, which file was open, and any
 * unsaved buffer. Written on a debounce while the app runs, read once at boot
 * so a crash or an ordinary restart both come back where the user left off.
 */
import { t } from "./i18n";
import { getPlatform } from "./platform";
import type { JsonValue, PlatformAdapter } from "./platform/types";
import { useEditor } from "./stores/editor";
import { useUi } from "./stores/ui";
import { useWorkspace } from "./stores/workspace";
import { isDocumentDirty, type SessionSnapshot, type SessionTab } from "./types";

const SESSION_KEY = "session";

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

export function snapshotSession(): SessionSnapshot {
  const { tabs, activeIndex, doc } = useEditor.getState();
  return {
    workspacePath: useWorkspace.getState().rootPath,
    openFilePath: doc?.path ?? null,
    unsavedContent: doc && isDocumentDirty(doc) ? doc.content : null,
    // Every tab, not just the one showing. A crash takes the whole window with
    // it, so a snapshot of one buffer is a list with a single survivor.
    tabs: tabs.map((tab) => ({
      path: tab.path,
      fileName: tab.fileName,
      unsavedContent: isDocumentDirty(tab) ? tab.content : null,
    })),
    activeIndex: tabs.length === 0 ? null : activeIndex,
    sidebarOpen: useUi.getState().sidebarOpen,
    savedAt: Date.now(),
  };
}

async function writeSnapshot(): Promise<void> {
  try {
    await getPlatform().writeAppData(SESSION_KEY, snapshotSession());
  } catch {
    // Losing the session snapshot is survivable; the document itself is not.
  }
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void writeSnapshot();
  }, 500);
}

/** Persist the session on every relevant state change (debounced). */
export function startSessionPersistence(): () => void {
  if (unsubscribe) return unsubscribe;

  const track = () => schedule();
  const un1 = useEditor.subscribe(track);
  const un2 = useWorkspace.subscribe(track);
  const un3 = useUi.subscribe(track);

  unsubscribe = () => {
    un1();
    un2();
    un3();
    unsubscribe = null;
  };
  return unsubscribe;
}

export async function stopSessionPersistence(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  unsubscribe?.();
  await writeSnapshot();
}

/**
 * Read the tab list, tolerating whatever the store happens to hold.
 *
 * Returns `null` for a snapshot with no list at all — which is the shape a
 * build from before tabs wrote, and the one `restoreSession` falls back on.
 */
function parseTabs(raw: JsonValue | undefined): SessionTab[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed: SessionTab[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const rec = entry as Record<string, JsonValue | undefined>;
    const { fileName, path, unsavedContent } = rec;
    if (typeof fileName !== "string") continue;
    parsed.push({
      path: typeof path === "string" ? path : null,
      fileName,
      unsavedContent: typeof unsavedContent === "string" ? unsavedContent : null,
    });
  }
  return parsed;
}

function parseSnapshot(raw: JsonValue | null): SessionSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  try {
    const parsed = raw as Record<string, JsonValue | undefined>;
    return {
      workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
      openFilePath: typeof parsed.openFilePath === "string" ? parsed.openFilePath : null,
      unsavedContent: typeof parsed.unsavedContent === "string" ? parsed.unsavedContent : null,
      tabs: parseTabs(parsed.tabs),
      activeIndex: typeof parsed.activeIndex === "number" ? parsed.activeIndex : null,
      sidebarOpen: parsed.sidebarOpen !== false,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Open one snapshotted tab and report the text it ended up holding.
 *
 * `null` when the tab cannot come back at all — a file that has since been
 * deleted or is no longer readable. One of those must not cost the reader the
 * rest of the session, so it is skipped rather than thrown out of the loop.
 */
async function openSnapshotTab(
  platform: PlatformAdapter,
  entry: SessionTab,
): Promise<string | null> {
  if (entry.path === null) {
    useEditor.getState().newDocument();
    return "";
  }
  try {
    if (!(await platform.pathExists(entry.path))) return null;
    await useEditor.getState().openPath(entry.path);
  } catch {
    return null;
  }
  return useEditor.getState().doc?.content ?? "";
}

/**
 * Restore the previous session. Returns true if anything was restored.
 * Failures are swallowed — a broken snapshot must not block startup.
 */
export async function restoreSession(): Promise<boolean> {
  const platform = getPlatform();
  const snapshot = parseSnapshot(await platform.readAppData(SESSION_KEY));
  if (!snapshot) return false;

  let restored = false;

  if (snapshot.workspacePath) {
    try {
      if (await platform.pathExists(snapshot.workspacePath)) {
        await useWorkspace.getState().openRoot(snapshot.workspacePath);
        useUi.getState().setSidebarOpen(snapshot.sidebarOpen);
        restored = true;
      }
    } catch {
      // Workspace vanished; fall through and start clean.
    }
  }

  // A snapshot with no tab list describes one buffer — what this file wrote
  // before tabs existed. Folded into the same shape rather than kept as a
  // second restore path, which is how two of those come to disagree.
  const tabs =
    snapshot.tabs ??
    (snapshot.openFilePath === null
      ? []
      : [{ path: snapshot.openFilePath, fileName: "", unsavedContent: snapshot.unsavedContent }]);
  const wanted = snapshot.activeIndex ?? 0;

  // Where the tab that was showing ended up, which is not where it started if
  // a tab before it failed to come back. -1 when it did not come back at all.
  let focus = -1;
  let recovered = false;

  for (const [index, entry] of tabs.entries()) {
    const opened = await openSnapshotTab(platform, entry);
    if (opened === null) continue;
    // Re-apply unsaved work on top of whatever is on disk now. Equal means
    // clean: a tab saved before the crash must not come back marked dirty.
    if (entry.unsavedContent !== null && entry.unsavedContent !== opened) {
      useEditor.getState().updateContent(entry.unsavedContent);
      recovered = true;
    }
    if (index === wanted) focus = useEditor.getState().activeIndex;
    restored = true;
  }

  if (focus >= 0) useEditor.getState().setActive(focus);
  if (recovered) useUi.getState().notify("info", t("core.recoveredUnsaved"));

  return restored;
}
