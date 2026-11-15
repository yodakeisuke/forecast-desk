// Trusted Types: the host page runs with `require-trusted-types-for 'script'`.
// Nothing in the app writes HTML strings into the DOM. The only string sinks we need are script URLs for
// our own same-origin workers (DuckDB, PDF). Everything else is refused and reported.
import { z } from "zod";
import { securityLog } from "./security-log";

// zod 4 probes for eval with new Function(""); the host has no eval, so turn the probe off.
z.config({ jitless: true });

type TT = { createPolicy: (name: string, rules: Record<string, (s: string) => string>) => { createScriptURL(s: string): unknown } };
const tt: TT | undefined = (globalThis as any).trustedTypes;

const sameOriginUrl = (s: string) => {
  const u = new URL(s, location.href);
  if (u.origin !== location.origin && u.protocol !== "blob:") throw new TypeError(`Trusted Types: script URL not allowed: ${u.origin}`);
  if (u.protocol === "blob:" && !s.startsWith(`blob:${location.origin}`)) throw new TypeError("Trusted Types: foreign blob URL");
  return u.href;
};

const policy = tt?.createPolicy("fpa", { createScriptURL: sameOriginUrl });
try {
  tt?.createPolicy("default", {
    createScriptURL: (s) => sameOriginUrl(s),
    createHTML: (s) => { securityLog("trusted-types", "HTMLの直書きを拒否", s.slice(0, 120)); throw new TypeError("Trusted Types: HTML strings are not allowed"); },
    createScript: (s) => { securityLog("trusted-types", "スクリプト文字列を拒否", s.slice(0, 120)); throw new TypeError("Trusted Types: script strings are not allowed"); },
  });
} catch { /* default policy already exists (HMR) */ }

export function trustedScriptURL(url: string): unknown {
  return policy ? policy.createScriptURL(url) : sameOriginUrl(url);
}
