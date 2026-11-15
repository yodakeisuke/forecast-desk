// The GenUI sandbox runtime (127.0.0.1:5174, loaded with sandbox="allow-scripts", so its origin is opaque).
// It accepts exactly one MessagePort from the host page, compiles the generated TSX, and renders it.
// It has no network (connect-src 'none'), no cookies, no storage, no access to the parent document.
import "./sdk.css";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";
import { transform } from "sucrase";
import { createAgent } from "@ui-sdk/react/agent";
import { HOST_ORIGINS } from "../../security.config.mjs";
import * as SDK from "./sdk/index";
import { PreviewCtx } from "./sdk/components";
import { onDataError } from "./sdk/hooks";
import { applyRemote, bridge, initState } from "./port";

// The UI SDK bridge inside the sandbox: the host's operate_widget reaches the widget's parts through it.
const agent = createAgent({ allow: () => true, timeout: 10_000 });

const HOSTS = new Set(HOST_ORIGINS);
let root: Root | null = null;
let ready = false;
let failed = false;
let readyTimer: ReturnType<typeof setTimeout> | null = null;

addEventListener("message", (e) => {
  if (bridge.connected) return;                                   // one port, once
  if (e.source !== window.parent || !HOSTS.has(e.origin)) return; // only the embedding host page
  const d = e.data as { t?: string; v?: number };
  if (!d || d.t !== "fpa:init" || e.ports.length !== 1) return;
  bridge.attach(e.ports[0], onHost);
});

const post = (m: Record<string, unknown>) => bridge.post(m);
const fail = (phase: "compile" | "render" | "spec" | "runtime", message: string) => {
  failed = true;
  if (readyTimer) clearTimeout(readyTimer);
  post({ t: "error", phase, message: String(message).slice(0, 3900) });
};

// ---------- what the sandbox blocks is reported to the host's security log ----------
const seenViolations = new Set<string>();
document.addEventListener("securitypolicyviolation", (e) => {
  const k = `${e.effectiveDirective}|${e.blockedURI}`;
  if (seenViolations.has(k) || seenViolations.size > 40) return;
  seenViolations.add(k);
  post({ t: "violation", directive: String(e.effectiveDirective).slice(0, 80), blocked: String(e.blockedURI || "inline").slice(0, 300) });
});
// popups are already impossible (no allow-popups); this only makes the attempt visible in the security log
window.open = ((url?: string | URL) => { post({ t: "violation", directive: "sandbox-popups", blocked: String(url ?? "").slice(0, 300) }); return null; }) as typeof window.open;
addEventListener("error", (e) => { fail("runtime", e.message || "実行時エラー"); });
addEventListener("unhandledrejection", (e) => { fail("runtime", String((e.reason as Error)?.message ?? e.reason)); });
onDataError((e) => { fail("runtime", `データの問い合わせが拒否されました: ${e.message}`); });

// ---------- compile ----------
const MODULES: Record<string, unknown> = { react: React, "react/jsx-runtime": JsxRuntime, "@fpa/genui-sdk": SDK };
function compile(code: string): React.ComponentType {
  const js = transform(code, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true, filePath: "widget.tsx" }).code;
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (!Object.hasOwn(MODULES, name)) throw new Error(`"${name}" はimportできません。"@fpa/genui-sdk" と "react" だけです`);
    return MODULES[name];
  };
  // eslint-disable-next-line no-new-func
  new Function("require", "module", "exports", js)(require, module, module.exports);
  const W = (module.exports.default ?? (module.exports as any).Widget) as React.ComponentType | undefined;
  if (typeof W !== "function") throw new Error("default export のウィジェット関数がありません");
  return W;
}

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { fail(err instanceof SDK.SpecError ? "spec" : "render", err.message); }
  render() { return this.state.err ? <div className="crash">{this.state.err.message}</div> : this.props.children; }
}

function components() {
  const snap = agent.snapshot() as any[];
  return snap.filter((c) => c && c.ref).slice(0, 100).map((c) => ({ ref: String(c.ref).slice(0, 40), component: String(c.component).slice(0, 60), label: c.label ? String(c.label).slice(0, 200) : undefined, actions: (c.actions ?? []).slice(0, 20).map((a: unknown) => String(a).slice(0, 40)) }))
    .concat([...document.querySelectorAll("[data-fpa][data-fpa-label]")].slice(0, 40).map((el, i) => ({ ref: `p${i + 1}`, component: `fpa:${el.getAttribute("data-fpa")}`.slice(0, 60), label: el.getAttribute("data-fpa-label")!.slice(0, 200), actions: [] as string[] })))
    .slice(0, 100);
}
const height = () => Math.ceil(document.documentElement.getBoundingClientRect().height);

function render(code: string, preview: boolean) {
  ready = false; failed = false;
  let W: React.ComponentType;
  try { W = compile(code); } catch (e) { fail("compile", (e as Error).message); return; }
  root ??= createRoot(document.getElementById("root")!);
  try {
    root.render(<PreviewCtx.Provider value={preview}><Boundary><W /></Boundary></PreviewCtx.Provider>);
  } catch (e) { fail("render", (e as Error).message); return; }
  // Background/offscreen frames may never receive rAF. Wait for React/data commits on the task queue.
  const t0 = Date.now();
  const check = async () => {
    await bridge.whenIdle();
    await new Promise((r) => setTimeout(r, 30));
    if (failed || document.querySelector(".crash")) return;
    if (document.querySelector(".loading") && Date.now() - t0 < 6000) { readyTimer = setTimeout(check, 60); return; }
    ready = true;
    post({ t: "ready", height: height(), components: components(), issues: SDK.rendered.flatMap((r) => r.issues).slice(0, 50).map((s) => s.slice(0, 500)) });
  };
  readyTimer = setTimeout(check, 30);
}

let lastH = 0;
new ResizeObserver(() => { const h = height(); if (Math.abs(h - lastH) > 2) { lastH = h; post({ t: "ui.resize", height: Math.min(5000, h) }); } }).observe(document.documentElement);

// ---------- export for the report: the spec, and the free slots as a tree of SVG primitives ----------
const TAGS = new Set(["svg", "g", "rect", "line", "path", "circle", "ellipse", "polyline", "polygon", "text", "tspan"]);
const ATTRS = ["x", "y", "x1", "y1", "x2", "y2", "width", "height", "rx", "ry", "cx", "cy", "r", "d", "points", "transform", "viewBox", "opacity", "fill-opacity", "stroke-opacity", "stroke-width", "stroke-dasharray", "text-anchor", "font-size", "font-weight", "dx", "dy"];
type Node = { tag: string; a: Record<string, string>; c?: Node[]; text?: string };
function tree(el: Element, depth = 0, budget = { n: 0 }): Node | null {
  const tag = el.tagName.toLowerCase();
  if (!TAGS.has(tag) || depth > 12 || ++budget.n > 2000) return null;
  const a: Record<string, string> = {};
  for (const k of ATTRS) { const v = el.getAttribute(k); if (v != null && v.length < 4000 && !/url\(|javascript:/i.test(v)) a[k] = v; }
  const cs = getComputedStyle(el);
  if (tag !== "svg" && tag !== "g") { a.fill = cs.fill; a.stroke = cs.stroke; }
  if (tag === "text" || tag === "tspan") { a["font-size"] = a["font-size"] ?? cs.fontSize; a["font-weight"] = a["font-weight"] ?? cs.fontWeight; }
  if (tag === "svg") { const r = el.getBoundingClientRect(); a.width = String(Math.round(r.width)); a.height = String(Math.round(r.height)); }
  const kids = [...el.children].map((c) => tree(c, depth + 1, budget)).filter(Boolean) as Node[];
  const text = tag === "text" || tag === "tspan" ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").slice(0, 300) : undefined;
  return { tag, a, ...(kids.length ? { c: kids } : {}), ...(text ? { text } : {}) };
}
function exportWidget() {
  const r = SDK.rendered[0];
  const slots: Record<string, Node | null> = {};
  for (const name of r?.slots ?? []) {
    // the slot's own drawing, not the small icon in its tag
    const svg = [...document.querySelectorAll(`[data-slot="${CSS.escape(name)}"] svg`)].find((e) => !e.closest(".slot-tag"));
    slots[name] = svg ? tree(svg) : null;
  }
  return { spec: r?.spec ?? null, slots };
}

function locate(name: string) {
  const all = [...document.querySelectorAll("[data-fpa-label], [aria-label], [data-mark]")] as HTMLElement[];
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const n = norm(name);
  const el = all.find((e) => norm(e.getAttribute("data-fpa-label")) === n)
    ?? all.find((e) => norm(e.getAttribute("aria-label")) === n)?.closest("[data-fpa]")
    ?? all.find((e) => norm(e.getAttribute("data-mark")).endsWith(`:${n}`))
    ?? all.find((e) => norm(e.getAttribute("data-fpa-label")).includes(n));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}

async function onHost(m: any) {
  if (!m || typeof m.t !== "string") return;
  const reply = (ok: boolean, result?: unknown, error?: string) => post({ t: "reply", id: m.id, ok, ...(ok ? { result } : { error: String(error).slice(0, 3900) }) });
  switch (m.t) {
    case "render": {
      const th = m.theme ?? {};
      for (const [k, v] of Object.entries(th)) if (/^--[a-z0-9-]{1,30}$/.test(k) && typeof v === "string" && v.length < 80 && !/[;{}<>]|url\(/i.test(v)) document.documentElement.style.setProperty(k, v);
      document.documentElement.classList.toggle("preview", !!m.preview);
      initState(m.state, !!m.preview);
      render(String(m.code ?? ""), !!m.preview);
      break;
    }
    case "state": applyRemote(String(m.path), m.value, m.owner); break;
    case "ping": reply(true, { at: Date.now() }); break;
    case "agent.snapshot": reply(true, agent.snapshot()); break;
    case "agent.act":
      try { reply(true, await agent.act({ steps: Array.isArray(m.steps) ? m.steps.slice(0, 20) : [] })); } catch (e) { reply(false, undefined, (e as Error).message); }
      break;
    case "export": try { reply(true, exportWidget()); } catch (e) { reply(false, undefined, (e as Error).message); } break;
    case "locate": reply(true, locate(String(m.name ?? ""))); break;
  }
}
