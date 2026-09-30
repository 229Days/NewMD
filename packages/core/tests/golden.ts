/// <reference types="vite/client" />

/**
 * The golden corpus, read in one place for every test that has to honour it.
 *
 * Shared between the serializer round trip and the WYSIWYG engine round trip on
 * purpose: two readers would be two definitions of what the corpus promises,
 * and a test that passes against the wrong one is exactly the false pass this
 * suite exists to prevent.
 *
 * Read through Vite rather than `node:fs` so it works in both environments the
 * suite runs in. Under jsdom `import.meta.url` is an http URL and
 * `fileURLToPath` throws; a glob has no path to resolve.
 */
const files = import.meta.glob<string>("./golden/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const corpus = new Map(
  Object.entries(files).map(([path, text]) => [path.replace(/^\.\/golden\//, ""), text]),
);

export interface GoldenCase {
  /** File name, used as the test label. */
  name: string;
  /** What a person could hand us. */
  input: string;
  /** What has to come back — the input itself when the pair is byte identity. */
  expected: string;
  /** True when the file promises byte-for-byte preservation. */
  strict: boolean;
}

export function goldenCases(): GoldenCase[] {
  return [...corpus.keys()]
    .filter((name) => name.endsWith(".md") && !name.endsWith(".expected.md"))
    .sort()
    .map((name) => {
      const input = corpus.get(name);
      if (input === undefined) throw new Error(`corpus lost ${name}`);
      const pair = name.replace(/\.md$/, ".expected.md");
      const expected = corpus.get(pair);
      return {
        name,
        input,
        expected: expected ?? input,
        strict: expected === undefined,
      };
    });
}

/** Every node type that appears anywhere in `node`, depth first. */
export function nodeTypes(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string") out.push(record.type);
    for (const key of ["children", "value"]) {
      const child = record[key];
      if (Array.isArray(child)) child.forEach(walk);
    }
  };
  walk(node);
  return out;
}
