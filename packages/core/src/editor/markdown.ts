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
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(inlineLinkReferences)
  .use(remarkStringify, stringifyOptions);

/** Parse Markdown into an mdast tree. */
export function parse(text: string): Root {
  return processor.parse(text);
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
