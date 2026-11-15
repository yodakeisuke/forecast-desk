import { defineConfig } from "vite";
import { hostHeaders, HOST_ORIGIN, SANDBOX_ORIGIN } from "./security.config.mjs";

// "use client" directives in UI SDK are for RSC bundlers; they mean nothing here
const quiet = (w: { code?: string; message: string }, warn: (w: any) => void) => { if (w.code !== "MODULE_LEVEL_DIRECTIVE") warn(w); };

export default defineConfig(({ command }) => ({
  base: process.env.FPA_ASSET_BASE || "/",
  define: { 'process.env.FPA_HOST_ORIGIN': JSON.stringify(HOST_ORIGIN), 'process.env.FPA_SANDBOX_ORIGIN': JSON.stringify(SANDBOX_ORIGIN) },
  server: { host: "localhost", port: 5173, strictPort: true, watch: { usePolling: true, interval: 300, ignored: ["**/dist/**", "**/tests/**"] }, headers: hostHeaders({ dev: command === "serve" }) },
  preview: { host: "localhost", port: 4173, strictPort: true, headers: hostHeaders() },
  // assetsInlineLimit 0: no data: URLs, so the strict CSP (font-src 'self') holds in the build too
  build: { outDir: "dist/app", target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 4000, rollupOptions: { onwarn: quiet } },
  worker: { format: "es" },
  // The PDF worker is loaded only on export. Discover its dependencies up front so the first
  // export cannot trigger Vite's dependency rebundle/full reload and erase the in-memory report.
  optimizeDeps: { include: ["@react-pdf/renderer", "@json-render/react-pdf"], exclude: ["@duckdb/duckdb-wasm"] },
}));
