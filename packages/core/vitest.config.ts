import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Stylesheets are processed rather than stubbed, which Vitest does not do
    // by default. `@newmd/core/document` hands the export their *text* through
    // `?inline` (ADR-0005 §2.5), and a stub answers with the empty string — so
    // without this a test would be asserting against nothing while passing the
    // only assertion that matters (`document-subpath.test.ts`).
    css: true,
  },
});
