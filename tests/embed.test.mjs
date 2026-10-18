import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('widget returns from page cache with a fresh connection and rejects old socket events', async () => {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, { textContent: '', dataset: {} }); return elements.get(id); };
  const events = {}, sockets = [], timers = new Map(); let timerId = 0, now = 0;
  class Socket {
    constructor() { this.events = {}; sockets.push(this); }
    addEventListener(name, fn) { this.events[name] = fn; }
    send() {} close() {}
    reading(bpm) { this.events.message({data:JSON.stringify({type:'reading',bpm,ttlMs:5000})}); }
  }
  const source = await readFile(new URL('../web/embed.mjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    document: { getElementById: el }, location: { search:'?feed=alice', protocol:'http:', host:'localhost' },
    URLSearchParams, WebSocket: Socket, performance: { now: () => now },
    window: { addEventListener(name, fn) { events[name] = fn; } },
    setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); },
    setTimeout() {}, clearTimeout() {}
  });
  sockets[0].reading(72); assert.equal(el('status').textContent, 'Live');
  events.pagehide(); assert.equal(el('status').textContent, 'Offline');
  events.pageshow({persisted:true}); assert.equal(sockets.length, 2);
  sockets[0].reading(99); assert.notEqual(el('bpm').textContent, 99);
  sockets[1].reading(80); assert.equal(el('bpm').textContent, 80);
  now = 6000; for (const fn of timers.values()) fn();
  assert.equal(el('status').textContent, 'Stale'); assert.equal(el('bpm').textContent, '—');
});
