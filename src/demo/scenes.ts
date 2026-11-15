// The demo player: the story's requests, played with the same tools an agent calls over WebMCP.
// Nothing on screen is scripted: every step is a real tool call on real data, and the notes quote the
// numbers those calls returned. With ChatGPT or Claude connected, they make these same calls themselves.
import { call as rawCall, setRequest } from "../agent/tools";
import { actions, getState } from "../state/store";
import { broadcastState } from "../genui/host";
import { sg } from "../shared/charts";
import { scenarioPL } from "../data/cube";
import { accuracyWidget, exfilWidget, scenarioWidget } from "./widgets";

type Ctx = Record<string, any>;
export type Scene = { t: string; q: string; security?: boolean; run: (step: Step, ctx: Ctx) => Promise<void> };
type Step = { call: (name: string, input?: unknown) => Promise<any>; wait: (ms: number) => Promise<void> };

const r1 = (n: number) => Math.round(n * 10) / 10;
const abs1 = (n: number) => Math.abs(r1(n)).toFixed(1);
const pct = (a: number, b: number) => Math.round((a / b) * 100);

export const SCENES: Scene[] = [
  {
    t: "問いを受けて比較を切替", q: "通期の営業利益見通しが、前回から下がった理由を見て",
    async run(s, ctx) {
      await s.call("snapshot", {});
      const f = await s.call("set_filter", { compare_from: "9月版" });
      const op = f.kpis.op, steps = f.bridge.steps as { group: string; diff: number }[];
      const rev = steps.filter((x) => x.group === "新規ARR" || x.group === "既存・解約").reduce((a, x) => a + x.diff, 0);
      const top = [...steps].sort((a, b) => a.diff - b.diff)[0];
      Object.assign(ctx, { op, rev, drop: op.diff });
      await s.wait(700);
      await s.call("highlight", { target: "bridge:売上", note: `9月版${op.cmp.toFixed(1)}億円から${abs1(op.diff)}億円の低下。うち${abs1(rev)}億円（${pct(rev, op.diff)}%）が売上要因で、最大は${top.group}の${sg(top.diff)}億円です。まず売上を分解します。` });
    },
  },
  {
    t: "ドリルダウン", q: "（続けて）売上の内訳を掘る",
    async run(s, ctx) {
      const d = await s.call("drill_down", { member: "北米", by: ["region", "segment"] });
      const t = d.top[0];
      ctx.naEnt = t;
      await s.wait(700);
      await s.call("highlight", { target: `row:${t.member}`, note: `${t.member.replace("/", " ")}だけで${sg(t.diff)}億円（${sg(t.pct)}%）。売上差異の${t.shareOfTotalDiff}がここに集中しています。右のヒートマップでも突出しています。` });
    },
  },
  {
    t: "ドリルアクロス", q: "なんで北米？",
    async run(s, ctx) {
      const d = await s.call("drill_across", { to: "pipeline", keep: { region: "北米", segment: "Enterprise" } });
      const late = d.pipeline.stages.filter((x: any) => x.stage === "交渉"); // cumulative funnel: commit is already included
      const lateDiff = late.reduce((a: number, x: any) => a + x.diff, 0);
      ctx.slipped = d.pipeline.slipped;
      await s.wait(700);
      await s.call("highlight", { target: "stages:late", note: `交渉以上の段階で${abs1(lateDiff)}億円が減少。失注ではなく、今期クローズ予定の大型${d.pipeline.slipped.count}件（ARR ${d.pipeline.slipped.arr.toFixed(1)}億円）が来期へ移っています。今期売上への影響は${sg(d.pipeline.slipped.revenueImpact)}億円。` });
    },
  },
  {
    t: "ドリルスルー", q: "その3件を見せて",
    async run(s, ctx) {
      const d = await s.call("drill_through", {});
      ctx.deals = d.deals;
      const months = [...new Set(d.deals.map((x: any) => Number(String(x.close).split("→")[1]?.trim().split("-")[1])))].sort((a: any, b: any) => a - b);
      const reasons = [...new Set(d.deals.map((x: any) => x.reason).filter(Boolean))].join("・");
      await s.wait(700);
      await s.call("highlight", { target: "deals:dates", note: `${d.deals.length}件とも新しい予定日は来期の${months.map((m) => `${m}月`).join("〜")}。理由は${reasons}で、前倒しできれば今期に戻せる余地があります。` });
    },
  },
  {
    t: "ドリルアップ ＋ GenUI", q: "北米の見通しって、そもそも当たるの？",
    async run(s, ctx) {
      await s.call("drill_up", { levels: 4 });
      const acc = await s.call("explore_sql", { sql: `SELECT f.region, round(avg((f.amount / x.amount - 1) * 100), 1) AS avg_err, round(min((f.amount / x.amount - 1) * 100), 1) AS min_err, count(*) AS n
FROM fc_version v
JOIN fact_newarr f ON f.version_id = v.version_id AND f.kind = 'forecast' AND f.month = v.as_of_month + 1
JOIN fact_newarr x ON x.kind = 'actual' AND x.region = f.region AND x.month = f.month
WHERE v.kind = 'forecast' GROUP BY 1 ORDER BY 2 DESC` });
      const na = (acc.rows ?? []).find((r: any) => r.region === "北米") ?? { avg_err: 0, min_err: 0, n: 0 };
      const others = (acc.rows ?? []).filter((r: any) => r.region !== "北米").map((r: any) => Math.abs(Number(r.avg_err)));
      ctx.naBias = Number(na.avg_err);
      const insight = Number(na.min_err) > 0
        ? `北米は${na.n}版すべてで見通しが実績を上回りました（平均${sg(Number(na.avg_err))}%）。日本・欧州は平均±${Math.max(...others).toFixed(1)}%以内です。`
        : `北米の見通し誤差は平均${sg(Number(na.avg_err))}%です。`;
      await s.call("get_catalog", { name: "fpa@1" });
      const w = await s.call("render_widget", { title: "フォーキャスト精度 · 地域別", subtitle: "翌月新規ARRの見通し誤差（見通し ÷ 実績 − 1）· 過去6版", code: accuracyWidget({ insight }) });
      ctx.accWidget = w.widget;
      await s.wait(700);
      await s.call("highlight", { target: `widget:${w.widget}`, note: `${insight}今回の北米の数字も、同じくらい割り引いて見るべきです。` });
    },
  },
  {
    t: "シナリオを共同編集", q: "スリップが半分戻ったら？",
    async run(s, ctx) {
      const win = await s.call("explore_sql", { sql: "SELECT version_id, round(avg(value), 1) AS win FROM fact_driver WHERE driver = '成約率' AND region = '北米' AND segment = 'Enterprise' AND version_id IN ('v09', 'v10') GROUP BY 1 ORDER BY 1" });
      const w09 = Number(win.rows?.find((r: any) => r.version_id === "v09")?.win ?? 25), w10 = Number(win.rows?.find((r: any) => r.version_id === "v10")?.win ?? 22);
      const w = await s.call("render_widget", { title: "北米Enterprise · 営業利益シナリオ", subtitle: "前提は人とAgentの共同編集", code: scenarioWidget({ win10: w10, win09: w09, slipArr: ctx.slipped?.arr ?? 0 }) });
      ctx.scenWidget = w.widget;
      await s.wait(500);
      const r = await s.call("operate_widget", { widget: w.widget, steps: [{ ref: "スリップ3件の戻り率", action: "setValue", args: [50] }] });
      void r;
      await s.wait(400);
      const base = await scenarioBase();
      await s.call("highlight", { target: `widget:${w.widget}/スリップ3件の戻り率`, note: `半分戻れば北米Enterpriseの通期営業利益は${base.toFixed(1)}億円。Agentが入れた値には印が付き、ドラッグで上書きも、Agentの変更だけを戻すこともできます。` });
      await s.wait(2400);
      // the person takes over the other driver (in a live session they drag it themselves)
      actions.closeNotes();
      for (const v of [w10 + 1, w10 + 2]) { actions.setScenario("/scenario/winRate", v, "user"); broadcastState("/scenario/winRate"); await s.wait(420); }
      actions.pushItem({ who: "user", result: `北米Ent 成約率を ${w10 + 2}% に変更（ウィジェット）`, running: false });
    },
  },
  {
    t: "報告書を組む", q: "この流れでCFO向けに1枚にして",
    async run(s, ctx) {
      await s.call("get_catalog", { name: "report@1" });
      const k = await s.call("query_data", { measure: "営業利益", compare: ["9月版", "10月版"] });
      void k;
      const base = await scenarioBase();
      const n = (i: number) => `[${i}]`;
      const deals = (ctx.deals ?? []) as { company: string }[];
      const sv = getState().scenario.values;
      await s.call("compose_report", {
        title: "10月版 フォーキャスト報告",
        summary: `通期営業利益の見通しは9月版から${abs1(ctx.op?.diff ?? 0)}億円減の${(ctx.op?.cur ?? 0).toFixed(1)}億円。主因は北米Enterpriseの大型案件が来期にずれたこと`,
        audience: "CFO",
        sections: [
          { title: "何が起きたか", body: `低下${abs1(ctx.op?.diff ?? 0)}億円のうち**${abs1(ctx.rev ?? 0)}億円が売上要因** ${n(1)}。費用側の動きは図1のとおり。`, materials: ["chart:bridge"] },
          { title: "なぜ起きたか", body: `売上差異は**北米Enterpriseに集中**（${sg(ctx.naEnt?.diff ?? 0)}億円、差異の${ctx.naEnt?.shareOfTotalDiff ?? "—"}）${n(2)}。今期クローズ予定だった**大型${ctx.slipped?.count ?? "—"}件（ARR ${(ctx.slipped?.arr ?? 0).toFixed(1)}億円）が来期へ移動** ${n(3)}。いずれも失注ではなく延期 ${n(4)}。`, materials: ["chart:heat", "table:slipped"] },
          { title: "見通しの信頼性", body: `北米の見通しは過去6版で実績を上回る傾向（平均${sg(ctx.naBias ?? 0)}%）${n(5)}。`, materials: ctx.accWidget ? [`widget:${ctx.accWidget}`] : ["chart:accuracy"] },
          { title: "シナリオ", body: `スリップ案件の戻り率と北米Entの成約率で3ケースを試算 ${n(6)}。北米Enterpriseの基本ケースは**${base.toFixed(1)}億円**（戻り${sv["/scenario/slipBack"]}% · 成約率${sv["/scenario/winRate"]}%）。`, materials: ["table:scenario", ...(ctx.scenWidget ? [`widget:${ctx.scenWidget}`] : [])] },
          { title: "提案", bullets: [deals[0] ? `${deals[0].company}など${deals.length}件の今期内クローズを経営層で支援する` : "来期へ移った案件の今期内クローズを支援する", `北米の見通しに過去の偏り（${sg(ctx.naBias ?? 0)}%）を補正する運用を11月版から入れる`, `基本${base.toFixed(1)}億円を社内見通し、悲観ケースを下限として共有する`] },
        ],
      });
      await s.wait(900);
      await s.call("highlight", { target: "report:summary", note: "要旨の数字は注記1〜6とダッシュボードの集計から引いています。本文の番号から根拠の画面に戻れ、操作の経緯は付録に残ります。" });
    },
  },
  {
    t: "防御を確かめる", q: "（攻撃テスト）案件メモに埋め込まれた指示に従ったら？", security: true,
    async run(s) {
      actions.setPage("overview");
      // the agent reads CRM memos; one of them carries an instruction (returned as untrusted data)
      await s.call("explore_sql", { sql: "SELECT company, owner, note FROM fact_deal WHERE region = '欧州' AND segment = 'Mid' AND note LIKE '%AI%' LIMIT 3" });
      await s.wait(900);
      // An agent that obeyed the memo would write this. The wall, not the agent, is what stops it.
      const w = await s.call("render_widget", { title: "（攻撃テスト）外部送信を試みるウィジェット", subtitle: "CRMメモの指示に従った場合の挙動", code: exfilWidget });
      await s.wait(1500);
      await s.call("drill_up", { levels: 4 });
      void w;
      actions.setPage("security");
    },
  },
];

/** The base case at the current driver values (the demo's own name; not cube.scenarioBase). */
async function scenarioBase() {
  const v = getState().scenario.values;
  return (await scenarioPL({ slipBack: v["/scenario/slipBack"], winRate: v["/scenario/winRate"], naBias: v["/scenario/naBias"], filters: { region: "北米", segment: "Enterprise" } })).base;
}

// ---------- player ----------
let runId = 0;
export class Cancel extends Error {}
export function makeStep(id: number, fast: boolean): Step {
  const alive = () => { if (id !== runId) throw new Cancel("cancel"); };
  return {
    async call(name, input) {
      alive();
      const out = await rawCall(name, input ?? {}, "demo");
      alive();
      if (out && typeof out === "object" && ((out as { ok?: boolean }).ok === false || (out as { status?: string }).status === "error")) throw new Error(`${name}: ${JSON.stringify(out)}`);
      if (!fast) await new Promise((r) => setTimeout(r, 260));
      return out as any;
    },
    async wait(ms) { alive(); if (!fast) await new Promise((r) => setTimeout(r, ms)); alive(); },
  };
}
export const nextRun = () => ++runId;
export const currentRun = () => runId;
export async function playScene(i: number, ctx: Ctx, id: number, fast = false) {
  const sc = SCENES[i];
  setRequest(sc.q);
  await sc.run(makeStep(id, fast), ctx);
}
