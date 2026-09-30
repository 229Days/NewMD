/**
 * Inserting an image that is already on disk (ADR-0001 §2.5 本地路径插入).
 *
 * Dragging a picture in and picking one through a dialog look like the same
 * feature from the reader's side, and §2.5 lists them side by side for that
 * reason — but only the dialog version has to *find* the file first, and only
 * the dialog version can be reached without a file manager already being open
 * next to the app. So the trip is asserted end to end: a document with a path,
 * a picker, a copy into `./assets/`, and the link in the text.
 *
 * Three things are worth pinning because each fails silently otherwise:
 *
 *   - the bytes are copied, not referenced. `![](C:\photos\pic.png)` survives a
 *     round trip perfectly and breaks the moment the folder moves, which is the
 *     failure §2.8 rules out in advance;
 *   - a document that has never been saved has no `./assets/` beside it, and
 *     picking a file anyway would either write to a path derived from nothing
 *     or put a link in a buffer that cannot resolve it;
 *   - cancelling the picker inserts nothing. A cancelled dialog that still
 *     writes a line is a dialog the reader is afraid to press Escape in.
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
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleInsertLocalImage } from "../src/actions";
import { EditorPane } from "../src/components/EditorPane";
import { fakePlatform } from "./helpers/platform";

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

const SOURCE = "/photos/pic.png";
const DOC_PATH = "/ws/notes/todo.md";

/** Everything the fake disk was asked to do. */
let created: string[] = [];
let written: { path: string; bytes: Uint8Array }[] = [];
/** What the picker hands back; `null` is a cancelled dialog. */
let picked: string | null = null;
/** How many times the picker opened, so a refusal can be told from a cancel. */
let pickCount = 0;

function installPlatform(): void {
  setPlatform({
    ...fakePlatform(),
    pickFile: async () => {
      pickCount += 1;
      return picked;
    },
    readTextFile: async (path) => ({ path, content: "# Title\n", modifiedAt: 1 }),
    readBinaryFile: async (path) => {
      if (path !== SOURCE) throw new Error(`no such file: ${path}`);
      return BYTES;
    },
    writeBinaryFile: async (path, bytes) => {
      written.push({ path, bytes });
      return { path, modifiedAt: 0 };
    },
    createDir: async (path) => {
      created.push(path);
    },
    pathExists: async () => false,
    pathJoin,
    pathParent,
    pathFileName,
    pathExtension,
  });
}

beforeEach(async () => {
  created = [];
  written = [];
  picked = SOURCE;
  pickCount = 0;
  await initI18n();
  installPlatform();
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
  // A toast left over from the previous test would outlive its own TTL, which
  // is exactly what the cancel case asserts against.
  useUi.setState({ mode: "wysiwyg", reveal: null, imageInsert: null, toast: null });
  // Every test starts from the file on disk. Reopening a path that is already
  // open only focuses its tab, keeping whatever edits are in it, so the tab the
  // previous test left behind has to go first or its image is still in here.
  while (useEditor.getState().tabs.length > 0) useEditor.getState().closeTab(0);
  await useEditor.getState().openPath(DOC_PATH);
});

afterEach(() => {
  cleanup();
  resetI18n();
  resetPlatform();
  useUi.setState({ imageInsert: null });
});

/** Mount the editor the way the app does, and wait for a surface to be in it. */
async function mountEditor(): Promise<void> {
  render(<EditorPane />);
  await waitFor(() => {
    expect(document.querySelector("[contenteditable]")).toBeTruthy();
  });
}

describe("inserting an image by path", () => {
  it("copies it beside the document and puts the relative path in the Markdown", async () => {
    await mountEditor();

    await act(async () => {
      await handleInsertLocalImage();
    });

    expect(written).toHaveLength(1);
    expect(written[0]!.path).toBe("/ws/notes/assets/pic.png");
    expect(Array.from(written[0]!.bytes)).toEqual(Array.from(BYTES));
    expect(created).toEqual(["/ws/notes/assets"]);

    await waitFor(() => {
      expect(useEditor.getState().doc?.content).toContain("./assets/pic.png");
    });
    // The copy is what the link points at, not the file that was picked.
    expect(useEditor.getState().doc?.content).not.toContain(SOURCE);
  });

  it("picks nothing when the document has never been saved", async () => {
    await useEditor.getState().newDocument();
    await mountEditor();

    await act(async () => {
      await handleInsertLocalImage();
    });

    // No dialog: there is no `./assets/` to write beside yet, so opening a
    // picker would only invite the reader to choose a file that cannot land.
    expect(pickCount).toBe(0);
    expect(written).toEqual([]);
    expect(useUi.getState().toast?.kind).toBe("error");
    expect(useEditor.getState().doc?.content).not.toContain("./assets/");
  });

  it("inserts nothing when the picker is cancelled", async () => {
    picked = null;
    await mountEditor();

    await act(async () => {
      await handleInsertLocalImage();
    });

    expect(pickCount).toBe(1);
    expect(written).toEqual([]);
    expect(useUi.getState().toast).toBeNull();
    expect(useEditor.getState().doc?.content).not.toContain("./assets/");
  });

  it("says so when the copy fails", async () => {
    setPlatform({
      ...fakePlatform(),
      pickFile: async () => SOURCE,
      readBinaryFile: async () => BYTES,
      writeBinaryFile: async () => {
        throw new Error("disk full");
      },
      pathExists: async () => false,
      pathJoin,
      pathParent,
      pathFileName,
      pathExtension,
    });
    await mountEditor();

    await act(async () => {
      await handleInsertLocalImage();
    });

    await waitFor(() => {
      expect(useUi.getState().toast?.kind).toBe("error");
    });
    expect(useUi.getState().toast?.message).toContain(t("actions.insertImage"));
    expect(useEditor.getState().doc?.content).not.toContain("./assets/");
  });
});
