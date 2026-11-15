// Chart geometry shared by three renderers: the dashboard (SVG in the DOM), the GenUI sandbox SDK
// (same look inside generated widgets) and the PDF report (react-pdf Svg primitives).
// A chart is a list of marks with colour tokens; each renderer maps tokens to its own palette.

export type Tone = "pos" | "neg" | "tot" | "ref" | "ink" | "ink2" | "muted" | "grid" | "axis" | "s1" | "s2" | "s3" | "surface" | "sunken" | "agent" | "none";
export type Mark = (
  | { t: "rect"; x: number; y: number; w: number; h: number; fill: Tone; rx?: number; opacity?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Tone; sw?: number; dash?: string; opacity?: number }
  | { t: "text"; x: number; y: number; text: string; size?: number; fill?: Tone; anchor?: "start" | "middle" | "end"; weight?: 400 | 500 | 600 }
  | { t: "path"; d: string; fill?: Tone; stroke?: Tone; sw?: number; opacity?: number }
  | { t: "circle"; cx: number; cy: number; r: number; fill: Tone; stroke?: Tone; sw?: number }
  | { t: "poly"; points: [number, number][]; stroke: Tone; sw?: number; opacity?: number }
  | { t: "hit"; x: number; y: number; w: number; h: number; tip: { title: string; rows: { tone?: Tone; value: string; label: string; bad?: boolean }[] }; cross?: number }
) & { id?: string };
export type Chart = { w: number; h: number; marks: Mark[]; label: string };

const M = "−";
export const sg = (v: number, d = 1) => { const r = Number(v.toFixed(d)); return (r > 0 ? "+" : r < 0 ? M : "±") + Math.abs(r).toFixed(d); };
export const fmt = (v: number, d = 1) => { const r = Number(v.toFixed(d)); return (r < 0 ? M : "") + Math.abs(r).toFixed(d); };

const roundTop = (x: number, top: number, bot: number, bw: number, r = 4) => {
  r = Math.min(r, (bot - top) / 1.5, bw / 2);
  return `M${x} ${bot}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${bot}Z`;
};
const niceStep = (span: number, n = 4) => {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
};
const ticks = (lo: number, hi: number, n = 4) => {
  const st = niceStep(hi - lo, n); const out: number[] = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(Math.round(v * 1e6) / 1e6);
  return out;
};

// ---------- 営業利益ブリッジ (waterfall) ----------
const L2: Record<string, string[]> = { 新規ARR: ["新規", "ARR"], "既存・解約": ["既存・", "解約"], 売上原価: ["売上", "原価"], その他販管費: ["その他", "販管費"] };
export function bridgeChart(o: { fromLabel: string; toLabel: string; from: number; to: number; steps: { label: string; value: number }[]; w: number; h?: number; groups?: boolean }): Chart {
  const W = Math.max(280, o.w), H = o.h ?? 262, m = { t: o.groups === false ? 18 : 42, r: 4, b: 40, l: 26 };
  const bars: { l: string; a: number; b: number; k: "t" | "n" | "p"; v: number }[] = [{ l: o.fromLabel, a: 0, b: o.from, k: "t", v: o.from }];
  let run = o.from;
  for (const s of o.steps) { bars.push({ l: s.label, a: run, b: run + s.value, k: s.value < 0 ? "n" : "p", v: s.value }); run += s.value; }
  bars.push({ l: o.toLabel, a: 0, b: o.to, k: "t", v: o.to });
  // Keep nonzero filtered differences visible instead of rounding them to ±0.0.
  const significant = bars.map(b => Math.abs(b.v)).filter(v => v >= 1e-8);
  let precision = 1;
  while (precision < 8 && significant.some(v => Number(v.toFixed(precision)) === 0)) precision++;
  const values = bars.flatMap((b) => [b.a, b.b]);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const pad = Math.max(hi - lo, 1) * 0.12;
  const bottom = lo < 0 ? lo - pad : 0, top = hi + pad;
  const n = bars.length, band = (W - m.l - m.r) / n, bw = Math.min(24, band * 0.5);
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - bottom) / (top - bottom));
  const cx = (i: number) => m.l + band * i + band / 2;
  const two = band < 80;
  const marks: Mark[] = [];
  for (const g of ticks(bottom, top, 3)) { marks.push({ t: "line", x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), stroke: g ? "grid" : "axis" }, { t: "text", x: m.l - 7, y: y(g) + 3.5, text: String(g), size: 10.5, fill: "muted", anchor: "end" }); }
  if (o.groups !== false && o.steps.length === 5) {
    const rev = o.steps[0].value + o.steps[1].value, cost = o.steps.slice(2).reduce((a, s) => a + s.value, 0);
    const br = (i1: number, i2: number, label: string) => {
      const x1 = cx(i1) - bw / 2 - 4, x2 = cx(i2) + bw / 2 + 4, yy = 22;
      marks.push({ t: "rect", x: x1 - 6, y: 2, w: x2 - x1 + 12, h: H - 4, fill: "none", id: `bridge:${label.split(" ")[0]}` }, { t: "path", d: `M${x1} ${yy + 5}V${yy}H${x2}V${yy + 5}`, stroke: "axis" }, { t: "text", x: (x1 + x2) / 2, y: yy - 6, text: label, size: 11, fill: "ink2", anchor: "middle" });
    };
    br(1, 2, `売上 ${sg(rev, precision)}`); br(3, 5, `費用 ${sg(cost, precision)}`);
  }
  bars.forEach((b, i) => {
    const t = y(Math.max(b.a, b.b)), bot = y(Math.min(b.a, b.b)), h = Math.max(1.5, bot - t), x = cx(i) - bw / 2;
    if (b.k === "t") marks.push({ t: "path", d: roundTop(x, t, bot, bw), fill: "tot", id: `bridge:${b.l}` });
    else marks.push({ t: "rect", x, y: t, w: bw, h, fill: b.k === "n" ? "neg" : "pos", rx: Math.min(4, h / 2), id: `bridge:${b.l}` });
    if (i < n - 1) marks.push({ t: "line", x1: x + bw, x2: cx(i + 1) - bw / 2, y1: y(b.b), y2: y(b.b), stroke: "axis" });
    marks.push({ t: "text", x: cx(i), y: b.k === "n" ? bot + 13 : t - 6, text: b.k === "t" ? fmt(b.v, precision) : sg(b.v, precision), size: 11, weight: b.k === "t" ? 600 : 500, fill: "ink", anchor: "middle" });
    (two && L2[b.l] ? L2[b.l] : [b.l]).forEach((p, j) => marks.push({ t: "text", x: cx(i), y: H - m.b + 17 + j * 13, text: p, size: 10.5, fill: "ink2", anchor: "middle" }));
    marks.push({ t: "hit", x: m.l + band * i, y: m.t - 6, w: band, h: H - m.t - m.b + 6, tip: { title: b.l, rows: [{ value: b.k === "t" ? fmt(b.v, precision) : sg(b.v, precision), label: b.k === "t" ? "億円" : `億円 · 累計 ${fmt(b.b, precision)}` }] } });
  });
  return { w: W, h: H, marks, label: `営業利益ブリッジ ${o.fromLabel}から${o.toLabel}` };
}

// ---------- 月次 実績と見通し (line) ----------
export function trendChart(o: { months: string[]; cur: number[]; cmp: number[]; lastActual: number; curLabel: string; cmpLabel: string; w: number; h?: number }): Chart {
  const W = Math.max(280, o.w), H = o.h ?? 240, m = { t: 26, r: 40, b: 26, l: 32 };
  const all = [...o.cur, ...o.cmp];
  const lo = Math.floor(Math.min(...all) * 2) / 2 - 0.5, hi = Math.ceil(Math.max(...all) * 2) / 2;
  const x = (i: number) => m.l + (i * (W - m.l - m.r)) / (o.months.length - 1), y = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
  const xs = (x(o.lastActual) + x(o.lastActual + 1)) / 2;
  const marks: Mark[] = [
    { t: "rect", x: xs, y: m.t - 18, w: W - xs, h: H - m.b - m.t + 18, fill: "sunken" },
    { t: "text", x: xs - 8, y: m.t - 6, text: "実績", size: 10.5, fill: "muted", anchor: "end" },
    { t: "text", x: xs + 8, y: m.t - 6, text: "見通し", size: 10.5, fill: "muted" },
  ];
  for (const g of ticks(lo, hi, 4)) marks.push({ t: "line", x1: m.l, x2: W, y1: y(g), y2: y(g), stroke: "grid" }, { t: "text", x: m.l - 8, y: y(g) + 3.5, text: g.toFixed(1), size: 10.5, fill: "muted", anchor: "end" });
  o.months.forEach((t, i) => { if (W > 440 || i % 2 === 0) marks.push({ t: "text", x: x(i), y: H - 7, text: t, size: 10.5, fill: "muted", anchor: "middle" }); });
  marks.push({ t: "poly", points: o.cmp.map((v, i) => [x(i), y(v)]), stroke: "ref", sw: 2 }, { t: "poly", points: o.cur.map((v, i) => [x(i), y(v)]), stroke: "s1", sw: 2 });
  const L = o.cur.length - 1;
  marks.push({ t: "circle", cx: x(o.lastActual), cy: y(o.cur[o.lastActual]), r: 4, fill: "s1", stroke: "surface", sw: 2 });
  const e1 = y(o.cur[L]), e2 = y(o.cmp[L]), gap = Math.abs(e1 - e2) < 14 ? 7 : 0;
  marks.push({ t: "circle", cx: x(L), cy: e2, r: 3.5, fill: "ref", stroke: "surface", sw: 2 }, { t: "circle", cx: x(L), cy: e1, r: 4, fill: "s1", stroke: "surface", sw: 2 });
  marks.push({ t: "text", x: x(L) + 8, y: e1 + 4 + (e1 > e2 ? gap : -gap), text: o.cur[L].toFixed(1), size: 11, weight: 600, fill: "ink" }, { t: "text", x: x(L) + 8, y: e2 + 4 + (e2 > e1 ? gap : -gap), text: o.cmp[L].toFixed(1), size: 11, fill: "ink2" });
  const step = (W - m.l - m.r) / (o.months.length - 1);
  o.months.forEach((mo, i) => marks.push({ t: "hit", x: x(i) - step / 2, y: m.t - 18, w: step, h: H - m.t - m.b + 18, cross: x(i), tip: { title: `${mo} · ${i <= o.lastActual ? "実績" : "見通し"}`, rows: [{ tone: "s1", value: o.cur[i].toFixed(1), label: o.curLabel }, { tone: "ref", value: o.cmp[i].toFixed(1), label: o.cmpLabel }, { value: sg(o.cur[i] - o.cmp[i]), label: "差異", bad: o.cur[i] - o.cmp[i] < -0.05 }] } }));
  return { w: W, h: H, marks, label: "月次売上の推移" };
}

// ---------- 新規ARR 四半期 (grouped columns) ----------
export function quarterChart(o: { cur: number[]; cmp: number[]; curLabel: string; cmpLabel: string; actualQuarters: number; w: number; h?: number }): Chart {
  const W = Math.max(260, o.w), H = o.h ?? 196, m = { t: 20, r: 8, b: 26, l: 26 }, band = (W - m.l - m.r) / 4, bw = Math.min(24, band * 0.26);
  const hi = Math.ceil(Math.max(...o.cur, ...o.cmp) / 2) * 2 + 0.01;
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - v / hi);
  const marks: Mark[] = [];
  for (const g of ticks(0, hi, 4)) marks.push({ t: "line", x1: m.l, x2: W - m.r, y1: y(g), y2: y(g), stroke: g ? "grid" : "axis" }, { t: "text", x: m.l - 7, y: y(g) + 3.5, text: String(g), size: 10.5, fill: "muted", anchor: "end" });
  ["Q1", "Q2", "Q3", "Q4"].forEach((q, i) => {
    const cx = m.l + band * i + band / 2;
    marks.push({ t: "path", d: roundTop(cx - bw - 1, y(o.cmp[i]), y(0), bw), fill: "ref" }, { t: "path", d: roundTop(cx + 1, y(o.cur[i]), y(0), bw), fill: "s1" });
    marks.push({ t: "text", x: cx + 1 + bw / 2, y: y(o.cur[i]) - 6, text: o.cur[i].toFixed(1), size: 11, weight: 600, fill: "ink", anchor: "middle" });
    if (Math.abs(o.cur[i] - o.cmp[i]) > 0.05) marks.push({ t: "text", x: cx - bw / 2 - 1, y: y(o.cmp[i]) - 6, text: o.cmp[i].toFixed(1), size: 10.5, fill: "muted", anchor: "middle" });
    marks.push({ t: "text", x: cx, y: H - 8, text: `${q}${i < o.actualQuarters ? " 実績" : " 見通し"}`, size: 10.5, fill: "muted", anchor: "middle" });
    marks.push({ t: "hit", x: m.l + band * i, y: m.t, w: band, h: H - m.t - m.b, tip: { title: `${q}`, rows: [{ tone: "s1", value: o.cur[i].toFixed(1), label: o.curLabel }, { tone: "ref", value: o.cmp[i].toFixed(1), label: o.cmpLabel }] } });
  });
  return { w: W, h: H, marks, label: "新規ARR 四半期" };
}

// ---------- フォーキャスト精度 (lines by region) ----------
const SERIES: Tone[] = ["s1", "s2", "s3"];
export function accuracyChart(o: { versions: string[]; series: { name: string; values: number[] }[]; w: number; h?: number; emphasize?: string }): Chart {
  const W = Math.max(260, o.w), H = o.h ?? 200, m = { t: 12, r: 84, b: 24, l: 36 };
  const all = o.series.flatMap((s) => s.values);
  const lo = Math.min(-4, Math.floor(Math.min(...all) / 4) * 4), hi = Math.max(12, Math.ceil(Math.max(...all) / 4) * 4);
  const n = o.versions.length;
  const x = (i: number) => m.l + (i * (W - m.l - m.r)) / (n - 1), y = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
  const marks: Mark[] = [];
  for (let g = lo; g <= hi; g += 4) marks.push({ t: "line", x1: m.l, x2: W - m.r + 6, y1: y(g), y2: y(g), stroke: g === 0 ? "axis" : "grid" }, { t: "text", x: m.l - 7, y: y(g) + 3.5, text: `${g > 0 ? "+" : g < 0 ? M : ""}${Math.abs(g)}%`, size: 10.5, fill: "muted", anchor: "end" });
  o.versions.forEach((t, i) => marks.push({ t: "text", x: x(i), y: H - 6, text: t, size: 10.5, fill: "muted", anchor: "middle" }));
  o.series.forEach((se, k) => {
    const tone = SERIES[k % 3];
    marks.push({ id: `accuracy:${se.name}`, t: "poly", points: se.values.map((v, i) => [x(i), y(v)]), stroke: tone, sw: o.emphasize && o.emphasize !== se.name ? 1.5 : 2, opacity: o.emphasize && o.emphasize !== se.name ? 0.55 : 1 });
    const lv = se.values[n - 1];
    marks.push({ t: "circle", cx: x(n - 1), cy: y(lv), r: 4, fill: tone, stroke: "surface", sw: 2 }, { t: "text", x: x(n - 1) + 10, y: y(lv) + 4, text: `${se.name} ${sg(lv)}%`, size: 11, fill: "ink" });
  });
  const step = (W - m.l - m.r) / (n - 1);
  o.versions.forEach((v, i) => marks.push({ t: "hit", x: x(i) - step / 2, y: m.t, w: step, h: H - m.t - m.b, cross: x(i), tip: { title: v, rows: o.series.map((s, k) => ({ tone: SERIES[k % 3], value: `${sg(s.values[i])}%`, label: s.name })).sort((a, b) => parseFloat(b.value.replace(M, "-")) - parseFloat(a.value.replace(M, "-"))) } }));
  return { w: W, h: H, marks, label: "地域別フォーキャスト誤差の推移" };
}

// ---------- シナリオ比較 (dot plot with reference lines) ----------
export function scenarioChart(o: { cases: { name: string; value: number; note: string; main?: boolean }[]; refs: { value: number; label: string }[]; w: number; h?: number }): Chart {
  // the plot on the left, each case's value and assumptions in a column of their own on the right,
  // so labels never cross the reference lines
  const W = Math.max(300, o.w), H = o.h ?? 150, noteW = Math.min(230, Math.round(W * 0.42)), m = { t: 26, r: noteW + 14, b: 22, l: 40 };
  const vals = [...o.cases.map((c) => c.value), ...o.refs.map((r) => r.value)];
  const lo = Math.floor(Math.min(...vals) - 0.4), hi = Math.ceil(Math.max(...vals) + 0.4);
  const x = (v: number) => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r), rh = (H - m.t - m.b) / o.cases.length;
  const marks: Mark[] = [];
  const step = hi - lo > 8 ? 2 : 1;
  for (let g = lo; g <= hi; g += step) marks.push({ t: "line", x1: x(g), x2: x(g), y1: m.t, y2: H - m.b, stroke: "grid" }, { t: "text", x: x(g), y: H - 6, text: String(g), size: 10.5, fill: "muted", anchor: "middle" });
  const base = o.refs[0]?.value ?? lo;
  const sorted = [...o.refs].sort((a, b) => a.value - b.value);
  o.refs.forEach((r, i) => {
    const anchor = sorted.indexOf(r) === 0 && o.refs.length > 1 ? "end" : "start";
    marks.push({ t: "line", x1: x(r.value), x2: x(r.value), y1: m.t - 6, y2: H - m.b, stroke: "ink2", dash: i === 0 ? undefined : "3 3" }, { t: "text", x: x(r.value) + (anchor === "start" ? 4 : -4), y: m.t - 10, text: `${r.label} ${r.value.toFixed(1)}`, size: 10.5, fill: "ink2", anchor });
  });
  const nx = W - noteW;
  marks.push({ t: "line", x1: nx - 6, x2: nx - 6, y1: m.t - 4, y2: H - m.b, stroke: "grid" });
  o.cases.forEach((c, i) => {
    const cy = m.t + rh * i + rh / 2;
    marks.push({ t: "text", x: m.l - 10, y: cy + 4, text: c.name, size: 11.5, weight: c.main ? 600 : 400, fill: "ink", anchor: "end" });
    marks.push({ t: "line", x1: x(base), x2: x(c.value), y1: cy, y2: cy, stroke: "pos", sw: 2, opacity: 0.35 });
    marks.push({ t: "circle", cx: x(c.value), cy, r: c.main ? 6 : 4.5, fill: "pos", stroke: "surface", sw: 2 });
    marks.push({ t: "text", x: nx + 4, y: cy + 4, text: c.value.toFixed(1), size: 12, weight: c.main ? 600 : 400, fill: "ink" });
    marks.push({ t: "text", x: nx + 40, y: cy + 4, text: `${sg(c.value - base)}  ${c.note}`, size: 10.5, fill: "muted" });
  });
  return { w: W, h: H, marks, label: "シナリオ別の通期営業利益" };
}

// ---------- spark ----------
export function sparkChart(vals: number[], w: number, h: number, last: Tone = "ink2"): Chart {
  const mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
  const pts = vals.map((v, i) => [3 + (i * (w - 6)) / (vals.length - 1), mx === mn ? h / 2 : h - 4 - ((v - mn) / span) * (h - 8)] as [number, number]);
  const lp = pts[pts.length - 1];
  return { w, h, label: "", marks: [{ t: "poly", points: pts, stroke: "tot", sw: 1.5 }, { t: "circle", cx: lp[0], cy: lp[1], r: 3, fill: last, stroke: "surface", sw: 1.5 }] };
}

// ---------- heat (region × segment) ----------
export function heatChart(o: { rows: { region: string; cells: { segment: string; pct: number; diff: number; ref: number; cur: number }[] }[]; w: number; h?: number }): Chart {
  const W = Math.max(260, o.w), H = o.h ?? 210, lw = 64, top = 22, gap = 2;
  const cols = o.rows[0].cells.length, cw = (W - lw - gap * cols) / cols, ch = (H - top - gap * o.rows.length) / o.rows.length;
  const marks: Mark[] = [];
  o.rows[0].cells.forEach((c, j) => marks.push({ t: "text", x: lw + j * (cw + gap) + cw / 2, y: 13, text: c.segment, size: 11, fill: "muted", anchor: "middle" }));
  o.rows.forEach((r, i) => {
    const y0 = top + i * (ch + gap);
    marks.push({ t: "text", x: 0, y: y0 + ch / 2 + 4, text: r.region, size: 12, fill: "ink2" });
    r.cells.forEach((c, j) => {
      const x0 = lw + j * (cw + gap), mag = Math.min(1, Math.abs(c.pct) / 10);
      marks.push({ t: "rect", x: x0, y: y0, w: cw, h: ch, fill: "sunken", rx: 4, id: `heat:${r.region}/${c.segment}` });
      marks.push({ t: "rect", x: x0, y: y0, w: cw, h: ch, fill: c.pct < 0 ? "neg" : "pos", rx: 4, opacity: Math.max(0.04, mag) });
      const ink: Tone = mag > 0.55 ? "surface" : "ink";
      marks.push({ t: "text", x: x0 + cw / 2, y: y0 + ch / 2, text: `${sg(c.pct)}%`, size: 12.5, weight: 600, fill: ink, anchor: "middle" });
      marks.push({ t: "text", x: x0 + cw / 2, y: y0 + ch / 2 + 14, text: `${sg(c.diff)}億`, size: 10, fill: ink, anchor: "middle" });
      marks.push({ t: "hit", x: x0, y: y0, w: cw, h: ch, tip: { title: `${r.region} · ${c.segment}`, rows: [{ value: `${c.ref.toFixed(1)} → ${c.cur.toFixed(1)}`, label: "億円" }, { value: `${sg(c.pct)}%`, label: "差異率", bad: c.pct < 0 }] } });
    });
  });
  return { w: W, h: H, marks, label: "売上差異率 地域×セグメント" };
}

// ---------- 案件のクローズ予定日の移動 (dumbbell) ----------
export function dumbbellChart(o: { deals: { name: string; arr: number; from: string; to: string }[]; w: number }): Chart {
  const W = o.w, LX = Math.min(170, W * 0.36), R = W - 14, rh = 34, top = 46, H = top + o.deals.length * rh + 6;
  const T = (s: string) => { const [Y, Mo, D] = s.split("-").map(Number); return Date.UTC(Y, Mo - 1, D); };
  const D0 = Date.UTC(2026, 9, 1), D1 = Date.UTC(2027, 6, 1), FYE = Date.UTC(2027, 3, 1);
  const X = (t: number) => LX + ((t - D0) / (D1 - D0)) * (R - LX), xf = X(FYE);
  const md = (s: string) => { const [, a, b] = s.split("-"); return `${+a}/${+b}`; };
  const marks: Mark[] = [{ t: "rect", x: xf, y: top - 6, w: R - xf, h: H - top, fill: "sunken" }];
  for (const [l, t] of [["10月", D0], ["1月", Date.UTC(2027, 0, 1)], ["4月", FYE], ["6月", Date.UTC(2027, 5, 1)]] as [string, number][]) marks.push({ t: "line", x1: X(t), x2: X(t), y1: top - 6, y2: H, stroke: "grid" }, { t: "text", x: X(t), y: top - 12, text: l, size: 11, fill: "muted", anchor: "middle" });
  marks.push({ t: "line", x1: xf, x2: xf, y1: top - 6, y2: H, stroke: "axis" }, { t: "text", x: xf - 6, y: 12, text: "今期", size: 11, fill: "ink2", anchor: "end" }, { t: "text", x: xf + 6, y: 12, text: "来期", size: 11, fill: "ink2" });
  o.deals.forEach((d, i) => {
    const y = top + i * rh + rh / 2 - 4, a = X(T(d.from)), b = X(T(d.to));
    marks.push({ t: "text", x: 0, y: y + 4, text: d.name, size: 12, fill: "ink" }, { t: "text", x: LX - 10, y: y + 4, text: `${d.arr.toFixed(1)}億`, size: 11, fill: "muted", anchor: "end" });
    marks.push({ t: "line", x1: a + 5, x2: b - 6, y1: y, y2: y, stroke: "neg", sw: 2, opacity: 0.55 }, { t: "circle", cx: a, cy: y, r: 4.5, fill: "surface", stroke: "ink2", sw: 2 }, { t: "circle", cx: b, cy: y, r: 5, fill: "neg", stroke: "surface", sw: 2 });
    marks.push({ t: "hit", x: LX, y: y - rh / 2, w: R - LX, h: rh, tip: { title: d.name, rows: [{ value: `${md(d.from)} → ${md(d.to)}`, label: "クローズ予定日" }, { value: `${d.arr.toFixed(1)}`, label: "ARR 億円" }] } });
  });
  return { w: W, h: H, marks, label: "クローズ予定日の移動" };
}
