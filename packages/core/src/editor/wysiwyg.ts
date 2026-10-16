/**
 * Milkdown WYSIWYG editing surface (ADR-0001 §2.3).
 *
 * Every Milkdown call in the project lives in this file. The rest of the app
 * only ever sees `MarkdownEditorHandle`, so the ADR's escape hatch — drop
 * Milkdown for bare ProseMirror and reuse `editor/markdown.ts` — is still a
 * one-file change rather than a hunt through components.
 *
 * Five things here are deliberate rather than default:
 *
 * 1. The serialize options are `markdown.ts`'s, not a local copy. The engine and
 *    the merge gate have to agree byte for byte or a save stops being predictable.
 * 2. `onChange` comes from our own ProseMirror plugin, not Milkdown's
 *    `plugin-listener`. That one debounces at 200ms and skips the first edit
 *    entirely (`prevDoc` is null on the first tick), which would silently drop
 *    the first character a user types from the autosave path.
 * 3. The commonmark preset is loaded with its `remark-inline-links` step cut
 *    out, and reference links and images are resolved by the shared
 *    `inlineLinkReferences` instead. That step splices every definition out of
 *    the tree, so a file that opened with `[logo]: images/logo.svg` came back
 *    one line shorter after a save that changed nothing.
 * 4. `insertImageInputRule` is loaded next to the preset. Milkdown exports it
 *    but leaves it out of the preset's own `inputRules` list, so typing
 *    `![alt](src)` left the spelling as literal text. With no toolbar yet, that
 *    spelling is the only way an author has to put an image into a document
 *    that does not already contain one.
 * 5. Find and replace uses only `prosemirror-search`'s `SearchQuery`, never its
 *    plugin or commands. Those work off a query held in plugin state, which
 *    would leave the engine holding a second copy of what the find bar is
 *    looking for. See `findGlue` below.
 */
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/core";
import type { Ctx } from "@milkdown/ctx";
import { history, redoCommand, undoCommand } from "@milkdown/plugin-history";
import {
  codeBlockAttr,
  commonmark,
  insertImageCommand,
  insertImageInputRule,
  remarkInlineLinkPlugin,
} from "@milkdown/preset-commonmark";
import { gfm, remarkGFMPlugin } from "@milkdown/preset-gfm";
import type { Node as ProseNode, NodeType } from "@milkdown/prose/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import { $markSchema, $nodeSchema, $prose, $view, replaceAll } from "@milkdown/utils";
import type { Root } from "mdast";
import { SearchQuery, type SearchResult } from "prosemirror-search";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import type { Plugin as RemarkPlugin } from "unified";
import type {
  FindMatch,
  FindRequest,
  HeadingTarget,
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
import { highlight, highlighted } from "./highlight";
import { inlineMarkHandlers, remarkInlineMarks } from "./inline-marks";
import { drawMermaid } from "./mermaid";
import { renderMath } from "./math";
import { inlineLinkReferences, stringifyOptions } from "./markdown";
// The rules that read the mode this file decides (ADR-0002 §2.5, §2.8). Brought
// in here rather than from `toc.ts` so that the merge gate, which imports that
// module, stays free of a stylesheet: nothing about a round trip depends on one.
import "./toc.css";
import { fillTocList, remarkToc, tocEntryTarget, tocMarkerText, type TocEntry } from "./toc";

/**
 * Milkdown's commonmark preset minus the step that eats link definitions.
 *
 * `remark-inline-links` resolves `![alt][logo]` and then splices out *every*
 * `definition` node it finds — not only the ones it just stopped using, all of
 * them. An unused definition is still something the author wrote, so that is
 * content loss on a save, which is the failure the ADR names as this project's
 * biggest risk (§2.5).
 *
 * `inlineLinkReferences` from `editor/markdown.ts` does the same resolution and
 * leaves the definitions standing. Running exactly one implementation of that
 * rule is what keeps the engine and the merge gate from disagreeing about a
 * file's bytes.
 *
 * The preset is a flat array and `$remark` contributes two entries to it — its
 * options slice and the plugin itself — so both are matched by identity. A type
 * comparison would refuse to compile: the entries are unrelated types by
 * design, and their difference is exactly what this filter exists to exploit.
 */
const eatenByDefault: readonly unknown[] = [
  remarkInlineLinkPlugin.plugin,
  remarkInlineLinkPlugin.options,
];
const commonmarkKeepingDefinitions = (commonmark as readonly unknown[]).filter(
  (entry) => !eatenByDefault.includes(entry),
) as typeof commonmark;

/**
 * GFM with its strikethrough un-registered, replaced below by the same plugin
 * configured with `{ singleTilde: false }`.
 *
 * micromark *combines* extensions rather than letting a later one override an
 * earlier one, so adding ours next to the preset's would leave both in play and
 * the first would keep winning — the two entries have to be swapped, not
 * extended. The identity comparison is the one `eatenByDefault` above already
 * relies on, and for the same reason: the preset holds a `$remark` result
 * flattened into its plugin function and its options slice, both of which
 * match by identity and neither of which a type comparison would accept.
 *
 * Why the setting matters: a single tilde is subscript in this dialect
 * (`H~2~O`), and GFM's default reads it as strikethrough — so with the preset's
 * own copy in place the subscript would arrive at the schema as a `delete` and
 * render struck through.
 */
const gfmWithoutSingleTildeStrikes = (gfm as readonly unknown[]).filter(
  (entry) => entry !== remarkGFMPlugin.plugin && entry !== remarkGFMPlugin.options,
) as typeof gfm;

/**
 * Fill in the optional strings mdast leaves as `null`.
 *
 * Milkdown's node schemas declare `alt`, `title` and `url` as required strings,
 * and ProseMirror throws on `null` even though the attribute has a default —
 * defaults only apply when an attribute is *omitted*. So an image with no title
 * (`![a](b.png)`, which is nearly all of them) took the whole parse down with it
 * and the document came back as debris.
 *
 * Coercing to "" is lossless: an empty title serializes as no title, which is
 * how it arrived in the first place.
 */
const fillAbsentStrings: RemarkPlugin<[], Root> = () => (tree) => {
  const walk = (node: Record<string, unknown>): void => {
    for (const key of ["alt", "title", "url"]) {
      if (node[key] === null || node[key] === undefined) node[key] = "";
    }
    const children = node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === "object") walk(child as Record<string, unknown>);
      }
    }
  };
  walk(tree as unknown as Record<string, unknown>);
};

/**
 * A link reference definition: `[logo]: images/logo.svg`.
 *
 * Milkdown's schema has no node for this, so one arrives at the parser as an
 * unknown type and is dropped on the floor — the same silent line loss as the
 * plugin above, one step later. This is a bare atom block that prints its own
 * spelling, which is all M2 needs: the construct has to survive the hop into
 * ProseMirror and back, not yet be editable in place.
 */
const definitionSchema = $nodeSchema("definition", () => ({
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
  attrs: {
    identifier: { default: "", validate: "string" },
    label: { default: "", validate: "string" },
    url: { default: "", validate: "string" },
    title: { default: "", validate: "string" },
  },
  toDOM: (node) => [
    "div",
    {
      "data-newmd-definition": "",
      "data-identifier": node.attrs.identifier,
      "data-label": node.attrs.label,
      "data-url": node.attrs.url,
      "data-title": node.attrs.title,
    },
    `[${node.attrs.label || node.attrs.identifier}]: ${node.attrs.url}`,
  ],
  parseMarkdown: {
    match: ({ type }) => type === "definition",
    runner: (state, node, type) => {
      const identifier = String(node.identifier ?? "");
      state.addNode(type, {
        identifier,
        label: String(node.label ?? identifier),
        url: String(node.url ?? ""),
        title: String(node.title ?? ""),
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "definition",
    runner: (state, node) => {
      state.addNode("definition", undefined, undefined, {
        identifier: node.attrs.identifier,
        label: node.attrs.label,
        url: node.attrs.url,
        // mdast spells "no title" as `null`, and the serializer omits an empty
        // title either way — but `null` is what the node arrived as.
        title: node.attrs.title || null,
      });
    },
  },
}));

/**
 * YAML front matter — `---` fenced metadata at the very top of the file.
 *
 * mdast hands this over as one string: the lines between the fences with the
 * fences stripped, and the same string is what goes back out. So the panel
 * below only ever *reads* it. Round-tripping the metadata through a YAML
 * parser and back would be lossy in ways the reader meets on their next save —
 * comments dropped, keys reordered, quoting normalised — and every one of
 * those would have to be declared as an accepted rewrite in the corpus.
 *
 * Which is why the write path (ADR-0001 §2.5 可视化编辑) is a *view* and not a
 * parser: the rows split a line into a key and a value so a stylesheet can tell
 * them apart, the reader types into a row, and what goes back into `value` is
 * the rows joined by newlines — the same split `toDOM` makes and `parseDOM`
 * undoes. Nothing here is ever understood as YAML, so nothing can be rewritten
 * by being understood.
 */
const FRONT_MATTER_FIELD = /^([\w.-]+):(?:[ \t]+(.*))?$/;

/** One `div[data-line]` per source line, key and value split out for styling. */
function frontMatterRows(value: string): HTMLDivElement {
  const panel = document.createElement("div");
  panel.setAttribute("data-newmd-frontmatter", "");
  for (const line of value.split("\n")) {
    const row = document.createElement("div");
    row.setAttribute("data-line", "");
    const field = FRONT_MATTER_FIELD.exec(line);
    if (field === null) {
      // An indented list item, a comment, a continuation line: shown as it
      // was typed. This reads lines, it does not parse YAML, so a shape it
      // does not recognise shows one row rather than losing the text.
      row.textContent = line;
    } else {
      const key = field[1] ?? "";
      const rawValue = field[2];
      const keyPart = document.createElement("span");
      keyPart.setAttribute("data-key", "");
      keyPart.textContent = key;
      row.append(keyPart);
      if (rawValue === undefined) {
        // A key with nothing after the colon (`tags:`) — the rest of the
        // line is separator, not value.
        row.append(line.slice(key.length));
      } else {
        // The colon and whatever spacing the source used between it and the
        // value. Taken by length rather than re-derived, so the row reads
        // back as the exact line it was split out of.
        const gap = line.length - key.length - rawValue.length;
        row.append(line.slice(key.length, key.length + gap));
        const valuePart = document.createElement("span");
        valuePart.setAttribute("data-value", "");
        valuePart.textContent = rawValue;
        row.append(valuePart);
      }
    }
    panel.append(row);
  }
  return panel;
}

/** The same rows, with each one accepting the caret. */
function editableFrontMatterRows(value: string): HTMLDivElement {
  const panel = frontMatterRows(value);
  for (const row of Array.from(panel.querySelectorAll("[data-line]"))) {
    if (!(row instanceof HTMLElement)) continue;
    // The attribute rather than the `contentEditable` property: this is the
    // spelling a browser reflects it back to anyway, and the one jsdom — where
    // the node view is exercised — keeps.
    row.setAttribute("contenteditable", "true");
    // One line of YAML has no prose in it to spellcheck.
    row.setAttribute("spellcheck", "false");
  }
  return panel;
}

const frontMatterSchema = $nodeSchema("yaml", () => ({
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
  attrs: {
    value: { default: "", validate: "string" },
  },
  // Still the plain rows: this is what a copy or an export walks, and a row
  // that carries the caret is not something to paste.
  toDOM: (node) => frontMatterRows(String(node.attrs.value ?? "")),
  parseDOM: [
    {
      tag: "div[data-newmd-frontmatter]",
      getAttrs: (dom) => {
        if (!(dom instanceof Element)) return { value: "" };
        // Each row's text is its source line, so putting the rows back
        // together is the value again — the split above loses nothing.
        const rows = Array.from(dom.querySelectorAll("[data-line]"));
        return { value: rows.map((row) => row.textContent ?? "").join("\n") };
      },
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === "yaml",
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? "") });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "yaml",
    runner: (state, node) => {
      state.addNode("yaml", undefined, undefined, { value: node.attrs.value });
    },
  },
}));

/**
 * The reader edits the rows, and ProseMirror is not the one editing them.
 *
 * An atom's DOM is rebuilt whenever the node changes, which would take the
 * caret with it on every keystroke — so the panel keeps its own rows, reads an
 * edit back off them, and dispatches the new `value` itself. `update` leaves
 * the DOM alone exactly while the rows already say what the node says; anything
 * else (undo, a tab switch, `setContent`) disagrees with them and rebuilds,
 * which is what keeps the block from drifting away from the file.
 *
 * `$view` and not a `view` on the schema: ProseMirror takes node views through
 * the editor view's `nodeViews` prop, and a spec field of that name is simply
 * never read — which is why this has to be registered on the editor below like
 * any other plugin.
 *
 * `frontMatterSchema.node` rather than `frontMatterSchema`: the array
 * `$nodeSchema` hands back copies `.id` off the `$Node` at the moment it is
 * built, and the `$Node` does not know its own id until its plugin runs — so
 * `$view` keyed on the array would file the node view under `undefined` and
 * ProseMirror, looking up `nodeViews[node.type.name]`, would never find it.
 *
 * `stopEvent` is the other half of the bargain, and it is what makes the caret
 * survive a keystroke. A row is a nested editing host, so while the reader is
 * in one the browser's `activeElement` is the row rather than the editor's own
 * DOM — `view.hasFocus()` is false, `editorOwnsSelection` says no, and
 * ProseMirror never writes the selection back over the caret it does not own.
 * The same walk is what `stopEvent` answers: without it the preset's own
 * bindings would still fire, and Backspace in a row would join the block into
 * the paragraph above instead of deleting a character.
 */
const frontMatterView = $view(frontMatterSchema.node, () => (node, view, getPos) => {
  let current = node;
  const panel = editableFrontMatterRows(String(node.attrs.value ?? ""));
  const shown = (): string =>
    Array.from(panel.querySelectorAll("[data-line]"))
      .map((row) => row.textContent ?? "")
      .join("\n");

  const onInput = (): void => {
    const value = shown();
    if (value === String(current.attrs.value ?? "")) return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, value }));
  };
  panel.addEventListener("input", onInput);

  /**
   * Enter opens a line inside the row it was pressed in.
   *
   * The browser's own Enter would split the row into a second `div` beside the
   * first — a sibling with no `data-line` on it, which `shown` above would not
   * read back and the next save would therefore drop in silence. A newline
   * *inside* the row is the same line break to the reader (`white-space` comes
   * down from the panel as `pre-wrap`), it reads back as one, and it costs the
   * rest of the editing nothing: Backspace on a blank line is then just
   * deleting a character, and so is Delete at the end of one.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const selection = panel.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const lineBreak = panel.ownerDocument.createTextNode("\n");
    range.deleteContents();
    range.insertNode(lineBreak);
    range.setStartAfter(lineBreak);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    // Cancelling the default cancels the `input` event with it, so this edit
    // has to be reported by hand — the same call every other edit arrives by.
    onInput();
  };
  panel.addEventListener("keydown", onKeyDown);

  return {
    dom: panel,
    update: (updated) => {
      if (updated.type !== current.type) return false;
      current = updated;
      const value = String(updated.attrs.value ?? "");
      if (shown() !== value) {
        panel.replaceChildren(...Array.from(editableFrontMatterRows(value).childNodes));
      }
      return true;
    },
    // The editor's `eventBelongsToView` walks up from the event target and
    // stops at the first node view that claims it, so everything the reader
    // does inside the panel is theirs and not ProseMirror's.
    stopEvent: () => true,
    // Every mutation in here is the reader typing or the rebuild above.
    ignoreMutation: () => true,
    destroy: () => {
      panel.removeEventListener("input", onInput);
      panel.removeEventListener("keydown", onKeyDown);
    },
  };
});

/**
 * The commonmark preset's code block, replaced rather than extended.
 *
 * Two things it has to do that the preset's does not:
 *
 * 1. **Keep `meta`** — whatever follows the fence info string
 *    (`` ```ts title=x ``). The preset writes only `lang`, so a file opened in
 *    WYSIWYG and saved again lost that text. `tests/golden/fence-meta.md` is
 *    the corpus half of the fix; this is the half only the engine can do.
 * 2. **Hand a mermaid fence to `mermaidSchema` below.** It has to happen here
 *    because this node owns the mdast `code` type: the parser walks the
 *    registered schemas and takes the first `match` that is true, and this one
 *    was registered by the preset before anything of ours existed. So `match`
 *    here claims every fence *except* mermaid and leaves those to the narrower
 *    match below.
 *
 * The rest — the attributes a theme restyles the `<pre>` and `<code>` with,
 * `preserveWhitespace` on paste, the input rule that opens a fence — is the
 * preset's, carried over unchanged.
 */
const codeBlockSchema = $nodeSchema("code_block", (ctx) => ({
  content: "text*",
  group: "block",
  marks: "",
  defining: true,
  code: true,
  attrs: {
    language: { default: "", validate: "string" },
    meta: { default: "", validate: "string" },
  },
  parseDOM: [
    {
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs: (dom) => {
        // `null` rather than a throw: a `<pre>` that is not an element cannot
        // be one of these, and returning null is how a parse rule declines.
        if (!(dom instanceof HTMLElement)) return null;
        return { language: dom.dataset.language ?? "", meta: "" };
      },
    },
  ],
  toDOM: (node) => {
    const attr = ctx.get(codeBlockAttr.key)(node);
    const language = node.attrs.language as string;
    return [
      "pre",
      { ...attr.pre, ...(language ? { "data-language": language } : {}) },
      ["code", attr.code, 0],
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === "code" && node.lang !== "mermaid",
    runner: (state, node, type) => {
      // Milkdown hands the mdast node over as an indexed record, so every
      // field arrives as `unknown` and has to be read back as what a fence
      // actually carries.
      const language = typeof node.lang === "string" ? node.lang : "";
      const meta = typeof node.meta === "string" ? node.meta : "";
      const value = typeof node.value === "string" ? node.value : "";
      state.openNode(type, { language, meta });
      if (value) state.addText(value);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "code_block",
    runner: (state, node) => {
      state.addNode("code", undefined, node.content.firstChild?.text || "", {
        lang: node.attrs.language,
        meta: node.attrs.meta || null,
      });
    },
  },
}));

/**
 * A ` ```mermaid ` fence, drawn as a diagram (ADR-0001 §2.4 可选扩展).
 *
 * An atom, like the other constructs here whose source the reader edits in
 * source mode: ProseMirror holds the source as an attribute and `toDOM` hands
 * it to `drawMermaid`. Keeping it out of `content` is what lets the drawing
 * take the block's place instead of fighting an editable `<pre>` over it —
 * though the source stays in the DOM behind the picture, for the fallback
 * §2.4 互操作策略 asks for and for a fence that will not draw.
 *
 * `meta` rides along for the reason it does on the code block: text the reader
 * wrote after the info string, which dropping would be a silent edit on save.
 */
const mermaidSchema = $nodeSchema("mermaid", () => ({
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
  attrs: {
    value: { default: "", validate: "string" },
    meta: { default: "", validate: "string" },
  },
  toDOM: (node) => {
    const host = document.createElement("div");
    host.setAttribute("data-newmd-mermaid", "");
    host.setAttribute("data-language", "mermaid");
    const source = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = node.attrs.value;
    source.append(code);
    host.append(source);
    // Fire and forget: `toDOM` is synchronous and Mermaid is not, so the
    // drawing lands in this element whenever it is ready.
    void drawMermaid(host, node.attrs.value);
    return host;
  },
  parseDOM: [
    {
      tag: "div[data-newmd-mermaid]",
      getAttrs: (dom) => {
        if (!(dom instanceof Element)) return null;
        return { value: dom.querySelector("code")?.textContent ?? "", meta: "" };
      },
    },
  ],
  parseMarkdown: {
    match: (node) => node.type === "code" && node.lang === "mermaid",
    runner: (state, node, type) => {
      // `unknown` fields, read back as the strings a fence carries — same as
      // the code block above.
      state.addNode(type, {
        value: typeof node.value === "string" ? node.value : "",
        meta: typeof node.meta === "string" ? node.meta : "",
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "mermaid",
    runner: (state, node) => {
      // Written back as the mdast node it arrived as, so remark-stringify's own
      // `code` handler draws the fence. A second spelling of "how a fence is
      // written" here would be a second thing to keep in step with it.
      state.addNode("code", undefined, node.attrs.value, {
        lang: "mermaid",
        meta: node.attrs.meta || null,
      });
    },
  },
}));

/**
 * The `[TOC]` directive (ADR-0002).
 *
 * `editor/toc.ts` recognises it, and mdast has no node type for it, so without a
 * schema here the parse would build a `toc` this document has no room for — and
 * the preset would drop it silently, taking the marker out of the file on the
 * next save. That is the whole reason this node is not simply a paragraph.
 *
 * The content *is* the marker, kept as real editable text rather than as an
 * attribute: the reader types `[TOC]`, sees a table of contents, and gets the
 * five characters back the moment the caret goes in (ADR-0002 §2.5). An
 * attribute would have to be written into the DOM by hand and read back out of
 * it, which is a second copy of the spelling to keep in step with the first.
 *
 * `marks: ""` for the same reason the code block has it: `[toc]` in bold is not
 * a different directive, and a mark landing inside the marker would make the
 * text stop matching what `tocMarker` looks for.
 */
const tocSchema = $nodeSchema("toc", () => ({
  content: "text*",
  group: "block",
  marks: "",
  defining: true,
  toDOM: () => ["div", { "data-newmd-toc": "" }, 0],
  // No `getAttrs`: the tag says which node this is and the element's text is
  // the marker, so there is nothing to read off it.
  parseDOM: [{ tag: "div[data-newmd-toc]" }],
  parseMarkdown: {
    match: (node) => node.type === "toc",
    runner: (state, node, type) => {
      // Milkdown hands the mdast node over as an indexed record, so the field
      // arrives as `unknown` and has to be read back as what it carries.
      const value = typeof node.value === "string" ? node.value : "";
      state.openNode(type);
      // An empty text node is not a thing ProseMirror will build a document
      // from, and `content: "text*"` is happy with none at all.
      if (value) state.addText(value);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "toc",
    runner: (state, node) => {
      // Back as the node it arrived as, so `editor/toc.ts`'s handler is the one
      // spelling `[TOC]` — a second spelling here would be a second thing to
      // keep in step with it. `textContent` is what the reader can see, which
      // is what the file has to say.
      state.addNode("toc", undefined, undefined, { value: node.textContent });
    },
  },
}));

/**
 * The marker a ProseMirror block holds, or `null` when it holds something else.
 *
 * The engine's copy of `tocMarker` in `editor/toc.ts`, and it has to stay the
 * same rule: one text node, no marks. `textContent` alone would claim
 * `**[TOC]**`, and a block whose content is a code span would be claimed by
 * anything that read the text back out of the tree — which is how a document
 * that writes *about* the directive would end up invoking it.
 */
function tocMarkerOf(node: ProseNode): string | null {
  if (node.childCount !== 1) return null;
  const only = node.firstChild;
  if (only === null || !only.isText || only.marks.length > 0) return null;
  return tocMarkerText(only.text ?? "");
}

/**
 * Keep a `toc` node and the marker it holds from drifting apart (ADR-0002 §2.4).
 *
 * Two directions, one rule, run after every change rather than on a key press:
 *
 * - a top-level paragraph that *is* the marker becomes the block, so typing
 *   `[TOC]` is the whole gesture and there is no confirmation step to miss;
 * - a block whose text is no longer the marker becomes a paragraph again, so
 *   the reader can delete their way out of one.
 *
 * Reading the second direction as a nicety would be a mistake: it is what makes
 * "a `toc` node holds exactly the marker" true by construction, and that
 * invariant is what lets `toMarkdown` write a marker without checking.
 *
 * Running on every change, and not on an input rule, is deliberate — an input
 * rule only fires where a key was pressed, and a `[TOC]` arriving by paste is
 * the same text arriving by the same claim. Anything that left it a paragraph
 * would be saved as `\[TOC]`.
 *
 * The document's own children only: `- [TOC]` and `> [TOC]` are paragraphs too,
 * and the directive is a block of the document rather than a block of a block.
 */
const tocBlockKey = new PluginKey("newmd-toc-block");

function tocBlock() {
  return $prose(() => {
    return new Plugin({
      key: tocBlockKey,
      appendTransaction: (transactions, _previous, state) => {
        // Nothing moved, so nothing can have become or stopped being a marker.
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const { toc, paragraph } = state.schema.nodes;
        if (toc === undefined || paragraph === undefined) return null;

        const wants: { at: number; type: NodeType }[] = [];
        state.doc.forEach((node, offset) => {
          if (node.type === paragraph) {
            if (tocMarkerOf(node) !== null) wants.push({ at: offset, type: toc });
          } else if (node.type === toc) {
            if (tocMarkerOf(node) === null) wants.push({ at: offset, type: paragraph });
          }
        });
        if (wants.length === 0) return null;

        const transaction = state.tr;
        for (const want of wants) transaction.setNodeMarkup(want.at, want.type);
        // `setNodeMarkup` keeps the content, and these two node types hold the
        // same five characters, so the block is the same size afterwards and
        // the caret does not move. Out of the history all the same: what the
        // reader did was type, and undo should give back a keystroke rather
        // than undo the rule that noticed it.
        return transaction.setMeta("addToHistory", false);
      },
    });
  });
}

/** A heading of the document: the anchor, and where the caret lands for it. */
interface DocumentHeading extends TocEntry {
  /**
   * Position just inside the heading, where a caret goes.
   *
   * One in from the node boundary on purpose: a selection at the boundary
   * itself sits *before* the heading rather than in it, so the reader would
   * land beside the target instead of on it.
   */
  at: number;
}

/**
 * Every heading in the ProseMirror document, in order, with its anchor.
 *
 * The single walk behind both the outline's jump and the `[TOC]` block's
 * entries (ADR-0002 §2.6). It has to stay single: the entries carry the anchor a
 * click resolves, so a second walk that counted repeats differently — or
 * flattened a heading's text differently — would draw a list whose entries send
 * the reader to the wrong heading, in a document that looks perfectly fine.
 *
 * `occurrence` counts only headings that already match, which is what keeps a
 * repeated title's number from moving when something unrelated is edited above
 * it. `findMarkdownHeadings` in `outline.ts` counts the same way over mdast;
 * the two must agree, because an anchor minted by one is resolved by the other.
 */
function headingsIn(doc: ProseNode): DocumentHeading[] {
  const counted = new Map<string, number>();
  const found: DocumentHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const level = Number(node.attrs.level);
    // `textContent` is what the reader sees, and what the source engine's
    // `plainText` reads out of mdast — a heading the two flattened differently
    // would be a heading this surface cannot be jumped to.
    const text = node.textContent;
    const key = `${level} ${text}`;
    const occurrence = counted.get(key) ?? 0;
    counted.set(key, occurrence + 1);
    found.push({ level, text, occurrence, at: pos + 1 });
    // A heading's content is its text, so there is no heading below one.
    return false;
  });
  return found;
}

/** Put the caret on `target`, returning whether it was there to go to. */
function revealHeadingIn(view: EditorView, target: HeadingTarget): boolean {
  const found = headingsIn(view.state.doc).find(
    (heading) =>
      heading.level === target.level &&
      heading.text === target.text &&
      heading.occurrence === target.occurrence,
  );
  if (found === undefined) return false;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found.at)).scrollIntoView(),
  );
  view.focus();
  return true;
}

/**
 * The `[TOC]` block as the reader sees it (ADR-0002 §2.5–§2.7).
 *
 * Two halves, both of them live at once: the entries, and the five characters
 * the caret edits. Which of the two is on screen is decided by a `data-mode`
 * decoration rather than by this view — `props.decorations` is recomputed on
 * every state change, selection-only ones included, while a node view's `update`
 * is only called when *this node* changes. A mode switch a caret can trigger is
 * therefore not something a node view can see.
 *
 * The entries are the reader's content in a different sense from the marker: they
 * are drawn from the document and never enter it. They are also drawn by a
 * plugin, not by this view, because they change when a *heading* changes —
 * which is not this node changing, and so not something `update` here would hear
 * about (ADR-0002 §2.7).
 */
const tocView = $view(tocSchema.node, () => (node, view) => {
  const owner = view.dom.ownerDocument;
  const root = owner.createElement("div");
  root.setAttribute("data-newmd-toc", "");
  const list = owner.createElement("div");
  list.setAttribute("data-newmd-toc-list", "");
  // The contentDOM, and the only part ProseMirror owns. It comes second so that
  // the source state — the one a missing decoration means — reads in the same
  // order as the file.
  const source = owner.createElement("div");
  source.setAttribute("data-newmd-toc-source", "");
  root.append(list, source);

  // Drawn once here so a block that arrives mid-document is not blank until
  // something else changes: the plugin below only redraws when the *headings*
  // change, and a document that already had its headings has nothing to redraw
  // when a `[TOC]` appears among them.
  fillTocList(list, headingsIn(view.state.doc));

  /** The entry button `event` landed on, if it landed on one. */
  const entryOf = (event: Event): Element | null => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    return target.closest("[data-newmd-toc-entry]");
  };

  /**
   * Take the press, so the browser does not answer it by moving the caret here.
   *
   * What is being refused is the browser's own selection change: a pointer down
   * inside the editable root collapses the selection into the block, which puts
   * the block into its source state — and the click that follows would then be
   * handled by a block the reader is watching turn into five characters. The
   * caret goes where the entry says instead, in the handler below.
   */
  const onMouseDown = (event: MouseEvent): void => {
    if (entryOf(event) !== null) event.preventDefault();
  };

  const onClick = (event: MouseEvent): void => {
    const entry = entryOf(event);
    if (entry === null) return;
    const heading = tocEntryTarget(entry);
    if (heading === null) return;
    event.preventDefault();
    // The same resolution `revealHeading` performs, out of the same walk — an
    // entry that named a heading this could not find is an entry drawn from a
    // document that has since moved on, and there is nowhere honest to go.
    revealHeadingIn(view, heading);
  };

  root.addEventListener("mousedown", onMouseDown);
  root.addEventListener("click", onClick);

  return {
    dom: root,
    contentDOM: source,
    // Everything outside `source` is ours — the entries, and the elements they
    // are wrapped in. Claiming nothing here is not read as "the list is the
    // document's": ProseMirror takes an unowned change outside the contentDOM
    // for a change to the whole node, dirties it and builds it again. Measurably
    // so — the block comes back as a different element with every keystroke
    // anywhere in the document (see the identity assertion in
    // `tests/toc-block.test.ts`), which is a redraw that costs the reader the
    // block it was supposed to leave alone.
    ignoreMutation: (mutation) => !source.contains(mutation.target),
    destroy: () => {
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("click", onClick);
    },
  };
});

const tocListKey = new PluginKey("newmd-toc-list");

/**
 * Keep every table of contents in step with the headings above it.
 *
 * The node view above draws the list a `[TOC]` starts with; this keeps it true
 * afterwards. Editing a heading does not touch the `toc` node, so the node view
 * hears nothing — the headings are a property of the whole document, and the
 * whole document is what this watches.
 *
 * A signature rather than a redraw on every transaction, the same way
 * `codeHighlight` decides: a cursor moving fires a transaction, and rebuilding
 * every list on each one would throw away and recreate the very DOM the reader
 * may be reaching for.
 */
function tocList() {
  return $prose(() => {
    /** The headings the lists on screen were drawn from. */
    let confirmed: string | null = null;

    /** What a set of headings looks like, as one string to compare against. */
    const signature = (headings: TocEntry[]): string =>
      headings
        .map((heading) => `${heading.level}\u0000${heading.text}\u0000${heading.occurrence}`)
        .join("\u0001");

    const redraw = (view: EditorView): void => {
      const headings = headingsIn(view.state.doc);
      const wanted = signature(headings);
      if (wanted === confirmed) return;
      confirmed = wanted;
      // Read off the DOM rather than kept in a set of hosts: a node view is
      // created and destroyed by ProseMirror, and a registry of them here would
      // be a second lifetime to keep in step with that one.
      for (const list of view.dom.querySelectorAll<HTMLElement>("[data-newmd-toc-list]")) {
        fillTocList(list, headings);
      }
    };

    return new Plugin({
      key: tocListKey,
      view: (view) => {
        // And the first pass is what settles `confirmed`.
        redraw(view);
        return {
          update: (updated, previous) => {
            if (updated.state.doc !== previous.doc) redraw(updated);
          },
        };
      },
    });
  });
}

const tocModeKey = new PluginKey("newmd-toc-mode");

/**
 * Say which half of a `[TOC]` block is the one on screen (ADR-0002 §2.5).
 *
 * A node decoration rather than a field on the node view, and the reason is
 * timing: `props.decorations` is recomputed on every state change, the
 * selection-only transactions a caret produces included, while a node view's
 * `update` is called only when its own node changes. The reader moving into the
 * block changes neither the node nor the document, so of the two this is the
 * only one that hears about it.
 *
 * The attribute means *preview*, and its absence means *source* — the direction
 * a missing decoration has to fall in, because the five characters are what the
 * block really holds and what a save writes.
 */
function tocMode() {
  return $prose(() => {
    const build = (state: EditorState): DecorationSet => {
      const decorations: Decoration[] = [];
      state.doc.forEach((node, offset) => {
        if (node.type.name !== "toc") return;
        const to = offset + node.nodeSize;
        // Strictly inside: a selection at the block's own boundary is beside it
        // rather than in it, and a caret parked there would be showing the five
        // characters while the reader is looking at the list.
        if (state.selection.from > offset && state.selection.to < to) return;
        decorations.push(Decoration.node(offset, to, { "data-mode": "preview" }));
      });
      return DecorationSet.create(state.doc, decorations);
    };

    return new Plugin({ key: tocModeKey, props: { decorations: build } });
  });
}

/**
 * `==highlight==` (ADR-0001 §2.4 常用扩展).
 *
 * mdast has no node type for this — the delimiter is recognised by
 * `editor/inline-marks.ts`, which runs in both this engine and the merge gate —
 * so without a schema here the parse would produce a `mark` this document has
 * no room for and ProseMirror would drop it on the floor.
 *
 * An element mark rather than an atom: the reader edits the text inside the
 * highlight the way they edit any other text, and `<mark>` is the tag browsers
 * already render as one, so `toDOM` needs no styling of its own.
 */
const markSchema = $markSchema("mark", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", 0],
  parseMarkdown: {
    match: ({ type }) => type === "mark",
    runner: (state, node, type) => {
      state.openMark(type);
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "mark",
    runner: (state, mark) => {
      // The mdast type, not a spelling: `remarkInlineMarks` owns the delimiters
      // and writes them back through the handler in `inline-marks.ts`, so the
      // two halves of the hop cannot disagree about how it is spelled.
      state.withMark(mark, "mark");
    },
  },
}));

/**
 * `^sup^` and `~sub~` (ADR-0001 §2.4 常用扩展).
 *
 * Same shape as the highlight for the same reason: mdast has no node type for
 * them, the delimiters are recognised in `editor/inline-marks.ts`, and without
 * a schema here the parse would hand ProseMirror nodes it has nowhere to put.
 *
 * `sup` and `sub` rather than styled spans because that is what the markup
 * means — `<sup>`/`<sub>` are the elements browsers already render, and they
 * carry the semantics a screen reader wants for an exponent or a formula
 * suffix. `state.withMark(mark, "sup")` names the mdast type; the spelling of
 * the caret is `inline-marks.ts`'s to keep.
 */
const superscriptSchema = $markSchema("sup", () => ({
  parseDOM: [{ tag: "sup" }],
  toDOM: () => ["sup", 0],
  parseMarkdown: {
    match: ({ type }) => type === "sup",
    runner: (state, node, type) => {
      state.openMark(type);
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "sup",
    runner: (state, mark) => {
      state.withMark(mark, "sup");
    },
  },
}));

/** @see superscriptSchema — the same schema spelled with a tilde. */
const subscriptSchema = $markSchema("sub", () => ({
  parseDOM: [{ tag: "sub" }],
  toDOM: () => ["sub", 0],
  parseMarkdown: {
    match: ({ type }) => type === "sub",
    runner: (state, node, type) => {
      state.openMark(type);
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "sub",
    runner: (state, mark) => {
      state.withMark(mark, "sub");
    },
  },
}));

/**
 * `$$…$$` — a display formula (ADR-0001 §2.4 常用扩展).
 *
 * mdast holds the formula as a string on a node with no children, so there is
 * nothing here to edit: this is an atom, and the reader changes it in source
 * mode. What the surface owes them is that it renders as mathematics rather
 * than as a pair of dollar signs, and that the source comes back untouched.
 *
 * `meta` is the text a fence can carry after `$$` (`$$ theorem`), kept even
 * though nothing renders it — dropping it would be a silent edit to a file the
 * reader did not ask to change.
 */
const mathSchema = $nodeSchema("math", () => ({
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
  attrs: {
    value: { default: "", validate: "string" },
    meta: { default: "", validate: "string" },
  },
  toDOM: (node) => renderMath(node.attrs.value, true),
  parseDOM: [
    {
      tag: 'div[data-newmd-math="display"]',
      getAttrs: (dom) => ({
        value: dom instanceof Element ? (dom.getAttribute("data-math") ?? "") : "",
        meta: "",
      }),
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === "math",
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? ""), meta: String(node.meta ?? "") });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math",
    runner: (state, node) => {
      state.addNode("math", undefined, undefined, {
        value: node.attrs.value,
        // mdast spells "no meta" as null; the serializer skips either.
        meta: node.attrs.meta || null,
      });
    },
  },
}));

/** `$x^2$` inline — @see mathSchema for why this is an atom too. */
const inlineMathSchema = $nodeSchema("inlineMath", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    value: { default: "", validate: "string" },
  },
  toDOM: (node) => renderMath(node.attrs.value, false),
  parseDOM: [
    {
      tag: 'span[data-newmd-math="inline"]',
      getAttrs: (dom) => ({
        value: dom instanceof Element ? (dom.getAttribute("data-math") ?? "") : "",
      }),
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === "inlineMath",
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? "") });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "inlineMath",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, undefined, { value: node.attrs.value });
    },
  },
}));

/** Where the cursor sits in the document, as a line and column of its text. */
function lineColumn(text: string, offset: number): [number, number] {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  return [line, offset - lastBreak];
}

/**
 * Select a span of the document, resolved safely.
 *
 * `TextSelection.between` rather than `TextSelection.create`: a match can start
 * exactly where a text block does, and `create` refuses positions that are not
 * already text ones. `between` searches for the nearest, so stepping through a
 * document never throws at the reader. This project's ProseMirror is the 1.4
 * API that `@milkdown/prose` pins — there is no `EditorSelection` here.
 */
function selectSpan(view: EditorView, from: number, to: number): void {
  const size = view.state.doc.content.size;
  const clamp = (at: number) => Math.min(Math.max(at, 0), size);
  const doc = view.state.doc;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.between(doc.resolve(clamp(from)), doc.resolve(clamp(to))),
    ),
  );
}

/**
 * Wire one find request up to `prosemirror-search`, as ADR-0001 §2.11 says.
 *
 * `SearchQuery` is the only piece used: `findNext`/`findPrev` walk the
 * document and report positions, and the policy in `editor/find.ts` decides
 * what to do with them. The package's own commands and `search()` plugin are
 * deliberately not in play — those work through a query held in plugin state,
 * which would mean the engine keeping a second copy of what the find bar is
 * looking for and the two drifting apart. The bar asks, this answers, and there
 * is nothing in between to go stale.
 */
function findGlue(
  view: EditorView,
  request: FindRequest,
  replacement: string,
): FindGlue<SearchResult> {
  const query = new SearchQuery({
    search: request.query,
    caseSensitive: request.caseSensitive === true,
    regexp: request.regex === true,
  });

  return {
    get selection() {
      return { from: view.state.selection.from, to: view.state.selection.to };
    },
    span(match) {
      return { from: match.from, to: match.to };
    },
    all() {
      const hits: SearchResult[] = [];
      if (!query.valid) return hits;
      const end = view.state.doc.content.size;
      let from = 0;
      for (;;) {
        const hit = query.findNext(view.state, from, end);
        if (!hit) break;
        hits.push(hit);
        // A zero-width match would otherwise ask the same question forever.
        if (hit.to === hit.from) break;
        from = hit.to;
      }
      return hits;
    },
    select(match) {
      selectSpan(view, match.from, match.to);
    },
    apply(matches) {
      // Back to front, in one transaction: a replacement at the end of the
      // document cannot move one at the start, so the coordinates taken before
      // the edit stay correct while the batch runs. One transaction is also
      // what makes 「全部替换」 a single undo step rather than fifty — the caret
      // is placed inside it for the same reason.
      let tr = view.state.tr;
      for (let i = matches.length - 1; i >= 0; i -= 1) {
        const match = matches[i];
        if (!match) continue;
        if (replacement) {
          tr = tr.replaceWith(match.from, match.to, view.state.schema.text(replacement));
        } else {
          tr = tr.delete(match.from, match.to);
        }
      }
      const last = matches[matches.length - 1];
      if (last) {
        // The last match is edited first, so `last.from` is still its own
        // coordinate and nothing after it has moved.
        const at = last.from + replacement.length;
        const doc = tr.doc;
        const pos = Math.min(Math.max(at, 0), doc.content.size);
        tr = tr.setSelection(TextSelection.between(doc.resolve(pos), doc.resolve(pos)));
      }
      view.dispatch(tr);
    },
  };
}

/**
 * Watch the document and report every real edit.
 *
 * A ProseMirror plugin rather than a Milkdown one so the callback fires
 * synchronously on the transaction that changed the document — see the file
 * header for why `plugin-listener` cannot do this job.
 */
function changeWatcher(
  onChange: (text: string) => void,
  onCursorChange?: (line: number, column: number) => void,
) {
  return $prose((ctx: Ctx) => {
    return new Plugin({
      key: new PluginKey("newmd-editor-watch"),
      view: () => ({
        update(view, prevState) {
          if (!view.state.doc.eq(prevState.doc)) {
            // Looked up per edit rather than held on to: when this plugin runs
            // the serializer slice is still its throw-by-default placeholder, and
            // capturing that would mean every later edit died inside the watcher.
            onChange(ctx.get(serializerCtx)(view.state.doc));
          }
          if (onCursorChange && !view.state.selection.eq(prevState.selection)) {
            // WYSIWYG has no source lines to point at, so this is the position
            // in the document's text — what the status bar can honestly claim.
            const head = view.state.selection.head;
            const text = view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
            const [line, column] = lineColumn(text, Math.min(head, text.length));
            onCursorChange(line, column);
          }
        },
      }),
    });
  });
}

const codeHighlightKey = new PluginKey("newmd-code-highlight");

/**
 * Draw every fence with the colours Shiki read out of it (ADR-0001 §2.6).
 *
 * **Decorations, not a node view.** The block has to stay the reader's own
 * text: editable where it stands, one undo history, serialised by the same
 * serializer as everything else. A node view owning the markup would have to
 * hand all of that back by hand, and the first thing it would break is the
 * round-trip gate. Inline decorations say only how to draw a range, so the
 * document is untouched — which is also why `getContent()` cannot tell whether
 * this plugin ran at all, and why `tests/highlight.test.ts` has to ask the DOM.
 *
 * **Async, and stale rather than empty.** One keystroke makes every token in
 * that block wrong at once. Clearing the colours to wait for the new ones would
 * rebuild the spans around the caret on every character, so the previous
 * decorations are mapped through the change instead and stay on screen until
 * the new tokens land. `ensure` then drops its own refresh if the document
 * moved on while Shiki was working — whoever holds the document now owns it.
 */
function codeHighlight() {
  return $prose(() => {
    /** The fences the current decorations were built against. */
    let confirmed: string | null = null;
    /** Cleared when the editor goes away, so a late answer cannot dispatch. */
    let alive = true;

    /** Every fence in `doc`, with the text and language Shiki has to read. */
    const fences = (doc: ProseNode): { code: string; language: string }[] => {
      const found: { code: string; language: string }[] = [];
      doc.descendants((node) => {
        if (node.type.name !== "code_block") return true;
        found.push({ code: node.textContent, language: String(node.attrs.language ?? "") });
        // A fence's text is its whole content, so there is nothing below it.
        return false;
      });
      return found;
    };

    /**
     * What a document's fences look like, as one string to compare against.
     *
     * Positions are left out on purpose: they are read fresh at build time, and
     * including them would make an edit above a block look like a change of
     * subject and send the whole document back to Shiki.
     */
    const signature = (found: { code: string; language: string }[]): string =>
      found.map((fence) => `${fence.language}\u0000${fence.code}`).join("\u0001");

    /** The decorations we can honestly draw: the fences Shiki has answered for. */
    const build = (doc: ProseNode): DecorationSet => {
      const decorations: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== "code_block") return true;
        const tokens = highlighted(node.textContent, String(node.attrs.language ?? ""));
        if (tokens) {
          // Positions are UTF-16 units on both sides — ProseMirror counts them
          // and so does Shiki's `offset` — so a token lands where it started.
          // `pos + 1` is the first character inside the node.
          const start = pos + 1;
          for (const token of tokens) {
            if (token.text === "") continue;
            decorations.push(
              Decoration.inline(start + token.offset, start + token.offset + token.text.length, {
                "data-newmd-token": "",
                style: token.style,
              }),
            );
          }
        }
        return false;
      });
      return DecorationSet.create(doc, decorations);
    };

    /** Ask Shiki about anything new, and repaint once all of it has answered. */
    const ensure = (view: EditorView): void => {
      // Read once and carry it: this runs on every transaction, and the check
      // below throws the result away almost every time.
      const reading = fences(view.state.doc);
      const wanted = signature(reading);
      if (wanted === confirmed) return;
      confirmed = wanted;
      void Promise.all(reading.map((fence) => highlight(fence.code, fence.language))).then(() => {
        // Every fence of the signature has to be in hand before the repaint, or
        // a block that is merely slower than its neighbour would lose its
        // colours on the way past.
        if (!alive || signature(fences(view.state.doc)) !== wanted) return;
        view.dispatch(view.state.tr.setMeta(codeHighlightKey, true).setMeta("addToHistory", false));
      });
    };

    return new Plugin({
      key: codeHighlightKey,
      state: {
        init: (_config, state) => build(state.doc),
        apply: (tr, previous) => {
          if (tr.getMeta(codeHighlightKey)) return build(tr.doc);
          // Colouring is not part of the document, so a change only moves it.
          return tr.docChanged ? previous.map(tr.mapping, tr.doc) : previous;
        },
      },
      props: {
        decorations: (state) => codeHighlightKey.getState(state),
      },
      view: (view) => {
        // Nothing has been read yet, so this is what starts the first pass.
        ensure(view);
        return {
          // Only the document can change what there is to colour. A selection
          // moving fires an update too, and those arrive between every pair of
          // keystrokes, so they are not worth walking the fences for.
          update: (updated, previous) => {
            if (updated.state.doc !== previous.doc) ensure(updated);
          },
          destroy: () => {
            alive = false;
          },
        };
      },
    });
  });
}

/**
 * Build a WYSIWYG editor over `options.parent`.
 *
 * Asynchronous because Milkdown's boot is: the schema, parser and serializer are
 * all assembled before the surface is usable. Callers get a handle that is valid
 * only once this resolves.
 */
export async function createWysiwygEditor(
  options: MarkdownEditorOptions,
): Promise<MarkdownEditorHandle> {
  /**
   * True while the document is being replaced rather than edited.
   *
   * `setContent` is not a user edit and must not report one — see
   * `tests/handle-contract.test.ts`. Milkdown happens to stay quiet here because
   * a flushed `replaceAll` rebuilds the plugin views instead of updating them,
   * but that is an accident of its internals, not the contract.
   */
  let applying = false;

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.parent);
      ctx.set(defaultValueCtx, options.doc);
      // Replaced rather than merged with Milkdown's default `handlers`: those
      // carry `strong`/`emphasis` marker rewriting that `editor/markdown.ts`
      // does not have, and the two pipelines have to agree byte for byte.
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions);
      ctx.update(remarkPluginsCtx, (list) => [
        ...list,
        // The GFM the preset would have registered, minus single-tilde strikes.
        // It contributes parser and serializer extensions rather than a
        // transformer, so where it sits among the three below changes nothing.
        { plugin: remarkGfm, options: { singleTilde: false } },
        // Same registration the merge gate makes, so both pipelines parse the
        // same spans of `$…$` as math.
        { plugin: remarkMath, options: {} },
        // This plugin's option is the string `'yaml'`, its default. The record
        // the context is typed as will not take a string, and passing `{}` is
        // not neutral either: the plugin treats any truthy argument as a
        // configuration object and would read `.type` off it, registering no
        // fence at all.
        { plugin: remarkFrontmatter, options: "yaml" } as unknown as (typeof list)[number],
        // Reference resolution first: it rewrites `imageReference` into `image`,
        // and the strings below then normalise whatever it produced.
        { plugin: inlineLinkReferences, options: {} },
        // Right after link resolution, the position it holds in the merge gate
        // too: `[TOC]: url` makes every `[TOC]` a link, and the ordering is
        // what decides that rather than a branch of its own.
        { plugin: remarkToc, options: {} },
        { plugin: fillAbsentStrings, options: {} },
        // Last, and in the same position the merge gate runs it, so both
        // pipelines see the same tree. Ordering matters only against the two
        // above, and neither of those creates or consumes a paired delimiter.
        { plugin: remarkInlineMarks, options: {} },
      ]);
    })
    .use(commonmarkKeepingDefinitions)
    // Same node name as the preset's above, and the schema map is keyed by
    // name, so the later registration is the one that takes effect.
    .use(codeBlockSchema)
    // Takes the fences that one deliberately leaves alone.
    .use(mermaidSchema)
    .use(tocSchema)
    .use(tocBlock())
    // Both halves of the block's rendering, and both after the schema: each is
    // keyed on the node type it draws.
    .use(tocView)
    .use(tocList())
    .use(tocMode())
    // See the file header: this one is exported but not in the preset.
    .use(insertImageInputRule)
    .use(definitionSchema)
    .use(markSchema)
    .use(superscriptSchema)
    .use(subscriptSchema)
    .use(mathSchema)
    .use(inlineMathSchema)
    .use(frontMatterSchema)
    .use(frontMatterView)
    .use(gfmWithoutSingleTildeStrikes)
    // Draws fences; changes nothing about them. See `codeHighlight` above.
    .use(codeHighlight())
    .use(history)
    .use(
      changeWatcher((text) => {
        if (applying) return;
        options.onChange(text);
      }, options.onCursorChange),
    )
    .create();

  // Same rule as the source-mode surface: spellcheck is a property on the
  // editable element, applied at mount and by `setSpellcheck` — never a
  // rebuild and never something a caller has to find in the DOM.
  editor.ctx.get(editorViewCtx).dom.spellcheck = options.spellcheck !== false;

  // What `document.css` is scoped to (ADR-0005 §2.5). On the editable rather
  // than on `options.parent`, which Milkdown puts a container of its own
  // between: a namespace two levels above the document would be a namespace
  // that also covers whatever the app decides to render beside it.
  editor.ctx.get(editorViewCtx).dom.setAttribute("data-newmd-document", "");

  return {
    setContent(text) {
      // No early return on equal text. Two documents can hold the same bytes —
      // two empty tabs is the mundane case — and skipping the swap would leave
      // them sharing one undo history. `flush` rebuilds the editor state
      // instead of splicing a slice into the existing one, so the stack is
      // dropped with the document that owned it. Loading a file is a fresh
      // document, not an edit of the old one, and the undo stack must not
      // bridge the two.
      applying = true;
      try {
        replaceAll(text, true)(editor.ctx);
      } finally {
        applying = false;
      }
    },
    getContent() {
      return editor.ctx.get(serializerCtx)(editor.ctx.get(editorViewCtx).state.doc);
    },
    focus() {
      editor.ctx.get(editorViewCtx).focus();
    },
    revealHeading(target) {
      // Resolved in the ProseMirror document rather than against Markdown text:
      // this surface has no lines to jump to, which is the whole reason the
      // anchor in `handle.ts` is a heading and not a position. The walk itself
      // lives in `headingsIn` because the `[TOC]` block's entries are drawn from
      // it — the anchor an entry carries is resolved by the same arithmetic that
      // minted it.
      return revealHeadingIn(editor.ctx.get(editorViewCtx), target);
    },
    insertImage(image) {
      // `title` is a required string on the image schema, and ProseMirror
      // throws on anything else — so the absent title becomes "" and serializes
      // back as no title at all.
      insertImageCommand.run({
        src: image.url,
        alt: image.alt,
        title: image.title ?? "",
      });
    },
    findNext(request: FindRequest): FindMatch | null {
      return stepForward(findGlue(editor.ctx.get(editorViewCtx), request, ""));
    },
    findPrevious(request: FindRequest): FindMatch | null {
      return stepBackward(findGlue(editor.ctx.get(editorViewCtx), request, ""));
    },
    replace(request: ReplaceRequest): boolean {
      return replaceCovered(findGlue(editor.ctx.get(editorViewCtx), request, request.replacement));
    },
    replaceAll(request: ReplaceRequest): number {
      return replaceEverything(
        findGlue(editor.ctx.get(editorViewCtx), request, request.replacement),
      );
    },
    undo() {
      undoCommand.run();
    },
    redo() {
      redoCommand.run();
    },
    setSpellcheck(enabled) {
      // `view.dom` is the contenteditable itself — no class name to guess at.
      editor.ctx.get(editorViewCtx).dom.spellcheck = enabled;
    },
    async destroy() {
      await editor.destroy();
    },
  };
}
