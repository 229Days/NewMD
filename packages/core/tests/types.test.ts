import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isDocumentDirty, isMarkdownFile, type OpenDocument } from "../src/types";

function doc(overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    path: "/w/notes.md",
    fileName: "notes.md",
    content: "",
    savedContent: "",
    lineEnding: "\n",
    modifiedAt: 0,
    ...overrides,
  };
}

describe("isDocumentDirty", () => {
  it("is clean when nothing is open", () => {
    expect(isDocumentDirty(null)).toBe(false);
  });

  it("is clean when the buffer matches disk", () => {
    expect(isDocumentDirty(doc({ content: "a", savedContent: "a" }))).toBe(false);
  });

  it("is dirty when the buffer diverged from disk", () => {
    expect(isDocumentDirty(doc({ content: "a\nb", savedContent: "a" }))).toBe(true);
  });

  it("is dirty when an unsaved buffer has content", () => {
    expect(isDocumentDirty(doc({ path: null, content: "hello", savedContent: "" }))).toBe(true);
  });

  it("is clean when an unsaved buffer is empty", () => {
    expect(isDocumentDirty(doc({ path: null }))).toBe(false);
  });
});

describe("isMarkdownFile", () => {
  it("accepts the usual markdown extensions", () => {
    for (const name of ["a.md", "b.markdown", "c.MD", "d.mdown", "e.mkd"]) {
      expect(isMarkdownFile(name), name).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const name of ["a.txt", "b.md.bak", "c", "d.mdx", "e.png"]) {
      expect(isMarkdownFile(name), name).toBe(false);
    }
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("autosaves on a short debounce", () => {
    expect(DEFAULT_SETTINGS.autoSave).toBe(true);
    expect(DEFAULT_SETTINGS.autoSaveIntervalMs).toBe(800);
  });

  it("puts images in a relative assets directory", () => {
    expect(DEFAULT_SETTINGS.imageDirName).toBe("assets");
  });
});
