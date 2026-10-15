/**
 * Shiki tokenising for fenced code (ADR-0001 §2.6, §2.11).
 *
 * This module is one half of a mechanism whose other half is `highlight.css`,
 * imported below the way `math.ts` imports KaTeX's. The stylesheet is the rule
 * that reads `--shiki-dark` out of the inline style each token carries, and the
 * two only make sense together — split across two packages, one of them would
 * eventually ship without the other, and a dark code block would quietly go
 * back to being a light one. No engine shapes leak out of here either: what a
 * caller gets is offsets and style strings, which is what `wysiwyg.ts` turns
 * into decorations.
 *
 * The `import()` inside `tokenize` is deliberate. Shiki is by far the largest
 * thing the editor can reach for — grammars and two themes — and a document
 * with no fence in it must never pay for any of that. `mermaid.ts` defers its
 * dependency the same way.
 */
import "./highlight.css";
import type { BundledLanguage } from "shiki";

/** One token of a fence, placed in the source it was read from. */
export type HighlightToken = {
  /**
   * Where the token starts in the code string, counting the newlines between
   * lines — Shiki leaves those out of the tokens themselves, so offsets are
   * the only honest way back to a position in the document.
   */
  offset: number;
  text: string;
  /** Inline style: the light colour, with `--shiki-dark` beside it. */
  style: string;
};

/**
 * The themes the app's own palette is already built on — `ui/src/styles.css`
 * carries the same two foregrounds — so a highlighted block sits in a document
 * it belongs to rather than announcing itself as a widget.
 */
const LIGHT_THEME = "github-light";
const DARK_THEME = "github-dark";

/**
 * How many tokenised blocks to keep. A cache entry is one block's worth of
 * tokens and the key is the block's whole text, so this is a budget on a
 * document's fences rather than on how long the reader has been typing.
 */
const CACHE_LIMIT = 200;

/** Blocks we have an answer for, keyed by language and text. */
const settled = new Map<string, HighlightToken[] | null>();

/** Blocks being tokenised right now, so two callers share one pass. */
const running = new Map<string, Promise<HighlightToken[] | null>>();

/**
 * Tokenise `code` as `language`, or resolve `null` when it cannot be.
 *
 * The answer is cached, so a caller may ask on every keystroke without paying
 * for a pass it already has — which is exactly what the decoration builder in
 * `wysiwyg.ts` does.
 */
export function highlight(code: string, language: string): Promise<HighlightToken[] | null> {
  const key = `${language}\u0000${code}`;
  const done = settled.get(key);
  if (done !== undefined) return Promise.resolve(done);
  const inFlight = running.get(key);
  if (inFlight) return inFlight;
  const work = tokenize(code, language).then((tokens) => {
    running.delete(key);
    settled.set(key, tokens);
    // Oldest first: a `Map` iterates in insertion order, so the front is the
    // least recently *added*, which is as much recency as this needs.
    while (settled.size > CACHE_LIMIT) {
      const oldest = settled.keys().next();
      if (oldest.done) break;
      settled.delete(oldest.value);
    }
    return tokens;
  });
  running.set(key, work);
  return work;
}

/**
 * The same answer, without the wait: `undefined` means "still working on it",
 * which a caller that is drawing a frame has to tell apart from `null` — a
 * fence we will never be able to colour.
 */
export function highlighted(code: string, language: string): HighlightToken[] | null | undefined {
  return settled.get(`${language}\u0000${code}`);
}

/** Read one fence through Shiki. Never rejects; a failure is a `null`. */
async function tokenize(code: string, language: string): Promise<HighlightToken[] | null> {
  // A bare fence, or an indented block with no info string at all, is the
  // common case rather than a failure — there is simply no grammar to pick.
  if (code === "" || language === "") return null;
  try {
    const { codeToTokens } = await import("shiki");
    const result = await codeToTokens(code, {
      // A fence names whatever language the author happened to write, and
      // Shiki's type admits only the ones it bundles. It answers the rest by
      // throwing, and the catch below turns that into "no highlighting" — so
      // the claim this cast makes cannot be wrong in a way that costs anything.
      lang: language as BundledLanguage,
      themes: { light: LIGHT_THEME, dark: DARK_THEME },
    });
    return result.tokens.flat().map((token) => ({
      offset: token.offset,
      text: token.content,
      style: styleOf(token.htmlStyle),
    }));
  } catch {
    // Shiki throws ``Language `x` is not included in this bundle`` for a fence
    // in a language it does not carry — a README full of ```sh, ```output or
    // ```text is the everyday version. That is a block to draw as plain text,
    // not a document that failed to open, so the failure arrives as a value.
    return null;
  }
}

/** Shiki's style record as a `style` attribute. */
function styleOf(htmlStyle: Record<string, string> | undefined): string {
  if (!htmlStyle) return "";
  return Object.entries(htmlStyle)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}
