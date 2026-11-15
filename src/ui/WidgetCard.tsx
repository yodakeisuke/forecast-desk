// Generated widgets. The card (frame, provenance, controls) belongs to the host; the inside is an iframe
// on the sandbox origin running the generated code. Provenance is shown quietly: a tinted hairline, the
// "生成" mark, and a footer saying who made it, from what, and where it runs.
import { useEffect, useRef } from "react";
import { attach, detach, SANDBOX_URL, resolveWidgetChange } from "../genui/host";
import { applyWidgetSuggestion } from "../agent/tools";
import { actions, useApp, type Widget } from "../state/store";
import { Presence } from "./Card";
import { Ic, Spark } from "./icons";

export function WidgetFrame({ w, runtimeKey, preview = false, height }: { w: Pick<Widget, "id" | "code" | "title" | "revision">; runtimeKey: string; preview?: boolean; height?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const onLoad = () => { if (el.src.startsWith(SANDBOX_URL)) attach(runtimeKey, w.id, w.code, el, preview); };
    el.addEventListener("load", onLoad);
    el.src = `${SANDBOX_URL}?w=${encodeURIComponent(runtimeKey)}`;
    return () => { el.removeEventListener("load", onLoad); detach(runtimeKey); };
  }, [runtimeKey, w.code, w.id, w.revision, preview]);
  return (
    <iframe
      ref={ref}
      title={`生成ウィジェット: ${w.title}`}
      className="gen-frame"
      // The wall: scripts only. No same-origin, no forms, no popups, no top navigation, no features.
      sandbox="allow-scripts"
      allow=""
      referrerPolicy="no-referrer"
      loading="eager"
      {...{ credentialless: "" }}
      style={{ height: height ?? 236 }}
    />
  );
}

function WidgetCard({ w, i }: { w: Widget; i: number }) {
  const busy = useApp((s) => s.busy?.target === `w-${w.id}`);
  useEffect(() => { if (w.born) { const t = setTimeout(() => actions.patchWidget(w.id, { born: false }), 1600); return () => clearTimeout(t); } }, [w.born, w.id]);
  return (
    <section className={`card dimmable gen-card c6${w.born ? " born" : ""}${busy ? " busy" : ""}`} id={`w-${w.id}`} data-target={`widget:${w.id}`} style={{ ["--born-delay" as string]: `${i * 40}ms` }}>
      <Presence id={`w-${w.id}`} />
      <div className="card-h">
        <div className="tt">
          <div className="card-t">{w.title}</div>
          {w.subtitle && <div className="card-s">{w.subtitle}</div>}
        </div>
        <div className="acts">
          <details className="toolbar-menu widget-menu">
            <summary aria-label={`${w.title}の詳細`}><Ic.more /></summary>
            <div className="menu-panel">
              <span className="menu-meta">{w.agent} · {w.at}</span>
              <button aria-pressed={w.showCode} onClick={() => actions.patchWidget(w.id, { showCode: !w.showCode })}>{w.showCode ? "分析を表示" : "コードを表示"}</button>
              <span className="menu-meta">読み取り {w.dataReads} 回 · 隔離実行</span>
            </div>
          </details>
        </div>
      </div>
      <div className="card-b gen-body">
        {w.showCode && <pre className="specview" aria-label="生成されたコード">{w.code}</pre>}
        <div className="gen-stage" hidden={w.showCode}>
          {w.status === "loading" && <div className="skel gen-skel">分析を準備しています…</div>}
          {w.status !== "destroyed" && <div className={w.status === "loading" ? "gen-hidden" : ""}><WidgetFrame w={w} runtimeKey={w.id} height={w.height} /></div>}
          {(w.status === "error" || w.status === "destroyed") && <div className="gen-error" role="alert"><b>{w.status === "destroyed" ? "停止しました" : "描画できませんでした"}</b><span>{w.error}</span></div>}
        </div>
        {w.pendingChange && <div className="gen-suggest" data-agent-hidden>
          <span>前提の変更: <b>{w.pendingChange.label}</b></span>
          <button className="tbtn mini" onClick={e => resolveWidgetChange(w.id, w.pendingChange!.id, true, e.nativeEvent)}>この変更を許可</button>
          <button className="tbtn mini" onClick={e => resolveWidgetChange(w.id, w.pendingChange!.id, false, e.nativeEvent)}>取り消す</button>
        </div>}
        {w.suggestion && (
          <div className="gen-suggest">
            <Spark /><span>分析の提案: <b>{w.suggestion.label}</b></span>
            <button className="tbtn mini" onClick={() => { applySuggestion(w); }}>反映する</button>
            <button className="tbtn mini ghost" onClick={() => actions.patchWidget(w.id, { suggestion: null })}>閉じる</button>
          </div>
        )}
      </div>

    </section>
  );
}

async function applySuggestion(w: Widget) {
  const s = w.suggestion;
  if (!s) return;
  const result = await applyWidgetSuggestion(s.tool, s.args) as { ok?: boolean; error?: string };
  if (result?.ok === false) { actions.toast(`提案を反映できません: ${result.error}`); return; }
  actions.pushItem({ who: "user", result: `ウィジェットの提案「${s.label}」を反映`, running: false });
  actions.patchWidget(w.id, { suggestion: null });
}

export function WidgetZone() {
  const widgets = useApp((s) => s.widgets);
  if (!widgets.length) return null;
  return (
    <>
      <div className="secthead dimmable" id="genzone">
        <h2>追加の分析</h2>
        <span className="muted">{widgets.length}</span>
        <span className="line" />
      </div>
      <div className="grid gen-grid">{widgets.map((w, i) => <WidgetCard key={w.id} w={w} i={i} />)}</div>
    </>
  );
}
