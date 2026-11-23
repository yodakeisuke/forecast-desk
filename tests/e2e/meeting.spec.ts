// Meeting mode in かんたんモード (no TypeSafe key on this server): a typed question re-scopes the screen through
// the audited tools, puts the answering cards first, hands "why" to the agent, and never moves the screen for a
// question it cannot show.
import { expect, test } from "@playwright/test";
import { boot, call, scenario } from "../helpers";

const ask = async (page: any, q: string) => {
  await page.locator("#meeting-q").fill(q);
  await page.getByRole("button", { name: "画面に反映" }).click();
  await page.waitForFunction(() => (window as any).__fpaMeeting.state().phase === "idle");
};
const order = (page: any) => page.locator(".grid.cards > .card").evaluateAll((els: Element[]) => els.map((e) => e.id));

test("会議モード: 問い → 画面、なぜ → エージェント、表せない問い → 動かさない", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, "/");
  const before = await order(page);
  expect(before).toEqual(["c-trend", "c-bridge", "c-var", "c-heat", "c-q", "c-drv", "c-scenario"]);
  await page.getByRole("button", { name: "会議モード" }).click();
  await expect(page.getByRole("complementary", { name: "この会議の問い" })).toBeVisible();

  await ask(page, "欧州だけだと、前月版比でどう？");
  await expect(page.locator('[data-target="filter:region"]')).toContainText("欧州");
  await expect(page.locator('[data-target="filter:compare"]')).toContainText("9月版");
  await expect(page.locator('[data-target="filter:region"]')).toHaveClass(/by-fast/);
  await expect.poll(async () => (await order(page)).slice(0, 2)).toEqual(["c-bridge", "c-var"]);
  await expect(page.locator("#c-bridge .why-tag")).toBeVisible();
  await expect(page.getByTestId("meeting-answer")).toContainText("欧州 · 9月版比");
  await expect(page.getByTestId("meeting-answer")).toContainText("通期 営業利益");
  await expect(page.locator(".chip-fast")).toContainText("かんたんモード");
  // the change went through the same audited tool path, under the meeting channel
  await expect(page.locator("#rail")).toBeAttached();
  const kpi = Number(await page.locator('#kpis [data-target="kpi:op"] .v').innerText().then((t: string) => t.replace(/[^\d.-]/g, "")));
  expect(kpi).toBeGreaterThan(0);

  // "why" moves the screen to the scope and hands the question to the main agent
  await ask(page, "北米のEnterpriseは、なぜこんなに落ちたの？");
  await expect(page.getByTestId("meeting-handoff")).toBeVisible();
  await expect(page.locator('[data-target="filter:compare"] .carried')).toHaveText("引き継ぎ");
  const qs = await call(page, "get_meeting_questions");
  expect(qs.questions.at(-1)).toMatchObject({ status: "handoff", question: "北米のEnterpriseは、なぜこんなに落ちたの？" });
  await call(page, "highlight", { target: "bridge:新規ARR", note: "大型案件の期ずれが中心です。" });
  await expect(page.locator(".chip-agent")).toContainText("注記1件");
  await call(page, "answer_meeting_question", { id: qs.questions.at(-1).id, summary: "大型3件の期ずれが中心です。" });
  await expect(page.locator(".qlist")).toContainText("大型3件の期ずれが中心です。");

  // a scenario question opens the scenario card first and the number is the app's
  await ask(page, "成約率30%なら？");
  await expect.poll(async () => (await order(page))[0]).toBe("c-scenario");
  expect((await scenario(page))["/scenario/winRate"]).toBe(30);
  await expect(page.getByTestId("meeting-answer")).toContainText("試算 通期 営業利益");

  // a question the dashboard cannot show changes nothing
  const filtersBefore = await page.evaluate(() => (window as any).__fpaState().filters);
  await ask(page, "競合の値下げの影響は？");
  await expect(page.getByTestId("meeting-unsupported")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__fpaState().filters)).toEqual(filtersBefore);
  await page.getByRole("button", { name: "持ち帰りにメモする" }).click();
  await expect(page.locator(".qlist")).toContainText("持ち帰り");

  // any earlier screen is one click away
  await page.locator(".qlist").getByRole("button", { name: /欧州だけだと/ }).click();
  await expect(page.locator('[data-target="filter:region"]')).toContainText("欧州");
  await expect(page.locator('[data-target="filter:segment"]')).toContainText("すべて");
  await page.getByRole("button", { name: "ひとつ前の画面" }).click();
  await expect(page.locator('[data-target="filter:region"]')).toContainText("すべて");

  // a folded card opens on demand, and leaving meeting mode restores the normal dashboard
  await page.locator(".qlist").getByRole("button", { name: /欧州だけだと/ }).click();
  await page.locator(".fold-row").getByRole("button", { name: "ヒートマップ" }).click();
  await expect(page.locator("#c-heat")).toBeVisible();
  await page.getByRole("button", { name: "会議モード" }).click();
  await expect.poll(() => order(page)).toEqual(before);
  await expect(page.locator(".ask")).toHaveCount(0);
});

test("会議モード: 畳んだカードもエージェントの操作で開く", async ({ page }) => {
  await boot(page, "/");
  await page.getByRole("button", { name: "会議モード" }).click();
  await ask(page, "成約率30%なら？");
  await expect(page.locator("#c-var")).toHaveCount(0);
  const r = await call(page, "drill_down", { member: "北米", by: ["region", "segment"] });
  expect(r.ok).not.toBe(false);
  await expect(page.locator("#c-var")).toBeVisible();
});

test("会議モード: 「前月並み」は問いの範囲の成約率、戻ると見通し補正も戻る", async ({ page }) => {
  await boot(page, "/");
  await page.getByRole("button", { name: "会議モード" }).click();
  await ask(page, "北米のEnterpriseで成約率が前月並みに戻ったら？");
  // the app's own figure for the target scope (the dev server serves the module by path)
  const want = await page.evaluate(async (path) => {
    const cube = await import(path);
    return Math.round((await cube.winRates({ region: "北米", segment: "Enterprise" })).v09 * 10) / 10;
  }, "/src/data/cube.ts");
  await expect(page.locator('[data-target="filter:region"]')).toContainText("北米");
  expect((await scenario(page))["/scenario/winRate"]).toBe(want);
  await call(page, "set_scenario", { na_bias: -10 });
  await ask(page, "欧州だけだと？");
  await page.locator(".qlist").getByRole("button", { name: /北米のEnterprise/ }).click();
  await page.waitForFunction(() => (window as any).__fpaMeeting.state().phase === "idle");
  const v = await scenario(page);
  expect(v["/scenario/naBias"]).toBe(0);
  expect(v["/scenario/winRate"]).toBe(want);
});

test("会議モード: 公開サイト（中継なし）ではかんたんモードに切り替え、毎回は問い合わせない", async ({ page }) => {
  let hits = 0;
  // the published site's Worker answers any POST with 405
  await page.route("**/api/decide", (r) => { hits++; return r.fulfill({ status: 405, contentType: "text/plain", body: "Method not allowed" }); });
  await boot(page, "/");
  await page.getByRole("button", { name: "会議モード" }).click();
  await ask(page, "欧州だけだと、前月版比でどう？");
  await expect(page.locator('[data-target="filter:region"]')).toContainText("欧州");
  await expect(page.locator(".ask-notice")).toHaveCount(0);
  await ask(page, "北米だと？");
  expect(hits).toBe(1);
  await expect(page.locator(".chip-fast")).toContainText("かんたんモード");
});

test("鍵はブラウザに渡らない（中継はこのサーバーだけ）", async ({ page, request }) => {
  await boot(page, "/");
  const html = await (await request.get("/")).text();
  expect(html).not.toMatch(/TYPESAFE|tsk_/);
  // a cross-site page cannot use the relay
  const res = await request.post("/api/decide", { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: { question: "q" } });
  expect(res.status()).toBe(403);
  // no script the browser loads mentions the key's variable
  const scripts = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /\.(m?js|tsx?)(\?|$)/.test(u) && u.startsWith(location.origin)));
  expect(scripts.length).toBeGreaterThan(0);
  for (const u of scripts) expect(await (await request.get(u)).text(), u).not.toMatch(/TYPESAFE_API_KEY|api\.typesafe\.ai/);
});
