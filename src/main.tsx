// Order matters: Trusted Types first, then the UI SDK bridge (it must exist before components mount),
// then the WebMCP / window.fpa tools, the data, and the first render.
import "./lib/trusted-types";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import "./agent/bridge";
import { createRoot } from "react-dom/client";
import { registerAll } from "./agent/register";
import { initDb } from "./data/db";
import { scenarioBase } from "./data/cube";
import { actions, getState, SCENARIO_DEFAULTS } from "./state/store";
import { App } from "./ui/App";
import { initializePreferences } from "./state/preferences";

// index.html already paints the shell's outline (public/boot.css) until the first render replaces it
const root = createRoot(document.getElementById("root")!);

(async () => {
  const [reg] = await Promise.all([registerAll(), initDb()]);
  // the scenario's win-rate driver starts at the 10月版 assumption in the data
  const b = await scenarioBase();
  SCENARIO_DEFAULTS["/scenario/winRate"] = Math.round(b.win10 * 10) / 10;
  if (!getState().scenario.log.length) actions.reset();
  initializePreferences();
  root.render(<App />);
  if (import.meta.env.DEV) {
    // test hooks for the attack suite (dev only): post a raw message as if a sandbox had sent it
    const host = await import("./genui/host");
    Object.assign(window, { __fpaTest: { inject: host.__injectFromSandbox, runtimes: host.runtimeKeys }, __fpaState: getState });
  }
  console.info(`[forecast-desk] tools: ${reg.mode} (${reg.count}) · window.fpa.help()`);
})().catch((e) => {
  console.error(e);
  root.render(<div className="boot err"><b>起動できませんでした</b><span>{String((e as Error)?.message ?? e)}</span></div>);
});
