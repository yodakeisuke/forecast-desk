// Renders the shared chart geometry (src/shared/charts.ts) as SVG in the DOM, with tooltips and a crosshair.
import { useContext, useState } from "react";
import { TableMode } from "./Card";
import type { Chart, Mark, Tone } from "../shared/charts";
import { actions } from "../state/store";

export const TONE: Record<Tone, string> = {
  pos: "var(--pos)", neg: "var(--neg)", tot: "var(--tot)", ref: "var(--ref)", ink: "var(--ink)", ink2: "var(--ink-2)", muted: "var(--muted)",
  grid: "var(--grid)", axis: "var(--axis)", s1: "var(--s1)", s2: "var(--s2)", s3: "var(--s3)", surface: "var(--surface)", sunken: "var(--sunken)", agent: "var(--agent)", none: "none",
};

export function SvgChart({ chart, className }: { chart: Chart; className?: string }) {
  const [cross, setCross] = useState<number | null>(null);
  const table = useContext(TableMode);
  const hits: Extract<Mark, { t: "hit" }>[] = [];
  if (table) {
    const data = chart.marks.filter((m): m is Extract<Mark, { t: "hit" }> => m.t === "hit");
    return <div className="tw"><table className="t" aria-label={chart.label}><thead><tr><th>項目</th><th>区分</th><th>値</th></tr></thead><tbody>{data.flatMap((m, i) => m.tip.rows.map((row, j) => <tr key={`${i}-${j}`}><td>{m.tip.title}</td><td>{row.label}</td><td>{row.value}</td></tr>))}</tbody></table></div>;
  }
  return (
    <svg width={chart.w} height={chart.h} viewBox={`0 0 ${chart.w} ${chart.h}`} role="img" aria-label={chart.label} className={className} style={{ display: "block", overflow: "visible" }}>
      {chart.marks.map((m, i) => {
        switch (m.t) {
          case "rect": return <rect key={i} x={m.x} y={m.y} width={Math.max(0, m.w)} height={Math.max(0, m.h)} rx={m.rx} fill={TONE[m.fill]} opacity={m.opacity} data-target={m.id} pointerEvents={m.fill === "none" ? "none" : undefined} />;
          case "line": return <line key={i} x1={m.x1} x2={m.x2} y1={m.y1} y2={m.y2} stroke={TONE[m.stroke]} strokeWidth={m.sw ?? 1} strokeDasharray={m.dash} opacity={m.opacity} />;
          case "text": return <text key={i} x={m.x} y={m.y} fontSize={m.size ?? 11} fill={TONE[m.fill ?? "ink"]} textAnchor={m.anchor ?? "start"} fontWeight={m.weight ?? 400} className="tnum">{m.text}</text>;
          case "path": return <path key={i} d={m.d} fill={m.fill ? TONE[m.fill] : "none"} stroke={m.stroke ? TONE[m.stroke] : undefined} strokeWidth={m.sw} opacity={m.opacity} data-target={m.id} />;
          case "circle": return <circle key={i} cx={m.cx} cy={m.cy} r={m.r} fill={TONE[m.fill]} stroke={m.stroke ? TONE[m.stroke] : undefined} strokeWidth={m.sw} />;
          case "poly": return <polyline key={i} points={m.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")} fill="none" stroke={TONE[m.stroke]} strokeWidth={m.sw ?? 1.5} strokeLinejoin="round" strokeLinecap="round" opacity={m.opacity} data-target={m.id} />;
          case "hit": hits.push(m); return null;
        }
      })}
      {cross != null && <line x1={cross} x2={cross} y1={0} y2={chart.h - 20} stroke="var(--axis)" pointerEvents="none" />}
      {hits.map((m, i) => (
        <rect key={`h${i}`} x={m.x} y={m.y} width={Math.max(0, m.w)} height={Math.max(0, m.h)} fill="transparent"
          onPointerMove={(e) => { if (m.cross != null) setCross(m.cross); actions.setTip({ x: e.clientX, y: e.clientY, title: m.tip.title, rows: m.tip.rows.map((r) => ({ ...r, tone: r.tone ? TONE[r.tone] : undefined })) }); }}
          onPointerLeave={() => { setCross(null); actions.setTip(null); }} />
      ))}
    </svg>
  );
}

export function Spark({ chart }: { chart: Chart }) {
  return <svg className="spark" width={chart.w} height={chart.h} viewBox={`0 0 ${chart.w} ${chart.h}`} aria-hidden="true">{chart.marks.map((m, i) => m.t === "poly" ? <polyline key={i} points={m.points.map((p) => p.join(",")).join(" ")} fill="none" stroke={TONE[m.stroke]} strokeWidth={m.sw} strokeLinejoin="round" strokeLinecap="round" /> : m.t === "circle" ? <circle key={i} cx={m.cx} cy={m.cy} r={m.r} fill={TONE[m.fill]} stroke={m.stroke ? TONE[m.stroke] : undefined} strokeWidth={m.sw} /> : null)}</svg>;
}
