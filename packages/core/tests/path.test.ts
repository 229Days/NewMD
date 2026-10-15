import { describe, expect, it } from "vitest";
import {
  isAbsolute,
  pathBaseName,
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
  pathRelative,
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

/**
 * The other half of the asset pipeline (ADR-0003 §2.6).
 *
 * `pathJoin` says where a destination written in Markdown points; this says what
 * to write when a file has moved. Its output goes into documents, so it is held
 * to the same spelling the image flow already fixed: `./`-prefixed, forward
 * slashes only — a document written on Windows has to resolve on Linux.
 */
describe("pathRelative", () => {
  it("keeps the ./ prefix when the target is in the same directory", () => {
    // `a.md` would resolve identically, and the markdown would stop matching
    // what the image flow writes. One spelling, or a diff tool sees two.
    expect(pathRelative("C:\\notes", "C:\\notes\\a.md")).toBe("./a.md");
  });

  it("prefers ../ over ./ when it has to walk up", () => {
    // `./../a.md` resolves too, but nobody writes that.
    expect(pathRelative("C:\\notes\\sub", "C:\\notes\\a.md")).toBe("../a.md");
    expect(pathRelative("C:\\notes\\a\\b", "C:\\notes\\other\\c.md")).toBe("../../other/c.md");
  });

  it("walks down with a single ./", () => {
    expect(pathRelative("C:\\notes", "C:\\notes\\sub\\a.md")).toBe("./sub/a.md");
  });

  it("ignores a trailing separator on the directory it is relative to", () => {
    expect(pathRelative("C:\\notes\\", "C:\\notes\\a.md")).toBe("./a.md");
  });

  it("collapses . and .. inside the target", () => {
    expect(pathRelative("C:\\notes", "C:\\notes\\sub\\..\\a.md")).toBe("./a.md");
    expect(pathRelative("C:\\notes\\sub", "C:\\notes\\sub\\..\\other\\a.md")).toBe("../other/a.md");
  });

  it("writes forward slashes whatever the inputs used", () => {
    // The markdown is the artifact that outlives the platform it was written on.
    expect(pathRelative("C:\\notes", "C:\\notes\\sub\\a.md")).toBe("./sub/a.md");
    expect(pathRelative("C:/notes", "C:/notes/sub/a.md")).toBe("./sub/a.md");
    expect(pathRelative("C:\\notes", "C:/notes/sub/a.md")).toBe("./sub/a.md");
  });

  it("round-trips through pathJoin", () => {
    // The property that matters: whatever spelling comes out, resolving it from
    // the directory it is relative to has to land exactly back on the target.
    const pairs: [string, string][] = [
      ["C:\\notes", "C:\\notes\\a.md"],
      ["C:\\notes\\sub", "C:\\notes\\a.md"],
      ["C:\\notes\\a\\b\\c", "C:\\notes\\d\\e.md"],
      ["C:\\notes\\sub", "C:\\notes\\sub\\a.md"],
      ["C:\\project\\docs", "C:\\project\\assets\\img\\x.png"],
      ["C:\\project", "C:\\project\\docs\\assets\\20260929-a1b2c3d4.png"],
    ];
    for (const [from, to] of pairs) {
      expect(pathJoin(from, pathRelative(from, to))).toBe(to);
    }
  });

  it("gives back the absolute target when no relative path exists", () => {
    // Different drives. There is no `..` that crosses one, and inventing one
    // would write a link that resolves to some other file entirely. Handing back
    // the absolute path is the honest answer, and it is one the caller can
    // recognise — `isAbsolute` is exactly the test for "do not write this into
    // markdown" (ADR-0003 §2.5).
    expect(pathRelative("C:\\notes", "D:\\other\\a.md")).toBe("D:\\other\\a.md");
    expect(isAbsolute(pathRelative("C:\\notes", "D:\\other\\a.md"))).toBe(true);
  });

  it("compares directories case-sensitively", () => {
    // Deliberate, and the reason is the Linux reader: if the real directory is
    // `Notes`, comparing case-insensitively would let this answer `./a.md` and
    // write a path that only resolves on Windows. Walking up instead uses the
    // target's own spelling, which is right everywhere.
    expect(pathRelative("C:\\Notes", "C:\\notes\\a.md")).toBe("../notes/a.md");
  });

  it("does not escape past a root", () => {
    expect(pathRelative("C:\\", "C:\\a.md")).toBe("./a.md");
    expect(pathRelative("C:\\a", "C:\\b.md")).toBe("../b.md");
  });

  it("treats the roots themselves as the same when they are", () => {
    // A drive letter is case-insensitive, and `\notes` and `/notes` are one
    // place on Windows. Getting either of these wrong is not a cosmetic
    // difference: it turns a link into a walk out of the drive and back in.
    expect(pathRelative("C:\\notes", "c:\\notes\\a.md")).toBe("./a.md");
    expect(pathRelative("\\notes", "/notes/a.md")).toBe("./a.md");
    expect(pathRelative("\\\\server\\share\\a", "\\\\server\\share\\b\\c.md")).toBe("../b/c.md");
  });
});
