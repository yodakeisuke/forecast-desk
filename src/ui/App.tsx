// The shell: icon rail | topbar / canvas (pages, notes, deal sheet, demo bar) | Agent activity.
// The overview stays mounted while other pages show, so generated widgets keep running in their sandboxes.
import { useEffect } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogClose } from "@ui-sdk/react/alert-dialog";
import { Button } from "@ui-sdk/react/button";
import { actions, useApp } from "../state/store";
import { AnnotationsRoot, NoteLayer } from "./Notes";
import { DealSheet } from "./DealSheet";
import { DemoBar } from "./DemoBar";
import { Ic, Spark } from "./icons";
import { Overview } from "./Overview";
import { Rail } from "./Rail";
import { ReportPage } from "./ReportPage";
import { SecurityPage } from "./SecurityPage";
import { SettingsPage } from "./SettingsPage";
import { shareUrl } from "../state/preferences";
import { MeetingToggle } from "./Meeting";

function scrollToId(id: string) {
  actions.setPage("overview");
  requestAnimationFrame(() => {
    const el = document.getElementById(id), c = document.getElementById("content");
    if (el && c) c.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 20), behavior: "smooth" });
  });
}

function Navigation() {
  const page = useApp(s => s.page), playing = useApp(s => s.playing);
  const widgets = useApp(s => s.widgets.length), rail = useApp(s => s.rail);
  return <>
    <button className="brand" onClick={() => scrollToId("kpis")} aria-label="Forecast Desk ホーム">Forecast<span>Desk</span></button>
    <nav className="main-nav" aria-label="メインナビゲーション">
      <Button className={page === "overview" ? "active" : ""} aria-current={page === "overview" ? "page" : undefined} disabled={playing} onClick={() => scrollToId("kpis")}>分析</Button>
      <Button className={page === "report" ? "active" : ""} aria-current={page === "report" ? "page" : undefined} disabled={playing} onClick={() => actions.setPage("report")}>レポート</Button>
    </nav>
    <MeetingToggle />
    <AgentChip />
    <details className="toolbar-menu main-menu">
      <summary aria-label="その他のメニュー"><Ic.more /></summary>
      <div className="menu-panel" onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); }}>
        <Button onClick={() => scrollToId("c-var")}>差異分析</Button>
        <Button onClick={() => scrollToId("c-scenario")}>シナリオ試算</Button>
        {widgets > 0 && <Button onClick={() => scrollToId("genzone")}>追加の分析</Button>}
        <Button onClick={() => actions.setPage("security")}>セキュリティ</Button>
        <Button aria-controls="rail" aria-expanded={rail} onClick={actions.toggleRail}>操作履歴</Button>
        <Button data-agent-confirm="分析条件を含むリンクをクリップボードにコピーします" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl()); actions.toast("分析条件のリンクをコピーしました"); } catch { actions.toast("リンクをコピーできませんでした。クリップボードの許可を確認してください"); } }}>分析リンクをコピー</Button>
        <Button onClick={() => actions.setPage("settings")}>設定</Button>
      </div>
    </details>
  </>;
}

function AgentChip() {
  const busy = useApp(s => s.busy);
  if (!busy) return null;
  return <span className="work-status" role="status">処理中…</span>;
}

function Tip() {
  const tip = useApp((s) => s.tip);
  if (!tip) return null;
  const x = Math.min(tip.x + 14, innerWidth - 200), y = Math.min(tip.y + 14, innerHeight - 120);
  return (
    <div id="tip" style={{ left: x, top: y }} role="tooltip">
      <div className="h">{tip.title}</div>
      {tip.rows.map((r, i) => <div className="r" key={i}>{r.tone && <i style={{ background: r.tone }} />}<b className={r.bad ? "bad" : ""}>{r.value}</b><span>{r.label}</span></div>)}
    </div>
  );
}

function Confirm() {
  const c = useApp((s) => s.confirm);
  if (!c) return null;
  return (
    <AlertDialog open onOpenChange={(open, details) => { if (!open) c.resolve(details.returnValue === "confirm"); }}>
      <div className="scrim" data-agent-hidden>
        <AlertDialogContent className="dialog">
          <div className="hd"><span className="ag"><Spark /></span><AlertDialogTitle id="cf-t">操作の確認</AlertDialogTitle></div>
          <AlertDialogDescription id="cf-d">{c.text}</AlertDialogDescription>
          <p className="muted small">内容を確認してから続行してください。</p>
          <div className="ft">
            <AlertDialogClose className="tbtn">キャンセル</AlertDialogClose>
            <AlertDialogClose className="tbtn primary" value="confirm">続行する</AlertDialogClose>
          </div>
        </AlertDialogContent>
      </div>
    </AlertDialog>
  );
}

export function App() {
  const page = useApp((s) => s.page), rail = useApp((s) => s.rail), toast = useApp((s) => s.toast);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      actions.closeNotes();
      document.querySelectorAll<HTMLDetailsElement>(".toolbar-menu[open]").forEach(menu => { menu.open = false; menu.querySelector<HTMLElement>("summary")?.focus(); });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="app">
      <div className="main">
        <header className="topbar">
          <Navigation />

        </header>
        <div className={`body${rail ? " railopen" : " norail"}`}>
          <div className="stage">
            <div id="content" data-layer="content">
              <div className="page" hidden={page !== "overview"}><Overview /></div>
              {page === "report" && <ReportPage />}
              {page === "security" && <SecurityPage />}
              {page === "settings" && <SettingsPage />}
              <NoteLayer layer="content" />
            </div>
            <DealSheet />
            {new URLSearchParams(location.search).get("demo") === "1" && <DemoBar />}
          </div>
          <Rail />
        </div>
      </div>
      <AnnotationsRoot />
      <Tip />
      {toast && <div id="toast" role="status">{toast}</div>}
      <Confirm />
    </div>
  );
}
