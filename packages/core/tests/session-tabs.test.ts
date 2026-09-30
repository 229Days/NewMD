/**
 * The session snapshot with more than one tab open (ADR-0001 §4 M3: 多标签).
 *
 * Before tabs, "what was open" was one file and one buffer. Now it is a list,
 * and a snapshot that still writes one of them is not a smaller version of the
 * truth — it is a way to lose every tab the reader was not looking at when the
 * app went down. Content loss is the risk the ADR names first (§2.5).
 *
 * Old snapshots must keep working: the field that holds the list is optional,
 * and a snapshot without it restores exactly the one buffer it describes.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPlatform, setPlatform } from "../src/platform";
import type { JsonValue, PlatformAdapter, TextFile, WriteResult } from "../src/platform/types";
import {
  restoreSession,
  snapshotSession,
  startSessionPersistence,
  stopSessionPersistence,
} from "../src/session";
import { useEditor } from "../src/stores/editor";
import { isDocumentDirty } from "../src/types";

const SESSION_KEY = "session";

/** Files on disk and app-data slots, with just enough adapter to reach both. */
function fakePlatform(): {
  adapter: PlatformAdapter;
  files: Map<string, string>;
  appData: Map<string, JsonValue>;
} {
  const files = new Map<string, string>();
  const appData = new Map<string, JsonValue>();
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
    pathExists: async (path) => files.has(path),
    pathJoin: (a, b) => `${a}/${b}`,
    pathParent: (p) => p.slice(0, p.lastIndexOf("/")),
    pathFileName: (p) => p.slice(p.lastIndexOf("/") + 1),
    pathExtension: (p) => {
      const name = p.slice(p.lastIndexOf("/") + 1);
      const dot = name.lastIndexOf(".");
      return dot < 0 ? "" : name.slice(dot + 1);
    },
    readAppData: async (key) => appData.get(key) ?? null,
    writeAppData: async (key, value) => {
      appData.set(key, value);
    },
    deleteAppData: async (key) => {
      appData.delete(key);
    },
  };
  return { adapter, files, appData };
}

describe("the session snapshot with tabs", () => {
  let files: Map<string, string>;
  let appData: Map<string, JsonValue>;

  beforeEach(() => {
    const fake = fakePlatform();
    files = fake.files;
    appData = fake.appData;
    setPlatform(fake.adapter);
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  });

  afterEach(async () => {
    await stopSessionPersistence();
    resetPlatform();
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null, recent: [] });
  });

  /** Drop the live buffers the way a crash would, without touching the snapshot. */
  function crash(): void {
    useEditor.setState({ tabs: [], activeIndex: -1, doc: null });
  }

  it("records every open tab, not just the one showing", async () => {
    files.set("/notes/a.md", "alpha\n");
    files.set("/notes/b.md", "beta\n");

    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().updateContent("edited alpha");
    await useEditor.getState().openPath("/notes/b.md");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("scratch");

    const snapshot = snapshotSession();
    expect(snapshot.tabs).toHaveLength(3);
    expect(snapshot.tabs?.map((t) => t.fileName)).toEqual([
      "a.md",
      "b.md",
      expect.stringMatching(/^Untitled/),
    ]);
    expect(snapshot.tabs?.map((t) => t.unsavedContent)).toEqual(["edited alpha", null, "scratch"]);
  });

  it("comes back with every tab after a crash", async () => {
    files.set("/notes/a.md", "alpha\n");
    files.set("/notes/b.md", "beta\n");
    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().updateContent("edited alpha");
    await useEditor.getState().openPath("/notes/b.md");
    useEditor.getState().newDocument();
    useEditor.getState().updateContent("scratch");
    await stopSessionPersistence();
    crash();

    await restoreSession();

    const { tabs, activeIndex, doc } = useEditor.getState();
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.path)).toEqual(["/notes/a.md", "/notes/b.md", null]);
    // The unsaved work comes back where it was, not all over the first tab.
    expect(tabs.map((t) => t.content)).toEqual(["edited alpha", "beta\n", "scratch"]);
    expect(isDocumentDirty(tabs[0] ?? null)).toBe(true);
    expect(isDocumentDirty(tabs[1] ?? null)).toBe(false);
    expect(isDocumentDirty(tabs[2] ?? null)).toBe(true);
    expect(activeIndex).toBe(2);
    expect(doc).toBe(tabs[2]);
  });

  it("still restores a snapshot written before tabs existed", async () => {
    // The field is optional on purpose. A snapshot from an older build has one
    // file and one buffer, and that is still a session worth coming back to.
    files.set("/notes/a.md", "alpha\n");
    appData.set(SESSION_KEY, {
      workspacePath: null,
      openFilePath: "/notes/a.md",
      unsavedContent: "recovered alpha",
      sidebarOpen: true,
      savedAt: 1,
    });

    await restoreSession();

    const { tabs, doc } = useEditor.getState();
    expect(tabs).toHaveLength(1);
    expect(doc?.path).toBe("/notes/a.md");
    expect(doc?.content).toBe("recovered alpha");
  });

  it("does not mark a clean tab dirty on the way back", async () => {
    files.set("/notes/a.md", "alpha\n");
    await useEditor.getState().openPath("/notes/a.md");
    await stopSessionPersistence();
    crash();

    await restoreSession();

    expect(isDocumentDirty(useEditor.getState().doc)).toBe(false);
  });

  it("leaves the snapshot alone when a file has vanished", async () => {
    files.set("/notes/a.md", "alpha\n");
    files.set("/notes/b.md", "beta\n");
    await useEditor.getState().openPath("/notes/a.md");
    await useEditor.getState().openPath("/notes/b.md");
    await stopSessionPersistence();
    files.delete("/notes/a.md");
    crash();

    await restoreSession();

    expect(useEditor.getState().tabs.map((t) => t.path)).toEqual(["/notes/b.md"]);
  });

  it("returns to the tab that was showing, not to the same slot", async () => {
    // Slots move when one before them fails to come back. Snapshotting "index 1"
    // and restoring into "index 1" would land on a different document than the
    // one the reader had open, and so would falling back to whichever tab was
    // opened last.
    files.set("/notes/a.md", "alpha\n");
    files.set("/notes/b.md", "beta\n");
    files.set("/notes/c.md", "gamma\n");
    await useEditor.getState().openPath("/notes/a.md");
    await useEditor.getState().openPath("/notes/b.md");
    await useEditor.getState().openPath("/notes/c.md");
    useEditor.getState().setActive(1);
    await stopSessionPersistence();
    files.delete("/notes/a.md");
    crash();

    await restoreSession();

    expect(useEditor.getState().tabs.map((t) => t.path)).toEqual(["/notes/b.md", "/notes/c.md"]);
    expect(useEditor.getState().doc?.path).toBe("/notes/b.md");
  });

  it("writes the snapshot once the debounce has run", async () => {
    files.set("/notes/a.md", "alpha\n");
    await useEditor.getState().openPath("/notes/a.md");
    useEditor.getState().updateContent("edited alpha");
    startSessionPersistence();
    await stopSessionPersistence();

    const stored = appData.get(SESSION_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.stringify(stored)).toContain("edited alpha");
  });
});
