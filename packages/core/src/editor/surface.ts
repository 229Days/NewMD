/**
 * The surface the app mounts: one editor that can become the other one.
 *
 * ADR-0001 §2.9 describes a mode switch as unmounting Milkdown and mounting
 * CodeMirror 6 over the same parent. That is a swap between two engines, and
 * neither engine can perform it — a Milkdown handle cannot turn into a
 * CodeMirror one. So the swap is owned here, one layer above the engines and
 * one below the UI, and callers only ever hold `MarkdownSurface`.
 *
 * This is also where the ADR §2.3 boundary is enforced in practice: `EditorPane`
 * imports this file and nothing else from the editor package, so it cannot grow
 * an opinion about which engine is running, and replacing Milkdown with bare
 * ProseMirror still means editing `editor/wysiwyg.ts` alone.
 */
import type {
  ImageInsertion,
  MarkdownEditorHandle,
  MarkdownEditorMode,
  MarkdownEditorOptions,
  MarkdownSurface,
} from "./handle";
import { createSourceEditor } from "./codemirror";
import { imageFileOf, savePastedImage } from "./paste-image";
import { createWysiwygEditor } from "./wysiwyg";

/**
 * Mount an editing surface over `options.parent`.
 *
 * Asynchronous even though source mode boots synchronously, because WYSIWYG
 * does not and a caller should not have to know which one it asked for. The
 * promise resolves once the surface is usable.
 */
export async function createMarkdownEditor(
  options: MarkdownEditorOptions,
): Promise<MarkdownSurface> {
  let mode: MarkdownEditorMode = options.mode ?? "wysiwyg";
  let spellcheck = options.spellcheck !== false;
  let handle: MarkdownEditorHandle = await mount(mode, options.doc);

  /**
   * Write a pasted image to disk, then put its relative path at the cursor.
   *
   * The listener sits on `options.parent` in the capture phase, and that is
   * what lets one implementation cover both engines. Each engine binds its own
   * paste handler to its own editable element, further down the same path, so
   * capturing here runs first and stopping the event means neither of them is
   * ever handed a clipboard carrying a picture and no text — the WYSIWYG
   * engine would otherwise fall through to its "nothing to paste" path and
   * leave a stray textarea behind.
   *
   * Claimed only when there is something to claim with: an image on the
   * clipboard *and* a file to write it beside. A buffer that has never been
   * saved has no `./assets/` to write into, and taking the paste anyway would
   * drop the picture silently — which is worse than letting the browser do
   * what it does with a paste it does not understand.
   */
  const onPaste = (event: ClipboardEvent): void => {
    const file = imageFileOf(event);
    const target = options.imageTarget?.() ?? null;
    if (file === null || target === null) return;
    event.preventDefault();
    event.stopPropagation();

    // `handle` is read inside the callback rather than captured now: the
    // surface can swap engines while the write is in flight, and the path
    // belongs in whichever one is live when it lands.
    void savePastedImage(target, file)
      .then((relative) => handle.insertImage({ url: relative, alt: "" }))
      .catch((error: unknown) => options.onImageError?.(error));
  };
  options.parent.addEventListener("paste", onPaste, { capture: true });

  /**
   * Boot one engine with the state that has to survive the swap.
   *
   * `spellcheck` is read from here rather than from `options` because the user
   * can flip it while a surface is showing, and a switch must not quietly reset
   * it back to whatever the mount options said.
   */
  async function mount(which: MarkdownEditorMode, doc: string): Promise<MarkdownEditorHandle> {
    const shared: MarkdownEditorOptions = {
      parent: options.parent,
      doc,
      onChange: options.onChange,
      onCursorChange: options.onCursorChange,
      spellcheck,
      imageTarget: options.imageTarget,
      onImageError: options.onImageError,
    };
    return which === "source" ? createSourceEditor(shared) : await createWysiwygEditor(shared);
  }

  /**
   * Swaps queued one behind the other.
   *
   * `setMode` is not atomic — it reads the document, destroys one engine and
   * mounts another, with awaits in between. Two calls in the same tick would
   * otherwise both reach for the same handle: the second would see a `mode` the
   * first has not updated yet, and would either destroy an engine already being
   * torn down or quietly do nothing. A shortcut key makes that mundane.
   */
  let queued: Promise<void> = Promise.resolve();

  return {
    get mode() {
      return mode;
    },
    setContent(text) {
      handle.setContent(text);
    },
    getContent() {
      return handle.getContent();
    },
    focus() {
      handle.focus();
    },
    insertImage(image: ImageInsertion) {
      handle.insertImage(image);
    },
    revealHeading(target) {
      return handle.revealHeading(target);
    },
    findNext(request) {
      return handle.findNext(request);
    },
    findPrevious(request) {
      return handle.findPrevious(request);
    },
    replace(request) {
      return handle.replace(request);
    },
    replaceAll(request) {
      return handle.replaceAll(request);
    },
    undo() {
      handle.undo();
    },
    redo() {
      handle.redo();
    },
    setSpellcheck(enabled) {
      spellcheck = enabled;
      handle.setSpellcheck(enabled);
    },
    setMode(next) {
      const run = queued.then(async () => {
        if (next === mode) return;
        // Read the document before tearing the engine down — once it is gone the
        // text exists nowhere else. This is the whole of the ADR's
        // 「切换 1000 行文档无丢内容」 requirement.
        const doc = handle.getContent();
        await handle.destroy();
        mode = next;
        handle = await mount(next, doc);
      });
      // A failed swap must not wedge the queue behind it.
      queued = run.catch(() => undefined);
      return run;
    },
    async destroy() {
      options.parent.removeEventListener("paste", onPaste, { capture: true });
      await handle.destroy();
    },
  };
}
