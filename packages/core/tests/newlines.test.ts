import { describe, expect, it } from "vitest";
import { applyNewlines, detectLineEnding, normalizeNewlines } from "../src/types";

describe("detectLineEnding", () => {
  it("finds LF in a Unix file", () => {
    expect(detectLineEnding("a\nb\nc")).toBe("\n");
  });

  it("finds CRLF in a Windows file", () => {
    expect(detectLineEnding("a\r\nb\r\nc")).toBe("\r\n");
  });

  it("uses the majority style when a file mixes endings", () => {
    expect(detectLineEnding("a\nb\nc\nd\r\n")).toBe("\n");
    expect(detectLineEnding("a\r\nb\r\nc\r\nd\n")).toBe("\r\n");
  });

  it("treats a single line with no break as LF", () => {
    expect(detectLineEnding("just one line")).toBe("\n");
  });
});

describe("normalizeNewlines", () => {
  it("maps CRLF and bare CR to LF", () => {
    expect(normalizeNewlines("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("leaves LF text untouched", () => {
    expect(normalizeNewlines("a\nb\nc")).toBe("a\nb\nc");
  });

  it("is a no-op on the empty document", () => {
    expect(normalizeNewlines("")).toBe("");
  });
});

describe("applyNewlines", () => {
  it("restores CRLF on write", () => {
    expect(applyNewlines("a\nb\nc", "\r\n")).toBe("a\r\nb\r\nc");
  });

  it("leaves LF documents alone", () => {
    expect(applyNewlines("a\nb\nc", "\n")).toBe("a\nb\nc");
  });

  it("round-trips a Windows file without rewriting its endings", () => {
    // The bug this guards: CodeMirror normalises to \n internally, so a naive
    // save silently converted every CRLF file in place to LF.
    const onDisk = "# Title\r\n\r\n- one\r\n- two\r\n";
    const normalized = normalizeNewlines(onDisk);
    expect(normalized).toBe("# Title\n\n- one\n- two\n");
    expect(applyNewlines(normalized, detectLineEnding(onDisk))).toBe(onDisk);
  });

  it("round-trips a Unix file too", () => {
    const onDisk = "# Title\n\n- one\n- two\n";
    expect(applyNewlines(normalizeNewlines(onDisk), detectLineEnding(onDisk))).toBe(onDisk);
  });
});
