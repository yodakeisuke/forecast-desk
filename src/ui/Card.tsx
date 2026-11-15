import { createContext, useState, type ReactNode } from "react";
import { Button } from "@ui-sdk/react/button";
import { actions } from "../state/store";
import { downloadBlob } from "../lib/download";
export const TableMode = createContext(false);
import { useApp } from "../state/store";
import { Ic, Spark } from "./icons";

export function Presence({ id }: { id: string }) {
  const busy = useApp((s) => s.busy);
  if (!busy || busy.target !== id) return <span className="presence" />;
  return <span className="presence"><Spark />{busy.agent} <span className="mono">{busy.tool}</span></span>;
}

export function Card({ id, cls = "", title, sub, children, extra, born }: { id: string; cls?: string; title: ReactNode; sub?: ReactNode; children: ReactNode; extra?: ReactNode; born?: boolean }) {
  const busy = useApp((s) => s.busy?.target === id);
  const [table, setTable] = useState(false);
  const [menu, setMenu] = useState(false);
  const exportCard = () => {
    const el = document.getElementById(id);
    const rows = [...(el?.querySelectorAll("table tr") ?? [])].map(row => [...row.querySelectorAll("th, td")].map(cell => cell.textContent ?? ""));
    if (!rows.length) { setTable(true); actions.toast("表を表示してからCSVを書き出してください"); return; }
    const csv = rows.map(row => row.map(value => `"${(/^[=+@-]/.test(value) ? "\'" : "") + value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), `${id}.csv`); setMenu(false);
  };
  return (
    <section className={`card dimmable ${cls}${busy ? " busy" : ""}${born ? " born" : ""}`} id={id} data-target={`card:${id.replace(/^c-/, "")}`}>
      <Presence id={id} />
      <div className="card-h">
        <div className="tt"><div className="card-t">{title}</div>{sub ? <div className="card-s">{sub}</div> : null}</div>
        <div className="acts">{extra}<Button className="ibtn" aria-label={table ? "チャートで見る" : "表で見る"} aria-pressed={table} onClick={() => setTable(!table)}><Ic.table /></Button><Button className="ibtn" aria-label="メニュー" aria-expanded={menu} onClick={() => setMenu(!menu)}><Ic.more /></Button>{menu && <Button className="tbtn" onClick={exportCard}>CSVを書き出す</Button>}</div>
      </div>
      <TableMode.Provider value={table}>{children}</TableMode.Provider>
    </section>
  );
}

export function Delta({ cur, base: r, unit, d = 1, up, pt }: { cur: number; base: number; unit: string; d?: number; up: boolean | null; pt?: boolean }) {
  const dv = cur - r;
  if (Math.abs(dv) < 10 ** -(d + 1)) return <span className="muted">±0</span>;
  const good = up == null ? null : (dv > 0) === up;
  return (
    <span className={`delta ${good == null ? "" : good ? "good" : "bad"}`}>
      <span style={{ fontSize: 8 }}>{dv > 0 ? "▲" : "▼"}</span>
      <b>{(dv > 0 ? "+" : "−") + Math.abs(dv).toFixed(d)}{pt ? "pt" : unit === "億円" ? "億" : unit}</b>
    </span>
  );
}
