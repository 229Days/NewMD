/**
 * A platform adapter that never touches disk.
 *
 * Settings writes go through the platform, so a test that changes one needs
 * somewhere for the write to land. Everything else throws on purpose: a helper
 * that quietly implemented file IO would let a test depend on it and still pass
 * in an environment where the real one cannot work.
 */
import type { JsonValue, PlatformAdapter } from "@newmd/core";

export function fakePlatform(): PlatformAdapter {
  const unused = (): never => {
    throw new Error("not used by this test");
  };
  const appData = new Map<string, JsonValue>();
  return {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: unused,
    readTextFile: unused,
    writeTextFile: unused,
    createDir: unused,
    renamePath: unused,
    removePath: unused,
    pathExists: unused,
    pathJoin: unused,
    pathParent: unused,
    pathFileName: unused,
    pathExtension: unused,
    readAppData: async (key) => appData.get(key) ?? null,
    writeAppData: async (key, value) => {
      appData.set(key, value);
    },
    deleteAppData: async (key) => {
      appData.delete(key);
    },
  };
}
