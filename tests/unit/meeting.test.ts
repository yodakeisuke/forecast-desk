// Meeting mode: the decision (かんたんモード and Jev's answers → Plan) and the relay that holds the TypeSafe key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { localPlan } from '../../src/meeting/local';
import { buildJevRequest, checkAnswers, planFromJev } from '../../src/meeting/jev';
import { sanitize, statedPercent, type Plan, type Screen } from '../../src/meeting/plan';
import { createDecideHandler } from '../../server/decide-relay';

const screen: Screen = { compare: 'budget', filters: { region: null, segment: null, product: null }, scenario: { winRate: 27.3, slipBack: 0, naBias: 0 }, refs: { winRate09: 29.1, winRate10: 27.3 } };

test('かんたんモード: よく出る問いを画面の状態に変える', () => {
  const eu = localPlan('欧州だけだと、前月版比でどう？', screen);
  assert.equal(eu.kind, 'answer'); assert.equal(eu.compare, 'v09'); assert.equal(eu.region, '欧州');
  assert.deepEqual(eu.focus, ['c-bridge', 'c-var']);
  const why = localPlan('北米のEnterpriseは、なぜこんなに落ちたの？', screen);
  assert.equal(why.kind, 'handoff'); assert.equal(why.region, '北米'); assert.equal(why.segment, 'Enterprise');
  const win = localPlan('成約率30%なら？', screen);
  assert.equal(win.winRate, 30); assert.equal(win.focus[0], 'c-scenario');
  const back = localPlan('成約率が前月並みに戻ったら？', screen);
  assert.equal(back.winRate, 29.1, 'the number comes from the app, not from the question or a model');
  assert.equal(back.winRateFrom, 'previous_month', 'marked so the app re-reads it for the target scope');
  assert.equal(win.winRateFrom, undefined);
  const off = localPlan('競合の値下げの影響は？', screen);
  assert.equal(off.kind, 'unsupported');
  assert.equal(off.region, null); assert.equal(off.compare, null); assert.equal(off.winRate, null, 'an unsupported question never moves the screen');
});

test('statedPercent: 全角・小数・パーセント表記', () => {
  assert.equal(statedPercent('成約率が３０．５％なら', /成約率/), 30.5);
  assert.equal(statedPercent('成約率 25パーセント', /成約率/), 25);
  assert.equal(statedPercent('売上30%', /成約率/), null);
});

test('sanitize: 知らない値は捨て、数字は範囲に収める', () => {
  const bad = { kind: 'drop table' as never, compare: 'v10' as never, region: 'Mars', segment: 'all', product: 'Core', winRate: 400, slipBack: -5, focus: ['c-evil', 'c-q', 'c-q', 'c-var', 'c-heat'] as never, kpi: 'x' as never, confidence: {} } satisfies Plan;
  const p = sanitize(bad);
  assert.equal(p.kind, 'answer'); assert.equal(p.compare, null); assert.equal(p.region, null); assert.equal(p.segment, 'all'); assert.equal(p.product, 'Core');
  assert.equal(p.winRate, 100); assert.equal(p.slipBack, 0); assert.deepEqual(p.focus, ['c-q', 'c-var']); assert.equal(p.kpi, 'op');
});

test('Jevへの質問は選択肢だけ。答えは提示した選択肢以外を捨てる', () => {
  const req = buildJevRequest('欧州だけだと、前月版比でどう？', screen);
  assert.equal(req.state.meeting_question, '欧州だけだと、前月版比でどう？');
  for (const q of Object.values(req.questions)) { assert.equal(q.type, 'choice'); assert.ok(Object.keys(q.criteria).length >= 2); }
  assert.ok('keep' in req.questions.region.criteria && '欧州' in req.questions.region.criteria);
  assert.ok(!('v10' in req.questions.compare.criteria), 'the current version is never a comparison base');
  const raw = { answers: {
    intent: { type: 'choice', choice: 'answer_on_screen', probabilities: { answer_on_screen: 0.94, evil: 0.9 } },
    compare: { type: 'choice', choice: 'v09', probabilities: { v09: 0.91 } },
    region: { type: 'choice', choice: '欧州', probabilities: { 欧州: 0.97 } },
    segment: { type: 'choice', choice: 'Mars', probabilities: { Mars: 1 } },
    product: { type: 'choice', choice: 'Core', probabilities: { Core: 0.41 } },
    focus: { type: 'choice', choice: 'c-bridge', probabilities: { 'c-bridge': 0.6, 'c-var': 0.3, 'c-heat': 0.1 } },
    kpi: { type: 'choice', choice: 'op', probabilities: { op: 0.8 } },
    win_rate: { type: 'choice', choice: 'keep', probabilities: { keep: 0.99 } },
    extra: { type: 'choice', choice: 'x' },
  } };
  const a = checkAnswers(req, raw);
  assert.ok(!('segment' in a), 'an option that was not offered is dropped'); assert.ok(!('extra' in a));
  assert.deepEqual(Object.keys(a.intent.probabilities ?? {}), ['answer_on_screen']);
  const plan = planFromJev(a, req.state.meeting_question as string, screen);
  assert.equal(plan.kind, 'answer'); assert.equal(plan.compare, 'v09'); assert.equal(plan.region, '欧州');
  assert.equal(plan.segment, null); assert.equal(plan.product, null, 'below the probability bar the screen stays as it is');
  assert.deepEqual(plan.focus, ['c-bridge', 'c-var']); assert.equal(plan.winRate, null);
  assert.deepEqual(checkAnswers(req, { nope: 1 }), {}); assert.deepEqual(checkAnswers(req, null), {});
});

test('Jev: 「なぜ」は渡し、迷った問いは画面を動かさない', () => {
  const req = buildJevRequest('北米はなぜ落ちた？', screen);
  const why = planFromJev(checkAnswers(req, { answers: { intent: { type: 'choice', choice: 'ask_why', probabilities: { ask_why: 0.88 } }, region: { type: 'choice', choice: '北米', probabilities: { 北米: 0.95 } } } }), '北米はなぜ落ちた？', screen);
  assert.equal(why.kind, 'handoff'); assert.equal(why.region, '北米');
  const unsure = planFromJev(checkAnswers(req, { answers: { intent: { type: 'choice', choice: 'answer_on_screen', probabilities: { answer_on_screen: 0.4 } }, region: { type: 'choice', choice: '北米', probabilities: { 北米: 0.95 } } } }), 'x', screen);
  assert.equal(unsure.kind, 'unsupported'); assert.equal(unsure.region, null);
  const prev = planFromJev(checkAnswers(req, { answers: { intent: { type: 'choice', choice: 'answer_on_screen', probabilities: { answer_on_screen: 0.9 } }, win_rate: { type: 'choice', choice: 'previous_month', probabilities: { previous_month: 0.9 } } } }), '成約率が戻ったら', screen);
  assert.equal(prev.winRate, 29.1); assert.equal(prev.winRateFrom, 'previous_month'); assert.equal(prev.focus[0], 'c-scenario');
});

// ---------- the relay: the only place the key lives ----------
const KEY = 'tsk_test_SECRET_9f8e7d';
const ORIGIN = 'http://localhost:5173';
const body = JSON.stringify({ question: '欧州だけだと？', screen });
type Seen = { url: string; headers: Record<string, string>; body: any };

async function relay(opts: { key?: string; auth?: string; upstream?: (s: Seen) => Response | Promise<Response> } = {}) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const s = { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    seen.push(s);
    return opts.upstream ? opts.upstream(s) : new Response(JSON.stringify({ model: 'jev-1', answers: { intent: { type: 'choice', choice: 'answer_on_screen', probabilities: { answer_on_screen: 0.9 } } }, account: { key: KEY } }), { status: 200 });
  }) as typeof fetch;
  const handler = createDecideHandler({ key: 'key' in opts ? opts.key : KEY, auth: opts.auth, origins: [ORIGIN], fetchImpl });
  const server: Server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const send = (o: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; text: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/decide', method: o.method ?? 'POST', headers: { host: 'localhost:5173', origin: ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...o.headers } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
    });
    req.on('error', reject); req.end(o.body ?? body);
  });
  return { send, seen, close: () => new Promise((r) => server.close(r)) };
}

test('中継: 同じオリジンの正しい問いだけを、決まった形でJevに送る', async () => {
  const r = await relay();
  try {
    const ok = await r.send();
    assert.equal(ok.status, 200);
    const out = JSON.parse(ok.text);
    assert.equal(out.ok, true); assert.equal(out.model, 'jev-1'); assert.equal(out.answers.intent.choice, 'answer_on_screen');
    assert.ok(!ok.text.includes(KEY), 'the upstream body (and the key) never come back'); assert.ok(!('account' in out));
    assert.equal(r.seen.length, 1);
    assert.equal(r.seen[0].url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(r.seen[0].headers.Authorization, `Bearer ${KEY}`);
    assert.deepEqual(Object.keys(r.seen[0].body.questions).sort(), ['compare', 'focus', 'intent', 'kpi', 'product', 'region', 'segment', 'slip_back', 'win_rate']);
    assert.equal(ok.headers['cache-control'], 'no-store');
  } finally { await r.close(); }
});

test('中継: 他のサイト・別ホスト・単純リクエスト・大きすぎ・余計な項目は送らない', async () => {
  const r = await relay();
  try {
    const cases: [string, Parameters<typeof r.send>[0], number][] = [
      ['GET', { method: 'GET', body: '' }, 405],
      ['cross-site origin', { headers: { origin: 'https://evil.example' } }, 403],
      ['no origin', { headers: { origin: '' } }, 403],
      ['DNS rebinding host', { headers: { host: 'evil.example:5173' } }, 403],
      ['cross-site fetch', { headers: { 'sec-fetch-site': 'cross-site' } }, 403],
      ['form post (simple request)', { headers: { 'content-type': 'text/plain' } }, 415],
      ['oversize', { body: JSON.stringify({ question: 'x'.repeat(5000), screen }) }, 413],
      ['not json', { body: '{' }, 400],
      ['open proxy: own questions', { body: JSON.stringify({ question: 'q', screen, questions: { leak: { type: 'choice', criteria: { a: 'b' } } } }) }, 400],
      ['open proxy: own model', { body: JSON.stringify({ question: 'q', screen, model: 'expensive' }) }, 400],
      ['unknown member', { body: JSON.stringify({ question: 'q', screen: { ...screen, filters: { region: 'Mars' } } }) }, 400],
      ['empty question', { body: JSON.stringify({ question: '  ', screen }) }, 400],
    ];
    for (const [name, o, status] of cases) {
      const res = await r.send(o);
      assert.equal(res.status, status, name);
      assert.ok(!res.text.includes(KEY), name);
    }
    assert.equal(r.seen.length, 0, 'none of these reached Jev');
  } finally { await r.close(); }
});

test('中継: 鍵がなければ503、プロキシ注入なら鍵を持たない', async () => {
  const none = await relay({ key: undefined });
  try { const res = await none.send(); assert.equal(res.status, 503); assert.equal(JSON.parse(res.text).reason, 'no-key'); assert.equal(none.seen.length, 0); } finally { await none.close(); }
  const proxy = await relay({ key: undefined, auth: 'proxy' });
  try { const res = await proxy.send(); assert.equal(res.status, 200); assert.ok(!('Authorization' in proxy.seen[0].headers)); } finally { await proxy.close(); }
});

test('中継: 上流のエラー本文は返さない、回数に上限がある', async () => {
  const err = await relay({ upstream: () => new Response(JSON.stringify({ error: 'invalid key ' + KEY }), { status: 401 }) });
  try { const res = await err.send(); assert.equal(res.status, 502); assert.ok(!res.text.includes(KEY)); assert.ok(!res.text.includes('invalid')); } finally { await err.close(); }
  const r = await relay();
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await r.send()).status);
    assert.ok(statuses.includes(429), `burst is limited: ${statuses.join(',')}`);
  } finally { await r.close(); }
});
