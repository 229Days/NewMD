/**
 * The three stylesheets a document needs, as text (ADR-0005 §2.5, §2.6).
 *
 * The editor takes them the ordinary way — `packages/ui` imports them so the
 * window is dressed, and `highlight.ts` imports its own so the code that reads
 * `--shiki-dark` cannot ship without the rule that defines it. The export needs
 * them as *strings* to write into a `<style>` element, and this is the one place
 * where the same three files are read that way.
 *
 * `?inline` rather than `?raw`: it is the same text the app itself is served,
 * so a stylesheet the build transforms — Lightning CSS downlevels what the
 * target browsers need — is transformed the same way in both. Reading the file
 * would hand the export a second, untransformed copy of a rule, and the two
 * would only be caught disagreeing by looking at a page.
 *
 * Nothing here reads the filesystem at runtime: these are build-time imports,
 * which is why they can be re-exported from a subpath that must stay usable in a
 * plain browser (ADR-0001 §3).
 */
import documentCss from "../document.css?inline";
import highlightCss from "../editor/highlight.css?inline";
import themeCss from "../theme.css?inline";

export { documentCss, highlightCss, themeCss };
