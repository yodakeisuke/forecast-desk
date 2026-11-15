// The GenUI sandbox runtime is built (not served by a dev server) so its CSP can stay strict:
// no HMR websocket, no inline scripts, nothing loaded from anywhere but the sandbox origin.
import { defineConfig } from "vite";
import { HOST_ORIGIN, SANDBOX_ORIGIN } from "./security.config.mjs";
import { resolve } from "node:path";

// "use client" directives in UI SDK are for RSC bundlers; they mean nothing here
const quiet = (w: { code?: string; message: string }, warn: (w: any) => void) => { if (w.code !== "MODULE_LEVEL_DIRECTIVE") warn(w); };

export default defineConfig({
  define: { 'process.env.FPA_HOST_ORIGIN': JSON.stringify(HOST_ORIGIN), 'process.env.FPA_SANDBOX_ORIGIN': JSON.stringify(SANDBOX_ORIGIN) },
  root: resolve(import.meta.dirname, "sandbox"),
  base: process.env.FPA_ASSET_BASE || "/",
  publicDir: false,
  resolve: { alias: { "@fpa/genui-sdk": resolve(import.meta.dirname, "sandbox/src/sdk/index.tsx") } },
  build: {
    assetsInlineLimit: 0, // no data: URLs under the sandbox CSP
    outDir: resolve(import.meta.dirname, "dist/sandbox"),
    emptyOutDir: true,
    target: "es2022",
    modulePreload: false,
    rollupOptions: { input: resolve(import.meta.dirname, "sandbox/runtime.html"), onwarn: quiet },
    chunkSizeWarningLimit: 4000,
  },
});
