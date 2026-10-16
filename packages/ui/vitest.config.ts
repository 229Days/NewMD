import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // Stylesheets are processed rather than stubbed, which Vitest does not do by
    // default. `packages/export` needs the same thing for the same reason (it
    // inlines their text, and a stub answers with the empty string), and the
    // export is reached from here now — so a UI test that exported a document
    // would be asserting against a page the app itself never produces.
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
