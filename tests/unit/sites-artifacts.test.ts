import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("real Vite and Sites Worker builds keep a build-time key out of all staged files", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "forecast-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const staged = join(root, "dist");
  const manifest = join(root, ".openai", "hosting.json");
  mkdirSync(join(root, ".openai"));
  writeFileSync(manifest, JSON.stringify({ project_id: "test-site", r2: null }));
  const key = `fixture-${randomUUID()}`;
  const origin = "https://forecast.example";
  const env = {
    ...process.env, TYPESAFE_API_KEY: key, FPA_HOST_ORIGIN: origin,
    FPA_SANDBOX_ORIGIN: "https://sandbox.example", FPA_ASSET_BASE: "/guarded/",
  };
  function run(args: string[]) {
    execFileSync(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  }
  run(["node_modules/vite/bin/vite.js", "build", "--outDir", source, "--logLevel", "error"]);
  run(["scripts/stage-site.mjs", "app", staged, source]);

  function check(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) check(file);
      else assert.equal(readFileSync(file).includes(key), false, `secret in ${entry.name}`);
    }
  }
  check(source);
  check(staged);
  assert.deepEqual(JSON.parse(readFileSync(manifest, "utf8")), { project_id: "test-site", r2: null, d1: "DECIDE_QUOTA" });
  const migrations = join(staged, ".openai", "drizzle");
  const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8"));
  assert.equal(journal.entries[0].tag, "0000_forecast_decide_quota");
  assert.ok(readFileSync(join(migrations, `${journal.entries[0].tag}.sql`)).length);
  const module = await import(pathToFileURL(join(staged, "server", "index.js")).href);
  const worker = module.default;
  assert.equal((await worker.fetch(new Request(origin), {})).status, 200);
  assert.equal((await worker.fetch(new Request(`${origin}/api/decide`, { method: "OPTIONS" }), {})).status, 405);
  const response = await worker.fetch(new Request(`${origin}/api/decide`, {
    method: "POST", body: "{}",
    headers: { Host: new URL(origin).host, Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
  }), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, reason: "no-key" });
});
