/**
 * KaTeX's stylesheet, with its fonts inside it (ADR-0005 §2.6).
 *
 * `editor/math.ts` imports the same stylesheet for its side effect, which is
 * what the app wants: a `<style>` in the page, and the browser fetching the
 * fonts from the bundle. An exported page wants the opposite — one file, opened
 * from anywhere, with nothing beside it — so the stylesheet has to arrive as
 * text with its twenty `url(fonts/KaTeX_*.woff2)` references replaced by the
 * files themselves. That is the whole of this module.
 *
 * **Why the stylesheet is read `?raw` and not `?inline`.** `stylesheet.ts`
 * makes the opposite choice for this project's own CSS, and for a reason that
 * does not hold here: Vite rewrites the urls inside a stylesheet it processes —
 * to an `/@fs/…` path while serving, to an emitted asset while building — and
 * both of those are references to a build that the reader of an exported page
 * does not have. Reading the file as it is on disk is what leaves the
 * `url(fonts/…)` spellings this module knows how to replace. Nothing is lost by
 * skipping the transform: KaTeX ships this file minified, and it is plain enough
 * CSS that there is nothing for the transform to downlevel.
 *
 * **Why the fonts are static imports.** They are what makes the reader's page
 * show the formula in the font it was laid out in, and there are twenty of them
 * — a glob would be tidier, and Vite's `import.meta.glob` does not reach into
 * `node_modules`, which is where they live. So they are spelled out, and
 * `tests/katex-assets.test.ts` is what notices if a KaTeX version adds one.
 *
 * This module is ~400KB of base64 once evaluated (ADR-0005 §1 measured it), so
 * `document/stylesheet.ts` reaches it through `import()` rather than a
 * re-export: a document with no formula in it should cost nothing.
 */
import amsRegular from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline";
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline";
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline";
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline";
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2?inline";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2?inline";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff2?inline";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2?inline";
import sansSerifBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline";
import sansSerifItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline";
import sansSerifRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline";
import scriptRegular from "katex/dist/fonts/KaTeX_Script-Regular.woff2?inline";
import size1Regular from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline";
import size2Regular from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline";
import size3Regular from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline";
import size4Regular from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline";
import typewriterRegular from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline";
import katexMinCss from "katex/dist/katex.min.css?raw";

/**
 * The twenty faces the stylesheet's `@font-face` rules name, by file name.
 *
 * Keyed by the name in the `url()` rather than by the family it declares,
 * because the file name is what is being replaced — and the two do not match:
 * `KaTeX_Main-Regular` is the `KaTeX_Main` family at weight 400, and
 * `KaTeX_Size1-Regular` is a family of its own with no weight in its name.
 */
const FONTS: Record<string, string> = {
  "KaTeX_AMS-Regular": amsRegular,
  "KaTeX_Caligraphic-Bold": caligraphicBold,
  "KaTeX_Caligraphic-Regular": caligraphicRegular,
  "KaTeX_Fraktur-Bold": frakturBold,
  "KaTeX_Fraktur-Regular": frakturRegular,
  "KaTeX_Main-Bold": mainBold,
  "KaTeX_Main-BoldItalic": mainBoldItalic,
  "KaTeX_Main-Italic": mainItalic,
  "KaTeX_Main-Regular": mainRegular,
  "KaTeX_Math-BoldItalic": mathBoldItalic,
  "KaTeX_Math-Italic": mathItalic,
  "KaTeX_SansSerif-Bold": sansSerifBold,
  "KaTeX_SansSerif-Italic": sansSerifItalic,
  "KaTeX_SansSerif-Regular": sansSerifRegular,
  "KaTeX_Script-Regular": scriptRegular,
  "KaTeX_Size1-Regular": size1Regular,
  "KaTeX_Size2-Regular": size2Regular,
  "KaTeX_Size3-Regular": size3Regular,
  "KaTeX_Size4-Regular": size4Regular,
  "KaTeX_Typewriter-Regular": typewriterRegular,
};

/**
 * The two fallbacks that go, and the file that stays.
 *
 * Each `@font-face` names three files — `woff2`, then `woff`, then `ttf` — and
 * the last two exist for browsers that predate the first. Keeping them would
 * mean writing two dead references into every exported page; the first
 * pass removes them, `format(…)` and all, and the second pass turns what is
 * left into the font.
 */
const FALLBACK = /,url\(fonts\/[\w-]+\.(?:woff|ttf)\)\s*format\("[^"]*"\)/g;
const SOURCE = /url\(fonts\/([\w-]+)\.woff2\)/g;

/** KaTeX's stylesheet, with no reference left to a file that is not in it. */
export const katexCss: string = katexMinCss
  .replace(FALLBACK, "")
  .replace(SOURCE, (whole, name: string) => {
    const font = FONTS[name];
    // A face this module has no file for. Left as it was rather than thrown
    // over: this is a KaTeX upgrade that added one, which is a fact about the
    // build and not about the document being exported, and a reader who asked
    // for an export should get one. The test above is where it is caught.
    return font === undefined ? whole : `url(${font})`;
  });
