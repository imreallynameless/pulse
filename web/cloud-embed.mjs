const el = id => document.getElementById(id);
const feed = new URLSearchParams(location.search).get('feed') || '';
let reading = null, ageAtReceipt = 0, receivedAt = 0, active = true, generation = 0, next, timer, controller;
el('feed').textContent = feed;
el('status').dataset.live = 'false';
function tick() {
  if (!reading) return;
  const seconds = Math.floor(Math.max(0, ageAtReceipt + performance.now() - receivedAt) / 1000);
  const amount = seconds < 60 ? seconds : seconds < 3600 ? Math.floor(seconds / 60) : seconds < 86400 ? Math.floor(seconds / 3600) : Math.floor(seconds / 86400);
  const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : seconds < 86400 ? 'hour' : 'day';
  el('age').textContent = `Measured ${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
}
async function refresh() {
  const current = generation;
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 10000);
  try {
    const response = await fetch(`/cloud-reading?feed=${encodeURIComponent(feed)}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (!active || current !== generation) return;
    reading = data.reading;
    if (reading && Number.isInteger(reading.bpm) && Number.isFinite(reading.measuredAt) && Number.isFinite(data.serverTime)) {
      ageAtReceipt = Math.max(0, data.serverTime - reading.measuredAt);
      receivedAt = performance.now();
      el('bpm').textContent = reading.bpm;
      el('age').title = `Measured ${new Date(reading.measuredAt).toLocaleString()}`;
      el('status').textContent = data.status === 'paused' ? 'Updates paused' : 'Latest reading';
      el('status').dataset.state = data.status === 'paused' ? 'paused' : 'latest';
      tick();
    } else {
      reading = null; el('bpm').textContent = '—'; el('age').textContent = 'No reading shared';
      el('status').textContent = 'Waiting';
      el('status').dataset.state = 'waiting';
    }
  } catch {
    if (active && current === generation) {
      el('status').textContent = reading ? 'Updates paused' : 'Unavailable';
      el('status').dataset.state = 'paused';
    }
  } finally {
    clearTimeout(timeout);
    if (active && current === generation) next = setTimeout(refresh, 5000);
  }
}
window.addEventListener('pagehide', () => { active = false; generation++; controller?.abort(); clearTimeout(next); clearInterval(timer); });
window.addEventListener('pageshow', event => { if (event.persisted) start(); });
function start() {
  active = true; generation++; clearTimeout(next); clearInterval(timer);
  timer = setInterval(tick, 1000); void refresh();
}
if (/^[a-z0-9-]{1,64}$/.test(feed)) start();
else el('status').textContent = 'Feed unavailable';
