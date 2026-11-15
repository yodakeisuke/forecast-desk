// Guide the viewer to a completed operation without moving keyboard focus.
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function revealElement(el: Element, rect = el.getBoundingClientRect(), topSpace = 72) {
  const layer = el.closest<HTMLElement>("[data-layer]");
  if (!layer) return;
  const bounds = layer.getBoundingClientRect();
  const visibleHeight = Math.min(rect.height, layer.clientHeight - topSpace - 20);
  if (rect.top < bounds.top + topSpace || rect.top + visibleHeight > bounds.bottom - 20) {
    layer.scrollTo({ top: Math.max(0, rect.top - bounds.top + layer.scrollTop - topSpace), behavior: prefersReducedMotion() ? "instant" : "smooth" });
  }
}

export function drawAttention(el: HTMLElement | null) {
  if (!el || !el.getClientRects().length) return;
  revealElement(el);
  clearTimeout(timers.get(el));
  el.removeAttribute("data-attention");
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    el.setAttribute("data-attention", "");
    timers.set(el, setTimeout(() => el.removeAttribute("data-attention"), 1800));
  });
}
