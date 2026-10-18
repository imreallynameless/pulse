import { WebSocketServer, WebSocket } from 'ws';
import { createHash, timingSafeEqual } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest();
export function createRelay(server, feeds, { freshnessMs = 5000, sweepMs = 250 } = {}) {
  const states = new Map(Object.keys(feeds).map(feed => [feed, { publisher: null, viewers: new Set(), latest: null, sequence: 0, status: 'offline' }]));
  const wss = new WebSocketServer({ server, path: '/live', maxPayload: 1024, perMessageDeflate: false });
  function write(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 32768) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  }
  function snapshot(feed, state) {
    const ttlMs = state.latest ? freshnessMs - (performance.now() - state.latest.at) : 0;
    if (ttlMs > 0) return { type: 'reading', feed, bpm: state.latest.bpm, sequence: state.sequence, ttlMs: Math.floor(ttlMs) };
    return { type: 'status', feed, status: state.publisher ? state.latest ? 'stale' : 'waiting' : 'offline' };
  }
  function broadcast(feed, state) { for (const ws of state.viewers) write(ws, snapshot(feed, state)); }
  wss.on('connection', ws => {
    let role = null, feed = null, state = null, windowStart = performance.now(), count = 0;
    const authTimer = setTimeout(() => ws.close(1008, 'Authentication timeout'), 5000);
    authTimer.unref();
    const fail = message => { write(ws, { type: 'error', message }); ws.close(1008, 'Invalid request'); };
    ws.on('error', () => {});
    ws.on('message', raw => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      if (++count > 20) return fail('Too many messages');
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return fail('Invalid JSON'); }
      if (!data || typeof data !== 'object') return fail('Invalid message');
      if (!role) {
        if (typeof data.feed !== 'string' || !states.has(data.feed)) return fail('Unknown feed');
        const candidate = states.get(data.feed);
        if (data.type === 'publish') {
          if (typeof data.token !== 'string' || !timingSafeEqual(digest(data.token), digest(feeds[data.feed]))) return fail('Invalid publishing token');
          if (candidate.publisher) return fail('This feed already has a broadcaster');
          role = 'publisher'; feed = data.feed; state = candidate; state.publisher = ws;
          state.latest = null; state.status = 'waiting'; write(ws, { type: 'ready', feed }); broadcast(feed, state);
        } else if (data.type === 'subscribe') {
          role = 'viewer'; feed = data.feed; state = candidate; state.viewers.add(ws); write(ws, snapshot(feed, state));
        } else return fail('Authenticate or subscribe first');
        clearTimeout(authTimer);
        return;
      }
      if (role !== 'publisher' || data.type !== 'reading') return fail('Read-only connection');
      if (!Number.isInteger(data.bpm) || data.bpm < 0 || data.bpm > 65535 ||
          (data.contact !== undefined && data.contact !== null && typeof data.contact !== 'boolean')) return fail('Invalid reading');
      state.latest = { bpm: data.bpm === 0 || data.contact === false ? null : data.bpm, at: now };
      state.sequence += 1; state.status = 'live'; broadcast(feed, state);
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!state) return;
      if (role === 'viewer') state.viewers.delete(ws);
      if (role === 'publisher' && state.publisher === ws) {
        state.publisher = null; state.latest = null; state.status = 'offline'; broadcast(feed, state);
      }
    });
    // Detect broken network connections even when no close frame arrives.
    ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  });
  const expiry = setInterval(() => {
    for (const [feed, state] of states) {
      if (state.status === 'live' && state.latest && performance.now() - state.latest.at >= freshnessMs) {
        state.status = 'stale'; broadcast(feed, state);
      }
    }
  }, sweepMs);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 15000);
  expiry.unref(); heartbeat.unref();
  return { close() { clearInterval(expiry); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); } };
}
