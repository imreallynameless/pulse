import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createRelay } from '../relay.mjs';

async function fixture(t, options = {}) {
  const server = createServer();
  const relay = createRelay(server, { alice: 'secret-alice', bob: 'secret-bob' }, options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sockets = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); relay.close(); await new Promise(resolve => server.close(resolve)); });
  return async (message) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/live`);
    sockets.push(ws);
    const inbox = [], waiting = [];
    ws.on('message', raw => { const value = JSON.parse(raw); if (waiting.length) waiting.shift()(value); else inbox.push(value); });
    ws.next = () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for relay message')), 1500);
      waiting.push(value => { clearTimeout(timer); resolve(value); });
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); setTimeout(() => reject(new Error('WebSocket connection timed out')), 1500).unref(); });
    ws.send(JSON.stringify(message));
    return ws;
  };
}
const send = (socket, message) => socket.send(JSON.stringify(message));
test('authenticated feed broadcasts repeated readings; disconnect clears viewers', { timeout: 5000 }, async t => {
  const connect = await fixture(t);
  const viewer = await connect({ type: 'subscribe', feed: 'alice' });
  assert.equal((await viewer.next()).status, 'offline');
  const pub = await connect({ type: 'publish', feed: 'alice', token: 'secret-alice' });
  assert.equal((await pub.next()).type, 'ready');
  assert.equal((await viewer.next()).status, 'waiting');
  send(pub, { type: 'reading', bpm: 72 });
  const first = await viewer.next(); assert.equal(first.bpm, 72); assert.equal(first.type, 'reading');
  send(pub, { type: 'reading', bpm: 72 });
  const second = await viewer.next(); assert.ok(second.sequence > first.sequence);
  const late = await connect({ type: 'subscribe', feed: 'alice' });
  const latest = await late.next(); assert.equal(latest.bpm, 72); assert.ok(latest.ttlMs > 0 && latest.ttlMs <= 5000);
  pub.close(); assert.equal((await viewer.next()).status, 'offline');
});
test('invalid publisher credentials are rejected', { timeout: 5000 }, async t => {
  const connect = await fixture(t);
  const pub = await connect({ type: 'publish', feed: 'alice', token: 'wrong' });
  assert.equal((await pub.next()).type, 'error');
});
test('viewers cannot publish and one feed cannot update another', { timeout: 5000 }, async t => {
  const connect = await fixture(t);
  const bob = await connect({ type: 'subscribe', feed: 'bob' }); await bob.next();
  send(bob, { type: 'reading', bpm: 99 });
  assert.equal((await bob.next()).type, 'error');
  const pub = await connect({ type: 'publish', feed: 'alice', token: 'secret-alice' }); await pub.next();
  send(pub, { type: 'reading', bpm: 72 });
  const bob2 = await connect({ type: 'subscribe', feed: 'bob' });
  assert.equal((await bob2.next()).status, 'offline');
});
test('malformed measurements are rejected; stale values expire for existing and new viewers', { timeout: 5000 }, async t => {
  const connect = await fixture(t, { freshnessMs: 60, sweepMs: 10 });
  const pub = await connect({ type: 'publish', feed: 'alice', token: 'secret-alice' }); await pub.next();
  const viewer = await connect({ type: 'subscribe', feed: 'alice' }); await viewer.next();
  send(pub, { type: 'reading', bpm: 80 }); assert.equal((await viewer.next()).bpm, 80);
  assert.equal((await viewer.next()).status, 'stale');
  const late = await connect({ type: 'subscribe', feed: 'alice' }); assert.equal((await late.next()).status, 'stale');
  send(pub, { type: 'reading', bpm: '80' }); assert.equal((await pub.next()).type, 'error');
});
test('a second publisher cannot replace an active feed', { timeout: 5000 }, async t => {
  const connect = await fixture(t);
  const first = await connect({ type: 'publish', feed: 'alice', token: 'secret-alice' }); await first.next();
  const second = await connect({ type: 'publish', feed: 'alice', token: 'secret-alice' });
  assert.equal((await second.next()).type, 'error');
});
