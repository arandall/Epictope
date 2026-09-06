import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: { outDir: "../web/static", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8000" } },
});
