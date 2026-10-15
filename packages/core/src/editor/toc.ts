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
import type { HeadingTarget } from "./handle";

/**
 * The spellings that are the directive, in full and on their own.
 *
 * Anchored at both ends on purpose: `[TOC levels=1-3]` is not something this
 * dialect supports, and a marker it does not understand has to stay the text
 * the author typed rather than become a block that silently drops the rest.
 */
const DIRECTIVE = /^\[toc\]$/i;

/**
 * The marker `text` is, or `null` when it is not the directive.
 *
 * Split out from `tocMarker` because the engine needs the same question asked
 * of a string: `wysiwyg.ts` holds the marker as ProseMirror text rather than as
 * mdast, and a second spelling of what counts would let the two disagree about
 * a document that is on screen.
 */
export function tocMarkerText(text: string): string | null {
  return DIRECTIVE.test(text) ? text : null;
}

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
  return tocMarkerText(only.value);
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

/**
 * One line of the table of contents: a heading, named the way both engines name
 * one (`HeadingTarget` in `editor/handle.ts`).
 *
 * Not a position. The entries are computed from the document, drawn beside it
 * and thrown away again; a position in one of them would be a coordinate in a
 * document that may have moved on by the time it is used.
 */
export interface TocEntry {
  /** 1–6, as Markdown depth. */
  level: number;
  /** Heading text with markers, emphasis and links flattened away. */
  text: string;
  /** Which of the headings at this level with this text, counting from 0. */
  occurrence: number;
}

/**
 * Draw `entries` into `list`, replacing whatever was there.
 *
 * Here rather than in `wysiwyg.ts` for the reason `mermaid.ts` is out of it:
 * that file's contract is that every engine call in the project lives in it,
 * and building these elements makes none.
 *
 * **The depth is emitted, the indentation is not.** How far an entry sits from
 * the margin is a stylesheet's business (§2.8), but only the document knows how
 * deep it goes, so the number travels as a custom property and the multiplier
 * stays in `packages/ui`. `data-level` is the heading's own depth and cannot
 * serve — an entry printed at `data-level` would sit two steps in on a document
 * whose shallowest heading is an `h3`.
 *
 * A `<button type="button">` rather than an `<a>`: there is no heading id to
 * point at and inventing one would be a second identity system beside
 * `(level, text, occurrence)` — see ADR-0002 §2.6 for what that costs at export.
 * `type="button"` because these are inside a form-less contenteditable today and
 * a form tomorrow, where the default `submit` would reload the page.
 */
export function fillTocList(list: HTMLElement, entries: TocEntry[]): void {
  const owner = list.ownerDocument;
  // The shallowest heading in the document, so a document that starts at `##`
  // is not printed as if something above it were missing. `Infinity` for an
  // empty list, which builds no entries and never reads it.
  const shallowest = entries.reduce((min, entry) => Math.min(min, entry.level), Infinity);

  const items = entries.map((entry) => {
    const item = owner.createElement("li");
    const button = owner.createElement("button");
    button.type = "button";
    button.setAttribute("data-newmd-toc-entry", "");
    button.setAttribute("data-level", String(entry.level));
    button.setAttribute("data-text", entry.text);
    button.setAttribute("data-occurrence", String(entry.occurrence));
    button.style.setProperty("--newmd-toc-indent", String(entry.level - shallowest));
    button.textContent = entry.text;
    item.append(button);
    return item;
  });

  const outline = owner.createElement("ul");
  outline.append(...items);
  list.replaceChildren(outline);
}

/**
 * The heading an entry points at, or `null` when this element is not one.
 *
 * Read back off the element rather than closed over when the entry was drawn:
 * `fillTocList` replaces every entry whenever the headings move, so a handler
 * holding the button it was built for would be holding one that is no longer on
 * screen. The three attributes are the anchor `editor/handle.ts` defines, and
 * reading them here is what keeps the block from needing a second idea of what
 * an entry is.
 *
 * Each field is checked for presence before it is read: `getAttribute` answers
 * `null` for an absent one and `Number(null)` is `0`, so a level that was simply
 * missing would arrive as a perfectly plausible `h1`.
 */
export function tocEntryTarget(element: Element): HeadingTarget | null {
  const level = element.getAttribute("data-level");
  const text = element.getAttribute("data-text");
  const occurrence = element.getAttribute("data-occurrence");
  if (level === null || text === null || occurrence === null) return null;
  const depth = Number(level);
  const index = Number(occurrence);
  if (!Number.isInteger(depth) || !Number.isInteger(index)) return null;
  return { level: depth, text, occurrence: index };
}
