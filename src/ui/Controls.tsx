// Filters and the comparison base: ready-made UI SDK parts, controlled by the store.
// An agent changes them with act() (setValue), exactly like a person picking an item.
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@ui-sdk/react/select";
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { REGIONS, SEGMENTS, PRODUCTS, VERSIONS, type VersionId } from "../data/model";
import { actions, useApp, type Filters } from "../state/store";
import { Ic } from "./icons";

const who = (d: { source?: string } | undefined) => (d?.source === "agent" ? "agent" : "user");
export const COMPARE_ITEMS = VERSIONS.filter(v => v.id !== "v10").map(v => ({ value: v.id, label: v.label }));

function FilterSelect({ k, label, options }: { k: keyof Filters; label: string; options: readonly string[] }) {
  const value = useApp((s) => s.filters[k] ?? "all");
  const byAgent = useApp((s) => !!s.byAgent[k]);
  const items = [{ value: "all", label: "すべて" }, ...options.map((o) => ({ value: o, label: o }))];
  return (
    <Select value={value} items={items} onValueChange={(v: unknown, d: any) => actions.setFilter(k, v === "all" ? null : String(v), who(d))}>
      <div className={`ctl${byAgent && value !== "all" ? " by-agent" : ""}`} data-target={`filter:${k}`}>
        <SelectLabel className="k">{label}</SelectLabel>
        <SelectTrigger className="sel-trigger"><SelectValue /><Ic.chev /></SelectTrigger>
      </div>
      <SelectContent className="sel-content">
        {items.map((it) => <SelectItem key={it.value} value={it.value} className="sel-item">{it.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function Controls() {
  const compare = useApp((s) => s.compare);
  const byAgent = useApp((s) => !!s.byAgent.compare);
  return (
    <div className="controls dimmable" id="controls">
      <span className="ctl static"><span className="k">版</span>10月版</span>
      <div className={`seg${byAgent ? " by-agent" : ""}`} data-target="filter:compare">
        <span className="k" id="cmp-label">比較元</span>
        <SegmentedControl aria-labelledby="cmp-label" value={compare} onValueChange={(v: unknown, d: any) => v && actions.setCompare(v as VersionId, who(d))} className="segc">
          <SegmentedControlIndicator className="segc-ind" />
          {COMPARE_ITEMS.map((c) => <SegmentedControlItem key={c.value} value={c.value} className="segc-item">{c.label}</SegmentedControlItem>)}
        </SegmentedControl>
      </div>
      <span className="ctl static"><span className="k">期間</span>通期 2026/4–2027/3</span>
      <FilterSelect k="region" label="地域" options={REGIONS} />
      <FilterSelect k="segment" label="セグメント" options={SEGMENTS} />
      <FilterSelect k="product" label="製品" options={PRODUCTS} />
    </div>
  );
}
