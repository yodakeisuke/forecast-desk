// The DEMO bar: plays the story with the real tools (channel "demo"). Not part of the product.
import { useRef, useState } from "react";
import { history } from "../agent/bridge";
import { Cancel, currentRun, nextRun, playScene, SCENES } from "../demo/scenes";
import { actions } from "../state/store";
import { Ic } from "./icons";

export function DemoBar() {
  const [done, setDone] = useState(0);           // scenes finished
  const [cur, setCur] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(false);
  const ctx = useRef<Record<string, unknown>>({});

  const reset = () => { actions.reset(); history.clear(); ctx.current = {}; document.getElementById("content")?.scrollTo({ top: 0 }); };
  const play = async (i: number, id = nextRun()) => {
    setCur(i);
    actions.setPlaying(true);
    try { await playScene(i, ctx.current, id); setDone(i + 1); }
    catch (e) { autoRef.current = false; setAuto(false); if (!(e instanceof Cancel)) { console.error(e); actions.toast(`シーン${i + 1}で失敗: ${(e as Error).message}`); } }
    finally {
      if (id === currentRun()) {
        setCur(null); actions.setPlaying(false);
        if (i + 1 >= SCENES.length) { autoRef.current = false; setAuto(false); }
        else if (autoRef.current) setTimeout(() => { if (autoRef.current && id === currentRun()) play(i + 1); }, 3200);
      }
    }
  };
  /** Rebuild the state up to scene n quickly (same tools, no pauses), then stop. */
  const jumpTo = async (n: number) => {
    const id = nextRun();
    reset(); setDone(0); setCur(null);
    actions.setPlaying(true);
    try { for (let i = 0; i < n; i++) { await playScene(i, ctx.current, id, true); setDone(i + 1); } }
    catch (e) { if (!(e instanceof Cancel)) { console.error(e); actions.toast(`シーンの再構成に失敗: ${(e as Error).message}`); } if (id === currentRun()) actions.setPlaying(false); return false; }
    if (id === currentRun()) { actions.setPlaying(false); actions.closeNotes(); }
    return id === currentRun();
  };
  const next = () => { if (cur != null) return; if (done < SCENES.length) play(done); };
  const prev = () => { autoRef.current = false; setAuto(false); jumpTo(Math.max(0, cur != null ? cur : done - 1)); };
  const toggleAuto = () => {
    const on = !autoRef.current; autoRef.current = on; setAuto(on);
    if (on && cur == null) { if (done >= SCENES.length) jumpTo(0).then((ok) => { if (ok) play(0); }); else play(done); }
  };
  const idx = cur ?? Math.min(done, SCENES.length - 1), sc = SCENES[idx];
  return (
    <div className="demo" aria-label="デモ再生">
      <span className="lab">DEMO</span>
      <button className="b" onClick={prev} disabled={done === 0 && cur == null} aria-label="前のシーン"><Ic.prev /></button>
      <div className="now">
        <span className="t">{idx + 1}/{SCENES.length} · {sc.t}{sc.security && <span className="sec">攻撃テスト</span>}</span>
        <span className="q">{cur == null && done >= SCENES.length ? "完了 · ↺ で最初から" : `「${sc.q}」`}</span>
      </div>
      <div className="dots">
        {SCENES.map((s, k) => <button key={k} className={`${k < done ? "done" : ""}${k === cur ? " cur" : ""}${s.security ? " secd" : ""}`} aria-label={`シーン${k + 1} ${s.t}`} onClick={async () => { autoRef.current = false; setAuto(false); if (await jumpTo(k)) play(k); }}>{k + 1}</button>)}
      </div>
      <button className="b" onClick={next} disabled={cur != null || done >= SCENES.length} aria-label="次のシーン"><Ic.next /></button>
      <span className="sepv" />
      <button className="b" onClick={toggleAuto} aria-pressed={auto} aria-label="自動再生">{auto ? <Ic.pause /> : <Ic.play />}</button>
      <button className="b" onClick={() => { autoRef.current = false; setAuto(false); nextRun(); reset(); setDone(0); setCur(null); actions.setPlaying(false); }} aria-label="最初から"><Ic.reset /></button>
    </div>
  );
}
