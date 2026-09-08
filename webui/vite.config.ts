import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  build: { outDir: "../web/static", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8000" } },
  // Let layout tests import the real stylesheet and assert the cascade.
  test: { css: true },
});
