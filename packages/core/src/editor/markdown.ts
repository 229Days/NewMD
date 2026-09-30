/**
 * Markdown in, Markdown out — the round-trip contract that the golden corpus
 * pins down (ADR-0001 §2.5).
 *
 * This sits below the editing engine on purpose: it is the remark parse and
 * stringify pair Milkdown builds its schema from, and the same pair an ADR §2.3
 * fallback to bare ProseMirror would reuse. Keeping it free of ProseMirror
 * means the merge gate can run without an editor in the picture.
 */
import type { Definition, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify, { type Options } from "remark-stringify";
import { unified, type Plugin } from "unified";
import { inlineMarkHandlers, remarkInlineMarks } from "./inline-marks";

/**
 * Serialization policy. These are decisions about how a user's Markdown looks
 * after a save, not cosmetic preferences of this module.
 *
 * Exported because the WYSIWYG engine serializes through its own remark pipeline
 * and has to be handed the *same* policy: two copies of these choices would
 * drift, and a save would then depend on which engine the user happened to be in.
 */
export const stringifyOptions: Options = {
  // Without these the serializer rewrites what the user typed: `***` for
  // every horizontal rule, `*` for every bullet.
  rule: "-",
  bullet: "-",
  // The paired-delimiter marks parse in `inline-marks.ts` have no builtin
  // handler — mdast has no node type for them — so this is where they are
  // written back out. Part of the same options object as the rest of the
  // policy, because the engine is handed this object wholesale and a second
  // copy would let a save spell `==` differently depending on the mode.
  handlers: inlineMarkHandlers,
};

/**
 * Write link-reference spellings in their inline form, keeping the definitions.
 *
 * `![alt][logo]` and `![alt](images/logo.svg)` render identically, and a WYSIWYG
 * schema has nowhere to put a reference spelling — an image node holds a URL, not
 * a label — so the editor can only ever write the inline form. Making that
 * happen here rather than inside the engine keeps one rule for both: the merge
 * gate and the editor then agree byte for byte, and the difference shows up as a
 * declared `.expected.md` instead of depending on which engine saved the file.
 *
 * The definitions are left alone. The usual remark plugin for this job
 * (`remark-inline-links`) deletes them once nothing points at them, which is
 * real content loss — a definition no current link uses is still something the
 * author wrote.
 */
export const inlineLinkReferences: Plugin<[], Root> = () => (tree) => {
  const definitions = new Map<string, { url: string; title: string | null }>();
  const walk = (node: Record<string, unknown>): void => {
    if (node.type === "definition") {
      const definition = node as unknown as Definition;
      definitions.set(definition.identifier.toLowerCase(), {
        url: definition.url,
        title: definition.title ?? null,
      });
    }
    const children = node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === "object") walk(child as Record<string, unknown>);
      }
    }
  };
  walk(tree as unknown as Record<string, unknown>);

  // mdast spells a reference image or link as its own node type
  // (`imageReference`, `linkReference`) rather than an `image` with a
  // referenceType — there is no URL on it at all until one is looked up here.
  const rewrite = (node: Record<string, unknown>): void => {
    const kind =
      node.type === "imageReference" ? "image" : node.type === "linkReference" ? "link" : null;
    if (kind !== null) {
      const identifier = String(node.identifier ?? "").toLowerCase();
      const definition = definitions.get(identifier);
      if (definition !== undefined) {
        node.type = kind;
        node.url = definition.url;
        // The title rides along. Once this node is inline the renderer stops
        // looking at the definition for one, so leaving it behind would drop
        // the tooltip the author had.
        node.title = definition.title;
        delete node.referenceType;
        delete node.identifier;
        delete node.label;
      }
    }
    const children = node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === "object") rewrite(child as Record<string, unknown>);
      }
    }
  };
  rewrite(tree as unknown as Record<string, unknown>);
};

// GFM: tables, strikethrough, task lists, autolinks. Without it a table
// parses as one paragraph and round-trips "perfectly" while being wrong.
//
// `singleTilde: false` hands a lone `~` back to `editor/inline-marks.ts` as
// subscript instead of spending it on strikethrough. GitHub's own reading is
// `~~` for a strike, and Typora's is `~x~` for a subscript, so this is the
// dialect the app claims to speak — left on, `H~2~O` would parse as struck
// through and M5's subscript would never get a chance to see it.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(inlineLinkReferences)
  .use(remarkInlineMarks)
  .use(remarkStringify, stringifyOptions);

/**
 * Parse Markdown into the raw mdast tree, before any transformer runs.
 *
 * `outline` wants this one: a heading is a heading before anything rewrites the
 * text under it, and running the link-resolution pass would be work with no
 * answer to show for it.
 */
export function parse(text: string): Root {
  return processor.parse(text);
}

/**
 * Parse Markdown and run every transformer the save path runs, stopping short
 * of writing anything out.
 *
 * The distinction matters to the merge gate. Some constructs are recognised by
 * the tokenizer (`![alt][ref]` arrives as `imageReference`) and some only by a
 * transformer that runs after it (`==highlight==` arrives as plain text and
 * becomes `mark` later). Testing recognition against `parse` alone would pass
 * the first kind and report the second as unsupported even though the editor
 * renders it — so the gate reads this tree as well as the raw one.
 */
export function parseTransformed(text: string): Root {
  return processor.runSync(processor.parse(text)) as Root;
}

/**
 * Parse Markdown and write it straight back out.
 *
 * `processSync` is the whole pipeline in one call — parse, run, stringify —
 * which is exactly the save-then-reopen path the corpus has to survive. Spelling
 * it out as three calls buys nothing and drags in unified's processor generics
 * (a plugin whose output type is `Root` is mistaken for a compiler, so the
 * middle step loses its type).
 */
export function roundTrip(text: string): string {
  return processor.processSync(text).toString();
}
