/**
 * The outline panel (ADR-0001 §4 M4: 大纲侧栏).
 *
 * The milestone is judged on 「大纲点击可跳转」, so this test does the whole
 * trip rather than stopping at either end: it renders the sidebar and the
 * editor together, clicks a heading in the outline, and waits for the caret to
 * arrive. A test that only checked the outline listed the right headings would
 * pass with the jump missing, and a test that only checked the handle would
 * pass with the outline wired to nothing — which are the two ways this feature
 * quietly fails.
 *
 * Source mode is mounted because both engines are already checked against the
 * same jump in `core/tests/handle-contract.test.ts`. What is untested there is
 * the wiring: the outline has no reference to the surface, and neither does the
 * sidebar.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  initI18n,
  resetI18n,
  resetPlatform,
  t,
  useEditor,
  useSettings,
  useUi,
  DEFAULT_SETTINGS,
} from "@newmd/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorPane } from "../src/components/EditorPane";
import { Sidebar } from "../src/components/Sidebar";

const DOC = "# Intro\n## Detail\nBody text\n";

describe("the outline panel", () => {
  beforeEach(async () => {
    await initI18n();
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
    useUi.setState({
      mode: "source",
      sidebarOpen: true,
      settingsOpen: false,
      reveal: null,
      cursor: { line: 1, column: 1 },
    });
    useEditor.getState().newDocument();
    useEditor.getState().updateContent(DOC);
    render(
      <>
        <Sidebar />
        <EditorPane />
      </>,
    );
    // The surface boots on a microtask; a click landing before that would be a
    // click on a sidebar with nowhere to jump to. The pane keeps its handle
    // private, so readiness is read the way `handle-contract` reads it: the
    // editable the engine has put in the host. The outline itself is not the
    // signal, because it is behind a tab none of these tests has clicked yet.
    await waitFor(() => {
      expect(document.querySelector("[contenteditable]")).toBeTruthy();
    });
  });

  afterEach(() => {
    cleanup();
    resetI18n();
    resetPlatform();
    useUi.setState({ reveal: null });
  });

  it("lists the document's headings, shallowest first by depth of nesting", async () => {
    fireEvent.click(screen.getByRole("tab", { name: t("sidebar.tabOutline") }));

    const outline = await screen.findByRole("button", { name: "Detail" });
    // Indentation is what makes an outline an outline rather than a list of
    // titles, so the nested heading must sit further right than its parent.
    const parent = screen.getByRole("button", { name: "Intro" });
    expect(Number.parseInt(outline.style.paddingLeft, 10)).toBeGreaterThan(
      Number.parseInt(parent.style.paddingLeft, 10),
    );
  });

  it("puts the caret on the heading that was clicked", async () => {
    fireEvent.click(screen.getByRole("tab", { name: t("sidebar.tabOutline") }));
    fireEvent.click(await screen.findByRole("button", { name: "Detail" }));

    // Line 2 is `## Detail` in the source. The status bar reads the caret from
    // the surface, so this is the jump seen from outside the wiring.
    await waitFor(() => {
      expect(useUi.getState().cursor.line).toBe(2);
    });
  });

  it("says so when the document has no headings", async () => {
    // Rewriting the document is a store write both panels re-render off, so it
    // is flushed the way an event would be rather than left to a later tick.
    act(() => {
      useEditor.getState().updateContent("plain prose only\n");
    });
    fireEvent.click(screen.getByRole("tab", { name: t("sidebar.tabOutline") }));

    expect(await screen.findByText(t("sidebar.outlineEmpty"))).toBeTruthy();
  });
});
