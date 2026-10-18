import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHeartRate, summarizeIntervals, readingState } from '../web/heart-rate.mjs';
const packet = (...bytes) => new DataView(Uint8Array.from(bytes).buffer);
test('decodes 8-bit BPM without inventing contact or RR data', () => {
  assert.deepEqual(decodeHeartRate(packet(0, 72)), { bpm: 72, contact: null, energy: null, rrMs: [] });
});
test('decodes little-endian 16-bit BPM, energy, contact and multiple RR intervals', () => {
  assert.deepEqual(decodeHeartRate(packet(31, 44, 1, 10, 0, 0, 4, 0, 2)), {
    bpm: 300, contact: true, energy: 10, rrMs: [1000, 500]
  });
});
test('distinguishes absent sensor contact from unsupported contact detection', () => {
  assert.equal(decodeHeartRate(packet(4, 0)).contact, false);
  assert.equal(decodeHeartRate(packet(2, 72)).contact, null);
});
test('rejects truncated BPM, energy, and RR fields', () => {
  for (const bytes of [[], [0], [1, 72], [8, 72, 1], [16, 72], [16, 72, 1], [16, 72, 0, 4, 1]]) {
    assert.throws(() => decodeHeartRate(packet(...bytes)), /Malformed/);
  }
});
test('summarizes notification intervals using nearest-rank percentiles', () => {
  assert.deepEqual(summarizeIntervals([1000, 2000, 500, 1000]), { count: 4, median: 1000, p95: 2000, max: 2000 });
  assert.deepEqual(summarizeIntervals([]), { count: 0, median: null, p95: null, max: null });
});
test('does not present disconnected or stale readings as live', () => {
  assert.equal(readingState(false, 1000, 1100), 'Offline');
  assert.equal(readingState(true, null, 1000), 'Waiting for readings');
  assert.equal(readingState(true, 1000, 5999), 'Live');
  assert.equal(readingState(true, 1000, 6000), 'Stale');
});
