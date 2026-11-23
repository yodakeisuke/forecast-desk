import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSitesDecide } from "../../worker/sites-decide";
import { reserveQuota, type QuotaDB } from "../../worker/decide-quota";

const origin = "https://forecast.example";
const key = "fixture-value-jev-server-only";
const screen = {
  compare: "budget", filters: {}, scenario: { winRate: 28, slipBack: 0, naBias: 0 },
  refs: { winRate09: 29, winRate10: 28 },
};
const payload = JSON.stringify({ question: "欧州だけだと？", screen });
const headers = {
  Host: new URL(origin).host, Origin: origin, "Sec-Fetch-Site": "same-origin",
  "Content-Type": "application/json; charset=utf-8", "CF-Connecting-IP": "192.0.2.2",
};

function request({ edits = {}, body = payload, method = "POST", url = origin }: {
  edits?: Record<string, string | null>; body?: BodyInit; method?: string; url?: string;
} = {}) {
  const values = new Headers(headers);
  for (const [name, value] of Object.entries(edits)) {
    if (value === null) values.delete(name);
    else values.set(name, value);
  }
  // Node's Fetch requires duplex for streamed requests.
  const init = { method, headers: values, body: method === "POST" ? body : undefined, duplex: "half" as const };
  return new Request(`${url}/api/decide`, init);
}

function stubDb(admitted: boolean): QuotaDB {
  return {
    prepare: () => ({ bind() { return this; } }),
    async batch() { return [{ success: true, results: admitted ? [1, 2, 3, 4] : [] }, { success: true, results: [] }]; },
  };
}

test("Sites rejects invalid requests and unavailable quota before contacting Jev", async () => {
  let outbound = 0;
  let quotaCalls = 0;
  const db = stubDb(true);
  const batch = db.batch;
  db.batch = (...args) => { quotaCalls++; return batch(...args); };
  const handler = createSitesDecide(origin, {}, async () => { outbound++; return Response.json({}); });
  const env = { TYPESAFE_API_KEY: key, DECIDE_QUOTA: db };
  const brokenDb = { ...db, async batch(): Promise<never> { throw Error(key); } };
  for (const [input, status, config = env] of [
    [request({ method: "OPTIONS" }), 405],
    [request({ url: "https://other.example" }), 403],
    [request({ edits: { Host: "other.example" } }), 403],
    [request({ edits: { Origin: "https://other.example" } }), 403],
    [request({ edits: { Origin: null } }), 403],
    [request({ edits: { "Sec-Fetch-Site": "same-site" } }), 403],
    [request({ edits: { "Sec-Fetch-Site": null } }), 403],
    [request({ edits: { "Content-Type": "application/jsonp" } }), 415],
    [request({ edits: { "Content-Encoding": "gzip" } }), 415],
    [request({ edits: { "CF-Connecting-IP": null, "X-Forwarded-For": "192.0.2.2" } }), 403],
    [request({ edits: { "CF-Connecting-IP": "192.0.2.1, 192.0.2.2" } }), 403],
    [request({ edits: { "Content-Length": "4097" } }), 413],
    [request({ body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4097)); c.close(); } }) }), 413],
    [request({ body: "{" }), 400],
    [request({ body: JSON.stringify({ question: "test", screen, model: "arbitrary" }) }), 400],
    [request({ body: JSON.stringify({ question: "test", screen: { ...screen, filters: { region: "Mars" } } }) }), 400],
    [request(), 503, { DECIDE_QUOTA: db }],
    [request(), 503, { TYPESAFE_API_KEY: key }],
    [request(), 503, { ...env, DECIDE_QUOTA: brokenDb }],
    [request(), 429, { ...env, DECIDE_QUOTA: stubDb(false) }],
  ] as const) {
    const res = await handler(input, config);
    assert.equal(res.status, status);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal((await res.text()).includes(key), false);
  }
  assert.equal(quotaCalls, 0);
  assert.equal(outbound, 0);
});

test("Sites uses a fixed upstream and returns only validated decisions even when upstream includes secrets", async (t) => {
  const diagnostics: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { diagnostics.push(args); });
  const handler = createSitesDecide(origin, {}, async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("Authorization") === `Bearer ${key}`, true);
    assert.notEqual(init?.signal, undefined);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "jev-latest");
    assert.equal(body.questions.region.type, "choice");
    return Response.json({
      model: key, error: key, answers: {
        region: { choice: "欧州", confidence: 0.9, ignored: key, probabilities: { [key]: 1 } },
        product: { choice: key }, compare: { choice: "toString" },
        win_rate: { choice: "keep", confidence: 30 },
        [key]: { choice: "keep" },
      },
    }, { headers: { "X-Upstream": key } });
  });
  const env = { TYPESAFE_API_KEY: key, DECIDE_QUOTA: stubDb(true) };
  const success = await handler(request(), env);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("X-Upstream"), null);
  const body = await success.text();
  assert.equal(body.includes(key), false);
  assert.deepEqual(JSON.parse(body).answers, {
    region: { type: "choice", choice: "欧州", confidence: 0.9, probabilities: {} },
    win_rate: { type: "choice", choice: "keep", probabilities: {} },
  });
  for (const upstream of [
    async () => new Response(key, { status: 401 }),
    async () => new Response(key.repeat(2048)),
    async () => { throw new Error(key); },
  ]) {
    const response = await createSitesDecide(origin, {}, upstream)(request(), env);
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes(key), false);
  }
  assert.deepEqual(diagnostics, [
    ["forecast.jev.upstream", { status: 401 }],
    ["forecast.jev.upstream", { failure: "network-or-response" }],
    ["forecast.jev.upstream", { failure: "network-or-response" }],
  ]);
  assert.equal(JSON.stringify(diagnostics).includes(key), false);
});

test("Sites refuses upstream redirects without forwarding credentials or Location", async (t) => {
  t.mock.method(console, "warn", () => {});
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    let canceled = false;
    const handler = createSitesDecide(origin, {}, async (url, init) => {
      calls++;
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(init?.redirect, "manual");
      return new Response(new ReadableStream({ cancel() { canceled = true; } }), {
        status, headers: { Location: `https://other.example/${key}` },
      });
    });
    const response = await handler(request(), { TYPESAFE_API_KEY: key, DECIDE_QUOTA: stubDb(true) });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Location"), null);
    assert.equal((await response.text()).includes(key), false);
    assert.equal(calls, 1);
    assert.equal(canceled, true);
  }
});

test("Sites cancels the upstream request on client abort", async () => {
  const controller = new AbortController();
  const handler = createSitesDecide(origin, {}, async (_url, init) => {
    controller.abort();
    init?.signal?.throwIfAborted();
    throw new Error("Expected abort");
  });
  const response = await handler(new Request(request(), { signal: controller.signal }), {
    TYPESAFE_API_KEY: key, DECIDE_QUOTA: stubDb(true),
  });
  assert.equal(response.status, 504);
});

test("SQLite atomically applies IP and global ceilings and prunes expired counters", async (t) => {
  const builtin = "node:sqlite";
  const sqlite = await import(builtin).catch(() => undefined) as {
    DatabaseSync: new (name: string) => {
      close(): void;
      exec(sql: string): void;
      prepare(sql: string): {
        all(bindings?: Record<string, string | number>): unknown[];
        get(): Record<string, unknown> | undefined;
      };
    };
  } | undefined;
  if (!sqlite) return t.skip("node:sqlite is available in the Node 22 CI environment");
  const db = new sqlite.DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(readFileSync("drizzle/0000_forecast_decide_quota.sql", "utf8"));
  type Query = () => { success: boolean; results: unknown[] };
  const pending = new WeakMap<object, Query>();
  const binding: QuotaDB = {
    prepare(sql) {
      return { bind(...values) {
        const statement = db.prepare(sql);
        const bindings = Object.fromEntries(values.map((value, i) => [`?${i + 1}`, value]));
        pending.set(this, () => ({ success: true, results: statement.all(bindings) }));
        return this;
      } };
    },
    async batch(queries) {
      db.exec("BEGIN");
      try {
        const results = queries.map(query => pending.get(query)!());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const minute = 60_000;
  const day = 86_400_000;
  const admit = (client: number, time: number) => reserveQuota(binding, `192.0.2.${client}`, key, time);
  const attempts = await Promise.all(Array.from({ length: 8 }, () => admit(1, 0)));
  assert.equal(attempts.filter(Boolean).length, 3);
  const minuteOne = await Promise.all(Array.from({ length: 20 }, (_, i) => admit(i + 2, 0)));
  assert.equal(minuteOne.filter(Boolean).length, 7);
  for (let i = 1; i <= 3; i++) {
    for (let j = 0; j < 3; j++) assert.equal(await admit(1, i * minute), true);
  }
  assert.equal(await admit(1, 4 * minute), false);
  for (let i = 0; i < 31; i++) assert.equal(await admit(i + 2, (i + 5) * minute), true);
  assert.equal(await admit(100, 40 * minute), false);
  assert.equal(await admit(1, day), true);
  assert.equal(await admit(1, day), true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM forecast_decide_quota").get()?.n, 4);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM forecast_decide_quota").all()).includes("192.0.2."), false);
});
