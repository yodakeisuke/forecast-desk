// The monthly forecast review: KPIs, trend, OP bridge, variance (with the four drills), heatmap, quarterly new ARR, drivers.
import * as cube from "../data/cube";
import { MONTHS, LAST_ACTUAL, versionLabel } from "../data/model";
import { bridgeChart, heatChart, quarterChart, sparkChart, trendChart, sg } from "../shared/charts";
import { useApp } from "../state/store";
import { useCube, useWidth } from "../state/useCube";
import { Card, Delta } from "./Card";
import { Controls } from "./Controls";
import { Check } from "./icons";
import { Spark, SvgChart } from "./SvgChart";
import { VarianceCard } from "./VarianceCard";
import { ScenarioControls } from "./ScenarioControls";
import { WidgetZone } from "./WidgetCard";
import { AskPanel, FoldRow, QuestionList } from "./Meeting";
import { useLayout, useMeeting } from "../meeting/session";
import { DEFAULT_ORDER, type Slot } from "../meeting/plan";
import type { ReactNode } from "react";

function useCtx() {
  const version = useApp((s) => s.version), compare = useApp((s) => s.compare), filters = useApp((s) => s.filters);
  return { version, compare, filters, key: `${version}|${compare}|${filters.region ?? ""}|${filters.segment ?? ""}|${filters.product ?? ""}` };
}

function Kpis() {
  const { version, compare, filters, key } = useCtx();
  const kp0 = useCube(`kpis|${key}`, () => cube.kpis(version, compare, filters));
  // in meeting mode the question's headline number leads
  const hero = useLayout()?.kpi;
  const kp = kp0 && hero ? [...kp0.filter((o) => o.key === hero), ...kp0.filter((o) => o.key !== hero)].map((o) => ({ ...o, hero: o.key === hero })) : kp0;
  return (
    <section className="card dimmable kpis" id="kpis" data-target="card:kpis">
      {(kp ?? []).map((o) => {
        const worse = (o.cur - o.cmp) * (o.up ? 1 : -1) < 0;
        return (
          <div className={`kpi${o.hero ? " hero" : ""}`} key={o.key} data-target={`kpi:${o.key}`}>
            <div className="l">{o.label}</div>
            <div className="v tnum">{o.cur.toFixed(o.d)}<small>{o.unit}</small></div>
            <div className="spk"><Spark chart={sparkChart(o.history, 72, 30, worse ? "neg" : "ink2")} /></div>
            <div className="d"><Delta cur={o.cur} base={o.cmp} unit={o.unit} d={o.d} up={o.up} pt={o.pt} /> <span className="muted">vs {versionLabel(compare)}</span></div>
          </div>
        );
      })}
      {!kp && <div className="kpi hero"><div className="l">読み込み中…</div></div>}
    </section>
  );
}

function TrendCard() {
  const { version, compare, filters, key } = useCtx();
  const d = useCube(`trend|${key}`, () => cube.trend(version, compare, filters));
  const [ref, w] = useWidth<HTMLDivElement>();
  return (
    <Card id="c-trend" cls="c7" title="月次売上 · 実績と見通し" sub={`${versionLabel(version)}と比較元の推移`}>
      <div className="card-b">
        <div className="legend"><span><i className="ln" style={{ background: "var(--s1)" }} />{versionLabel(version)}（実績＋見通し）</span><span><i className="ln" style={{ background: "var(--ref)" }} />{versionLabel(compare)}</span></div>
        <div ref={ref}>{d && w > 0 && <SvgChart chart={trendChart({ months: [...MONTHS], cur: d.cur, cmp: d.cmp, lastActual: LAST_ACTUAL, curLabel: versionLabel(version), cmpLabel: versionLabel(compare), w })} />}</div>
      </div>
    </Card>
  );
}

function BridgeCard() {
  const { version, compare, filters, key } = useCtx();
  const d = useCube(`bridge|${key}`, () => cube.bridge(compare, version, filters));
  const [ref, w] = useWidth<HTMLDivElement>();
  return (
    <Card id="c-bridge" cls="c5" title="営業利益ブリッジ" sub={d ? `${versionLabel(compare)} → ${versionLabel(version)} · ${sg(d.to - d.from)}億円` : " "}>
      <div className="card-b"><div ref={ref}>{d && w > 0 && <SvgChart chart={bridgeChart({ fromLabel: versionLabel(compare), toLabel: versionLabel(version), from: d.from, to: d.to, steps: d.steps, w })} />}</div></div>
    </Card>
  );
}

function HeatCard() {
  const { version, compare, filters } = useCtx();
  const d = useCube(`heat|${version}|${compare}|${JSON.stringify(filters)}`, () => cube.heat(version, compare, filters));
  const [ref, w] = useWidth<HTMLDivElement>();
  return (
    <Card id="c-heat" cls="c4" title="売上差異率 · 地域 × セグメント" sub={`${versionLabel(version)} ÷ ${versionLabel(compare)} − 1`}>
      <div className="card-b">
        <div ref={ref}>{d && w > 0 && <SvgChart chart={heatChart({ rows: d, w, h: 206 })} />}</div>
        <div className="scale"><span className="tnum">−10%</span><div className="bar" /><span className="tnum">+10%</span></div>
      </div>
    </Card>
  );
}

function QuarterCard() {
  const { version, compare, filters, key } = useCtx();
  const d = useCube(`q|${key}`, () => cube.quarterlyNewArr(version, compare, filters));
  const [ref, w] = useWidth<HTMLDivElement>();
  return (
    <Card id="c-q" cls="c6" title="新規ARR · 四半期" sub="地域別集計 · セグメント・製品は全体 · Q1–Q2実績、Q3–Q4見通し">
      <div className="card-b">
        <div className="legend"><span><i className="sw" style={{ background: "var(--ref)" }} />{versionLabel(compare)}</span><span><i className="sw" style={{ background: "var(--s1)" }} />{versionLabel(version)}</span></div>
        <div ref={ref}>{d && w > 0 && <SvgChart chart={quarterChart({ cur: d.cur, cmp: d.cmp, curLabel: versionLabel(version), cmpLabel: versionLabel(compare), actualQuarters: 2, w })} />}</div>
      </div>
    </Card>
  );
}

export function DriversTable({ compact }: { compact?: boolean }) {
  const { version, compare, filters, key } = useCtx();
  const context = useApp(s => s.view.context);
  const f = compact ? { ...filters, ...context } : filters;
  const d = useCube(`drv|${key}|${JSON.stringify(f)}`, () => cube.drivers(version, compare, f));
  return (
    <table className="t" id="drivers">
      <thead><tr><th>ドライバー</th><th>{versionLabel(version)}</th><th>vs {versionLabel(compare)}</th>{!compact && <th style={{ textAlign: "right" }}>推移</th>}</tr></thead>
      <tbody>
        {(d ?? []).map((o) => (
          <tr key={o.key} data-target={`driver:${o.label}`}>
            <td>{o.label}</td>
            <td>{o.cur.toFixed(o.d)}<span className="muted" style={{ marginLeft: 2, fontSize: 11 }}>{o.unit}</span></td>
            <td><Delta cur={o.cur} base={o.cmp} unit={o.unit} d={o.d} up={o.up} pt={o.pt} /></td>
            {!compact && <td style={{ width: 100 }}><Spark chart={sparkChart(o.history, 84, 22)} /></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DriversCard() {
  return (
    <Card id="c-drv" cls="c6" title="主要ドライバー" sub="過去7版の前提の推移">
      <div className="tw" style={{ padding: "6px 0 4px" }}><DriversTable /></div>
    </Card>
  );
}

const CARDS: Record<Slot, () => ReactNode> = {
  "c-trend": () => <TrendCard key="c-trend" />, "c-bridge": () => <BridgeCard key="c-bridge" />, "c-var": () => <VarianceCard key="c-var" />,
  "c-heat": () => <HeatCard key="c-heat" />, "c-q": () => <QuarterCard key="c-q" />, "c-drv": () => <DriversCard key="c-drv" />, "c-scenario": () => <ScenarioControls key="c-scenario" />,
};

export function Overview() {
  const on = useMeeting((s) => s.on);
  const layout = useLayout();
  // one grid for every card, so meeting mode only reorders siblings (cards keep their state and animate)
  const cards = layout
    ? [...layout.focus.map((s) => CARDS[s]()), <FoldRow key="fold" />, ...layout.shown.map((s) => CARDS[s]())]
    : DEFAULT_ORDER.map((s) => CARDS[s]());
  return (
    <div className={`meet${on ? " on" : ""}`}>
      <div className="meet-main">
        <div className="phead dimmable">
          <div>
            <h1>フォーキャスト</h1>
            <div className="meta"><span className="badge lock"><Check />FY2026 · 10月版</span><span>2026.4 – 2027.3　/　実績は10月まで　/　億円</span></div>
          </div>
        </div>
        {on && <AskPanel />}
        <Controls />
        <Kpis />
        <div className={`grid cards${layout ? " arranged" : ""}`}>{cards}</div>
        <WidgetZone />
      </div>
      {on && <QuestionList />}
    </div>
  );
}
