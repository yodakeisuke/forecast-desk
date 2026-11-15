// The dashboard's chart geometry, drawn inside the sandbox with the host's colour tokens (CSS variables).
import { useState } from "react";
import type { Chart, Mark, Tone } from "../../../src/shared/charts";

const TONE: Record<Tone, string> = {
  pos: "var(--pos)", neg: "var(--neg)", tot: "var(--tot)", ref: "var(--ref)", ink: "var(--ink)", ink2: "var(--ink-2)", muted: "var(--muted)",
  grid: "var(--grid)", axis: "var(--axis)", s1: "var(--s1)", s2: "var(--s2)", s3: "var(--s3)", surface: "var(--surface)", sunken: "var(--sunken)", agent: "var(--agent)", none: "none",
};

export function SvgChart({ chart }: { chart: Chart }) {
  const [cross, setCross] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; rows: { tone?: Tone; value: string; label: string }[] } | null>(null);
  const hits: Extract<Mark, { t: "hit" }>[] = [];
  return (
    <div className="chart" style={{ position: "relative" }}>
      <svg width={chart.w} height={chart.h} viewBox={`0 0 ${chart.w} ${chart.h}`} role="img" aria-label={chart.label} style={{ display: "block", overflow: "visible" }}>
        {chart.marks.map((m, i) => {
          switch (m.t) {
            case "rect": return <rect key={i} x={m.x} y={m.y} width={Math.max(0, m.w)} height={Math.max(0, m.h)} rx={m.rx} fill={TONE[m.fill]} opacity={m.opacity} data-mark={m.id} />;
            case "line": return <line key={i} x1={m.x1} x2={m.x2} y1={m.y1} y2={m.y2} stroke={TONE[m.stroke]} strokeWidth={m.sw ?? 1} strokeDasharray={m.dash} opacity={m.opacity} />;
            case "text": return <text key={i} x={m.x} y={m.y} fontSize={m.size ?? 11} fill={TONE[m.fill ?? "ink"]} textAnchor={m.anchor ?? "start"} fontWeight={m.weight ?? 400}>{m.text}</text>;
            case "path": return <path key={i} d={m.d} fill={m.fill ? TONE[m.fill] : "none"} stroke={m.stroke ? TONE[m.stroke] : undefined} strokeWidth={m.sw} opacity={m.opacity} data-mark={m.id} />;
            case "circle": return <circle key={i} cx={m.cx} cy={m.cy} r={m.r} fill={TONE[m.fill]} stroke={m.stroke ? TONE[m.stroke] : undefined} strokeWidth={m.sw} />;
            case "poly": return <polyline key={i} points={m.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")} fill="none" stroke={TONE[m.stroke]} strokeWidth={m.sw ?? 1.5} strokeLinejoin="round" strokeLinecap="round" opacity={m.opacity} data-mark={m.id} />;
            case "hit": hits.push(m); return null;
          }
        })}
        {cross != null && <line x1={cross} x2={cross} y1={0} y2={chart.h - 20} stroke="var(--axis)" pointerEvents="none" />}
        {hits.map((m, i) => (
          <rect key={`h${i}`} x={m.x} y={m.y} width={Math.max(0, m.w)} height={Math.max(0, m.h)} fill="transparent"
            onPointerMove={(e) => { if (m.cross != null) setCross(m.cross); const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title: m.tip.title, rows: m.tip.rows }); }}
            onPointerLeave={() => { setCross(null); setTip(null); }} />
        ))}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 12, chart.w - 150), top: Math.max(0, tip.y - 10) }}>
          <div className="h">{tip.title}</div>
          {tip.rows.map((r, i) => <div className="r" key={i}>{r.tone && <i style={{ background: TONE[r.tone] }} />}<b>{r.value}</b><span>{r.label}</span></div>)}
        </div>
      )}
    </div>
  );
}
