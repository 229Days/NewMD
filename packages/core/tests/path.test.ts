import { describe, expect, it } from "vitest";
import {
  isAbsolute,
  pathBaseName,
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
} from "../src/platform/path";

describe("isAbsolute", () => {
  it("recognises Windows drive, root and UNC paths", () => {
    expect(isAbsolute("C:\\notes\\a.md")).toBe(true);
    expect(isAbsolute("C:/notes/a.md")).toBe(true);
    expect(isAbsolute("\\notes\\a.md")).toBe(true);
    expect(isAbsolute("/notes/a.md")).toBe(true);
    expect(isAbsolute("\\\\server\\share\\a.md")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isAbsolute("a.md")).toBe(false);
    expect(isAbsolute("./assets/a.md")).toBe(false);
    expect(isAbsolute("../a.md")).toBe(false);
  });
});

describe("pathFileName", () => {
  it("returns the last segment", () => {
    expect(pathFileName("C:\\notes\\readme.md")).toBe("readme.md");
    expect(pathFileName("C:/notes/readme.md")).toBe("readme.md");
    expect(pathFileName("readme.md")).toBe("readme.md");
    expect(pathFileName("C:\\notes\\")).toBe("notes");
  });

  it("returns null for a bare root", () => {
    expect(pathFileName("C:\\")).toBe(null);
    expect(pathFileName("/")).toBe(null);
  });
});

describe("pathExtension", () => {
  it("returns the extension without a dot", () => {
    expect(pathExtension("C:\\a\\b.md")).toBe("md");
    expect(pathExtension("b.markdown")).toBe("markdown");
  });

  it("ignores dots in directories and leading dots", () => {
    expect(pathExtension("C:\\a.b\\readme")).toBe(null);
    expect(pathExtension(".gitignore")).toBe(null);
  });
});

describe("pathBaseName", () => {
  it("strips the extension", () => {
    expect(pathBaseName("C:\\notes\\readme.md")).toBe("readme");
    expect(pathBaseName("C:\\notes\\archive.tar.gz")).toBe("archive.tar");
    expect(pathBaseName("LICENSE")).toBe("LICENSE");
  });
});

describe("pathParent", () => {
  it("walks up one level", () => {
    expect(pathParent("C:\\notes\\a.md")).toBe("C:\\notes");
    expect(pathParent("C:/notes/a.md")).toBe("C:/notes");
    expect(pathParent("a.md")).toBe(null);
  });

  it("returns null at a root", () => {
    expect(pathParent("C:\\")).toBe(null);
  });
});

describe("pathJoin", () => {
  it("joins with the base separator", () => {
    expect(pathJoin("C:\\notes", "assets\\a.png")).toBe("C:\\notes\\assets\\a.png");
    expect(pathJoin("C:/notes", "assets/a.png")).toBe("C:/notes/assets/a.png");
  });

  it("normalises ./ and ../ segments", () => {
    expect(pathJoin("C:\\notes", ".\\assets\\a.png")).toBe("C:\\notes\\assets\\a.png");
    expect(pathJoin("C:\\notes\\drafts", "..\\assets\\a.png")).toBe("C:\\notes\\assets\\a.png");
    expect(pathJoin("C:\\notes", "assets\\..\\a.png")).toBe("C:\\notes\\a.png");
  });

  it("lets an absolute relative path win", () => {
    expect(pathJoin("C:\\notes", "D:\\other\\a.png")).toBe("D:\\other\\a.png");
    expect(pathJoin("C:\\notes", "/rooted/a.png")).toBe("/rooted/a.png");
  });

  it("does not escape past the drive root", () => {
    expect(pathJoin("C:\\", "..\\a.png")).toBe("C:\\a.png");
  });

  it("is the inverse of what the asset pipeline needs", () => {
    // The image flow writes relative paths into markdown: this is how they resolve.
    expect(pathJoin("C:\\project\\docs", "./assets/20260929-a1b2c3d4.png")).toBe(
      "C:\\project\\docs\\assets\\20260929-a1b2c3d4.png",
    );
  });
});
