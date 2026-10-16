/**
 * Markdown in, one self-contained HTML page out (ADR-0005 §2.3, §2.5–§2.8).
 *
 * **What "self-contained" is doing in that sentence.** The deliverable is
 * something a writer sends to somebody else, and every dependency the page keeps
 * on its origin is a way for it to arrive broken: a `<link>` to a stylesheet in
 * the app's bundle, an `<img src="./assets/…">` whose folder did not travel. So
 * the stylesheets are inlined as text, images are carried in the file, and the
 * ones that could not be are *reported* rather than quietly left behind.
 *
 * **Why mdast and not the rendered editor DOM.** ADR-0005 §2.3. A ProseMirror
 * document only exists inside a live WYSIWYG surface, and reaching into one would
 * bind the export to a mode and reopen ADR-0001 §2.3's boundary; the tree below
 * is the one the round-trip gate already pins, and `toc` / `mark` / math are this
 * project's own extensions to it — so it is the richer of the two, not a
 * fallback.
 *
 * **What it deliberately does not render.** `definition`, because a link
 * definition is a binding rather than content and every Markdown renderer draws
 * nothing for one — the editor prints it only because it has to show the reader
 * their file. Raw `html`, and a reference that resolved to nothing, because
 * neither has anywhere to go: the first would let a document write markup into a
 * page somebody opens off their desktop, which is the escaping question
 * inverted, and the second is ADR-0003 §2.7's "do not guess" applied to a
 * construct that arrived without the one thing it needs.
 *
 * **The renderers are core's, not this package's.** Shiki tokenises a fence,
 * KaTeX lays out a formula, Mermaid draws a diagram — the same three the editor
 * calls, reached through the same door (ADR-0005 §2.6) rather than imported
 * again, so a page cannot disagree with the surface it was exported from. What
 * each one costs is the difference between them: a token carries both of its
 * colours inline, so a fence needs one rule and no assets; a formula needs
 * KaTeX's stylesheet with 296KB of `woff2` carried inside it, which is why the
 * page only pays for it when the document has a formula in it.
 */
import {
  documentCss,
  frontMatterRows,
  highlight,
  highlightCss,
  INLINE_MARKS,
  katexStylesheet,
  nodeText,
  parseTransformed,
  renderMath,
  renderMermaid,
  themeCss,
  type HighlightToken,
  type Nodes,
  type Root,
} from "@newmd/core/document";
import { getPlatform } from "@newmd/core";
import type { AppSettings, ResolvedTheme } from "@newmd/core";
import { inlineImage, type ImageReason } from "./images";
import pageCss from "./page.css?inline";

/** The reader's typography, as the settings store has it. */
type Look = Partial<Pick<AppSettings, "fontSize" | "lineHeight" | "editorMaxWidth" | "fontFamily">>;

export interface DocumentHtmlOptions {
  /**
   * Which of the two the writer is looking at, written into the page.
   *
   * Resolved rather than the `"system"` preference: the page is a snapshot, and
   * a snapshot that follows whoever opens it is not what its author saw
   * (ADR-0005 §2.8).
   */
  theme: ResolvedTheme;
  /**
   * The page's `<title>`. Defaults to the first heading's text.
   *
   * Not read out of the front matter: nothing in this pipeline parses YAML, on
   * purpose (`document/frontmatter.ts`), and a title is a thing the caller can
   * pass — the app knows the file's name and this module does not.
   */
  title?: string;
  /** Written over the palette, so the page is in the reader's own type. */
  settings?: Look;
  /**
   * The file this document is, so a relative image can be found beside it.
   *
   * The same field `ImageTarget` carries, for the same reason (ADR-0001 §2.8):
   * the Markdown addresses a picture relative to the document, and something has
   * to say where the document is. Absent for one that has never been saved,
   * which is the case the report has a reason for.
   */
  docPath?: string;
}

/**
 * An image the page points at but does not carry.
 *
 * A notice rather than an error: the page is still the document it was, and the
 * path in it still works for a reader who keeps the file beside its pictures.
 * What the reason is for is the case where it does not (ADR-0005 §2.6).
 */
export interface HtmlImageNotice {
  url: string;
  reason: ImageReason;
}

export interface HtmlExportReport {
  images: HtmlImageNotice[];
}

export interface HtmlExport {
  html: string;
  report: HtmlExportReport;
}

/**
 * One heading, with the anchor it will be given.
 *
 * Positional rather than derived from the text, and every heading gets one
 * whether or not a `[TOC]` asks for it (ADR-0005 §2.7): a slug collapses a
 * Chinese heading to nothing, and nobody links into a snapshot.
 */
interface OutlineEntry {
  id: string;
  /** 1–6, as Markdown depth. */
  level: number;
  text: string;
}

interface Outline {
  entries: OutlineEntry[];
  /**
   * Which entry a heading node became.
   *
   * The heading's id and the table of contents' `href` are read from this one
   * map, so the two cannot disagree — a second pass numbering headings
   * independently is how a document ends up with a link to nowhere.
   */
  byNode: Map<Nodes, OutlineEntry>;
  /** The shallowest depth in the document, which is what indentation is from. */
  shallowest: number;
}

interface Context {
  outline: Outline;
  report: HtmlExportReport;
  /** Fences still being tokenised, so the page is not serialised before they land. */
  pending: Promise<void>[];
  /** The one theme, for the one renderer that bakes its colours in rather than inheriting them. */
  dark: boolean;
  /** Whether any formula was written, which is what KaTeX's stylesheet is worth carrying for. */
  math: boolean;
  /** The document's folder, for reading the pictures it points at. `null` when it has none. */
  imageDir: string | null;
}

/** Render `markdown` as one page a browser can open from anywhere. */
export async function renderDocumentHtml(
  markdown: string,
  options: DocumentHtmlOptions,
): Promise<HtmlExport> {
  const tree = parseTransformed(markdown);
  const outline = outlineOf(tree);
  const context: Context = {
    outline,
    report: { images: [] },
    pending: [],
    dark: options.theme === "dark",
    math: false,
    // Asked of the platform rather than split here, because which separator a
    // path uses is the host's business and this module's is the page.
    imageDir: options.docPath === undefined ? null : getPlatform().pathParent(options.docPath),
  };

  // The element `document.css` is written against, and the one the export has to
  // get right or nothing inlined below it has any effect (ADR-0005 §2.5 落地补记).
  const scope = document.createElement("div");
  scope.setAttribute("data-newmd-document", "");
  renderChildren(tree.children, scope, context);

  // Shiki is asked about every fence at once and answers when it answers, so the
  // markup above is built first and filled in here. Mermaid is the same shape
  // with a longer wait: the diagram is drawn while the page is being assembled.
  await Promise.all(context.pending);

  const parts = [themeCss, pageCss, documentCss, highlightCss, lookCss(options.settings)];
  // KaTeX's stylesheet is 400KB with the fonts inside it (ADR-0005 §2.6), so it
  // is asked for after the document has been walked rather than before: a page
  // with no formula in it carries none of it.
  if (context.math) parts.push(await katexStylesheet());
  const css = parts.filter((part) => part !== "").join("\n");

  return {
    html: page({
      theme: options.theme,
      title: options.title ?? outline.entries[0]?.text ?? "",
      css,
      body: scope.outerHTML,
    }),
    report: context.report,
  };
}

/* Every heading in the document, and the id each one is given. */
function outlineOf(tree: Root): Outline {
  const found: { node: Nodes; level: number; text: string }[] = [];
  collectHeadings(tree, found);

  const entries: OutlineEntry[] = [];
  const byNode = new Map<Nodes, OutlineEntry>();
  found.forEach((heading, index) => {
    const entry: OutlineEntry = {
      // 1-based, in document order, and never reused.
      id: `newmd-h-${index + 1}`,
      level: heading.level,
      text: heading.text,
    };
    entries.push(entry);
    byNode.set(heading.node, entry);
  });

  // `Infinity` for a document with no headings. Nothing reads it then: the only
  // consumer is the table of contents, which walks the entries.
  const shallowest = entries.reduce((min, entry) => Math.min(min, entry.level), Infinity);
  return { entries, byNode, shallowest };
}

/**
 * Depth-first, and through everything: a heading inside a block quote or a list
 * item is still a heading of the document, and it is what the outline sidebar
 * (ADR-0001 §4 M4) lists too.
 */
function collectHeadings(
  node: Nodes | Root,
  out: { node: Nodes; level: number; text: string }[],
): void {
  if (node.type === "heading") {
    out.push({ node, level: node.depth, text: nodeText(node) });
    return;
  }
  if ("children" in node) {
    for (const child of node.children) collectHeadings(child, out);
  }
}

/** The children of a container node, or none for a leaf. */
function childrenOf(node: Nodes): readonly Nodes[] {
  return "children" in node ? (node.children as readonly Nodes[]) : [];
}

function renderChildren(nodes: readonly Nodes[], into: Element, context: Context): void {
  for (const node of nodes) renderNode(node, into, context);
}

/** An element of this name with the node's children inside it. */
function container(tag: string, node: Nodes, context: Context): HTMLElement {
  const element = document.createElement(tag);
  renderChildren(childrenOf(node), element, context);
  return element;
}

function renderNode(node: Nodes, into: Element, context: Context): void {
  // The paired-delimiter marks and `toc` have no node type in mdast, so the
  // union does not admit them and the comparisons below are made against the
  // string. Answered before the switch, which is also what keeps `node.type`
  // narrowing inside it.
  const type: string = node.type;

  const mark = INLINE_MARKS.find((syntax) => syntax.type === type);
  if (mark !== undefined) {
    // The node type is the element name, which is not a coincidence: `mark`,
    // `sub` and `sup` are HTML's own names for the three things the delimiters
    // mean, so the table needed no mapping to be read from here.
    into.append(container(mark.type, node, context));
    return;
  }

  if (type === "toc") {
    into.append(tocBlock(context.outline));
    return;
  }

  switch (node.type) {
    case "text":
      // Through the DOM, so the document's own `<` and `&` are the serializer's
      // problem rather than a string concatenation's.
      into.append(node.value);
      return;

    case "paragraph":
      into.append(container("p", node, context));
      return;

    case "heading": {
      const element = container(`h${node.depth}`, node, context);
      const entry = context.outline.byNode.get(node);
      if (entry !== undefined) element.id = entry.id;
      into.append(element);
      return;
    }

    case "emphasis":
      into.append(container("em", node, context));
      return;

    case "strong":
      into.append(container("strong", node, context));
      return;

    case "delete":
      into.append(container("del", node, context));
      return;

    case "inlineCode": {
      const code = document.createElement("code");
      code.textContent = node.value;
      into.append(code);
      return;
    }

    case "link": {
      const anchor = container("a", node, context);
      anchor.setAttribute("href", node.url);
      if (node.title) anchor.setAttribute("title", node.title);
      into.append(anchor);
      return;
    }

    case "image": {
      const image = document.createElement("img");
      image.setAttribute("src", node.url);
      // Written even when empty: an `<img>` with no `alt` at all is one a screen
      // reader announces by its file name.
      image.setAttribute("alt", node.alt ?? "");
      if (node.title) image.setAttribute("title", node.title);
      into.append(image);

      // The order is kept and the bytes land when they land, so a page is never
      // serialised with one picture missing and the reader never waits for the
      // first one to be read before the last. The path stays as the `src` until
      // then, which is also what it stays if there is nothing to put there.
      context.pending.push(
        inlineImage(node.url, context.imageDir).then((outcome) => {
          if (outcome.kind === "inlined") image.setAttribute("src", outcome.src);
          else if (outcome.kind === "kept") {
            context.report.images.push({ url: node.url, reason: outcome.reason });
          }
        }),
      );
      return;
    }

    case "break":
      into.append(document.createElement("br"));
      return;

    case "list": {
      const list = container(node.ordered === true ? "ol" : "ul", node, context);
      // A list that starts where it usually starts needs no attribute; one that
      // starts anywhere else is something the author meant.
      if (node.ordered === true && typeof node.start === "number" && node.start !== 1) {
        list.setAttribute("start", String(node.start));
      }
      into.append(list);
      return;
    }

    case "listItem": {
      const item = container("li", node, context);
      // A GFM task item. Nothing draws its box — not here and not in the editor,
      // which is the gap ADR-0005 §3 records as unowned. The two attributes
      // travel anyway, so the page says which items were tasks and a later slice
      // has something to draw against.
      if (node.checked !== null && node.checked !== undefined) {
        item.setAttribute("data-item-type", "task");
        item.setAttribute("data-checked", String(node.checked));
      }
      into.append(item);
      return;
    }

    case "blockquote":
      into.append(container("blockquote", node, context));
      return;

    case "thematicBreak":
      into.append(document.createElement("hr"));
      return;

    case "table":
      into.append(tableOf(node, context));
      return;

    case "code":
      if (node.lang === "mermaid") into.append(mermaidHost(node.value, context));
      else into.append(fence(node, context));
      return;

    case "math":
      context.math = true;
      into.append(renderMath(node.value, true));
      return;

    case "inlineMath":
      context.math = true;
      into.append(renderMath(node.value, false));
      return;

    case "footnoteReference": {
      const label = node.label ?? "";
      const reference = document.createElement("sup");
      // The attribute the editor's own footnote carries and reads back
      // (`@milkdown/preset-gfm`), so a footnote is the same thing in both. Its
      // extra `data-type` is a selector for its parser, and nothing parses this
      // page, so it is not repeated here.
      reference.setAttribute("data-label", label);
      reference.textContent = label;
      into.append(reference);
      return;
    }

    case "footnoteDefinition": {
      const label = node.label ?? "";
      const definition = document.createElement("dl");
      definition.setAttribute("data-label", label);
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      renderChildren(node.children, detail, context);
      definition.append(term, detail);
      into.append(definition);
      return;
    }

    case "yaml":
      // The editor's own rows, from the same builder (ADR-0005 §2.4): metadata
      // that read as metadata on screen and as body text in the page would be
      // two readings of one document.
      into.append(frontMatterRows(node.value));
      return;

    default:
      // `definition`, `html`, an unresolved reference, and anything mdast grows
      // that this writer has not met. A container still shows its text — the
      // header above says what is dropped on purpose and why.
      renderChildren(childrenOf(node), into, context);
  }
}

/**
 * The table of contents a `[TOC]` becomes (ADR-0005 §2.7).
 *
 * Anchors rather than the editor's buttons: the editor has no heading ids to
 * point at (ADR-0002 §2.6) and this page does, which is the whole reason the
 * export numbers its headings.
 *
 * The indentation is `level - shallowest`, measured from the document's own
 * shallowest heading rather than from `h1` — the same number `fillTocList` puts
 * on an editor entry, and the same split of duties: the document knows how deep
 * it goes, the width of one step is `document.css`'s business.
 */
function tocBlock(outline: Outline): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-newmd-toc", "");
  const list = document.createElement("div");
  list.setAttribute("data-newmd-toc-list", "");

  const entries = outline.entries.map((entry) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.setAttribute("data-newmd-toc-entry", "");
    link.setAttribute("href", `#${entry.id}`);
    link.style.setProperty("--newmd-toc-indent", String(entry.level - outline.shallowest));
    link.textContent = entry.text;
    item.append(link);
    return item;
  });

  const ul = document.createElement("ul");
  ul.append(...entries);
  list.append(ul);
  root.append(list);
  return root;
}

/**
 * GFM table alignment, carried onto every cell in a column.
 *
 * A column the source said nothing about gets no style at all. The editor writes
 * `left` for that case, but there it is a schema default `prosemirror-tables`
 * needs on every cell; here it would be a style nobody asked for, and the
 * browser's own answer is already the same one.
 */
function tableOf(node: Extract<Nodes, { type: "table" }>, context: Context): HTMLTableElement {
  const table = document.createElement("table");
  const align: readonly (string | null)[] = node.align ?? [];

  // mdast's first row is the header row; nothing marks it as one.
  const [head, ...body] = node.children;
  if (head !== undefined) {
    const thead = document.createElement("thead");
    thead.append(tableRow(head, align, true, context));
    table.append(thead);
  }
  if (body.length > 0) {
    const tbody = document.createElement("tbody");
    for (const row of body) tbody.append(tableRow(row, align, false, context));
    table.append(tbody);
  }
  return table;
}

function tableRow(
  row: Extract<Nodes, { type: "tableRow" }>,
  align: readonly (string | null)[],
  header: boolean,
  context: Context,
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  row.children.forEach((cell, index) => {
    const element = header ? document.createElement("th") : document.createElement("td");
    const column = align[index] ?? null;
    if (column !== null) element.setAttribute("style", `text-align: ${column}`);
    renderChildren(cell.children, element, context);
    tr.append(element);
  });
  return tr;
}

/**
 * A fence, tokenised by the editor's own Shiki pass (ADR-0005 §2.6).
 *
 * The tokens are not awaited here: the element is built now so the page's order
 * is settled, and the spans land when Shiki answers. A block whose language
 * Shiki does not carry keeps the text it already has — `highlight` answers that
 * case with `null` rather than throwing, and a fence nobody can colour is a
 * fence to print.
 */
function fence(node: Extract<Nodes, { type: "code" }>, context: Context): HTMLElement {
  const language = node.lang ?? "";
  const pre = document.createElement("pre");
  // The attribute the editor puts the language in, plus the class the rest of
  // the world reads it from. Nothing parses this page, so neither is load-bearing
  // — both are there for whatever does.
  if (language !== "") pre.setAttribute("data-language", language);
  const code = document.createElement("code");
  if (language !== "") code.className = `language-${language}`;
  code.textContent = node.value;
  pre.append(code);

  context.pending.push(
    highlight(node.value, language).then((tokens) => {
      if (tokens !== null) code.replaceChildren(...tokenSpans(tokens, node.value));
    }),
  );
  return pre;
}

/**
 * Shiki's tokens as spans over the source they came from.
 *
 * `highlight` flattens lines, so the newlines between them are not in any token
 * and the source between one offset and the next has to be put back verbatim —
 * that is what keeps a block's blank lines and its indentation.
 */
function tokenSpans(tokens: readonly HighlightToken[], source: string): Node[] {
  const nodes: Node[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.text === "") continue;
    if (token.offset > cursor) {
      nodes.push(document.createTextNode(source.slice(cursor, token.offset)));
    }
    const span = document.createElement("span");
    span.setAttribute("data-newmd-token", "");
    // The attribute rather than `style.cssText`: the style carries `--shiki-dark`
    // beside the light colour, and custom properties belong in the attribute the
    // editor and `highlight.css` both read.
    if (token.style !== "") span.setAttribute("style", token.style);
    span.textContent = token.text;
    nodes.push(span);
    cursor = token.offset + token.text.length;
  }
  if (cursor < source.length) nodes.push(document.createTextNode(source.slice(cursor)));
  return nodes;
}

/**
 * A diagram's block, with the drawing asked for.
 *
 * The source goes in a `<pre>` and stays there — it is what the block falls back
 * to when the diagram will not draw, and what `document.css` hides once one has
 * (the same `data-rendered` the editor sets, so one rule serves both).
 *
 * The drawing is not awaited here for the reason a fence's tokens are not: the
 * block is placed now so the page's order is settled, and the drawing lands on
 * it while the rest of the document is being walked. Mermaid is a library this
 * package never sees — `renderMermaid` fetches it inside core's own module, and
 * answers `null` rather than throwing when the source will not draw.
 */
function mermaidHost(source: string, context: Context): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-newmd-mermaid", "");
  host.setAttribute("data-language", "mermaid");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  pre.append(code);
  host.append(pre);

  context.pending.push(
    renderMermaid(source, context.dark).then((svg) => {
      if (svg === null) {
        host.setAttribute("data-rendered", "error");
        return;
      }
      // Safe for the reason the editor's own copy is: Mermaid runs with
      // `securityLevel: "strict"`, so a diagram cannot reach for scripts or
      // anything external.
      const holder = document.createElement("div");
      holder.setAttribute("data-diagram", "");
      holder.innerHTML = svg;
      host.setAttribute("data-rendered", "ok");
      host.append(holder);
    }),
  );
  return host;
}

/**
 * The reader's typography, written over the palette.
 *
 * `useTypographyVariables` does the same thing to the running app's root; a page
 * has no settings store to read and gets these instead. Only what was handed over
 * is written, so a caller with one value does not restate the other three.
 */
function lookCss(look: Look | undefined): string {
  if (look === undefined) return "";
  const declarations: string[] = [];
  if (look.fontSize !== undefined) declarations.push(`--editor-font-size: ${look.fontSize}px`);
  if (look.lineHeight !== undefined) declarations.push(`--editor-line-height: ${look.lineHeight}`);
  if (look.editorMaxWidth !== undefined) {
    declarations.push(`--editor-max-width: ${look.editorMaxWidth}px`);
  }
  if (look.fontFamily !== undefined) declarations.push(`--font-editor: ${look.fontFamily}`);
  if (declarations.length === 0) return "";
  return `:root {\n  ${declarations.join(";\n  ")};\n}`;
}

interface PageParts {
  theme: ResolvedTheme;
  title: string;
  css: string;
  body: string;
}

/**
 * The file itself.
 *
 * Written as a template rather than assembled as a DOM because the head is
 * nothing but fixed markup and two strings — and because building it as a
 * document would mean importing the body out of one document into another for no
 * gain. The body was serialised by the DOM, so only the title is escaped here.
 *
 * `data-theme` on `<html>` is what `theme.css` and `highlight.css` read; the
 * editor sets the same attribute on its own root, so the page and the app are
 * lit by one mechanism (ADR-0005 §2.8).
 */
function page(parts: PageParts): string {
  return [
    "<!doctype html>",
    `<html data-theme="${parts.theme}">`,
    "<head>",
    // Without it a Chinese document opened from disk is mojibake: a file has no
    // Content-Type header to say what encoding it is in.
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(parts.title)}</title>`,
    `<style>\n${parts.css}\n</style>`,
    "</head>",
    "<body>",
    parts.body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** The four characters that would end an element or an attribute early. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
