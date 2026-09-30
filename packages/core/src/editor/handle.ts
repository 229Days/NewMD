/**
 * The editor surface, described without naming an engine (ADR-0001 §2.3).
 *
 * Both editing surfaces implement this: CodeMirror 6 as source mode, Milkdown as
 * WYSIWYG. Anything a caller needs from an editor belongs here, and anything
 * engine-shaped — a CodeMirror `EditorView`, a Milkdown `Ctx` — does not, because
 * the moment one leaks out the caller has to know which engine it is talking to
 * and swapping the engine stops being a one-file change.
 *
 * That is also why spellcheck is a method rather than a DOM lookup: the
 * contenteditable a caller would poke at has a different class in each engine.
 */
import type { ImageTarget } from "./paste-image";

export interface MarkdownEditorOptions {
  /** Element to mount the editing surface into. */
  parent: HTMLElement;
  /** Markdown to open with. */
  doc: string;
  /** Fires with the full Markdown whenever the user changes the document. */
  onChange: (text: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  spellcheck?: boolean;
  /** Surface to start in. WYSIWYG is the default (ADR-0001 §2.2). */
  mode?: MarkdownEditorMode;
  /**
   * Where a pasted image may be written, or null when the buffer has never
   * been saved and there is no directory to write it beside (ADR-0001 §2.8).
   *
   * A getter rather than a value: the surface is mounted once and lives
   * through tab switches, so a path read at mount time would be the previous
   * document's by the time anyone pastes.
   */
  imageTarget?: () => ImageTarget | null;
  /**
   * A pasted image could not be written. Nothing else would say so — the
   * paste has already been claimed, so without this the picture is simply
   * gone.
   */
  onImageError?: (error: unknown) => void;
}

/**
 * Which of the two surfaces is showing the document (ADR-0001 §2.9).
 *
 * WYSIWYG is Milkdown; source is CodeMirror 6 showing the raw Markdown. They
 * are not two views of one editor — a switch unmounts one engine and mounts the
 * other — which is why this is a property of the surface and not of the
 * document.
 */
export type MarkdownEditorMode = "wysiwyg" | "source";

/**
 * A heading an outline entry points at.
 *
 * Identified by what the heading *is* rather than by where it sits. A position
 * in Markdown text means nothing to the WYSIWYG surface, which holds
 * ProseMirror nodes and has no lines at all — so an anchor in offsets or lines
 * could only ever be resolved by the source engine, and 「大纲点击可跳转」 would
 * stop holding in the mode the app opens in. Each engine finds the heading in
 * whatever it actually holds, which is why the anchor is spelled out in
 * Markdown terms that both can answer to.
 */
export interface HeadingTarget {
  /** 1–6, as Markdown depth. */
  level: number;
  /** Heading text with markers, emphasis and links flattened away. */
  text: string;
  /** Which of the headings at this level with this text, counting from 0. */
  occurrence: number;
}

/** An image to place at the cursor. A missing `title` means no tooltip. */
export interface ImageInsertion {
  alt: string;
  url: string;
  title?: string;
}

/**
 * What to look for.
 *
 * Plain text by default: find is a reader's tool before it is a power user's,
 * so a query is not a regular expression unless the caller says it is.
 */
export interface FindRequest {
  query: string;
  /**
   * Match case. Off by default — `Cat` and `cat` are the same word to someone
   * looking for a heading they half-remember.
   */
  caseSensitive?: boolean;
  /** Treat `query` as a JavaScript regular expression. */
  regex?: boolean;
}

export interface ReplaceRequest extends FindRequest {
  replacement: string;
}

/**
 * Where a match sits, as offsets into the engine's own document.
 *
 * Offsets are for the caller to report ("3 / 12"), not to edit with: a
 * ProseMirror document has node boundaries its Markdown has none of, so these
 * numbers do not survive a mode switch and are not Markdown text offsets.
 */
export interface FindMatch {
  from: number;
  to: number;
}

/**
 * What one editing engine owes the app.
 *
 * A single engine cannot honour `setMode` — switching means becoming a
 * different engine — so that method lives on `MarkdownSurface` instead, which
 * is what callers hold. Keeping the two apart is what lets
 * `tests/handle-contract.test.ts` run this contract against each engine on its
 * own.
 */
export interface MarkdownEditorHandle {
  /**
   * Hand the surface a different document.
   *
   * This is a document replacement, not an edit of the current one: the text
   * takes over and the undo history is dropped with the document that owned it.
   * Loading a file, switching tabs and recovering a buffer all mean "you are
   * now looking at something else", and a history that carried across would
   * offer the previous document's text as an undo step of this one. Callers are
   * expected to suppress their own echo, since the swap is not an edit and must
   * not be reported as one.
   */
  setContent(text: string): void;
  /** The document as Markdown — exactly what a save must write. */
  getContent(): string;
  focus(): void;
  /** Place an image at the cursor (ADR-0001 §4 M2: 图片插入). */
  insertImage(image: ImageInsertion): void;
  /**
   * Move the caret to the heading `target` names and scroll it into view.
   *
   * Returns whether such a heading was there. A `false` is a no-op rather than
   * a jump to the nearest thing: the outline is built from the document, so a
   * miss means the two have drifted, and putting the reader somewhere else
   * would hide that instead of showing it.
   */
  revealHeading(target: HeadingTarget): boolean;
  setSpellcheck(enabled: boolean): void;

  /**
   * Select the next match after the selection and return it, wrapping at the
   * end. `null` when nothing matches — a caller showing 「0 / 0」 needs to be
   * able to tell "not found" from "found the first one again".
   */
  findNext(request: FindRequest): FindMatch | null;
  /** As `findNext`, walking the other way. */
  findPrevious(request: FindRequest): FindMatch | null;
  /**
   * Replace the match the selection is sitting on and step to the next one.
   *
   * When the selection is not a match this only steps, exactly as `findNext`
   * does, so the Replace button is a one-key loop the way it is everywhere
   * else. Returns whether the document changed.
   */
  replace(request: ReplaceRequest): boolean;
  /** Replace every match. Returns how many replacements were made. */
  replaceAll(request: ReplaceRequest): number;

  /** Undo the last edit of the current document. No-op when there is none. */
  undo(): void;
  /** Redo the last undone edit of the current document. */
  redo(): void;

  /** Release the surface. Resolves once the engine has torn itself down. */
  destroy(): Promise<void>;
}

/**
 * What the app holds: one engine's contract, plus the ability to become the
 * other one (ADR-0001 §2.9 双向切换).
 *
 * This is the only type UI code is allowed to see. It never names an engine, so
 * the component that hosts the editor cannot grow an opinion about which one is
 * running — which is the whole promise of ADR-0001 §2.3.
 */
export interface MarkdownSurface extends MarkdownEditorHandle {
  readonly mode: MarkdownEditorMode;
  /**
   * Swap the surface for the other one, carrying the document over byte for
   * byte. Switching to the mode already showing is a no-op.
   */
  setMode(mode: MarkdownEditorMode): Promise<void>;
}
