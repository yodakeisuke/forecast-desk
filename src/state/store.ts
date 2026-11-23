// The analysis context: the single source of truth for what is on screen. Every change goes through a
// named action. UI SDK components are controlled by this store, so a person's click, an agent's act()
// step and a tool call all end up in the same place.
import { z } from "zod";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Block } from "../report/figures";
import { REGIONS, SEGMENTS, PRODUCTS, type Dim, type VersionId } from "../data/model";

export type Who = "agent" | "user" | "widget" | "init";
export type Channel = "webmcp" | "js" | "demo" | "fast";
export type Filters = { region?: string | null; segment?: string | null; product?: string | null };
export type Tab = "variance" | "pipeline" | "drivers";
export type View = { tab: Tab; by: Dim[]; open: string[]; focus: string | null; context: Filters; detail: string | null };
export type Note = { n: number; target: string; text: string; page: Page; open: boolean; at: string; who: Who; agent: string; inReport: boolean; context: { compare: VersionId; filters: Filters; view: View } };
export type WidgetStatus = "loading" | "ready" | "error" | "destroyed";
export type Widget = {
  id: string; title: string; subtitle?: string; code: string; revision?: number; status: WidgetStatus; error?: string; height: number;
  pendingChange?: { id: string; label: string } | null;
  at: string; agent: string; born: boolean; dataReads: number; showCode: boolean; suggestion?: { label: string; tool: string; args: Record<string, unknown> } | null;
};
export type ActItem = { id: number; who: Who; tool?: string; args?: string; result?: string; running: boolean; ms?: number; at: string; open?: boolean; failed?: boolean };
export type ActGroup = { id: number; title: string; src: string; at: string; items: ActItem[]; last: number; agent?: string };
export type Page = "overview" | "report" | "security" | "settings";
export type Scenario = { values: Record<string, number>; owner: Record<string, Who>; log: { path: string; value: number; source: Who; at: number }[] };
export type ReportSpec = { root: string; elements: Record<string, { type: string; props: Record<string, unknown>; children?: string[] }> };

export const SCENARIO_DEFAULTS: Record<string, number> = { "/scenario/winRate": 22, "/scenario/slipBack": 0, "/scenario/naBias": 0 };

export type AppState = {
  page: Page;
  version: VersionId;
  compare: VersionId;
  filters: Filters;
  view: View;
  notes: Note[];
  widgets: Widget[];
  scenario: Scenario;
  report: { spec: ReportSpec; title: string; at: string; materials: number; blocks: Record<string, Block[]>; widgets: Widget[]; scenario: Scenario } | null;
  activity: ActGroup[];
  toolCounts: Record<string, number>;
  lastTool: string | null;
  busy: { tool: string; target: string | null; agent: string } | null;
  byAgent: Record<string, boolean>;
  railTab: "log" | "tools";
  rail: boolean;
  tip: { x: number; y: number; title: string; rows: { tone?: string; value: string; label: string; bad?: boolean }[] } | null;
  toast: string | null;
  confirm: { text: string; resolve: (ok: boolean) => void } | null;
  playing: boolean;
};

const initial = (): AppState => ({
  page: "overview",
  version: "v10",
  compare: "budget",
  filters: {},
  view: { tab: "variance", by: ["region", "segment"], open: [], focus: null, context: {}, detail: null },
  notes: [],
  widgets: [],
  scenario: { values: { ...SCENARIO_DEFAULTS }, owner: {}, log: [] },
  report: null,
  activity: [],
  toolCounts: {},
  lastTool: null,
  busy: null,
  byAgent: {},
  railTab: "log",
  rail: false,
  tip: null,
  toast: null,
  confirm: null,
  playing: false,
});

export const store = createStore<AppState>(() => initial());
export const useApp = <T,>(sel: (s: AppState) => T) => useStore(store, sel);
const set = store.setState;
const get = store.getState;

export const clock = () => new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

// ---------- view encoding: the variance table's value, readable by an agent in snapshot() ----------
export function encodeView(v: View): string {
  const parts = [`tab=${v.tab}`, `by=${v.by.join(">")}`];
  if (v.open.length) parts.push(`open=${v.open.join(",")}`);
  if (v.focus) parts.push(`focus=${v.focus}`);
  const c = Object.entries(v.context).filter(([, x]) => x).map(([k, x]) => `${k}:${x}`);
  if (c.length) parts.push(`context=${c.join(",")}`);
  if (v.detail) parts.push(`detail=${v.detail}`);
  return parts.join("; ");
}
export function decodeView(s: string): View {
  const v: View = { tab: "variance", by: ["region", "segment"], open: [], focus: null, context: {}, detail: null };
  for (const part of String(s).split(";")) {
    const [k, ...rest] = part.split("=");
    const val = rest.join("=").trim();
    switch (k.trim()) {
      case "tab": if (val === "variance" || val === "pipeline" || val === "drivers") v.tab = val; break;
      case "by": {
        const by = val.split(">").map((x) => x.trim());
        if (!by.length || by.length > 2 || new Set(by).size !== by.length || by.some((d) => !["region", "segment", "product"].includes(d))) throw new Error("階層はregion / segment / productから1〜2個です");
        v.by = by as Dim[]; break;
      }
      case "open": v.open = val.split(",").map((x) => x.trim()).filter(Boolean); break;
      case "focus": v.focus = val || null; break;
      case "detail": v.detail = val || null; break;
      case "context": for (const kv of val.split(",")) { const [a, b] = kv.split(":"); if (a && b && ["region", "segment", "product"].includes(a.trim())) (v.context as any)[a.trim()] = b.trim(); } break;
    }
  }
  for (const [key, value] of Object.entries(v.context)) {
    const choices: Record<string, readonly string[]> = { region: REGIONS, segment: SEGMENTS, product: PRODUCTS };
    if (!choices[key]?.includes(String(value))) throw new Error(`不正な絞り込み: ${key}`);
  }
  return v;
}

const noteSchema = z.object({
  n: z.number().int().positive(), target: z.string().max(200), text: z.string().max(600),
  page: z.enum(["overview", "report", "security", "settings"]), open: z.boolean(), at: z.string().max(40),
  who: z.enum(["agent", "user", "widget", "init"]), agent: z.string().max(100), inReport: z.boolean(),
  context: z.object({ compare: z.enum(["budget", "v04", "v05", "v06", "v07", "v08", "v09", "v10"]),
    filters: z.object({ region: z.enum(REGIONS).nullish(), segment: z.enum(SEGMENTS).nullish(), product: z.enum(PRODUCTS).nullish() }),
    view: z.object({ tab: z.enum(["variance", "pipeline", "drivers"]), by: z.array(z.enum(["region", "segment", "product"])).min(1).max(2), open: z.array(z.string()), focus: z.string().nullable(), context: z.object({ region: z.enum(REGIONS).nullish(), segment: z.enum(SEGMENTS).nullish(), product: z.enum(PRODUCTS).nullish() }), detail: z.string().nullable() }),
  }),
});

// ---------- named actions ----------
export const actions = {
  reset() { get().confirm?.resolve(false); const keep = { rail: get().rail }; set({ ...initial(), ...keep }, true); },
  setPage(page: Page) { set({ page }); },
  setCompare(compare: VersionId, who: Who) { set((s) => ({ compare, byAgent: { ...s.byAgent, compare: who === "agent" } })); },
  setFilter(key: keyof Filters, value: string | null, who: Who) { set((s) => ({ filters: { ...s.filters, [key]: value || null }, view: { ...s.view, context: {}, open: [], focus: null, detail: null }, byAgent: { ...s.byAgent, [key]: who === "agent" } })); },
  setView(view: View) { set({ view }); },
  // notes
  restoreNotes(value: string) { if (value.length > 200000) throw new Error("注記が大きすぎます"); const notes = z.array(noteSchema).max(100).parse(JSON.parse(value)); set({ notes }); },
  addNote(target: string, text: string, who: Who, agent: string) {
    const n = Math.max(0, ...get().notes.map(x => x.n)) + 1;
    set((s) => ({ notes: [...s.notes.map((x) => ({ ...x, open: false })), { n, target, text, page: s.page, open: true, at: clock(), who, agent, inReport: true, context: structuredClone({ compare: s.compare, filters: s.filters, view: s.view }) }] }));
    return n;
  },
  restoreNote(n: number) {
    const note = get().notes.find((x) => x.n === n);
    if (note) set({ page: note.page, ...structuredClone(note.context) });
  },
  toggleNote(n: number, open?: boolean) { set((s) => ({ notes: s.notes.map((x) => (x.n === n ? { ...x, open: open ?? !x.open } : open ? { ...x, open: false } : x)) })); },
  closeNotes() { set((s) => ({ notes: s.notes.map((x) => ({ ...x, open: false })) })); },
  setNoteInReport(n: number, inReport: boolean) { set((s) => ({ notes: s.notes.map((x) => (x.n === n ? { ...x, inReport } : x)) })); },
  // widgets
  addWidget(w: Widget) { set((s) => ({ widgets: [...s.widgets, w] })); },
  patchWidget(id: string, p: Partial<Widget>) { set((s) => ({ widgets: s.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) })); },
  removeWidget(id: string) { set((s) => ({ widgets: s.widgets.filter((w) => w.id !== id) })); },
  // shared scenario state (/scenario/* only)
  setScenario(path: string, value: number, source: Who) {
    set((s) => ({ scenario: { values: { ...s.scenario.values, [path]: value }, owner: { ...s.scenario.owner, [path]: source }, log: [...s.scenario.log, { path, value, source, at: Date.now() }] } }));
  },
  undoScenario(source: Who) {
    const s = get().scenario;
    const values = { ...s.values }, owner = { ...s.owner };
    const changed: string[] = [];
    for (const path of Object.keys(values)) {
      if (owner[path] !== source) continue;
      const prev = [...s.log].reverse().find((e) => e.path === path && e.source !== source);
      values[path] = prev ? prev.value : SCENARIO_DEFAULTS[path] ?? 0;
      owner[path] = prev ? prev.source : "init";
      changed.push(path);
    }
    set({ scenario: { values, owner, log: [...s.log, ...changed.map((p) => ({ path: p, value: values[p], source: owner[p], at: Date.now() }))] } });
    return changed;
  },
  setReport(r: AppState["report"]) { set({ report: r }); },
  // activity rail
  beginGroup(title: string, src: string, agent?: string) {
    const g: ActGroup = { id: Date.now() + Math.random(), title, src, at: clock(), items: [], last: Date.now(), agent };
    set((s) => ({ activity: [...s.activity, g] }));
    return g.id;
  },
  pushItem(item: Omit<ActItem, "id" | "at">, group?: { title: string; src: string; agent?: string }) {
    const s = get();
    let groups = s.activity;
    const last = groups[groups.length - 1];
    const now = Date.now();
    const fits = last && (group ? last.src === group.src && now - last.last < 45000 : now - last.last < 45000);
    if (!fits || (item.who === "user" && last?.src !== "あなた" && now - (last?.last ?? 0) > 45000)) {
      const g = group ?? (item.who === "user" ? { title: "ダッシュボードを直接操作", src: "あなた" } : item.who === "widget" ? { title: "生成UIからの変更", src: "生成UI" } : { title: "エージェントの操作", src: "WebMCP" });
      groups = [...groups, { id: now + Math.random(), title: g.title, src: g.src, at: clock(), items: [], last: now, agent: (g as any).agent }];
    }
    const id = now + Math.random();
    const it: ActItem = { ...item, id, at: clock() };
    const lg = groups[groups.length - 1];
    groups = [...groups.slice(0, -1), { ...lg, items: [...lg.items, it], last: now }];
    set({ activity: groups });
    return id;
  },
  patchItem(id: number, p: Partial<ActItem>) {
    set((s) => ({ activity: s.activity.map((g) => (g.items.some((i) => i.id === id) ? { ...g, last: Date.now(), items: g.items.map((i) => (i.id === id ? { ...i, ...p } : i)) } : g)) }));
  },
  countTool(name: string) { set((s) => ({ toolCounts: { ...s.toolCounts, [name]: (s.toolCounts[name] ?? 0) + 1 }, lastTool: name })); },
  setBusy(b: AppState["busy"]) { set({ busy: b }); },
  // chrome
  setTip(tip: AppState["tip"]) { set({ tip }); },
  toast(msg: string) {
    set({ toast: msg });
    clearTimeout((actions as any)._t);
    (actions as any)._t = setTimeout(() => set({ toast: null }), 2600);
  },
  askConfirm(text: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    get().confirm?.resolve(false);
    return new Promise((resolve) => {
      let finished = false;
      const abort = () => done(false);
      const done = (ok: boolean) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", abort);
        set({ confirm: null }); resolve(ok);
      };
      set({ confirm: { text, resolve: done } });
      signal?.addEventListener("abort", abort, { once: true });
    });
  },
  setRailTab(railTab: AppState["railTab"]) { set({ railTab }); },
  setRail(rail: boolean) { set({ rail }); },
  toggleRail() { set((s) => ({ rail: !s.rail })); },
  setPlaying(playing: boolean) { set({ playing }); },
};

export const getState = get;
