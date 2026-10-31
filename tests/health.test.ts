import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, HOUR, configuredMetrics, dueMetric, mergeDays, publicHealth, syncMetric, type Google, type MetricState } from '../cloudflare/health.ts';
import { seal, digest } from '../cloudflare/security.ts';
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

test('one metric is due at a time: never-synced first, then hourly, errors after backoff', () => {
  const keys = ['steps', 'sleep'];
  assert.equal(dueMetric(keys, {}, now), 'steps');
  assert.equal(dueMetric(keys, { steps: { days: {}, syncedAt: now - 60000 } }, now), 'sleep');
  assert.equal(dueMetric(keys, { steps: { days: {}, syncedAt: now - 60000 }, sleep: { days: {}, syncedAt: now - 60000 } }, now), undefined);
  assert.equal(dueMetric(keys, { steps: { days: {}, syncedAt: now - HOUR }, sleep: { days: {}, syncedAt: now } }, now), 'steps');
  assert.equal(dueMetric(['steps'], { steps: { days: {}, status: 'error', nextRun: now + 1000 } }, now), undefined);
});

test('first sync backfills a year in 90-day rollups, later syncs re-read three days', async () => {
  const bodies: { range: { start: { date: unknown } } }[] = [];
  const google: Google = async <T,>(_url: string | URL, options?: RequestInit) => {
    bodies.push(JSON.parse(String(options?.body)));
    return { rollupDataPoints: [{ civilStartTime: { date: date('2026-10-27') }, steps: { countSum: '8000' } }] } as T;
  };
  const first = await syncMetric('steps', undefined, google, now);
  assert.equal(bodies.length, 5);
  assert.deepEqual(bodies[0].range.start.date, date('2025-10-28'));
  assert.deepEqual(first, { days: { '2026-10-27': 8000 }, syncedAt: now, status: 'ok', failures: 0 });
  bodies.length = 0;
  await syncMetric('steps', first, google, now + HOUR);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].range.start.date, date('2026-10-25'));
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
  assert.ok(!JSON.stringify(body).includes('private'));
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

test('connecting asks for the health scopes only when metrics are on; disconnect always clears them', async () => {
  for (const [extra, expected] of [[{}, 1], [{ HEALTH_METRICS: 'steps' }, 3]] as const) {
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
