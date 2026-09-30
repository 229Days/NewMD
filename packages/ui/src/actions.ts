/**
 * Orchestration layer: every user command goes through here so that dirty-state
 * guards, error handling and notifications live in one place instead of being
 * duplicated across buttons, hotkeys and menu items.
 */
import {
  type HeadingTarget,
  flushAutosave,
  getPlatform,
  isDocumentDirty,
  t,
  useEditor,
  useSettings,
  useUi,
  useWorkspace,
} from "@newmd/core";
import { saveLocalImage } from "@newmd/core/editor";
import { confirmAction } from "./dialog";

/** The part of an error worth showing: what went wrong, not its stack. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run a platform command with a busy cursor and a failure toast.
 *
 * `labelKey` is an i18n key, not the wording itself; the message is assembled
 * at notify time because the toast is short-lived and does not need to follow
 * a language switch.
 */
async function report<T>(labelKey: string, work: () => Promise<T>): Promise<T | undefined> {
  const ui = useUi.getState();
  ui.setBusy(true);
  try {
    return await work();
  } catch (err) {
    ui.notify("error", t("actions.failed", { label: t(labelKey), message: errorMessage(err) }));
    return undefined;
  } finally {
    ui.setBusy(false);
  }
}

/**
 * Returns true when it is safe to throw the tab at `index` away.
 * Prompts only when there is something to lose.
 *
 * Tabs changed what "throw away" means: opening a file beside another one no
 * longer discards anything, so only closing a tab still has to ask. Asking
 * about a named index rather than "the current buffer" keeps the question on
 * the tab actually being closed.
 */
async function ensureCanDiscard(index: number): Promise<boolean> {
  const doc = useEditor.getState().tabs[index] ?? null;
  if (!isDocumentDirty(doc)) return true;

  const answer = await confirmAction({
    titleKey: "dialog.unsavedTitle",
    messageKey: "dialog.unsavedMessage",
    messageParams: { name: doc?.fileName ?? t("common.untitled") },
    confirmKey: "dialog.save",
    alternativeKey: "dialog.dontSave",
    danger: true,
  });

  if (answer === "cancel") return false;
  if (answer === "alternative") return true;

  return useEditor.getState().saveTab(index);
}

export async function handleNewDocument(): Promise<void> {
  useEditor.getState().newDocument();
  useUi.getState().notify("info", t("actions.newDocumentCreated"));
}

export async function handleOpenFile(): Promise<void> {
  await report("actions.openFile", async () => {
    const platform = getPlatform();
    const path = await platform.pickFile([
      { name: t("common.markdown"), extensions: ["md", "markdown"] },
    ]);
    if (!path) return;
    await useEditor.getState().openPath(path);
  });
}

export async function handleOpenPath(path: string): Promise<void> {
  // No dirty guard and no "already open" short-circuit: `openPath` focuses the
  // tab that already holds this file, and neither action discards anything.
  await report("actions.openFile", () => useEditor.getState().openPath(path));
}

export async function handleOpenFolder(): Promise<void> {
  await report("actions.openFolder", async () => {
    const ok = await useWorkspace.getState().pickAndOpen();
    if (ok) useUi.getState().notify("success", t("actions.workspaceOpened"));
  });
}

export async function handleRefreshWorkspace(): Promise<void> {
  await report("actions.refresh", () => useWorkspace.getState().refresh());
}

/**
 * Expand or collapse a folder in the tree.
 *
 * Goes through `report` for the same reason the rest do: listing a directory is
 * a platform call, and one that fails silently leaves a folder claiming to be
 * open over nothing.
 */
export async function handleToggleDir(path: string): Promise<void> {
  await report("actions.expandFolder", () => useWorkspace.getState().toggleDir(path));
}

/**
 * Show a heading in the editor - the outline side of the milestone's
 * 「大纲点击可跳转」. Delivered through the store rather than a ref: the
 * sidebar is a sibling of the pane that holds the surface and has no way to
 * reach it, and the store is the one thing both can see.
 */
export function handleRevealHeading(target: HeadingTarget): void {
  useUi.getState().requestReveal(target);
}

export async function handleSave(): Promise<void> {
  await flushAutosave();
  await report("actions.save", async () => {
    const saved = await useEditor.getState().save();
    if (saved) useUi.getState().notify("success", t("actions.saved"));
  });
}

export async function handleSaveAs(): Promise<void> {
  await report("actions.saveAs", async () => {
    const saved = await useEditor.getState().saveAs();
    if (saved) useUi.getState().notify("success", t("actions.saved"));
  });
}

/** Close the tab at `index`, asking first if it holds unsaved work. */
export async function handleCloseTab(index: number): Promise<void> {
  if (!(await ensureCanDiscard(index))) return;
  useEditor.getState().closeTab(index);
}

export async function handleCloseDocument(): Promise<void> {
  await handleCloseTab(useEditor.getState().activeIndex);
}

export async function handleReloadFromDisk(): Promise<void> {
  const doc = useEditor.getState().doc;
  if (!doc?.path) return;
  if (isDocumentDirty(doc)) {
    const answer = await confirmAction({
      titleKey: "dialog.discardTitle",
      messageKey: "dialog.discardMessage",
      confirmKey: "dialog.reload",
      danger: true,
    });
    if (answer !== "confirm") return;
  }
  await report("actions.reload", () => useEditor.getState().reloadFromDisk());
}

export async function toggleTheme(): Promise<void> {
  const settings = useSettings.getState().settings;
  const next = settings.theme === "dark" ? "light" : "dark";
  await useSettings.getState().set("theme", next);
}

export function toggleSidebar(): void {
  useUi.getState().toggleSidebar();
}

export async function updateContent(content: string): Promise<void> {
  useEditor.getState().updateContent(content);
}

/**
 * Pick an image from disk and put a copy of it beside this document
 * (ADR-0001 §2.5 本地路径插入).
 *
 * §2.8 refuses to reference a file where it sits — the folder has to survive
 * being copied, zipped or pushed — so what goes into the Markdown is a link to
 * `./assets/` and never to the path the picker returned. That is also why an
 * unsaved document is turned away before the dialog opens: there is no
 * directory yet to put the copy in, and a picker that runs anyway offers a
 * choice the app cannot honour.
 *
 * The insert itself is a request rather than a call. The surface is private to
 * `EditorPane`, exactly as the outline's jump is, so the picture travels
 * through the store and lands wherever the caret is by the time it arrives.
 */
export async function handleInsertLocalImage(): Promise<void> {
  const docPath = useEditor.getState().doc?.path ?? null;
  if (docPath === null) {
    useUi.getState().notify("error", t("editor.needsSaveFirst"));
    return;
  }
  const target = { docPath, dirName: useSettings.getState().settings.imageDirName };

  const platform = getPlatform();
  const picked = await platform.pickFile([
    {
      // The name on the dialog filter is a word the reader sees, so it is
      // asked for like any other.
      name: t("editor.imageFilter"),
      extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif"],
    },
  ]);
  if (picked === null) return;

  await report("actions.insertImage", async () => {
    const relative = await saveLocalImage(target, picked);
    useUi
      .getState()
      .requestImageInsert({ url: relative, alt: platform.pathFileName(picked) ?? "" });
  });
}
