/**
 * The editing mode the app is showing (ADR-0001 §2.9).
 *
 * The surface owns the truth — `MarkdownSurface.mode` — but the UI has to
 * render a label and a hotkey has to flip it without a ref in scope, so the
 * mode is mirrored here the same way `spellcheck` is mirrored in settings: the
 * store holds the intent, `EditorPane` applies it to the surface.
 *
 * React wiring itself is not covered — `packages/ui` has no test runner, which
 * is a standing gap rather than a choice. What is pinned here is the API the
 * component and the hotkey both call.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "../src/stores/ui";

/** Read at module load, before any test can put a hand on the store. */
const bootedMode = useUi.getState().mode;

describe("the editing mode", () => {
  beforeEach(() => {
    useUi.setState({ mode: "wysiwyg" });
  });

  it("boots into WYSIWYG, which is the paradigm the ADR picked", () => {
    expect(bootedMode).toBe("wysiwyg");
  });

  it("flips between WYSIWYG and source mode", () => {
    useUi.getState().toggleMode();
    expect(useUi.getState().mode).toBe("source");

    useUi.getState().toggleMode();
    expect(useUi.getState().mode).toBe("wysiwyg");
  });

  it("can be set to a mode rather than only flipped", () => {
    useUi.getState().setMode("source");
    expect(useUi.getState().mode).toBe("source");

    // Setting the mode already showing is a no-op, not an error: a hotkey can
    // arrive twice, and the surface treats it the same way.
    useUi.getState().setMode("source");
    expect(useUi.getState().mode).toBe("source");
  });
});
