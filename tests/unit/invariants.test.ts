import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate } from '../../src/data/generate';
import { checkUntrustedSql } from '../../src/data/sql-policy';
import { actions, store, decodeView, encodeView } from '../../src/state/store';
import { withCaller, currentAgent } from '../../src/agent/context';

const tables = generate();
const rows = (name: string) => { const t = tables.find(t => t.name === name)!; return t.rows.map(r => Object.fromEntries(t.columns.map((c,i) => [c.name,r[i]]))); };
test('all booking vintages are nonnegative and reconcile to annual targets', () => {
  const bookings = rows('fact_newarr');
  assert.ok(bookings.every(r => Number(r.amount) >= 0));
  for (const [version, target] of [['v09',21.3], ['v10',17.4]] as const) {
    const cutoff = version === 'v09' ? 5 : 6;
    const total = bookings.filter(r => r.version_id === version || r.kind === 'actual' && Number(r.month) <= cutoff).reduce((s,r) => s + Number(r.amount),0);
    assert.ok(Math.abs(total - target) < .002, `${version}: ${total}`);
  }
});
test('dummy generation is deterministic', () => assert.deepEqual(generate(), tables));
test('SQL policy rejects mutations, external reads and multiple statements', () => {
  for (const sql of ["DELETE FROM fact_deal", "SELECT 1; SELECT 2", "SELECT * FROM read_csv('https://example.com')", "SET enable_external_access=true", "WITH x AS (DELETE FROM fact_deal) SELECT * FROM x"]) assert.throws(() => checkUntrustedSql(sql));
  assert.equal(checkUntrustedSql("SELECT 'delete; set' AS label;"), "SELECT 'delete; set' AS label");
  assert.ok(checkUntrustedSql('WITH x AS (SELECT 1) SELECT * FROM x'));
});
test('invalid drill dimensions and context do not enter state', () => {
  for (const s of ['by=region>region', 'by=account', 'context=region:invalid']) assert.throws(() => decodeView(s));
  const v = store.getState().view; assert.deepEqual(decodeView(encodeView(v)), v);
});
test('agent undo preserves a later human scenario edit', () => {
  actions.reset(); actions.setScenario('/scenario/winRate',25,'agent'); actions.setScenario('/scenario/winRate',30,'user'); actions.setScenario('/scenario/slipBack',50,'agent');
  assert.deepEqual(actions.undoScenario('agent'), ['/scenario/slipBack']);
  assert.equal(store.getState().scenario.values['/scenario/winRate'],30);
  assert.equal(store.getState().scenario.values['/scenario/slipBack'],0);
});
test('note links restore their original drill context', () => {
  actions.reset(); const v = { ...store.getState().view, tab:'pipeline' as const, context:{region:'北米'}, detail:'北米' };
  actions.setView(v); actions.setCompare('v09','agent'); const n=actions.addNote('deals:dates','test','agent','test'); actions.setView({...v,tab:'variance',context:{},detail:null}); actions.setCompare('budget','user'); actions.restoreNote(n);
  assert.deepEqual(store.getState().view, v); assert.equal(store.getState().compare,'v09');
});
test('aborted or replaced confirmations resolve and clean up', async () => {
  const ac = new AbortController(); ac.abort(); assert.equal(await actions.askConfirm('test',ac.signal),false);
  const a=actions.askConfirm('a'); const b=actions.askConfirm('b'); assert.equal(await a,false); actions.reset(); assert.equal(await b,false); assert.equal(store.getState().confirm,null);
});
test('concurrent transports retain caller identity and release queue after errors', async () => {
  const seen:string[]=[];
  const a=withCaller('webmcp',async()=>{seen.push(currentAgent()); await new Promise(r=>setTimeout(r,10)); seen.push(currentAgent()); throw Error('expected');});
  const b=withCaller('js',async()=>{seen.push(currentAgent());});
  await Promise.allSettled([a,b]); assert.equal(seen[0],seen[1]); assert.notEqual(seen[1],seen[2]);
});

import { bridgeChart } from '../../src/shared/charts';
test('waterfall supports zero and negative profit without nonfinite geometry', () => {
  for (const [from,to,steps] of [[0,0,[]], [-2,-4,[{label:'cost',value:-2}]], [2,-3,[{label:'drop',value:-5}]], [-2,3,[{label:'gain',value:5}]]] as const) {
    const c = bridgeChart({fromLabel:'before',toLabel:'after',from,to,steps:[...steps],w:480});
    const json=JSON.stringify(c); assert.ok(!/NaN|Infinity|null/.test(json));
    for(const m of c.marks) for(const v of Object.values(m)) if(typeof v==='number') assert.ok(Number.isFinite(v));
  }
});
test('global filters clear old drill context so order does not change the selected scope', () => {
  actions.reset(); actions.setView({...store.getState().view,tab:'pipeline',context:{region:'北米'},open:['北米'],detail:'北米/Enterprise'});
  actions.setFilter('region','欧州','user');
  const s=store.getState(); assert.equal(s.filters.region,'欧州'); assert.deepEqual(s.view.context,{}); assert.equal(s.view.detail,null);
});
test('annotation history can restore and remove notes and rejects invalid states', () => {
  actions.reset(); actions.addNote('kpi:op','test','agent','test'); const notes=JSON.stringify(store.getState().notes);
  actions.restoreNotes('[]'); assert.equal(store.getState().notes.length,0); actions.restoreNotes(notes); assert.equal(store.getState().notes[0].text,'test');
  assert.throws(()=>actions.restoreNotes('[{"n":1}]'));
});
// @ts-expect-error Worker is plain JavaScript shared with the deployment build.
import { createWorker } from '../../worker/security-worker.mjs';
test('header worker protects pages, assets, errors and rejects unlisted paths', async () => {
  const worker=createWorker({pages:['/'],html:'<!doctype html>',headers:{'Content-Security-Policy':"default-src 'none'"},assets:{'/guarded/a.js':{path:'/a.js',type:'text/javascript'}}});
  const env={ASSETS:{fetch:async(r:Request)=>{assert.equal(new URL(r.url).pathname,'/a.js');return new Response('export {}')}}};
  for(const [path,status] of [['/',200],['/guarded/a.js',200],['/nope',404]]) { const r=await worker.fetch(new Request('https://app.example'+path),env); assert.equal(r.status,status);assert.equal(r.headers.get('content-security-policy'),"default-src 'none'"); }
  assert.equal((await worker.fetch(new Request('https://app.example/',{method:'POST'}),env)).status,405);
  assert.equal(await (await worker.fetch(new Request('https://app.example/',{method:'HEAD'}),env)).text(),'');
});

import { widgetWritePolicy } from '../../src/genui/write-policy';
test('generated code cannot claim human ownership or silently overwrite human inputs', () => {
  for(const owner of ['init','agent','widget','user'] as const) {
    const spontaneous=widgetWritePolicy(false,owner,30,40);
    assert.equal(spontaneous.source,'widget'); assert.equal(spontaneous.decision,owner==='user'?'confirm':'apply');
    const delegated=widgetWritePolicy(true,owner,30,40); assert.equal(delegated.source,'agent');
    assert.equal(widgetWritePolicy(false,owner,30,30).decision,'unchanged');
  }
});

test('echoing a human value cannot acquire ownership before a second write', () => {
  actions.reset(); actions.setScenario('/scenario/winRate',30,'user');
  for(const value of [30,90]) {
    const s=store.getState().scenario;
    const policy=widgetWritePolicy(false,s.owner['/scenario/winRate'],s.values['/scenario/winRate'],value);
    if(policy.decision==='apply') actions.setScenario('/scenario/winRate',value,policy.source);
  }
  assert.equal(store.getState().scenario.values['/scenario/winRate'],30);
  assert.equal(store.getState().scenario.owner['/scenario/winRate'],'user');
});

import { sandboxHeaders } from '../../security.config.mjs';
test('sandbox retains CSP while adding non-Fetch network restrictions', () => {
  const headers=sandboxHeaders();
  assert.ok(headers['Content-Security-Policy'].includes("connect-src 'none'"));
  assert.ok(headers['Content-Security-Policy'].includes("webrtc 'block'"));
  assert.equal(headers['Connection-Allowlist'],'(response-origin)');
  assert.equal(headers['X-DNS-Prefetch-Control'],'off');
});
