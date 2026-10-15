/**
 * Rewriting a document's destinations after a file moved (ADR-0003 §2.4–§2.7).
 *
 * The output of this goes straight onto disk, into documents the reader may not
 * even have open, so the bar is higher than "the link is right". Every byte the
 * move did not concern has to come back exactly as it went in — a rewrite that
 * also tidies formatting is a silent edit to a file nobody asked it to touch.
 */
import { describe, expect, it } from "vitest";
import { rewriteReferences } from "../src/editor/reference-rewrite";

/** The file moved; the document that carries the link did not. */
function inbound(source: string, documentPath = "C:\\notes\\index.md") {
  return rewriteReferences(source, {
    documentPath,
    from: "C:\\notes\\a.md",
    to: "C:\\notes\\sub\\a.md",
  });
}

describe("what counts as a destination to rewrite", () => {
  it("skips absolute paths, schemes, fragments and empties", () => {
    const source = [
      "[abs](/etc/a.md)",
      "[drive](C:\\notes\\a.md)",
      "[unc](\\\\server\\share\\a.md)",
      "[web](https://example.com/a.md)",
      "[mail](mailto:a@b.c)",
      "[data](data:text/plain,a)",
      "[frag](#sec)",
      "[empty]()",
      "",
    ].join("\n");

    const result = inbound(source);

    expect(result.text).toBe(source);
    expect(result.rewritten).toBe(0);
  });

  it("reads a colon after a slash as part of the name, not a scheme", () => {
    // §2.5 decides "has a scheme" by where the colon sits relative to the first
    // slash. Testing for a colon at all would pass every case above and quietly
    // refuse to rewrite this one.
    const result = rewriteReferences("[a](./odd:name.md)\n", {
      documentPath: "C:\\notes\\index.md",
      from: "C:\\notes\\odd:name.md",
      to: "C:\\notes\\sub\\odd:name.md",
    });

    expect(result.text).toBe("[a](./sub/odd:name.md)\n");
    expect(result.rewritten).toBe(1);
  });

  it("counts a bare relative path, and respells it with the ./ prefix", () => {
    // `a.md` and `./a.md` are the same destination; §2.6 says one spelling.
    const result = inbound("[a](a.md)\n");

    expect(result.text).toBe("[a](./sub/a.md)\n");
    expect(result.rewritten).toBe(1);
  });
});

describe("a document that stayed put", () => {
  it("respells a link to the file that moved", () => {
    const result = inbound("[a](./a.md)\n");

    expect(result.text).toBe("[a](./sub/a.md)\n");
    expect(result.rewritten).toBe(1);
  });

  it("respells a link that walks up to it", () => {
    const result = rewriteReferences("[a](../a.md)\n", {
      documentPath: "C:\\notes\\deep\\index.md",
      from: "C:\\notes\\a.md",
      to: "C:\\notes\\sub\\a.md",
    });

    expect(result.text).toBe("[a](../sub/a.md)\n");
    expect(result.rewritten).toBe(1);
  });

  it("carries a fragment along with the path", () => {
    // The heading is part of what the link promises. Dropping `#sec` would send
    // the reader to the top of the right file, which reads as a broken link.
    const result = inbound("[a](./a.md#sec)\n");

    expect(result.text).toBe("[a](./sub/a.md#sec)\n");
  });

  it("carries a query along with the path", () => {
    const result = inbound("[a](./a.md?x=1)\n");

    expect(result.text).toBe("[a](./sub/a.md?x=1)\n");
  });

  it("rewrites a reference definition", () => {
    // The definition is where a reference-style link actually keeps its URL, so
    // skipping these would break every `[a][label]` in the workspace at once.
    const result = inbound("[a][label]\n\n[label]: ./a.md\n");

    expect(result.text).toBe("[a][label]\n\n[label]: ./sub/a.md\n");
    expect(result.rewritten).toBe(1);
  });

  it("keeps a definition's title where it was", () => {
    const result = inbound('[label]: ./a.md "the a"\n');

    expect(result.text).toBe('[label]: ./sub/a.md "the a"\n');
  });

  it("leaves the link's own text alone when it reads like the destination", () => {
    const result = inbound("[./a.md](./a.md)\n");

    // Only the destination is a destination. The label is the author's words.
    expect(result.text).toBe("[./a.md](./sub/a.md)\n");
    expect(result.rewritten).toBe(1);
  });

  it("leaves a parenthesised label alone even when it looks like one", () => {
    // The destination is anchored on the `(` that opens it, and a link's label
    // can hold anything — including the very text the destination repeats.
    const result = inbound("[see (./a.md)](./a.md)\n");

    expect(result.text).toBe("[see (./a.md)](./sub/a.md)\n");
    expect(result.rewritten).toBe(1);
  });

  it("keeps a title where it was", () => {
    const result = inbound('![x](./a.md "the a")\n');

    expect(result.text).toBe('![x](./sub/a.md "the a")\n');
  });
});

describe("a document that moved", () => {
  it("respells its own links for the depth it landed at", () => {
    // `./assets/x.png` resolved to `notes/assets/` while the document lived in
    // `notes/`. It lives in `notes/sub/` now, and the walk has to say so.
    const result = rewriteReferences("# A\n\n![x](./assets/x.png)\n", {
      documentPath: "C:\\notes\\sub\\a.md",
      from: "C:\\notes\\a.md",
      to: "C:\\notes\\sub\\a.md",
    });

    expect(result.text).toBe("# A\n\n![x](../assets/x.png)\n");
    expect(result.rewritten).toBe(1);
  });

  it("leaves a link alone when its target moved along with it", () => {
    // A directory rename takes the whole subtree. `./b.png` still points at the
    // same neighbour, and respelling it would be an edit to a working link.
    const result = rewriteReferences("![b](./b.png)\n", {
      documentPath: "C:\\notes\\new\\a.md",
      from: "C:\\notes\\old",
      to: "C:\\notes\\new",
    });

    expect(result.text).toBe("![b](./b.png)\n");
    expect(result.rewritten).toBe(0);
  });

  it("leaves a link out of the subtree it left alone", () => {
    // `../other.md` meant `notes/other.md` and still does — the document's own
    // move does not touch it.
    const result = rewriteReferences("[sib](../other.md)\n", {
      documentPath: "C:\\notes\\new\\a.md",
      from: "C:\\notes\\old",
      to: "C:\\notes\\new",
    });

    expect(result.text).toBe("[sib](../other.md)\n");
    expect(result.rewritten).toBe(0);
  });
});

describe("the spelling that gets written back", () => {
  it("keeps a destination escaped the way the author escaped it", () => {
    // mdast hands back the *decoded* url (`a\(b\)` reads as `a(b)`), so the
    // source is found through its escaped spelling and written back the same
    // way. Writing the decoded form back would produce a broken link.
    const result = rewriteReferences("[a](./a\\(b\\).md)\n", {
      documentPath: "C:\\notes\\index.md",
      from: "C:\\notes\\a(b).md",
      to: "C:\\notes\\sub\\a(b).md",
    });

    expect(result.text).toBe("[a](./sub/a\\(b\\).md)\n");
    expect(result.rewritten).toBe(1);
  });

  it("keeps angle brackets the author wrote", () => {
    const result = rewriteReferences("[a](<./a.md>)\n", {
      documentPath: "C:\\notes\\index.md",
      from: "C:\\notes\\a.md",
      to: "C:\\notes\\sub\\a.md",
    });

    expect(result.text).toBe("[a](<./sub/a.md>)\n");
    expect(result.rewritten).toBe(1);
  });

  it("wraps a new destination that would not parse on its own", () => {
    // A space in a bare destination ends it early. The old spelling got away
    // with it by being angle-wrapped, and the new one has to as well.
    const result = rewriteReferences("[a](<./a b.md>)\n", {
      documentPath: "C:\\notes\\index.md",
      from: "C:\\notes\\a b.md",
      to: "C:\\notes\\sub\\a b.md",
    });

    expect(result.text).toBe("[a](<./sub/a b.md>)\n");
    expect(result.rewritten).toBe(1);
  });
});

describe("what a rewrite must not touch", () => {
  it("leaves a destination inside a fenced code block alone", () => {
    // The span of a fenced block holds text that parses as a link and is not
    // one. This is the whole reason the rewrite walks the tree instead of the
    // text: a regex over the file would rewrite this line.
    const source = ["```", "[not a link](./a.md)", "```", "", "[a](./a.md)", ""].join("\n");

    const result = inbound(source);

    expect(result.text).toBe(
      ["```", "[not a link](./a.md)", "```", "", "[a](./sub/a.md)", ""].join("\n"),
    );
  });

  it("leaves a destination inside inline code alone", () => {
    const source = "use `![](./a.md)` to embed, and [a](./a.md) to link\n";

    const result = inbound(source);

    expect(result.text).toBe("use `![](./a.md)` to embed, and [a](./sub/a.md) to link\n");
  });

  it("does not restyle a bare destination the move did not concern", () => {
    // `pic.png` and `./pic.png` are one destination and §2.6 prefers the second
    // spelling — but a rename is not the thing that should restyle a link in a
    // document it otherwise had no business editing. It is made canonical only
    // when that destination is being respelled for a reason.
    const result = inbound("![img](pic.png)\n");

    expect(result.text).toBe("![img](pic.png)\n");
    expect(result.rewritten).toBe(0);
  });

  it("gives back the exact bytes when nothing moved", () => {
    const source = [
      "---",
      "title: A",
      "---",
      "",
      "# Heading",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "*  one",
      "   *  two",
      "",
      "Text with   odd spacing, a [link](../elsewhere.md), an ![img](./pic.png)",
      "and a soft",
      "break.",
      "",
      "```js",
      "const a = 1;",
      "```",
      "",
    ].join("\n");

    const result = rewriteReferences(source, {
      documentPath: "C:\\notes\\index.md",
      from: "C:\\notes\\gone.md",
      to: "C:\\notes\\sub\\gone.md",
    });

    expect(result.text).toBe(source);
    expect(result.rewritten).toBe(0);
  });
});

describe("when a destination cannot be rewritten", () => {
  it("counts it instead of writing an absolute path", () => {
    // The file moved to another drive. No `..` crosses one, and §2.5 forbids
    // writing an absolute path into markdown, so the link is left as it was and
    // the reader is told a count rather than being handed a wrong link.
    const result = rewriteReferences("[a](./a.md)\n", {
      documentPath: "C:\\notes\\index.md",
      from: "C:\\notes\\a.md",
      to: "D:\\elsewhere\\a.md",
    });

    expect(result.text).toBe("[a](./a.md)\n");
    expect(result.rewritten).toBe(0);
    expect(result.unrewritten).toBe(1);
  });
});
