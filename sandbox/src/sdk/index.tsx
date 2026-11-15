// @fpa/genui-sdk: what generated widget code may import. Catalog parts are placed with a json-render spec
// (<Spec>); anything the catalog lacks goes into a Slot as free React. Data only through the hooks below.
import { useMemo, type ComponentType } from "react";
import { validateSpec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { fpaCatalog } from "../../../src/shared/fpa-catalog";
import { specStore } from "../port";
import { registry, SlotCtx } from "./components";

export { fmt, sg } from "../../../src/shared/charts";
export { useForecastAccuracy, useSeries, useVariance, useBridge, useScenarioPL, usePipeline, useSlippedDeals, useSharedState, suggest } from "./hooks";
export { SvgChart } from "./chart";

export class SpecError extends Error { phase = "spec" as const; }

type AnySpec = { root: string; elements: Record<string, { type: string; props?: Record<string, unknown>; children?: string[] }> };
/** What the runtime reports back and exports for the report: the last specs rendered, and their slot names. */
export const rendered: { spec: AnySpec; slots: string[]; issues: string[] }[] = [];

/** Leaf elements may leave out children; the catalog schema wants an array. */
export function normalizeSpec(spec: AnySpec): AnySpec {
  if (!spec || typeof spec !== "object" || !spec.elements || typeof spec.elements !== "object") return spec;
  const elements = Object.fromEntries(Object.entries(spec.elements).map(([k, e]) => [k, e && typeof e === "object" ? { ...e, props: e.props ?? {}, children: Array.isArray(e.children) ? e.children : [] } : e]));
  return { ...spec, elements };
}

export function Spec({ spec: raw, slots }: { spec: AnySpec; slots?: Record<string, ComponentType> }) {
  const spec = useMemo(() => normalizeSpec(raw), [raw]);
  const checked = useMemo(() => {
    const s = spec as any;
    const structural = validateSpec(s);
    const issues = (structural.issues ?? []).map((i: any) => String(i.message ?? i));
    const res = fpaCatalog.validate(s);
    if (!res.success) {
      const z = (res.error?.issues ?? []).slice(0, 6).map((i: any) => `${(i.path ?? []).join(".")}: ${i.message}`);
      throw new SpecError(`specがカタログ fpa@1 に合いません — ${z.join(" / ") || "形が正しくありません"}`);
    }
    if (structural.valid === false && issues.length) throw new SpecError(`specの構造が正しくありません — ${issues.join(" / ")}`);
    const names = Object.values(s.elements ?? {}).filter((e: any) => e?.type === "Slot").map((e: any) => String(e.props?.name));
    const missing = names.filter((n) => !slots?.[n]);
    const extra = missing.length ? [`Slot ${missing.join(", ")} に渡す部品がありません`] : [];
    const entry = { spec: s as AnySpec, slots: names, issues: [...issues, ...extra] };
    rendered.splice(0, rendered.length, entry);
    return entry;
  }, [spec, slots]);
  void checked;
  return (
    <JSONUIProvider registry={registry} store={specStore}>
      <SlotCtx.Provider value={slots}>
        <Renderer spec={spec as any} registry={registry} />
      </SlotCtx.Provider>
    </JSONUIProvider>
  );
}
