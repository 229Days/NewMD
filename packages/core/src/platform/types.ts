/**
 * Platform abstraction.
 *
 * `packages/core` must never import Tauri APIs directly (see ADR-0001 §3).
 * Everything that touches the host — filesystem, dialogs, settings persistence —
 * goes through this interface, so the same core runs in a plain browser
 * (via the File System Access API) and under test without a desktop process.
 */

export type EntryKind = "file" | "dir";

export interface FileEntry {
  /** Native path on desktop; a virtual handle path in the browser. */
  path: string;
  name: string;
  kind: EntryKind;
  /** Bytes; files only. */
  size?: number;
  /** Epoch millis; best effort. */
  modifiedAt?: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface TextFile {
  path: string;
  content: string;
  modifiedAt: number;
}

export interface WriteResult {
  path: string;
  modifiedAt: number;
}

export type PlatformKind = "tauri" | "browser";

/**
 * Values handed to the platform store. The store owns serialisation to JSON
 * on disk — callers pass structured values, never pre-stringified text.
 * Matches the Tauri Store plugin's native value type (ADR-0001 §2.11).
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface PlatformAdapter {
  readonly kind: PlatformKind;

  // ---- dialogs ----
  pickFolder(): Promise<string | null>;
  pickFile(filters?: FileFilter[]): Promise<string | null>;
  pickSavePath(defaultName: string, filters?: FileFilter[]): Promise<string | null>;

  // ---- filesystem ----
  listDir(dirPath: string): Promise<FileEntry[]>;
  readTextFile(path: string): Promise<TextFile>;
  /**
   * Read a file as bytes. Separate from `readTextFile` because an image
   * inserted by path is not text, and getting it there by way of a string would
   * be a re-encoding with a loss somewhere in it (ADR-0001 §2.5 本地路径插入).
   */
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, content: string): Promise<WriteResult>;
  /**
   * Write raw bytes. Separate from `writeTextFile` because a pasted image is
   * not text and getting it there by way of a string would be a re-encoding
   * with a loss somewhere in it (ADR-0001 §2.8 图片入 `./assets/`).
   */
  writeBinaryFile(path: string, bytes: Uint8Array): Promise<WriteResult>;
  createDir(path: string): Promise<void>;
  renamePath(from: string, to: string): Promise<void>;
  removePath(path: string): Promise<void>;
  pathExists(path: string): Promise<boolean>;

  // ---- path helpers (host-native semantics) ----
  pathJoin(base: string, relative: string): string;
  pathParent(path: string): string | null;
  pathFileName(path: string): string | null;
  pathExtension(path: string): string | null;

  // ---- app-scoped persistence (settings, recent list, crash buffers) ----
  /** Stored JSON value, or null when the key has never been written. */
  readAppData(key: string): Promise<JsonValue | null>;
  /** Persist a JSON value. Serialisation belongs to the platform, not the caller. */
  writeAppData(key: string, value: JsonValue): Promise<void>;
  deleteAppData(key: string): Promise<void>;
}

/** Small helper so adapters can reject with a consistent shape. */
export class PlatformError extends Error {
  override readonly name = "PlatformError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}
