// The demo story end to end, through the same tools an agent uses: EDA with highlights, GenUI widgets,
// person + agent co-editing, the report, the PDF behind a human confirm, agent-only undo, and the attack scene.
import { expect, test, type Page } from "@playwright/test";
import { boot, call, scenario, security } from "../helpers";

const state = (page: Page) => page.evaluate(() => (window as any).__fpaState()) as Promise<any>;

async function playNext(page: Page) {
  await page.getByRole("button", { name: "次のシーン" }).click();
  await expect(page.locator(".demo .dots button.cur")).toHaveCount(1, { timeout: 10_000 }).catch(() => {});
  await expect(page.locator(".demo .dots button.cur")).toHaveCount(0, { timeout: 90_000 });
}

test.describe.configure({ mode: "serial" });

test("the demo runs end to end: EDA, GenUI, report, PDF, undo", async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);

  // 1 · compare switches to 9月版 and the bridge is highlighted with a note
  await playNext(page);
  let s = await state(page);
  expect(s.compare).toBe("v09");
  expect(s.notes.length).toBe(1);
  await expect(page.locator(".n-pop")).toBeVisible();

  // 2–4 · drill down, across, through: each leaves a note on what to look at
  await playNext(page);
  await playNext(page);
  await playNext(page);
  s = await state(page);
  expect(s.notes.length).toBe(4);
  await expect(page.locator(".sheet")).toBeVisible();

  // 5 · a generated widget, rendered in the sandbox and marked as generated
  await playNext(page);
  const card = page.locator(".gen-card").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".gen-foot")).toContainText("json-render");
  await expect(card.locator("iframe.gen-frame")).toHaveAttribute("sandbox", "allow-scripts");
  const frame = card.frameLocator("iframe.gen-frame");
  await expect(frame.locator("[data-slot='band'] svg").first()).toBeVisible();

  // 6 · the agent sets one driver, the person another; each value knows who set it
  await playNext(page);
  const v = await scenario(page);
  expect(v["/scenario/slipBack"]).toBe(50);
  s = await state(page);
  expect(s.scenario.owner["/scenario/slipBack"]).toBe("agent");
  expect(s.scenario.owner["/scenario/winRate"]).toBe("user");
  const scen = page.locator(".gen-card").nth(1).frameLocator("iframe.gen-frame");
  await expect(scen.getByText("Agent", { exact: true }).first()).toBeVisible();
  await expect(scen.getByText("あなた", { exact: true }).first()).toBeVisible();

  // 7 · the report, built from what the EDA left behind
  await playNext(page);
  await expect(page.locator(".doc h1")).toHaveText("10月版 フォーキャスト報告");
  await expect(page.locator(".doc .lead")).toContainText("億円");
  await expect(page.locator(".toc a")).toHaveCount(7);
  await expect(page.locator(".doc .rp-sec")).toHaveCount(7);

  // the PDF only leaves after a person confirms
  await page.getByRole("button", { name: "PDFを書き出す" }).click();
  const download = page.waitForEvent("download", { timeout: 90_000 });
  // a person's own click needs no confirm; the agent's press does (covered in the security suite)
  const d = await download;
  const path = await d.path();
  const head = (await import("node:fs")).readFileSync(path!).subarray(0, 5).toString();
  expect(head).toBe("%PDF-");

  // agent-only undo: the agent's driver goes back, the person's stays
  await page.getByRole("button", { name: "Agentの操作を戻す" }).click();
  await expect.poll(async () => (await scenario(page))["/scenario/slipBack"]).toBe(0);
  const after = await state(page);
  expect(after.scenario.owner["/scenario/winRate"]).toBe("user");
});

test("the attack scene is stopped and logged", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);
  await page.getByRole("button", { name: /^シーン8 / }).click();
  await expect(page.locator(".demo .dots button.cur")).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => (await security(page)).map((e) => e.title).join("|"), { timeout: 15_000 }).toContain("外部送信をブロック");
  const titles = (await security(page)).map((e) => e.title);
  expect(titles).toContain("共有状態への書き込みを拒否");
  await expect(page.locator("h1", { hasText: "セキュリティ" })).toBeVisible();
});

test("drill tools move the dashboard and keep filters consistent", async ({ page }) => {
  await boot(page);
  await call(page, "set_filter", { compare_from: "9月版" });
  expect((await state(page)).compare).toBe("v09");
  const dd = await call(page, "drill_down", { member: "北米", by: ["region", "segment"] });
  expect(JSON.stringify(dd)).toContain("Enterprise");
  await call(page, "drill_across", { to: "pipeline", keep: { region: "北米", segment: "Enterprise" } });
  let s = await state(page);
  expect(s.view.tab).toBe("pipeline");
  expect(s.view.context).toMatchObject({ region: "北米", segment: "Enterprise" });
  const dt = await call(page, "drill_through", {});
  expect(JSON.stringify(dt)).toContain("Halden");
  await expect(page.locator(".sheet")).toBeVisible();
  await call(page, "drill_up", { levels: 4 });
  s = await state(page);
  expect(s.view.tab).toBe("variance");
  expect(Object.keys(s.view.context ?? {}).length).toBe(0);
});

test("WebMCP: the tools are on document.modelContext and run through it", async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const mc = (document as any).modelContext;
    const tools = await mc.getTools();
    const t = tools.find((x: any) => x.name === "query_data");
    const r = await mc.executeTool(t, { measure: "営業利益", compare: ["9月版", "10月版"] });
    return { names: tools.map((x: any) => x.name), r: String(r), src: (window as any).__fpaState().activity.at(-1)?.src };
  });
  expect(out.names).toEqual(expect.arrayContaining(["query_data", "explore_sql", "set_filter", "drill_down", "drill_up", "drill_across", "drill_through", "highlight", "get_catalog", "render_widget", "operate_widget", "compose_report", "snapshot", "act", "query"]));
  expect(out.r).toContain("15.6");
  expect(out.src).toContain("WebMCP");
});
