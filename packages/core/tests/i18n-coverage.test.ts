/**
 * Copy-externalisation guard (ADR-0001 §2.11: 全部文案外置).
 *
 * The i18n unit tests prove locale resolution works. They cannot prove that
 * every piece of on-screen copy actually goes through it. These checks do, by
 * reading the source the UI is built from:
 *
 *   1. the locale files carry the same key set, so a switch never drops copy;
 *   2. every `t("…")` key referenced in source resolves in both locales;
 *   3. no CJK characters live in app source outside the locale files;
 *   4. no raw JSX text;
 *   5. no raw copy handed to a UI slot (title, label, message, …);
 *   6. no raw copy in a `? :` or `??` operand;
 *   7. React code reaches for copy only through `useT()`, so a language switch
 *      actually re-renders what is on screen.
 *
 * It lives in core because core owns the locale resources; it reaches into the
 * UI packages because that is where copy would leak back in.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import enUS from "../src/locales/en-US.json";
import zhCN from "../src/locales/zh-CN.json";
import { SUPPORTED_LOCALES } from "../src/i18n";

// tests/ → core/ → packages/ → repo root
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SOURCE_ROOTS = ["packages/ui/src", "packages/core/src", "apps/desktop/src"];

/** The presentation layer — where a bare string is always a user-visible word. */
const UI_ROOTS = ["packages/ui/src", "apps/desktop/src"];

/** Property names whose values are always user-visible. */
const UI_SLOTS = [
  "alternativeKey",
  "alternativeLabel",
  "aria-label",
  "cancelKey",
  "cancelLabel",
  "confirmKey",
  "confirmLabel",
  "label",
  "labelKey",
  "message",
  "messageKey",
  "placeholder",
  "title",
  "titleKey",
];

/** Tailwind class lists and custom-property references — styling, not copy. */
const STYLE_ONLY = /^[a-z0-9\s\-_[\]()./#%:,]*$/;

/** A dotted resource path such as `dialog.unsavedTitle` — a key, not a sentence. */
const KEY_SHAPED = /^[a-z][\w-]*(\.[\w-]+)+$/;

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function sourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));
}

function uiFiles(): string[] {
  return UI_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));
}

/** App source with the locale files removed — those *are* the copy. */
function copyBearingFiles(): string[] {
  return sourceFiles().filter((file) => !file.includes("src/locales/"));
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function short(file: string): string {
  return file.replace(REPO_ROOT, "").replaceAll("\\", "/");
}

/**
 * True for a literal a person reads, rather than a symbol ("—"), a theme enum
 * ("light"), a class list ("px-3 text-[13px]") or an i18n key.
 */
function looksLikeCopy(literal: string): boolean {
  if (!/[A-Za-z一-鿿]/.test(literal)) return false;
  if (KEY_SHAPED.test(literal)) return false;
  return !STYLE_ONLY.test(literal);
}

/** Capture group `n` of a match. The pattern only matches when that group took part. */
function group(match: RegExpMatchArray, n: number): string {
  const value = match[n];
  if (value === undefined) throw new Error(`capture group ${n} is missing`);
  return value;
}

/** The string literal starting at `at`, or null when that is not one. */
function quotedAt(code: string, at: number): string | null {
  const quote = code[at];
  if (quote !== '"' && quote !== "'") return null;
  const end = code.indexOf(quote, at + 1);
  return end < 0 ? null : code.slice(at + 1, end);
}

/**
 * Collect literals that follow `anchor`, which must end at the character before
 * the string. Reading the quote by hand rather than with a regex is what keeps
 * "Don't save" whole — a `[^"']` class stops at the apostrophe.
 */
function literalsAfter(code: string, anchor: RegExp): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(anchor)) {
    const literal = quotedAt(code, match.index + match[0].length);
    if (literal !== null && looksLikeCopy(literal)) found.push(literal);
  }
  return found;
}

/**
 * Blank out JSX expression containers so what remains between tags is literal text.
 *
 * Every `{…}` span is judged on its own, at any nesting depth. A span is kept
 * when it holds a statement (`;`) or renders JSX (`<`) — a function body must
 * survive intact, and `{cond && <span>…</span>}` has children of its own that
 * still have to be scannable. What is left to blank — `{cursor.line}`, `{busy ?
 * "Working…" : "Ready"}` — is exactly the expression-container case.
 *
 * Nesting and braces inside string literals are handled; a naive regex would
 * desync on `t("x", { a: 1 })` and on `${…}` templates.
 */
function blankExpressions(code: string): string {
  const chars = code.split("");
  const blanks: Array<[number, number]> = [];
  const stack: Array<{ start: number; sawTag: boolean; sawStatement: boolean }> = [];
  let quote: string | null = null;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      stack.push({ start: i, sawTag: false, sawStatement: false });
      continue;
    }
    if (ch === "}") {
      const frame = stack.pop();
      if (frame && !frame.sawTag && !frame.sawStatement) blanks.push([frame.start, i]);
      continue;
    }
    // Mark every enclosing span, so a parent sees what its children contain.
    if (ch === "<") for (const frame of stack) frame.sawTag = true;
    if (ch === ";") for (const frame of stack) frame.sawStatement = true;
  }

  for (const [from, to] of blanks) {
    for (let j = from; j <= to; j++) chars[j] = " ";
  }
  return chars.join("");
}

function report(offenders: string[], file: string, literals: string[]): void {
  for (const literal of literals) offenders.push(`${short(file)} → ${literal}`);
}

describe("copy stays externalised", () => {
  it("keeps the same key set in every locale", () => {
    const perLocale = SUPPORTED_LOCALES.map((locale) => {
      const bundle = locale === "zh-CN" ? zhCN : enUS;
      return { locale, keys: flatten(bundle).sort() };
    });
    const [reference, ...rest] = perLocale;
    if (!reference) throw new Error("no locales configured");
    for (const other of rest) {
      const missing = reference.keys.filter((key) => !other.keys.includes(key));
      const extra = other.keys.filter((key) => !reference.keys.includes(key));
      expect({ locale: other.locale, missing, extra }).toEqual({
        locale: other.locale,
        missing: [],
        extra: [],
      });
    }
  });

  it("resolves every key the source asks for", () => {
    const known = new Set(flatten(zhCN));
    const unknown: string[] = [];
    for (const file of copyBearingFiles()) {
      for (const match of read(file).matchAll(/\bt\(\s*["']([\w.-]+)["']/g)) {
        const key = group(match, 1);
        if (!known.has(key)) unknown.push(`${short(file)} → ${key}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("leaves no Chinese characters in app source", () => {
    const offenders: string[] = [];
    for (const file of copyBearingFiles()) {
      const match = stripComments(read(file)).match(/[一-鿿]+/);
      if (match) offenders.push(`${short(file)} → ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no raw JSX text", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!file.endsWith(".tsx")) continue;
      const code = blankExpressions(stripComments(read(file)));
      for (const match of code.matchAll(/>\s*([A-Za-z][\w ,.'’!?…:-]*)\s*</g)) {
        offenders.push(`${short(file)} → ${group(match, 1).trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no raw copy in a UI slot", () => {
    const slots = UI_SLOTS.join("|");
    const anchor = new RegExp("(?:^|[^A-Za-z])(?:" + slots + ")[ ]*[=:][ ]*", "g");
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      report(offenders, file, literalsAfter(stripComments(read(file)), anchor));
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no raw copy in a ternary or nullish operand", () => {
    const offenders: string[] = [];
    for (const file of uiFiles()) {
      report(offenders, file, literalsAfter(stripComments(read(file)), /[?:][ ]*/g));
    }
    expect(offenders).toEqual([]);
  });

  it("routes every React copy site through useT", () => {
    // `t` is a plain function and i18next carries no React binding, so a
    // component that called it directly would keep rendering the old language
    // after a switch. Withdrawing `t` from the .tsx layer means a component that
    // forgets to subscribe fails to compile — this check only has to keep the
    // escape hatch shut.
    const offenders: string[] = [];
    for (const file of uiFiles()) {
      if (!file.endsWith(".tsx")) continue;
      const pattern = /import\s*\{([^}]*)\}\s*from\s*["']@newmd\/core["']/g;
      for (const match of stripComments(read(file)).matchAll(pattern)) {
        if (/(?:^|[,\s])t(?:[,\s]|$)/.test(group(match, 1))) offenders.push(short(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
