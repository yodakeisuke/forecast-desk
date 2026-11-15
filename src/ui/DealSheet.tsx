// Drill-through: the deals behind the pipeline number, with their close-date history from the CRM.
import * as cube from "../data/cube";
import { DIM_LABEL } from "../data/model";
import { dumbbellChart } from "../shared/charts";
import { actions, useApp } from "../state/store";
import { useCube, useWidth } from "../state/useCube";
import { Ic } from "./icons";
import { NoteLayer } from "./Notes";
import { SvgChart } from "./SvgChart";

const md = (s: string) => { const [, a, b] = String(s).split("-"); return `${+a}/${+b}`; };

export function DealSheet() {
  const view = useApp((s) => s.view), filters = useApp((s) => s.filters), page = useApp((s) => s.page);
  const open = !!view.detail && page === "overview";
  const f = { ...filters, ...view.context };
  const deals = useCube(`deals|${JSON.stringify(f)}`, () => cube.slippedDeals(f));
  const [ref, w] = useWidth<HTMLDivElement>();
  const total = (deals ?? []).reduce((a, d) => a + Number(d.arr), 0);
  return (
    <aside className={`sheet${open ? " open" : ""}`} id="sheet" aria-label="案件の明細" aria-hidden={!open} inert={!open}>
      {open && (
        <>
          <div className="sheet-h">
            <div className="row">
              <span className="badge">ドリルスルー</span>
              <span className="muted" style={{ fontSize: 12 }}>パイプライン › 交渉・コミット</span>
              <button className="ibtn" style={{ marginLeft: "auto" }} aria-label="明細を閉じる" onClick={() => actions.setView({ ...view, detail: null })}><Ic.close /></button>
            </div>
            <h2 style={{ marginTop: 8 }}>来期へ移った案件 · {deals?.length ?? "…"}件</h2>
            <div className="ctxbar" style={{ padding: "8px 0 0" }}>
              {Object.entries(view.context).filter(([, v]) => v).map(([k, v]) => <span className="chip ag" key={k}>{DIM_LABEL[k as keyof typeof DIM_LABEL]} · {v}</span>)}
              <span className="chip">ARR 合計 {total.toFixed(1)}億円</span>
              <span className="chip">CRM 変更履歴 10/1–11/5</span>
            </div>
          </div>
          <div className="sheet-b" data-layer="sheet">
            <div className="dbx" data-target="deals:dates">
              <div className="dbh"><span className="ttl">クローズ予定日の移動</span><span className="lg"><span><i className="o" />9月版時点</span><span><i className="f" />10月版時点</span></span></div>
              <div ref={ref}>{deals && w > 0 && <SvgChart chart={dumbbellChart({ deals: deals.slice(0, 8).map((d) => ({ name: String(d.company), arr: Number(d.arr), from: String(d.close_from), to: String(d.close_to) })), w })} />}</div>
            </div>
            {(deals ?? []).map((d) => (
              <div className="deal" key={String(d.deal_id)} data-target={`deal:${d.company}`}>
                <div className="top"><span className="nm">{String(d.company)}</span><span className="badge">{String(d.stage)}</span><span className="muted" style={{ fontSize: 12 }}>{String(d.owner)}</span><span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>{String(d.deal_id)}</span></div>
                <div className="kv"><span>ARR <b>{Number(d.arr).toFixed(1)}億円</b></span><span>確度 <b>{String(d.prob)}%</b></span><span>クローズ予定 <b>{md(String(d.close_from))} → {md(String(d.close_to))}</b></span><span>変更 <b>{d.history.length}回</b></span></div>
                {d.slip_reason && <div className="why">{String(d.slip_reason)}</div>}
                <ul className="hist">{d.history.map((h, i) => <li key={i}><span className="mono">{String(h.on)}</span><span>{String(h.field)} {String(h.from)} → {String(h.to)}</span></li>)}</ul>
              </div>
            ))}
            {deals && !deals.length && <div className="muted" style={{ padding: 20 }}>この絞り込みでは来期へ移った案件はありません。</div>}
            <NoteLayer layer="sheet" />
          </div>
        </>
      )}
    </aside>
  );
}
