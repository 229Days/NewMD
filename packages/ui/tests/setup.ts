/**
 * React 19 wants an explicit marker before anything may call `act()`, because
 * outside a test runner there is no ambient way to tell that updates are being
 * flushed by a test rather than by an event.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom has no layout, so `Range.prototype.getClientRects` — which CodeMirror
 * reads when it scrolls a caret into view — is not there at all. Zero
 * rectangles is what a zero-layout environment means, and stubbing it keeps a
 * jump the milestone is judged on from surfacing as an unhandled error raised
 * on an animation frame after the test has already passed.
 */
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    writable: true,
    value: (): DOMRectList => [] as unknown as DOMRectList,
  });
}
