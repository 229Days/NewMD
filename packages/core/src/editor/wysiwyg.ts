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
  commonmark,
  insertImageCommand,
  insertImageInputRule,
  remarkInlineLinkPlugin,
} from "@milkdown/preset-commonmark";
import { gfm, remarkGFMPlugin } from "@milkdown/preset-gfm";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { $markSchema, $nodeSchema, $prose, replaceAll } from "@milkdown/utils";
import type { Root } from "mdast";
import { SearchQuery, type SearchResult } from "prosemirror-search";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import type { Plugin as RemarkPlugin } from "unified";
import type {
  FindMatch,
  FindRequest,
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
import { inlineMarkHandlers, remarkInlineMarks } from "./inline-marks";
import { renderMath } from "./math";
import { inlineLinkReferences, stringifyOptions } from "./markdown";

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
 * Which makes this a view over bytes that stay put: the rows split a line into
 * a key and a value so a stylesheet can tell them apart, and nothing they show
 * is ever written back. The reader edits the source in source mode. Making the
 * rows themselves writable (ADR-0001 §2.5 可视化编辑) needs that write path
 * first; the milestone this belongs to only asks that the metadata be visible.
 */
const FRONT_MATTER_FIELD = /^([\w.-]+):(?:[ \t]+(.*))?$/;

const frontMatterSchema = $nodeSchema("yaml", () => ({
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
  attrs: {
    value: { default: "", validate: "string" },
  },
  toDOM: (node) => {
    const panel = document.createElement("div");
    panel.setAttribute("data-newmd-frontmatter", "");
    for (const line of String(node.attrs.value ?? "").split("\n")) {
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
  },
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
        { plugin: fillAbsentStrings, options: {} },
        // Last, and in the same position the merge gate runs it, so both
        // pipelines see the same tree. Ordering matters only against the two
        // above, and neither of those creates or consumes a paired delimiter.
        { plugin: remarkInlineMarks, options: {} },
      ]);
    })
    .use(commonmarkKeepingDefinitions)
    // See the file header: this one is exported but not in the preset.
    .use(insertImageInputRule)
    .use(definitionSchema)
    .use(markSchema)
    .use(superscriptSchema)
    .use(subscriptSchema)
    .use(mathSchema)
    .use(inlineMathSchema)
    .use(frontMatterSchema)
    .use(gfmWithoutSingleTildeStrikes)
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
      // anchor in `handle.ts` is a heading and not a position. Counting only
      // headings that already match is what keeps a repeated title from
      // landing on the wrong one.
      const view = editor.ctx.get(editorViewCtx);
      let matched = 0;
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at >= 0) return false;
        if (node.type.name !== "heading") return true;
        if (node.attrs.level !== target.level || node.textContent !== target.text) return false;
        if (matched === target.occurrence) {
          // One in from the node boundary: a caret at the boundary itself sits
          // before the heading rather than in it.
          at = pos + 1;
          return false;
        }
        matched += 1;
        return true;
      });
      if (at < 0) return false;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).scrollIntoView(),
      );
      view.focus();
      return true;
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
