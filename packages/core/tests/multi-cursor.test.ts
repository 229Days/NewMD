/**
 * Several carets at once, in source mode (HANDOFF §4 ②, ADR-0001 §2.9).
 *
 * CodeMirror can hold a selection with more than one range — that is what a
 * column selection is, and what `Mod-d` grows — but only if the editor says so.
 * `EditorState.allowMultipleSelections` is a facet that nothing in
 * `@codemirror/*` sets, and `applyTransaction` reads it as
 * `tr.newSelection.asSingle()` when it is absent. So without it every gesture
 * below *appears* to work for one step and then quietly keeps one range: the
 * second `Mod-d` looks like a no-op, and typing lands at one caret out of three.
 *
 * Two of the four gestures the reader has are pointer gestures, and jsdom lays
 * nothing out — there is no `caretPositionFromPoint`, no line boxes, so an
 * Alt-click or an Alt-drag cannot be performed here. What each of them leaves
 * behind is a transaction carrying several ranges, and that is what these tests
 * drive instead. The pointers themselves are on the manual checklist.
 *
 * Two engine symbols appear here, which no other core test needs. They are the
 * only way to observe the thing under test: `MarkdownEditorHandle` is
 * deliberately narrower than either engine (ADR-0001 §2.3), and widening it so
 * that a test could look inside would hand every caller the same leak. The
 * confinement rule is about `src/editor/`, and this file is not that.
 */
// @vitest-environment jsdom
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createSourceEditor } from "../src/editor/codemirror";
import type { MarkdownEditorHandle } from "../src/editor/handle";

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Mounted {
  handle: MarkdownEditorHandle;
  view: EditorView;
}

function mount(doc: string): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const handle = createSourceEditor({ parent: host, doc, onChange: () => {} });
  cleanups.push(
    () => handle.destroy(),
    () => host.remove(),
  );

  // Reached from the element the editor drew itself into, which is the only
  // door left once the handle is out — and `findFromDOM` is public API for
  // exactly this.
  const view = EditorView.findFromDOM(host);
  if (view === null) throw new Error("the editor mounted without a view");
  return { handle, view };
}

/**
 * Press `Mod-d` for real, through the keymap `codemirror.ts` registered.
 *
 * The binding is the thing under test as much as the command is: an editor that
 * can hold several ranges but never grows a second one is the same editor to
 * the reader. jsdom reports a platform that is not a Mac, so `Mod` resolves to
 * Ctrl here for the same reason it does on the machine this ships to.
 */
function pressModD(view: EditorView): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

describe("several carets at once in source mode", () => {
  it("keeps a range for every line an Alt-drag covered", () => {
    const { view } = mount("ab\ncd\n");

    // What the drag produces when it ends: one range per line it swept, in a
    // single transaction. Without the facet this state is built and then
    // thrown away one line in.
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)]),
    });

    expect(view.state.selection.ranges).toHaveLength(2);
  });

  it("answers Alt for the click that adds a caret, and only Alt", () => {
    const { view } = mount("cat\n");

    // One handler, and the app's own: reading the default here would be reading
    // CodeMirror's habit (Ctrl on Windows and Linux, Cmd on a Mac) rather than
    // the app's answer, and the two would agree by accident until someone moved
    // to a Mac.
    const [adds] = view.state.facet(EditorView.clickAddsSelectionRange);
    expect(adds).toBeTypeOf("function");

    expect(adds?.({ altKey: true } as MouseEvent)).toBe(true);
    // A plain click must not: every click in the editor would leave a caret
    // behind, and the one the reader meant would be whichever came last.
    expect(adds?.({ altKey: false } as MouseEvent)).toBe(false);
    // Alt is the key, and it is the *only* one, so the three gestures agree.
    expect(adds?.({ altKey: false, ctrlKey: true } as MouseEvent)).toBe(false);
  });

  it("keeps both occurrences when Mod-d is pressed twice", () => {
    const { view } = mount("cat dog cat\n");
    // The caret the reader would have: inside the first word, with nothing
    // selected yet. Mod-d selects that word, then finds the next one.
    view.dispatch({ selection: { anchor: 1 } });

    pressModD(view);
    pressModD(view);

    const { ranges } = view.state.selection;
    // Read as text rather than as offsets: what has to be true is that the word
    // is selected twice, not that it starts at byte 0.
    expect(ranges.map((range) => view.state.sliceDoc(range.from, range.to))).toEqual([
      "cat",
      "cat",
    ]);
  });

  it("puts the text at every caret", () => {
    const { handle, view } = mount("cat dog cat\n");
    view.dispatch({ selection: { anchor: 1 } });
    pressModD(view);
    pressModD(view);

    // The one call on the handle that goes through CodeMirror's
    // `replaceSelection`, which is the call typing makes. A keystroke itself
    // cannot be driven here: the editor writes into the DOM selection and reads
    // it back, and jsdom has no layout to reconcile the two with.
    handle.insertImage({ alt: "x", url: "./x.png" });

    expect(handle.getContent()).toBe("![x](./x.png) dog ![x](./x.png)\n");
  });
});
