import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicSnapshot } from '../cloud-snapshot.mjs';
const now = 1800000000000;
const data = { feed: 'alice', sharing: true, checkedAt: now, latest: { bpm: 72, measuredAt: now - 600000, source: 'FITBIT', firstSeenAt: now }, secret: 'never expose' };
test('cloud keeps original measurement time and exposes only public fields', () => {
  const result = publicSnapshot(data, 'alice', now);
  assert.deepEqual(result, { status: 'latest', reading: { bpm: 72, measuredAt: now - 600000 }, serverTime: now });
  assert.equal(publicSnapshot({...data, checkedAt: now + 30000}, 'alice', now + 30000).reading.measuredAt, result.reading.measuredAt);
});
test('cloud feed isolation and stop sharing clear public readings', () => {
  assert.equal(publicSnapshot(data, 'bob', now).reading, null);
  assert.equal(publicSnapshot({...data, sharing:false}, 'alice', now).reading, null);
});
test('cloud outages keep historical BPM with paused status; invalid timestamps are rejected', () => {
  assert.equal(publicSnapshot(data, 'alice', now + 120001).status, 'paused');
  assert.equal(publicSnapshot({...data,error:true}, 'alice', now).status, 'paused');
  assert.equal(publicSnapshot({...data,latest:{bpm:72,measuredAt:now+1}}, 'alice', now).reading, null);
});
