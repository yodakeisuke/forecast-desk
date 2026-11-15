// "Agent activity": every tool call (WebMCP, window.fpa, demo) and every change a person made, grouped by request.
import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { toolLabel } from "../shared/tool-labels";
import { history } from "../agent/bridge";
import { ALL_TOOLS } from "../agent/tools";
import { registration } from "../agent/register";
import { broadcastState } from "../genui/host";
import { actions, useApp } from "../state/store";
import { Blocked, Check, Ic, Run, Spark, User } from "./icons";

const GROUP: Record<string, string> = {
  snapshot: "画面の操作", act: "画面の操作", query: "画面の操作",
  query_data: "読む", explore_sql: "読む", get_catalog: "読む",
  set_filter: "見る場所を変える", drill_down: "見る場所を変える", drill_up: "見る場所を変える", drill_across: "見る場所を変える", drill_through: "見る場所を変える", highlight: "見る場所を変える",
  render_widget: "作る", operate_widget: "作る", compose_report: "作る",
};

function Log() {
  const groups = useApp((s) => s.activity);
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpenIds] = useState<number[]>([]);
  const setOpen = (id: number, o: boolean) => setOpenIds((x) => (o ? [...x, id] : x.filter((y) => y !== id)));
  useEffect(() => { const b = ref.current; if (b) b.scrollTop = b.scrollHeight; }, [groups]);
  if (!groups.length) {
    return (
      <div className="rail-b" ref={ref}>
        <div className="rail-empty">
          <p>操作履歴はまだありません。</p>
          <p>分析条件の変更やAIによる操作を、ここで確認できます。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rail-b" ref={ref}>
      {groups.map((g) => (
        <div className="grp" key={g.id}>
          <div className="req">
            <span className={`rq-ic${g.src === "あなた" ? " me" : ""}`}>{g.src === "あなた" ? <User /> : <Spark />}</span>
            <div><div className="src">{g.src} · {g.at}</div><div className="q">{g.title}</div></div>
          </div>
          {g.items.map((i) => i.who === "user" ? (
            <div className="act" key={i.id}><span className="dot me"><User /></span><span className="tn sans">あなた</span><span className="tm">{i.at}</span><span className="r">{i.result}</span></div>
          ) : (
            <div className={`act${i.running ? " run" : ""}${i.failed ? " fail" : ""}${open.includes(i.id) ? " showargs" : ""}`} key={i.id}>
              <span className="dot">{i.running ? <Run /> : i.failed ? <Blocked /> : <Check />}</span>
              {i.args
                ? <button className="tn" aria-expanded={open.includes(i.id)} title={open.includes(i.id) ? "詳細を閉じる" : "詳細を表示"} onClick={() => setOpen(i.id, !open.includes(i.id))}>{toolLabel(i.tool ?? "")}<span className="chev" aria-hidden>›</span></button>
                : <span className="tn">{i.tool ? toolLabel(i.tool) : i.who === "widget" ? "追加分析" : "AI"}</span>}
              <span className="tm">{i.running ? "実行中" : i.ms === undefined ? i.at : `${i.ms}ms`}</span>
              <span className="r">{i.result}</span>
              {i.args && <code className="a">{i.tool}{"\n"}{i.args}</code>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Tools() {
  const counts = useApp((s) => s.toolCounts), last = useApp((s) => s.lastTool);
  let g = "";
  return (
    <div className="rail-b">
      <div className="reg">AI連携 · {registration.mode === "none" ? "未接続" : "利用可能"} · {registration.count}ツール</div>
      {ALL_TOOLS().map((t) => {
        const head = GROUP[t.name] !== g ? (g = GROUP[t.name]) : null;
        return (
          <div key={t.name}>
            {head && <div className="tgrp">{head}</div>}
            <div className={`trow${t.name === last ? " hit" : ""}`}>
              <span className="n">{t.name}{t.annotations?.readOnlyHint && <span className="ro">読み取り専用</span>}</span>
              <span className="d">{t.title}</span>
              <span className="c">{counts[t.name] ? `×${counts[t.name]}` : "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Rail() {
  const open = useApp((s) => s.rail);
  const tab = useApp((s) => s.railTab);
  const n = useApp((s) => s.activity.reduce((a, g) => a + g.items.filter((i) => i.who === "agent").length, 0));
  return (
    <aside className="rail" id="rail" hidden={!open} inert={!open} aria-label="操作履歴">
      <div className="rail-h">
        <b>操作履歴</b>
        <div className="rtabs" role="tablist">
          <button role="tab" aria-selected={tab === "log"} className={tab === "log" ? "on" : ""} onClick={() => actions.setRailTab("log")}>履歴</button>
          <button role="tab" aria-selected={tab === "tools"} className={tab === "tools" ? "on" : ""} onClick={() => actions.setRailTab("tools")}>接続情報</button>
        </div>
        <Button className="rail-close" aria-label="履歴を閉じる" title="閉じる" onClick={() => {
          actions.setRail(false);
          document.querySelector<HTMLElement>(".main-menu>summary")?.focus();
        }}><Ic.close /></Button>
      </div>
      {tab === "log" ? <Log /> : <Tools />}
      <div className="rail-f">
        <Button className="tbtn" disabled={!n} aria-label="AIの操作を取り消す" onClick={async () => {
          const left = (await history.undoSource("agent")) as unknown[];
          const sc = actions.undoScenario("agent");
          sc.forEach(broadcastState);
          actions.closeNotes();
          actions.pushItem({ who: "user", result: `AIの操作を取り消しました${left?.length ? ` · 戻せなかったもの${left.length}件` : ""}`, running: false });
        }}><Ic.undo />AIの操作を取り消す</Button>
        <span className="muted">手動で変更した値は保持されます。</span>
      </div>
    </aside>
  );
}
