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
  t,
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

/**
 * What the dialog calls the filter it is showing.
 *
 * `FileFilter.name` is copy — the app asks for it with `t(...)` because the
 * reader reads it — so it has to reach the dialog. It used to be thrown away
 * here and the Rust side named every filter "Markdown", which showed up the
 * first time a caller passed something else: inserting an image offered to open
 * a "Markdown" file, and exporting offered to save one.
 *
 * A caller that names no filter still gets a word rather than an empty label,
 * and gets it through `t` for the same reason: the dialog is the reader's, so
 * the word has to follow their language like every other one in the app.
 */
function filterNameOf(filters?: FileFilter[]): string {
  const named = filters?.[0];
  if (named === undefined) return t("common.markdown");
  return named.name;
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
      invoke<string | null>("pick_file", {
        filterName: filterNameOf(filters),
        extensions: extensionsOf(filters),
      }),

    pickSavePath: (defaultName, filters) =>
      invoke<string | null>("pick_save_path", {
        defaultName,
        filterName: filterNameOf(filters),
        extensions: extensionsOf(filters),
      }),

    listDir: (path) => invoke<FileEntry[]>("list_dir", { path }),

    readTextFile: (path) => invoke<TextFile>("read_text_file", { path }),

    // Bytes, not text: an image picked by path must reach the document unaltered.
    readBinaryFile: async (path) => {
      const { bytes } = await invoke<{ bytes: number[] }>("read_binary_file", { path });
      return Uint8Array.from(bytes);
    },

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
