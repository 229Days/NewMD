/**
 * Global shortcuts, rebound (ADR-0001 §4 M4 快捷键配置).
 *
 * The core module already proves a chord resolves to whatever the settings say.
 * What is untested there is the other end: that a keypress reaching the app
 * actually looks the binding up rather than falling back to a switch on
 * `event.key`. That is the whole point of 「设置面板可改」 — a panel that writes
 * a setting nothing reads is a setting that did not change.
 *
 * The editable-target cases are here too, because which shortcuts stand down
 * while the caret is in text is the part that changes shape once bindings are
 * data: it has to be a property of the action, not of the key.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_HOTKEYS,
  DEFAULT_SETTINGS,
  initI18n,
  resetI18n,
  setPlatform,
  t,
  useSettings,
  useUi,
} from "@newmd/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleBar } from "../src/components/TitleBar";
import { useHotkeys } from "../src/hooks/useAppHooks";
import { fakePlatform } from "./helpers/platform";

/** The app's global listener, with nothing else mounted to get in the way. */
function HotkeyRig() {
  useHotkeys();
  return null;
}

/** Render the rig beside a text field, so an editable target is a real one. */
function mount() {
  render(
    <>
      <HotkeyRig />
      <input aria-label="scratch" />
    </>,
  );
  return screen.getByLabelText("scratch");
}

/** Set the settings wholesale; `hotkeys` is the shape this file cares about. */
async function bind(hotkeys: Partial<typeof DEFAULT_HOTKEYS>): Promise<void> {
  await act(async () => {
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        hotkeys: { ...DEFAULT_HOTKEYS, ...hotkeys },
      },
      loaded: true,
    });
  });
}

function press(target: Element, key: string, mods: Record<string, boolean> = {}): void {
  fireEvent.keyDown(target, {
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });
}

describe("global shortcuts", () => {
  beforeEach(async () => {
    await initI18n();
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
    useUi.setState({
      sidebarOpen: true,
      findOpen: false,
      settingsOpen: false,
      mode: "wysiwyg",
    });
  });

  afterEach(() => {
    cleanup();
    resetI18n();
    useUi.setState({ findOpen: false, sidebarOpen: true });
  });

  it("fires its default binding", () => {
    mount();
    const before = useUi.getState().sidebarOpen;
    press(document.body, "b", { ctrlKey: true });
    expect(useUi.getState().sidebarOpen).toBe(!before);
  });

  it("fires the binding the settings hold instead of the default", async () => {
    mount();
    await bind({ toggleSidebar: "Mod+Shift+B" });

    press(document.body, "b", { ctrlKey: true });
    expect(useUi.getState().sidebarOpen).toBe(true);

    press(document.body, "b", { ctrlKey: true, shiftKey: true });
    expect(useUi.getState().sidebarOpen).toBe(false);
  });

  it("stops firing a shortcut the reader has cleared", async () => {
    mount();
    await bind({ toggleSidebar: "" });

    press(document.body, "b", { ctrlKey: true });
    expect(useUi.getState().sidebarOpen).toBe(true);
  });

  it("lets find open from inside a text field and keeps the rest standing down", () => {
    const field = mount();

    press(field, "f", { ctrlKey: true });
    expect(useUi.getState().findOpen).toBe(true);

    // Ctrl+W is meant for the editor, not for this one: a global close firing
    // while the caret sits in a field would close the document under a form.
    press(field, "w", { ctrlKey: true });
    expect(useUi.getState().sidebarOpen).toBe(true);
  });
});

describe("rebinding a shortcut from the settings panel", () => {
  const BINDING = { toggleSidebar: "Mod+Alt+B" };

  beforeEach(async () => {
    await initI18n();
    setPlatform(fakePlatform());
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
    useUi.setState({ sidebarOpen: true, settingsOpen: false });
    render(
      <>
        <HotkeyRig />
        <TitleBar />
      </>,
    );
    await act(async () => {
      useUi.getState().setSettingsOpen(true);
    });
  });

  afterEach(() => {
    cleanup();
    resetI18n();
    useUi.setState({ sidebarOpen: true, settingsOpen: false });
  });

  /** The row for `id`: label first, then the chord it is currently bound to. */
  function row(id: string): HTMLElement {
    const label = t(`hotkeys.${id}`);
    const match = screen.getByRole("button", { name: new RegExp(label) });
    if (!(match instanceof HTMLElement)) throw new Error("row is not an element");
    return match;
  }

  async function capture(
    target: HTMLElement,
    key: string,
    mods: Record<string, boolean>,
  ): Promise<void> {
    fireEvent.click(target);
    await act(async () => {
      fireEvent.keyDown(target, {
        key,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ...mods,
      });
    });
  }

  it("shows the default the reader already recognises", () => {
    expect(row("toggleSidebar").textContent).toContain("Ctrl+B");
  });

  it("ignores a chord until the reader has asked to change that row", async () => {
    press(document.body, "b", { ctrlKey: true, altKey: true });

    await waitFor(() => {
      expect(useSettings.getState().settings.hotkeys.toggleSidebar).toBe("Mod+B");
    });
    // Untouched means untouched: the sidebar is where it started, so the chord
    // was read and found to belong to nobody.
    expect(useUi.getState().sidebarOpen).toBe(true);
  });

  it("takes the chord the reader presses and fires it from then on", async () => {
    await capture(row("toggleSidebar"), "b", { ctrlKey: true, altKey: true });

    await waitFor(() => {
      expect(useSettings.getState().settings.hotkeys.toggleSidebar).toBe("Mod+Alt+B");
    });
    expect(row("toggleSidebar").textContent).toContain("Ctrl+Alt+B");

    // The old chord is gone, not merely joined by a second one: a shortcut that
    // keeps working after being replaced is one the reader cannot reassign.
    press(document.body, "b", { ctrlKey: true });
    expect(useUi.getState().sidebarOpen).toBe(true);

    press(document.body, "b", { ctrlKey: true, altKey: true });
    expect(useUi.getState().sidebarOpen).toBe(false);
  });

  it("stays armed until a chord arrives, rather than binding a bare letter", async () => {
    const target = row("toggleSidebar");
    fireEvent.click(target);
    await act(async () => {
      fireEvent.keyDown(target, {
        key: "b",
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      });
    });

    // A bare letter would make every press of `b` toggle the sidebar, and
    // `useHotkeys` never reaches for a chord without Mod on it, so it would be
    // a binding that cannot fire at all. The row waits instead of taking it.
    expect(useSettings.getState().settings.hotkeys.toggleSidebar).toBe("Mod+B");
    expect(target.textContent).toContain(t("hotkeys.capturing"));
  });

  it("names the binding in force in the tooltip beside the button", async () => {
    const hint = (binding: string) => t("titleBar.saveHint", { binding });
    expect(screen.getByTitle(hint("Ctrl+S"))).toBeTruthy();

    await act(async () => {
      useSettings.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          hotkeys: { ...DEFAULT_HOTKEYS, save: "Mod+Alt+S" },
        },
        loaded: true,
      });
    });

    // A tooltip quoting the default after the default has been replaced is the
    // panel lying about what it just changed.
    await waitFor(() => {
      expect(screen.getByTitle(hint("Ctrl+Alt+S"))).toBeTruthy();
    });
    expect(screen.queryByTitle(hint("Ctrl+S"))).toBeNull();
  });

  it("does not take a modifier on its own as the chord", async () => {
    const target = row("toggleSidebar");
    fireEvent.click(target);
    // Ctrl alone is the reader halfway through Ctrl+Alt+B. Binding it would
    // make the row fire on every shortcut the reader starts to press.
    await act(async () => {
      fireEvent.keyDown(target, {
        key: "Control",
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      });
    });

    expect(useSettings.getState().settings.hotkeys.toggleSidebar).toBe("Mod+B");
    expect(target.textContent).toContain(t("hotkeys.capturing"));
  });
});
