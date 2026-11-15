import { z } from "zod";
import { actions, getState, store } from "./store";
import { REGIONS, SEGMENTS, PRODUCTS, VERSIONS, type VersionId } from "../data/model";
const Context = z.object({
  compare: z.string().refine(v => VERSIONS.some(x => x.id === v)),
  filters: z.object({ region: z.enum(REGIONS).nullish(), segment: z.enum(SEGMENTS).nullish(), product: z.enum(PRODUCTS).nullish() }).strict(),
  scenario: z.object({ "/scenario/winRate": z.number().min(0).max(100), "/scenario/slipBack": z.number().min(0).max(100), "/scenario/naBias": z.number().min(-30).max(30) }),
});
const KEY = "forecast-desk:preferences:v1";
export function currentContext() { const s = getState(); return { compare: s.compare, filters: s.filters, scenario: s.scenario.values }; }
export function shareUrl() { const url = new URL(location.href); url.search = ""; url.hash = new URLSearchParams({ analysis: JSON.stringify(currentContext()) }).toString(); return url.href; }
export function initializePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved.rail === "boolean") actions.setRail(saved.rail);
    const raw = new URLSearchParams(location.hash.slice(1)).get("analysis");
    const result = Context.safeParse(raw && raw.length < 4000 ? JSON.parse(raw) : saved?.context);
    if (result.success) { const { compare, filters, scenario } = result.data; store.setState({ compare: compare as VersionId, filters }); for (const [path, value] of Object.entries(scenario)) actions.setScenario(path, value, "init"); }
  } catch { /* Invalid saved/shared state is never applied. */ }
  let timer: ReturnType<typeof setTimeout>;
  store.subscribe((s, prev) => {
    if (s.compare === prev.compare && s.filters === prev.filters && s.scenario === prev.scenario && s.rail === prev.rail) return;
    clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ rail: s.rail, context: currentContext() })); } catch { actions.toast("ブラウザに設定を保存できませんでした"); } }, 200);
  });
}
