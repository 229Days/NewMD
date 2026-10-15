export type {
  EntryKind,
  FileEntry,
  FileFilter,
  PlatformAdapter,
  PlatformKind,
  TextFile,
  WriteResult,
} from "./types";
export { PlatformError } from "./types";

export { getPlatform, isPlatformRegistered, resetPlatform, setPlatform } from "./registry";
export { createBrowserAdapter } from "./browser";
export {
  isAbsolute,
  pathAfterMove,
  pathBaseName,
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
  pathRelative,
} from "./path";
