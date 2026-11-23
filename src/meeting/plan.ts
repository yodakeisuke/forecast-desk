// Meeting mode: what the fast decision model may decide. Everything here is a closed set of choices over
// screens the app already has. The model never writes numbers or text: the app computes the numbers and
// picks the labels, so a plan can only rearrange and re-scope the dashboard.
import { REGIONS, SEGMENTS, PRODUCTS, VERSIONS, type VersionId } from "../data/model";

export const SLOTS = ["c-bridge", "c-trend", "c-var", "c-heat", "c-q", "c-drv", "c-scenario"] as const;
export type Slot = (typeof SLOTS)[number];
/** Default dashboard order (Overview) and each card's normal width on the 12-column grid. */
export const DEFAULT_ORDER: Slot[] = ["c-trend", "c-bridge", "c-var", "c-heat", "c-q", "c-drv", "c-scenario"];
export const SLOT_INFO: Record<Slot, { label: string; span: number; why: string }> = {
  "c-bridge": { label: "営業利益ブリッジ", span: 5, why: "利益の動きを先に" },
  "c-trend": { label: "月次売上 · 推移", span: 7, why: "推移と着地を先に" },
  "c-var": { label: "差異表", span: 8, why: "内訳を先に" },
  "c-heat": { label: "ヒートマップ", span: 4, why: "地域×セグメントを一覧で" },
  "c-q": { label: "新規ARR · 四半期", span: 6, why: "新規ARRの四半期" },
  "c-drv": { label: "主要ドライバー", span: 6, why: "前提の推移" },
  "c-scenario": { label: "シナリオ試算", span: 12, why: "前提を変えた着地" },
};

export const KPIS = ["op", "rev", "newarr", "margin", "churn"] as const;
export type KpiKey = (typeof KPIS)[number];
export const KPI_LABEL: Record<KpiKey, string> = { op: "通期 営業利益", rev: "通期 売上", newarr: "新規ARR", margin: "営業利益率", churn: "月次 解約率" };

export const COMPARE_IDS = VERSIONS.filter((v) => v.id !== "v10").map((v) => v.id) as Exclude<VersionId, "v10">[];
export type Dim = "region" | "segment" | "product";
export const MEMBERS: Record<Dim, readonly string[]> = { region: REGIONS, segment: SEGMENTS, product: PRODUCTS };

export type Kind = "answer" | "handoff" | "unsupported";
/** null = keep what is on screen. "all" = clear the filter. */
export type Plan = {
  kind: Kind;
  compare: Exclude<VersionId, "v10"> | null;
  region: string | null;
  segment: string | null;
  product: string | null;
  winRate: number | null;
  slipBack: number | null;
  focus: Slot[];
  kpi: KpiKey;
  /** probability of each decision, for the UI and for tests (0..1) */
  confidence: Record<string, number>;
};

/** The screen the decision is made against: only the current conditions, never a long history. */
export type Screen = {
  compare: VersionId;
  filters: { region?: string | null; segment?: string | null; product?: string | null };
  scenario: { winRate: number; slipBack: number; naBias: number };
  /** reference values the app computed, so "back to last month's win rate" never needs a number from the model */
  refs: { winRate09: number; winRate10: number };
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Make any plan safe to apply: unknown members dropped, numbers clamped, 1–2 focus cards. */
export function sanitize(p: Plan): Plan {
  const dim = (d: Dim, v: string | null) => (v === null ? null : v === "all" || MEMBERS[d].includes(v) ? v : null);
  const focus = [...new Set(p.focus.filter((s) => (SLOTS as readonly string[]).includes(s)))].slice(0, 2);
  return {
    kind: p.kind === "handoff" || p.kind === "unsupported" ? p.kind : "answer",
    compare: p.compare && (COMPARE_IDS as string[]).includes(p.compare) ? p.compare : null,
    region: dim("region", p.region), segment: dim("segment", p.segment), product: dim("product", p.product),
    winRate: p.winRate === null || !Number.isFinite(p.winRate) ? null : r1(clamp(p.winRate, 0, 100)),
    slipBack: p.slipBack === null || !Number.isFinite(p.slipBack) ? null : Math.round(clamp(p.slipBack, 0, 100)),
    focus: focus.length ? focus : p.winRate !== null || p.slipBack !== null ? ["c-scenario"] : ["c-bridge", "c-var"],
    kpi: (KPIS as readonly string[]).includes(p.kpi) ? p.kpi : "op",
    confidence: p.confidence ?? {},
  };
}

/** Pulls "30%" / "30.5％" / "30パーセント" out of the question text. The model only says *that* a value was stated. */
export function statedPercent(q: string, near: RegExp): number | null {
  const m = q.match(new RegExp(`${near.source}[^0-9０-９]{0,12}([0-9０-９]+(?:[.．][0-9０-９]+)?)\\s*(?:%|％|パーセント)`));
  if (!m) return null;
  const n = Number(m[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace("．", "."));
  return Number.isFinite(n) ? n : null;
}
