// The variance table. Its root is the VarianceTable primitive, so drill-down/up/across/through are api
// methods: a click on a row and an agent's act() step call the same method.
import { usePart, usePrimitive } from "@ui-sdk/react/primitive";
import { Tabs, TabsList, TabsTab } from "@ui-sdk/react/tabs";
import { createContext, useContext, useLayoutEffect, useRef, type MouseEvent, type KeyboardEvent } from "react";
import * as cube from "../data/cube";
import { DIM_LABEL, versionLabel } from "../data/model";
import { fmt, numberPrecision, sg } from "../shared/charts";
import { actions, decodeView, encodeView, useApp, type Tab } from "../state/store";
import { useCube } from "../state/useCube";
import { prefersReducedMotion } from "./attention";
import { Card } from "./Card";
import { Car, Ic } from "./icons";
import { DriversTable } from "./Overview";
import { varianceTable } from "./primitives";

type Api = { toggleMember: (m: string, e?: Event) => boolean; drillDown: (m?: string, by?: string[] | string, e?: Event) => boolean; drillUp: (n?: number, e?: Event) => boolean; drillAcross: (to: string, keep?: unknown, e?: Event) => boolean; drillThrough: (m?: string, e?: Event) => boolean };
const ApiCtx = createContext<{ api: () => Api } | null>(null);
const useApi = () => useContext(ApiCtx)!.api();

function VarianceRoot({ children }: { children: React.ReactNode }) {
  const view = useApp((s) => s.view);
  const handle = usePrimitive(varianceTable, {
    value: encodeView(view),
    onValueChange: (value: string, details: any) => {
      // the only way the view changes: through the primitive (person, agent, or history restore)
      void details;
      actions.setView(decodeView(value));
    },
  });
  const root = usePart(handle, "root", {}, { "aria-label": "差異表", className: "var-root", children }, "div");
  return <ApiCtx.Provider value={{ api: () => handle.api as unknown as Api }}>{root}</ApiCtx.Provider>;
}

const ev = (e: MouseEvent | KeyboardEvent) => e.nativeEvent as Event;

function VarianceTablePanel() {
  const version = useApp((s) => s.version), compare = useApp((s) => s.compare), filters = useApp((s) => s.filters), view = useApp((s) => s.view);
  const api = useApi();
  const key = `${version}|${compare}|${JSON.stringify(filters)}|${view.by.join(">")}|${view.open.join(",")}`;
  const incoming = useCube(`var|${key}`, () => cube.variance(version, compare, filters, view.by, view.open));
  const last = useRef<typeof incoming>(undefined);
  if (incoming) last.current = incoming;
  const d = incoming ?? last.current;
  const panel = useRef<HTMLDivElement>(null);
  const priorHeight = useRef<number | null>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !incoming) return;
    const height = el.querySelector("table")?.getBoundingClientRect().height ?? el.scrollHeight;
    animation.current?.cancel();
    if (priorHeight.current !== null && Math.abs(height - priorHeight.current) > 1 && !prefersReducedMotion()) {
      animation.current = el.animate([{ height: `${priorHeight.current}px` }, { height: `${height}px` }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    priorHeight.current = height;
  }, [incoming]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
  if (!d) return <div className="skel" style={{ height: 180, margin: 16 }}>読み込み中…</div>;
  const precision = numberPrecision([d.total.diff, ...d.rows.map(r => r.diff)]);
  const mx = Math.max(1e-8, ...d.rows.map((r) => Math.abs(r.diff)));
  const bar = (dv: number) => (Math.abs(dv) < 1e-8 ? <div className="dv" /> : <div className="dv"><i className={dv < 0 ? "n" : "p"} style={{ width: `${Math.min(50, (Math.abs(dv) / mx) * 50)}%` }} /></div>);
  const cells = (r: { ref: number; cur: number; diff: number; pct: number }) => (
    <>
      <td>{fmt(r.ref, precision)}</td><td>{fmt(r.cur, precision)}</td>
      <td className={r.diff < -1e-8 ? "bad" : ""}>{sg(r.diff, precision)}</td>
      <td className={r.diff < -1e-8 ? "bad" : ""}>{sg(r.pct)}%</td>
      <td style={{ width: 150 }}>{bar(r.diff)}</td>
    </>
  );
  return (
    <div className="tw variance-panel" ref={panel} aria-busy={!incoming}>
      <table className="t">
        <thead><tr><th>{view.by.map((b) => DIM_LABEL[b]).join(" / ")}</th><th>{versionLabel(compare)}</th><th>{versionLabel(version)}</th><th>差異</th><th>差異率</th><th aria-label="差異バー" /></tr></thead>
        <tbody>
          <tr className="tot" data-target="row:合計"><td>{d.total.label}</td>{cells(d.total)}</tr>
          {d.rows.map((r, i) => r.level === 0 ? (
            <tr key={r.key} className={`exp${view.open.includes(r.key) ? " open" : ""}${view.focus === r.key ? " hl" : ""}`} data-target={`row:${r.key}`} tabIndex={0} aria-expanded={view.open.includes(r.key)}
              onClick={(e) => api.toggleMember(r.key, ev(e))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); api.toggleMember(r.key, ev(e)); } }}>
              <td>{r.expandable && <span className="car"><Car /></span>}{r.label}</td>{cells(r)}
            </tr>
          ) : (
            <tr key={r.key} className={`kid${view.focus === r.key ? " hl" : ""}`} style={{ ["--i" as string]: i % 4 }} data-target={`row:${r.key}`} onDoubleClick={(e) => api.drillAcross("pipeline", r.key, ev(e))}>
              <td>{r.label}</td>{cells(r)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContextChips({ from }: { from: string }) {
  const ctx = useApp((s) => s.view.context);
  const entries = Object.entries(ctx).filter(([, v]) => v);
  return (
    <div className="ctxbar">
      <span className="muted" style={{ fontSize: 11.5 }}>{entries.length ? `${from}から引き継ぎ` : "絞り込みなし"}</span>
      {entries.map(([k, v]) => <span className="chip ag" key={k}>{DIM_LABEL[k as keyof typeof DIM_LABEL]} · {v}</span>)}
      <span className="chip ag">クローズ予定 · 今期</span>
    </div>
  );
}

function PipelinePanel() {
  const ctx = useApp((s) => s.view.context), filters = useApp((s) => s.filters);
  const api = useApi();
  const f = { ...filters, ...ctx };
  const d = useCube(`pipe|${JSON.stringify(f)}`, () => cube.pipeline(f));
  if (!d) return <div className="skel" style={{ height: 180, margin: 16 }}>読み込み中…</div>;
  const mx = Math.max(...d.stages.map((s) => Math.max(s.v09, s.v10))) * 1.04 || 1;
  const st = (s: (typeof d.stages)[number], i: number) => (
    <div className="st" key={s.stage} data-target={`stage:${s.stage}`}>
      <div>{s.stage}<div className="muted" style={{ fontSize: 11 }}>{s.n09}件 → {s.n10}件</div></div>
      <div className="bars"><div className="b0" style={{ width: `${(s.v09 / mx) * 100}%`, animationDelay: `${i * 60}ms` }} /><div className="b1" style={{ width: `${(s.v10 / mx) * 100}%`, animationDelay: `${i * 60 + 80}ms` }} /></div>
      <div className="val">{s.v09.toFixed(1)} → <b>{s.v10.toFixed(1)}</b></div>
      <div className={`dl${s.v10 - s.v09 < -0.5 ? " bad" : ""}`}>{sg(s.v10 - s.v09)}</div>
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
        <ContextChips from="売上差異" />
        <span style={{ marginLeft: "auto", padding: "10px 16px 0" }} className="legend"><span><i className="sw" style={{ background: "var(--ref)", opacity: 0.55 }} />9月版時点</span><span><i className="sw" style={{ background: "var(--pos)" }} />10月版時点</span></span>
      </div>
      <div className="stages">
        {d.stages.slice(0, 3).map(st)}
        <div id="pl-late" data-target="stages:late">{d.stages.slice(3).map((s, i) => st(s, i + 3))}</div>
      </div>
      <div className="slipbar" data-target="slip:summary">
        <div><div className="k">来期へ移った案件</div><div className="v">{d.slipped.count}件</div></div>
        <div><div className="k">移ったARR</div><div className="v tnum">{d.slipped.arr.toFixed(1)}<small className="muted" style={{ fontSize: 11.5, fontWeight: 500 }}> 億円</small></div></div>
        <div><div className="k">今期売上への影響</div><div className="v bad tnum">{sg(d.slipped.revenueImpact)}<small className="muted" style={{ fontSize: 11.5, fontWeight: 500 }}> 億円</small></div></div>
        {d.lost.count > 0 && <div><div className="k">失注</div><div className="v tnum">{d.lost.count}件 · {d.lost.arr.toFixed(1)}<small className="muted" style={{ fontSize: 11.5, fontWeight: 500 }}> 億円</small></div></div>}
        <div className="sp" />
        <button className="tbtn" onClick={(e) => api.drillThrough(undefined, ev(e))}>明細を開く</button>
      </div>
    </>
  );
}

const TITLES: Record<Tab, [string, string]> = {
  variance: ["売上差異", "行をクリックで展開"],
  pipeline: ["パイプライン · 今期クローズ予定", "ARR 億円 · 9月版時点 → 10月版時点"],
  drivers: ["主要ドライバー", "同じ絞り込みで前提を比較"],
};

export function VarianceCard() {
  const view = useApp((s) => s.view), compare = useApp((s) => s.compare), version = useApp((s) => s.version);
  const busy = useApp((s) => s.busy?.target === "c-var");
  const [t, sub] = TITLES[view.tab];
  return (
    <Card id="c-var" cls="c8" title={view.tab === "variance" ? `${t} · ${view.by.map(b => DIM_LABEL[b]).join(" / ")}` : t} sub={view.tab === "variance" ? `${versionLabel(compare)} → ${versionLabel(version)} · ${sub}` : sub}>
      <VarianceRoot>
        <ViewTabs />
        <div className="view-panel" key={view.tab}>
          {view.tab === "variance" && <VarianceTablePanel />}
          {view.tab === "pipeline" && <PipelinePanel />}
          {view.tab === "drivers" && <><ContextChips from="売上差異" /><div className="tw" style={{ padding: "6px 0 8px" }}><DriversTable compact /></div></>}
        </div>
      </VarianceRoot>
    </Card>
  );
}

function ViewTabs() {
  const view = useApp(s => s.view), api = useApi();
  return <Tabs value={view.tab} onValueChange={(v: unknown) => v && api.drillAcross(String(v))}><TabsList aria-label="差異表のビュー" className="tabs"><TabsTab value="variance" className="tab">売上差異</TabsTab><TabsTab value="pipeline" className="tab">パイプライン</TabsTab><TabsTab value="drivers" className="tab">ドライバー</TabsTab></TabsList></Tabs>;
}
