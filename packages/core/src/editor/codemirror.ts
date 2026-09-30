/**
 * CodeMirror 6 editing surface.
 *
 * The *source mode* half of the editor adapter (ADR-0001 §2.9) — Milkdown owns
 * WYSIWYG, which is what the app mounts by default since M2. This module holds
 * no mode logic of its own: `editor/surface.ts` decides which engine is live and
 * swaps this one in and out. It lives in `core/editor` rather than in the UI
 * layer precisely so that wiring is a one-file change.
 *
 * The theme reads CSS custom properties, so switching light/dark repaints the
 * editor without rebuilding its configuration.
 */
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, SearchQuery, selectNextOccurrence } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import type {
  FindMatch,
  FindRequest,
  ImageInsertion,
  MarkdownEditorHandle,
  MarkdownEditorOptions,
  ReplaceRequest,
} from "./handle";
import {
  replaceCovered,
  replaceEverything,
  stepBackward,
  stepForward,
  type FindGlue,
} from "./find";
import { headingsOf } from "../outline";

export type { MarkdownEditorHandle, MarkdownEditorOptions };

const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--fg)",
    backgroundColor: "var(--bg)",
    fontSize: "var(--editor-font-size)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-editor)",
    lineHeight: "var(--editor-line-height)",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "28px 0 40vh",
    caretColor: "var(--accent)",
    maxWidth: "var(--editor-max-width)",
    margin: "0 auto",
  },
  ".cm-line": { padding: "0 32px" },
  ".cm-gutters": {
    backgroundColor: "var(--bg)",
    color: "var(--fg-subtle)",
    border: "none",
    borderRight: "1px solid var(--border-subtle)",
    userSelect: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--fg)",
  },
  ".cm-activeLine": { backgroundColor: "var(--bg-active-line)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--search-match)",
    outline: "1px solid var(--search-match-border)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--search-match-active)" },
  ".cm-panels": {
    backgroundColor: "var(--bg-elevated)",
    color: "var(--fg)",
    border: "none",
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panels input, .cm-panels button": {
    fontFamily: "var(--font-ui)",
    color: "var(--fg)",
    backgroundColor: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 8px",
  },
  ".cm-panels button:hover": { backgroundColor: "var(--bg-hover)" },
});

/** Shared editor configuration — cheap to build, safe to rebuild on option change. */
export function createMarkdownExtensions(options: {
  onChange: (text: string) => void;
  onCursorChange?: (line: number, column: number) => void;
}): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    indentUnit.of("  "),
    markdown(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    baseTheme,
    EditorView.lineWrapping,
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      // Mod-d only: the rest of `searchKeymap` is not here on purpose. Its Mod-f
      // runs `openSearchPanel`, which *appends* CodeMirror's own search panel to
      // this editor if it is not already configured — so the app would have two
      // find bars in source mode and one in WYSIWYG. Find and replace is
      // app-level UI calling `MarkdownEditorHandle`, and it looks the same in
      // both modes (ADR-0001 §2.3, §2.11).
      { key: "Mod-d", run: selectNextOccurrence },
    ]),
    EditorView.updateListener.of((update) => {
      // Every document change is an edit as far as this listener is concerned.
      // A programmatic swap is silent because `createSourceEditor` wraps
      // `onChange` around it, not because a transaction carries a flag.
      if (update.docChanged) {
        options.onChange(update.state.doc.toString());
      }
      if (update.docChanged || update.selectionSet) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        options.onCursorChange?.(line.number, head - line.from + 1);
      }
    }),
  ];
}

/**
 * Wire one find request up to CodeMirror's own search machinery.
 *
 * `SearchQuery.getCursor` is the same iterator the built-in find panel walks,
 * so a match is a match whichever find bar produced it. The policy in
 * `editor/find.ts` then decides what to do with those matches.
 */
function findGlue(
  view: EditorView,
  request: FindRequest,
  replacement: string,
): FindGlue<{ from: number; to: number }> {
  const query = new SearchQuery({
    search: request.query,
    caseSensitive: request.caseSensitive === true,
    regexp: request.regex === true,
  });

  return {
    get selection() {
      return { from: view.state.selection.main.from, to: view.state.selection.main.to };
    },
    span(match) {
      return match;
    },
    all() {
      const hits: { from: number; to: number }[] = [];
      // An empty or malformed query has no cursor at all.
      if (!query.valid) return hits;
      const cursor = query.getCursor(view.state);
      for (let step = cursor.next(); !step.done; step = cursor.next()) {
        const hit = step.value;
        hits.push({ from: hit.from, to: hit.to });
        // A zero-width match — `a*` against "bbb" — never advances the cursor
        // on its own, so the loop has to be the one that moves.
        if (hit.to === hit.from) break;
      }
      return hits;
    },
    select(match) {
      view.dispatch({
        selection: EditorSelection.single(match.from, match.to),
        effects: EditorView.scrollIntoView(match.from),
      });
    },
    apply(matches) {
      // One transaction for the whole batch, front to back: CodeMirror applies
      // a `changes` list against the positions as they were, so the list is
      // safe in document order and 「全部替换」 lands as a single undo step.
      const last = matches[matches.length - 1];
      if (!last) return;
      // Where the caret belongs afterwards is the end of the final replacement
      // *after* every edit before it has moved the text — not `last.to`, which
      // is a coordinate in the document being thrown away.
      let shift = 0;
      for (const match of matches) shift += replacement.length - (match.to - match.from);
      view.dispatch({
        changes: matches.map((match) => ({
          from: match.from,
          to: match.to,
          insert: replacement,
        })),
        selection: EditorSelection.single(last.to + shift),
      });
    },
  };
}

/**
 * Mount a source-mode editor over `options.parent`.
 *
 * Synchronous — CodeMirror boots synchronously — but it fills the same
 * `MarkdownEditorHandle` as the WYSIWYG engine, `destroy` included, so callers
 * never learn which one they are holding. That is the whole point of
 * `editor/handle.ts`.
 */
export function createSourceEditor(options: MarkdownEditorOptions): MarkdownEditorHandle {
  let spellcheck = options.spellcheck !== false;

  /**
   * True while a document is being swapped in rather than edited.
   *
   * `setContent` is not a user edit and must not report one — see
   * `tests/handle-contract.test.ts`. The WYSIWYG engine guards the same way.
   */
  let applying = false;

  // Built once and reused by every `setContent`: the configuration is the
  // editor's identity, and the document is the only thing that changes.
  const extensions = createMarkdownExtensions({
    onChange(text) {
      if (applying) return;
      options.onChange(text);
    },
    onCursorChange: options.onCursorChange,
  });

  const view = new EditorView({
    state: EditorState.create({ doc: options.doc, extensions }),
    parent: options.parent,
  });

  // Spellcheck is applied to the editable element rather than configured as an
  // extension: it is the only per-engine detail of the setting, and
  // `setSpellcheck` has to reach the same place to change it later.
  view.contentDOM.spellcheck = spellcheck;

  return {
    setContent(text) {
      // A whole new state rather than a change to the current one. A full-text
      // `changes` transaction would leave the old document sitting in the
      // history, and Ctrl+Z in the newly opened file would hand the reader the
      // previous file's text. Replacing the state drops that history with the
      // document that owned it, which is what `handle.ts` promises.
      applying = true;
      try {
        view.setState(EditorState.create({ doc: text, extensions }));
      } finally {
        applying = false;
      }
      // `setState` builds a new contenteditable, so the setting goes back on
      // the element that is actually there now.
      view.contentDOM.spellcheck = spellcheck;
    },
    getContent() {
      return view.state.doc.toString();
    },
    focus() {
      view.focus();
    },
    revealHeading(target) {
      // Resolved through the same parse the outline is built from rather than
      // by scanning for `#{1,6}`: a `#` inside a fenced block, or an inline
      // `*emphasis*` in the title, would otherwise send this to a different
      // heading than the one the reader clicked.
      let matched = 0;
      for (const heading of headingsOf(view.state.doc.toString())) {
        if (heading.level !== target.level || heading.text !== target.text) continue;
        if (matched !== target.occurrence) {
          matched += 1;
          continue;
        }
        if (heading.line < 1) return false;
        const line = view.state.doc.line(heading.line);
        view.dispatch({
          selection: EditorSelection.single(line.from),
          effects: EditorView.scrollIntoView(line.from, { y: "start" }),
        });
        view.focus();
        return true;
      }
      return false;
    },
    insertImage(image) {
      // Source mode is text, so an image is the Markdown for one. The title is
      // omitted entirely rather than written empty, which is how a title-less
      // image is spelled.
      const title = image.title ? ' "' + image.title + '"' : "";
      view.dispatch(view.state.replaceSelection("![" + image.alt + "](" + image.url + title + ")"));
    },
    findNext(request: FindRequest): FindMatch | null {
      return stepForward(findGlue(view, request, ""));
    },
    findPrevious(request: FindRequest): FindMatch | null {
      return stepBackward(findGlue(view, request, ""));
    },
    replace(request: ReplaceRequest): boolean {
      return replaceCovered(findGlue(view, request, request.replacement));
    },
    replaceAll(request: ReplaceRequest): number {
      return replaceEverything(findGlue(view, request, request.replacement));
    },
    setSpellcheck(enabled) {
      spellcheck = enabled;
      view.contentDOM.spellcheck = enabled;
    },
    undo() {
      undo(view);
    },
    redo() {
      redo(view);
    },
    async destroy() {
      view.destroy();
    },
  };
}
