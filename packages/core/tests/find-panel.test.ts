/**
 * The find/replace bar's open state (ADR-0001 §2.11 查找替换).
 *
 * The bar itself is UI, but the state it renders off lives in the store — so it
 * is pinned here, where it needs no component mounted to be observed. What has
 * to be checked is whether the panel is showing. `Ctrl+F` opens it from
 * anywhere, `Escape` closes it from inside the editor, and neither of those has
 * a reference to the component: the state is the same kind of thing as the
 * editing mode, and the bar renders off it.
 *
 * The query text is deliberately *not* here. It belongs to the bar, and a
 * global copy of what someone typed into a text field is the sort of thing that
 * outlives the field.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "../src/stores/ui";

/** Read at module load, before any test can put a hand on the store. */
const bootedOpen = useUi.getState().findOpen;

describe("the find panel", () => {
  beforeEach(() => {
    useUi.setState({ findOpen: false });
  });

  it("starts closed — a find bar is asked for, never in the way", () => {
    expect(bootedOpen).toBe(false);
  });

  it("opens and closes on request", () => {
    useUi.getState().setFindOpen(true);
    expect(useUi.getState().findOpen).toBe(true);

    useUi.getState().setFindOpen(false);
    expect(useUi.getState().findOpen).toBe(false);
  });

  it("closes when already closed rather than throwing", () => {
    useUi.getState().setFindOpen(false);
    expect(useUi.getState().findOpen).toBe(false);
  });
});
