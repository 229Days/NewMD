/**
 * Tabs (ADR-0001 §4 M3: 多标签; acceptance 多标签下脏状态指示正确).
 *
 * A tab is a document, not a view. What that means in practice is the part
 * worth pinning: dirty state belongs to the document, so it survives switching
 * away and back, and saving one tab says nothing about the others. Getting that
 * wrong is invisible until someone closes a tab and loses work they had not
 * been warned about.
 *
 * `doc` stays as the active document for the twenty-odd readers of "what is
 * open". It is `tabs[activeIndex]` and nothing else — `editor.ts` publishes the
 * two together so they cannot disagree.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPlatform, setPlatform } from "../src/platform";
import type { PlatformAdapter, TextFile, WriteResult } from "../src/platform/types";
import { useEditor } from "../src/stores/editor";
import { isDocumentDirty, type OpenDocument } from "../src/types";

/** Files on an imaginary disk, plus just enough adapter to read and write them. */
function fakePlatform(): { adapter: PlatformAdapter; files: Map<string, string> } {
  const files = new Map<string, string>();
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  const adapter: PlatformAdapter = {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: unused,
    readTextFile: async (path): Promise<TextFile> => ({
      path,
      content: files.get(path) ?? "",
      modifiedAt: 1,
    }),
    readBinaryFile: unused,
    writeTextFile: async (path, content): Promise<WriteResult> => {
      files.set(path, content);
      return { path, modifiedAt: 2 };
    },
    writeBinaryFile: unused,
    createDir: unused,
    renamePath: unused,
    removePath: unused,
    pathExists: unused,
    pathJoin: (a, b) => `${a}/${b}`,
    pathParent: (p) => p.slice(0, p.lastIndexOf("/")),
    pathFileName: (p) => p.slice(p.lastIndexOf("/") + 1),
    pathExtension: (p) => {
      const name = p.slice(p.lastIndexOf("/") + 1);
      const dot = name.lastIndexOf(".");
      return dot < 0 ? "" : name.slice(dot + 1);
    },
    readAppData: async () => null,
    writeAppData: async () => undefined,
    deleteAppData: async () => undefined,
  };
  return { adapter, files };
}

function tab(index: number): OpenDocument {
  const found = useEditor.getState().tabs[index];
  if (!found) throw new Error(`no tab at ${index}`);
  return found;
}

describe("tabs", () => {
  let files: Map<string, string>;

  beforeEach(() => {
    const fake = fakePlatform();
    files = fake.files;
    setPlatform(fake.adapter);
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  });

  afterEach(() => {
    resetPlatform();
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  });

  it("boots with nothing open", () => {
    expect(useEditor.getState().tabs).toEqual([]);
    expect(useEditor.getState().doc).toBeNull();
  });

  it("opens a tab per new document", () => {
    useEditor.getState().newDocument();
    useEditor.getState().newDocument();

    const { tabs, activeIndex, doc } = useEditor.getState();
    expect(tabs).toHaveLength(2);
    expect(activeIndex).toBe(1);
    expect(doc).toBe(tabs[activeIndex]);
  });

  it("makes the chosen tab the open document", () => {
    useEditor.getState().newDocument();
    useEditor.getState().newDocument();

    useEditor.getState().setActive(0);

    const { tabs, activeIndex, doc } = useEditor.getState();
    expect(activeIndex).toBe(0);
    expect(doc).toBe(tabs[0]);
  });

  it("keeps each tab's dirty state separate", () => {
    // The M3 acceptance criterion. Edit one document, look at another, and the
    // first one has to still be waiting to be saved.
    useEditor.getState().newDocument();
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("draft one");

    useEditor.getState().setActive(0);

    expect(isDocumentDirty(tab(1))).toBe(true);
    expect(isDocumentDirty(tab(0))).toBe(false);
    expect(isDocumentDirty(useEditor.getState().doc)).toBe(false);
  });

  it("reopens a file in its existing tab rather than duplicating it", async () => {
    files.set("/notes/a.md", "alpha\n");
    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().newDocument();

    await useEditor.getState().openPath("/notes/a.md");

    const { tabs, activeIndex, doc } = useEditor.getState();
    expect(tabs).toHaveLength(2);
    expect(activeIndex).toBe(0);
    expect(doc?.path).toBe("/notes/a.md");
  });

  it("opens a second file in a second tab without touching the first", async () => {
    files.set("/notes/a.md", "alpha\n");
    files.set("/notes/b.md", "beta\n");
    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().updateContent("edited alpha");
    await useEditor.getState().openPath("/notes/b.md");

    expect(useEditor.getState().tabs).toHaveLength(2);
    expect(tab(0).content).toBe("edited alpha");
    expect(tab(1).content).toBe("beta\n");
  });

  it("closes only the tab it was asked for", () => {
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("first");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("second");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("third");

    useEditor.getState().closeTab(1);

    // Labelled by content rather than by name: untitled names come from a
    // counter that runs for the life of the process, so asserting on them
    // would be asserting on which other tests already ran.
    expect(useEditor.getState().tabs.map((t) => t.content)).toEqual(["first", "third"]);
  });

  it("hands focus to the tab next to the one it closed", () => {
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("first");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("second");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("third");
    useEditor.getState().setActive(1);

    useEditor.getState().closeTab(1);
    expect(useEditor.getState().doc?.content).toBe("third");

    useEditor.getState().closeTab(1);
    expect(useEditor.getState().doc?.content).toBe("first");
  });

  it("leaves the active tab alone when it closes another one", () => {
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("first");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("second");
    useEditor.getState().setActive(1);

    useEditor.getState().closeTab(0);

    expect(useEditor.getState().doc?.content).toBe("second");
    expect(useEditor.getState().activeIndex).toBe(0);
  });

  it("saves one tab without clearing the other's dirty state", async () => {
    files.set("/notes/a.md", "alpha\n");
    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("unsaved draft");
    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().updateContent("edited alpha");

    await useEditor.getState().save();

    expect(isDocumentDirty(tab(0))).toBe(false);
    expect(isDocumentDirty(tab(1))).toBe(true);
    expect(files.get("/notes/a.md")).toBe("edited alpha");
  });

  it("saves a tab the reader is not looking at", async () => {
    // Closing a background tab and choosing 「保存」 has to save *that* tab. It
    // must not drag the reader's view over to it first, and it must not quietly
    // save whichever tab happens to be showing.
    files.set("/notes/a.md", "alpha\n");
    files.set("/notes/b.md", "beta\n");
    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().updateContent("edited alpha");
    await useEditor.getState().openPath("/notes/b.md");
    useEditor.getState().updateContent("edited beta");

    await useEditor.getState().saveTab(0);

    expect(files.get("/notes/a.md")).toBe("edited alpha");
    expect(files.get("/notes/b.md")).toBe("beta\n");
    expect(isDocumentDirty(tab(0))).toBe(false);
    expect(isDocumentDirty(tab(1))).toBe(true);
    expect(useEditor.getState().doc?.path).toBe("/notes/b.md");
    expect(useEditor.getState().activeIndex).toBe(1);
  });
});
