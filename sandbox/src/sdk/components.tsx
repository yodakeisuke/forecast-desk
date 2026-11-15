// The registry for catalog fpa@1 inside the sandbox: the same look as the dashboard, data through hooks.
import { createContext, useContext, type ReactNode } from "react";
import { defineRegistry, useBoundProp } from "@json-render/react";
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@ui-sdk/react/slider";
import { fpaCatalog } from "../../../src/shared/fpa-catalog";
import { accuracyChart, bridgeChart, scenarioChart, trendChart, sg, fmt, numberPrecision } from "../../../src/shared/charts";
import { LAST_ACTUAL, MONTHS } from "../../../src/data/model";
import { bridge } from "../port";
import { SvgChart } from "./chart";
import { useForecastAccuracy, useOwner, useQuery, useScenarioPL, useVariance, useWidth } from "./hooks";

export const PreviewCtx = createContext(false);
export const SlotCtx = createContext<Record<string, React.ComponentType> | undefined>(undefined);

const Spark = ({ size = 10 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .6l1.1 3.3L9.4 5 6.1 6.1 5 9.4 3.9 6.1.6 5l3.3-1.1z" fill="currentColor" /></svg>;
const UserIc = () => <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="4.2" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M1.8 11c.6-2.2 2.2-3.2 4.2-3.2s3.6 1 4.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>;
const Loading = ({ h = 120 }: { h?: number }) => <div className="loading" style={{ height: h }} aria-busy="true" />;

function Box({ name, label, children, className = "" }: { name: string; label?: string | null; children: ReactNode; className?: string }) {
  return <div className={`fpa ${className}`} data-fpa={name} data-fpa-label={label ?? undefined}>{children}</div>;
}

function Chart({ make, h }: { make: (w: number) => ReturnType<typeof bridgeChart> | null; h: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const c = w > 0 ? make(w) : null;
  return <div ref={ref}>{c ? <SvgChart chart={c} /> : <Loading h={h} />}</div>;
}

type Filters = { region?: string | null; segment?: string | null; product?: string | null };
const filtersOf = (p: { region?: string | null; segment?: string | null; product?: string | null }): Filters => ({ ...(p.region ? { region: p.region } : {}), ...(p.segment ? { segment: p.segment } : {}), ...(p.product ? { product: p.product } : {}) });

function KpiTile({ metric, compare, label }: { metric: string; compare?: string | null; label?: string | null }) {
  const k = useQuery<{ key: string; label: string; unit: string; cur: number; cmp: number; up: boolean | null; pt?: boolean }[]>("kpis", { compare: compare ?? "9月版", filters: {} });
  const x = k?.find((y) => y.key === metric);
  const d = x ? x.cur - x.cmp : 0, worse = x ? d * (x.up === false ? -1 : 1) < 0 : false;
  return (
    <Box name="KpiTile" label={label ?? x?.label} className="kpi">
      <div className="l">{label ?? x?.label ?? "…"}</div>
      <div className="v">{x ? x.cur.toFixed(1) : "—"}<small>{x?.unit}</small></div>
      {x && <div className={`d ${worse ? "bad" : "good"}`}>{d < 0 ? "▼" : "▲"} {sg(d)}{x.pt ? "pt" : ""} <span className="muted">vs {compare ?? "9月版"}</span></div>}
    </Box>
  );
}

function DriverSlider({ props, bindings }: { props: any; bindings?: Record<string, string> }) {
  const preview = useContext(PreviewCtx);
  const [value, setValue] = useBoundProp<number>(props.value, bindings?.value);
  const owner = useOwner(bindings?.value);
  const v = typeof value === "number" ? value : props.min;
  return (
    <Box name="DriverSlider" label={props.label} className={`slider${owner === "agent" ? " live" : ""}`}>
      <div className="r1">
        <span className="lab">{props.label}</span>
        <span className={`own${owner === "agent" ? " ai" : owner === "user" ? " me" : ""}`}>{owner === "agent" ? <>AI</> : owner === "user" ? <>手動</> : owner === "widget" ? "分析から反映" : "初期値"}</span>
        <span className="val">{fmt(v, Number.isInteger(props.step) ? 0 : 1)}{props.unit}</span>
      </div>
      <Slider value={v} min={props.min} max={props.max} step={props.step} disabled={preview} onValueChange={(x: number | number[]) => setValue(Array.isArray(x) ? x[0] : x)} className="sl">
        <SliderControl className="sl-control">
          <SliderTrack className="sl-track">
            <SliderIndicator className="sl-ind" />
            <SliderThumb className="sl-thumb" aria-label={props.label} />
          </SliderTrack>
        </SliderControl>
      </Slider>
      {props.hint && <div className="hint">{props.hint}</div>}
    </Box>
  );
}

function ScenarioCompare({ slipBack, winRate, naBias, ...filters }: { slipBack: number; winRate: number; naBias: number } & Filters) {
  const pl = useScenarioPL({ slipBack: Number(slipBack) || 0, winRate: Number(winRate) || 0, naBias: Number(naBias) || 0, filters: filtersOf(filters) });
  return (
    <Box name="ScenarioCompare" label="シナリオ比較">
      <Chart h={150} make={(w) => (pl ? scenarioChart({ cases: pl.cases, refs: pl.refs, w }) : null)} />
    </Box>
  );
}

function VarianceMiniTable({ by, compare, region }: { by: "region" | "segment" | "product"; compare: string; region?: string | null }) {
  const d = useVariance({ by, compare, filters: region ? { region } : {} });
  const precision = numberPrecision(d ? [d.total.diff, ...d.rows.map(r => r.diff)] : []);
  return (
    <Box name="VarianceMiniTable" label="売上差異">
      {!d ? <Loading h={100} /> : (
        <table className="t">
          <thead><tr><th style={{ textAlign: "left" }}>{({ region: "地域", segment: "セグメント", product: "製品" })[by]}</th><th>{compare}</th><th>10月版</th><th>差異</th><th>差異率</th></tr></thead>
          <tbody>
            {d.rows.filter((r: any) => !r.level).map((r) => <tr key={r.key}><td style={{ textAlign: "left" }}>{r.label}</td><td>{fmt(r.ref, precision)}</td><td>{fmt(r.cur, precision)}</td><td className={r.diff < 0 ? "bad" : ""}>{sg(r.diff, precision)}</td><td className={r.pct < 0 ? "bad" : ""}>{sg(r.pct)}%</td></tr>)}
            <tr className="tot"><td style={{ textAlign: "left" }}>合計</td><td>{fmt(d.total.ref, precision)}</td><td>{fmt(d.total.cur, precision)}</td><td>{sg(d.total.diff, precision)}</td><td>{sg(d.total.pct)}%</td></tr>
          </tbody>
        </table>
      )}
    </Box>
  );
}

const WarnIc = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}><path d="M7 1.5l6 10.5H1z" fill="var(--warn)" /><path d="M7 5.5v3M7 10.2v.1" stroke="#0b0b0b" strokeWidth="1.5" strokeLinecap="round" /></svg>;

export const { registry } = defineRegistry(fpaCatalog, {
  components: {
    Card: ({ props, children }) => (
      <Box name="Card" label={props.title} className="w-card">
        {(props.title || props.subtitle) && <div className="w-h"><span className="w-t">{props.title}</span>{props.subtitle && <span className="w-s">{props.subtitle}</span>}</div>}
        {children}
      </Box>
    ),
    Grid: ({ props, children }) => <div className="grid" style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`, gap: props.gap ?? 12 }}>{children}</div>,
    KpiTile: ({ props }) => <KpiTile {...props} />,
    BridgeChart: ({ props }) => {
      const f = filtersOf(props);
      const d = useQuery<{ from: number; to: number; steps: { label: string; value: number }[] }>("bridge", { from: props.from, to: props.to, filters: f });
      return <Box name="BridgeChart" label="営業利益ブリッジ"><Chart h={220} make={(w) => (d ? bridgeChart({ fromLabel: props.from, toLabel: props.to, from: d.from, to: d.to, steps: d.steps, w, h: 220 }) : null)} /></Box>;
    },
    TrendChart: ({ props }) => {
      const d = useQuery<{ cur: number[]; cmp: number[] }>("trend", { compare: props.compare, filters: filtersOf(props) });
      return <Box name="TrendChart" label="月次売上の推移"><div className="legend"><span><i className="ln" style={{ background: "var(--pos)" }} />10月版（実績＋見通し）</span><span><i className="ln" style={{ background: "var(--tot)" }} />{props.compare}</span></div><Chart h={200} make={(w) => (d ? trendChart({ months: [...MONTHS], cur: d.cur, cmp: d.cmp, lastActual: LAST_ACTUAL, curLabel: "10月版", cmpLabel: props.compare, w }) : null)} /></Box>;
    },
    AccuracyTrend: ({ props }) => {
      const d = useForecastAccuracy({ versions: props.versions });
      return (
        <Box name="AccuracyTrend" label="フォーキャスト誤差">
          {d && <div className="legend">{d.series.map((s, i) => <span key={s.region}><i className="ln" style={{ background: `var(--s${(i % 3) + 1})` }} />{s.region}</span>)}</div>}
          <Chart h={200} make={(w) => (d ? accuracyChart({ versions: d.versions, series: d.series.map((s) => ({ name: s.region, values: s.values })), w, emphasize: props.emphasize ?? undefined }) : null)} />
        </Box>
      );
    },
    VarianceMiniTable: ({ props }) => <VarianceMiniTable {...props} />,
    DriverSlider: ({ props, bindings }) => <DriverSlider props={props} bindings={bindings} />,
    ScenarioCompare: ({ props }) => <ScenarioCompare {...(props as any)} />,
    Insight: ({ props }) => <Box name="Insight" label="結論" className={`callout ${props.tone}`}><span>{props.text}</span></Box>,
    AgentUndo: ({ props }) => {
      const preview = useContext(PreviewCtx);
      const any = [useOwner("/scenario/winRate"), useOwner("/scenario/slipBack"), useOwner("/scenario/naBias")].includes("agent");
      if (preview) return null;
      return (
        <Box name="AgentUndo" label={props.label ?? "AIの変更を取り消す"} className="undo">
          <button className="btn" disabled={!any} onClick={() => bridge.request("state.undo", { source: "agent" }).catch(() => {})}>{props.label ?? "AIの変更を取り消す"}</button>
        </Box>
      );
    },
    Slot: ({ props }) => {
      const slots = useContext(SlotCtx);
      const C = slots?.[props.name];
      return (
        <div className="slot" data-fpa="Slot" data-slot={props.name} data-fpa-label={props.caption ?? props.name} style={{ minHeight: props.height ?? undefined }}>
          {props.caption && <span className="slot-tag">{props.caption}</span>}
          {C ? <SlotBoundary name={props.name}><C /></SlotBoundary> : <div className="slot-missing">slots.{props.name} がありません</div>}
        </div>
      );
    },
  },
});

import { Component } from "react";
class SlotBoundary extends Component<{ name: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message }; }
  componentDidCatch(e: Error) { bridge.post({ t: "error", phase: "render", message: `slot「${this.props.name}」: ${String(e.message).slice(0, 3000)}` }); }
  render() { return this.state.err ? <div className="slot-missing">slot「{this.props.name}」を描けませんでした: {this.state.err}</div> : this.props.children; }
}
