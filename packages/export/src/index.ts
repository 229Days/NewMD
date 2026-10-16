/**
 * The import shapes this package's sources need, pulled into every program that
 * reads them.
 *
 * A workspace package here ships TypeScript rather than a build, so whoever
 * imports `@newmd/export` type-checks `html.ts` as part of its own program — and
 * `page.css?inline` has to resolve there. `packages/ui` is the first such
 * consumer, and without this line its typecheck fails on a file it never wrote.
 * `./css.d.ts` says the rest, including why the shapes are not `vite/client`'s.
 */
/// <reference path="./css.d.ts" />

/**
 * `@newmd/export` — the four backends of ADR-0005 §2.3, one at a time.
 *
 * One pipeline, four outputs, and one entry point each: everything a backend
 * needs to know about the document it is writing arrives as an argument, and the
 * document side of core arrives through `@newmd/core/document` rather than
 * through the editor (ADR-0005 §2.4). What this package is *not* allowed to do
 * is reach an editing engine — the subpath it depends on is guarded by
 * `packages/core/tests/document-subpath.test.ts` on the other side.
 *
 * The Markdown and DOCX backends will be exported from here as they land; the
 * PDF one is the HTML backend plus a print call and produces no export of its
 * own.
 */
export { renderDocumentHtml } from "./html";
export type { DocumentHtmlOptions, HtmlExport, HtmlExportReport, HtmlImageNotice } from "./html";
export type { ImageReason } from "./images";
