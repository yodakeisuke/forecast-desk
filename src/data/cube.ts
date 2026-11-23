// Cube-style queries. Every number the dashboard (and the LLM) sees is computed here, in SQL, on DuckDB.
import { q, type Row } from "./db";
import { DIMENSIONS, MEASURES, REGIONS, SEGMENTS, PRODUCTS, VERSIONS, BRIDGE_ORDER, type Dim, type Measure, type VersionId } from "./model";

export type Filters = { region?: string | null; segment?: string | null; product?: string | null };
const lit = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function where(f: Filters, alias = "p") {
  const w: string[] = [];
  if (f.region) w.push(`${alias}.region = ${lit(f.region)}`);
  if (f.segment) w.push(`${alias}.segment = ${lit(f.segment)}`);
  if (f.product) w.push(`${alias}.product = ${lit(f.product)}`);
  return w.length ? w.join(" AND ") : "TRUE";
}
const HISTORY: VersionId[] = ["budget", "v05", "v06", "v07", "v08", "v09", "v10"];

export async function plByVersion(f: Filters) {
  const rows = await q(`SELECT p.version_id v, ${MEASURES.売上} rev, ${MEASURES.営業利益} op
    FROM fact_pl p JOIN dim_account a USING (account) WHERE ${where(f)} GROUP BY 1`);
  return Object.fromEntries(rows.map((r) => [r.v, { rev: num(r.rev), op: num(r.op) }])) as Record<VersionId, { rev: number; op: number }>;
}

export async function newArrByVersion(f: Filters) {
  const w = f.region ? `AND n.region = ${lit(f.region)}` : "";
  const rows = await q(`SELECT v.version_id v, sum(n.amount) amt FROM fc_version v JOIN fact_newarr n
    ON ((n.kind = 'actual' AND n.month <= v.as_of_month) OR n.version_id = v.version_id) WHERE TRUE ${w} GROUP BY 1`);
  return Object.fromEntries(rows.map((r) => [r.v, num(r.amt)])) as Record<VersionId, number>;
}

export async function churnByVersion(f: Filters) {
  const w = [f.region ? `region = ${lit(f.region)}` : "", f.segment ? `segment = ${lit(f.segment)}` : ""].filter(Boolean).join(" AND ") || "TRUE";
  const rows = await q(`SELECT version_id v, avg(value) c FROM fact_driver WHERE driver = '解約率' AND ${w} GROUP BY 1`);
  return Object.fromEntries(rows.map((r) => [r.v, num(r.c)])) as Record<VersionId, number>;
}

export type Kpi = { key: string; label: string; unit: string; cur: number; cmp: number; d: number; up: boolean | null; pt?: boolean; hero?: boolean; history: number[] };
export async function kpis(cur: VersionId, cmp: VersionId, f: Filters): Promise<Kpi[]> {
  const [pl, na, ch] = await Promise.all([plByVersion(f), newArrByVersion(f), churnByVersion(f)]);
  const margin = (v: VersionId) => (pl[v].op / pl[v].rev) * 100;
  const mk = (key: string, label: string, unit: string, get: (v: VersionId) => number, o: Partial<Kpi> = {}): Kpi =>
    ({ key, label, unit, cur: get(cur), cmp: get(cmp), d: 1, up: true, history: HISTORY.map(get), ...o });
  return [
    mk("op", "通期 営業利益", "億円", (v) => pl[v].op, { hero: true }),
    mk("rev", "通期 売上", "億円", (v) => pl[v].rev),
    mk("newarr", f.segment || f.product ? "新規ARR（地域全体）" : "新規ARR（通期）", "億円", (v) => na[v]),
    mk("margin", "営業利益率", "%", margin, { pt: true }),
    mk("churn", f.product ? "月次 解約率（全製品）" : "月次 解約率", "%", (v) => ch[v], { up: false, pt: true }),
  ];
}

export async function trend(cur: VersionId, cmp: VersionId, f: Filters) {
  const rows = await q(`SELECT p.version_id v, p.month m, ${MEASURES.売上} rev FROM fact_pl p JOIN dim_account a USING (account)
    WHERE p.version_id IN (${lit(cur)}, ${lit(cmp)}) AND ${where(f)} GROUP BY 1, 2 ORDER BY 2`);
  const pick = (v: string) => Array.from({ length: 12 }, (_, m) => num(rows.find((r) => r.v === v && r.m === m)?.rev));
  return { cur: pick(cur), cmp: pick(cmp) };
}

export async function bridge(from: VersionId, to: VersionId, f: Filters) {
  const rows = await q(`SELECT p.version_id v, a.bridge b, sum(p.amount * a.sign) x FROM fact_pl p JOIN dim_account a USING (account)
    WHERE p.version_id IN (${lit(from)}, ${lit(to)}) AND ${where(f)} GROUP BY 1, 2`);
  const get = (v: string, b: string) => num(rows.find((r) => r.v === v && r.b === b)?.x);
  const steps = BRIDGE_ORDER.map((b) => ({ label: b, value: get(to, b) - get(from, b) }));
  const fromTotal = BRIDGE_ORDER.reduce((s, b) => s + get(from, b), 0);
  const toTotal = BRIDGE_ORDER.reduce((s, b) => s + get(to, b), 0);
  return { from: fromTotal, to: toTotal, steps };
}

export type VarRow = { key: string; label: string; level: number; ref: number; cur: number; diff: number; pct: number; expandable: boolean };
/** Revenue variance by a hierarchy of dimensions (default 地域 → セグメント). */
export async function variance(cur: VersionId, cmp: VersionId, f: Filters, dims: Dim[], expanded: string[], measure: Measure = "売上"): Promise<{ total: VarRow; rows: VarRow[] }> {
  const m = MEASURES[measure];
  const d0 = DIMENSIONS[dims[0]], d1 = dims[1] ? DIMENSIONS[dims[1]] : null;
  const base = `FROM fact_pl p JOIN dim_account a USING (account) WHERE p.version_id IN (${lit(cur)}, ${lit(cmp)}) AND ${where(f)}`;
  const lvl = async (dim: string, extra = "TRUE") => q(`SELECT ${dim} k,
      ${m.replace("p.amount", `CASE WHEN p.version_id = ${lit(cmp)} THEN p.amount ELSE 0 END`)} ref_v,
      ${m.replace("p.amount", `CASE WHEN p.version_id = ${lit(cur)} THEN p.amount ELSE 0 END`)} cur_v
    ${base} AND ${extra} GROUP BY 1`);
  const order = (k: string) => {
    const lists = [REGIONS, SEGMENTS, PRODUCTS] as readonly (readonly string[])[];
    for (const l of lists) { const i = l.indexOf(k); if (i >= 0) return i; }
    return 99;
  };
  const toRow = (r: Row, level: number, parent?: string): VarRow => {
    const ref = num(r.ref_v), c = num(r.cur_v);
    const key = parent ? `${parent}/${r.k}` : String(r.k);
    return { key, label: String(r.k), level, ref, cur: c, diff: c - ref, pct: ref ? (c / ref - 1) * 100 : 0, expandable: level === 0 && !!d1 };
  };
  const l0 = (await lvl(d0)).sort((a, b) => order(String(a.k)) - order(String(b.k)) || String(a.k).localeCompare(String(b.k)));
  const rows: VarRow[] = [];
  for (const r of l0) {
    const row = toRow(r, 0); rows.push(row);
    if (d1 && expanded.includes(row.key)) {
      const kids = (await lvl(d1, `${d0} = ${lit(row.key)}`)).sort((a, b) => order(String(a.k)) - order(String(b.k)));
      kids.forEach((k) => rows.push(toRow(k, 1, row.key)));
    }
  }
  const ref = rows.filter((r) => r.level === 0).reduce((s, r) => s + r.ref, 0);
  const c = rows.filter((r) => r.level === 0).reduce((s, r) => s + r.cur, 0);
  return { total: { key: "合計", label: `${measure}合計`, level: -1, ref, cur: c, diff: c - ref, pct: ref ? (c / ref - 1) * 100 : 0, expandable: false }, rows };
}

export async function heat(cur: VersionId, cmp: VersionId, f: Filters) {
  const rows = await q(`SELECT p.region r, p.segment s,
      sum(CASE WHEN p.version_id = ${lit(cmp)} AND a.line = '売上' THEN p.amount ELSE 0 END) ref_v,
      sum(CASE WHEN p.version_id = ${lit(cur)} AND a.line = '売上' THEN p.amount ELSE 0 END) cur_v
    FROM fact_pl p JOIN dim_account a USING (account) WHERE ${where({ product: f.product })} GROUP BY 1, 2`);
  return REGIONS.filter(r => !f.region || r === f.region).map((r) => ({
    region: r,
    cells: SEGMENTS.filter(s => !f.segment || s === f.segment).map((s) => {
      const x = rows.find((y) => y.r === r && y.s === s)!;
      const ref = num(x?.ref_v), c = num(x?.cur_v);
      return { segment: s, ref, cur: c, diff: c - ref, pct: ref ? (c / ref - 1) * 100 : 0 };
    }),
  }));
}

export async function quarterlyNewArr(cur: VersionId, cmp: VersionId, f: Filters) {
  const w = f.region ? `AND n.region = ${lit(f.region)}` : "";
  const rows = await q(`SELECT v.version_id v, n.month // 3 qtr, sum(n.amount) amt FROM fc_version v JOIN fact_newarr n
    ON ((n.kind = 'actual' AND n.month <= v.as_of_month) OR n.version_id = v.version_id)
    WHERE v.version_id IN (${lit(cur)}, ${lit(cmp)}) ${w} GROUP BY 1, 2`);
  const pick = (v: string) => [0, 1, 2, 3].map((i) => num(rows.find((r) => r.v === v && r.qtr === i)?.amt));
  return { cur: pick(cur), cmp: pick(cmp) };
}

export async function drivers(cur: VersionId, cmp: VersionId, f: Filters = {}) {
  const rows = await q(`SELECT version_id v,
      sum(CASE WHEN driver = '既存ARR' AND month = 0 THEN value END) arr0,
      avg(CASE WHEN driver = '成約率' THEN value END) win,
      avg(CASE WHEN driver = '解約率' THEN value END) churn,
      sum(CASE WHEN driver = '人員数' AND month = 11 THEN value END) hc,
      avg(CASE WHEN driver = 'USDJPY' THEN value END) fx
    FROM fact_driver d WHERE
      (driver IN ('既存ARR','成約率','解約率') AND ${where({region:f.region,segment:f.segment}, "d")})
      OR (driver='人員数' AND ${where({region:f.region}, "d")}) OR driver='USDJPY' GROUP BY 1`);
  const g = (v: string, k: string) => num(rows.find((r) => r.v === v)?.[k]);
  const def = [
    { key: "arr0", label: "期首ARR", unit: "億円", d: 1, up: true },
    { key: "win", label: "新規ARR 成約率", unit: "%", d: 0, up: true, pt: true },
    { key: "churn", label: "月次 解約率", unit: "%", d: 2, up: false, pt: true },
    { key: "hc", label: "期末人員（地域全体）", unit: "名", d: 0, up: false },
    { key: "fx", label: "USD/JPY 前提（全社）", unit: "円", d: 0, up: null },
  ];
  return def.map((x) => ({ ...x, cur: g(cur, x.key), cmp: g(cmp, x.key), history: HISTORY.map((v) => g(v, x.key)) }));
}

const FY_END = "DATE '2027-04-01'";
export async function pipeline(f: Filters) {
  const w = where({ region: f.region, segment: f.segment, product: f.product }, "d");
  const stages = ["リード", "商談化", "提案", "交渉", "コミット"];
  const rank = (col: string) => `CASE ${col} ${stages.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE -1 END`;
  const rows = await q(`SELECT ${stages.map((s, i) => `
      sum(CASE WHEN close_v09 < ${FY_END} AND ${rank("stage_v09")} >= ${i} THEN arr ELSE 0 END) s9_${i},
      sum(CASE WHEN close_v10 < ${FY_END} AND ${rank("stage_v10")} >= ${i} THEN arr ELSE 0 END) s10_${i},
      count(CASE WHEN close_v09 < ${FY_END} AND ${rank("stage_v09")} >= ${i} THEN 1 END) n9_${i},
      count(CASE WHEN close_v10 < ${FY_END} AND ${rank("stage_v10")} >= ${i} THEN 1 END) n10_${i}`).join(",")}
    FROM fact_deal d WHERE ${w}`);
  const r = rows[0];
  const slip = (await q(`SELECT count(*) n, coalesce(sum(arr), 0) arr,
      coalesce(sum(arr * greatest(0, date_diff('month', close_v09, ${FY_END})) / 12.0), 0) impact
    FROM fact_deal d WHERE ${w} AND close_v09 < ${FY_END} AND close_v10 >= ${FY_END} AND stage_v10 <> '失注'`))[0];
  const lost = (await q(`SELECT count(*) n, coalesce(sum(arr), 0) arr FROM fact_deal d WHERE ${w} AND stage_v10 = '失注' AND stage_v09 <> '失注'`))[0];
  return {
    stages: stages.map((s, i) => ({ stage: s, v09: num(r[`s9_${i}`]), v10: num(r[`s10_${i}`]), n09: num(r[`n9_${i}`]), n10: num(r[`n10_${i}`]) })),
    slipped: { count: num(slip.n), arr: num(slip.arr), revenueImpact: -num(slip.impact) },
    lost: { count: num(lost.n), arr: num(lost.arr) },
  };
}

export type SlipRow = { deal_id: string; company: string; owner: string; region: string; segment: string; product: string; arr: number; stage: string; prob: number; close_from: string; close_to: string; slip_reason: string | null };
export async function slippedDeals(f: Filters, minArr = 0) {
  const w = where({ region: f.region, segment: f.segment, product: f.product }, "d");
  const deals = await q(`SELECT deal_id, company, owner, region, segment, product, arr, stage_v10 stage, prob_v10 prob,
      strftime(close_v09, '%Y-%m-%d') close_from, strftime(close_v10, '%Y-%m-%d') close_to, slip_reason
    FROM fact_deal d WHERE ${w} AND close_v09 < ${FY_END} AND close_v10 >= ${FY_END} AND stage_v10 <> '失注' AND arr >= ${Number(minArr) || 0}
    ORDER BY arr DESC LIMIT 20`);
  const ids = deals.map((d) => lit(String(d.deal_id))).join(",") || "''";
  const hist = await q(`SELECT deal_id, strftime(changed_on, '%m/%d') on_, field, old_value, new_value FROM fact_deal_history WHERE deal_id IN (${ids}) ORDER BY changed_on`);
  return deals.map((d) => ({ ...(d as SlipRow), history: hist.filter((h) => h.deal_id === d.deal_id).map((h) => ({ on: h.on_, field: h.field, from: h.old_value, to: h.new_value })) }));
}

/** Month-ahead new-ARR forecast error per version and region: forecast(v, asOf+1) / actual(asOf+1) − 1. */
export async function forecastAccuracy(versions = 6, by: "region" = "region") {
  void by;
  const rows = await q(`SELECT v.label, v.as_of_month a, f.region, (f.amount / x.amount - 1) * 100 err
    FROM fc_version v
    JOIN fact_newarr f ON f.version_id = v.version_id AND f.kind = 'forecast' AND f.month = v.as_of_month + 1
    JOIN fact_newarr x ON x.kind = 'actual' AND x.region = f.region AND x.month = f.month
    WHERE v.kind = 'forecast' ORDER BY v.as_of_month`);
  const labels = [...new Set(rows.map((r) => String(r.label)))].slice(-versions);
  return {
    versions: labels,
    series: REGIONS.map((reg) => ({ region: reg, values: labels.map((l) => r1(num(rows.find((r) => r.label === l && r.region === reg)?.err))) })),
  };
}

// ---------- generic cube query for query_data ----------
export type CubeQuery = { measure: Measure; versions: VersionId[]; by?: Dim[]; filters?: Filters; months?: number[] };
export async function cubeQuery(cq: CubeQuery) {
  const by = cq.by ?? [];
  const dims = by.map((d) => `${DIMENSIONS[d]} AS ${d}`);
  const mw = cq.months?.length ? `AND p.month IN (${cq.months.map(Number).join(",")})` : "";
  const cols = cq.versions.map((v) => `${MEASURES[cq.measure].replace("p.amount", `CASE WHEN p.version_id = ${lit(v)} THEN p.amount ELSE 0 END`)} AS "${VERSIONS.find((x) => x.id === v)!.label}"`);
  const sql = `SELECT ${[...dims, ...cols].join(", ")} FROM fact_pl p JOIN dim_account a USING (account)
    WHERE p.version_id IN (${cq.versions.map(lit).join(",")}) AND ${where(cq.filters ?? {})} ${mw}
    ${by.length ? `GROUP BY ${by.map((_, i) => i + 1).join(", ")} ORDER BY ${by.map((_, i) => i + 1).join(", ")}` : ""}`;
  const rows = await q(sql);
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v])));
}

export const round = { r1, r2 };

// ---------- scenario P/L: sensitivities for any selected scope ----------
// OP(scenario) = OP(10月版)
//   + slipBack × (revenue the slipped deals would have brought this FY) × contribution margin
//   + (winRate − 10月版の成約率) × (open pipeline revenue this FY) × contribution margin
//   + naBias × (selected new-subscription revenue in the forecast months) × contribution margin
export async function scenarioBase(filters: Filters = {}) {
    const pl = await plByVersion(filters);
    const cogs = (await q(`SELECT sum(CASE WHEN a.line='売上原価' THEN p.amount END) c, sum(CASE WHEN a.line='売上' THEN p.amount END) r
      FROM fact_pl p JOIN dim_account a USING (account) WHERE p.version_id='v10' AND ${where(filters)}`))[0];
    const cm = num(cogs.r) ? 1 - num(cogs.c) / num(cogs.r) : 0;
    const pipe = await pipeline(filters);
    const open = (await q(`SELECT coalesce(sum(arr * greatest(0, date_diff('month', close_v10, ${FY_END})) / 12.0), 0) x, coalesce(sum(arr), 0) a
      FROM fact_deal d WHERE ${where(filters, 'd')} AND close_v10 < ${FY_END} AND close_v10 >= DATE '2026-11-01' AND stage_v10 NOT IN ('失注','コミット')`))[0];
    const na = (await q(`SELECT sum(p.amount) x FROM fact_pl p WHERE p.version_id='v10' AND ${where(filters)} AND p.account='新規サブスク売上' AND p.month > ${6}`))[0];
    const win = (await q(`SELECT avg(value) w FROM fact_driver d WHERE version_id='v10' AND driver='成約率' AND ${where({region: filters.region, segment: filters.segment}, 'd')}`))[0];
    return { op10: pl.v10.op, op09: pl.v09.op, cm, slipRev: -pipe.slipped.revenueImpact, slipArr: pipe.slipped.arr, pipeRev: num(open.x), pipeArr: num(open.a), naNewRev: num(na.x), win10: num(win.w) };

}
/** 9月版 and 10月版 win rates for a scope (the scenario's reference points). */
export async function winRates(filters: Filters = {}) {
  const rows = await q(`SELECT version_id v, avg(value) w FROM fact_driver d WHERE driver='成約率' AND version_id IN ('v09','v10') AND ${where({ region: filters.region, segment: filters.segment }, 'd')} GROUP BY 1`);
  const get = (v: string) => num(rows.find((r) => r.v === v)?.w ?? 0);
  return { v09: get("v09"), v10: get("v10") };
}
export async function scenarioPL(o: { slipBack: number; winRate: number; naBias: number; filters?: Filters }) {
  const b = await scenarioBase(o.filters);
  const calc = (s: number, w: number, n: number) => {
    const slip = (s / 100) * b.slipRev * b.cm, win = ((w - b.win10) / 100) * b.pipeRev * b.cm, bias = (n / 100) * b.naNewRev * b.cm;
    return { op: r2(b.op10 + slip + win + bias), slip: r2(slip), win: r2(win), bias: r2(bias) };
  };
  const base = calc(o.slipBack, o.winRate, o.naBias);
  const pess = calc(0, Math.max(0, b.win10 - 2), -8), opt = calc(100, Math.min(100, b.win10 + 3), 0);
  return {
    base: base.op,
    parts: { slipBack: base.slip, winRate: base.win, naBias: base.bias },
    // the same drivers in new ARR: a deal that comes back or is won adds its full ARR, even if little of it lands this FY
    arrParts: { slipBack: r2((o.slipBack / 100) * b.slipArr), winRate: r2(((o.winRate - b.win10) / 100) * b.pipeArr), naBias: 0 },
    cases: [
      { name: "悲観", value: pess.op, note: `戻り0% · ${r1(b.win10 - 2)}% · 補正−8%` },
      { name: "基本", value: base.op, note: `戻り${r1(o.slipBack)}% · ${r1(o.winRate)}% · 補正${o.naBias > 0 ? "+" : o.naBias < 0 ? "−" : "±"}${Math.abs(r1(o.naBias))}%`, main: true },
      { name: "楽観", value: opt.op, note: `戻り100% · ${r1(b.win10 + 3)}% · 補正なし` },
    ],
    refs: [{ label: "10月版", value: r2(b.op10) }, { label: "9月版", value: r2(b.op09) }],
    assumptions: { winRate10: r1(b.win10), slippedRevenue: r2(b.slipRev), contributionMargin: r2(b.cm) },
  };
}
