// "Agent activity": every tool call (WebMCP, window.fpa, demo) and every change a person made, grouped by request.
import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { history } from "../agent/bridge";
import { ALL_TOOLS } from "../agent/tools";
import { registration } from "../agent/register";
import { broadcastState } from "../genui/host";
import { actions, useApp } from "../state/store";
import { Blocked, Check, Ic, Run, Spark, User } from "./icons";

const GROUP: Record<string, string> = {
  snapshot: "UI SDK（どの画面にも）", act: "UI SDK（どの画面にも）", query: "UI SDK（どの画面にも）",
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
          <p>ChatGPTやClaudeがWebMCP（または <span className="mono">window.fpa</span>）でこのダッシュボードを操作すると、ここに記録されます。あなたの操作も同じ流れに入ります。</p>
          <p>WebMCPのツールから、集計・ドリル・ウィジェット生成・報告書作成を個別に呼び出せます。</p>
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
                ? <button className="tn" aria-expanded={open.includes(i.id)} title={open.includes(i.id) ? "引数を隠す" : "引数を表示"} onClick={() => setOpen(i.id, !open.includes(i.id))}>{i.tool}<span className="chev" aria-hidden>›</span></button>
                : <span className="tn">{i.tool ?? (i.who === "widget" ? "生成UI" : "Agent")}</span>}
              <span className="tm">{i.running ? "実行中" : i.ms === undefined ? i.at : `${i.ms}ms`}</span>
              <span className="r">{i.result}</span>
              {i.args && <code className="a">{i.args}</code>}
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
      <div className="code"><i>// 部品が操作を宣言（UI SDK）</i>{"\n"}definePrimitive({"{"} name: "variance-table",{"\n"}  agent: {"{"} actions: ["drillDown", "drillUp",{"\n"}    "drillAcross", "drillThrough"] {"}"} {"}"}){"\n\n"}<i>// 同じブリッジを WebMCP に公開</i>{"\n"}document.modelContext.registerTool(tool)</div>
      <div className="reg">{registration.mode === "native" ? "ブラウザのWebMCP" : registration.mode === "polyfill" ? "WebMCP（polyfill · 拡張機能経由）" : "WebMCP 未接続"} · {registration.count}ツール · window.fpa</div>
      {ALL_TOOLS().map((t) => {
        const head = GROUP[t.name] !== g ? (g = GROUP[t.name]) : null;
        return (
          <div key={t.name}>
            {head && <div className="tgrp">{head}</div>}
            <div className={`trow${t.name === last ? " hit" : ""}`}>
              <span className="n">{t.name}{t.annotations?.readOnlyHint && <span className="ro">readOnly</span>}</span>
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
    <aside className="rail" id="rail" hidden={!open} inert={!open} aria-label="エージェントのアクティビティ">
      <div className="rail-h">
        <b>Agent activity</b>
        <div className="rtabs" role="tablist">
          <button role="tab" aria-selected={tab === "log"} className={tab === "log" ? "on" : ""} onClick={() => actions.setRailTab("log")}>ログ</button>
          <button role="tab" aria-selected={tab === "tools"} className={tab === "tools" ? "on" : ""} onClick={() => actions.setRailTab("tools")}>ツール</button>
        </div>
        <Button className="rail-close" aria-label="アクティビティを閉じる" title="閉じる" onClick={() => {
          actions.setRail(false);
          document.querySelector<HTMLButtonElement>('button[aria-controls="rail"]')?.focus();
        }}><Ic.close /></Button>
      </div>
      {tab === "log" ? <Log /> : <Tools />}
      <div className="rail-f">
        <Button className="tbtn" disabled={!n} aria-label="Agentの操作を戻す" onClick={async () => {
          const left = (await history.undoSource("agent")) as unknown[];
          const sc = actions.undoScenario("agent");
          sc.forEach(broadcastState);
          actions.closeNotes();
          actions.pushItem({ who: "user", result: `Agentの操作を取り消し（あなたの変更はそのまま）${left?.length ? ` · 戻せなかったもの${left.length}件` : ""}`, running: false });
        }}><Ic.undo />Agentの操作を戻す</Button>
        <span className="muted">createHistory · 誰が変えたかを記録</span>
      </div>
    </aside>
  );
}
