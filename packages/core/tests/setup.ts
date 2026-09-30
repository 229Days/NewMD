/**
 * Nothing in this file is a test fixture; it is the parts of a browser the test
 * environment does not have.
 */

/**
 * jsdom has no layout, so there is no `document.elementFromPoint` at all.
 *
 * ProseMirror resolves a drop position from the event's coordinates, and it
 * does that before it decides whether it has anything to do with the drop — so
 * a plain text drag landing on the WYSIWYG engine raises a `TypeError` from
 * inside its listener, on an event this app does not even claim. Nothing is at
 * any coordinate in a layout-less document, and `null` is what the real API
 * returns when that is true, so `null` is the answer here too.
 */
if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: (): Element | null => null,
  });
}

/**
 * Likewise `Range.prototype.getClientRects`, which CodeMirror reads when it
 * measures a selection to scroll it into view. Zero rectangles is what a
 * zero-layout environment means, and the stub keeps that from surfacing as a
 * `TypeError` raised on a measure pass after the assertion has already run.
 */
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    writable: true,
    value: (): DOMRectList => [] as unknown as DOMRectList,
  });
}
