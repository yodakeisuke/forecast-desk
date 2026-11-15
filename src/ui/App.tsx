// The shell: icon rail | topbar / canvas (pages, notes, deal sheet, demo bar) | Agent activity.
// The overview stays mounted while other pages show, so generated widgets keep running in their sandboxes.
import { useEffect } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogClose } from "@ui-sdk/react/alert-dialog";
import { Button } from "@ui-sdk/react/button";
import { registration } from "../agent/register";
import { actions, useApp, type Page } from "../state/store";
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

const CRUMB: Record<Page, string> = { overview: "月次フォーキャストレビュー", report: "報告書", security: "セキュリティ", settings: "設定" };

function scrollToId(id: string) {
  actions.setPage("overview");
  requestAnimationFrame(() => {
    const el = document.getElementById(id), c = document.getElementById("content");
    if (el && c) c.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 20), behavior: "smooth" });
  });
}

function Side() {
  const page = useApp((s) => s.page), playing = useApp((s) => s.playing);
  const nav = (label: string, icon: React.ReactNode, on: boolean, go: () => void) => (
    <Button className={`nav${on ? " on" : ""}`} aria-label={label} aria-current={on ? "page" : undefined} disabled={playing} focusableWhenDisabled onClick={go}>{icon}<span className="tipx">{label}</span></Button>
  );
  return (
    <nav className="side" aria-label="メインナビゲーション">
      <div className="logo" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 12V8M8 12V4M13 12V6.5" stroke="var(--page)" strokeWidth="2" strokeLinecap="round" /></svg></div>
      {nav("フォーキャスト", <Ic.grid />, page === "overview", () => scrollToId("kpis"))}
      {nav("差異分析", <Ic.bars />, false, () => scrollToId("c-var"))}
      {nav("生成ウィジェット", <Ic.sliders />, false, () => scrollToId("genzone"))}
      {nav("レポート", <Ic.doc />, page === "report", () => actions.setPage("report"))}
      {nav("セキュリティ", <Ic.shield />, page === "security", () => actions.setPage("security"))}
      <div className="sp" />
      <Button className="nav" aria-label="設定" onClick={() => actions.setPage("settings")}><Ic.gear /><span className="tipx">設定</span></Button>
      <div className="av me" aria-label="あなた">KY</div>
    </nav>
  );
}

function AgentChip() {
  const busy = useApp((s) => s.busy);
  const last = useApp((s) => [...s.activity].reverse().find((g) => g.agent)?.agent);
  const mode = registration.mode === "native" ? "WebMCP" : registration.mode === "polyfill" ? "WebMCP polyfill" : "window.fpa";
  return (
    <div className={`agentchip${busy ? " busy" : ""}`} title="このページにツールを公開しています（WebMCP と window.fpa）">
      <span className="ag"><Spark /></span>
      {busy ? busy.agent : last ?? "Agent待ち"}
      <small>{busy ? <span className="mono">{busy.tool}</span> : `${mode} · ${registration.count} tools`}</small>
    </div>
  );
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
          <div className="hd"><span className="ag"><Spark /></span><AlertDialogTitle id="cf-t">エージェントが確認を求めています</AlertDialogTitle></div>
          <AlertDialogDescription id="cf-d">{c.text}</AlertDialogDescription>
          <p className="muted small">外に出る操作は、人の確認なしには実行しません。</p>
          <div className="ft">
            <AlertDialogClose className="tbtn">やめる</AlertDialogClose>
            <AlertDialogClose className="tbtn primary" value="confirm">許可する</AlertDialogClose>
          </div>
        </AlertDialogContent>
      </div>
    </AlertDialog>
  );
}

export function App() {
  const page = useApp((s) => s.page), rail = useApp((s) => s.rail), toast = useApp((s) => s.toast);
  const count = useApp((s) => s.activity.reduce((a, g) => a + g.items.length, 0));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") actions.closeNotes(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="app">
      <Side />
      <div className="main">
        <header className="topbar">
          <div className="crumb"><span>Sorano Cloud</span><span>/</span><span>FP&amp;A</span><span>/</span><b>{CRUMB[page]}</b></div>
          <div className="sp" />
          <AgentChip />
          <button className="tbtn" aria-controls="rail" aria-expanded={rail} onClick={actions.toggleRail}><Ic.menu />アクティビティ<span className="cnt">{count}</span></button>
          <Button className="tbtn primary" data-agent-confirm="このダッシュボードを共有します" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl()); actions.toast("比較元・絞り込み・シナリオ前提を含むリンクをコピーしました"); } catch { actions.toast("リンクをコピーできませんでした。ブラウザのクリップボード許可を確認してください"); } }}>共有</Button>
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
