import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, digest } from '../cloudflare/security.ts';
import worker, { PulseAccount } from '../cloudflare/worker.ts';
const env = { ADMIN_KEY: 'a'.repeat(43), TOKEN_KEY: 'b'.repeat(43), FEED: 'my-pulse', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' };
function fixture() {
  const map = new Map();
  const storage = { get: async k => structuredClone(map.get(k)), put: async (k,v) => map.set(k, structuredClone(v)), delete: async k => map.delete(k) };
  return { map, storage, account: new PulseAccount({ storage }, env) };
}
const request = (path, options = {}) => new Request('https://pulse.example' + path, options);
test('tokens are authenticated ciphertext and survive a storage roundtrip', async () => {
  const value = await seal({ refresh_token: 'private-token' }, env.TOKEN_KEY);
  assert.ok(!JSON.stringify(value).includes('private-token'));
  assert.deepEqual(await unseal(value, env.TOKEN_KEY), { refresh_token: 'private-token' });
  await assert.rejects(unseal(value, 'wrong-key'));
});
test('connect requires owner session and same origin', async () => {
  const { account } = fixture();
  assert.equal((await account.fetch(request('/connect', { method:'POST', headers:{Origin:'https://pulse.example'} }))).status, 403);
});
test('callback rejects unbound or expired state', async () => {
  const { account, storage } = fixture();
  await storage.put('pending', { state:'state', browser:'browser', expires:Date.now()+600000 });
  assert.equal((await account.fetch(request('/callback?state=state&code=fake'))).status, 403);
});
test('public response excludes tokens, identity and history across restarts', async () => {
  const { storage } = fixture();
  const now = Date.now();
  await storage.put('account', { tokens: await seal({refresh_token:'private'}, env.TOKEN_KEY), latest:{bpm:70,measuredAt:now-30000,source:'FITBIT'}, checkedAt:now });
  const restarted = new PulseAccount({storage},env);
  const body = await (await restarted.fetch(request('/cloud-reading?feed=my-pulse'))).json();
  assert.deepEqual(body.reading,{bpm:70,measuredAt:now-30000});
  assert.equal(body.status,'latest');
  assert.ok(!JSON.stringify(body).includes('private'));
  assert.ok(!JSON.stringify(body).includes('FITBIT'));
  assert.equal((await restarted.fetch(request('/cloud-reading?feed=other'))).status,404);
});
test('disconnect needs session, then clears public sharing', async () => {
  const {account, storage} = fixture();
  await storage.put('account',{ tokens:'cipher', latest:{bpm:70, measuredAt:Date.now()-1000},checkedAt:Date.now() });
  await storage.put('session',{hash:await digest('session'),expires:Date.now()+60000});
  const headers = {Origin:'https://pulse.example',Cookie:'pulse_session=session'};
  assert.equal((await account.fetch(request('/disconnect',{method:'POST',headers:{...headers,Origin:'https://evil.example'}}))).status,403);
  assert.equal((await account.fetch(request('/disconnect',{method:'POST',headers}))).status,303);
  assert.equal((await (await account.fetch(request('/cloud-reading?feed=my-pulse'))).json()).reading,null);
});
test('scheduled polling refreshes expired tokens and persists newest measurement', async () => {
  const {account,storage} = fixture(), now=Date.now();
  await storage.put('account',{tokens:await seal({refresh_token:'refresh',access_token:'expired',expiresAt:0},env.TOKEN_KEY)});
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    if(String(url).includes('oauth2')) return Response.json({access_token:'new',expires_in:3600});
    assert.equal(options.headers.Authorization,'Bearer new');
    return Response.json({dataPoints:[{heartRate:{beatsPerMinute:'73',sampleTime:{physicalTime:new Date(now-60000).toISOString()}}},{heartRate:{beatsPerMinute:'999',sampleTime:{physicalTime:new Date(now).toISOString()}}}]});
  };
  try {
    assert.equal((await account.fetch(request('/_poll'))).status,204);
    const stored=await storage.get('account');
    assert.deepEqual(stored.latest,{bpm:73,measuredAt:now-60000});
    assert.equal((await unseal(stored.tokens,env.TOKEN_KEY)).refresh_token,'refresh');
    assert.equal(stored.error,false);
  } finally {globalThis.fetch=original;}
});
test('failed refresh keeps measured age and backs off; queued disconnect clears it', async () => {
  const {account,storage}=fixture(),now=Date.now();
  await storage.put('account',{tokens:await seal({access_token:'access',expiresAt:now+3600000},env.TOKEN_KEY),latest:{bpm:65,measuredAt:now-120000},checkedAt:now});
  await storage.put('session',{hash:await digest('session'),expires:now+60000});
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('no',{status:429});
  try {
    await account.fetch(request('/_poll'));
    const data=await (await account.fetch(request('/cloud-reading?feed=my-pulse'))).json();
    assert.equal(data.status,'paused'); assert.equal(data.reading.measuredAt,now-120000);
    assert.ok((await storage.get('account')).nextCheck>now);
    await Promise.all([account.fetch(request('/_poll')),account.fetch(request('/disconnect',{method:'POST',headers:{Origin:'https://pulse.example',Cookie:'pulse_session=session'}}))]);
    assert.equal(await storage.get('account'),undefined);
  } finally {globalThis.fetch=original;}
});
test('public snapshot stays available during slow polling; disconnect waits and clears result', async () => {
  const {account,storage}=fixture(),now=Date.now();
  await storage.put('account',{tokens:await seal({access_token:'access',expiresAt:now+3600000},env.TOKEN_KEY),latest:{bpm:65,measuredAt:now-120000},checkedAt:now});
  await storage.put('session',{hash:await digest('session'),expires:now+60000});
  const original=globalThis.fetch;
  let release, started;
  const pending=new Promise(r=>release=r), entered=new Promise(r=>started=r);
  globalThis.fetch=async()=>{started();await pending;return Response.json({dataPoints:[]});};
  try {
    const polling=account.fetch(request('/_poll')); await entered;
    const read=account.fetch(request('/cloud-reading?feed=my-pulse'));
    const winner=await Promise.race([read.then(()=>true),new Promise(r=>setTimeout(()=>r(false),100))]);
    const disconnect=account.fetch(request('/disconnect',{method:'POST',headers:{Origin:'https://pulse.example',Cookie:'pulse_session=session'}}));
    release(); await Promise.all([polling,disconnect]);
    assert.equal(winner,true,'public snapshot must not wait for Google');
    assert.equal(await storage.get('account'),undefined);
  } finally {release();globalThis.fetch=original;}
});

test('static files use the built asset store; private routes never fall through', async () => {
  const bindings = { ASSETS: { fetch: async req => new Response('license', {status:new URL(req.url).pathname==='/fonts/OFL-Figtree.txt'?200:404}) } };
  assert.equal((await worker.fetch(request('/fonts/OFL-Figtree.txt'),bindings)).status,200);
  assert.equal((await worker.fetch(request('/.env'),bindings)).status,404);
  assert.equal((await worker.fetch(request('/_poll'),bindings)).status,404);
  assert.equal((await worker.fetch(request('/connect',{method:'POST'}),bindings)).status,503);
});

test('unfinished login bodies do not block polling and time out', async () => {
  const {account}=fixture();
  let cancelled=false;
  const body=new ReadableStream({cancel(){cancelled=true;}});
  const login=account.fetch(request('/login',{method:'POST',headers:{Origin:'https://pulse.example','Content-Type':'application/x-www-form-urlencoded'},body,duplex:'half'}));
  assert.equal(await Promise.race([account.fetch(request('/_poll')).then(r=>r.status),new Promise(r=>setTimeout(()=>r('blocked'),100))]),204);
  assert.equal((await login).status,408);
  assert.equal(cancelled,true);
});
test('login enforces actual body size without Content-Length and accepts valid forms', async () => {
  const {account}=fixture();
  const headers={Origin:'https://pulse.example','Content-Type':'application/x-www-form-urlencoded'};
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('key='+ 'x'.repeat(4096)));c.close();}});
  assert.equal((await account.fetch(request('/login',{method:'POST',headers,body,duplex:'half'}))).status,413);
  const result=await account.fetch(request('/login',{method:'POST',headers,body:new URLSearchParams({key:env.ADMIN_KEY})}));
  assert.equal(result.status,303);
  assert.match(result.headers.get('Set-Cookie'),/pulse_session=/);
});

test('large responses retain progress and resume the same query beyond six pages', async () => {
  const {account,storage}=fixture(),now=Date.now(), original=globalThis.fetch;
  const latest={bpm:65,measuredAt:now-3600000};
  await storage.put('account',{tokens:await seal({access_token:'access',expiresAt:now+3600000},env.TOKEN_KEY),latest});
  const filters=[]; let calls=0;
  globalThis.fetch=async input=>{
    const url=new URL(input); filters.push(url.searchParams.get('filter'));
    const page=Number(url.searchParams.get('pageToken')||0); calls++;
    return Response.json({dataPoints:[{heartRate:{beatsPerMinute:70+page,sampleTime:{physicalTime:new Date(now-60000+page).toISOString()}}}],...(page<7?{nextPageToken:String(page+1)}:{})});
  };
  try {
    await account.fetch(request('/_poll'));
    let stored=await storage.get('account');
    assert.equal(stored.error,false); assert.equal(stored.latest.bpm,75); assert.equal(calls,6);
    assert.ok(filters[0].includes(new Date(latest.measuredAt-300000).toISOString()));
    await account.fetch(request('/_poll'));
    stored=await storage.get('account');
    assert.equal(stored.latest.bpm,77); assert.equal(stored.error,false); assert.equal(calls,8);
    assert.ok(filters.every(f=>f===filters[0]),'pagination must retain the original time window');
    await account.fetch(request('/_poll'));
    assert.ok(filters[8].includes(new Date(stored.latest.measuredAt-300000).toISOString()));
  } finally {globalThis.fetch=original;}
});

test('failed refresh retries within five minutes, including old hour backoff', async () => {
  const {account,storage}=fixture(),now=Date.now(),original=globalThis.fetch;
  await storage.put('account',{tokens:await seal({access_token:'access',expiresAt:now+3600000},env.TOKEN_KEY),failures:8,nextCheck:now+3600000});
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('unavailable',{status:503});};
  try {
    await account.fetch(request('/_poll'));
    const stored=await storage.get('account');
    assert.equal(calls,1,'old hour backoff must not delay recovery');
    assert.ok(stored.nextCheck<=Date.now()+300000);
  } finally {globalThis.fetch=original;}
});

test('a failed page retains earlier readings and resumes without skipping the failed page', async () => {
  const {account,storage}=fixture(),now=Date.now(),original=globalThis.fetch;
  await storage.put('account',{tokens:await seal({access_token:'access',expiresAt:now+3600000},env.TOKEN_KEY)});
  let fail=true;
  globalThis.fetch=async input=>{
    const cursor=new URL(input).searchParams.get('pageToken');
    if(cursor==='next' && fail) return new Response('failure',{status:503});
    if(cursor==='next') return Response.json({dataPoints:[]});
    return Response.json({dataPoints:[{heartRate:{beatsPerMinute:80,sampleTime:{physicalTime:new Date(now-1000).toISOString()}}}],nextPageToken:'next'});
  };
  try {
    await account.fetch(request('/_poll'));
    let stored=await storage.get('account');
    assert.equal(stored.error,true); assert.equal(stored.latest.bpm,80); assert.equal(stored.scan.pageToken,'next');
    fail=false; stored.nextCheck=0; await storage.put('account',stored);
    await account.fetch(request('/_poll'));
    stored=await storage.get('account'); assert.equal(stored.error,false); assert.equal(stored.scan,null);
  } finally {globalThis.fetch=original;}
});

test('rejected pagination restarts without a cursor; transient failures keep progress', async () => {
  const original=globalThis.fetch;
  try {
    for(const status of [400,429,503]) {
      const {account,storage}=fixture(),now=Date.now();
      await storage.put('account',{tokens:await seal({access_token:'access',expiresAt:now+3600000},env.TOKEN_KEY),scan:{since:now-3600000,until:now-60000,pageToken:'cursor'}});
      globalThis.fetch=async()=>new Response('',{status});
      await account.poll();
      const stored=await storage.get('account');
      assert.equal(stored.scan?.pageToken,status===400?undefined:'cursor');
      stored.nextCheck=0; await storage.put('account',stored);
      globalThis.fetch=async url=>{
        assert.equal(new URL(url).searchParams.get('pageToken'),status===400?'':'cursor');
        return Response.json({dataPoints:[]});
      };
      await account.poll();
      assert.equal((await storage.get('account')).error,false);
    }
  } finally {globalThis.fetch=original;}
});
