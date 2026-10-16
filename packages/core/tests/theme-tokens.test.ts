/**
 * The palette, and where it lives (ADR-0005 §2.5, §2.6).
 *
 * `document.css` is written against custom properties and declares none of them:
 * it is the *look*, and the values are the theme's. Until this slice those
 * values lived in `packages/ui`, which the export cannot depend on — a package
 * that exists to write a static file has no business pulling in a React
 * component library to find out what colour `--fg` is. So the palette moved into
 * core, beside the stylesheet that reads it, and the two are held against each
 * other here.
 *
 * What a test can catch is the failure that is invisible on screen: a rule added
 * to `document.css` naming a token no theme defines resolves to nothing, and a
 * CSS declaration that is simply invalid is dropped in silence. The element it
 * was written for then renders exactly as if the rule had never been written.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** `:root` holds the light theme; the dark one is this selector (ADR-0001 §2.11). */
const LIGHT = ":root";
const DARK = '[data-theme="dark"]';

/**
 * Tokens that mean the same thing in both themes, so the dark block has no
 * reason to restate them.
 *
 * Enumerated rather than inferred: a colour added to `document.css` has to be
 * given a dark value or be written down here as theme-independent, and there is
 * no way to tell those apart by reading the name. The list is the place that
 * decision gets recorded, which is the point.
 */
const THEME_INDEPENDENT = [
  "--editor-font-size",
  "--editor-line-height",
  "--editor-max-width",
  "--font-editor",
  "--font-mono",
  "--radius",
  "--radius-sm",
];

/**
 * Tokens no theme defines because the *document* defines them, one element at a
 * time, as the markup is built.
 *
 * Found by this test rather than remembered: `document.css` reads
 * `var(--newmd-toc-indent, 0)` and nothing in either palette sets it — the table
 * of contents carries it on each entry, because how deep an entry sits is a fact
 * about the document and not about the theme (ADR-0002 §2.8). Every one of these
 * comes with a fallback, which is what makes it safe for a stylesheet to read
 * one that may never arrive.
 */
const OWNED_BY_THE_MARKUP = ["--newmd-toc-indent"];

/** Every custom property `css` reads, whether or not anything defines it. */
function tokensRead(css: string): string[] {
  return [...new Set(css.match(/var\(\s*(--[a-z0-9-]+)/g) ?? [])].map((match) =>
    match.replace(/^var\(\s*/, ""),
  );
}

/** Every custom property `css` declares inside the block `selector` opens. */
function tokensDeclared(css: string, selector: string): string[] {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return [];
  const open = css.indexOf("{", at);
  let depth = 0;
  let close = -1;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return [];
  // Up to the colon only, so a token named in a comment above the block — or in
  // a value, as `var(--x)` — is not mistaken for a declaration.
  return css.slice(open, close).match(/--[a-z0-9-]+(?=\s*:)/g) ?? [];
}

describe("the theme core ships", () => {
  it("defines every token the document stylesheet reads", async () => {
    const document = await readFile("src/document.css", "utf8");
    const theme = await readFile("src/theme.css", "utf8");
    const declared = tokensDeclared(theme, LIGHT);

    const undefinedTokens = tokensRead(document).filter(
      (token) => !declared.includes(token) && !OWNED_BY_THE_MARKUP.includes(token),
    );
    expect(undefinedTokens).toEqual([]);
  });

  it("gives every token that varies by theme a value in both", async () => {
    const document = await readFile("src/document.css", "utf8");
    const theme = await readFile("src/theme.css", "utf8");
    const dark = tokensDeclared(theme, DARK);

    // A token defined for the light theme alone leaves its element painted for a
    // white page at the bottom of a dark one — which is what an exported dark
    // document is, since the whole page is inlined into it.
    const missing = tokensRead(document).filter(
      (token) =>
        !THEME_INDEPENDENT.includes(token) &&
        !OWNED_BY_THE_MARKUP.includes(token) &&
        !dark.includes(token),
    );
    expect(missing).toEqual([]);
  });
});
