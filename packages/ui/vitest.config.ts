import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
  // `@newmd/core` ships TypeScript sources through its package `exports`, so it
  // has to be transformed rather than read as a prebuilt dependency.
  server: {
    deps: {
      inline: [/@newmd\//],
    },
  },
});
