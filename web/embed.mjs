if (new URLSearchParams(location.search).get('layout') === 'compact') document.documentElement.dataset.layout = 'compact';
const el = id => document.getElementById(id);
const feed = new URLSearchParams(location.search).get('feed') || '';
const cloudMode = new URLSearchParams(location.search).get('source') === 'cloud';
const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
el('feed').textContent = feed;
let socket, reconnect, timer, expiresAt = 0, receivedAt = 0, active = true;
function status(text) {
  el('status').textContent = text; el('status').dataset.live = 'false';
  el('bpm').textContent = '—'; el('age').textContent = 'No current reading'; expiresAt = 0;
}
function connect() {
  if (!active) return;
  status('Connecting');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/live`);
  socket = ws;
  ws.addEventListener('open', () => { if (active && socket === ws) ws.send(JSON.stringify({ type: 'subscribe', feed })); });
  ws.addEventListener('message', event => {
    if (!active || socket !== ws) return;
    const data = JSON.parse(event.data);
    if (data.type === 'reading' && data.ttlMs > 0) {
      receivedAt = performance.now(); expiresAt = receivedAt + data.ttlMs;
      el('bpm').textContent = data.bpm ?? '—';
      el('status').textContent = data.bpm === null ? 'No reading' : 'Live';
      el('status').dataset.live = String(data.bpm !== null);
      el('age').textContent = 'Just received';
    } else if (data.type === 'status') {
      status({ offline: 'Offline', stale: 'Stale', waiting: 'Waiting' }[data.status] || 'Offline');
    } else if (data.type === 'error') { active = false; status('Feed unavailable'); socket.close(); }
  });
  ws.addEventListener('close', () => {
    if (!active || socket !== ws) return;
    status('Offline'); reconnect = setTimeout(connect, 2000);
  });
  ws.addEventListener('error', () => { if (active && socket === ws) status('Offline'); });
}
function tick() {
  if (expiresAt && performance.now() >= expiresAt) status('Stale');
  else if (expiresAt) el('age').textContent = `${((performance.now() - receivedAt) / 1000).toFixed(1)}s since received`;
}
function resume() {
  if (!/^[a-z0-9-]{1,64}$/.test(feed)) { active = false; status('Feed unavailable'); return; }
  active = true; clearInterval(timer); timer = setInterval(tick, 250); connect();
}
window.addEventListener('pagehide', () => {
  if (cloudMode) return;
  active = false; clearTimeout(reconnect); clearInterval(timer);
  const old = socket; socket = null; old?.close(); status('Offline');
});
window.addEventListener('pageshow', event => { if (event.persisted && !cloudMode) resume(); });
if (cloudMode) {
  active = false;
  import('./cloud-embed.mjs');
} else resume();
