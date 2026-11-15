// The sandbox's only line to the outside: one MessagePort handed over by the host page.
// Everything here is a request the host may refuse; the host checks every message against its allowlist.
import type { StateStore } from "@json-render/core";
import { createStoreAdapter } from "@json-render/core/store-utils";

let port: MessagePort | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let inflight = 0;
const idle = new Set<() => void>();

export const bridge = {
  get connected() { return !!port; },
  attach(p: MessagePort, onMessage: (m: any) => void) {
    port = p;
    p.onmessage = (e) => {
      const m = e.data;
      if (m && m.t === "res" && typeof m.id === "number") {
        const w = pending.get(m.id);
        if (!w) return;
        clearTimeout(w.timer);
        pending.delete(m.id);
        m.ok ? w.resolve(m.result) : w.reject(new Error(String(m.error ?? "失敗しました")));
        return;
      }
      onMessage(m);
    };
  },
  post(msg: Record<string, unknown>) { port?.postMessage(msg); },
  request<T = unknown>(t: string, payload: Record<string, unknown>): Promise<T> {
    if (!port) return Promise.reject(new Error("ホストにつながっていません"));
    const id = ++seq;
    inflight++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("ホストから8秒以内に応答がありません")); }, 8000);
      pending.set(id, { resolve, reject, timer });
      port!.postMessage({ t, id, ...payload });
    }).finally(() => { if (--inflight === 0) idle.forEach((f) => f()); });
  },
  /** Resolves when no request is waiting for the host (used to report "ready" after the data arrived). */
  whenIdle(): Promise<void> { return inflight === 0 ? Promise.resolve() : new Promise((r) => { const f = () => { idle.delete(f); r(); }; idle.add(f); }); },
};

// ---------- shared state (/scenario/*), mirrored from the host ----------
export type Owner = "agent" | "user" | "widget" | "init";
type Snap = { scenario: Record<string, number> };
let snap: Snap = { scenario: {} };
const owners: Record<string, Owner> = {};
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
let readOnly = false;

export function initState(state: Record<string, { value: number; owner: Owner }>, preview: boolean) {
  readOnly = preview;
  const scenario: Record<string, number> = {};
  for (const [path, v] of Object.entries(state ?? {})) {
    const k = path.replace(/^\/scenario\//, "");
    if (typeof v?.value === "number") scenario[k] = v.value;
    owners[path] = v?.owner ?? "init";
  }
  snap = { scenario };
  notify();
}
export function applyRemote(path: string, value: unknown, owner: Owner) {
  if (!/^\/scenario\/\w+$/.test(path) || typeof value !== "number") return;
  const k = path.slice("/scenario/".length);
  owners[path] = owner;
  if (snap.scenario[k] !== value) snap = { ...snap, scenario: { ...snap.scenario, [k]: value } };
  notify();
}
export const ownerOf = (path: string): Owner => owners[path] ?? "init";
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getSnap = () => snap;

/** Write to the host. The local copy moves at once (so a drag feels direct) and snaps back if the host refuses. */
export function writeShared(path: string, value: unknown): Promise<unknown> {
  if (readOnly) return Promise.reject(new Error("読み取り専用です"));
  const k = path.replace(/^\/scenario\//, "");
  const before = snap.scenario[k];
  if (path.startsWith("/scenario/") && typeof value === "number") { snap = { ...snap, scenario: { ...snap.scenario, [k]: value } }; notify(); }
  return bridge.request<{ value: number; owner: Owner }>("state.set", { path, value }).then(
    (r) => { applyRemote(path, r.value, r.owner); return r; },
    (e) => { if (before !== undefined) { snap = { ...snap, scenario: { ...snap.scenario, [k]: before } }; notify(); } throw e; },
  );
}

/** The json-render store for <Spec>: /scenario/* goes to the host, anything else stays local to the widget. */
export const specStore: StateStore = createStoreAdapter({
  getSnapshot: () => snap as unknown as Record<string, unknown>,
  setSnapshot: (next) => {
    const n = next as unknown as Snap;
    for (const [k, v] of Object.entries(n.scenario ?? {})) if (snap.scenario[k] !== v) writeShared(`/scenario/${k}`, v).catch(() => {});
    const { scenario: _s, ...rest } = n as any;
    snap = { ...rest, scenario: snap.scenario } as Snap;
    notify();
  },
  subscribe,
});
