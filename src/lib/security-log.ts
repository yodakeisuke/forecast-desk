// Security log: everything the defences stopped (CSP violations, refused bridge messages, rejected SQL,
// destroyed iframes). Shown in the UI and readable by tests through window.__fpaSecurity.
export type SecurityEvent = { id: number; at: string; kind: string; title: string; detail: string; widget?: string };
const events: SecurityEvent[] = [];
const subs = new Set<() => void>();
let seq = 0;
export function securityLog(kind: string, title: string, detail = "", widget?: string) {
  const at = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  events.push({ id: ++seq, at, kind, title, detail: String(detail).slice(0, 400), widget });
  subs.forEach((f) => f());
}
export const securityEvents = () => events;
export function onSecurity(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
(globalThis as any).__fpaSecurity = { events: () => events.slice() };

if (typeof document !== "undefined") {
  document.addEventListener("securitypolicyviolation", (e) => {
    securityLog("csp", `CSP違反: ${e.effectiveDirective}`, `${e.blockedURI || "inline"} ${e.sample || ""}`.trim());
  });
}
