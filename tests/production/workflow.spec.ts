import { expect, test } from "@playwright/test";
import { call, probeWidget } from "../helpers";

test("production runs eight examples through real tools and exports the report", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?demo=1");
  await expect(page.locator(".kpis .kpi .v").first()).toBeVisible({ timeout: 30_000 });
  for (let scene = 1; scene <= 7; scene++) {
    await page.getByRole("button", { name: "次のシーン" }).click();
    await expect(page.locator(".demo .dots button.done")).toHaveCount(scene, { timeout: 90_000 });
    await expect(page.locator(".demo .dots button.cur")).toHaveCount(0);
    if (scene === 6) await page.getByRole("slider", { name: "成約率（シナリオ）", exact: true }).press("ArrowUp");
  }
  await expect(page.locator(".doc h1")).toHaveText("10月版 フォーキャスト報告");
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "PDFを書き出す" }).click();
  await (await download).saveAs(test.info().outputPath("eight-scene-report.pdf"));
  await page.screenshot({ path: test.info().outputPath("eight-scene-report.png") });
  await page.getByRole("button", { name: "次のシーン" }).click();
  await expect(page.locator(".demo .dots button.done")).toHaveCount(8, { timeout: 90_000 });
  await expect(page.locator(".seclog")).toContainText("外部送信をブロック");
  await expect(page.locator(".seclog")).toContainText("共有状態への書き込みを拒否");
});

test("a looping generated frame cannot freeze the production host", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await expect(page.locator(".kpis .kpi .v").first()).toBeVisible({ timeout: 30_000 });
  const widget = await call(page, "render_widget", { title: "応答監視の検証", code: probeWidget("await new Promise(r => setTimeout(r, 500)); while (true) {}") });
  expect(widget.status).toBe("ready");
  await expect(page.locator(`#w-${widget.widget} .gen-error`)).toContainText("停止しました", { timeout: 20_000 });
  const result = await call(page, "query_data", { measure: "営業利益" });
  expect(result.rows).toHaveLength(1);
});
