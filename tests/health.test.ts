import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, HOUR, configuredMetrics, dueMetric, mergeDays, publicHealth, syncMetric, type Google, type MetricState } from '../cloudflare/health.ts';
import { seal, unseal, digest, type Sealed } from '../cloudflare/security.ts';
import worker, { PulseAccount } from '../cloudflare/worker.ts';
type WorkerEnv = Parameters<typeof worker.fetch>[1];
type HealthBody = ReturnType<typeof publicHealth>;
const now = Date.parse('2026-10-28T18:00:00Z');
const date = (iso: string) => { const [year, month, day] = iso.split('-').map(Number); return { year, month, day }; };

test('config keeps known metrics once, in order', () => {
  assert.deepEqual(configuredMetrics(' steps, sleep,bogus,steps '), ['steps', 'sleep']);
  assert.deepEqual(configuredMetrics(undefined), []);
});

test('parsers read each data type and reject bad values', () => {
  assert.deepEqual(METRICS.steps.parse({ civilStartTime: { date: date('2026-10-27') }, steps: { countSum: '8123' } }), ['2026-10-27', 8123, 0]);
  assert.equal(METRICS.steps.parse({ civilStartTime: { date: date('2026-10-27') } }), null);
  assert.deepEqual(METRICS.activeZoneMinutes.parse({ civilStartTime: { date: date('2026-10-27') }, activeZoneMinutes: { sumInFatBurnHeartZone: '10', sumInCardioHeartZone: '6' } }), ['2026-10-27', 16, 0]);
  assert.deepEqual(METRICS.restingHeartRate.parse({ dailyRestingHeartRate: { date: date('2026-10-27'), beatsPerMinute: '58' } }), ['2026-10-27', 58, 0]);
  assert.equal(METRICS.restingHeartRate.parse({ dailyRestingHeartRate: { date: date('2026-10-27'), beatsPerMinute: '999' } }), null);
  assert.deepEqual(METRICS.hrv.parse({ dailyHeartRateVariability: { date: date('2026-10-27'), averageHeartRateVariabilityMilliseconds: 41.26 } }), ['2026-10-27', 41.3, 0]);
  assert.deepEqual(METRICS.oxygenSaturation.parse({ dailyOxygenSaturation: { date: date('2026-10-27'), averagePercentage: 96.44 } }), ['2026-10-27', 96.4, 0]);
  assert.deepEqual(METRICS.respiratoryRate.parse({ dailyRespiratoryRate: { date: date('2026-10-27'), breathsPerMinute: 14.2 } }), ['2026-10-27', 14.2, 0]);
  assert.deepEqual(METRICS.skinTemperature.parse({ dailySleepTemperatureDerivations: { date: date('2026-10-27'), nightlyTemperatureCelsius: 34.1, baselineTemperatureCelsius: 34.4 } }), ['2026-10-27', -0.3, 0]);
  assert.equal(METRICS.skinTemperature.parse({ dailySleepTemperatureDerivations: { date: date('2026-10-27'), nightlyTemperatureCelsius: 34.1 } }), null);
  assert.deepEqual(METRICS.vo2Max.parse({ dailyVo2Max: { date: date('2026-10-27'), vo2Max: 47.04 } }), ['2026-10-27', 47, 0]);
  const at = '2026-10-20T15:00:00Z';
  assert.deepEqual(METRICS.weight.parse({ weight: { weightGrams: 72440, sampleTime: { physicalTime: at, civilTime: { date: date('2026-10-20') } } } }), ['2026-10-20', 72.4, Date.parse(at)]);
  const sleep = { interval: { endTime: '2026-10-28T14:00:00Z', endUtcOffset: '-25200s' }, metadata: {}, summary: { minutesAsleep: '431', stagesSummary: [{ type: 'DEEP', minutes: '62' }, { type: 'REM', minutes: '90' }, { type: 'ASLEEP', minutes: '5' }] } };
  assert.deepEqual(METRICS.sleep.parse({ sleep }), ['2026-10-28', { asleep: 431, deep: 62, rem: 90 }, 431]);
  assert.equal(METRICS.sleep.parse({ sleep: { ...sleep, metadata: { nap: true } } }), null);
});

test('sleep reads the local wake date and stage times Google actually sends', () => {
  const stage = (type: string, startTime: string, endTime: string) => ({ type, startTime, endTime, startUtcOffset: '-25200s', endUtcOffset: '-25200s' });
  const interval = { startTime: '2026-10-30T02:00:00Z', startUtcOffset: '-25200s', endTime: '2026-10-30T05:30:00Z', endUtcOffset: '-25200s' };
  const stages = [stage('AWAKE', '2026-10-30T02:00:00Z', '2026-10-30T02:10:00Z'), stage('LIGHT', '2026-10-30T02:10:00Z', '2026-10-30T04:10:00Z'), stage('DEEP', '2026-10-30T04:10:00Z', '2026-10-30T05:00:00Z'), stage('REM', '2026-10-30T05:00:00Z', '2026-10-30T05:30:00Z')];
  // 05:30 UTC is still the evening of the 29th at UTC-7.
  assert.deepEqual(METRICS.sleep.parse({ sleep: { interval, type: 'STAGES', stages } }), ['2026-10-29', { asleep: 200, deep: 50, light: 120, rem: 30, awake: 10 }, 200]);
  assert.equal(METRICS.sleep.parse({ sleep: { interval: {}, stages } }), null);
  assert.equal(METRICS.sleep.parse({ sleep: { interval, stages: [] } }), null);
});

test('nights over twelve hours are dropped when read and hidden if already stored', () => {
  const interval = { endTime: '2026-10-28T14:00:00Z', endUtcOffset: '-25200s' };
  assert.equal(METRICS.sleep.parse({ sleep: { interval, summary: { minutesAsleep: '721' } } }), null);
  assert.deepEqual(METRICS.sleep.parse({ sleep: { interval, summary: { minutesAsleep: '720' } } }), ['2026-10-28', { asleep: 720 }, 720]);
  const days = { '2026-06-21': { asleep: 1092 }, '2026-10-28': { asleep: 431 } };
  assert.deepEqual(publicHealth(['sleep'], { sleep: { days } }).metrics.sleep.days, [['2026-10-28', { asleep: 431 }]]);
});

test('merging keeps the latest weigh-in, overwrites stale days and trims past a year', () => {
  const days = mergeDays({ '2025-01-01': 70, '2026-10-26': 5000 }, [['2026-10-26', 9000, 0], ['2026-10-20', 72.1, 1], ['2026-10-20', 72.4, 2], ['2026-10-20', 71.9, 0], null], '2026-10-01', now);
  assert.deepEqual(days, { '2026-10-26': 9000, '2026-10-20': 72.4 });
});

test('merging drops re-read days Google no longer has and ignores points before the window', () => {
  const stored = { '2026-09-30': 1, '2026-10-01': 2, '2026-10-02': 3 };
  assert.deepEqual(mergeDays(stored, [['2026-09-29', 9, 0]], '2026-10-01', now), { '2026-09-30': 1, '2026-10-01': 2 });
});

test('an empty read deletes nothing, however often it repeats', async () => {
  const days = { '2026-10-20': 1, '2026-10-26': 2, '2026-10-27': 3 };
  assert.deepEqual(mergeDays(days, [], '2026-10-24', now), days);
  assert.deepEqual(mergeDays(days, [null], '2026-10-24', now), days);
  let state: MetricState = { days };
  for (let run = 0; run < 5; run++) state = await syncMetric('sleep', state, (async () => ({})) as Google, now);
  assert.deepEqual(state.days, days);
});

test('a metric stuck failing still drops days past the year', async () => {
  const failing = (status: number) => (async () => { throw Object.assign(new Error('no'), { status }); }) as Google;
  for (const status of [403, 500]) {
    const state = await syncMetric('steps', { days: { '2025-01-01': 1, '2026-10-26': 2 } }, failing(status), now);
    assert.deepEqual(state.days, { '2026-10-26': 2 });
  }
});

test('a night reported as zero minutes asleep falls back to its stages', () => {
  const sleep = { interval: { endTime: '2026-10-27T14:00:00Z', endUtcOffset: '-25200s' }, summary: { minutesAsleep: '0', stagesSummary: [{ type: 'DEEP', minutes: 60 }, { type: 'LIGHT', minutes: 300 }] } };
  assert.deepEqual(METRICS.sleep.parse({ sleep })?.[1], { asleep: 360, deep: 60, light: 300 });
});

test('one metric is due at a time: never-synced first, then hourly, errors after backoff', () => {
  const keys = ['steps', 'sleep'];
  assert.equal(dueMetric(keys, {}, now), 'steps');
  assert.equal(dueMetric(keys, { steps: { days: {}, syncedAt: now - 60000 } }, now), 'sleep');
  assert.equal(dueMetric(keys, { steps: { days: {}, syncedAt: now - 60000 }, sleep: { days: {}, syncedAt: now - 60000 } }, now), undefined);
  assert.equal(dueMetric(keys, { steps: { days: {}, syncedAt: now - HOUR }, sleep: { days: {}, syncedAt: now } }, now), 'steps');
  assert.equal(dueMetric(['steps'], { steps: { days: {}, status: 'error', nextRun: now + 1000 } }, now), undefined);
});

test('first sync backfills a year in 90-day rollups, later syncs re-read three days', async () => {
  const bodies: { range: { start: { date: unknown }; end: { date: unknown } } }[] = [];
  const google: Google = async <T,>(_url: string | URL, options?: RequestInit) => {
    bodies.push(JSON.parse(String(options?.body)));
    return { rollupDataPoints: [{ civilStartTime: { date: date('2026-10-27') }, steps: { countSum: '8000' } }] } as T;
  };
  const first = await syncMetric('steps', undefined, google, now);
  assert.equal(bodies.length, 5);
  assert.deepEqual(bodies[0].range.start.date, date('2025-10-28'));
  assert.deepEqual(bodies[4].range.end.date, date('2026-10-30'));
  assert.deepEqual(first, { days: { '2026-10-27': 8000 }, syncedAt: now, status: 'ok', failures: 0 });
  bodies.length = 0;
  await syncMetric('steps', first, google, now + HOUR);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].range.start.date, date('2026-10-24'));
});

test('a long gap re-reads from the newest stored day', async () => {
  const urls: URL[] = [];
  await syncMetric('weight', { days: { '2026-10-10': 70 }, syncedAt: now - HOUR }, async <T,>(url: string | URL) => { urls.push(new URL(url)); return {} as T; }, now);
  assert.equal(urls[0].searchParams.get('filter'), 'weight.sample_time.physical_time >= "2026-10-07T00:00:00Z"');
  urls.length = 0;
  await syncMetric('weight', { days: { '2026-11-05': 70 }, syncedAt: now - HOUR }, async <T,>(url: string | URL) => { urls.push(new URL(url)); return {} as T; }, now);
  assert.equal(urls[0].searchParams.get('filter'), 'weight.sample_time.physical_time >= "2026-10-25T00:00:00Z"');
});

test('paging stops at the cap', async () => {
  let calls = 0;
  await syncMetric('hrv', undefined, async <T,>() => { calls++; return { dataPoints: [], nextPageToken: 'more' } as T; }, now);
  assert.equal(calls, 20);
});

test('the last source wins for a daily metric', () => {
  assert.deepEqual(mergeDays({}, [['2026-10-26', 60, 0], ['2026-10-26', 70, 0]], '2026-10-01', now), { '2026-10-26': 70 });
});

test('a synced metric with nothing stored keeps backfilling', async () => {
  const urls: URL[] = [];
  await syncMetric('sleep', { days: {}, syncedAt: now - HOUR, status: 'ok' }, async <T,>(url: string | URL) => { urls.push(new URL(url)); return {} as T; }, now);
  assert.equal(urls[0].searchParams.get('filter'), 'sleep.interval.civil_end_time >= "2025-10-28"');
});

test('list metrics page through results with filters where Google supports them', async () => {
  const urls: URL[] = [];
  const google: Google = async <T,>(url: string | URL) => {
    urls.push(new URL(url));
    return (urls.length === 1 ? { dataPoints: [], nextPageToken: 'next' } : { dataPoints: [] }) as T;
  };
  await syncMetric('sleep', undefined, google, now);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].pathname.endsWith('/sleep/dataPoints:reconcile'));
  assert.equal(urls[0].searchParams.get('dataSourceFamily'), null);
  assert.equal(urls[0].searchParams.get('filter'), 'sleep.interval.civil_end_time >= "2025-10-28"');
  assert.equal(urls[1].searchParams.get('pageToken'), 'next');
  urls.length = 0;
  await syncMetric('hrv', undefined, async <T,>(url: string | URL) => { urls.push(new URL(url)); return {} as T; }, now);
  assert.equal(urls[0].searchParams.get('filter'), null);
  assert.equal(urls[0].searchParams.get('dataSourceFamily'), 'users/me/dataSourceFamilies/all-sources');
});

test('missing scopes ask for a reconnect; other failures back off and keep data', async () => {
  const kept: MetricState = { days: { '2026-10-27': 58 }, syncedAt: now - HOUR, status: 'ok' };
  const forbidden = await syncMetric('restingHeartRate', kept, async () => { throw Object.assign(new Error('no'), { status: 403 }); }, now);
  assert.equal(forbidden.status, 'reconnect');
  assert.deepEqual(forbidden.days, kept.days);
  const failed = await syncMetric('restingHeartRate', kept, async () => { throw Object.assign(new Error('no'), { status: 500 }); }, now);
  assert.equal(failed.status, 'error');
  assert.equal(failed.nextRun, now + 60000);
  assert.deepEqual(failed.days, kept.days);
});

// Worker integration: health rides the existing cron and owner flows.
const baseEnv = { ADMIN_KEY: 'a'.repeat(43), TOKEN_KEY: 'b'.repeat(43), FEED: 'my-pulse', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' };
function fixture(extra: Record<string, string> = {}) {
  const map = new Map<string, unknown>();
  const storage = { get: async <T,>(k: string) => structuredClone(map.get(k)) as T, put: async (k: string, v: unknown) => { map.set(k, structuredClone(v)); }, delete: async (k: string) => map.delete(k) };
  return { map, storage, account: new PulseAccount({ storage } as unknown as DurableObjectState, { ...baseEnv, ...extra } as WorkerEnv) };
}
const request = (path: string, options: RequestInit = {}) => new Request('https://pulse.example' + path, options);

test('health.json is off by default and 404s for other feeds', async () => {
  assert.equal((await fixture().account.fetch(request('/health.json?feed=my-pulse'))).status, 404);
  assert.equal((await fixture({ HEALTH_METRICS: 'steps' }).account.fetch(request('/health.json?feed=other'))).status, 404);
});

test('health.json publishes sorted days, statuses and public caching headers', async () => {
  const { account, storage } = fixture({ HEALTH_METRICS: 'steps,sleep' });
  await storage.put('account', { tokens: await seal({ refresh_token: 'private' }, baseEnv.TOKEN_KEY) });
  await storage.put('health:steps', { days: { '2026-10-27': 9000, '2026-10-26': 5000 }, syncedAt: now, status: 'ok' });
  const res = await account.fetch(request('/health.json?feed=my-pulse'));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
  const body = await res.json<HealthBody>();
  assert.deepEqual(body, { updatedAt: now, metrics: { steps: { unit: 'steps', days: [['2026-10-26', 5000], ['2026-10-27', 9000]] } }, status: { steps: 'ok', sleep: 'pending' } });
});

test('a failing health sync leaves the heart-rate reading healthy', async () => {
  const { account, storage, map } = fixture({ HEALTH_METRICS: 'steps' });
  await storage.put('account', { tokens: await seal({ refresh_token: 'refresh', access_token: 'live', expiresAt: Date.now() + HOUR }, baseEnv.TOKEN_KEY) });
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('heart-rate')
    ? Response.json({ dataPoints: [{ heartRate: { beatsPerMinute: '70', sampleTime: { physicalTime: new Date(Date.now() - 60000).toISOString() } } }] })
    : new Response('nope', { status: 500 });
  try { await account.fetch(request('/_poll')); } finally { globalThis.fetch = original; }
  const saved = map.get('account') as { error: boolean; latest: { bpm: number } };
  assert.equal(saved.error, false);
  assert.equal(saved.latest.bpm, 70);
  assert.equal((map.get('health:steps') as MetricState).status, 'error');
});

test('an expired Google login is reported on the metric and backs off', async () => {
  const { account, storage, map } = fixture({ HEALTH_METRICS: 'steps' });
  await storage.put('account', { tokens: await seal({ refresh_token: 'refresh', access_token: 'old', expiresAt: 0 }, baseEnv.TOKEN_KEY) });
  const original = globalThis.fetch;
  let refreshes = 0;
  globalThis.fetch = async url => { if (String(url).includes('oauth2')) refreshes++; return new Response('invalid_grant', { status: 400 }); };
  try {
    await account.fetch(request('/_poll'));
    await account.syncHealth();
  } finally { globalThis.fetch = original; }
  const state = map.get('health:steps') as MetricState;
  assert.equal(state.status, 'reconnect');
  assert.ok(state.nextRun! > Date.now());
  assert.equal(refreshes, 2, 'one from the heart-rate poll, one from the health sync');
});

test('a TOKEN_KEY that no longer opens the login asks for a reconnect', async () => {
  const { account, storage, map } = fixture({ HEALTH_METRICS: 'steps' });
  await storage.put('account', { tokens: await seal({ refresh_token: 'refresh' }, 'c'.repeat(43)) });
  await account.syncHealth();
  assert.equal((map.get('health:steps') as MetricState).status, 'reconnect');
});

test('a refreshed Google login is saved during a health sync', async () => {
  const { account, storage, map } = fixture({ HEALTH_METRICS: 'steps' });
  await storage.put('account', { tokens: await seal({ refresh_token: 'refresh', access_token: 'old', expiresAt: 0 }, baseEnv.TOKEN_KEY) });
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('oauth2') ? Response.json({ access_token: 'new', expires_in: 3600 }) : Response.json({});
  try { await account.syncHealth(); } finally { globalThis.fetch = original; }
  const { tokens } = map.get('account') as { tokens: Sealed };
  assert.equal((await unseal<{ access_token: string }>(tokens, baseEnv.TOKEN_KEY)).access_token, 'new');
});

test('with no account connected nothing is published or synced', async () => {
  const { account, storage } = fixture({ HEALTH_METRICS: 'steps' });
  await storage.put('health:steps', { days: { '2026-10-27': 9000 }, syncedAt: 1, status: 'ok' });
  const body = await (await account.fetch(request('/health.json?feed=my-pulse'))).json<HealthBody>();
  assert.deepEqual(body.metrics, {});
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try { await account.syncHealth(); } finally { globalThis.fetch = original; }
  assert.equal(calls, 0);
});

async function reconnect(healthUserId: string | undefined, setup: (storage: DurableObjectStorage) => Promise<void>) {
  const { account, storage, map } = fixture({ HEALTH_METRICS: 'steps' });
  await storage.put('pending', { state: 's', verifier: 'v', browser: 'b', expires: Date.now() + 60000, origin: 'https://pulse.example' });
  await storage.put('health:steps', { days: { '2026-10-27': 9000 }, syncedAt: now, status: 'reconnect', nextRun: now + HOUR });
  await setup(storage as unknown as DurableObjectStorage);
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('oauth2') ? Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) : Response.json(String(url).includes('identity') ? { healthUserId } : {});
  try { await account.fetch(request('/callback?state=s&code=c', { headers: { Cookie: 'pulse_auth=b' } })); } finally { globalThis.fetch = original; }
  return map;
}

test('a different Google account starts empty; the same one keeps its history', async () => {
  const signedInAs = (id: string) => async (storage: DurableObjectStorage) => { await storage.put('account', { tokens: await seal({ refresh_token: 'old' }, baseEnv.TOKEN_KEY), owner: await digest(id) }); };
  assert.equal((await reconnect('b', signedInAs('a'))).has('health:steps'), false);
  assert.equal((await reconnect('a', signedInAs('a'))).has('health:steps'), true);
  // Connected before owners were recorded: nothing to compare yet, so the next reconnect can tell.
  const legacy = await reconnect('a', async () => {});
  assert.equal(legacy.has('health:steps'), true);
  assert.equal((legacy.get('account') as { owner: string }).owner, await digest('a'));
});

test('reconnecting keeps history and queues every metric to sync again', async () => {
  const { account, storage, map } = fixture({ HEALTH_METRICS: 'steps' });
  await storage.put('pending', { state: 's', verifier: 'v', browser: 'b', expires: Date.now() + 60000, origin: 'https://pulse.example' });
  await storage.put('health:steps', { days: { '2026-10-27': 9000 }, syncedAt: now, status: 'reconnect', nextRun: now + HOUR });
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('oauth2') ? Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) : Response.json({});
  try { await account.fetch(request('/callback?state=s&code=c', { headers: { Cookie: 'pulse_auth=b' } })); } finally { globalThis.fetch = original; }
  const state = map.get('health:steps') as MetricState;
  assert.deepEqual(state, { days: { '2026-10-27': 9000 }, syncedAt: now, status: 'reconnect', nextRun: 0 });
  assert.equal(dueMetric(['steps'], { steps: state }, now), 'steps');
});

test('connecting asks only for the scopes the metrics need; disconnect always clears them', async () => {
  for (const [extra, expected] of [[{}, 1], [{ HEALTH_METRICS: 'restingHeartRate' }, 1], [{ HEALTH_METRICS: 'steps' }, 2], [{ HEALTH_METRICS: 'vo2Max,sleep' }, 3]] as const) {
    const { account, storage, map } = fixture(extra);
    await storage.put('session', { hash: await digest('session'), expires: Date.now() + 60000 });
    const headers = { Origin: 'https://pulse.example', Cookie: 'pulse_session=session' };
    const res = await account.fetch(request('/connect', { method: 'POST', headers }));
    assert.equal(new URL(res.headers.get('Location')!).searchParams.get('scope')!.split(' ').length, expected);
    await storage.put('health:steps', { days: { '2026-10-27': 1 } });
    await account.fetch(request('/disconnect', { method: 'POST', headers }));
    // Cleared even with health off, in case it was switched off after syncing.
    assert.equal(map.has('health:steps'), false);
  }
});
