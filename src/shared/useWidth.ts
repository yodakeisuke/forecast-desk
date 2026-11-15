import { useEffect, useState } from "react";

/** Width of an element, for charts that draw to their container. A callback ref, so it works when the element mounts later. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}
