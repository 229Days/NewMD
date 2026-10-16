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
