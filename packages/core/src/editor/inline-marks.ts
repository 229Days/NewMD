/**
 * Inline marks this dialect spells with a paired delimiter: `==highlight==`
 * first, super/subscript next (ADR-0001 §2.4 常用扩展).
 *
 * A paired delimiter like this has no home in CommonMark, so there is no
 * tokenizer to lean on — and the ready-made `micromark-extension-mark` is built
 * against micromark-util v1 while this repo is on v2/v3, so it would not load.
 * The syntax is therefore recognised *after* parsing, by rewriting the mdast
 * text that remark has already split out of inline code, links and emphasis.
 *
 * That placement buys two things the naive approach does not get:
 *
 * 1. `==` inside `` `code` `` and inside a URL is already in a different node,
 *    so it can never be mistaken for a delimiter — no escaping rules to re-derive.
 * 2. The rewrite runs over a node's children rather than one text node at a
 *    time, so `==combine **bold**==` opens in one text node, swallows the bold
 *    as an inline child, and closes in the next. Scanning text nodes in isolation
 *    would leave that spelling as literal text while every round-trip test
 *    stayed green — the exact failure `tests/roundtrip.test.ts` exists to catch.
 *
 * Both directions live here on purpose. `markdown.ts` (the merge gate) and
 * `wysiwyg.ts` (the engine) must parse and write these nodes identically, and a
 * pair of copies would drift apart until a save depended on which mode the
 * reader happened to be in.
 */
import type { Nodes, Parents, Root } from "mdast";
import type { Options as StringifyOptions } from "remark-stringify";
import type { Plugin } from "unified";

/** How one paired delimiter is spelled, on the way in and the way out. */
export interface InlineMarkSyntax {
  /** The mdast node type this pair becomes. */
  type: string;
  /** The characters that open a span. */
  open: string;
  /** The characters that close it. */
  close: string;
}

/**
 * Every paired-delimiter mark the dialect supports, in the order they are
 * looked for.
 *
 * A table rather than a branch per syntax: adding a mark is one row here plus a
 * schema in `wysiwyg.ts`, and the scanning rules are then provably the same for
 * every mark rather than reimplemented and re-tested.
 *
 * `sub` before `sup` is not arbitrary. On `~a^b~` the other order opens a
 * superscript at the caret, carries it through the tilde span as an opaque
 * child and closes it at the trailing caret — writing `~a^b^~`, a spelling the
 * reader never typed. Subscript first claims the tilde pair outright and leaves
 * the caret alone, which round-trips byte for byte either way round.
 *
 * `~` being usable at all is a configuration decision, not a default: GFM's
 * strikethrough treats a single tilde as a strike, so `H~2~O` would parse as
 * struck-through text. Both pipelines turn that off with
 * `{ singleTilde: false }` — see `markdown.ts` and `wysiwyg.ts`.
 */
export const INLINE_MARKS: readonly InlineMarkSyntax[] = [
  { type: "mark", open: "==", close: "==" },
  { type: "sub", open: "~", close: "~" },
  { type: "sup", open: "^", close: "^" },
];

/**
 * Nodes whose children are inline content, and so are the only places a paired
 * delimiter may open and close.
 *
 * Deliberately not "any node with children": a `root` or `blockquote` holding
 * two paragraphs, the first ending in `==` and the second starting with a close,
 * would otherwise let a mark span a block boundary — a span the source has no
 * way to express and that could never be written back.
 */
const PHRASING_CONTAINERS: ReadonlySet<string> = new Set([
  // The marks built here included: they hold phrasing content like any other,
  // and without them a delimiter nested inside one would never be looked at.
  ...INLINE_MARKS.map((syntax) => syntax.type),
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
]);

function append(sink: Nodes[], node: Nodes): void {
  // An empty text node is not a thing, and producing one is easy: a delimiter
  // sitting at the start of a run (`==a b==` opens at index 0) makes
  // `slice(cursor, at)` the empty string. mdast tolerates it, but ProseMirror
  // throws `Empty text nodes are not allowed` while building the document, so
  // the paragraph dies mid-parse and the surface ends up holding whatever
  // fragment had been built up to that point. Skipping it is lossless: an empty
  // text node stringifies to nothing anyway.
  if (node.type === "text" && node.value === "") return;
  // mdast allows adjacent text nodes but nothing downstream expects them, and
  // merging as we go is what makes an unwrapped pair byte-identical to what
  // arrived: `==` plus its content have to land back in one text node.
  const last = sink[sink.length - 1];
  if (node.type === "text" && last !== undefined && last.type === "text") {
    last.value += node.value;
    return;
  }
  sink.push(node);
}

function text(value: string): Nodes {
  return { type: "text", value };
}

/**
 * Whether a span's content can be a mark at all.
 *
 * `== on its own ==` and `5 == 6 == 7` are ordinary text a reader typed, and
 * turning them into spans would rewrite their document on save. The check is
 * on the two edges only: an element edge (a bold run, an inline code span) has
 * no whitespace to object to, and interior spaces are fine — `==a b==` is a
 * perfectly ordinary highlight.
 */
function isSpannable(content: readonly Nodes[]): boolean {
  if (content.length === 0) return false;
  const blank = (node: Nodes | undefined, from: "first" | "last"): boolean => {
    if (node === undefined || node.type !== "text") return false;
    const value =
      from === "first" ? node.value.charAt(0) : node.value.charAt(node.value.length - 1);
    return value === "" || /\s/.test(value);
  };
  return !blank(content[0], "first") && !blank(content[content.length - 1], "last");
}

/**
 * Wrap every well-formed `open … close` run among `children`.
 *
 * The delimiter found next depends on whether a span is already open, which is
 * what makes the same scanner work for symmetric pairs (`==`) and asymmetric
 * ones alike without a second code path.
 */
function applySyntax(children: readonly Nodes[], syntax: InlineMarkSyntax): Nodes[] {
  const out: Nodes[] = [];
  /** Content of the span opened but not yet closed, or null when none is open. */
  let open: Nodes[] | null = null;
  const sink = (): Nodes[] => open ?? out;

  for (const child of children) {
    if (child.type !== "text") {
      // Inside a span this node is content of it, so it rides along rather than
      // closing the span — that is what keeps `==a **b** c==` in one piece.
      append(sink(), child);
      continue;
    }

    let cursor = 0;
    for (;;) {
      const marker = open === null ? syntax.open : syntax.close;
      const at = child.value.indexOf(marker, cursor);
      if (at < 0) {
        append(sink(), text(child.value.slice(cursor)));
        break;
      }
      append(sink(), text(child.value.slice(cursor, at)));
      cursor = at + marker.length;
      if (open === null) {
        open = [];
        continue;
      }
      const content = open;
      open = null;
      if (isSpannable(content)) {
        append(out, { type: syntax.type, children: content } as Nodes);
      } else {
        // Not a span after all: both markers go back as the literal text they
        // arrived as, so an ordinary `5 == 6` is never rewritten on save.
        append(out, text(syntax.open));
        for (const node of content) append(out, node);
        append(out, text(syntax.close));
      }
    }
  }

  // An opener with no closer is the reader mid-thought, not a span. Returning
  // its marker keeps `a ==b` byte-identical instead of eating the delimiter.
  if (open !== null) {
    append(out, text(syntax.open));
    for (const node of open) append(out, node);
  }
  return out;
}

function walk(node: Root | Nodes): void {
  if (!("children" in node) || !Array.isArray(node.children)) return;
  // Depth first: a mark inside emphasis is settled before the outer level
  // treats that emphasis as one opaque child.
  for (const child of node.children) walk(child);
  if (!PHRASING_CONTAINERS.has(node.type)) return;
  for (const syntax of INLINE_MARKS) {
    const children = applySyntax(node.children as Nodes[], syntax);
    // Cast rather than assignment: `Root.children` and `Nodes.children` are
    // disjoint unions, and `node` here is the wider of the two even though the
    // set above has already ruled `Root` out. Narrowing on a set membership is
    // not something the type system does.
    (node as { children: Nodes[] }).children = children;
    // A node this pass just built has not met the remaining syntaxes — the walk
    // at the top ran before it existed — so `==E = mc^2^==` would keep its
    // superscript as literal text while the outer highlight round-tripped
    // perfectly. Only the type this pass makes is re-entered: everything else
    // in `children` was either walked already or is untouched by this pass.
    for (const child of children) {
      if (child.type === syntax.type) walk(child);
    }
  }
}

/** Recognise every paired delimiter in `INLINE_MARKS` while parsing. */
export const remarkInlineMarks: Plugin<[], Root> = () => (tree) => {
  walk(tree);
};

type Handlers = NonNullable<StringifyOptions["handlers"]>;
type Handler = NonNullable<Handlers[keyof Handlers]>;

/**
 * The writing half: put the delimiters back.
 *
 * `containerPhrasing` rather than a hand-rolled join, so the children are
 * serialized with the same escaping rules every other inline node gets — a
 * hand-built string here would be a second serializer to keep in step with the
 * first.
 */
function makeHandler(syntax: InlineMarkSyntax): Handler {
  return (node, _parent, state, info) => {
    const tracker = state.createTracker(info);
    // `enter` is typed against the closed list of construct names
    // mdast-util-to-markdown knows about, and this is not one of them — it only
    // ever uses the string to decide whether `safe()` should escape a
    // delimiter, so the widening is at the call site rather than in the type.
    // The package itself is transitive, so extending its `ConstructNameMap`
    // would mean declaring a module this file never imports.
    const exit = state.enter(syntax.type as Parameters<typeof state.enter>[0]);
    let value = tracker.move(syntax.open);
    // `node` arrives as the union of every node type remark-stringify handles,
    // which includes the leaf types that have no children. Casting to the union
    // of the ones that do is what `containerPhrasing` actually needs.
    value += state.containerPhrasing(node as unknown as Parents, {
      ...tracker.current(),
      before: value,
      after: syntax.close.charAt(syntax.close.length - 1),
    });
    value += tracker.move(syntax.close);
    exit();
    return value;
  };
}

/** One `mdast → markdown` handler per mark, keyed by node type. */
export const inlineMarkHandlers: Handlers = Object.fromEntries(
  INLINE_MARKS.map((syntax) => [syntax.type, makeHandler(syntax)]),
) as Handlers;
