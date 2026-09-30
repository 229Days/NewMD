/**
 * KaTeX rendering for the WYSIWYG surface (ADR-0001 §2.4 常用扩展, §4 M5).
 *
 * The parsing half lives in `editor/markdown.ts`, which is the only place that
 * decides what `$…$` and `$$…$$` mean. What is here is the rendering: a schema
 * hands ProseMirror an element, and that element has to be a finished formula
 * by the time it reaches the DOM.
 *
 * Kept out of `wysiwyg.ts` deliberately. That file's contract is that every
 * *Milkdown* call in the project lives in it, and this module makes no such
 * call — it turns a string into markup. Keeping the KaTeX import here also
 * means the stylesheet below is owned by the code that needs it, so no caller
 * has to remember to bring one along.
 */
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * Build the element a math node renders as.
 *
 * `throwOnError: false` is the important option. A formula is the one thing in
 * a document a reader gets half wrong mid-edit, and KaTeX's default is to
 * throw — which would leave `toDOM` unwinding through ProseMirror and take the
 * whole editing surface down over a stray backslash. Instead the formula
 * renders in KaTeX's error colour until it parses, and the document keeps
 * working around it.
 *
 * The source is carried in an attribute rather than only inside the markup:
 * KaTeX already echoes it in a MathML `<annotation>`, but `parseDOM` needs one
 * value to read back, and an attribute is it.
 */
export function renderMath(value: string, displayMode: boolean): Element {
  const host = document.createElement(displayMode ? "div" : "span");
  host.setAttribute("data-newmd-math", displayMode ? "display" : "inline");
  host.setAttribute("data-math", value);
  // KaTeX escapes its input and refuses `\href`-style commands by default
  // (`trust` is off), so this markup is built from the formula, not from
  // anything the formula can smuggle in.
  host.innerHTML = katex.renderToString(value, { displayMode, throwOnError: false });
  return host;
}
