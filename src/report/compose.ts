// compose_report: turn what the EDA left behind (notes, widgets, fixed charts, the action history) into a
// report@1 spec. The LLM passes only the outline and material IDs; this module swaps IDs for the real things.
import { toolLabel } from "../shared/tool-labels";
import * as cube from "../data/cube";
import { versionLabel } from "../data/model";
import { sg, numberPrecision } from "../shared/charts";
import { actions, clock, getState, type ReportSpec } from "../state/store";
import { history } from "../agent/bridge";
import { materializeAll } from "./figures";
import { reportCatalog, type FigureSourceT } from "./catalog";

type Section = { title: string; body?: string; materials?: string[]; bullets?: string[] };
type Input = { title: string; audience?: string; summary?: string; sections?: Section[] };

export function reportGuide() {
  const s = getState();
  return `# report@1（報告書の素材）
compose_report の sections[].materials に、次のIDを並べる。本文 body には **太字** と [注記番号]（例: [2]）が使える。数字は query_data で確かめた値だけを書く。

いま使える素材:
${s.notes.map((n) => `- note:${n.n}${n.inReport ? "" : "（人間が報告書から外した）"} — ${n.text.slice(0, 60)}…`).join("\n") || "- （注記はまだありません）"}
${s.widgets.map((w) => `- widget:${w.id} — 生成ウィジェット「${w.title}」${w.status === "ready" ? "" : `（${w.status}）`}`).join("\n")}
- chart:bridge — 営業利益ブリッジ（比較元 → 10月版）
- chart:heat — 売上差異率 地域×セグメント
- chart:trend — 月次売上の推移
- chart:quarter — 新規ARR 四半期
- chart:accuracy — 地域別フォーキャスト誤差
- table:slipped — 来期へ移った案件の表
- table:scenario — シナリオ3ケースの表（いまの共有状態の前提）
- kpi:headline — 要旨の数字（営業利益、売上要因、北米Ent、基本シナリオ）
付録の「分析の経緯」は操作履歴から自動で付く。`;
}

export async function headlineKpis() {
  const s = getState();
  const cmp = s.compare;
  const f = s.filters;
  const [k, b, sc] = await Promise.all([
    cube.kpis("v10", cmp, f), cube.bridge(cmp, "v10", f),
    cube.scenarioPL({ slipBack: s.scenario.values["/scenario/slipBack"], winRate: s.scenario.values["/scenario/winRate"], naBias: s.scenario.values["/scenario/naBias"], filters: f }),
  ]);
  const op = k.find((x) => x.key === "op")!, rev = k.find((x) => x.key === "rev")!;
  const drop = op.cur - op.cmp, revPart = b.steps[0].value + b.steps[1].value;
  const precision = numberPrecision([drop, revPart, rev.cur - rev.cmp, sc.base - op.cur]);
  const scope = Object.values(f).filter(Boolean).join(" / ") || "全社";
  return { cmpLabel: versionLabel(cmp), op, drop, revPart, revDiff: rev.cur - rev.cmp, scenario: sc,
    items: [
      { label: `${scope} 営業利益`, value: op.cur.toFixed(precision), unit: "億円", delta: `${sg(drop, precision)} vs ${versionLabel(cmp)}`, tone: drop < 0 ? "bad" as const : "good" as const },
      { label: "うち売上要因", value: sg(revPart, precision), unit: "億円", delta: "営業利益への増減寄与", tone: "muted" as const },
      { label: `${scope} 売上`, value: rev.cur.toFixed(precision), unit: "億円", delta: `${sg(rev.cur - rev.cmp, precision)} vs ${versionLabel(cmp)}`, tone: "muted" as const },
      { label: `${scope} 基本シナリオ`, value: sc.base.toFixed(precision), unit: "億円", delta: `戻り${s.scenario.values["/scenario/slipBack"]}% · 成約率${s.scenario.values["/scenario/winRate"]}%`, tone: "muted" as const },
    ],
  };
}

export async function composeReport(input: Input) {
  const s = getState();
  const cmp = s.compare;
  const filters = structuredClone(s.filters);
  const scope = Object.values(filters).filter(Boolean).join(" / ") || "全社";
  const elements: ReportSpec["elements"] = {};
  let k = 0;
  const add = (type: string, props: Record<string, unknown>, children?: string[]) => { const key = `e${++k}`; elements[key] = { type, props, children: children ?? [] }; return key; };
  let fig = 0, figures = 0;
  const used = new Set<number>();
  const material = async (id: string): Promise<string | null> => {
    const [kind, arg] = id.split(":");
    const F = (caption: string, source: FigureSourceT) => { figures++; return add("Figure", { no: `図${++fig}`, caption, source }); };
    switch (kind) {
      case "note": {
        const n = s.notes.find((x) => x.n === Number(arg));
        if (!n) throw new Error(`素材 ${id} はありません`);
        if (!n.inReport) throw new Error(`素材 ${id} は人が報告書から外しています`);
        used.add(n.n);
        return add("Finding", { n: n.n, text: n.text, agent: n.agent });
      }
      case "widget": {
        const w = s.widgets.find((x) => x.id === arg);
        if (!w) throw new Error(`素材 ${id} はありません`);
        if (w.status !== "ready") throw new Error(`素材 ${id} は描画が完了していません`);
        return F(w.title, { kind: "widget", widget: w.id, title: w.title });
      }
      case "chart":
        if (arg === "bridge") return F(`営業利益ブリッジ（${versionLabel(cmp)} → 10月版、${scope}、億円）`, { kind: "bridge", from: cmp, to: "v10", filters });
        if (arg === "heat") return F(`売上差異率（${versionLabel(cmp)}比）`, { kind: "heat", compare: cmp, filters });
        if (arg === "trend") return F(`月次売上の推移（${versionLabel(cmp)}と10月版）`, { kind: "trend", compare: cmp, filters });
        if (arg === "quarter") return F("新規ARR 四半期", { kind: "quarter", compare: cmp, filters });
        if (arg === "accuracy") return F("翌月新規ARRの見通し誤差（地域別）", { kind: "accuracy", versions: 6 });
        break;
      case "table":
        if (arg === "slipped") { const c = { ...s.filters, ...s.view.context }; return F("来期へ移った案件（億円）", { kind: "slipped", region: c.region ?? null, segment: c.segment ?? null, product: c.product ?? null }); }
        if (arg === "scenario") { const v = s.scenario.values; return F("シナリオ別の通期営業利益（選択範囲・億円）", { kind: "scenario", slipBack: v["/scenario/slipBack"], winRate: v["/scenario/winRate"], naBias: v["/scenario/naBias"], filters }); }
        break;
      case "kpi": return add("KpiRow", { items: (await headlineKpis()).items });
    }
    throw new Error(`素材 ${id} は分かりません。get_catalog { name: "report@1" } を参照`);
  };

  const head = await headlineKpis();
  let sections = input.sections;
  if (!sections?.length) {
    // auto: one chapter per note, each with the chart its target points at
    const pick = (t: string) => (t.startsWith("bridge") || t.startsWith("kpi") ? "chart:bridge" : t.startsWith("row") || t.startsWith("heat") ? "chart:heat" : t.startsWith("stage") || t.startsWith("slip") || t.startsWith("deal") ? "table:slipped" : t.startsWith("widget:") ? `widget:${t.slice(7).split("/")[0]}` : null);
    sections = s.notes.filter((n) => n.inReport).map((n) => ({ title: n.text.split(/[。.]/)[0].slice(0, 40), materials: [`note:${n.n}`, ...(pick(n.target) ? [pick(n.target)!] : [])] }));
  }

  if (!sections.length) sections = [{ title: `${scope}の業績と差異`, materials: ["chart:bridge", "chart:trend", "table:scenario"] }];

  const top: string[] = [];
  top.push(add("Section", { no: "", title: "要旨", anchor: "rp-summary" }, [
    ...(input.summary ? [add("Headline", { text: input.summary })] : []),
    add("KpiRow", { items: head.items }),
  ]));
  const seen = new Set<string>();
  for (const [i, sec] of sections.entries()) {
    const kids: string[] = [];
    if (sec.body) { kids.push(add("Paragraph", { text: sec.body })); for (const m of sec.body.matchAll(/\[(\d{1,2})\]/g)) if (s.notes.some((n) => n.n === Number(m[1]))) used.add(Number(m[1])); }
    for (const m of sec.materials ?? []) { if (seen.has(m) && !m.startsWith("note:")) continue; seen.add(m); const e = await material(m); if (e) kids.push(e); }
    if (sec.bullets?.length) kids.push(add("Bullets", { items: sec.bullets }));
    top.push(add("Section", { no: String(i + 1), title: sec.title, anchor: `rp-s${i + 1}` }, kids));
  }
  const groups = getState().activity;
  const trail = groups.flatMap((g) => g.items.filter((it) => it.who === "agent" && !it.running && it.tool && it.tool !== "get_catalog").map((it) => ({ at: it.at, tool: toolLabel(it.tool!), text: it.result || "" })));
  const undoable = history.entries().filter((e: any) => e.source === "agent" && !e.reverted).length;
  top.push(add("Section", { no: "付録", title: "分析の経緯", anchor: "rp-trail" }, [add("Paragraph", { text: "分析時の操作と参照した条件。本文の番号は注記に対応します。" }), add("Trail", { items: [...trail, { at: clock(), tool: "レポートを作成", text: "分析結果をまとめました" }], undoable })]));
  const root = add("Document", { title: input.title, eyebrow: `Sorano Cloud · FP&A · 2026年10月版 · ${input.audience ? `${input.audience}向け · ` : ""}社外秘`, author: s.activity.at(-1)?.agent ?? "エージェント", materials: `注記${used.size}件 · 図表${figures}点 · 操作${trail.length}件から構成` }, top);
  const spec: ReportSpec = { root, elements };
  const check = reportCatalog.validate(spec);
  if (!check.success) throw new Error(`報告書specが不正です: ${JSON.stringify((check as any).error?.issues?.slice(0, 3) ?? check).slice(0, 300)}`);
  const blocks = await materializeAll(spec, 500);
  actions.setReport({ spec, blocks, widgets: structuredClone(s.widgets), scenario: structuredClone(s.scenario), title: input.title, at: clock(), materials: used.size + figures });
  return { sections: sections.length, figures, notes: used.size, trail: trail.length, highlightTargets: ["report:summary", ...sections.map((_, i) => `report:s${i + 1}`)] };
}
