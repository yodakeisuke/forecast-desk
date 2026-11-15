// Static server for the GenUI sandbox origin (127.0.0.1:5174). Serves only the built runtime, with strict headers.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxHeaders } from "../security.config.mjs";

const root = fileURLToPath(new URL("../dist/sandbox/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml" };
const port = Number(process.env.SANDBOX_PORT || 5174);

createServer(async (req, res) => {
  const headers = sandboxHeaders();
  try {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, headers).end(); return; }
    const url = new URL(req.url || "/", "http://x");
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (p === "" ) p = "runtime.html";
    const file = join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403, headers).end(); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    res.writeHead(200, { ...headers, "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { ...headers, "Content-Type": "text/plain" }).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`[sandbox] http://127.0.0.1:${port}  (GenUI sandbox origin)`));
