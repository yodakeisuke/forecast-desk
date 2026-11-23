// The Jev request (TypeSafe decision model) and how its answers become a Plan. Shared by the dev-server
// relay (which builds the request, so the browser can never choose what the key is used for) and the
// unit tests. Jev returns probabilities over fixed options; it never writes text or numbers.
import { versionLabel } from "../data/model";
import { COMPARE_IDS, MEMBERS, SLOTS, KPIS, sanitize, statedPercent, type Dim, type KpiKey, type Plan, type Screen, type Slot } from "./plan";

export const JEV_MODEL_DEFAULT = "jev-latest";
type Criteria = Record<string, string>;
type Question = { type: "choice"; instructions: string; criteria: Criteria };
export type JevRequest = { model: string; state: Record<string, unknown>; questions: Record<string, Question> };
export type JevChoice = { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> };
export type JevAnswers = Record<string, JevChoice>;

const KEEP = "The question does not mention this; keep what is on screen.";
const versionText: Record<string, string> = {
  budget: "the annual budget (予算)", v04: "the April forecast version (4月版)", v05: "the May forecast version (5月版)", v06: "the June forecast version (6月版)",
  v07: "the July forecast version (7月版)", v08: "the August forecast version (8月版)",
  v09: "the previous month's forecast (前月版 / 先月 / 前回 / 9月版)",
};
const memberText: Record<Dim, Record<string, string>> = {
  region: { 日本: "Japan (日本)", 北米: "North America (北米 / 米国)", 欧州: "Europe (欧州 / ヨーロッパ)" },
  segment: { SMB: "small businesses (SMB / 中小)", Mid: "mid-market (Mid / 中堅)", Enterprise: "large enterprises (Enterprise / エンタープライズ / 大企業)" },
  product: { Core: "the Core product", Analytics: "the Analytics product", Connect: "the Connect product" },
};
const allText: Record<Dim, string> = {
  region: "All regions / the whole company (全社 / 全体 / 全地域).",
  segment: "All segments (全セグメント).",
  product: "All products (全製品).",
};
const SLOT_TEXT: Record<Slot, string> = {
  "c-bridge": "Operating profit and what moved it between versions (利益 / コスト / 費用 / 'how is it' questions about profit).",
  "c-trend": "Monthly revenue trend and the full-year landing (売上の推移 / 着地 / 月次).",
  "c-var": "Breakdown of the gap by region, segment or product (内訳 / どこで / セグメント別 / 製品別).",
  "c-heat": "A grid of variance % for every region × segment (一覧 / ヒートマップ / 全体を見渡す).",
  "c-q": "New ARR by quarter (新規ARR / 受注 / ブッキング / 四半期).",
  "c-drv": "Driver assumptions over versions (成約率 / 単価 / 解約率 / 人員 / 為替 の推移).",
  "c-scenario": "What-if: operating profit if assumptions change (〜したら / 〜なら / 戻ったら / 試算).",
};
const KPI_TEXT: Record<KpiKey, string> = {
  op: "Full-year operating profit (営業利益 / 利益 / 着地 — the default).", rev: "Full-year revenue (売上).", newarr: "New ARR (新規ARR / 受注).",
  margin: "Operating margin (利益率 / マージン).", churn: "Monthly churn (解約率 / チャーン).",
};

export function buildJevRequest(question: string, screen: Screen, model = JEV_MODEL_DEFAULT): JevRequest {
  const f = screen.filters;
  const dimQ = (d: Dim, what: string): Question => ({
    type: "choice",
    instructions: `Which ${what} should the dashboard show to answer the meeting question?`,
    criteria: { keep: KEEP, all: allText[d], ...Object.fromEntries(MEMBERS[d].map((m) => [m, memberText[d][m]])) },
  });
  return {
    model,
    state: {
      meeting_question: question,
      context: "A finance (FP&A) manager is presenting the October forecast (10月版) in a meeting. Someone asked the meeting question above, usually in Japanese. Decide how to change the dashboard so it answers the question.",
      screen_now: {
        compared_with: versionLabel(screen.compare), region: f.region ?? "all", segment: f.segment ?? "all", product: f.product ?? "all",
        scenario_win_rate_percent: screen.scenario.winRate, scenario_slipped_deals_back_percent: screen.scenario.slipBack,
      },
      glossary: "予算 budget · 版 forecast version · 前月版/先月/前回 previous month's version · 着地 full-year landing · 営業利益 operating profit · 売上 revenue · 成約率 win rate · スリップ/期ずれ slipped deals · なぜ/理由/要因/原因 why · だけ only",
    },
    questions: {
      intent: {
        type: "choice",
        instructions: "What kind of question is this?",
        criteria: {
          answer_on_screen: "It asks for numbers or a view the dashboard can show by changing the comparison version, the region/segment/product filters, the scenario assumptions or which chart is shown.",
          ask_why: "It asks why something happened, its cause or reason (なぜ / 理由 / 要因 / 原因). That needs investigation, not only a different view.",
          not_on_dashboard: "It is about something this forecast dashboard does not contain (competitors, the market, people, other companies), or it is not a question about the forecast.",
        },
      },
      compare: { type: "choice", instructions: "Which version should the October forecast be compared with?", criteria: { keep: KEEP, ...Object.fromEntries(COMPARE_IDS.map((id) => [id, `Compare with ${versionText[id]}.`])) } },
      region: dimQ("region", "region"),
      segment: dimQ("segment", "customer segment"),
      product: dimQ("product", "product"),
      focus: { type: "choice", instructions: "Which chart answers the question most directly?", criteria: Object.fromEntries(SLOTS.map((s) => [s, SLOT_TEXT[s]])) },
      kpi: { type: "choice", instructions: "Which headline number should be the main KPI for this question?", criteria: Object.fromEntries(KPIS.map((k) => [k, KPI_TEXT[k]])) },
      win_rate: {
        type: "choice",
        instructions: "Does the question change the win-rate assumption (成約率) of the scenario?",
        criteria: {
          keep: "The question does not mention the win rate.",
          previous_month: "Back to the previous month's level (戻ったら / 9月版並み / 前月並み).",
          stated_value: "The question states a specific win rate, e.g. 30%.",
          up_small: "A little higher, about +1 point.", up_large: "Much higher, about +3 points.", down: "Lower, about −2 points.",
        },
      },
      slip_back: {
        type: "choice",
        instructions: "Does the question assume that slipped deals (スリップ / 期ずれした案件) come back into this fiscal year?",
        criteria: { keep: "The question does not mention slipped deals.", all: "All slipped deals come back.", half: "About half of them come back.", none: "None of them come back." },
      },
    },
  };
}

const p = (a: JevChoice | undefined) => (a ? a.probabilities?.[a.choice] ?? a.confidence ?? 0 : 0);
/** below this probability a dimension stays as it is on screen */
export const KEEP_BELOW = 0.6;

export function planFromJev(answers: JevAnswers, question: string, screen: Screen): Plan {
  const conf: Record<string, number> = {};
  const pick = (key: string) => { const a = answers[key]; conf[key] = p(a); return a && conf[key] >= KEEP_BELOW && a.choice !== "keep" ? a.choice : null; };
  const intent = answers.intent;
  conf.intent = p(intent);
  const kind = !intent || conf.intent < 0.5 ? "unsupported" : intent.choice === "ask_why" ? "handoff" : intent.choice === "not_on_dashboard" ? "unsupported" : "answer";
  const win = pick("win_rate");
  const cur = screen.scenario.winRate;
  const winRate = win === "previous_month" ? screen.refs.winRate09 : win === "stated_value" ? statedPercent(question, /成約率|win ?rate/i) : win === "up_small" ? cur + 1 : win === "up_large" ? cur + 3 : win === "down" ? cur - 2 : null;
  const slip = pick("slip_back");
  const slipBack = slip === "all" ? 100 : slip === "half" ? 50 : slip === "none" ? 0 : null;
  // second card: the next most likely chart, when Jev gives it real weight
  const fp = answers.focus?.probabilities ?? {};
  const ranked = Object.entries(fp).sort((a, b) => b[1] - a[1]).map(([k]) => k as Slot);
  const first = (answers.focus?.choice as Slot) ?? ranked[0];
  conf.focus = p(answers.focus);
  const focus = [first, ...ranked.filter((s) => s !== first && (fp[s] ?? 0) >= 0.25).slice(0, 1)].filter(Boolean) as Slot[];
  const kpiA = answers.kpi;
  conf.kpi = p(kpiA);
  return sanitize({
    kind,
    compare: kind === "unsupported" ? null : (pick("compare") as Plan["compare"]),
    region: kind === "unsupported" ? null : pick("region"),
    segment: kind === "unsupported" ? null : pick("segment"),
    product: kind === "unsupported" ? null : pick("product"),
    winRate: kind === "unsupported" ? null : winRate,
    slipBack: kind === "unsupported" ? null : slipBack,
    focus: winRate !== null || slipBack !== null ? (["c-scenario", ...focus.filter((s) => s !== "c-scenario")] as Slot[]).slice(0, 2) : focus,
    kpi: kpiA && conf.kpi >= 0.4 ? (kpiA.choice as KpiKey) : "op",
    confidence: conf,
  });
}

/** Answers must name only options that were offered: anything else is dropped before mapping. */
export function checkAnswers(req: JevRequest, raw: unknown): JevAnswers {
  const out: JevAnswers = {};
  const answers = (raw as { answers?: Record<string, unknown> })?.answers;
  if (!answers || typeof answers !== "object") return out;
  for (const [key, q] of Object.entries(req.questions)) {
    const a = answers[key] as JevChoice | undefined;
    if (!a || typeof a.choice !== "string" || !(a.choice in q.criteria)) continue;
    const probabilities: Record<string, number> = {};
    for (const opt of Object.keys(q.criteria)) { const v = a.probabilities?.[opt]; if (typeof v === "number" && v >= 0 && v <= 1) probabilities[opt] = v; }
    out[key] = { type: "choice", choice: a.choice, confidence: typeof a.confidence === "number" ? a.confidence : undefined, probabilities };
  }
  return out;
}
