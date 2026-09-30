/**
 * The find-and-replace policy, shared by both engines (ADR-0001 §2.11).
 *
 * Which machinery locates a match is an engine detail — CodeMirror has
 * `SearchQuery`, ProseMirror has `prosemirror-search` — and both live in their
 * own adapter. What is *not* an engine detail is where the selection lands
 * after a step, when a replace is allowed to fire, and how a search wraps. Two
 * engines each running a copy of that policy would agree on the fixture and
 * disagree on the cases nobody wrote down, so the policy is written once here
 * and an adapter supplies only the glue.
 *
 * Match positions stay inside the engine's own document. A ProseMirror document
 * has node boundaries its Markdown has none of, so these numbers are not text
 * offsets and must not be compared across a mode switch — `FindMatch` in
 * `handle.ts` says the same thing to callers.
 */

/** A half-open range in one engine's document. */
export interface Span {
  from: number;
  to: number;
}

/**
 * What the policy needs from the engine running it.
 *
 * `M` is the engine's own match type, kept opaque: the policy only ever asks
 * for a span and hands matches back, so an adapter can pass along whatever its
 * search machinery returns without converting it first.
 */
export interface FindGlue<M> {
  /** The selection the step starts from. */
  selection: Span;
  /** The span a match occupies. */
  span(match: M): Span;
  /** Every match of the current query, in document order. */
  all(): M[];
  /** Select one match so the reader can see what was found. */
  select(match: M): void;
  /**
   * Replace these matches in a single transaction.
   *
   * Single is the point: 「全部替换」 is one edit a reader can undo once, not one
   * edit per match. The list is in document order and never empty.
   */
  apply(matches: readonly M[]): void;
}

function sameSpan(a: Span, b: Span): boolean {
  return a.from === b.from && a.to === b.to;
}

/**
 * The match the selection exactly covers, if any.
 *
 * Exact rather than "somewhere inside": Replace must not edit anything a reader
 * has not visibly lit up first. A caret merely parked inside a word would
 * otherwise have a key that rewrites part of it, which is the opposite of what
 * a find bar is for. The loop still works — `stepForward` selects a match, and
 * the same key then changes it.
 */
function covers<M>(glue: FindGlue<M>, hits: readonly M[]): M | null {
  return hits.find((hit) => sameSpan(glue.span(hit), glue.selection)) ?? null;
}

/**
 * Step forward to the next match, wrapping at the end of the document.
 *
 * Stepping measures from the match the selection covers rather than from the
 * selection itself, so a second press moves off a match instead of settling on
 * it forever. Returns `null` when the document has no match at all — 「0 / 0」
 * and 「1 / 1」 are different things to show a reader.
 */
export function stepForward<M>(glue: FindGlue<M>): Span | null {
  const hits = glue.all();
  const first = hits[0];
  if (!first) return null;
  const covered = covers(glue, hits);
  const from = covered ? glue.span(covered).to : glue.selection.to;
  const hit = hits.find((candidate) => glue.span(candidate).to > from) ?? first;
  glue.select(hit);
  return glue.span(hit);
}

/** As `stepForward`, walking the other way and wrapping at the start. */
export function stepBackward<M>(glue: FindGlue<M>): Span | null {
  const hits = glue.all();
  const last = hits[hits.length - 1];
  if (!last) return null;
  const covered = covers(glue, hits);
  const from = covered ? glue.span(covered).from : glue.selection.from;
  const hit = [...hits].reverse().find((candidate) => glue.span(candidate).from < from) ?? last;
  glue.select(hit);
  return glue.span(hit);
}

/**
 * Replace the match the selection covers, then step to the next one.
 *
 * When the selection covers no match this only steps, which is what makes the
 * Replace button a one-key loop: press it until the word you want is lit, and
 * the same key then changes it. Returns whether the document changed.
 *
 * The step re-reads the matches after the edit rather than reusing the list
 * from before it. The replacement text can itself match the query, and a list
 * taken earlier would still describe a document that no longer exists.
 */
export function replaceCovered<M>(glue: FindGlue<M>): boolean {
  const covered = covers(glue, glue.all());
  if (!covered) {
    stepForward(glue);
    return false;
  }
  glue.apply([covered]);
  stepForward(glue);
  return true;
}

/** Replace every match in one edit. Returns how many were replaced. */
export function replaceEverything<M>(glue: FindGlue<M>): number {
  const hits = glue.all();
  if (hits.length === 0) return 0;
  glue.apply(hits);
  return hits.length;
}
