/**
 * Exporting the document as one HTML page (ADR-0005 §2.6, §2.14).
 *
 * `packages/export` already proves what the page *says*. What is untested there
 * is everything between the reader's finger and that string: which file the
 * dialog offers, where the result lands, what the document's own name does to
 * the page's title, and what the reader is told when the page could not carry
 * everything in it. Each of those fails silently on its own — an export that
 * writes to the wrong name still writes, and one that drops a picture still
 * opens.
 *
 * The pictures are the case worth the most here, because it is the one place
 * the export is *not* the document: `packages/export` hands back a report, and a
 * report nobody reads is a page that quietly lost its images.
 */
// @vitest-environment jsdom
import {
  DEFAULT_SETTINGS,
  initI18n,
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
  resetI18n,
  resetPlatform,
  setPlatform,
  t,
  useEditor,
  useSettings,
  useUi,
} from "@newmd/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleExportHtml } from "../src/actions";
import { TitleBar } from "../src/components/TitleBar";
import { useHotkeys } from "../src/hooks/useAppHooks";
import { fakePlatform } from "./helpers/platform";

const DOC_PATH = "/ws/notes/todo.md";
const MARKDOWN = "# Todo\n\nBuy milk.\n\n![map](./assets/map.png)\n";
/** A one-pixel PNG header: enough to be bytes, and recognisable in base64. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** What the save dialog hands back; `null` is a cancelled dialog. */
let chosen: string | null = "/ws/notes/todo.html";
/** Every name and filter the dialog was opened with. */
let asked: { defaultName: string; extensions: string[] }[] = [];
/** Every file the export wrote. */
let written: { path: string; content: string }[] = [];
/** Whether reading the document's pictures works. */
let picturesReadable = true;

function installPlatform(): void {
  setPlatform({
    ...fakePlatform(),
    pickSavePath: async (defaultName, filters) => {
      asked.push({
        defaultName,
        extensions: (filters ?? []).flatMap((filter) => filter.extensions),
      });
      return chosen;
    },
    readTextFile: async (path) => ({ path, content: MARKDOWN, modifiedAt: 1 }),
    readBinaryFile: async (path) => {
      if (!picturesReadable) throw new Error(`no such file: ${path}`);
      return PNG;
    },
    writeTextFile: async (path, content) => {
      written.push({ path, content });
      return { path, modifiedAt: 0 };
    },
    pathJoin,
    pathParent,
    pathFileName,
    pathExtension,
  });
}

/** The page the export wrote, parsed back the way a browser would open it. */
function exportedPage(): Document {
  const first = written[0];
  if (first === undefined) throw new Error("nothing was written");
  return new DOMParser().parseFromString(first.content, "text/html");
}

beforeEach(async () => {
  chosen = "/ws/notes/todo.html";
  asked = [];
  written = [];
  picturesReadable = true;
  await initI18n();
  installPlatform();
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
  // A toast left over from the previous test outlives its own TTL, which is
  // exactly what the cancel case asserts against.
  useUi.setState({ mode: "wysiwyg", theme: "light", toast: null });
  // Every test starts from the file on disk, and `openPath` only focuses a tab
  // that is already open — so the previous test's buffer has to go first.
  while (useEditor.getState().tabs.length > 0) useEditor.getState().closeTab(0);
  await useEditor.getState().openPath(DOC_PATH);
});

afterEach(() => {
  cleanup();
  resetI18n();
  resetPlatform();
});

describe("exporting the document as HTML", () => {
  it("writes the page where the reader said, named after the document", async () => {
    await act(async () => {
      await handleExportHtml();
    });

    expect(asked).toEqual([{ defaultName: "todo.html", extensions: ["html", "htm"] }]);
    expect(written).toHaveLength(1);
    expect(written[0]!.path).toBe("/ws/notes/todo.html");

    const page = exportedPage();
    expect(page.title).toBe("todo");
    expect(page.documentElement.getAttribute("data-theme")).toBe("light");
    // The one element every rule in `document.css` is written against. Without
    // it the page opens with no typography at all, and nothing says so.
    expect(page.querySelectorAll("[data-newmd-document]")).toHaveLength(1);
    expect(page.body.textContent).toContain("Buy milk.");
    // Self-contained means self-contained: the rules travel in the file.
    expect(page.querySelector("style")?.textContent ?? "").toContain("[data-newmd-document]");
    expect(useUi.getState().toast?.kind).toBe("success");
  });

  it("carries the pictures the document points at", async () => {
    await act(async () => {
      await handleExportHtml();
    });

    const source = exportedPage().querySelector("img")?.getAttribute("src") ?? "";
    expect(source.startsWith("data:image/png;base64,")).toBe(true);
    // Nothing to report: the page is the whole document.
    expect(useUi.getState().toast?.kind).toBe("success");
  });

  it("says which pictures it could not carry, and keeps their place", async () => {
    picturesReadable = false;

    await act(async () => {
      await handleExportHtml();
    });

    const source = exportedPage().querySelector("img")?.getAttribute("src") ?? "";
    // The author's own spelling is left alone rather than guessed at, so the
    // page still works for a reader who keeps it beside the pictures.
    expect(source).toBe("./assets/map.png");
    // Not `success`: a page that lost a picture is still written, and calling
    // that a success is how the reader finds out when they open it.
    expect(useUi.getState().toast?.kind).toBe("info");
    expect(useUi.getState().toast?.message).toContain("1");
  });

  it("exports a document that has never been saved", async () => {
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("# Draft\n");

    await act(async () => {
      await handleExportHtml();
    });

    expect(asked[0]!.defaultName).toBe("Untitled.html");
    expect(exportedPage().title).toBe("Untitled");
    expect(exportedPage().body.textContent).toContain("Draft");
  });

  it("writes nothing when the dialog is cancelled", async () => {
    chosen = null;

    await act(async () => {
      await handleExportHtml();
    });

    expect(asked).toHaveLength(1);
    expect(written).toEqual([]);
    // A cancelled dialog that still says something is a dialog the reader is
    // afraid to press Escape in.
    expect(useUi.getState().toast).toBeNull();
  });

  it("says so when the page cannot be written", async () => {
    setPlatform({
      ...fakePlatform(),
      pickSavePath: async () => chosen,
      readTextFile: async (path) => ({ path, content: MARKDOWN, modifiedAt: 1 }),
      writeTextFile: async () => {
        throw new Error("disk full");
      },
      pathJoin,
      pathParent,
      pathFileName,
      pathExtension,
    });

    await act(async () => {
      await handleExportHtml();
    });

    await waitFor(() => {
      expect(useUi.getState().toast?.kind).toBe("error");
    });
    expect(useUi.getState().toast?.message).toContain(t("actions.exportHtml"));
  });
});

describe("reaching the export", () => {
  it("runs from the shortcut, without the reader finding the menu", async () => {
    function Rig() {
      useHotkeys();
      return null;
    }
    render(<Rig />);

    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: "e",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
      });
    });

    await waitFor(() => {
      expect(written).toHaveLength(1);
    });
  });

  it("runs from the toolbar's export menu", async () => {
    render(<TitleBar />);

    // One button for the verb, the formats behind it: four more buttons on a
    // toolbar that already has eight is the version that breaks first in a
    // narrow window (ADR-0005 §2.14).
    fireEvent.click(screen.getByRole("button", { name: t("titleBar.export") }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("export.html") }));

    await waitFor(() => {
      expect(written).toHaveLength(1);
    });
  });
});
