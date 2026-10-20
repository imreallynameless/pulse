import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
test('cloud widget ages original measurement, retains age on failures and clears stopped sharing', async () => {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, { textContent: '', dataset: {} }); return elements.get(id); };
  let now = 0, interval, fail = false;
  const timeouts = new Map(); let id = 0;
  let payload = {status:'latest',serverTime:1000000,reading:{bpm:72,measuredAt:880000}};
  const run = async () => { await new Promise(resolve => setImmediate(resolve)); };
  const refresh = async () => { const entry = [...timeouts].find(([,t]) => t.ms === 5000); timeouts.delete(entry[0]); await entry[1].fn(); await run(); };
  vm.runInNewContext((await transform(await readFile(new URL('../web/cloud-embed.ts',import.meta.url),'utf8'), {loader:'ts',format:'iife'})).code, {
    document:{getElementById:el},location:{search:'?feed=alice'},URLSearchParams,AbortController,
    performance:{now:()=>now},window:{addEventListener(){}},encodeURIComponent,
    setInterval(fn){interval=fn;},clearInterval(){},
    setTimeout(fn,ms){timeouts.set(++id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);},
    fetch:async()=>{if(fail)throw Error();return {ok:true,json:async()=>payload};}
  });
  await run();
  assert.equal(el('bpm').textContent,'72');
  assert.equal(el('age').textContent,'Measured 2 minutes ago');
  now=60000; interval(); assert.equal(el('age').textContent,'Measured 3 minutes ago');
  payload={...payload,serverTime:1060000}; await refresh();
  assert.equal(el('age').textContent,'Measured 3 minutes ago');
  fail=true; await refresh(); now=120000; interval();
  assert.equal(el('status').textContent,'Updates paused');
  assert.equal(el('age').textContent,'Measured 4 minutes ago');
  fail=false; payload={status:'waiting',reading:null,serverTime:1120000}; await refresh();
  assert.equal(el('bpm').textContent,'—');
  assert.equal(el('age').textContent,'No reading shared');
  assert.equal(el('age').title,'');
  assert.equal(el('age').ariaLabel,'No reading shared');
});
