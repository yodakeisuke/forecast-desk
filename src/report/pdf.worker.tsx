// Runs in a Web Worker: renders a report@1 spec to PDF with react-pdf, through json-render's PDF Renderer.
// Same catalog as the screen; figures arrive already materialised (chart geometry, tables, slot SVG trees).
import { Circle, Document, Ellipse, Font, G, Line, Page, Path, pdf, Polygon, Polyline, Rect, StyleSheet, Svg, Text, Tspan, View } from "@react-pdf/renderer";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react-pdf";
import type { ReactNode } from "react";
import { reportCatalog } from "./catalog";
import type { Chart, Mark, Tone } from "../shared/charts";
import type { Block, SvgNode } from "./figures";

// paper is always light
const P: Record<Tone, string> = {
  pos: "#2a78d6", neg: "#e34948", tot: "#a4a39c", ref: "#a4a39c", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781",
  grid: "#e8e7e1", axis: "#c3c2b7", s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", surface: "#ffffff", sunken: "#f6f6f3", agent: "#6250d6", none: "none",
};
const F = "NotoSansJP";
// A4 content width, excluding page padding and the figure border/padding.
const FIGURE_WIDTH = 595.28 - 46 * 2 - 8 * 2 - 0.6 * 2;
// Japanese line breaks must not acquire English syllable hyphens.
Font.registerHyphenationCallback(word => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)
  ? Array.from(word).flatMap(char => [char, ""])
  : [word]);
const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 52, paddingHorizontal: 46, fontFamily: F, fontSize: 9.5, color: P.ink, lineHeight: 1.6 },
  eb: { fontSize: 8, color: P.muted, marginBottom: 6 },
  h1: { fontSize: 15, fontWeight: 600, lineHeight: 1.45, marginBottom: 12 },
  lead: { fontSize: 12, fontWeight: 600, lineHeight: 1.55, color: P.ink, marginBottom: 12, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: P.ink },
  h2: { fontSize: 11, fontWeight: 600, marginTop: 16, marginBottom: 4, flexDirection: "row" },
  no: { fontSize: 8.5, color: P.muted, marginRight: 6 },
  p: { fontSize: 9.5, color: P.ink2, marginBottom: 6 },
  b: { color: P.ink, fontWeight: 600 },
  fn: { fontSize: 7, color: "#4f3fc0" },
  rk: { flexDirection: "row", borderWidth: 0.6, borderColor: "#dcdcd7", borderRadius: 5, marginBottom: 6 },
  rkc: { flex: 1, paddingVertical: 7, paddingHorizontal: 9, borderRightWidth: 0.6, borderColor: "#dcdcd7" },
  rkl: { fontSize: 7.5, color: P.ink2 },
  rkv: { fontSize: 14, fontWeight: 600 },
  rku: { fontSize: 7.5, color: P.muted },
  fig: { marginVertical: 6, padding: 8, borderWidth: 0.6, borderColor: "#dcdcd7", borderRadius: 5 },
  cap: { fontSize: 7.5, color: P.muted, marginTop: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#e5e5e0", paddingVertical: 3 },
  th: { fontSize: 7.5, color: P.muted, paddingHorizontal: 4 },
  td: { fontSize: 8.5, paddingHorizontal: 4 },
  li: { flexDirection: "row", marginBottom: 2 },
  callout: { backgroundColor: P.sunken, borderRadius: 4, padding: 6, fontSize: 8.5, color: P.ink2, marginTop: 4 },
  foot: { position: "absolute", top: 806, left: 46, right: 46, fontSize: 7, color: P.muted },
});

let blocks: Record<string, Block[]> = {};

function rich(text: string): ReactNode[] {
  const out: ReactNode[] = []; const re = /\*\*(.+?)\*\*|\[(\d{1,2})\]/g; let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <Text key={k++} style={s.b}>{m[1]}</Text> : <Text key={k++} style={s.fn}> [{m[2]}]</Text>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ChartSvg({ c }: { c: Chart }) {
  const scale = Math.min(1, FIGURE_WIDTH / c.w);
  return (
    <Svg width={c.w * scale} height={c.h * scale} viewBox={`0 0 ${c.w} ${c.h}`}>
      {c.marks.map((m: Mark, i) => {
        switch (m.t) {
          case "rect": return m.fill === "none" ? null : <Rect key={i} x={m.x} y={m.y} width={Math.max(0, m.w)} height={Math.max(0, m.h)} rx={m.rx} fill={P[m.fill]} opacity={m.opacity} />;
          case "line": return <Line key={i} x1={m.x1} x2={m.x2} y1={m.y1} y2={m.y2} stroke={P[m.stroke]} strokeWidth={m.sw ?? 1} strokeDasharray={m.dash} opacity={m.opacity} />;
          case "text": return <Text key={i} x={m.x} y={m.y} style={{ fontSize: m.size ?? 11, fontFamily: F, fontWeight: m.weight ?? 400 }} fill={P[m.fill ?? "ink"]} textAnchor={m.anchor ?? "start"}>{m.text}</Text>;
          case "path": return <Path key={i} d={m.d} fill={m.fill ? P[m.fill] : "none"} stroke={m.stroke ? P[m.stroke] : undefined} strokeWidth={m.sw} opacity={m.opacity} />;
          case "circle": return <Circle key={i} cx={m.cx} cy={m.cy} r={m.r} fill={P[m.fill]} stroke={m.stroke ? P[m.stroke] : undefined} strokeWidth={m.sw} />;
          case "poly": return <Polyline key={i} points={m.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")} fill="none" stroke={P[m.stroke]} strokeWidth={m.sw ?? 1.5} strokeLinejoin="round" strokeLinecap="round" opacity={m.opacity} />;
          default: return null;
        }
      })}
    </Svg>
  );
}

const TAG: Record<string, any> = { svg: Svg, g: G, rect: Rect, line: Line, path: Path, circle: Circle, ellipse: Ellipse, polyline: Polyline, polygon: Polygon, text: Text, tspan: Tspan };
const camel = (k: string) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function Tree({ n, root }: { n: SvgNode; root?: boolean }): ReactNode {
  const C = TAG[n.tag];
  if (!C) return null;
  const a: Record<string, any> = {};
  for (const [k, v] of Object.entries(n.a)) a[camel(k)] = /^-?[\d.]+(px)?$/.test(v) ? parseFloat(v) : v;
  if (n.tag === "text" || n.tag === "tspan") { a.style = { fontFamily: F, fontSize: a.fontSize ?? 10, fontWeight: Number(a.fontWeight) || 400 }; delete a.fontSize; delete a.fontWeight; }
  if (root) {
    const w = Number(a.width) || 400, h = Number(a.height) || 100, sc = Math.min(1, FIGURE_WIDTH / w);
    a.viewBox ??= `0 0 ${w} ${h}`; a.width = w * sc; a.height = h * sc;
  }
  return <C {...a}>{n.text}{n.c?.map((c, i) => <Tree key={i} n={c} />)}</C>;
}

function BlockPdf({ b }: { b: Block }) {
  switch (b.t) {
    case "chart": return <ChartSvg c={b.chart} />;
    case "svg": return <Tree n={b.node} root />;
    case "text": return <Text style={s.callout}>{b.text}</Text>;
    case "kv": return <View>{b.items.map((x, i) => <View key={i} style={s.tr}><Text style={[s.td, { flex: 1 }]}>{x.label}</Text><Text style={[s.td, s.b]}>{x.value}</Text></View>)}</View>;
    case "table": {
      // columns share the width by their longest cell, so long text (reasons, notes) gets the room
      const wd = (t: string) => [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
      const flex = b.head.map((h, i) => Math.min(40, Math.max(6, wd(h) + 2, ...b.rows.map((r) => wd(String(r[i] ?? ""))))));
      return (
        <View>
          <View style={s.tr}>{b.head.map((h, i) => <Text key={i} style={[s.th, { flex: flex[i], textAlign: b.align?.[i] === "l" ? "left" : "right" }]}>{h}</Text>)}</View>
          {b.rows.map((r, i) => <View key={i} style={s.tr}>{r.map((c, j) => <Text key={j} style={[s.td, { flex: flex[j], textAlign: b.align?.[j] === "l" ? "left" : "right" }, b.tot === i ? s.b : {}]}>{c}</Text>)}</View>)}
        </View>
      );
    }
  }
}

const { registry } = defineRegistry(reportCatalog, {
  components: {
    Document: ({ props, children }: any) => (
      <Document title={props.title} author={props.author} subject="月次フォーキャストレビュー" creator="Forecast Desk">
        <Page size="A4" style={s.page}>
          <Text style={s.foot} fixed>{props.materials}</Text>
          <Text style={[s.foot, { textAlign: "right" }]} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          <Text style={s.eb}>{props.eyebrow}</Text>
          <Text style={s.h1}>{props.title}</Text>
          {children}
        </Page>
      </Document>
    ),
    Section: ({ props, children }: any) => (
      <View>
        {props.no !== "" && <View style={s.h2} minPresenceAhead={60}><Text style={s.no}>{props.no}　</Text><Text>{props.title}</Text></View>}
        {children}
      </View>
    ),
    Headline: ({ props }: any) => <Text style={s.lead}>{rich(props.text)}</Text>,
    Paragraph: ({ props }: any) => <Text style={s.p}>{rich(props.text)}</Text>,
    KpiRow: ({ props }: any) => (
      <View style={s.rk} wrap={false}>
        {props.items.map((x: any, i: number) => (
          <View key={i} style={[s.rkc, i === props.items.length - 1 ? { borderRightWidth: 0 } : {}]}>
            <Text style={s.rkl}>{x.label}</Text>
            <Text style={s.rkv}>{x.value}<Text style={s.rku}> {x.unit}</Text></Text>
            <Text style={{ fontSize: 7.5, color: x.tone === "bad" ? "#c7302f" : P.muted }}>{x.delta}</Text>
          </View>
        ))}
      </View>
    ),
    Finding: ({ props }: any) => <Text style={s.callout}>[{props.n}] {props.text}</Text>,
    Figure: ({ props }: any) => (
      <View style={s.fig} wrap={false}>
        {(blocks[findKey(props)] ?? []).map((b, i) => <BlockPdf key={i} b={b} />)}
        <Text style={s.cap}>{props.no}　{props.caption}</Text>
      </View>
    ),
    Bullets: ({ props }: any) => <View style={{ marginBottom: 4 }}>{props.items.map((x: string, i: number) => <View key={i} style={s.li}><Text style={[s.p, { width: 10, marginBottom: 0 }]}>・</Text><Text style={[s.p, { flex: 1, marginBottom: 0 }]}>{rich(x)}</Text></View>)}</View>,
    Trail: ({ props }: any) => (
      <View>
        {props.items.map((x: any, i: number) => <View key={i} style={s.tr} wrap={false}><Text style={[s.td, { width: 36, color: P.muted }]}>{x.at}</Text><Text style={[s.td, { width: 96 }]}>{x.tool}</Text><Text style={[s.td, { flex: 1, color: P.ink2 }]}>{x.text}</Text></View>)}
      </View>
    ),
  } as any,
});

// json-render passes the element without its key; figures are matched by their number and caption instead.
let byNo: Record<string, string> = {};
const findKey = (p: any) => byNo[`${p.no}|${p.caption}`] ?? "";

self.onmessage = async (e: MessageEvent) => {
  try {
    const { spec, blocks: b, fontBase } = e.data as { spec: any; blocks: Record<string, Block[]>; fontBase: string };
    blocks = b;
    byNo = Object.fromEntries(Object.entries(spec.elements).filter(([, x]: any) => x.type === "Figure").map(([k, x]: any) => [`${x.props.no}|${x.props.caption}`, k]));
    Font.register({ family: F, fonts: [{ src: `${fontBase}NotoSansJP_400Regular.ttf`, fontWeight: 400 }, { src: `${fontBase}NotoSansJP_600SemiBold.ttf`, fontWeight: 600 }] });
    const check = reportCatalog.validate(spec);
    if (!check.success) throw new Error("報告書specがカタログに合いません");
    const blob = await pdf(<JSONUIProvider registry={registry}><Renderer spec={spec} registry={registry} includeStandard={false} /></JSONUIProvider> as any).toBlob();
    (self as any).postMessage({ ok: true, blob });
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
