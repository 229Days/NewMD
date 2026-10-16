/**
 * The import shapes TypeScript cannot resolve on its own.
 *
 * Only the queried forms need declaring. A bare `import "./x.css"` is a
 * side-effect import, which TypeScript does not try to resolve at all — that is
 * why the existing stylesheet imports in this repo compile with no declaration
 * for them. `vite/client` would cover these and a great deal else besides, and
 * this package wants a browser, not a bundler's whole ambient surface.
 *
 * The declarations are ambient and apply to the whole program, so they also
 * cover the imports inside `@newmd/core` — which matters, because those files are
 * type-checked as part of this package's program, and core's own copy of this
 * file is not in it. That is why the four shapes below are the same four core
 * declares, kept in step by hand: two files that must agree, in two packages that
 * only meet through a tsconfig.
 */
declare module "*.css?inline" {
  const css: string;
  export default css;
}

/** A stylesheet read as it is on disk, rather than as the build would have it. */
declare module "*.css?raw" {
  const css: string;
  export default css;
}

/** A font carried in the file as a data URI (ADR-0005 §2.6). */
declare module "*.woff2?inline" {
  const font: string;
  export default font;
}
