/**
 * Browser fallback using the File System Access API (Chrome/Edge).
 *
 * Degraded by design: permissions are granted per directory handle, so a
 * "workspace" is a granted handle rather than a native path. Paths are
 * therefore virtual (`/<handleId>/<segment>/...`) and only meaningful inside
 * one page session. App-scoped persistence falls back to localStorage.
 *
 * Anything the API cannot do throws PlatformError rather than faking success.
 */
import type {
  FileEntry,
  FileFilter,
  JsonValue,
  PlatformAdapter,
  TextFile,
  WriteResult,
} from "./types";
import { PlatformError } from "./types";

// Minimal typings for the File System Access API — not yet in lib.dom for all targets.
interface FsHandle {
  kind: "file" | "directory";
  name: string;
}
interface FsFileHandle extends FsHandle {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string | ArrayBuffer | ArrayBufferView): Promise<void>;
    close(): Promise<void>;
  }>;
}
interface FsDirHandle extends FsHandle {
  kind: "directory";
  values(): AsyncIterableIterator<FsHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
}
interface FsWindow {
  showDirectoryPicker?: () => Promise<FsDirHandle>;
  showOpenFilePicker?: (opts?: unknown) => Promise<FsFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FsFileHandle>;
}

const fsWindow = globalThis as unknown as FsWindow;

function assertSupported(): void {
  if (typeof fsWindow.showDirectoryPicker !== "function") {
    throw new PlatformError(
      "This browser does not expose the File System Access API. Use Chrome/Edge, or run the desktop build.",
    );
  }
}

function toPickerTypes(filters?: FileFilter[]): unknown[] | undefined {
  if (!filters?.length) return undefined;
  return filters.map((f) => ({
    description: f.name,
    accept: {
      [f.extensions.includes("*") ? "application/octet-stream" : "text/markdown"]: f.extensions.map(
        (e) => `.${e}`,
      ),
    },
  }));
}

export function createBrowserAdapter(): PlatformAdapter {
  /** Virtual path root id -> directory handle. */
  const roots = new Map<string, FsDirHandle>();
  /** Virtual path -> file handle, so writes can find their target again. */
  const files = new Map<string, FsFileHandle>();
  let nextRootId = 1;

  const encode = (rootId: string, segments: string[]): string => [rootId, ...segments].join("/");

  async function resolveDir(
    virtualPath: string,
  ): Promise<{ handle: FsDirHandle; segments: string[] }> {
    const parts = virtualPath.split("/").filter(Boolean);
    const rootId = parts[0];
    if (!rootId) throw new PlatformError(`Invalid virtual path: ${virtualPath}`);
    const root = roots.get(rootId);
    if (!root) throw new PlatformError(`Unknown workspace root: ${rootId}`);
    let handle = root;
    for (const segment of parts.slice(1)) {
      handle = await handle.getDirectoryHandle(segment);
    }
    return { handle, segments: parts.slice(1) };
  }

  /**
   * Find the handle for `virtualPath`, creating the file when a writer asks.
   *
   * `create` belongs to the write path and not the read path: a pasted image
   * names a file that has never existed, and `getFileHandle` without `create`
   * throws NotFoundError rather than making it.
   */
  async function resolveFile(virtualPath: string, create = false): Promise<FsFileHandle> {
    const known = files.get(virtualPath);
    if (known) return known;
    const parentPath = virtualPath.split("/").slice(0, -1).join("/");
    const name = virtualPath.split("/").pop();
    if (!name) throw new PlatformError(`Invalid file path: ${virtualPath}`);
    const { handle: dir } = await resolveDir(parentPath);
    const file = await dir.getFileHandle(name, create ? { create: true } : undefined);
    files.set(virtualPath, file);
    return file;
  }

  return {
    kind: "browser",

    async pickFolder(): Promise<string | null> {
      assertSupported();
      try {
        const handle = await fsWindow.showDirectoryPicker!();
        const rootId = `w${nextRootId++}`;
        roots.set(rootId, handle);
        return encode(rootId, []);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return null;
        throw new PlatformError("Failed to open a folder", err);
      }
    },

    async pickFile(): Promise<string | null> {
      assertSupported();
      try {
        const [handle] = await fsWindow.showOpenFilePicker!({ multiple: false });
        if (!handle) return null;
        // Files chosen outside a workspace get their own synthetic root.
        const rootId = `f${nextRootId++}`;
        const file = handle as unknown as FsFileHandle;
        const virtualPath = encode(rootId, [file.name]);
        files.set(virtualPath, file);
        return virtualPath;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return null;
        throw new PlatformError("Failed to open a file", err);
      }
    },

    async pickSavePath(defaultName: string, filters?: FileFilter[]): Promise<string | null> {
      assertSupported();
      try {
        const handle = await fsWindow.showSaveFilePicker!({
          suggestedName: defaultName,
          types: toPickerTypes(filters),
        });
        const rootId = `s${nextRootId++}`;
        const virtualPath = encode(rootId, [handle.name]);
        files.set(virtualPath, handle);
        return virtualPath;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return null;
        throw new PlatformError("Failed to choose a save location", err);
      }
    },

    async listDir(dirPath: string): Promise<FileEntry[]> {
      const { handle } = await resolveDir(dirPath);
      const out: FileEntry[] = [];
      for await (const entry of handle.values()) {
        const virtualPath = encode(dirPath.split("/")[0]!, [
          ...dirPath.split("/").filter(Boolean).slice(1),
          entry.name,
        ]);
        if (entry.kind === "file") {
          files.set(virtualPath, entry as FsFileHandle);
          const file = await (entry as FsFileHandle).getFile();
          out.push({
            path: virtualPath,
            name: entry.name,
            kind: "file",
            size: file.size,
            modifiedAt: file.lastModified,
          });
        } else {
          out.push({ path: virtualPath, name: entry.name, kind: "dir" });
        }
      }
      return out.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
      );
    },

    async readTextFile(path: string): Promise<TextFile> {
      const handle = await resolveFile(path);
      const file = await handle.getFile();
      return { path, content: await file.text(), modifiedAt: file.lastModified };
    },

    async readBinaryFile(path: string): Promise<Uint8Array> {
      const handle = await resolveFile(path);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    },

    async writeTextFile(path: string, content: string): Promise<WriteResult> {
      const handle = await resolveFile(path, true);
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { path, modifiedAt: Date.now() };
    },

    async writeBinaryFile(path: string, bytes: Uint8Array): Promise<WriteResult> {
      const handle = await resolveFile(path, true);
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return { path, modifiedAt: Date.now() };
    },

    async createDir(path: string): Promise<void> {
      const parts = path.split("/").filter(Boolean);
      const rootId = parts[0];
      const root = rootId ? roots.get(rootId) : undefined;
      if (!root) throw new PlatformError(`Unknown workspace root: ${String(rootId)}`);
      let handle = root;
      for (const segment of parts.slice(1)) {
        handle = await handle.getDirectoryHandle(segment, { create: true });
      }
    },

    async renamePath(): Promise<void> {
      throw new PlatformError("Rename is not supported by the File System Access API.");
    },

    async removePath(path: string): Promise<void> {
      const parts = path.split("/").filter(Boolean);
      const name = parts.pop();
      if (!name) throw new PlatformError(`Invalid path: ${path}`);
      const { handle: dir } = await resolveDir(parts.join("/"));
      await dir.removeEntry(name, { recursive: true });
      files.delete(path);
    },

    async pathExists(path: string): Promise<boolean> {
      try {
        await resolveFile(path);
        return true;
      } catch {
        return false;
      }
    },

    pathJoin(base: string, relative: string): string {
      return `${base.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
    },
    pathParent(path: string): string | null {
      const parts = path.split("/").filter(Boolean);
      parts.pop();
      return parts.length ? parts.join("/") : null;
    },
    pathFileName(path: string): string | null {
      return path.split("/").filter(Boolean).pop() ?? null;
    },
    pathExtension(path: string): string | null {
      const name = this.pathFileName(path);
      const dot = name?.lastIndexOf(".") ?? -1;
      return name && dot > 0 ? name.slice(dot + 1) : null;
    },

    // localStorage only holds strings, so this adapter serialises — the
    // contract is about the caller, not about the on-disk representation.
    async readAppData(key: string): Promise<JsonValue | null> {
      try {
        const raw = globalThis.localStorage?.getItem(`newmd:${key}`);
        return raw == null ? null : (JSON.parse(raw) as JsonValue);
      } catch {
        return null;
      }
    },
    async writeAppData(key: string, value: JsonValue): Promise<void> {
      globalThis.localStorage?.setItem(`newmd:${key}`, JSON.stringify(value));
    },
    async deleteAppData(key: string): Promise<void> {
      globalThis.localStorage?.removeItem(`newmd:${key}`);
    },
  };
}
