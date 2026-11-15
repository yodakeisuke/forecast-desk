import { expect, test } from "@playwright/test";
import { boot, call } from "../helpers";

test("ordinary app works report-first, then arbitrary filters, GenUI waterfall and PDF", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, "/");
  await expect(page.locator(".demo")).toHaveCount(0);
  await expect(page.locator("#rail")).toBeHidden();
  await page.getByLabel("その他のメニュー", { exact: true }).click();
  await page.locator('button[aria-controls="rail"]').click();
  await page.getByRole("button", { name: "履歴を閉じる" }).click();
  await expect(page.locator("#rail")).toBeHidden();
  await page.getByLabel("その他のメニュー", { exact: true }).click();
  await page.locator('button[aria-controls="rail"]').click();
  await expect(page.locator("#rail")).toBeVisible();
  await page.getByRole("button", { name: "履歴を閉じる" }).click();

  const first = await call(page, "compose_report", { title: "初期状態からの報告書" });
  expect(first.figures).toBeGreaterThan(0);
  await expect(page.locator(".doc h1")).toHaveText("初期状態からの報告書");

  await call(page, "set_filter", { compare_from: "8月版", region: "欧州", product: "Analytics" });
  await call(page, "drill_down", { member: "欧州", by: ["region", "product"] });
  const totals = await call(page, "query_data", { measure: "営業利益" });
  expect(totals.filters).toMatchObject({ region: "欧州", product: "Analytics" });
  expect(totals.rows.length).toBeGreaterThan(0);
  await call(page, "highlight", { target: "row:欧州/Analytics", note: "この内訳を確認してください。" });
  await expect(page.getByRole("note")).toBeInViewport();
  await expect(page.locator('[data-target="row:欧州/Analytics"]')).toBeInViewport();
  await expect.poll(async () => page.getByRole("note").evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 60 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  })).toBe(true);
  await page.getByRole("note").getByRole("button", { name: "閉じる", exact: true }).click();

  const code = `import { Spec } from "@fpa/genui-sdk";
const spec = { root: "card", elements: {
  card: { type: "Card", props: { title: "欧州 Analytics · 営業利益ブリッジ", subtitle: "8月版から10月版の変化" }, children: ["bridge", "slider"] },
  bridge: { type: "BridgeChart", props: { from: "8月版", to: "10月版", region: "欧州", product: "Analytics" } },
  slider: { type: "DriverSlider", props: { label: "今回の成約率", value: { "$bindState": "/scenario/winRate" }, min: 0, max: 100, step: 1, unit: "%" } }
}};
export default function Widget() { return <Spec spec={spec} />; }`;
  const w = await call(page, "render_widget", { title: "欧州 Analytics · 営業利益ブリッジ", code });
  expect(w.status).toBe("ready");
  const frame = page.frameLocator(`#w-${w.widget} iframe`);
  await expect(frame.locator("svg").first()).toBeVisible();
  const operation = await call(page, "operate_widget", { widget: w.widget, steps: [{ ref: "今回の成約率", action: "setValue", args: [31] }] });
  expect(operation.scenario["/scenario/winRate"]).toBe(31);
  await page.screenshot({ path: test.info().outputPath("waterfall-dashboard.png") });
  const report = await call(page, "compose_report", { title: "欧州 Analytics レビュー", sections: [{ title: "営業利益の変化", materials: ["chart:bridge", `widget:${w.widget}`] }] });
  expect(report.figures).toBe(2);
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "PDFを書き出す" }).click();
  const file = await download;
  await file.saveAs(test.info().outputPath("waterfall-report.pdf"));
  await page.screenshot({ path: test.info().outputPath("waterfall-report.png") });

  const frozen = await page.evaluate(() => JSON.stringify((window as any).__fpaState().report.blocks));
  await call(page, "set_filter", { compare_from: "予算", region: "日本", product: "Core" });
  expect(await page.evaluate(() => JSON.stringify((window as any).__fpaState().report.blocks))).toBe(frozen);
});
