import { beforeEach, describe, expect, it } from "vitest";
import { saveRecoveryBuffer } from "../src/autosave";
import { resetPlatform, setPlatform } from "../src/platform";
import type { JsonValue, PlatformAdapter } from "../src/platform/types";
import { stopSessionPersistence } from "../src/session";
import { useEditor } from "../src/stores/editor";
import { useSettings } from "../src/stores/settings";
import { useUi } from "../src/stores/ui";
import { useWorkspace } from "../src/stores/workspace";
import { DEFAULT_SETTINGS, type OpenDocument, type RecentEntry } from "../src/types";

/**
 * In-memory stand-in for the Tauri Store plugin: one JSON document of
 * key -> value pairs. `writeAppData` takes JSON values — serialisation is the
 * plugin's job, never the caller's.
 */
function fakeAdapter(): { adapter: PlatformAdapter; store: Map<string, JsonValue> } {
  const store = new Map<string, JsonValue>();
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  const adapter: PlatformAdapter = {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: unused,
    readTextFile: unused,
    writeTextFile: unused,
    writeBinaryFile: unused,
    createDir: unused,
    renamePath: unused,
    removePath: unused,
    pathExists: unused,
    pathJoin: unused,
    pathParent: unused,
    pathFileName: unused,
    pathExtension: unused,
    readAppData: async (key) => store.get(key) ?? null,
    writeAppData: async (key, value) => {
      store.set(key, value);
    },
    deleteAppData: async (key) => {
      store.delete(key);
    },
  };
  return { adapter, store };
}

function seedRecent(): RecentEntry[] {
  return [
    { path: "C:\\w\\a.md", name: "a.md", openedAt: 1 },
    { path: "C:\\w\\b.md", name: "b.md", openedAt: 2 },
  ];
}

function doc(overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    path: "C:\\w\\a.md",
    fileName: "a.md",
    content: "unsaved work",
    savedContent: "",
    lineEnding: "\n",
    modifiedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetPlatform();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  useEditor.setState({ doc: null, recent: [] });
  useWorkspace.setState({ rootPath: null, entries: {}, expanded: [] });
  useUi.setState({ sidebarOpen: true });
});

describe("settings persistence (ADR-0001 §2.11)", () => {
  it("writes the defaults into the store on first launch", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);

    await useSettings.getState().load();

    expect(store.has("settings")).toBe(true);
    expect(store.get("settings")).toEqual(DEFAULT_SETTINGS);
    expect(useSettings.getState().loaded).toBe(true);
    expect(useSettings.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("stores a JSON object, not a pre-serialized string", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);

    await useSettings.getState().patch({ fontSize: 20 });

    const stored = store.get("settings");
    expect(typeof stored).toBe("object");
    expect(stored).not.toBeTypeOf("string");
    expect(stored).toEqual({ ...DEFAULT_SETTINGS, fontSize: 20 });
  });

  it("merges persisted settings over the defaults", async () => {
    const { adapter, store } = fakeAdapter();
    store.set("settings", { fontSize: 22, theme: "dark" });
    setPlatform(adapter);

    await useSettings.getState().load();

    expect(useSettings.getState().settings.fontSize).toBe(22);
    expect(useSettings.getState().settings.theme).toBe("dark");
    // Untouched keys still fall back to the defaults.
    expect(useSettings.getState().settings.imageDirName).toBe(DEFAULT_SETTINGS.imageDirName);
  });

  it("ignores junk persisted under the settings key", async () => {
    const { adapter, store } = fakeAdapter();
    store.set("settings", { fontSize: "huge", theme: 3, bogus: true });
    setPlatform(adapter);

    await useSettings.getState().load();

    expect(useSettings.getState().settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(useSettings.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(useSettings.getState().settings).not.toHaveProperty("bogus");
  });

  it("rewrites the defaults when the stored settings hold nothing usable", async () => {
    const { adapter, store } = fakeAdapter();
    store.set("settings", "not a settings object");
    setPlatform(adapter);

    await useSettings.getState().load();

    expect(store.get("settings")).toEqual(DEFAULT_SETTINGS);
    expect(useSettings.getState().settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe("recent list persistence", () => {
  it("reads the recent list as a structured array", async () => {
    const { adapter, store } = fakeAdapter();
    store.set("recent", seedRecent());
    setPlatform(adapter);

    await useEditor.getState().loadRecent();

    expect(useSettings.getState().loaded).toBe(false);
    expect(useEditor.getState().recent).toEqual(seedRecent());
  });

  it("writes the recent list back as a structured array", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);
    useEditor.setState({ recent: seedRecent() });

    await useEditor.getState().forgetRecent("C:\\w\\b.md");

    const stored = store.get("recent");
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toEqual([seedRecent()[0]]);
  });

  it("drops a corrupt recent list instead of failing startup", async () => {
    const { adapter, store } = fakeAdapter();
    store.set("recent", { nope: true });
    setPlatform(adapter);

    await useEditor.getState().loadRecent();

    expect(useEditor.getState().recent).toEqual([]);
  });
});

describe("session snapshot persistence", () => {
  it("stores the snapshot as a structured object", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);

    await stopSessionPersistence();

    const stored = store.get("session");
    expect(typeof stored).toBe("object");
    expect(stored).not.toBeTypeOf("string");
    expect(stored).toHaveProperty("savedAt");
    expect(stored).toHaveProperty("sidebarOpen");
  });

  it("records which buffer is dirty so a crash can recover it", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);
    useEditor.setState({ doc: doc() });

    await stopSessionPersistence();

    const stored = store.get("session") as Record<string, JsonValue>;
    expect(stored.openFilePath).toBe("C:\\w\\a.md");
    expect(stored.unsavedContent).toBe("unsaved work");
  });
});

describe("crash-recovery buffer", () => {
  it("stores the buffer as a structured object", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);
    useEditor.setState({ doc: doc() });

    await saveRecoveryBuffer();

    const stored = store.get("recovery");
    expect(typeof stored).toBe("object");
    expect(stored).not.toBeTypeOf("string");
    expect(stored).toEqual(
      expect.objectContaining({ path: "C:\\w\\a.md", fileName: "a.md", content: "unsaved work" }),
    );
  });

  it("writes nothing when the buffer is already saved", async () => {
    const { adapter, store } = fakeAdapter();
    setPlatform(adapter);
    useEditor.setState({ doc: doc({ savedContent: "unsaved work" }) });

    await saveRecoveryBuffer();

    expect(store.has("recovery")).toBe(false);
  });
});
