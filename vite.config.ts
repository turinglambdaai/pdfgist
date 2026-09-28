import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// PDF.js needs its cmaps (CJK text extraction) and standard fonts at runtime;
// copy them into dist so both dev servers and packaged builds can serve them.
function copyPdfjsAssets(): Plugin {
  return {
    name: "copy-pdfjs-assets",
    closeBundle() {
      const pdfjs = resolve(process.cwd(), "node_modules/pdfjs-dist");
      const out = resolve(process.cwd(), "dist");
      cpSync(resolve(pdfjs, "cmaps"), resolve(out, "cmaps"), { recursive: true });
      cpSync(resolve(pdfjs, "standard_fonts"), resolve(out, "standard_fonts"), { recursive: true });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // cargo writes into src-tauri/target while vite watches the project
      // root; watching those files crashes the dev server (EBUSY on Windows)
      ignored: ["**/src-tauri/target/**", "**/dist/**"],
    },
  },
  build: { target: "es2022" },
  plugins: [copyPdfjsAssets()],
});
