/**
 * Stylesheets a module needs the *text* of rather than the effect of.
 *
 * `document.css`, `theme.css` and `highlight.css` are imported here twice over
 * with different intentions: as side effects by the surfaces that want to be
 * dressed by them, and as strings by `@newmd/core/document`, which hands them to
 * the export to inline into a page (ADR-0005 §2.5, §2.6).
 *
 * Only the string form needs declaring. A bare `import "./x.css"` is a
 * side-effect import, and TypeScript does not resolve those, which is why the
 * three such imports already in this package compile without a word. `?inline`
 * is a value import, so it needs a shape — and this is that shape, with no
 * `vite/client` behind it: the whole of that file is far more than the one
 * query this package uses.
 *
 * The other two are KaTeX's, which is a dependency rather than a file of ours:
 * `?raw` for its stylesheet, because the urls in it have to be rewritten and
 * Vite's own rewrite of them points at a path that means nothing outside the
 * app (`document/katex-assets.ts` says why), and `?inline` for the fonts, which
 * is the data URI the page needs (ADR-0005 §2.6).
 */
declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare module "*.css?raw" {
  const css: string;
  export default css;
}

declare module "*.woff2?inline" {
  const font: string;
  export default font;
}
