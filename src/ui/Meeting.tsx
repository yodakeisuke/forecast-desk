// Meeting mode: the question box at the top, the one-line answer (numbers computed by the app, never by the
// model), the list of this meeting's questions, and the row of folded cards.
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@ui-sdk/react/button";
import * as cube from "../data/cube";
import { useApp } from "../state/store";
import { useCube } from "../state/useCube";
import { KPI_LABEL, SLOT_INFO, type KpiKey } from "../meeting/plan";
import { ask, back, expand, handToAgent, keepForLater, notesFor, scopeLabel, setOn, showEntry, useLayout, useMeeting, type Entry } from "../meeting/session";
import { Delta } from "./Card";
import { Ic } from "./icons";

const SUGGESTIONS = ["着地は予算に対してどれくらい？", "欧州だけだと、前月版比でどう？", "北米のEnterpriseは、なぜこんなに落ちたの？", "成約率が前月並みに戻ったら？"];
const sec = (ms: number) => (ms < 100 ? "0.1秒未満" : `${(ms / 1000).toFixed(1)}秒`);

export function MeetingToggle() {
  const on = useMeeting((s) => s.on);
  const playing = useApp((s) => s.playing);
  return (
    <Button className={`mode-toggle${on ? " on" : ""}`} aria-pressed={on} disabled={playing} onClick={() => setOn(!on)}>
      <i className="mode-dot" aria-hidden="true" />会議モード
    </Button>
  );
}

function useScreenCtx() {
  const version = useApp((s) => s.version), compare = useApp((s) => s.compare), filters = useApp((s) => s.filters);
  const scenario = useApp((s) => s.scenario.values);
  return { version, compare, filters, scenario, key: `${version}|${compare}|${filters.region ?? ""}|${filters.segment ?? ""}|${filters.product ?? ""}` };
}

/** The answer in one line: the app's own numbers for the screen the question produced. */
function AnswerLine({ e }: { e: Entry }) {
  const { version, compare, filters, scenario, key } = useScreenCtx();
  const kp = useCube(`kpis|${key}`, () => cube.kpis(version, compare, filters));
  const scen = e.plan.winRate !== null || e.plan.slipBack !== null;
  const sKey = `scenario|${JSON.stringify([scenario, filters])}`;
  const sp = useCube(scen ? sKey : "scenario|none", () => scen ? cube.scenarioPL({ slipBack: scenario["/scenario/slipBack"], winRate: scenario["/scenario/winRate"], naBias: scenario["/scenario/naBias"], filters }) : Promise.resolve(null));
  const scope = scopeLabel({ compare, region: filters.region ?? null, segment: filters.segment ?? null, product: filters.product ?? null });
  const main: KpiKey = e.plan.kpi, second: KpiKey = main === "op" ? "rev" : "op";
  const pick = (k: KpiKey) => kp?.find((o) => o.key === k);
  const one = (k: KpiKey, big: boolean) => {
    const o = pick(k);
    if (!o) return null;
    return (
      <span className={`ans-kpi${big ? " big" : ""}`} data-kpi={k}>
        <span className="ans-l">{KPI_LABEL[k]}</span>
        <b className="tnum">{o.cur.toFixed(o.d)}<small>{o.unit}</small></b>
        <Delta cur={o.cur} base={o.cmp} unit={o.unit} d={o.d} up={o.up} pt={o.pt} />
      </span>
    );
  };
  return (
    <div className="ans" data-testid="meeting-answer">
      <div className="ans-scope">{scope}</div>
      {!kp && <div className="skel" />}
      {kp && (
        <div className="ans-row">
          {scen && sp ? (
            <span className="ans-kpi big" data-kpi="scenario">
              <span className="ans-l">試算 通期 営業利益</span>
              <b className="tnum">{sp.base.toFixed(2)}<small>億円</small></b>
              <Delta cur={sp.base} base={sp.refs[0].value} unit="億円" d={2} up />
              <span className="muted small">10月版 {sp.refs[0].value.toFixed(2)}億円から</span>
            </span>
          ) : one(main, true)}
          {one(scen ? "op" : second, false)}
        </div>
      )}
      <p className="ans-note">数字はアプリがデータから集計しています。モデルは数字を書きません。</p>
    </div>
  );
}

function StatusChip() {
  const phase = useMeeting((s) => s.phase), current = useMeeting((s) => s.current), entries = useMeeting((s) => s.entries), jev = useMeeting((s) => s.jev);
  useApp((s) => s.notes.length);
  const last = entries.at(-1);
  if (phase === "thinking") return <span className="chip-fast pending" role="status"><i className="pulse amber" />画面を組み立て中…</span>;
  const e = entries.find((x) => x.id === current);
  const engine = (x: Entry) => (x.engine === "jev" ? `Jev（${x.model}）` : "かんたんモード");
  const chips = [];
  if (last && last.id !== current && (last.status === "unsupported" || last.status === "memo")) chips.push(<span key="u" className="chip-idle">画面は変えていません</span>);
  else if (e) chips.push(<span key="f" className="chip-fast">{engine(e)} · {sec(e.ms)}で{e.plan.kind === "handoff" ? "画面を寄せました" : "反映"}</span>);
  else chips.push(<span key="i" className="chip-idle">{jev === "unavailable" ? "かんたんモード · よく出る問いだけ" : "待機中"}</span>);
  const agentE = e && (e.status === "handoff" || e.status === "investigating" || e.status === "resolved") ? e : last && last.id !== current && last.status === "handoff" ? last : undefined;
  if (agentE) {
    const n = notesFor(agentE, entries);
    chips.push(<span key="a" className="chip-agent">{agentE.status === "resolved" ? "エージェントが回答しました" : agentE.status === "investigating" ? <><i className="pulse" />エージェントが調査中</> : "エージェントの番を待っています"}{n ? ` · 注記${n}件` : ""}</span>);
  }
  return <span className="chips" role="status">{chips}</span>;
}

export function AskPanel() {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const phase = useMeeting((s) => s.phase), pending = useMeeting((s) => s.pending), current = useMeeting((s) => s.current);
  const entries = useMeeting((s) => s.entries), notice = useMeeting((s) => s.notice);
  const e = entries.find((x) => x.id === current);
  const last = entries.at(-1);
  const submit = (ev?: FormEvent, q = text) => {
    ev?.preventDefault();
    if (!q.trim() || phase !== "idle") return;
    setText("");
    void ask(q);
    input.current?.focus();
  };
  const unsupported = last && last.id !== current && last.status === "unsupported" ? last : undefined;
  const handedOff = last && last.id !== current && last.status === "handoff" ? last : undefined;
  return (
    <section className="ask" aria-label="会議で出た問い">
      <form className="ask-row" onSubmit={submit} data-agent-hidden>
        <label className="ask-label" htmlFor="meeting-q">会議で出た問い</label>
        <input id="meeting-q" ref={input} className="ask-in" value={text} maxLength={200} autoComplete="off" placeholder="例: 欧州だけだと、前月版比でどう？" onChange={(x) => setText(x.target.value)} />
        <Button type="submit" className="tbtn primary" disabled={!text.trim() || phase !== "idle"}>画面に反映</Button>
      </form>
      <div className="ask-meta">
        <StatusChip />
        <Button className="tbtn" disabled={current === null || phase !== "idle"} onClick={() => void back()}><Ic.prev />ひとつ前の画面</Button>
      </div>
      {!entries.length && phase === "idle" && (
        <div className="ask-suggest" aria-label="よく出る問い">
          {SUGGESTIONS.map((q) => <Button key={q} className="tbtn ghost" onClick={() => submit(undefined, q)}>{q}</Button>)}
        </div>
      )}
      {phase === "thinking" && pending && <div className="ask-q">「{pending}」<div className="skel" /></div>}
      {phase === "idle" && unsupported && (
        <div className="ans-box unsupported" data-testid="meeting-unsupported">
          <p>「{unsupported.question}」は、いまある画面の操作では表せません。近い画面に勝手に寄せることはしません。</p>
          <div className="row"><Button className="tbtn" onClick={() => handToAgent(unsupported.id)}>エージェントに聞く</Button><Button className="tbtn ghost" onClick={() => keepForLater(unsupported.id)}>持ち帰りにメモする</Button></div>
        </div>
      )}
      {phase === "idle" && handedOff && <div className="ans-box agent"><p>「{handedOff.question}」をエージェントに渡しました。画面は変えていません。</p></div>}
      {phase === "idle" && e && (
        <>
          <div className="ask-q">「{e.question}」</div>
          <AnswerLine e={e} />
          {(e.status === "handoff" || e.status === "investigating") && <div className="ans-box agent" data-testid="meeting-handoff"><p>「なぜ」は画面の操作だけでは答えられないので、エージェントに渡しました。分かったところから注記で差し込みます。</p></div>}
          {e.status === "resolved" && e.summary && <div className="ans-box agent"><p><b>エージェント:</b> {e.summary}</p></div>}
        </>
      )}
      {notice && <p className="ask-notice" role="alert">{notice}</p>}
    </section>
  );
}

const STATUS_TEXT: Record<Entry["status"], string> = { answered: "", handoff: "エージェント待ち", investigating: "エージェント調査中", resolved: "エージェント回答済み", unsupported: "画面で表せない問い", memo: "持ち帰り" };

export function QuestionList() {
  const entries = useMeeting((s) => s.entries), current = useMeeting((s) => s.current), phase = useMeeting((s) => s.phase);
  useApp((s) => s.notes.length);
  const today = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric" }).format(new Date());
  const first = entries[0];
  return (
    <aside className="qlist" aria-label="この会議の問い">
      <h2>この会議の問い</h2>
      <p className="muted small">{today} · 10月版フォーキャスト会議</p>
      {!entries.length && <p className="muted small">問いが出ると、ここに順に残ります。どの問いの画面にも1手で戻れます。</p>}
      {first && (
        <button className={`q-item start${current === null ? " cur" : ""}`} disabled={phase !== "idle"} aria-current={current === null ? "true" : undefined} onClick={() => void showEntry(null)}>
          <span className="q-at">はじめの画面{current === null ? " · いま表示中" : ""}</span>
          <span className="q-sc">{scopeLabel(first.before)}</span>
        </button>
      )}
      <ol>
        {entries.map((x) => {
          const can = x.status !== "unsupported" && x.status !== "memo";
          const n = notesFor(x, entries);
          const body = (
            <>
              <span className="q-at">{x.at}{x.id === current ? " · いま表示中" : ""}</span>
              <span className="q-t">{x.question}</span>
              {can && <span className="q-sc">{scopeLabel(x.after)} · {KPI_LABEL[x.plan.kpi]}</span>}
              {STATUS_TEXT[x.status] && <span className={`q-st ${x.status}`}>{STATUS_TEXT[x.status]}{n ? ` · 注記${n}件` : ""}</span>}
              {x.summary && <span className="q-sum">{x.summary}</span>}
            </>
          );
          return (
            <li key={x.id}>
              {can
                ? <button className={`q-item${x.id === current ? " cur" : ""}`} disabled={phase !== "idle"} aria-current={x.id === current ? "true" : undefined} onClick={() => void showEntry(x.id)}>{body}</button>
                : <div className="q-item off">{body}</div>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function FoldRow() {
  const layout = useLayout();
  if (!layout || !layout.folded.length) return null;
  return (
    <div className="fold-row" data-agent-hidden>
      <span className="muted small">いまの問いに遠いカードは畳んでいます</span>
      {layout.folded.map((s) => <Button key={s} className="tbtn ghost" onClick={() => expand(s)}>{SLOT_INFO[s].label}</Button>)}
    </div>
  );
}

