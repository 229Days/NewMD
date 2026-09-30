/**
 * The settings surface's appearance section (ADR-0001 §4 M4 工作区与外观).
 *
 * The popover already existed with a language switch in it; what M4 adds is the
 * half that changes how the app *looks*. The acceptance criterion for the
 * milestone is 「主题切换即时生效」, and "即时" is the whole test: a setting the
 * reader has to restart the app to see is a setting that did not land.
 *
 * So these assert through to the document root — `data-theme` for the palette
 * and `--editor-*` for typography — rather than only checking that the store
 * took the number. The store being right and the screen being wrong is exactly
 * the bug this is here to prevent.
 */
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import {
  DEFAULT_SETTINGS,
  initI18n,
  resetI18n,
  resetPlatform,
  setPlatform,
  t,
  useSettings,
  useUi,
  watchTheme,
} from "@newmd/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleBar } from "../src/components/TitleBar";
import { fakePlatform } from "./helpers/platform";
import { useTypographyVariables, useUserCss, useWindowTitle } from "../src/hooks/useAppHooks";

/**
 * Everything that paints settings onto the document, mounted beside the panel
 * that changes them. In the app these run from `AppShell`/`bootstrapCore`;
 * pulling them in here keeps the test on the real wiring instead of a copy.
 */
function AppearanceRig() {
  useTypographyVariables();
  useUserCss();
  useWindowTitle();
  return null;
}

async function openSettings(): Promise<HTMLElement> {
  await act(async () => {
    useUi.getState().setSettingsOpen(true);
  });
  return screen.getByRole("dialog", { name: t("settings.title") });
}

describe("the appearance section of the settings panel", () => {
  let stopWatching: () => void;

  beforeEach(async () => {
    await initI18n();
    setPlatform(fakePlatform());
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
    useUi.setState({ theme: "light", settingsOpen: false });
    stopWatching = watchTheme();
  });

  afterEach(async () => {
    stopWatching();
    await act(async () => {
      useUi.getState().setSettingsOpen(false);
    });
    cleanup();
    resetI18n();
    resetPlatform();
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
  });

  /** The panel behind the gear button — the surface this section hangs off. */
  async function renderPanel() {
    render(
      <>
        <AppearanceRig />
        <TitleBar />
      </>,
    );
    await openSettings();
  }

  it("reaches the panel from the gear button", async () => {
    await renderPanel();
    expect(screen.getByRole("dialog", { name: t("settings.title") })).toBeTruthy();
  });

  it("paints a chosen theme on the document root without a restart", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("radio", { name: t("settings.themes.dark") }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    expect(useSettings.getState().settings.theme).toBe("dark");
  });

  it("offers a way back to following the system palette", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: t("settings.themes.dark") }));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });

    fireEvent.click(screen.getByRole("radio", { name: t("settings.themes.system") }));

    // jsdom reports no dark preference, so "system" resolves to light — the
    // point is that the setting can hold "system" again rather than being
    // stuck bouncing between the two hard-coded palettes.
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
    });
    expect(useSettings.getState().settings.theme).toBe("system");
  });

  it("writes a font size change straight into the CSS variable layer", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText(t("settings.fontSize")), {
      target: { value: "20" },
    });

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("20px");
    });
    expect(useSettings.getState().settings.fontSize).toBe(20);
  });

  it("writes a font family change straight into the CSS variable layer", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText(t("settings.fontFamily")), {
      target: { value: "Georgia" },
    });

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--font-editor")).toBe("Georgia");
    });
  });

  it("keeps a custom stylesheet live in a style tag as it is typed", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText(t("settings.customCss")), {
      target: { value: "h1 { color: rgb(1, 2, 3); }" },
    });

    // The tag rather than a computed style: jsdom does not apply a cascade, and
    // the milestone asks for the CSS to be injected, not for jsdom to grade it.
    await waitFor(() => {
      expect(document.head.querySelector("#user-css")?.textContent).toContain("rgb(1, 2, 3)");
    });
    expect(useSettings.getState().settings.customCss).toBe("h1 { color: rgb(1, 2, 3); }");
  });

  it("takes the stylesheet back out again once the box is emptied", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText(t("settings.customCss")), {
      target: { value: "h1 { color: rgb(1, 2, 3); }" },
    });
    await waitFor(() => {
      expect(document.head.querySelector("#user-css")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(t("settings.customCss")), { target: { value: "" } });

    // Leftovers are worse than nothing: CSS the reader deleted that keeps
    // painting is a setting that will not turn off.
    await waitFor(() => {
      expect(document.head.querySelector("#user-css")).toBeNull();
    });
  });
});
