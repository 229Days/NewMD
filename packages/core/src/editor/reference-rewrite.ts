/**
 * Respelling the destinations a file move invalidates (ADR-0003).
 *
 * Two directions, one piece of arithmetic. Each destination is resolved to the
 * absolute path it points at, that path is remapped through `(from, to)`, and
 * the answer is respelled relative to the directory the document now lives in.
 * The document that moved and the documents that did not go through the same
 * three steps; they differ only in which of the two lookups finds something.
 *
 * `documentPath` is where the document is **now** — the engine takes the tab's
 * already-patched path (ADR-0003 §2.8), so the directory it came from is
 * recovered by running the move backwards.
 *
 * The rewrite splices source text instead of re-serialising it. `roundTrip()`
 * would renormalise bullets and flatten reference links across the whole file,
 * and the file may be one the reader never opened, so the only bytes allowed to
 * change are the destinations themselves (ADR-0003 §2.4).
 */
import type { Definition, Image, Link, Root, RootContent } from "mdast";
import { isAbsolute, pathAfterMove, pathJoin, pathParent, pathRelative } from "../platform/path";
import { parse } from "./markdown";

export interface RenameChange {
  /** Absolute path of the document being rewritten, where it lives now. */
  documentPath: string;
  /** Absolute path the file had — a file or a directory. */
  from: string;
  /** Absolute path it has now. */
  to: string;
}

export interface RewriteResult {
  /** The document with its destinations respelled, identical when nothing changed. */
  text: string;
  /** Destinations that were respelled. */
  rewritten: number;
  /** Destinations the move affected and that could not be respelled safely. */
  unrewritten: number;
}

type DestinationNode = Link | Image | Definition;

/** How a destination was written, so the new one can be written the same way. */
interface Style {
  angle: boolean;
  escaped: boolean;
}

interface Candidate extends Style {
  text: string;
}

interface Located extends Style {
  start: number;
  end: number;
  text: string;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

export function rewriteReferences(source: string, change: RenameChange): RewriteResult {
  const { documentPath, from, to } = change;
  const directory = pathParent(documentPath) ?? documentPath;
  // Where the document was, read off the move: a document that is not inside
  // the destination did not move, and only its own directory matters to its
  // outbound links — renaming a file in place leaves them all resolving.
  const was = pathParent(pathAfterMove(documentPath, to, from) ?? documentPath) ?? documentPath;

  const replacements: Replacement[] = [];
  let rewritten = 0;
  let unrewritten = 0;

  for (const node of destinationsOf(parse(source))) {
    const split = splitDestination(node.url);
    if (!isRelative(split.path)) continue;

    // A bare `a.md` is only made canonical when the destination is being
    // respelled for another reason — otherwise every rename would rewrite the
    // spelling of unrelated links in every document it scanned.
    const target = pathJoin(was, split.path);
    const moved = pathAfterMove(target, from, to);
    if (moved === null && was === directory) continue;

    const found = locate(source, node, node.url);
    if (!found) {
      unrewritten += 1;
      continue;
    }

    const path = pathRelative(directory, moved ?? target);
    if (isAbsolute(path)) {
      // Different roots: no `..` reaches, and an absolute destination is not
      // something to write into Markdown (ADR-0003 §2.5).
      unrewritten += 1;
      continue;
    }

    const text = spell(path + split.suffix, found);
    if (text === found.text) continue;

    replacements.push({ start: found.start, end: found.end, text });
    rewritten += 1;
  }

  return { text: splice(source, replacements), rewritten, unrewritten };
}

/** A destination split into the path to respell and the `#…` / `?…` that rides along. */
function splitDestination(url: string): { path: string; suffix: string } {
  const cut = url.search(/[#?]/);
  return cut < 0 ? { path: url, suffix: "" } : { path: url.slice(0, cut), suffix: url.slice(cut) };
}

/**
 * Whether this destination is one of ours at all (ADR-0003 §2.5).
 *
 * A scheme is a colon that comes before the first slash — testing for a colon
 * would also reject `./odd:name.md`, which is an ordinary file name.
 */
function isRelative(path: string): boolean {
  if (path === "" || isAbsolute(path)) return false;
  const colon = path.indexOf(":");
  const slash = path.indexOf("/");
  return colon < 0 || (slash >= 0 && slash < colon);
}

/**
 * The same destination written the ways a source file may spell it.
 *
 * mdast hands back the decoded url (`./a\(b\).md` arrives as `./a(b).md`) and
 * drops the angle brackets that were syntax rather than content, so the source
 * has to be searched for all of them. Percent-encoding is missing on purpose:
 * a `%20` destination resolves to a different literal path, so it never gets
 * this far (ADR-0003 §2.7).
 */
function spellings(url: string): Candidate[] {
  const escaped = url.replace(/[\\()]/g, (char) => `\\${char}`);
  const plain: Candidate[] = [{ text: url, angle: false, escaped: false }];
  if (escaped !== url) plain.push({ text: escaped, angle: false, escaped: true });
  return [...plain, ...plain.map((form) => ({ ...form, text: `<${form.text}>`, angle: true }))];
}

/** The span of the destination inside the node that owns it. */
function locate(source: string, node: DestinationNode, url: string): Located | null {
  const span = spanOf(node);
  if (span === null) return null;
  const slice = source.slice(span.start, span.end);

  for (const candidate of spellings(url)) {
    const start = positionOf(slice, node, candidate.text, span.start);
    if (start === null) continue;
    return { ...candidate, start, end: start + candidate.text.length };
  }
  return null;
}

/**
 * Where this spelling of the destination sits in the source, or null when the
 * node does not spell it that way.
 *
 * Both shapes are anchored rather than searched from the start, because a link
 * label is free text that may repeat the destination: the anchor is the `(` the
 * destination sits behind, or the `]:` a definition sits behind.
 */
function positionOf(
  slice: string,
  node: DestinationNode,
  candidate: string,
  base: number,
): number | null {
  if (node.type === "definition") {
    const label = slice.indexOf("]:");
    if (label < 0) return null;
    let at = label + 2;
    while (at < slice.length && /\s/.test(slice[at]!)) at += 1;
    return slice.startsWith(candidate, at) ? base + at : null;
  }

  // For a link the label ends at its last child; for an image there is no child
  // to ask, so the label ends at the `](` that opens the destination.
  const afterLabel =
    node.type === "link"
      ? (node.children[node.children.length - 1]?.position?.end.offset ?? base) - base
      : Math.max(0, slice.indexOf("](") + 1);

  const at = slice.indexOf(`(${candidate}`, Math.max(0, afterLabel));
  if (at < 0 || at + 1 + candidate.length > slice.length) return null;
  return base + at + 1;
}

/** Write the destination back, in the shape the source used for it. */
function spell(destination: string, style: Style): string {
  // A space or an angle bracket cannot stand in a destination at all, and an
  // unbalanced parenthesis ends it early — those are what the wrapping is for.
  // Parentheses the author escaped stay escaped instead of being wrapped, so a
  // destination comes back in the shape it went in.
  const wrapped =
    style.angle || /[\s<>]/.test(destination) || (!style.escaped && !parensBalance(destination));
  const body = destination.replace(style.escaped ? /[\\()<>]/g : /[\\<>]/g, (char) => `\\${char}`);
  return wrapped ? `<${body}>` : body;
}

/** Whether a destination's parentheses can stand unescaped, as Markdown allows when balanced. */
function parensBalance(destination: string): boolean {
  let depth = 0;
  for (const char of destination) {
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function spanOf(node: DestinationNode): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
}

/** Every destination in the tree, in the order they appear. */
function destinationsOf(tree: Root): DestinationNode[] {
  const found: DestinationNode[] = [];
  const walk = (node: RootContent): void => {
    if (isDestinationNode(node)) found.push(node);
    if ("children" in node) for (const child of node.children) walk(child);
  };
  for (const child of tree.children) walk(child);
  return found;
}

function isDestinationNode(node: RootContent): node is DestinationNode {
  return node.type === "link" || node.type === "image" || node.type === "definition";
}

function splice(source: string, replacements: Replacement[]): string {
  const ordered = [...replacements].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const replacement of ordered) {
    parts.push(source.slice(cursor, replacement.start), replacement.text);
    cursor = replacement.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}
