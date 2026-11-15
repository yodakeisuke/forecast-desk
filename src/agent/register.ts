// Carry the same tools two ways: WebMCP (document.modelContext.registerTool; the polyfill when the browser
// has none) and window.fpa for an agent that can only run JavaScript in the page.
import { history } from "./bridge";
import { ALL_TOOLS, call, invoke, setRequest, type ToolDef } from "./tools";

type MC = { registerTool: (tool: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<unknown> | unknown };
export const registration = { mode: "none" as "native" | "polyfill" | "none", count: 0, error: "" };

function toWebMcp(def: ToolDef) {
  return {
    name: def.name, title: def.title, description: def.description, inputSchema: def.inputSchema,
    annotations: { readOnlyHint: !!def.annotations?.readOnlyHint, untrustedContentHint: !!def.annotations?.untrustedContentHint, consequentialHint: def.name === "act" },
    execute: (input: unknown) => invoke(def, input, "webmcp"),
  };
}

export async function registerAll() {
  const d = document as unknown as { modelContext?: MC };
  const native = typeof d.modelContext?.registerTool === "function";
  try {
    if (!native) {
      window.__webModelContextOptions = { autoInitialize: false };
      const m = await import("@mcp-b/global");
      // tabServer accepts messages only from this window (an extension's content script), never from a frame.
      m.initializeWebModelContext({ transport: { tabServer: { allowedOrigins: [location.origin] } , iframeServer: false } });
    }
    const mc = d.modelContext;
    if (!mc) throw new Error("document.modelContext がありません");
    registration.mode = native ? "native" : "polyfill";
    const ctrl = new AbortController();
    for (const def of ALL_TOOLS()) {
      try {
        await mc.registerTool(toWebMcp(def), { signal: ctrl.signal });
        registration.count++;
      } catch (error) {
        registration.error += `${def.name}: ${String(error)}; `;
        console.warn("[webmcp]", def.name, error);
      }
    }
    if (import.meta.hot) import.meta.hot.dispose(() => ctrl.abort());
  } catch (e) {
    registration.error = (e as Error).message;
    console.warn("[webmcp] registration failed", e);
  }

  // window.fpa: the JavaScript carrier. Same definitions, same invoke path.
  const fpa = {
    tools: () => ALL_TOOLS().map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
    call: (name: string, input?: unknown) => call(name, input, "js"),
    agent: { snapshot: () => call("snapshot", {}, "js"), act: (input: unknown) => call("act", input, "js"), query: (input: unknown) => call("query", input, "js") },
    history: { entries: () => history.entries(), undoAgent: () => history.undoSource("agent") },
    help: () => `window.fpa.tools() で一覧、await window.fpa.call("drill_down", { member: "北米" }) で実行。汎用は window.fpa.agent.snapshot() / act({ steps })。`,
  };
  Object.defineProperty(window, "fpa", { value: Object.freeze(fpa), configurable: false, writable: false });
  (window as any).__fpaDemo = { call: (name: string, input?: unknown) => call(name, input, "demo"), setRequest };
  return registration;
}
