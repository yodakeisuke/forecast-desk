// Widget manager: the host side of the GenUI wall. Each widget runs in its own iframe on another site
// (127.0.0.1:5174), sandbox="allow-scripts" only, and talks through exactly one MessagePort.
// Everything that arrives on that port is untrusted: checked against an allowlist of message shapes.
import { z } from "zod";
import { SANDBOX_ORIGIN } from "../../security.config.mjs";
import { securityLog } from "../lib/security-log";
import { actions, getState, type Who } from "../state/store";
import { runQuery } from "./queries";
import { widgetWritePolicy } from "./write-policy";

export const SANDBOX_URL = `${SANDBOX_ORIGIN}/runtime.html`;
export const MAX_CODE = 64 * 1024;
const MAX_MSG = 512 * 1024;
const SCENARIO_PATH = /^\/scenario\/(winRate|slipBack|naBias)$/;
const RANGE: Record<string, [number, number]> = { "/scenario/winRate": [0, 100], "/scenario/slipBack": [0, 100], "/scenario/naBias": [-30, 30] };

const id = z.number().int().nonnegative();
const Incoming = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ready"), height: z.number().min(0).max(5000), components: z.array(z.object({ ref: z.string().max(40), component: z.string().max(60), label: z.string().max(200).optional(), actions: z.array(z.string().max(40)).max(20) }).passthrough()).max(100), issues: z.array(z.string().max(500)).max(50) }).strict(),
  z.object({ t: z.literal("error"), phase: z.enum(["compile", "render", "spec", "runtime"]), message: z.string().max(4000) }).strict(),
  z.object({ t: z.literal("data.get"), id, query: z.string().max(40), args: z.unknown() }).strict(),
  z.object({ t: z.literal("state.get"), id, path: z.string().max(80) }).strict(),
  z.object({ t: z.literal("state.set"), id, path: z.string().max(80), value: z.unknown() }).strict(),
  z.object({ t: z.literal("state.undo"), id, source: z.literal("agent") }).strict(),
  z.object({ t: z.literal("ui.resize"), height: z.number().min(0).max(5000) }).strict(),
  z.object({ t: z.literal("ui.suggest"), label: z.string().max(80), tool: z.enum(["set_filter", "drill_down"]), args: z.record(z.string(), z.union([z.string().max(40), z.array(z.string().max(40)).max(3), z.null()])) }).strict(),
  z.object({ t: z.literal("violation"), directive: z.string().max(80), blocked: z.string().max(300) }).strict(),
  z.object({ t: z.literal("reply"), id, ok: z.boolean(), result: z.unknown().optional(), error: z.string().max(4000).optional() }).strict(),
]);
type In = z.infer<typeof Incoming>;

type Runtime = {
  wid: string; key: string; code: string; iframe: HTMLIFrameElement | null; port: MessagePort | null;
  seq: number; pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  operating: boolean; settled: Promise<RenderResult>; settle: (r: RenderResult) => void; hb?: ReturnType<typeof setInterval>; lastPong: number;
  burst: { at: number; n: number }; preview: boolean; lastUserLog: number; frozenState?: ReturnType<typeof stateSnapshot>;
};
export type RenderResult = { status: "ready" | "error"; error?: string; phase?: string; components?: unknown[]; issues?: string[]; height?: number };

const runtimes = new Map<string, Runtime>();
type Proposal = { rt: Runtime; id: string; path?: string; value?: number; before?: number };
const proposals = new Map<string, Proposal>();
function propose(rt: Runtime, change: Omit<Proposal, "rt" | "id">) {
  const id = crypto.randomUUID(); proposals.set(rt.wid, { rt, id, ...change });
  actions.patchWidget(rt.wid, { pendingChange: { id, label: change.path ? `${pathLabel(change.path)}を ${change.before}% → ${change.value}% に変更` : "Agentのシナリオ変更を取り消す" } });
}
export function resolveWidgetChange(wid: string, id: string, accept: boolean, event: Event) {
  if (!event.isTrusted) return;
  const p = proposals.get(wid);
  if (!p || p.id !== id || runtimes.get(p.rt.key) !== p.rt) return;
  proposals.delete(wid); actions.patchWidget(wid, { pendingChange: null });
  if (!accept) return;
  if (p.path && p.value !== undefined) {
    if (getState().scenario.values[p.path] !== p.before) { actions.toast("前提が変更されたため、古い提案は適用しませんでした"); return; }
    actions.setScenario(p.path, p.value, "user"); broadcastState(p.path);
  } else actions.undoScenario("agent").forEach(broadcastState);
  actions.pushItem({ who: "user", result: "生成UIからの変更提案を確認して適用", running: false });
}
const locatedCache = new Map<string, { x: number; y: number; w: number; h: number }>();
export const located = (wid: string, name: string) => locatedCache.get(`${wid}/${name}`) ?? null;

/** Cheap early checks so the LLM gets a fast, clear error. The real wall is the sandbox + this port. */
export function precheck(code: string): string | null {
  if (typeof code !== "string" || !code.trim()) return "code が空です";
  if (new Blob([code]).size > MAX_CODE) return `code は64KBまでです（${Math.round(new Blob([code]).size / 1024)}KB）`;
  const imports = [...code.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  const bad = imports.filter((m) => m !== "react" && m !== "@fpa/genui-sdk" && m !== "react/jsx-runtime");
  if (bad.length) return `importできるのは "@fpa/genui-sdk" と "react" だけです（${bad.join(", ")}）`;
  if (!/export\s+default/.test(code)) return "default export のウィジェット関数がありません";
  return null;
}

function theme() {
  const cs = getComputedStyle(document.documentElement);
  const names = ["--page", "--surface", "--raised", "--sunken", "--hover", "--ink", "--ink-2", "--muted", "--border", "--border-2", "--grid", "--axis", "--s1", "--s2", "--s3", "--pos", "--neg", "--tot", "--ref", "--mid", "--bad-t", "--good-t", "--warn", "--agent", "--agent-ink", "--agent-soft", "--agent-line"];
  return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
}

function send(rt: Runtime, msg: Record<string, unknown>) { if (runtimes.get(rt.key) === rt) rt.port?.postMessage(msg); }
function request<T = unknown>(rt: Runtime, t: string, payload: Record<string, unknown> = {}, timeout = 8000): Promise<T> {
  if (!rt.port) return Promise.reject(new Error("ウィジェットはまだ起動していません"));
  const n = ++rt.seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { rt.pending.delete(n); reject(new Error(`ウィジェットが${timeout}ms以内に応答しませんでした`)); }, timeout);
    rt.pending.set(n, { resolve: resolve as (v: unknown) => void, reject, timer });
    send(rt, { t, id: n, ...payload });
  });
}

function stateSnapshot(s = getState().scenario) {
  return Object.fromEntries(Object.keys(s.values).map((p) => [p, { value: s.values[p], owner: s.owner[p] ?? "init" }]));
}
export function broadcastState(path: string) {
  const s = getState().scenario;
  for (const rt of runtimes.values()) if (!rt.preview) send(rt, { t: "state", path, value: s.values[path], owner: s.owner[path] ?? "init" });
}

function dispose(rt: Runtime, reason: string) {
  clearInterval(rt.hb);
  rt.port?.close(); rt.port = null;
  rt.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error(reason)); });
  rt.pending.clear();
  rt.settle({ status: "error", error: reason, phase: "runtime" });
  if (runtimes.get(rt.key) === rt) runtimes.delete(rt.key);
  if (proposals.get(rt.wid)?.rt === rt) { proposals.delete(rt.wid); actions.patchWidget(rt.wid, { pendingChange: null }); }
  for (const key of locatedCache.keys()) if (key.startsWith(`${rt.wid}/`)) locatedCache.delete(key);
}

export function destroy(key: string, reason: string) {
  const rt = runtimes.get(key);
  if (!rt) return;
  dispose(rt, reason);
  if (rt.iframe) rt.iframe.src = "about:blank";
  if (!rt.preview) actions.patchWidget(rt.wid, { status: "destroyed", error: reason });
  securityLog("iframe", "ウィジェットのiframeを破棄", reason, rt.wid);
}

/** Called by the widget card when its iframe has loaded the runtime page. */
export function attach(key: string, wid: string, code: string, iframe: HTMLIFrameElement, preview = false) {
  const old = runtimes.get(key);
  if (old && old.iframe === iframe && old.port) return old.settled;
  let settle!: (r: RenderResult) => void;
  const settled = new Promise<RenderResult>((r) => { settle = r; });
  const prev = old;
  const rt: Runtime = { wid, key, code, iframe, port: null, seq: 0, pending: new Map(), operating: false, settled, settle, lastPong: Date.now(), burst: { at: Date.now(), n: 0 }, preview, lastUserLog: 0, frozenState: preview ? stateSnapshot(getState().report?.scenario) : undefined };
  if (prev) dispose(prev, "ウィジェットが置き換えられました");
  runtimes.set(key, rt);
  const ch = new MessageChannel();
  rt.port = ch.port1;
  ch.port1.onmessage = (e) => onMessage(rt, e.data);
  ch.port1.onmessageerror = () => securityLog("bridge", "読めないメッセージを拒否", "messageerror", wid);
  // The sandboxed document has an opaque origin ("null"), so "*" is the only target that reaches it.
  // The message carries nothing but the port; from now on only that port is listened to.
  iframe.contentWindow?.postMessage({ t: "fpa:init", v: 1 }, "*", [ch.port2]);
  send(rt, { t: "render", code, theme: theme(), state: rt.frozenState ?? stateSnapshot(), widget: wid, preview });
  rt.hb = setInterval(() => {
    if (document.visibilityState !== "visible" || !iframe.isConnected || !iframe.getClientRects().length) { rt.lastPong = Date.now(); return; }
    if (Date.now() - rt.lastPong > 9000) { destroy(key, "応答が9秒途絶えたため破棄しました（無限ループなど）"); return; }
    request(rt, "ping", {}, 8500).then(() => { rt.lastPong = Date.now(); }).catch(() => {});
  }, 3000);
  return settled;
}

export function detach(key: string) {
  const rt = runtimes.get(key);
  if (!rt) return;
  dispose(rt, "ウィジェットが閉じられました");
}

function refuse(rt: Runtime, title: string, detail: string) { securityLog("bridge", title, detail, rt.wid); }

async function onMessage(rt: Runtime, raw: unknown) {
  if (runtimes.get(rt.key) !== rt) return;
  // rate limit: a widget flooding the port is broken or hostile
  const now = Date.now();
  if (now - rt.burst.at > 1000) rt.burst = { at: now, n: 0 };
  if (++rt.burst.n > 300) { destroy(rt.key, "1秒に300件を超えるメッセージ"); return; }
  let size = 0;
  try { size = JSON.stringify(raw)?.length ?? 0; } catch { refuse(rt, "直列化できないメッセージを拒否", "cyclic or non-JSON"); return; }
  if (size > MAX_MSG) { refuse(rt, "大きすぎるメッセージを拒否", `${Math.round(size / 1024)}KB`); return; }
  const parsed = Incoming.safeParse(raw);
  if (!parsed.success) {
    const t = (raw as { t?: unknown })?.t;
    refuse(rt, `許可されていないメッセージを拒否: ${typeof t === "string" ? t.slice(0, 40) : typeof raw}`, parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; "));
    return;
  }
  const m: In = parsed.data;
  const reply = (id: number, ok: boolean, body: Record<string, unknown>) => send(rt, { t: "res", id, ok, ...body });
  switch (m.t) {
    case "ready":
      rt.lastPong = Date.now();
      if (!rt.preview) actions.patchWidget(rt.wid, { status: "ready", height: clampH(m.height), error: m.issues.length ? m.issues.join("\n") : undefined });
      rt.settle({ status: "ready", components: m.components, issues: m.issues, height: m.height });
      break;
    case "error":
      if (!rt.preview) actions.patchWidget(rt.wid, { status: "error", error: `${m.phase}: ${m.message}` });
      rt.settle({ status: "error", phase: m.phase, error: m.message });
      break;
    case "ui.resize":
      if (!rt.preview) actions.patchWidget(rt.wid, { height: clampH(m.height) });
      else rt.iframe && (rt.iframe.style.height = `${clampH(m.height)}px`);
      break;
    case "data.get":
      try {
        const rows = await runQuery(m.query, m.args);
        if (!rt.preview) actions.patchWidget(rt.wid, { dataReads: (getState().widgets.find((w) => w.id === rt.wid)?.dataReads ?? 0) + 1 });
        reply(m.id, true, { result: rows });
      } catch (e) { reply(m.id, false, { error: (e as Error).message }); }
      break;
    case "state.get":
      if (!SCENARIO_PATH.test(m.path)) { refuse(rt, "共有状態の読み出しを拒否", m.path); reply(m.id, false, { error: "読めるのは /scenario/* だけです" }); break; }
      reply(m.id, true, { result: rt.frozenState?.[m.path] ?? { value: getState().scenario.values[m.path], owner: getState().scenario.owner[m.path] ?? "init" } });
      break;
    case "state.set": {
      if (rt.preview) { reply(m.id, false, { error: "報告書のプレビューは読み取り専用です" }); break; }
      if (!SCENARIO_PATH.test(m.path)) { refuse(rt, "共有状態への書き込みを拒否", `${m.path} ← ${JSON.stringify(m.value)?.slice(0, 80)}`); reply(m.id, false, { error: "書けるのは /scenario/* だけです" }); break; }
      const [lo, hi] = RANGE[m.path];
      if (typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < lo || m.value > hi) { refuse(rt, "範囲外の値を拒否", `${m.path} ← ${String(m.value).slice(0, 40)}`); reply(m.id, false, { error: `${m.path} は ${lo}〜${hi} の数` }); break; }
      const state = getState().scenario;
      const before = state.values[m.path];
      const { source: who, decision } = widgetWritePolicy(rt.operating, state.owner[m.path], before, m.value);
      if (decision === "unchanged") {
        reply(m.id, true, { result: { value: before, owner: state.owner[m.path] ?? "init" } }); break;
      }
      if (decision === "confirm") {
        propose(rt, { path: m.path, value: m.value, before });
        reply(m.id, true, { result: { status: "pending", value: before, owner: state.owner[m.path] } }); break;
      }
      actions.setScenario(m.path, m.value, who);
      broadcastState(m.path);
      reply(m.id, true, { result: { value: m.value, owner: who } });
      if (before !== m.value && who === "widget" && now - rt.lastUserLog > 1500) {
        rt.lastUserLog = now;
        actions.pushItem({ who: "widget", result: `${pathLabel(m.path)}を ${m.value}% に変更（ウィジェット）`, running: false });
      }
      break;
    }
    case "state.undo": {
      if (rt.preview) { reply(m.id, false, { error: "読み取り専用です" }); break; }
      if (!rt.operating) { propose(rt, {}); reply(m.id, true, { result: { status: "pending", reverted: [] } }); break; }
      const changed = actions.undoScenario("agent");
      changed.forEach(broadcastState);
      actions.pushItem({ who: "agent", result: changed.length ? `Agentの変更だけを取り消し（${changed.map(pathLabel).join("、")}）` : "取り消すAgentの変更はありません", running: false });
      reply(m.id, true, { result: { reverted: changed } });
      break;
    }
    case "ui.suggest":
      if (!rt.preview) actions.patchWidget(rt.wid, { suggestion: { label: m.label, tool: m.tool, args: m.args } });
      break;
    case "violation":
      securityLog(m.directive.startsWith("sandbox") ? "iframe" : "csp", violationTitle(m.directive, m.blocked), m.blocked, rt.wid);
      break;
    case "reply": {
      const p = rt.pending.get(m.id);
      if (!p) break;
      clearTimeout(p.timer);
      rt.pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error ?? "失敗しました"));
      break;
    }
  }
}

const clampH = (h: number) => Math.round(Math.min(800, Math.max(120, h)));
/** A blocked load of an outside URL is an attempt to send data out, whatever the directive. */
function violationTitle(directive: string, blocked: string) {
  if (directive === "sandbox-popups") return "ポップアップを開こうとした（sandboxで不可）";
  if (directive.startsWith("connect")) return "外部送信をブロック";
  const kind: Record<string, string> = { "img-src": "画像", "font-src": "フォント", "media-src": "メディア", "script-src-elem": "スクリプト", "script-src": "スクリプト", "style-src-elem": "スタイル", "frame-src": "iframe", "form-action": "フォーム送信", "worker-src": "ワーカー" };
  if (/^https?:/i.test(blocked)) return `外部送信をブロック（${kind[directive] ?? directive}）`;
  return `サンドボックスのCSPが拒否: ${directive}`;
}

export const pathLabel = (p: string) => ({ "/scenario/winRate": "成約率", "/scenario/slipBack": "スリップ戻り率", "/scenario/naBias": "見通し補正" } as Record<string, string>)[p] ?? p;

// ---------- used by the tools ----------
export const settled = (key: string) => runtimes.get(key)?.settled;
export function waitForRuntime(key: string, ms = 10000): Promise<Runtime> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const rt = runtimes.get(key);
      if (rt?.port) return resolve(rt);
      if (Date.now() - t0 > ms) return reject(new Error("サンドボックスが起動しませんでした（配信先とCSPを確認してください）"));
      setTimeout(tick, 50);
    };
    tick();
  });
}
export async function snapshotWidget(wid: string) { return request(await waitForRuntime(wid), "agent.snapshot"); }
export async function actInWidget(wid: string, steps: unknown[]) {
  const rt = await waitForRuntime(wid);
  rt.operating = true;
  try { return await request(rt, "agent.act", { steps }, 15000); } finally { setTimeout(() => { rt.operating = false; }, 50); }
}
export async function exportWidget(wid: string) { return request<{ spec: unknown; slots: Record<string, unknown>; title?: string }>(await waitForRuntime(wid), "export", {}, 8000); }
export async function requestLocate(wid: string, name: string) {
  const rt = runtimes.get(wid);
  if (!rt) return null;
  try {
    const r = await request<{ x: number; y: number; w: number; h: number } | null>(rt, "locate", { name }, 3000);
    if (r) locatedCache.set(`${wid}/${name}`, r);
    return r;
  } catch { return null; }
}
export const runtimeKeys = () => [...runtimes.keys()];
/** Test hook: post a raw message on a widget's port, as if the sandbox had sent it (it cannot do more). */
export function __injectFromSandbox(key: string, msg: unknown) { const rt = runtimes.get(key); if (rt) return onMessage(rt, msg); }
