/**
 * The `[TOC]` directive (ADR-0002).
 *
 * Written the way `inline-marks.ts` is, and for the same reason: recognising a
 * construct and writing it back out are two halves of one decision, and the
 * merge gate (`markdown.ts`) and the engine (`wysiwyg.ts`) both have to make it
 * identically. A copy per pipeline would drift until a save depended on which
 * mode the reader happened to be in.
 *
 * The construct exists as a node type rather than as a paragraph because of the
 * writing half. `mdast-util-to-markdown` escapes a `[` anywhere in ordinary
 * prose (`{character: '[', inConstruct: 'phrasing', …}` in its `unsafe.js`), so
 * a `[TOC]` left as a paragraph comes back as `\[TOC]` on the next save — a
 * file quietly corrupted by being opened. The only way to emit those five
 * characters is a handler that writes them itself instead of going through
 * `safe()`, and a handler needs a node type to hang off.
 *
 * `value` carries the marker as the author spelled it. `[toc]` is the same
 * directive, and normalising it to `[TOC]` would be an edit nobody asked for.
 */
import type { Nodes, Root } from "mdast";
import type { Options as StringifyOptions } from "remark-stringify";
import type { Plugin } from "unified";

/**
 * The spellings that are the directive, in full and on their own.
 *
 * Anchored at both ends on purpose: `[TOC levels=1-3]` is not something this
 * dialect supports, and a marker it does not understand has to stay the text
 * the author typed rather than become a block that silently drops the rest.
 */
const DIRECTIVE = /^\[toc\]$/i;

/**
 * The marker this paragraph was written with, or `null` when it is not one.
 *
 * Only answers "is this the marker". Whether a paragraph is *allowed* to be the
 * directive is a question about where it sits, which `remarkToc` below asks —
 * `- [TOC]` and `> [TOC]` are paragraphs too, and the directive is a block of
 * the document rather than a block of a block (ADR-0002 §2.3).
 */
export function tocMarker(node: Nodes): string | null {
  if (node.type !== "paragraph") return null;
  // Exactly one child, and it is text: `**[TOC]**` is a paragraph whose plain
  // text is the marker, and claiming it would turn a bolded word into a table
  // of contents. A code span fails the same check, which is what makes
  // `` `[TOC]` `` the way a document writes *about* the directive.
  if (node.children.length !== 1) return null;
  const only = node.children[0];
  if (only === undefined || only.type !== "text") return null;
  return DIRECTIVE.test(only.value) ? only.value : null;
}

/**
 * Recognise the directive while parsing.
 *
 * Registered after link resolution in both pipelines, which is what decides the
 * `[TOC]: url` case: an author who defined that label has a link there, and by
 * the time this runs the paragraph is a `link` rather than text — so the
 * ordering answers a question that would otherwise need a branch of its own.
 */
export const remarkToc: Plugin<[], Root> = () => (tree) => {
  // The document's own children only. Walking deeper would find the paragraphs
  // inside list items and block quotes, which are the same node type and a
  // different thing.
  for (const [index, child] of tree.children.entries()) {
    if (child.type !== "paragraph") continue;
    const marker = tocMarker(child);
    if (marker === null) continue;
    // mdast has no such node type, so the cast is the price of extending the
    // tree — the same one `inline-marks.ts` pays to build a `mark`.
    tree.children[index] = { type: "toc", value: marker } as unknown as Root["children"][number];
  }
};

type Handlers = NonNullable<StringifyOptions["handlers"]>;
type Handler = NonNullable<Handlers[keyof Handlers]>;

/**
 * The writing half: emit the marker verbatim.
 *
 * Deliberately not `containerPhrasing` and deliberately no `state.safe` call.
 * `safe` is exactly the function that turns `[TOC]` into `\[TOC]`, and a block
 * whose whole content is five fixed characters has nothing to escape and no
 * children to serialize — so the shortest correct handler is to write them.
 */
const tocHandler: Handler = (node, _parent, state, info) => {
  // Handlers are typed against the union of every node remark-stringify knows,
  // and this is not one of them. `value` is read the same defensive way
  // `wysiwyg.ts` reads mdast fields it did not declare itself.
  const value = (node as unknown as { value?: unknown }).value;
  return state.createTracker(info).move(typeof value === "string" ? value : "");
};

/**
 * The writing half, in the map shape `stringifyOptions.handlers` takes.
 *
 * Built through `Object.fromEntries` for the reason `inlineMarkHandlers` is:
 * the keys are the construct names mdast-util-to-markdown knows about, and
 * `toc` is not one of them — the package is transitive, so extending its
 * `ConstructNameMap` would mean declaring a module this file never imports.
 */
export const tocHandlers: Handlers = Object.fromEntries([["toc", tocHandler]]) as Handlers;
