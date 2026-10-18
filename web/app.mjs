import { decodeHeartRate, summarizeIntervals, readingState } from './heart-rate.mjs';
const el = (id) => document.getElementById(id);
let device = null, characteristic = null, connected = false, busy = false, generation = 0;
let readings = [], intervals = [], lastReceived = null, startedAt = null, rrObserved = false;
const logs = [];
const supported = Boolean(navigator.bluetooth && window.isSecureContext);
function log(message) {
  logs.unshift(`${new Date().toLocaleTimeString()} ${message}`);
  logs.length = Math.min(logs.length, 50);
  el('log').textContent = logs.join('\n');
}
function refresh() {
  const state = readingState(connected, lastReceived, performance.now());
  const last = readings.at(-1);
  el('status').textContent = connected && last?.contact === false && state === 'Live' ? 'Check sensor contact' : state;
  el('status').dataset.live = String(state === 'Live' && last?.contact !== false);
  el('bpm').textContent = state === 'Live' && last?.contact !== false && last?.bpm > 0 ? last.bpm : '—';
  el('connect').disabled = !supported || busy || connected;
  el('disconnect').disabled = busy || !connected;
  el('all-devices').disabled = busy || connected;
  el('export').disabled = readings.length === 0;
  if (lastReceived !== null) el('freshness').textContent = `Last received ${Math.max(0, (performance.now() - lastReceived) / 1000).toFixed(1)} seconds ago.`;
}
function release() {
  generation += 1;
  if (characteristic) characteristic.removeEventListener('characteristicvaluechanged', receive);
  characteristic = null;
  if (device) {
    device.removeEventListener('gattserverdisconnected', disconnected);
    if (device.gatt.connected) device.gatt.disconnect();
  }
  connected = false;
}
function disconnected() {
  release();
  log('Bluetooth disconnected. Use Connect Fitbit to reconnect.');
  el('message').textContent = 'Connection ended. Bring your Fitbit nearby and connect again.';
  refresh();
}
function receive(event) {
  const now = performance.now();
  try {
    const measurement = decodeHeartRate(event.target.value);
    if (lastReceived !== null) intervals.push(now - lastReceived);
    lastReceived = now;
    rrObserved ||= measurement.rrMs.length > 0;
    readings.push({ ...measurement, receivedAt: new Date().toISOString(), elapsedMs: now - startedAt });
    // Bounded in-memory diagnostic window; no browser persistence or uploads.
    if (readings.length > 10000) readings.shift();
    if (intervals.length > 9999) intervals.shift();
    el('count').textContent = readings.length.toLocaleString();
    const stats = summarizeIntervals(intervals);
    for (const key of ['median', 'p95', 'max']) el(key).textContent = stats[key] === null ? '—' : `${Math.round(stats[key])} ms`;
    const contact = measurement.contact === null ? 'not supplied' : measurement.contact ? 'detected' : 'not detected';
    el('optional').textContent = `Sensor contact: ${contact}. Beat intervals: ${measurement.rrMs.length ? measurement.rrMs.map((v) => Math.round(v) + ' ms').join(', ') : rrObserved ? 'previously observed; absent in this packet' : 'not observed'}.`;
    el('message').textContent = 'Receiving directly over Bluetooth. Nothing is uploaded.';
    refresh();
  } catch (error) { log(error.message); }
}
el('connect').addEventListener('click', async () => {
  if (busy || connected) return;
  busy = true; refresh();
  try {
    release();
    const attempt = generation;
    const ensureCurrent = (requireConnection = true) => {
      if (attempt !== generation || (requireConnection && !device?.gatt.connected)) {
        throw new Error('Connection ended during setup. Connect your Fitbit again.');
      }
    };
    const options = el('all-devices').checked
      ? { acceptAllDevices: true, optionalServices: ['heart_rate'] }
      : { filters: [{ services: ['heart_rate'] }] };
    device = await navigator.bluetooth.requestDevice(options);
    ensureCurrent(false);
    device.addEventListener('gattserverdisconnected', disconnected);
    el('device').textContent = device.name || 'Heart-rate device';
    log('Device selected. Connecting to heart-rate service…');
    const server = await device.gatt.connect();
    ensureCurrent();
    const service = await server.getPrimaryService('heart_rate');
    ensureCurrent();
    characteristic = await service.getCharacteristic('heart_rate_measurement');
    ensureCurrent();
    readings = []; intervals = []; lastReceived = null; rrObserved = false; startedAt = performance.now();
    el('count').textContent = '0';
    for (const key of ['median', 'p95', 'max']) el(key).textContent = '—';
    el('optional').textContent = 'Beat intervals and sensor contact: not yet observed.';
    el('freshness').textContent = 'Waiting for the first notification…';
    characteristic.addEventListener('characteristicvaluechanged', receive);
    await characteristic.startNotifications();
    ensureCurrent();
    connected = true;
    log('Subscribed to heart-rate notifications. Waiting for live data.');
    if (!readings.length) el('message').textContent = 'Connected. Waiting for your Fitbit to send a reading.';
  } catch (error) {
    release();
    const message = error.name === 'NotFoundError'
      ? 'No device selected or heart-rate service unavailable. Enable sharing on your Air and try again.'
      : `${error.message} Check macOS System Settings → Privacy & Security → Bluetooth → Google Chrome.`;
    el('message').textContent = message; log(message);
  } finally { busy = false; refresh(); }
});
el('disconnect').addEventListener('click', () => {
  release(); log('Disconnected by you.');
  el('message').textContent = 'Stopped. Test data remains available to download until you reconnect or close this tab.';
  refresh();
});
el('export').addEventListener('click', () => {
  const data = { version: 1, exportedAt: new Date().toISOString(),
    note: 'Local Bluetooth receipt timing only; not physiological or internet latency. Last 10000 readings maximum. No device identifier included.',
    intervalSummaryMs: summarizeIntervals(intervals), rrObserved, readings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `pulse-session-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => {
  log(document.hidden ? 'Tab hidden; check for timing gaps when you return.' : 'Tab visible.'); refresh();
});
window.addEventListener('pagehide', release);
if (!supported) {
  el('message').textContent = 'Open this local page in Google Chrome on your Mac. This browser does not expose Web Bluetooth.';
}
setInterval(refresh, 250); refresh();
