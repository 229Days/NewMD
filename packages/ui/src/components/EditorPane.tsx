import { useEditor, useSettings, useUi, type OpenDocument } from "@newmd/core";
import { createMarkdownEditor, type MarkdownSurface } from "@newmd/core/editor";
import { useEffect, useRef, useState } from "react";
import { errorMessage, handleNewDocument, handleOpenFile, handleOpenFolder } from "../actions";
import { useT } from "../hooks/useT";
import { FindReplace } from "./FindReplace";

/**
 * Which document a tab is, as `stores/editor.ts` defines it.
 *
 * Pushing content into the surface is keyed on this as well as on the text
 * itself, because text alone cannot tell a tab switch from an echo: two empty
 * tabs hold the same bytes and are not the same document.
 */
function docKeyOf(doc: OpenDocument | null): string | null {
  return doc === null ? null : JSON.stringify([doc.path, doc.fileName]);
}

function EmptyState() {
  const t = useT();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)]">
      <div className="max-w-sm text-center">
        <h2 className="mb-2 text-[15px] font-semibold text-[var(--fg)]">{t("editor.noFile")}</h2>
        <p className="mb-5 text-[13px] leading-relaxed text-[var(--fg-muted)]">
          {t("editor.emptyHint")}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void handleNewDocument()}
            className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            {t("editor.newDocument")}
          </button>
          <button
            type="button"
            onClick={() => void handleOpenFile()}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            {t("editor.openFile")}
          </button>
          <button
            type="button"
            onClick={() => void handleOpenFolder()}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--fg)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            {t("editor.openFolder")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MarkdownSurface | null>(null);
  /** Last text the editor itself produced, so we skip echo updates. */
  const lastEmittedRef = useRef<string | null>(null);
  /** Which tab that text belonged to — see `docKeyOf`. */
  const lastKeyRef = useRef<string | null>(null);

  const doc = useEditor((s) => s.doc);
  const spellcheck = useSettings((s) => s.settings.spellcheck);
  const mode = useUi((s) => s.mode);
  const reveal = useUi((s) => s.reveal);
  // `t` resolves the locale when it is called, not when it is read here, so a
  // toast raised long after this render still comes out in the current one.
  const t = useT();
  /** Once a surface exists to carry the jump. */
  const [mounted, setMounted] = useState(false);

  // Create the editor exactly once; remounting it would drop undo history.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initial = useEditor.getState().doc?.content ?? "";
    lastEmittedRef.current = initial;
    lastKeyRef.current = docKeyOf(useEditor.getState().doc);

    // Milkdown boots asynchronously — schema, parser and serializer are all
    // assembled before the surface exists — so the effect has to cope with being
    // torn down mid-boot rather than leave an orphaned editor in the DOM.
    let cancelled = false;
    let handle: MarkdownSurface | null = null;

    void createMarkdownEditor({
      parent: host,
      doc: initial,
      spellcheck: useSettings.getState().settings.spellcheck,
      mode: useUi.getState().mode,
      // Read per paste rather than captured here: this surface outlives tab
      // switches, and a screenshot must not land in the folder of whichever
      // document was open when the editor booted (ADR-0001 §2.8).
      imageTarget() {
        const current = useEditor.getState().doc;
        if (!current?.path) return null;
        return { docPath: current.path, dirName: useSettings.getState().settings.imageDirName };
      },
      // The paste has already been claimed by the time this runs, so without
      // it a failed write would take the picture with it and say nothing.
      onImageError(error) {
        useUi
          .getState()
          .notify("error", t("editor.imagePasteFailed", { message: errorMessage(error) }));
      },
      onChange(text) {
        lastEmittedRef.current = text;
        useEditor.getState().updateContent(text);
      },
      onCursorChange(line, column) {
        useUi.getState().setCursor(line, column);
      },
    }).then((created) => {
      if (cancelled) {
        void created.destroy();
        return;
      }
      handle = created;
      handleRef.current = created;
      setMounted(true);

      // The store moves while the surface boots: pick up whatever arrived, and
      // any spellcheck flip along with it. `setContent` skips its own echo, so
      // this cannot feed back into `onChange`.
      const current = useEditor.getState().doc?.content ?? "";
      if (current !== initial) {
        lastEmittedRef.current = current;
        created.setContent(current);
      }
      created.setSpellcheck(useSettings.getState().settings.spellcheck);
      // The mode can flip mid-boot too.
      void created.setMode(useUi.getState().mode);
    });

    return () => {
      cancelled = true;
      handleRef.current = null;
      setMounted(false);
      if (handle) void handle.destroy();
    };
  }, []);

  // Push store content into the editor. Skips the echo from our own typing, but
  // never skips a tab switch: two tabs can hold the same text and are still two
  // documents, and the surface has to be handed the new one whole so the undo
  // history of the old one cannot come back in it (ADR-0001 §4 M3).
  const docKey = docKeyOf(doc);
  const docContent = doc?.content ?? "";
  useEffect(() => {
    if (docContent === lastEmittedRef.current && docKey === lastKeyRef.current) return;
    lastEmittedRef.current = docContent;
    lastKeyRef.current = docKey;
    handleRef.current?.setContent(docContent);
  }, [docKey, docContent]);

  // The outline's jump. Keyed on `seq` rather than on the target so that
  // clicking the same heading twice is two jumps, and held until a surface is
  // there to take it: a request that arrived mid-boot would otherwise be
  // swallowed, which is a silent failure in the milestone's acceptance path.
  useEffect(() => {
    if (reveal === null || !mounted) return;
    handleRef.current?.revealHeading(reveal.target);
  }, [reveal, mounted]);

  // Spellcheck is a handle method, not a DOM lookup: which element is editable
  // is the engine's business (ADR-0001 §2.3).
  useEffect(() => {
    handleRef.current?.setSpellcheck(spellcheck);
  }, [spellcheck]);

  // The mode is a surface swap rather than a style: the adapter owns the
  // exchange of engines (ADR-0001 §2.9) and this only names the one that should
  // be live.
  useEffect(() => {
    void handleRef.current?.setMode(mode);
  }, [mode]);

  return (
    <div className="relative min-h-0 flex-1 bg-[var(--bg)]">
      <div ref={hostRef} className="h-full w-full" />
      {/* Handed the ref rather than the surface: the bar only needs it when the
          reader presses something, and no re-render is worth a boot-time one. */}
      <FindReplace surfaceRef={handleRef} />
      {!doc && <EmptyState />}
    </div>
  );
}
