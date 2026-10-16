/**
 * `@newmd/core/document` — the document side of core, with no engine in it
 * (ADR-0005 §2.4).
 *
 * The export is a second reader of the same document the editor reads, and it
 * has to read it the *same* way: one remark chain, one set of node types, one
 * front matter panel, one stylesheet. Everything it needs for that is here.
 *
 * **What this door is not.** `@newmd/core/editor` is deliberately narrow — one
 * factory, one contract, so no caller can grow an opinion about which engine is
 * running. Widening it for the export's sake would have undone that, so this is
 * a second door with a rule of its own: nothing reachable from here may import
 * Milkdown, CodeMirror or ProseMirror. `tests/document-subpath.test.ts` walks the
 * import graph and holds that, because the way this breaks is one convenient
 * re-export at a time and nothing on screen would say so.
 *
 * **Why `parseTransformed` and not the ProseMirror doc.** The editor's tree only
 * exists inside a live WYSIWYG surface, and reaching into it would bind the
 * export to a mode: a reader in source mode could not export. The mdast tree is
 * the one the round-trip gate already pins, and toc / inline-marks / math are
 * extensions this package made to it — so it is strictly the richer of the two,
 * not a fallback (ADR-0005 §2.3).
 */

/**
 * The parser both pipelines run, transformers and all.
 *
 * `parseTransformed` rather than `parse`: recognition is split between the
 * tokenizer and the transformers, so a tree read before they run would have
 * `==highlight==` still spelled as text. Its sibling `roundTrip` is deliberately
 * absent — the export does not write Markdown, and a subpath that hands out a
 * serializer it has no use for is a subpath inviting someone to use it.
 */
export { parseTransformed } from "../editor/markdown";

/**
 * The tree itself, by the names the parsers use.
 *
 * Named rather than left to be derived from `parseTransformed`'s return type: a
 * caller that walks the tree has to be able to say what a node is, and a door
 * that hands out a tree should say what it is made of. It is also what keeps the
 * export off a direct `mdast` dependency — ADR-0005 §2.4 gives it two, and
 * neither is mdast.
 */
export type { Nodes, Root } from "mdast";

/**
 * The node types this dialect added to mdast.
 *
 * `mark` / `sub` / `sup` have no node type in mdast at all, and `toc` is this
 * project's own — so there is nothing upstream for the export to import, and the
 * tables below are the only place they are written down. Reading them rather
 * than restating them is what keeps the export from missing the next mark.
 */
export { INLINE_MARKS, type InlineMarkSyntax } from "../editor/inline-marks";
export { tocMarker, tocMarkerText, type TocEntry } from "../editor/toc";

/** The heading text flattening the outline uses, so a `[TOC]` reads as its headings do. */
export { nodeText } from "../outline";

/** The three renderers, reused rather than re-imported (ADR-0005 §2.6). */
export { highlight, type HighlightToken } from "../editor/highlight";
export { renderMath } from "../editor/math";
export { renderMermaid } from "../editor/mermaid";

/** The front matter panel, which is markup rather than YAML. */
export { frontMatterRows } from "./frontmatter";

/** The stylesheets, as text, for whoever has to inline them into a page. */
export { documentCss, highlightCss, katexStylesheet, themeCss } from "./stylesheet";
