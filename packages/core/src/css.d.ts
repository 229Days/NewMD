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
 */
declare module "*.css?inline" {
  const css: string;
  export default css;
}
