// Annotations: an agent rings an element and leaves a note ("look here"). The layer is a UI SDK primitive,
// so highlight goes through act() like every other screen change.
import { usePart, usePrimitive } from "@ui-sdk/react/primitive";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { actions, getState, store, useApp, type Note } from "../state/store";
import { located, requestLocate } from "../genui/host";
import { currentAgent } from "../agent/context";
import { annotations } from "./primitives";
import { Check } from "./icons";
import { revealElement } from "./attention";

export function findTarget(target: string): Element | null {
  const [base] = target.split("/").length > 1 && target.startsWith("widget:") ? [target.split("/")[0]] : [target];
  try { const el = document.querySelector(`[data-target="${CSS.escape(base)}"]`); return el?.getClientRects().length ? el : null; } catch { return null; }
}
export function listTargets(): string[] {
  return [...new Set([...document.querySelectorAll("[data-target]")].filter((e) => (e as HTMLElement).getClientRects().length).map((e) => e.getAttribute("data-target")!))];
}

export function AnnotationsRoot() {
  const notes = useApp(s => s.notes);
  const count = notes.length;
  const handle = usePrimitive(annotations, {
    value: JSON.stringify(notes),
    onValueChange: actions.restoreNotes,
    onHighlight: (target: string, note: string) => {
      const el = findTarget(target);
      if (!el) return null;
      const [wid, sub] = target.startsWith("widget:") ? [target.slice(7).split("/")[0], target.split("/").slice(1).join("/")] : [null, null];
      const n = actions.addNote(target, note, "agent", currentAgent());
      if (wid && sub) {
        void requestLocate(wid, sub).then(rect => {
          if (!getState().notes.some(note => note.n === n && note.open)) return;
          const frame = el.querySelector("iframe")?.getBoundingClientRect();
          const box = rect && frame ? new DOMRect(frame.left + rect.x, frame.top + rect.y, rect.w, rect.h) : el.getBoundingClientRect();
          revealElement(el, box, 170);
        });
      } else requestAnimationFrame(() => revealElement(el, el.getBoundingClientRect(), 170));
      return { n, value: JSON.stringify(getState().notes) };
    },
    onDismiss: (n?: number) => (n ? actions.toggleNote(n, false) : actions.closeNotes()),
  });
  return usePart(handle, "root", {}, { "aria-label": "注記", className: "sr-only", children: <span>{count}件の注記</span> }, "div");
}

type Pos = { n: number; ring?: { l: number; t: number; w: number; h: number }; pop?: { l: number; t: number }; pin?: { l: number; t: number } };

function layout(container: HTMLElement, layer: string, notes: Note[], popSize: Map<number, { w: number; h: number }>): Pos[] {
  const page = getState().page;
  const out: Pos[] = [];
  for (const nt of notes) {
    if (nt.page !== page) continue;
    const current = getState();
    if (page === "overview" && (nt.context.compare !== current.compare || ["region", "segment", "product"].some(k => (nt.context.filters[k as keyof typeof current.filters] ?? null) !== (current.filters[k as keyof typeof current.filters] ?? null)))) continue;
    const el = findTarget(nt.target);
    if (!el || !(el as HTMLElement).getClientRects().length) continue;
    const host = el.closest("[data-layer]");
    if (!host || host.getAttribute("data-layer") !== layer) continue;
    const hr = container.getBoundingClientRect();
    let r = el.getBoundingClientRect();
    if (nt.target.startsWith("widget:") && nt.target.includes("/")) {
      const frame = el.querySelector("iframe");
      const sub = located(nt.target.slice(7).split("/")[0], nt.target.split("/").slice(1).join("/"));
      if (frame && sub) { const fr = frame.getBoundingClientRect(); r = new DOMRect(fr.left + sub.x, fr.top + sub.y, sub.w, sub.h); }
      else if (frame) r = frame.getBoundingClientRect();
    }
    const L = r.left - hr.left + container.scrollLeft, T = r.top - hr.top + container.scrollTop, W = r.width, H = r.height;
    if (nt.open) {
      const { w: pw, h: ph } = popSize.get(nt.n) ?? { w: 276, h: 120 };
      const hw = container.clientWidth;
      const visibleTop = container.scrollTop + 12, visibleBottom = container.scrollTop + container.clientHeight - 12;
      let pl: number, pt: number;
      if (L + W + 16 + pw <= hw - 8) { pl = L + W + 16; pt = T; }
      else if (L - pw - 16 >= 8 && W < hw * 0.6) { pl = L - pw - 16; pt = T; }
      else if (T - ph - 14 >= visibleTop) { pl = Math.min(Math.max(8, L + W - pw), hw - pw - 8); pt = T - ph - 14; }
      else if (T + H + 14 + ph <= visibleBottom) { pl = Math.min(Math.max(8, L + W - pw), hw - pw - 8); pt = T + H + 14; }
      else { pl = Math.max(8, L + W - pw - 10); pt = T + 10; }
      pt = Math.max(visibleTop, Math.min(pt, visibleBottom - ph));
      out.push({ n: nt.n, ring: { l: L - 4, t: T - 4, w: W + 8, h: H + 8 }, pop: { l: pl, t: pt } });
    } else out.push({ n: nt.n, pin: { l: L + W - 12, t: T - 10 } });
  }
  return out;
}

export function NoteLayer({ layer }: { layer: "content" | "sheet" }) {
  const notes = useApp((s) => s.notes);
  const ref = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<number, { w: number; h: number }>());
  const [pos, setPos] = useState<Pos[]>([]);
  const relayout = () => {
    const c = ref.current?.parentElement;
    if (!c) return;
    const next = layout(c, layer, getState().notes, sizes.current);
    setPos((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
  };
  useLayoutEffect(relayout);
  useEffect(() => {
    const c = ref.current?.parentElement;
    const unsub = store.subscribe(() => requestAnimationFrame(relayout));
    const ro = new ResizeObserver(() => relayout());
    if (c) ro.observe(c);
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(relayout); };
    c?.addEventListener("scroll", onScroll, { passive: true });
    const iv = setInterval(() => getState().notes.length && relayout(), 350);
    addEventListener("resize", relayout);
    return () => { unsub(); ro.disconnect(); clearInterval(iv); cancelAnimationFrame(frame); c?.removeEventListener("scroll", onScroll); removeEventListener("resize", relayout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mark the subject while keeping the surrounding figures readable.
  useEffect(() => {
    if (layer !== "content") return;
    const c = ref.current?.parentElement;
    if (!c) return;
    // an attribute React does not own, so a re-render of the card keeps it
    document.querySelectorAll("[data-focused]").forEach((e) => e.removeAttribute("data-focused"));
    const open = notes.find((n) => n.open && pos.some((p) => p.n === n.n && p.ring));
    c.classList.toggle("focus", !!open);
    if (open) findTarget(open.target)?.closest(".dimmable")?.setAttribute("data-focused", "");
  }, [notes, pos, layer]);
  return (
    <div ref={ref} className="note-layer" aria-live="polite">
      {pos.map((p) => {
        const nt = notes.find((x) => x.n === p.n)!;
        if (!nt) return null;
        if (p.pin) return <button key={p.n} className="n-pin" style={{ left: p.pin.l, top: p.pin.t }} aria-label={`注記${nt.n}を開く`} onClick={() => actions.toggleNote(nt.n, true)}>{nt.n}</button>;
        return (
          <div key={p.n}>
            <div className="n-ring" style={{ left: p.ring!.l, top: p.ring!.t, width: p.ring!.w, height: p.ring!.h }} />
            <div className="n-pop" role="note" style={{ left: p.pop!.l, top: p.pop!.t }} ref={(el) => { if (el) sizes.current.set(nt.n, { w: el.offsetWidth, h: el.offsetHeight }); }}>
              <div className="hd"><span className="num-b">{nt.n}</span><b>分析メモ</b><span>{nt.at}</span></div>
              <p>{nt.text}</p>
              <div className="ft">
                <button className={`inrep${nt.inReport ? " on" : ""}`} aria-pressed={nt.inReport} onClick={() => actions.setNoteInReport(nt.n, !nt.inReport)}>{nt.inReport ? <Check /> : null}<span>{nt.inReport ? "レポートに含める" : "レポートに追加"}</span></button>
                <button onClick={() => actions.toggleNote(nt.n, false)}>閉じる</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
