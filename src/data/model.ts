// Shared vocabulary for the dummy FP&A model (Sorano Cloud, FY2026 = 2026/4–2027/3, unit 億円).
// Values are Japanese labels on purpose: they are what humans see and what the LLM names in tool calls.

export const MONTHS = ["4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月"] as const;
export const MONTH_YM = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"];
export const LAST_ACTUAL = 6; // index of 10月: actuals are closed through October

export const REGIONS = ["日本", "北米", "欧州"] as const;
export const SEGMENTS = ["SMB", "Mid", "Enterprise"] as const;
export const PRODUCTS = ["Core", "Analytics", "Connect"] as const;
export type Region = (typeof REGIONS)[number];
export type Segment = (typeof SEGMENTS)[number];
export type Product = (typeof PRODUCTS)[number];

export type VersionId = "budget" | "v04" | "v05" | "v06" | "v07" | "v08" | "v09" | "v10";
export const VERSIONS: { id: VersionId; label: string; asOf: number; kind: "budget" | "forecast" }[] = [
  { id: "budget", label: "予算", asOf: -1, kind: "budget" },
  { id: "v04", label: "4月版", asOf: 0, kind: "forecast" },
  { id: "v05", label: "5月版", asOf: 1, kind: "forecast" },
  { id: "v06", label: "6月版", asOf: 2, kind: "forecast" },
  { id: "v07", label: "7月版", asOf: 3, kind: "forecast" },
  { id: "v08", label: "8月版", asOf: 4, kind: "forecast" },
  { id: "v09", label: "9月版", asOf: 5, kind: "forecast" },
  { id: "v10", label: "10月版", asOf: 6, kind: "forecast" },
];
export const versionLabel = (id: string) => VERSIONS.find((v) => v.id === id)?.label ?? id;
export const versionByLabel = (s: string): VersionId | undefined =>
  (VERSIONS.find((v) => v.id === s || v.label === s || v.label === s.replace(/版$/, "") + "版")?.id) as VersionId | undefined;

// P/L accounts. sign: +1 adds to operating profit (revenue), -1 subtracts (cost).
export type BridgeGroup = "新規ARR" | "既存・解約" | "売上原価" | "人件費" | "その他販管費";
export const ACCOUNTS: { account: string; line: "売上" | "売上原価" | "販管費"; bridge: BridgeGroup; sign: 1 | -1 }[] = [
  { account: "既存サブスク売上", line: "売上", bridge: "既存・解約", sign: 1 },
  { account: "新規サブスク売上", line: "売上", bridge: "新規ARR", sign: 1 },
  { account: "サービス売上", line: "売上", bridge: "既存・解約", sign: 1 },
  { account: "ホスティング費", line: "売上原価", bridge: "売上原価", sign: -1 },
  { account: "カスタマーサポート費", line: "売上原価", bridge: "売上原価", sign: -1 },
  { account: "営業人件費", line: "販管費", bridge: "人件費", sign: -1 },
  { account: "開発人件費", line: "販管費", bridge: "人件費", sign: -1 },
  { account: "管理人件費", line: "販管費", bridge: "人件費", sign: -1 },
  { account: "マーケティング費", line: "販管費", bridge: "その他販管費", sign: -1 },
  { account: "オフィス・IT費", line: "販管費", bridge: "その他販管費", sign: -1 },
  { account: "その他経費", line: "販管費", bridge: "その他販管費", sign: -1 },
];
export const BRIDGE_ORDER: BridgeGroup[] = ["新規ARR", "既存・解約", "売上原価", "人件費", "その他販管費"];


// Measures the cube understands (business words → SQL expression over fact_pl joined with dim_account).
export const MEASURES = {
  売上: "sum(CASE WHEN a.line='売上' THEN p.amount ELSE 0 END)",
  売上原価: "sum(CASE WHEN a.line='売上原価' THEN p.amount ELSE 0 END)",
  販管費: "sum(CASE WHEN a.line='販管費' THEN p.amount ELSE 0 END)",
  人件費: "sum(CASE WHEN a.bridge='人件費' THEN p.amount ELSE 0 END)",
  費用: "sum(CASE WHEN a.sign=-1 THEN p.amount ELSE 0 END)",
  営業利益: "sum(p.amount * a.sign)",
  新規サブスク売上: "sum(CASE WHEN a.account='新規サブスク売上' THEN p.amount ELSE 0 END)",
  既存サブスク売上: "sum(CASE WHEN a.account='既存サブスク売上' THEN p.amount ELSE 0 END)",
} as const;
export type Measure = keyof typeof MEASURES;
export const DIMENSIONS = { region: "p.region", segment: "p.segment", product: "p.product", month: "p.month", account: "p.account", line: "a.line", bridge: "a.bridge" } as const;
export type Dim = keyof typeof DIMENSIONS;
export const DIM_LABEL: Record<Dim, string> = { region: "地域", segment: "セグメント", product: "製品", month: "月", account: "科目", line: "区分", bridge: "ブリッジ区分" };
