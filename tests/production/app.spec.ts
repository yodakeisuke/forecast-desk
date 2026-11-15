import { expect, test } from "@playwright/test";
import { call } from "../helpers";

test("production bundle supports GenUI waterfall and PDF under strict CSP", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-inline'");
  await expect(page.locator(".kpis .kpi .v").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => "__fpaTest" in window)).toBe(false);
  await expect(page.locator(".demo")).toHaveCount(0);
  await call(page, "set_filter", { compare_from: "6月版", region: "日本", product: "Connect" });
  const widget = await call(page, "render_widget", { title: "日本 Connect ウォーターフォール", code: `
    import { Spec } from "@fpa/genui-sdk";
    export default function Widget() { return <Spec spec={{ root: "b", elements: {
      b: { type: "BridgeChart", props: { from: "6月版", to: "10月版", region: "日本", product: "Connect" } }
    } }} />; }
  ` });
  expect(widget.status).toBe("ready");
  await expect(page.frameLocator(`#w-${widget.widget} iframe`).locator("svg").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("production-waterfall.png") });
  const report = await call(page, "compose_report", { title: "日本 Connect 見通し分析", sections: [{ title: "営業利益ブリッジ", materials: ["chart:bridge", `widget:${widget.widget}`] }] });
  expect(report.figures).toBe(2);
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "PDFを書き出す" }).click();
  await (await download).saveAs(test.info().outputPath("production-report.pdf"));
  await page.screenshot({ path: test.info().outputPath("production-report.png") });
  expect(errors).toEqual([]);
});
