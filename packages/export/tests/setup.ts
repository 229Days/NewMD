/**
 * Nothing in this file is a test fixture; it is the parts of a browser the test
 * environment does not have.
 *
 * The same stub `packages/core/tests/setup.ts` installs, for the same reason:
 * this package renders KaTeX through core, and jsdom has no layout for it to
 * measure against. Kept as its own copy rather than shared, because a test
 * helper that two packages import is a dependency between their suites — and the
 * day one of them stops needing the stub is the day the other one silently
 * starts depending on it.
 */

/**
 * `elementFromPoint` exists on the interface and not in jsdom. Nothing is at any
 * coordinate in a layout-less document, and `null` is what the real API returns
 * when that is true.
 */
if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: (): Element | null => null,
  });
}

/**
 * Likewise `Range.prototype.getClientRects`, which anything measuring a caret
 * reads. Zero rectangles is what a zero-layout environment means.
 */
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    writable: true,
    value: (): DOMRectList => [] as unknown as DOMRectList,
  });
}
