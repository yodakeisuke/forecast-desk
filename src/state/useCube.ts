// Read-only data for the screen: each hook asks the cube (DuckDB) and keeps the last answer while a new one loads.
import { actions } from "./store";
import { useEffect, useState } from "react";

const cache = new Map<string, unknown>();
export function useCube<T>(key: string, fn: () => Promise<T>): T | undefined {
  const [state, setState] = useState<{ key: string; data?: T }>({ key, data: cache.get(key) as T | undefined });
  useEffect(() => {
    let alive = true;
    setState({ key, data: cache.get(key) as T | undefined });
    fn().then(data => { cache.set(key, data); if (alive) setState({ key, data }); }).catch(e => { console.error("[cube]", key, e); if (alive) actions.toast(`集計に失敗しました: ${String(e.message ?? e).slice(0, 150)}`); });
    return () => { alive = false; };
  }, [key]);
  return state.key === key ? state.data : cache.get(key) as T | undefined;
}

export { useWidth } from "../shared/useWidth";
