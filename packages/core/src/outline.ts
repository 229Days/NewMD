/**
 * The outline: every heading in the document, in order, with the anchor a jump
 * needs (ADR-0001 §4 M4: 大纲侧栏).
 *
 * The anchor is (level, text, occurrence) rather than a line number. A line
 * number describes Markdown text, and the WYSIWYG surface has no Markdown text
 * to describe — it holds ProseMirror nodes, which have no lines — so an anchor
 * in lines could only ever be resolved by the source engine. The acceptance
 * criterion for this milestone is 「大纲点击可跳转」, and it would stop holding
 * the moment the reader was in WYSIWYG, which is the mode the app opens in.
 * Identifying a heading by what it *is* lets each engine find it in whatever it
 * actually holds.
 *
 * All three readers of headings — this module, the source engine and the
 * WYSIWYG schema — go through the same parse or the same schema, so none of
 * them can grow its own idea of what counts. That is what keeps the occurrence
 * numbers they count from drifting apart.
 */
import type { Heading, Nodes, Root } from "mdast";
import { parse } from "./editor/markdown";
import type { HeadingTarget } from "./editor/handle";

export type { HeadingTarget } from "./editor/handle";

/**
 * The characters the heading actually reads as.
 *
 * Emphasis, links and code spans are walked through; images, breaks and raw
 * HTML contribute nothing, because they contribute nothing to the rendered
 * heading either — the WYSIWYG engine reads `textContent` and would say the
 * same. A leaf that adds a character here and not there is a heading the three
 * readers would resolve to different places.
 */
function plainText(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    case "break":
    case "image":
    case "imageReference":
    case "html":
    case "footnoteReference":
      return "";
    default:
      return "children" in node ? node.children.map(plainText).join("") : "";
  }
}

/** Every heading in the document, in the order it is written. */
function collect(node: Nodes | Root, out: Heading[]): void {
  if (node.type === "heading") {
    out.push(node);
    return;
  }
  if ("children" in node) {
    for (const child of node.children) collect(child as Nodes, out);
  }
}

export interface LocatedHeading {
  level: number;
  text: string;
  /** 1-based line the heading starts on. */
  line: number;
}

/**
 * The headings of a Markdown document, with the line each starts on.
 *
 * Exported for the source engine, which resolves an anchor by jumping to a
 * line — and which must therefore read headings exactly as this does, or a
 * jump would land on the wrong one. It is not a shortcut around the anchor:
 * the line stays inside the Markdown and never reaches the WYSIWYG surface.
 */
export function headingsOf(markdown: string): LocatedHeading[] {
  const found: Heading[] = [];
  collect(parse(markdown), found);
  return found.map((heading) => ({
    level: heading.depth,
    text: plainText(heading),
    line: heading.position?.start.line ?? 0,
  }));
}

/**
 * The outline of a Markdown document, in document order.
 *
 * `occurrence` counts only headings that already match, so the number a
 * repeated heading gets is not shifted by anything else in the document.
 */
export function outlineOf(markdown: string): HeadingTarget[] {
  const counted = new Map<string, number>();
  const outline: HeadingTarget[] = [];
  for (const heading of headingsOf(markdown)) {
    const key = `${heading.level} ${heading.text}`;
    const occurrence = counted.get(key) ?? 0;
    counted.set(key, occurrence + 1);
    outline.push({ level: heading.level, text: heading.text, occurrence });
  }
  return outline;
}
