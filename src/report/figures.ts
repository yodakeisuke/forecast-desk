// Figures: a report spec holds where a figure comes from (a source), never the drawing. This module turns a
// source into blocks (chart geometry, tables, text) that both the screen and the PDF draw the same way.
// A generated widget is exported from its sandbox as its json-render spec plus its free slots as SVG trees;
// both are untrusted, so they are checked here before anything is drawn from them.
import { z } from "zod";
import * as cube from "../data/cube";
import { LAST_ACTUAL, MONTHS, versionByLabel, versionLabel, type VersionId } from "../data/model";
import { accuracyChart, bridgeChart, heatChart, quarterChart, scenarioChart, sg, trendChart, type Chart } from "../shared/charts";
import { fpaCatalog } from "../shared/fpa-catalog";
import { exportWidget } from "../genui/host";
import { getState } from "../state/store";
import type { FigureSourceT } from "./catalog";

export type SvgNode = { tag: string; a: Record<string, string>; c?: SvgNode[]; text?: string };
export type Block =
  | { t: "chart"; chart: Chart }
  | { t: "table"; head: string[]; rows: string[][]; tot?: number; align?: ("l" | "r")[] }
  | { t: "kv"; items: { label: string; value: string; note?: string }[] }
  | { t: "text"; text: string; tone?: string }
  | { t: "svg"; node: SvgNode; caption?: string };

const md = (s: string) => { const [, a, b] = String(s).split("-"); return `${+a}/${+b}`; };
const V = (s: string): VersionId => (versionByLabel(s) ?? (s as VersionId));

// ---------- the free slots: only plain SVG primitives with plain values survive ----------
const TAGS = ["svg", "g", "rect", "line", "path", "circle", "ellipse", "polyline", "polygon", "text", "tspan"] as const;
const NUMERIC = /^-?[\d.]+(e-?\d+)?(px|%)?$/i;
const COLOR = /^(none|transparent|currentcolor|#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i;
const ATTR_RULES: Record<string, RegExp> = {
  x: NUMERIC, y: NUMERIC, x1: NUMERIC, y1: NUMERIC, x2: NUMERIC, y2: NUMERIC, width: NUMERIC, height: NUMERIC, rx: NUMERIC, ry: NUMERIC, cx: NUMERIC, cy: NUMERIC, r: NUMERIC,
  dx: NUMERIC, dy: NUMERIC, opacity: NUMERIC, "fill-opacity": NUMERIC, "stroke-opacity": NUMERIC, "stroke-width": NUMERIC, "font-size": NUMERIC,
  "font-weight": /^(normal|bold|[1-9]00)$/, "text-anchor": /^(start|middle|end)$/, "stroke-dasharray": /^[\d.\s,]+$|^none$/,
  d: /^[MmLlHhVvCcSsQqTtAaZz\d\s.,eE-]{1,8000}$/, points: /^[\d\s.,eE-]{1,8000}$/, transform: /^((translate|scale|rotate)\([\d\s.,eE-]+\)\s*){1,4}$/, viewBox: /^[\d\s.,-]+$/,
  fill: COLOR, stroke: COLOR,
};
const SvgNodeSchema: z.ZodType<SvgNode> = z.lazy(() => z.object({
  tag: z.enum(TAGS),
  a: z.record(z.string(), z.string().max(8000)),
  c: z.array(SvgNodeSchema).max(800).optional(),
  text: z.string().max(300).optional(),
}).strict());
function cleanSvg(raw: unknown): SvgNode | null {
  const stack: { node: unknown; depth: number }[] = [{ node: raw, depth: 0 }];
  let budget = 3000;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (--budget < 0 || depth > 20 || !node || typeof node !== "object") return null;
    const children = (node as { c?: unknown }).c;
    if (children !== undefined && !Array.isArray(children)) return null;
    if (Array.isArray(children)) for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }
  const p = SvgNodeSchema.safeParse(raw);
  if (!p.success || p.data.tag !== "svg") return null;
  let count = 0;
  const walk = (n: SvgNode): SvgNode | null => {
    if (++count > 3000) return null;
    const a: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.a)) { const rule = ATTR_RULES[k]; if (rule && rule.test(v.trim())) a[k] = v.trim(); }
    return { tag: n.tag, a, ...(n.c ? { c: n.c.map(walk).filter(Boolean) as SvgNode[] } : {}), ...(n.text ? { text: n.text } : {}) };
  };
  return walk(p.data);
}

// ---------- fixed sources ----------
export async function figureBlocks(src: FigureSourceT, w: number): Promise<Block[]> {
  switch (src.kind) {
    case "bridge": {
      const d = await cube.bridge(V(src.from), V(src.to), src.filters ?? {});
      return [{ t: "chart", chart: bridgeChart({ fromLabel: versionLabel(src.from), toLabel: versionLabel(src.to), from: d.from, to: d.to, steps: d.steps, w, h: 240 }) }];
    }
    case "heat": return [{ t: "chart", chart: heatChart({ rows: await cube.heat("v10", V(src.compare), src.filters ?? {}), w, h: 200 }) }];
    case "trend": {
      const d = await cube.trend("v10", V(src.compare), src.filters ?? {});
      return [{ t: "chart", chart: trendChart({ months: [...MONTHS], cur: d.cur, cmp: d.cmp, lastActual: LAST_ACTUAL, curLabel: "10月版", cmpLabel: versionLabel(src.compare), w, h: 220 }) }];
    }
    case "quarter": {
      const d = await cube.quarterlyNewArr("v10", V(src.compare), src.filters ?? {});
      return [{ t: "chart", chart: quarterChart({ cur: d.cur, cmp: d.cmp, curLabel: "10月版", cmpLabel: versionLabel(src.compare), actualQuarters: 2, w }) }];
    }
    case "accuracy": {
      const d = await cube.forecastAccuracy(src.versions);
      return [{ t: "chart", chart: accuracyChart({ versions: d.versions, series: d.series.map((s) => ({ name: s.region, values: s.values })), w, emphasize: "北米" }) }];
    }
    case "slipped": {
      const deals = await cube.slippedDeals({ region: src.region, segment: src.segment, product: src.product });
      return [{ t: "table", head: ["案件", "ARR", "クローズ予定日", "理由"], align: ["l", "r", "l", "l"], rows: deals.map((d) => [String(d.company), Number(d.arr).toFixed(1), `${md(String(d.close_from))} → ${md(String(d.close_to))}`, String(d.slip_reason ?? "")]) }];
    }
    case "scenario": {
      const pl = await cube.scenarioPL({ slipBack: src.slipBack, winRate: src.winRate, naBias: src.naBias, filters: src.filters });
      const op10 = pl.refs[0].value;
      return [{ t: "table", head: ["ケース", "通期営業利益", "10月版比", "前提"], align: ["l", "r", "r", "l"], tot: 1, rows: pl.cases.map((c) => [c.name, c.value.toFixed(1), sg(c.value - op10), c.note]) }];
    }
    case "widget": return widgetBlocks(src.widget, w);
  }
}

// ---------- a generated widget, from its exported spec ----------
async function widgetBlocks(wid: string, w: number): Promise<Block[]> {
  let exp: { spec: unknown; slots: Record<string, unknown> };
  try { exp = await exportWidget(wid) as any; } catch (e) { throw new Error(`ウィジェット ${wid} を書き出せませんでした: ${(e as Error).message}`); }
  const rawSpec = exp?.spec as any;
  if (rawSpec?.elements) for (const e of Object.values(rawSpec.elements) as any[]) if (e && typeof e === "object" && !Array.isArray(e.children)) e.children = [];
  const check = fpaCatalog.validate(rawSpec);
  if (!check.success) throw new Error(`ウィジェット ${wid} のspecがカタログに合いません。修正してから報告書を作成してください`);
  const spec = exp.spec as { root: string; elements: Record<string, { type: string; props: Record<string, any>; children?: string[] }> };
  const sv = getState().scenario.values;
  const val = (x: any) => (x && typeof x === "object" && ("$bindState" in x || "$state" in x) ? sv[String(x.$bindState ?? x.$state)] : x);
  const out: Block[] = [];
  const seen = new Set<string>();
  const visit = async (key: string, depth: number) => {
    const el = spec.elements[key];
    if (!el || seen.has(key) || depth > 20) return;
    seen.add(key);
    const p = el.props ?? {};
    switch (el.type) {
      case "AccuracyTrend": { const d = await cube.forecastAccuracy(p.versions ?? 6); out.push({ t: "chart", chart: accuracyChart({ versions: d.versions, series: d.series.map((s) => ({ name: s.region, values: s.values })), w, emphasize: p.emphasize ?? undefined }) }); break; }
      case "BridgeChart": { const d = await cube.bridge(V(p.from), V(p.to), { region: p.region, segment: p.segment, product: p.product }); out.push({ t: "chart", chart: bridgeChart({ fromLabel: p.from, toLabel: p.to, from: d.from, to: d.to, steps: d.steps, w, h: 220 }) }); break; }
      case "TrendChart": { const d = await cube.trend("v10", V(p.compare), { region: p.region, segment: p.segment, product: p.product }); out.push({ t: "chart", chart: trendChart({ months: [...MONTHS], cur: d.cur, cmp: d.cmp, lastActual: LAST_ACTUAL, curLabel: "10月版", cmpLabel: p.compare, w, h: 200 }) }); break; }
      case "ScenarioCompare": { const pl = await cube.scenarioPL({ slipBack: Number(val(p.slipBack)) || 0, winRate: Number(val(p.winRate)) || 0, naBias: Number(val(p.naBias)) || 0, filters: { region: p.region, segment: p.segment, product: p.product } }); out.push({ t: "chart", chart: scenarioChart({ cases: pl.cases, refs: pl.refs, w, h: 150 }) }); break; }
      case "DriverSlider": {
        const last = out[out.length - 1];
        const item = { label: String(p.label), value: `${val(p.value)}${p.unit ?? ""}`, note: p.hint ?? undefined };
        if (last?.t === "kv") last.items.push(item); else out.push({ t: "kv", items: [item] });
        break;
      }
      case "KpiTile": {
        const k = (await cube.kpis("v10", V(p.compare ?? "9月版"), {})).find((x) => x.key === p.metric);
        if (k) { const last = out[out.length - 1]; const item = { label: p.label ?? k.label, value: `${k.cur.toFixed(1)}${k.unit}`, note: `${sg(k.cur - k.cmp)} vs ${p.compare ?? "9月版"}` }; if (last?.t === "kv") last.items.push(item); else out.push({ t: "kv", items: [item] }); }
        break;
      }
      case "VarianceMiniTable": {
        const d = await cube.variance("v10", V(p.compare), p.region ? { region: p.region } : {}, [p.by], []);
        out.push({ t: "table", head: ["", p.compare, "10月版", "差異", "差異率"], align: ["l", "r", "r", "r", "r"], tot: d.rows.length, rows: [...d.rows.filter((r) => r.level === 0), d.total].map((r) => [r.label, r.ref.toFixed(1), r.cur.toFixed(1), sg(r.diff), `${sg(r.pct)}%`]) });
        break;
      }
      case "Insight": out.push({ t: "text", text: String(p.text ?? "").slice(0, 300), tone: p.tone }); break;
      case "Slot": { const node = cleanSvg(exp.slots?.[p.name]); if (node) out.push({ t: "svg", node, caption: p.caption ?? undefined }); break; }
    }
    for (const c of el.children ?? []) await visit(c, depth + 1);
  };
  await visit(spec.root, 0);
  return out;
}

/** Every Figure in a report spec, materialised once for the PDF. */
export async function materializeAll(spec: { elements: Record<string, { type: string; props: Record<string, any> }> }, w = 480) {
  const out: Record<string, Block[]> = {};
  for (const [key, el] of Object.entries(spec.elements)) if (el.type === "Figure") out[key] = await figureBlocks(el.props.source, w);
  return out;
}
