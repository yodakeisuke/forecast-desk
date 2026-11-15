// One place for the security headers of both origins, used by the dev server, preview and tests.
const origin = (value, fallback) => {
  const url = new URL(value || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href !== `${url.origin}/`) throw new Error('Expected a bare HTTP(S) origin');
  return url.origin;
};
export const HOST_ORIGIN = origin(process.env.FPA_HOST_ORIGIN, "http://localhost:5173");
export const SANDBOX_ORIGIN = origin(process.env.FPA_SANDBOX_ORIGIN, "http://127.0.0.1:5174");
if (HOST_ORIGIN === SANDBOX_ORIGIN) throw new Error("GenUI must run on a separate origin");
export const HOST_ORIGINS = HOST_ORIGIN === "http://localhost:5173" ? [HOST_ORIGIN, "http://localhost:4173"] : [HOST_ORIGIN];

export function hostHeaders({ dev = false } = {}) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws://localhost:5173" : ""}`,
    "worker-src 'self' blob:",
    `frame-src ${SANDBOX_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types fpa default",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    // WebMCP tools may only be exposed by this page itself, never by a frame.
    "Permissions-Policy": "tools=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Content-Type-Options": "nosniff",
    "Origin-Agent-Cluster": "?1",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

// The GenUI sandbox: a different site (127.0.0.1 vs localhost), loaded with sandbox="allow-scripts" (opaque origin).
// Generated code needs eval to run, but it can only load our runtime and talk through one MessagePort.
export function sandboxHeaders() {
  const csp = [
    "default-src 'none'",
    `script-src ${SANDBOX_ORIGIN} 'unsafe-eval'`,
    `style-src ${SANDBOX_ORIGIN} 'unsafe-inline'`,
    "img-src data: blob:",
    `font-src ${SANDBOX_ORIGIN}`,
    "connect-src 'none'",
    "webrtc 'block'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    `frame-ancestors ${HOST_ORIGINS.join(" ")}`,
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Permissions-Policy": "tools=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()",
    "X-Content-Type-Options": "nosniff",
    "Origin-Agent-Cluster": "?1",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "cross-origin",
    // the document runs with an opaque origin, so its module/script requests carry Origin: null
    "Access-Control-Allow-Origin": "*",
    "Connection-Allowlist": "(response-origin)",
    "X-DNS-Prefetch-Control": "off",
  };
}
