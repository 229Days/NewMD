/**
 * The single-file HTML export (ADR-0005 §2.3, §2.5–§2.8).
 *
 * The deliverable is one string a browser can open from anywhere, which rules
 * out the whole class of failure this file is about: a stylesheet left behind in
 * the app's bundle, an image left pointing at a folder that did not travel with
 * the file, a heading with nothing to link to. Every one of those looks correct
 * in the app and produces a page that is broken in a way only the recipient
 * sees.
 *
 * So the assertions are made against the *parsed* output rather than against
 * substrings wherever a reader would meet the difference — a `<link>` that
 * resolves in the editor's origin and nowhere else passes a `toContain` check
 * and fails a reader. Where they are made against the text it is because the
 * difference is a cascade, which jsdom does not run at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  pathExtension,
  pathFileName,
  pathJoin,
  pathParent,
  resetPlatform,
  setPlatform,
  type PlatformAdapter,
} from "@newmd/core";
import { renderDocumentHtml } from "../src/index";

/**
 * One of everything the writer has a branch for.
 *
 * Written as lines rather than as a template literal so the fences and the
 * inline spans can spell their backticks without escaping.
 */
const SAMPLE = [
  "---",
  "title: Sample",
  "---",
  "",
  "[TOC]",
  "",
  "# One",
  "",
  "## Two",
  "",
  "A paragraph with `code`, a [link][ref] and an ![map](./assets/map.png).",
  "",
  "[ref]: https://example.com",
  "",
  "- first",
  "- [x] done",
  "",
  "1. one",
  "2. two",
  "",
  "> quoted",
  "",
  "| left | right |",
  "| :--- | ----: |",
  "| a    | b     |",
  "",
  "---",
  "",
  "```js",
  "const one = 1;",
  "```",
  "",
  "==marked== a ~sub~ and a ^sup^, ~~struck~~, and $x^2$.",
  "",
  "$$",
  "y = mx + b",
  "$$",
  "",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "```",
  "",
  "A claim.[^1]",
  "",
  "[^1]: The source.",
  "",
].join("\n");

/** The output as a browser would read it. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** The document scope, which every rule in `document.css` is written against. */
function scopeOf(html: string): Element {
  const scope = parse(html).querySelector("[data-newmd-document]");
  if (scope === null) throw new Error("the exported page has no document scope");
  return scope;
}

/** The file the fake disk holds a picture at, and the document that points at it. */
const DOC_PATH = "/ws/notes/todo.md";
const DOC_DIR = "/ws/notes";

/** Eight bytes that make a file a PNG, and are the point of the encoding. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

/** What the fake disk holds, by path. */
let disk: Record<string, Uint8Array> = {};
/** Every path the export asked the disk for. */
let asked: string[] = [];

/**
 * A disk, and nothing else — everything on it but the bytes is core's own.
 *
 * The path helpers are the real `pathJoin` and friends rather than a second
 * spelling of them, because that is what the adapters use: `tauri.ts` passes
 * core's straight through. A fixture with its own version would answer a
 * different question about which file was asked for — resolving `.` and `..`
 * one way while the export resolved them another, and agreeing either way.
 */
function fakePlatform(): PlatformAdapter {
  const unused = (): never => {
    throw new Error("not used by an export");
  };
  return {
    kind: "browser",
    pickFolder: unused,
    pickFile: unused,
    pickSavePath: unused,
    listDir: unused,
    readTextFile: unused,
    writeTextFile: unused,
    writeBinaryFile: unused,
    createDir: unused,
    renamePath: unused,
    removePath: unused,
    pathExists: unused,
    // The one this file needs.
    readBinaryFile: async (path) => {
      asked.push(path);
      const bytes = disk[path];
      if (bytes === undefined) throw new Error(`no such file: ${path}`);
      return bytes;
    },
    pathJoin,
    pathParent,
    pathFileName,
    pathExtension,
    readAppData: async () => null,
    writeAppData: async () => {},
    deleteAppData: async () => {},
  } satisfies PlatformAdapter;
}

beforeEach(() => {
  disk = {};
  asked = [];
  setPlatform(fakePlatform());
});

afterEach(() => {
  resetPlatform();
});

describe("the page the export writes", () => {
  it("puts the body in the scope the document stylesheet is written against", async () => {
    // ADR-0005 §2.5 落地补记. Every rule core ships is prefixed with this
    // attribute, so a page that wraps its body in anything else renders entirely
    // unstyled — silently, because nothing about that outcome is an error.
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "light" });

    expect(scopeOf(html).querySelector("h1")?.textContent).toBe("One");
  });

  it("carries the stylesheets inline instead of linking to them", async () => {
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const page = parse(html);

    // A `<link>` would resolve against wherever the file came from, which is
    // the one thing an exported file cannot rely on.
    expect(page.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
    expect(page.querySelectorAll("style").length).toBeGreaterThan(0);
    // The document's own look, and the palette it reads — the two files that
    // make the page a document rather than a wall of 16px prose.
    expect(html).toContain("box-sizing: border-box");
    expect(html).toContain("--fg:");
    // And the rule that lights a dark code block, which is neither of them.
    expect(html).toContain("--shiki-dark");
  });

  it("paints the page the document sits in, not only the document", async () => {
    // `document.css` is scoped to the document box, and the app's own body rule
    // lives in `packages/ui`, which the export must not reach into (ADR-0005
    // §2.5). Without this rule a dark document is `--fg` on the browser's white
    // canvas — unreadable in exactly the theme it was written in.
    //
    // Asserted against the text because the difference here *is* the cascade,
    // and jsdom resolves no `var()` at all.
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "dark" });

    expect(html).toMatch(/html\s*\{[^}]*background:\s*var\(--bg\)/);
  });

  it("writes one theme, and says which one it is", async () => {
    // ADR-0005 §2.8: a snapshot, in the theme the writer was looking at.
    const dark = await renderDocumentHtml(SAMPLE, { theme: "dark" });
    const light = await renderDocumentHtml(SAMPLE, { theme: "light" });

    expect(parse(dark.html).documentElement.getAttribute("data-theme")).toBe("dark");
    expect(parse(light.html).documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("writes the reader's look settings over the palette", async () => {
    // The four typography variables reach the WYSIWYG body and CodeMirror; an
    // exported page that ignored them would be a page in somebody else's type
    // (ADR-0005 §2.5).
    const { html } = await renderDocumentHtml(SAMPLE, {
      theme: "light",
      settings: { fontSize: 20, lineHeight: 2, editorMaxWidth: 960 },
    });

    expect(html).toContain("--editor-font-size: 20px");
    expect(html).toContain("--editor-line-height: 2");
    expect(html).toContain("--editor-max-width: 960px");
  });

  it("numbers headings by position, and writes the number into the id", async () => {
    // ADR-0005 §2.7. Positional rather than a slug of the text: Chinese headings
    // slug to nothing, and this is a snapshot nobody links into.
    const split = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const headings = [...scopeOf(split.html).querySelectorAll("h1, h2, h3")];

    expect(headings.map((heading) => heading.getAttribute("id"))).toEqual([
      "newmd-h-1",
      "newmd-h-2",
    ]);
  });

  it("expands `[TOC]` into links to those ids", async () => {
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const page = parse(html);

    // The five characters are gone: a reader of the page gets the table of
    // contents, not the marker the author typed to ask for one.
    expect(page.body.textContent).not.toContain("[TOC]");

    const entries = [...page.querySelectorAll("[data-newmd-toc-entry]")];
    expect(entries.map((entry) => entry.getAttribute("href"))).toEqual([
      "#newmd-h-1",
      "#newmd-h-2",
    ]);
    expect(entries.map((entry) => entry.textContent)).toEqual(["One", "Two"]);
  });

  it("indents a `[TOC]` entry by how deep it sits, not by its level", async () => {
    // The same number core hands the editor (ADR-0002 §2.8): a document whose
    // shallowest heading is an `h2` prints its entries at the margin, and one
    // that starts at `h3` does the same.
    const { html } = await renderDocumentHtml("[TOC]\n\n## Two\n\n### Three\n\n## Two again\n", {
      theme: "light",
    });
    const entries = [...parse(html).querySelectorAll<HTMLElement>("[data-newmd-toc-entry]")];

    expect(entries.map((entry) => entry.style.getPropertyValue("--newmd-toc-indent"))).toEqual([
      "0",
      "1",
      "0",
    ]);
  });

  it("resolves a link reference, and drops the definition behind it", async () => {
    // `inlineLinkReferences` has already rewritten the node by the time the
    // writer sees it. The definition itself renders nothing, which is what every
    // Markdown renderer does with one — the editor prints it only because it has
    // to show the reader their file.
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const page = parse(html);

    // The paragraph's own link, not the table of contents' first entry.
    expect(scopeOf(html).querySelector("p a")?.getAttribute("href")).toBe("https://example.com");
    expect(page.body.textContent).not.toContain("[ref]");
  });

  it("renders every block the dialect can hold", async () => {
    const scope = scopeOf((await renderDocumentHtml(SAMPLE, { theme: "light" })).html);

    const missing = [
      "h1",
      "h2",
      "p",
      "ul",
      "ol",
      "li",
      "blockquote",
      "table",
      "thead",
      "th",
      "tbody",
      "td",
      "hr",
      "pre",
      "code",
    ].filter((selector) => scope.querySelector(selector) === null);
    expect(missing).toEqual([]);
  });

  it("tokenises a fence, and keeps its source readable either way", async () => {
    // ADR-0005 §1's measurement: Shiki writes both the light colour and
    // `--shiki-dark` onto every token, so the block needs no CSS of its own and
    // `highlight.css` alone turns the dark half on.
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const code = scopeOf(html).querySelector("pre code");
    expect(code).not.toBeNull();

    // The language survives, in the spelling this app's editor uses and in the
    // one the rest of the world reads.
    expect(code?.getAttribute("class")).toBe("language-js");
    expect(code?.closest("pre")?.getAttribute("data-language")).toBe("js");
    // Read as text the block is the source, whether or not tokens landed: the
    // spans carry it, they do not replace it.
    expect(code?.textContent).toBe("const one = 1;");
    expect(code?.querySelector("[data-newmd-token]")).not.toBeNull();
  });

  it("gives a table cell the alignment its column was written with", async () => {
    // A column the source said nothing about gets no style, rather than the
    // `left` the editor writes: there it is a schema default prosemirror-tables
    // needs, and here it would be a style the author did not ask for.
    const { html } = await renderDocumentHtml(
      "| left | mid | right |\n| :--- | --- | ----: |\n| a | b | c |\n",
      { theme: "light" },
    );

    const headers = [...scopeOf(html).querySelectorAll("th")];
    expect(headers.map((cell) => cell.getAttribute("style"))).toEqual([
      "text-align: left",
      null,
      "text-align: right",
    ]);
    // The body row carries the same alignment as its column's header.
    expect(scopeOf(html).querySelector("td")?.getAttribute("style")).toBe("text-align: left");
  });

  it("renders the marks this dialect spells with delimiters", async () => {
    // None of these three has a node type in mdast, so there is nothing
    // upstream for the writer to lean on — it reads `INLINE_MARKS` (ADR-0005
    // §2.4), and a mark added there and not here would export as its own
    // delimiters.
    const scope = scopeOf((await renderDocumentHtml(SAMPLE, { theme: "light" })).html);

    expect(scope.querySelector("mark")?.textContent).toBe("marked");
    expect(scope.querySelector("sub")?.textContent).toBe("sub");
    expect(scope.querySelector("sup")?.textContent).toBe("sup");
    expect(scope.querySelector("del")?.textContent).toBe("struck");
  });

  it("draws front matter as the panel the editor draws", async () => {
    // The same builder both sides (ADR-0005 §2.4). Metadata that read as
    // metadata on screen and as body text in the export would be two readings
    // of one document.
    const panel = parse((await renderDocumentHtml(SAMPLE, { theme: "light" })).html).querySelector(
      "[data-newmd-frontmatter]",
    );

    expect(panel?.querySelector("[data-key]")?.textContent).toBe("title");
    expect(panel?.querySelector("[data-value]")?.textContent).toBe("Sample");
  });

  it("draws a formula, and carries the rule that hides the copy of it nobody can read", async () => {
    // ADR-0005 §2.6: the editor's own renderer, and the editor's own stylesheet
    // with it. The rule matters as much as the markup — KaTeX emits every
    // formula twice, once as MathML for assistive technology and once as an HTML
    // copy positioned by its stylesheet, and the rule that hides the first is in
    // the stylesheet. A page carrying the markup without it prints the formula
    // twice, the second time as text nobody can read.
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const scope = scopeOf(html);

    const inline = scope.querySelector('[data-newmd-math="inline"]');
    expect(inline?.getAttribute("data-math")).toBe("x^2");
    expect(inline?.querySelector(".katex")).not.toBeNull();

    const display = scope.querySelector('[data-newmd-math="display"]');
    expect(display?.getAttribute("data-math")).toBe("y = mx + b");
    expect(display?.querySelector(".katex-display")).not.toBeNull();
  });

  it("carries KaTeX's fonts, and only when a formula asks for them", async () => {
    // The fonts are in the file rather than beside it (ADR-0005 §2.6), which is
    // 296KB of `woff2` and ~395KB once base64 — so the second half of this is
    // the point of the first: a document with no formula in it pays for neither.
    const sums = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const prose = await renderDocumentHtml("A paragraph, and no formula.\n", { theme: "light" });

    expect(sums.html).toContain("data:font/woff2;base64,");
    // Not one reference to a folder an exported page does not have.
    expect(sums.html).not.toMatch(/url\(fonts\//);
    expect(prose.html).not.toContain("data:font/woff2;base64,");
    expect(prose.html).not.toContain(".katex");
  });

  it("draws the diagram, or leaves its source when it cannot draw one", async () => {
    // Mermaid runs at export time in the reader's own WebView, because a diagram
    // is a drawing rather than a document — and it is the one renderer whose
    // output nothing here can predict, so what is pinned is the other half of
    // the contract: a diagram that will not draw leaves the source it was drawn
    // from, marked as an error, which is what the editor does with the same
    // fence and the same library.
    //
    // jsdom has no `getBBox`, which is what Mermaid lays a graph out with, so
    // this is the branch a test can reach. The drawing that succeeds is on the
    // manual checklist, with the rest of what needs a real browser.
    const { html } = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const diagram = scopeOf(html).querySelector("[data-newmd-mermaid]");

    expect(diagram?.getAttribute("data-rendered")).toBe("error");
    expect(diagram?.querySelector("[data-diagram]")).toBeNull();
    expect(diagram?.querySelector("pre code")?.textContent).toBe("graph TD\n  A --> B");
  });

  it("renders a footnote pair as the shapes the editor renders them as", async () => {
    const page = parse((await renderDocumentHtml(SAMPLE, { theme: "light" })).html);

    expect(page.querySelector("sup[data-label]")?.textContent).toBe("1");
    expect(page.querySelector("dl[data-label] dd")?.textContent).toBe("The source.");
  });

  it("escapes what the document says rather than letting it be markup", async () => {
    const { html } = await renderDocumentHtml("a < b & c\n\n`<b>tag</b>`\n", { theme: "light" });
    const page = parse(html);

    // Read back as text: the characters the author typed, not elements they did
    // not write. A page built by string concatenation gets this wrong in exactly
    // one direction, and it is the direction that shows as missing text.
    expect(page.querySelector("p")?.textContent).toBe("a < b & c");
    expect(page.querySelector("code")?.textContent).toBe("<b>tag</b>");
    expect(page.querySelector("b")).toBeNull();
  });

  it("carries a picture that sits beside the document", async () => {
    // ADR-0005 §2.6, and the reason §2.6 gives: the common use of an exported
    // page is sending it to somebody, and `./assets/` stops meaning anything the
    // moment the file leaves the folder it was written in.
    disk[`${DOC_DIR}/assets/map.png`] = PNG;

    const { html, report } = await renderDocumentHtml(SAMPLE, {
      theme: "light",
      docPath: DOC_PATH,
    });
    const src = parse(html).querySelector("img")?.getAttribute("src") ?? "";

    expect(src.startsWith("data:image/png;base64,")).toBe(true);
    // Decoded and compared byte for byte: what is being checked is that the
    // file survived the round trip through base64, which is the one thing an
    // inlined picture can silently get wrong.
    expect(
      [...atob(src.slice("data:image/png;base64,".length))].map((c) => c.charCodeAt(0)),
    ).toEqual([...PNG]);
    // Asked for the file the document's own spelling pointed at, and nothing else.
    expect(asked).toEqual([`${DOC_DIR}/assets/map.png`]);
    expect(report.images).toEqual([]);
  });

  it("leaves a picture it could not resolve where its author put it", async () => {
    // A document that has never been saved has no folder, so a relative path has
    // nothing to be relative to. The path stays as written — the page is still
    // the document it was, and a reader who later moves the page next to the
    // pictures gets them back (ADR-0003 §2.7: the file says what it says).
    const { html, report } = await renderDocumentHtml(SAMPLE, { theme: "light" });

    expect(parse(html).querySelector("img")?.getAttribute("src")).toBe("./assets/map.png");
    expect(report.images).toEqual([{ url: "./assets/map.png", reason: "unresolved" }]);
    expect(asked).toEqual([]);
  });

  it("says which pictures it could not read", async () => {
    const { html, report } = await renderDocumentHtml("![map](./assets/gone.png)\n", {
      theme: "light",
      docPath: DOC_PATH,
    });

    expect(parse(html).querySelector("img")?.getAttribute("src")).toBe("./assets/gone.png");
    expect(report.images).toEqual([{ url: "./assets/gone.png", reason: "unreadable" }]);
  });

  it("leaves a picture on somebody else's server alone, and does not go and get it", async () => {
    // Fetching it would put the reader's address on a third party's log for the
    // sake of a file, and would make the page's contents depend on that server
    // still having it. The URL is what the document said, and it still works.
    const { html, report } = await renderDocumentHtml(
      "![a](https://example.com/a.png)\n\n![b](//cdn.example.com/b.png)\n",
      { theme: "light", docPath: DOC_PATH },
    );

    const sources = [...parse(html).querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(["https://example.com/a.png", "//cdn.example.com/b.png"]);
    expect(report.images.map((notice) => notice.reason)).toEqual(["remote", "remote"]);
    expect(asked).toEqual([]);
  });

  it("leaves a picture that is already in the file alone", async () => {
    // What this writer produces, arriving back in: reporting it as something it
    // failed to inline would be a page calling its own output a problem.
    const { report } = await renderDocumentHtml("![a](data:image/gif;base64,R0lGODlh)\n", {
      theme: "light",
      docPath: DOC_PATH,
    });

    expect(report.images).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("says so when a file's name does not say what kind of picture it is", async () => {
    // A data URI has to carry a media type, and a name with no extension is not
    // one — the bytes might be anything. Left as written rather than labelled
    // `application/octet-stream`, which is a label that renders as nothing.
    disk[`${DOC_DIR}/assets/scan`] = PNG;

    const { report } = await renderDocumentHtml("![a](./assets/scan)\n", {
      theme: "light",
      docPath: DOC_PATH,
    });

    expect(report.images).toEqual([{ url: "./assets/scan", reason: "unknown-type" }]);
    // And not read: a file whose type is unknown before it is opened is one
    // there was never a reason to open.
    expect(asked).toEqual([]);
  });

  it("names the document after its first heading when it is not told otherwise", async () => {
    const named = await renderDocumentHtml(SAMPLE, { theme: "light" });
    const explicit = await renderDocumentHtml(SAMPLE, { theme: "light", title: "Sample & co" });

    expect(parse(named.html).title).toBe("One");
    // Read back through a parser, so the escaping is what is being checked: a
    // title written into the page unescaped comes back as a different string.
    expect(parse(explicit.html).title).toBe("Sample & co");
  });
});
