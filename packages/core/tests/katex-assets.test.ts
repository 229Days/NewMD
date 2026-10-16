/**
 * KaTeX's stylesheet, as a page that has left the app has to receive it
 * (ADR-0005 §2.6).
 *
 * The renderer is the editor's already (`renderMath`), so what is left to get
 * wrong is the *carrying*: KaTeX's markup is meaningless without its stylesheet,
 * and its stylesheet is meaningless without the twenty `woff2` files it names by
 * a relative path. A single file sent to somebody else has neither of those
 * folders beside it, so both halves have to be inside the stylesheet.
 *
 * The one rule worth naming here is the one that hides the MathML copy. KaTeX
 * emits each formula twice — a MathML copy for assistive technology and an HTML
 * copy positioned by this stylesheet — and a page with the markup but not the
 * rule prints both.
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { katexStylesheet } from "../src/document/index";

describe("KaTeX's stylesheet, as the export takes it", () => {
  it("carries the fonts rather than pointing at a folder", async () => {
    const css = await katexStylesheet();

    // Every `@font-face` in KaTeX's stylesheet names three files relative to
    // itself, and none of them travels with an exported page.
    expect(css).not.toMatch(/url\(fonts\//);
    // One per face, all twenty of them: a face left behind is a formula that
    // falls back to the reader's own font and lays out wrong.
    expect(css.match(/data:font\/woff2;base64,/g) ?? []).toHaveLength(20);
  });

  it("keeps the one rule that makes the formula readable", async () => {
    const css = await katexStylesheet();

    expect(css).toContain("@font-face");
    expect(css).toContain(".katex");
    expect(css).toContain(".katex-mathml");
    expect(css).toContain("clip-path:inset(50%)");
  });
});
