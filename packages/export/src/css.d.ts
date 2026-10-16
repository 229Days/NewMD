/**
 * The one CSS import shape TypeScript cannot resolve on its own.
 *
 * Only `?inline` needs declaring. A bare `import "./x.css"` is a side-effect
 * import, which TypeScript does not try to resolve at all — that is why the
 * existing stylesheet imports in this repo compile with no declaration for them.
 * `vite/client` would cover this and a great deal else besides, and this package
 * wants a browser, not a bundler's whole ambient surface.
 *
 * The declaration is ambient and applies to the whole program, so it also covers
 * the `?inline` imports inside `@newmd/core` — which matters, because those files
 * are type-checked as part of this package's program, and core's own copy of this
 * file is not in it.
 */
declare module "*.css?inline" {
  const css: string;
  export default css;
}
