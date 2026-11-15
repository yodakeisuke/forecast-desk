// Custom UI SDK primitives. Their `agent` key is what lets an agent drill and annotate through act(),
// on the same api a person's click uses.
import { createChange, definePrimitive } from "@ui-sdk/core";
import { REGIONS, SEGMENTS, PRODUCTS, type Dim } from "../data/model";
import { decodeView, encodeView, type View, type Tab } from "../state/store";

type ChangeDetails = { source?: string; reason?: string; cancel?: () => void; [k: string]: unknown };

// ---------- VarianceTable: the four drills live here ----------
type VarianceOptions = { value?: string; defaultValue?: string; onValueChange?: (value: string, details: ChangeDetails) => void };

const DIM_ALIASES: Record<string, Dim> = { region: "region", 地域: "region", segment: "segment", セグメント: "segment", product: "product", 製品: "product" };
const TAB_ALIASES: Record<string, Tab> = { variance: "variance", 売上差異: "variance", 差異: "variance", pipeline: "pipeline", パイプライン: "pipeline", drivers: "drivers", ドライバー: "drivers", 主要ドライバー: "drivers" };
const TOP = new Set(["", "売上", "合計", "売上合計", "全体", "total", "all"]);

function dims(by: unknown): Dim[] | null {
  if (by == null) return null;
  const list = (Array.isArray(by) ? by : String(by).split(/[,>、\s]+/)).map((x) => DIM_ALIASES[String(x).trim()]).filter(Boolean);
  if (!list.length) throw new Error(`by は ${Object.keys(DIM_ALIASES).join(" / ")} から選んでください`);
  return [...new Set(list)].slice(0, 2) as Dim[];
}
const memberOf = (dim: Dim) => (dim === "region" ? REGIONS : dim === "segment" ? SEGMENTS : PRODUCTS) as readonly string[];
/** "北米", "北米/Enterprise", "売上" → path parts, validated against the current hierarchy. */
function path(member: unknown, by: Dim[]): string[] {
  const s = String(member ?? "").trim();
  if (TOP.has(s)) return [];
  const parts = s.split(/[/／›>]/).map((x) => x.trim()).filter(Boolean);
  parts.forEach((p, i) => {
    const d = by[i];
    if (!d || !memberOf(d).includes(p)) throw new Error(`「${p}」は${i === 0 ? "1" : "2"}階層目（${d ?? "なし"}）にありません。選べるもの: ${d ? memberOf(d).join("、") : "—"}`);
  });
  return parts;
}
export function contextOf(parts: string[], by: Dim[]) {
  const c: Record<string, string> = {};
  parts.forEach((p, i) => { c[by[i]] = p; });
  return c;
}

export const varianceTable = definePrimitive({
  name: "variance-table",
  options: { value: "string", defaultValue: "string", onValueChange: "callback" },
  controlled: ["value"],
  state: (o: VarianceOptions) => ({ value: o.value ?? o.defaultValue ?? encodeView({ tab: "variance", by: ["region", "segment"], open: [], focus: null, context: {}, detail: null }) }),
  sync: (o) => (o.value === undefined ? {} : { value: o.value }),
  api: (context) => {
    const change = createChange(context);
    const cur = () => decodeView(context.store.get().value);
    const commit = (v: View, reason: string, event?: Event, extra: Record<string, unknown> = {}) => change("value", encodeView(v), { reason, event, ...extra } as any);
    return {
      setValue: (value: string, event?: Event) => commit(decodeView(value), "set", event),
      toggleMember: (member: string, event?: Event) => {
        const v = cur(); path(member, [v.by[0]]);
        const open = v.open.includes(member) ? v.open.filter(x => x !== member) : [...v.open, member];
        return commit({ ...v, open, focus: null, detail: null }, "toggle-member", event);
      },
      /** Open a member and/or change the hierarchy. drillDown("北米/Enterprise") or drillDown("売上", ["region", "segment"]). */
      drillDown: (member?: string, by?: string[] | string, event?: Event) => {
        const v = cur();
        let next = dims(by) ?? v.by;
        const s = String(member ?? "").trim();
        // drillDown("北米", "product") means: under 北米, split by product
        if (by != null && next.length === 1 && !TOP.has(s) && REGIONS.includes(s as never) && next[0] !== "region") next = ["region", next[0]];
        const parts = path(member, next);
        const open = parts.length ? [...new Set([...(by != null ? [] : v.open), parts[0]])] : by != null ? [] : v.open;
        const focus = parts.length > 1 ? parts.join("/") : parts.length === 1 && next.length === 1 ? parts[0] : null;
        return commit({ ...v, tab: "variance", by: next, open, focus, detail: null }, "drill-down", event, { member: s, by: next });
      },
      drillUp: (levels: number | string = 1, event?: Event) => {
        let v = cur();
        const n = Math.max(1, Math.min(5, Number(levels) || 1));
        for (let i = 0; i < n; i++) {
          if (v.detail) v = { ...v, detail: null };
          else if (v.tab !== "variance") v = { ...v, tab: "variance", context: {} };
          else if (v.focus) v = { ...v, focus: null };
          else if (v.open.length) v = { ...v, open: [] };
          else if (v.by.length > 1) v = { ...v, by: [v.by[0]] };
        }
        return commit(v, "drill-up", event, { levels: n });
      },
      /** Keep the current slice and look at it from another view: pipeline or drivers. */
      drillAcross: (to: string, keep?: Record<string, string> | string, event?: Event) => {
        const v = cur();
        const tab = TAB_ALIASES[String(to ?? "").trim()];
        if (!tab) throw new Error(`to は ${Object.keys(TAB_ALIASES).join(" / ")} のどれか`);
        let ctx: Record<string, string> = {};
        if (keep && typeof keep === "object") {
          for (const [k, x] of Object.entries(keep)) { const d = DIM_ALIASES[k]; if (d && memberOf(d).includes(String(x))) ctx[d] = String(x); }
        } else if (typeof keep === "string" && keep.trim()) ctx = contextOf(path(keep, v.by), v.by);
        else if (v.focus) ctx = contextOf(v.focus.split("/"), v.by);
        else if (v.open.length === 1) ctx = contextOf([v.open[0]], v.by);
        return commit({ ...v, tab, context: tab === "variance" ? {} : ctx, detail: null }, "drill-across", event, { to: tab, keep: ctx });
      },
      /** Open the rows behind a number: the deals that make up a pipeline slice. */
      drillThrough: (member?: string, event?: Event) => {
        const v = cur();
        let ctx = v.context;
        if (member && String(member).trim()) {
          const parts = String(member).split(/[/／›>]/).map((x) => x.trim()).filter(Boolean);
          ctx = {};
          for (const p of parts) for (const d of ["region", "segment", "product"] as Dim[]) if (memberOf(d).includes(p)) (ctx as any)[d] = p;
          if (!Object.keys(ctx).length) throw new Error(`「${member}」から明細を開けません。例: "北米/Enterprise"`);
        } else if (!Object.keys(ctx).length && v.focus) ctx = contextOf(v.focus.split("/"), v.by);
        const label = Object.values(ctx).filter(Boolean).join("/") || "全体";
        return commit({ ...v, tab: v.tab === "variance" ? "pipeline" : v.tab, context: ctx, detail: label }, "drill-through", event, { member: label });
      },
    };
  },
  slots: (slot) => ({
    root: slot({ role: "group" }),
  }),
  agent: { actions: ["drillDown", "drillUp", "drillAcross", "drillThrough", "toggleMember", "setValue"] },
});

// ---------- Annotations: the layer where an agent points at something ----------
type AnnotationOptions = {
  value?: string;
  onValueChange?: (value: string, details: ChangeDetails) => void;
  onHighlight?: (target: string, note: string) => { n: number; value: string } | null;
  onDismiss?: (n?: number) => void;
};
export const annotations = definePrimitive({
  name: "annotations",
  options: { value: "string", onValueChange: "callback", onHighlight: "action", onDismiss: "action" },
  controlled: ["value"],
  state: (o: AnnotationOptions) => ({ value: o.value ?? "[]" }),
  sync: (o) => (o.value === undefined ? {} : { value: o.value }),
  api: (context) => {
    const change = createChange(context);
    return {
      /** Ring an element and show a note next to it. target: "row:北米/Enterprise", "bridge:売上", "heat:北米/Enterprise" … */
      highlight: (target: string, note: string) => {
        const { onHighlight } = context.options();
        if (!target || !note) throw new Error("target と note が必要です");
        const result = onHighlight?.(String(target), String(note).slice(0, 600));
        if (!result) throw new Error(`「${target}」は画面にありません`);
        change("value", result.value, { reason: "highlight", target } as any);
        return result.n;
      },
      setValue: (value: string) => change("value", value, { reason: "restore" }),
      dismiss: (n?: number) => { context.options().onDismiss?.(n); },
    };
  },
  slots: (slot) => ({ root: slot({ role: "group" }) }),
  agent: { actions: ["highlight", "dismiss", "setValue"] },
});
