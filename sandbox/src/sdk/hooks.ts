// Data hooks: every number a widget shows comes from a registered host query, through the port.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bridge, getSnap, ownerOf, subscribe, writeShared, type Owner } from "../port";

const cache = new Map<string, Promise<unknown>>();
const errors = new Set<(e: Error) => void>();
export const onDataError = (f: (e: Error) => void) => { errors.add(f); return () => { errors.delete(f); }; };

export function query<T>(name: string, args: unknown): Promise<T> {
  const key = `${name}:${JSON.stringify(args ?? {})}`;
  let p = cache.get(key);
  if (!p) {
    p = bridge.request("data.get", { query: name, args: args ?? {} });
    cache.set(key, p);
    p.catch((e) => { cache.delete(key); errors.forEach((f) => f(e)); });
  }
  return p as Promise<T>;
}

export function useQuery<T>(name: string, args: unknown): T | undefined {
  const key = `${name}:${JSON.stringify(args ?? {})}`;
  const [state, setState] = useState<{ key: string; v?: T }>({ key: "" });
  useEffect(() => {
    let live = true;
    query<T>(name, args).then((v) => { if (live) setState({ key, v }); }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.v : undefined;
}

type Filters = { region?: string | null; segment?: string | null; product?: string | null };
export const useForecastAccuracy = (o: { versions?: number } = {}) =>
  useQuery<{ versions: string[]; series: { region: string; values: number[] }[] }>("accuracy", { versions: o.versions ?? 6 });
export const useSeries = (o: { measure: string; versions: string[]; by?: string[]; filters?: Filters; months?: number[] }) => useQuery<Record<string, string | number>[]>("series", o);
export const useVariance = (o: { by: "region" | "segment" | "product"; compare: string; filters?: Filters }) =>
  useQuery<{ total: { ref: number; cur: number; diff: number; pct: number }; rows: { key: string; label: string; ref: number; cur: number; diff: number; pct: number }[] }>("variance", o);
export const useBridge = (o: { from: string; to: string; filters?: Filters }) => useQuery<{ from: number; to: number; steps: { label: string; value: number }[] }>("bridge", o);
export type ScenarioPL = { base: number; parts: Record<string, number>; arrParts: Record<string, number>; cases: { name: string; value: number; note: string; main?: boolean }[]; refs: { label: string; value: number }[]; assumptions: Record<string, number> };
export const useScenarioPL = (o: { slipBack: number; winRate: number; naBias: number; filters?: Filters }) => useQuery<ScenarioPL>("scenarioPL", o);
export const usePipeline = (o: { filters?: Filters } = {}) => useQuery<any>("pipeline", { filters: o.filters ?? {} });
export const useSlippedDeals = (o: { filters?: Filters } = {}) => useQuery<any[]>("slippedDeals", { filters: o.filters ?? {} });

/** A value of the shared state, and a setter. Only /scenario/* can be written; the host refuses the rest. */
export function useSharedState(path: string): [number | undefined, (v: number) => void, Owner] {
  const k = path.replace(/^\/scenario\//, "");
  const v = useSyncExternalStore(subscribe, () => getSnap().scenario[k]);
  const owner = useSyncExternalStore(subscribe, () => ownerOf(path));
  return [v, (x: number) => { writeShared(path, x).catch(() => {}); }, owner];
}
export const useOwner = (path: string | undefined) => useSyncExternalStore(subscribe, () => (path ? ownerOf(path) : "init"));

/** Offer the person a change on the dashboard. Nothing happens unless they press it. */
export function suggest(s: { label: string; tool: "set_filter" | "drill_down"; args: Record<string, string | string[] | null> }) {
  bridge.post({ t: "ui.suggest", label: String(s.label).slice(0, 80), tool: s.tool, args: s.args });
}

export { useWidth } from "../../../src/shared/useWidth";
