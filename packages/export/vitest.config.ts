import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The writer is handed a document and produces a string, but the two things
    // it has to ask the DOM — parsing the result back to check it, and the
    // KaTeX / front matter markup core builds as *elements* — are DOM questions.
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // Stylesheets are processed rather than stubbed, which Vitest does not do by
    // default: the export inlines their text, and a stub answers with the empty
    // string. See `packages/core/vitest.config.ts` for the other half of this.
    css: true,
  },
  // `@newmd/core` ships TypeScript sources through its package `exports`, so it
  // has to be transformed rather than read as a prebuilt dependency.
  server: {
    deps: {
      inline: [/@newmd\//],
    },
  },
});
