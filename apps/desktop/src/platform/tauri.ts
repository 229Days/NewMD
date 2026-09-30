/**
 * Tauri implementation of `PlatformAdapter`.
 *
 * This is the only file in the codebase that talks to `@tauri-apps/api`.
 * Everything else reaches the host through `@newmd/core`'s adapter interface.
 */
import {
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
  type FileEntry,
  type FileFilter,
  type JsonValue,
  type PlatformAdapter,
  type TextFile,
  type WriteResult,
} from "@newmd/core";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";

function extensionsOf(filters?: FileFilter[]): string[] {
  if (!filters?.length) return ["md", "markdown"];
  return filters.flatMap((f) => f.extensions).filter((e) => e !== "*");
}

export function isTauri(): boolean {
  return (
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined"
  );
}

/**
 * One JSON document in the app data directory, holding every app-scoped value
 * under its own key (ADR-0001 §2.11). `autoSave` is off so writes are durable
 * the moment `save()` returns, not on a debounce that can be lost on quit.
 */
const STORE_FILE = "newmd.json";
let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  storePromise ??= Store.load(STORE_FILE, { autoSave: false });
  return storePromise;
}

export function createTauriAdapter(): PlatformAdapter {
  return {
    kind: "tauri",

    pickFolder: () => invoke<string | null>("pick_folder"),

    pickFile: (filters) =>
      invoke<string | null>("pick_file", { extensions: extensionsOf(filters) }),

    pickSavePath: (defaultName, filters) =>
      invoke<string | null>("pick_save_path", {
        defaultName,
        extensions: extensionsOf(filters),
      }),

    listDir: (path) => invoke<FileEntry[]>("list_dir", { path }),

    readTextFile: (path) => invoke<TextFile>("read_text_file", { path }),

    writeTextFile: (path, content) => invoke<WriteResult>("write_text_file", { path, content }),

    // Bytes, not text: a pasted image must reach disk unaltered (ADR-0001 §2.8).
    writeBinaryFile: (path, bytes) => invoke<WriteResult>("write_binary_file", { path, bytes }),

    createDir: (path) => invoke<void>("create_dir", { path }),

    renamePath: (from, to) => invoke<void>("rename_path", { from, to }),

    removePath: (path) => invoke<void>("remove_path", { path }),

    pathExists: (path) => invoke<boolean>("path_exists", { path }),

    pathJoin,
    pathParent,
    pathFileName,
    pathExtension,

    readAppData: async (key) => {
      const value = await store().then((s) => s.get(key));
      return value === undefined || value === null ? null : (value as JsonValue);
    },

    writeAppData: async (key, value) => {
      const s = await store();
      await s.set(key, value);
      await s.save();
    },

    deleteAppData: async (key) => {
      const s = await store();
      await s.delete(key);
      await s.save();
    },
  };
}
