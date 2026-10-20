import type { Reading } from '../types.ts';
interface Observation extends Reading { source: string; firstSeenAt: number }
const el = (id: string) => document.getElementById(id)!;
let latest: Observation | null;
function age() {
  if (latest) el('age').textContent = `Measured ${Math.max(0, Math.floor((Date.now() - latest.measuredAt) / 1000))} seconds ago`;
}
async function update() {
  try {
    const response = await fetch('/status');
    if (!response.ok) throw new Error();
    const data: { configured: boolean; connected: boolean; cloudFeed?: string; latest: Observation | null; checkedAt: number; error?: string; observations?: Observation[] } = await response.json();
    el('status').textContent = !data.configured ? 'Setup needed: Google OAuth credentials have not been added yet.' : data.connected ? 'Connected · checking for new readings every 30 seconds' : 'Ready to connect your Google Health account.';
    (el('connect') as HTMLButtonElement).disabled = !data.configured || data.connected;
    el('disconnect').hidden = !data.connected;
    el('sharing').textContent = data.connected && data.cloudFeed ? `Sharing latest BPM and measurement time to widget feed: ${data.cloudFeed}. Disconnect locally to stop sharing.` : '';
    latest = data.latest;
    el('reading').textContent = latest ? `${latest.bpm} bpm` : '—';
    el('age').textContent = data.connected ? 'Waiting for a reading from the last 24 hours' : 'No reading yet';
    el('details').textContent = latest ? `Source: ${latest.source} · Last successful check: ${new Date(data.checkedAt).toLocaleTimeString()}` : '';
    el('error').textContent = data.error || '';
    el('history').textContent = data.observations?.length ? [...data.observations].reverse().map((r, i, rows) => `${new Date(r.firstSeenAt).toLocaleTimeString()} — ${r.bpm} bpm, measured ${Math.round((r.firstSeenAt - r.measuredAt) / 1000)}s earlier${i === rows.length - 1 ? ' (initial observation)' : ''}`).join('\n') : 'No observations yet.';
    age();
  } catch { el('error').textContent = 'Local tester is unavailable. Readings are no longer updating.'; }
  setTimeout(update, 3000);
}
setInterval(age, 1000);
void update();
