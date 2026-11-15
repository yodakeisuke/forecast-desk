// The report: a report@1 spec rendered with a screen registry. The same spec goes to the PDF registry.
// Figures are drawn from their sources; a generated widget appears as a read-only preview of itself.
import { useEffect, useState, type ReactNode } from "react";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { Button } from "@ui-sdk/react/button";
import { reportCatalog, type FigureSourceT } from "../report/catalog";
import { figureBlocks, type Block, type SvgNode } from "../report/figures";
import { actions, getState, useApp, type ReportSpec } from "../state/store";
import { useWidth } from "../state/useCube";
import { SvgChart } from "./SvgChart";
import { WidgetFrame } from "./WidgetCard";
import { Ic, Spark } from "./icons";

/** **bold** and [n] (a note number that jumps back to the screen it came from). */
export function richText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(\d{1,2})\]/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={k++}>{m[1]}</b>);
    else { const n = Number(m[2]); out.push(<button key={k++} className="fn" title={`注記${n}の画面へ`} aria-label={`注記${n}`} onClick={() => jumpToNote(n)}>{n}</button>); }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function jumpToNote(n: number) {
  const note = getState().notes.find((x) => x.n === n);
  if (!note) return;
  actions.restoreNote(n);
  requestAnimationFrame(() => setTimeout(() => actions.toggleNote(n, true), 60));
}

export function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "chart": return <SvgChart chart={b.chart} />;
    case "table": return (
      <table className="t rt">
        <thead><tr>{b.head.map((h, i) => <th key={i} style={{ textAlign: b.align?.[i] === "l" ? "left" : "right" }}>{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i} className={b.tot === i ? "tot" : ""}>{r.map((c, j) => <td key={j} style={{ textAlign: b.align?.[j] === "l" ? "left" : "right", whiteSpace: j === 0 || b.align?.[j] === "l" ? "normal" : undefined }}>{c}</td>)}</tr>)}</tbody>
      </table>
    );
    case "kv": return <div className="rkv">{b.items.map((x, i) => <div key={i}><span className="l">{x.label}</span><b>{x.value}</b>{x.note && <span className="muted">{x.note}</span>}</div>)}</div>;
    case "text": return <div className={`callout ${b.tone ?? ""}`}><span>{b.text}</span></div>;
    case "svg": return <SvgTree node={b.node} />;
  }
}
const ATTR: Record<string, string> = { "fill-opacity": "fillOpacity", "stroke-opacity": "strokeOpacity", "stroke-width": "strokeWidth", "stroke-dasharray": "strokeDasharray", "text-anchor": "textAnchor", "font-size": "fontSize", "font-weight": "fontWeight", viewBox: "viewBox" };
export function SvgTree({ node }: { node: SvgNode }): ReactNode {
  const T = node.tag as any;
  const props = Object.fromEntries(Object.entries(node.a).map(([k, v]) => [ATTR[k] ?? k, v]));
  return <T {...props}>{node.text}{node.c?.map((c, i) => <SvgTree key={i} node={c} />)}</T>;
}

function FixedFigure({ source }: { source: FigureSourceT }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const key = JSON.stringify(source);
  useEffect(() => { let live = true; if (w > 0) figureBlocks(source, w).then((b) => live && setBlocks(b)).catch((e) => live && setBlocks([{ t: "text", text: `図表を読み込めませんでした: ${String(e.message ?? e)}`, tone: "warning" }])); return () => { live = false; }; }, [key, w]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref}>{blocks ? blocks.map((b, i) => <BlockView key={i} b={b} />) : <div className="skel" style={{ height: 160 }} />}</div>;
}

function WidgetFigure({ id }: { id: string }) {
  const w = useApp((s) => s.report?.widgets.find((x) => x.id === id));
  if (!w) return <div className="muted">ウィジェット {id} は削除されました</div>;
  return (
    <div className="rp-widget">
      <WidgetFrame w={w} runtimeKey={`${w.id}@report`} preview height={w.height} />
      <div className="rp-wfoot">作成時の分析結果</div>
    </div>
  );
}

const { registry } = defineRegistry(reportCatalog, {
  components: {
    Document: ({ props, children }) => (
      <article className="doc" id="doc">
        <div className="eb">{props.eyebrow.split(" · ").map((x, i) => <span key={i}>{i > 0 && <span className="sep">·</span>}{x}</span>)}</div>
        <h1>{props.title}</h1>
        {children}
      </article>
    ),
    Section: ({ props, children }) => (
      <section id={props.anchor} data-target={`report:${props.anchor.replace(/^rp-/, "")}`} className="rp-sec">
        {props.no !== "" && <h2><span className="no">{props.no}</span>{props.title}</h2>}
        {children}
      </section>
    ),
    Headline: ({ props }) => <p className="lead">{richText(props.text)}</p>,
    Paragraph: ({ props }) => <p>{richText(props.text)}</p>,
    KpiRow: ({ props }) => (
      <div className="rk">
        {props.items.map((x, i) => <div key={i}><div className="l">{x.label}</div><div className="v tnum">{x.value}<small>{x.unit}</small></div><div className={`d ${x.tone === "bad" ? "bad" : x.tone === "good" ? "good" : "muted"}`}>{x.delta}</div></div>)}
      </div>
    ),
    Finding: ({ props }) => <blockquote className="finding"><span className="num-b">{props.n}</span><span>{props.text}</span><cite>{props.agent}の注記</cite></blockquote>,
    Figure: ({ props }) => (
      <figure className="fig">
        {props.source.kind === "widget" ? <WidgetFigure id={props.source.widget} /> : <FixedFigure source={props.source} />}
        <figcaption className="figcap"><span className="mono">{props.no}</span>　{props.caption}</figcaption>
      </figure>
    ),
    Bullets: ({ props }) => <ul>{props.items.map((x, i) => <li key={i}>{richText(x)}</li>)}</ul>,
    Trail: ({ props }) => (
      <>
        <ul className="trail">{props.items.map((x, i) => <li key={i}><span className="tm">{x.at}</span><span className="mono">{x.tool}</span><span>{x.text}</span></li>)}</ul>
        <p className="muted small">AIによる変更は操作履歴から取り消せます。</p>
      </>
    ),
  },
});

export function ReportPage() {
  const report = useApp((s) => s.report);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { const { composeReport } = await import("../report/compose"); await composeReport({ title: "フォーキャスト分析レポート" }); actions.pushItem({ who: "user", result: "現在の分析条件で報告書を作成", running: false }); }
    catch(e) { actions.toast(`報告書を作れませんでした: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  if (!report) {
    return (
      <div className="page">
        <div className="phead"><div><h1>レポート</h1><div className="meta">まだ報告書はありません</div></div></div>
        <div className="empty">

          <p>現在の分析条件とグラフをまとめ、PDFで保存できます。</p>
          <Button className="tbtn" disabled={busy} onClick={create}>{busy ? "作成中…" : "レポートを作成"}</Button>
          <Button className="tbtn" onClick={() => actions.setPage("overview")}>分析に戻る</Button>
        </div>
      </div>
    );
  }
  const spec = report.spec as ReportSpec;
  const sections = Object.values(spec.elements).filter((e) => e.type === "Section").map((e) => e.props as { no: string; title: string; anchor: string });
  const pdf = async (share = false) => {
    setBusy(true);
    try { const { exportPdf } = await import("../report/pdf"); await exportPdf(report, share); }
    catch (e) { actions.toast(`PDFを作れませんでした: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="page rp-page">
      <div className="phead">
        <div>
          <h1>レポート</h1>
          <div className="meta">ドラフト · {report.at} 作成</div>
        </div>
        <div className="acts">
          <Button className="tbtn ghost" onClick={() => actions.setPage("overview")}>分析に戻る</Button>
          <Button className="tbtn primary" aria-label="PDFを書き出す" data-agent-confirm="この報告書をPDFとして書き出し、ダウンロードします" disabled={busy} onClick={() => pdf()}>{busy ? "PDFを作成中…" : "PDFを書き出す"}</Button>
          <details className="toolbar-menu">
            <summary aria-label="レポートのその他の操作"><Ic.more /></summary>
            <div className="menu-panel">
              <Button disabled={busy} onClick={create}>現在の条件で作り直す</Button>
              <Button aria-label="報告書を共有" data-agent-confirm="この報告書のPDFを共有ダイアログに渡します。対応しない環境ではダウンロードします" disabled={busy} onClick={() => pdf(true)}>PDFを共有</Button>
            </div>
          </details>
        </div>
      </div>
      <div className="rp">
        <nav className="toc" aria-label="目次">
          <div className="h">目次</div>
          {sections.map((s) => <a key={s.anchor} href={`#${s.anchor}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{s.no && s.no !== "付録" ? `${s.no} ` : s.no === "付録" ? "付録 " : ""}{s.title}</a>)}
        </nav>
        <JSONUIProvider registry={registry}><Renderer spec={spec as any} registry={registry} /></JSONUIProvider>
      </div>
    </div>
  );
}
