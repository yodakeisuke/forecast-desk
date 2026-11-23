// Meeting mode: a question typed by the presenter → a Plan from the fast decision model (Jev through the
// local relay, or かんたんモード) → applied through the same audited tools an agent uses → a layout
// that puts the answering cards first. Every question keeps the screen it produced, so any earlier
// answer is one click away.
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { flushSync } from "react-dom";
import * as cube from "../data/cube";
import { versionLabel, type VersionId } from "../data/model";
import { call, onToolCall } from "../agent/tools";
import { clock, getState, store } from "../state/store";
import { prefersReducedMotion } from "../ui/attention";
import { planFromJev, type JevAnswers } from "./jev";
import { localPlan } from "./local";
import { DEFAULT_ORDER, SLOT_INFO, SLOTS, type KpiKey, type Plan, type Screen, type Slot } from "./plan";

export type Engine = "jev" | "local";
export type Status = "answered" | "handoff" | "investigating" | "resolved" | "unsupported" | "memo";
export type CondKey = "compare" | "region" | "segment" | "product" | "winRate" | "slipBack" | "naBias";
const COND_KEYS: CondKey[] = ["compare", "region", "segment", "product", "winRate", "slipBack", "naBias"];
export type Conditions = { compare: VersionId; region: string | null; segment: string | null; product: string | null; winRate: number; slipBack: number; naBias: number };
export type Entry = {
  id: number; at: string; question: string; plan: Plan; engine: Engine; model: string; ms: number;
  before: Conditions; after: Conditions;
  /** the conditions this question changed, with the value they had before */
  changed: Partial<Record<CondKey, string>>;
  status: Status; notesAt: number; summary?: string; error?: string;
};
type MeetingState = {
  on: boolean;
  phase: "idle" | "thinking";
  pending: string | null;
  entries: Entry[];
  current: number | null;
  expanded: Slot[];
  notice: string | null;
  jev: "unknown" | "ready" | "unavailable";
};

export const meeting = createStore<MeetingState>(() => ({ on: false, phase: "idle", pending: null, entries: [], current: null, expanded: [], notice: null, jev: "unknown" }));
export const useMeeting = <T,>(sel: (s: MeetingState) => T) => useStore(meeting, sel);
const set = meeting.setState, get = meeting.getState;

// ---------- the screen, as the decision model sees it ----------
export function conditions(): Conditions {
  const s = getState();
  return { compare: s.compare, region: s.filters.region ?? null, segment: s.filters.segment ?? null, product: s.filters.product ?? null, winRate: s.scenario.values["/scenario/winRate"], slipBack: s.scenario.values["/scenario/slipBack"], naBias: s.scenario.values["/scenario/naBias"] };
}
async function currentScreen(): Promise<Screen> {
  const s = getState();
  const w = await cube.winRates(s.filters).catch(() => ({ v09: s.scenario.values["/scenario/winRate"], v10: s.scenario.values["/scenario/winRate"] }));
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    compare: s.compare,
    filters: { region: s.filters.region ?? null, segment: s.filters.segment ?? null, product: s.filters.product ?? null },
    scenario: { winRate: s.scenario.values["/scenario/winRate"], slipBack: s.scenario.values["/scenario/slipBack"], naBias: s.scenario.values["/scenario/naBias"] },
    refs: { winRate09: r1(w.v09), winRate10: r1(w.v10) },
  };
}
export function scopeLabel(c: Pick<Conditions, "region" | "segment" | "product" | "compare">) {
  return `${[c.region, c.segment, c.product].filter(Boolean).join(" / ") || "全社"} · ${versionLabel(c.compare)}比`;
}
const condLabel = (k: CondKey, c: Conditions) => k === "compare" ? versionLabel(c.compare) : k === "winRate" || k === "slipBack" || k === "naBias" ? `${c[k]}%` : (c[k] as string | null) ?? "すべて";

// ---------- the decision ----------
const UNAVAILABLE = new Set(["no-key"]);
async function decide(question: string, screen: Screen): Promise<{ plan: Plan; engine: Engine; model: string; notice: string | null }> {
  if (get().jev !== "unavailable") {
    try {
      const res = await fetch("/api/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, screen }), signal: AbortSignal.timeout(5000) });
      const body = await res.json().catch(() => null) as { ok?: boolean; answers?: JevAnswers; model?: string; reason?: string } | null;
      if (res.ok && body?.ok && body.answers) {
        set({ jev: "ready" });
        return { plan: planFromJev(body.answers, question, screen), engine: "jev", model: body.model ?? "jev", notice: null };
      }
      // no relay (static hosting) or no key on this server: stay in かんたんモード for the session
      if (res.status === 404 || UNAVAILABLE.has(body?.reason ?? "")) set({ jev: "unavailable" });
      else return { plan: localPlan(question, screen), engine: "local", model: "かんたんモード", notice: "Jevに届かなかったため、かんたんモードで答えました" };
    } catch {
      return { plan: localPlan(question, screen), engine: "local", model: "かんたんモード", notice: "Jevに届かなかったため、かんたんモードで答えました" };
    }
  }
  return { plan: localPlan(question, screen), engine: "local", model: "かんたんモード", notice: null };
}

// a person in the middle of a click or drag is never moved under the pointer
let pointerDown = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
  document.addEventListener("pointerup", () => { pointerDown = false; }, true);
  document.addEventListener("pointercancel", () => { pointerDown = false; }, true);
}
async function pointerIdle() { const t0 = Date.now(); while (pointerDown && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 50)); }

function transition(fn: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!d.startViewTransition || prefersReducedMotion() || document.hidden) { fn(); return; }
  try { d.startViewTransition(() => flushSync(fn)); } catch { fn(); }
}

/** Apply conditions through the same tools an agent uses (validated, logged, undoable by the person). */
async function applyConditions(want: Partial<Conditions>): Promise<string | null> {
  const now = conditions();
  const filter: Record<string, string> = {};
  if (want.compare && want.compare !== now.compare) filter.compare_from = versionLabel(want.compare);
  for (const d of ["region", "segment", "product"] as const) if (d in want && want[d] !== undefined && want[d] !== now[d]) filter[d] = want[d] ?? "すべて";
  if (Object.keys(filter).length) {
    const r = await call("set_filter", filter, "fast") as { ok?: boolean; error?: string };
    if (r?.ok === false) return r.error ?? "条件を切り替えられませんでした";
  }
  const scen: Record<string, number> = {};
  if (want.winRate !== undefined && want.winRate !== now.winRate) scen.win_rate = want.winRate;
  if (want.slipBack !== undefined && want.slipBack !== now.slipBack) scen.slip_back = want.slipBack;
  if (want.naBias !== undefined && want.naBias !== now.naBias) scen.na_bias = want.naBias;
  if (Object.keys(scen).length) {
    const r = await call("set_scenario", scen, "fast") as { ok?: boolean; error?: string };
    if (r?.ok === false) return r.error ?? "シナリオの前提を変えられませんでした";
  }
  return null;
}

function wantFromPlan(plan: Plan): Partial<Conditions> {
  if (plan.kind === "unsupported") return {};
  const w: Partial<Conditions> = {};
  if (plan.compare) w.compare = plan.compare;
  for (const d of ["region", "segment", "product"] as const) if (plan[d] !== null) w[d] = plan[d] === "all" ? null : plan[d];
  if (plan.winRate !== null) w.winRate = plan.winRate;
  if (plan.slipBack !== null) w.slipBack = plan.slipBack;
  return w;
}

const maxNote = () => Math.max(0, ...getState().notes.map((n) => n.n));

export async function ask(input: string) {
  const question = input.trim().slice(0, 200);
  if (!question || get().phase !== "idle") return;
  set({ phase: "thinking", pending: question, notice: null });
  const t0 = performance.now();
  try {
    const screen = await currentScreen();
    const d = await decide(question, screen);
    // "back to last month's win rate" means the rate of the scope the question moves to, not the one on screen
    if (d.plan.winRateFrom === "previous_month") {
      const want = wantFromPlan(d.plan), now = conditions();
      const pick = (k: "region" | "segment" | "product") => (k in want ? want[k] ?? null : now[k]);
      const target = { region: pick("region"), segment: pick("segment"), product: pick("product") };
      const w = await cube.winRates(target).catch(() => null);
      if (w) d.plan.winRate = Math.round(w.v09 * 10) / 10;
    }
    const ms = Math.round(performance.now() - t0);
    await pointerIdle();
    const before = conditions();
    const error = await applyConditions(wantFromPlan(d.plan));
    const after = conditions();
    const changed: Entry["changed"] = {};
    for (const k of COND_KEYS) if (before[k] !== after[k]) changed[k] = condLabel(k, before);
    const status: Status = d.plan.kind === "handoff" ? "handoff" : d.plan.kind === "unsupported" ? "unsupported" : "answered";
    const entry: Entry = { id: (get().entries.at(-1)?.id ?? 0) + 1, at: clock(), question, plan: d.plan, engine: d.engine, model: d.model, ms, before, after, changed, status, notesAt: maxNote(), error: error ?? undefined };
    transition(() => set((s) => ({ entries: [...s.entries, entry], current: d.plan.kind === "unsupported" ? s.current : entry.id, expanded: d.plan.kind === "unsupported" ? s.expanded : [], phase: "idle", pending: null, notice: error ?? d.notice })));
  } catch (e) {
    set({ phase: "idle", pending: null, notice: `問いを処理できませんでした: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
  }
}

/** Go to the screen an earlier question produced (or, before the first question, the screen we started from). */
export async function showEntry(id: number | null) {
  const s = get();
  if (s.phase !== "idle") return;
  const target = id === null ? s.entries[0]?.before : s.entries.find((e) => e.id === id)?.after;
  if (!target) return;
  set({ phase: "thinking", pending: null });
  const error = await applyConditions(target);
  transition(() => set({ current: id, expanded: [], phase: "idle", notice: error }));
}
export function back() {
  const s = get();
  const shown = s.entries.filter((e) => e.status !== "unsupported" && e.status !== "memo");
  const i = shown.findIndex((e) => e.id === s.current);
  if (i < 0) return;
  return showEntry(i > 0 ? shown[i - 1].id : null);
}
export function setOn(on: boolean) { transition(() => set({ on, expanded: [] })); }
export function expand(slot: Slot) { transition(() => set((s) => ({ expanded: s.expanded.includes(slot) ? s.expanded : [...s.expanded, slot] }))); }
export function handToAgent(id: number) { set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, status: "handoff", notesAt: maxNote() } : e)) })); }
export function keepForLater(id: number) { set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, status: "memo" } : e)) })); }

// ---------- the main agent's side ----------
export function openQuestions() {
  return get().entries.map((e) => ({ id: e.id, at: e.at, question: e.question, status: e.status, screen: scopeLabel(e.after), summary: e.summary ?? null }));
}
export function answerQuestion(id: number, summary: string) {
  const e = get().entries.find((x) => x.id === id);
  if (!e) return { ok: false, error: `問い${id}はありません` };
  set((s) => ({ entries: s.entries.map((x) => (x.id === id ? { ...x, status: "resolved", summary: summary.slice(0, 300) } : x)) }));
  return { ok: true, id };
}
/** notes the agent added while this question was the latest one handed off */
export function notesFor(e: Entry, entries: Entry[]) {
  const next = entries.find((x) => x.id > e.id && (x.status === "handoff" || x.status === "investigating" || x.status === "resolved"));
  return getState().notes.filter((n) => n.who === "agent" && n.n > e.notesAt && (!next || n.n <= next.notesAt)).length;
}

const TOOL_SLOT: Record<string, Slot> = { drill_down: "c-var", drill_up: "c-var", drill_across: "c-var", drill_through: "c-var", set_scenario: "c-scenario" };
const TARGET_SLOT: [RegExp, Slot][] = [[/^(row|stages|slip|deals|deal):/, "c-var"], [/^bridge:/, "c-bridge"], [/^heat:/, "c-heat"], [/^driver:/, "c-drv"], [/^card:trend/, "c-trend"], [/^card:q/, "c-q"], [/^card:drv/, "c-drv"], [/^card:scenario/, "c-scenario"], [/^card:var/, "c-var"], [/^card:bridge/, "c-bridge"], [/^card:heat/, "c-heat"]];
const READ_ONLY = new Set(["get_meeting_questions", "answer_meeting_question"]);
onToolCall((channel, tool, input) => {
  const s = get();
  if (!s.on) return;
  // the main agent picked up a handed-off question (reading the list is not yet working on it)
  const open = channel === "fast" || READ_ONLY.has(tool) ? undefined : [...s.entries].reverse().find((e) => e.status === "handoff");
  if (open) set((x) => ({ entries: x.entries.map((e) => (e.id === open.id ? { ...e, status: "investigating" } : e)) }));
  // a folded card a tool is about to work on opens first and at once (no animation), so the tool always finds it
  const target = typeof input.target === "string" ? TARGET_SLOT.find(([re]) => re.test(input.target as string))?.[1] : undefined;
  const slot = TOOL_SLOT[tool] ?? target;
  if (slot && layoutOf(get())?.folded.includes(slot)) flushSync(() => set((x) => ({ expanded: [...x.expanded, slot] })));
});

// ---------- marks on the conditions ----------
export type Marks = { changed: Partial<Record<CondKey, string>>; carried: CondKey[] };
/** what the current question changed (amber, with the old value) and what it kept from an earlier question */
export function marksOf(s: MeetingState): Marks {
  const e = s.on && s.current !== null ? s.entries.find((x) => x.id === s.current) : undefined;
  if (!e) return { changed: {}, carried: [] };
  const start = s.entries[0].before, now = conditions();
  const carried = COND_KEYS.filter((k) => !(k in e.changed) && now[k] !== start[k] && s.entries.some((x) => x.id < e.id && k in x.changed));
  const changed = Object.fromEntries(Object.entries(e.changed).filter(([k]) => now[k as CondKey] === e.after[k as CondKey]));
  return { changed, carried };
}
export function useMarks(): Marks {
  const json = useMeeting((s) => JSON.stringify(marksOf(s)));
  return JSON.parse(json) as Marks;
}

// ---------- layout ----------
export type Layout = { focus: Slot[]; shown: Slot[]; folded: Slot[]; kpi: KpiKey; why: Partial<Record<Slot, string>> };
export function layoutOf(s: MeetingState): Layout | null {
  if (!s.on || s.current === null) return null;
  const e = s.entries.find((x) => x.id === s.current);
  if (!e) return null;
  const focus = e.plan.focus.filter((x) => (SLOTS as readonly string[]).includes(x));
  const rest = DEFAULT_ORDER.filter((x) => !focus.includes(x));
  return {
    focus, shown: rest.filter((x) => s.expanded.includes(x)), folded: rest.filter((x) => !s.expanded.includes(x)),
    kpi: e.plan.kpi, why: Object.fromEntries(focus.map((x) => [x, SLOT_INFO[x].why])),
  };
}
let lastLayout: Layout | null = null, lastKey = "";
export function useLayout() {
  return useMeeting((s) => {
    const key = `${s.on}|${s.current}|${s.expanded.join(",")}|${s.entries.length}`;
    if (key !== lastKey) { lastKey = key; lastLayout = layoutOf(s); }
    return lastLayout;
  });
}

// the demo/reset path clears the analysis; meeting answers go with it
store.subscribe((s, prev) => { if (s.activity.length === 0 && prev.activity.length > 0 && !s.notes.length) set({ entries: [], current: null, expanded: [], notice: null }); });

Object.assign(globalThis, { __fpaMeeting: { state: () => get(), ask, back } });
