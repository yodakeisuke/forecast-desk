// The only place the TypeSafe API key lives: the local dev/preview server. The browser never sees it.
// POST /api/decide takes a meeting question and the current screen conditions, builds the fixed Jev request
// itself (so the key cannot be used for anything else), and returns only the chosen options.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { z } from "zod";
import { buildJevRequest, checkAnswers, JEV_MODEL_DEFAULT } from "../src/meeting/jev";
import type { Screen } from "../src/meeting/plan";
import { REGIONS, SEGMENTS, PRODUCTS, VERSIONS } from "../src/data/model";

export const DECIDE_PATH = "/api/decide";
const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
const MAX_BODY = 4096;

const nullableEnum = (v: readonly [string, ...string[]]) => z.enum(v).nullable().optional();
export const DecideBody = z.object({
  question: z.string().trim().min(1).max(200),
  screen: z.object({
    compare: z.enum(VERSIONS.map((v) => v.id) as [string, ...string[]]),
    filters: z.object({ region: nullableEnum(REGIONS), segment: nullableEnum(SEGMENTS), product: nullableEnum(PRODUCTS) }).strict(),
    scenario: z.object({ winRate: z.number().min(0).max(100), slipBack: z.number().min(0).max(100), naBias: z.number().min(-30).max(30) }).strict(),
    refs: z.object({ winRate09: z.number().min(0).max(100), winRate10: z.number().min(0).max(100) }).strict(),
  }).strict(),
}).strict();

export type RelayOptions = {
  /** TYPESAFE_API_KEY from .env (never a VITE_ variable, so it is never bundled) */
  key?: string;
  /** "proxy": the egress proxy adds Authorization itself (cloud Network secrets); the key never enters this process */
  auth?: string;
  model?: string;
  /** the app origins allowed to call the relay (same-origin only) */
  origins: string[];
  fetchImpl?: typeof fetch;
};

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
  res.end(JSON.stringify(body));
}

// a small budget per server: a burst of 5, then about 2 a second, and at most 600 an hour
function limiter() {
  let tokens = 5, last = Date.now(), hour = Date.now(), count = 0;
  return () => {
    const now = Date.now();
    tokens = Math.min(5, tokens + ((now - last) / 1000) * 2); last = now;
    if (now - hour > 3_600_000) { hour = now; count = 0; }
    if (tokens < 1 || count >= 600) return false;
    tokens -= 1; count += 1; return true;
  };
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createDecideHandler(opts: RelayOptions) {
  const allow = limiter();
  const hosts = new Set(opts.origins.map((o) => new URL(o).host));
  const doFetch = opts.fetchImpl ?? fetch;
  const viaProxy = opts.auth === "proxy";
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") return send(res, 405, { ok: false, reason: "method" }, { Allow: "POST" });
    // same-origin only: DNS rebinding (Host), other sites (Origin / Sec-Fetch-Site), simple-request CSRF (Content-Type)
    if (!hosts.has(String(req.headers.host ?? ""))) return send(res, 403, { ok: false, reason: "host" });
    if (!opts.origins.includes(String(req.headers.origin ?? ""))) return send(res, 403, { ok: false, reason: "origin" });
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin") return send(res, 403, { ok: false, reason: "origin" });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { ok: false, reason: "content-type" });
    if (!opts.key && !viaProxy) return send(res, 503, { ok: false, reason: "no-key" });
    const raw = await readBody(req);
    if (raw === null) return send(res, 413, { ok: false, reason: "size" });
    let parsed;
    try { parsed = DecideBody.safeParse(JSON.parse(raw)); } catch { return send(res, 400, { ok: false, reason: "json" }); }
    if (!parsed.success) return send(res, 400, { ok: false, reason: "shape" });
    // the budget is spent only by requests that would reach Jev
    if (!allow()) return send(res, 429, { ok: false, reason: "rate" });
    const jev = buildJevRequest(parsed.data.question, parsed.data.screen as Screen, opts.model || JEV_MODEL_DEFAULT);
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (!viaProxy) headers.Authorization = `Bearer ${opts.key}`;
      const up = await doFetch(UPSTREAM, { method: "POST", headers, body: JSON.stringify(jev), signal: AbortSignal.timeout(4000) });
      // the upstream body is never echoed: it could carry account details
      if (!up.ok) return send(res, 502, { ok: false, reason: "upstream", status: up.status });
      const body = await up.json();
      const model = typeof body?.model === "string" && /^[\w.-]{1,40}$/.test(body.model) ? body.model : "jev";
      return send(res, 200, { ok: true, model, ms: Date.now() - t0, answers: checkAnswers(jev, body) });
    } catch (e) {
      return send(res, 504, { ok: false, reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "network" });
    }
  };
}

export function decideRelay(opts: RelayOptions): Plugin {
  const handler = createDecideHandler(opts);
  const mount = (mw: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void }) =>
    mw.use(DECIDE_PATH, (req, res) => { void handler(req, res); });
  return {
    name: "forecast-desk:decide-relay",
    configureServer(server) { mount(server.middlewares); },
    configurePreviewServer(server) { mount(server.middlewares); },
  };
}
