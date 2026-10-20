import type { CloudSnapshot, PublicSnapshot } from './types.ts';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';

export const snapshotPath = new URL('./recordings/cloud-latest.json', import.meta.url);
export async function writeCloudSnapshot(value: CloudSnapshot) {
  await mkdir(new URL('./recordings/', import.meta.url), { recursive: true, mode: 0o700 });
  const temporary = new URL('./recordings/cloud-latest.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, snapshotPath);
}
export async function readCloudSnapshot(feed: string, now = Date.now()): Promise<PublicSnapshot> {
  try { return publicSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')), feed, now); }
  catch { return { status: 'waiting', reading: null, serverTime: now }; }
}
export function publicSnapshot(data: CloudSnapshot | null, feed: string, now = Date.now()): PublicSnapshot {
  const empty: PublicSnapshot = { status: 'waiting', reading: null, serverTime: now };
  if (!data || data.feed !== feed || !data.sharing) return empty;
  const r = data.latest;
  if (!r || !Number.isInteger(r.bpm) || r.bpm < 1 || r.bpm > 300 ||
      !Number.isFinite(r.measuredAt) || r.measuredAt <= 0 || r.measuredAt > now) return empty;
  return {
    status: data.error || !Number.isFinite(data.checkedAt) || now - (data.checkedAt || 0) > 120000 ? 'paused' : 'latest',
    reading: { bpm: r.bpm, measuredAt: r.measuredAt },
    serverTime: now
  };
}
