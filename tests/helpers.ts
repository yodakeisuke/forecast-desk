import { expect, type Page } from "@playwright/test";

export async function boot(page: Page, url = "/?demo=1") {
  await page.goto(url);
  await expect(page.locator(".kpis .kpi .v").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).fpa && !!(window as any).__fpaTest);
}
export const call = (page: Page, name: string, input: unknown = {}) => page.evaluate(([n, i]) => (window as any).fpa.call(n, i), [name, input] as const) as Promise<any>;
export const security = (page: Page) => page.evaluate(() => (window as any).__fpaSecurity.events()) as Promise<{ kind: string; title: string; detail: string; widget?: string }[]>;
export const scenario = (page: Page) => page.evaluate(() => (window as any).__fpaState?.().scenario.values);

/** A widget whose free slot runs `body` (TSX statements) inside useEffect and renders `out` state. */
export function probeWidget(body: string) {
  return `import { Spec } from "@fpa/genui-sdk";
import { useEffect, useState } from "react";
const spec = { root: "c", elements: { c: { type: "Card", props: { title: "", subtitle: null }, children: ["s"] }, s: { type: "Slot", props: { name: "x", caption: "probe" } } } };
function X() {
  const [out, setOut] = useState<string[]>([]);
  useEffect(() => {
    const log = (s: string) => setOut((o) => [...o, s]);
    (async () => { ${body} })().catch((e) => log("ERR " + e?.message));
  }, []);
  return <pre id="probe">{out.join("\\n")}</pre>;
}
export default function Widget() { return <Spec spec={spec} slots={{ x: X }} />; }`;
}
