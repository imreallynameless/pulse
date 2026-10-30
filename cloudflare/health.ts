// Daily health summaries for the optional /health.json feed. Off unless the
// owner lists metrics in HEALTH_METRICS; heart rate never depends on this file.
export type SleepNight = { asleep: number; deep?: number; light?: number; rem?: number; awake?: number };
export type HealthValue = number | SleepNight;
export type MetricStatus = 'ok' | 'pending' | 'reconnect' | 'error';
export interface MetricState { days: Record<string, HealthValue>; syncedAt?: number; status?: MetricStatus; failures?: number; nextRun?: number }
export type Google = <T>(url: string | URL, options?: RequestInit) => Promise<T>;
// Parsed values carry an order so a day keeps its latest weigh-in or longest sleep.
type Parsed = [day: string, value: HealthValue, order: number] | null;
type GoogleDate = { year?: number; month?: number; day?: number };
type Point = Record<string, any>;
interface Metric { dataType: string; unit: string; method: 'rollup' | 'list' | 'reconcile'; filter?: (since: string) => string; parse: (point: Point) => Parsed }

export const HOUR = 3600000;
const DAY = 86400000;
const KEEP_DAYS = 365;
const MAX_PAGES = 20;
const API = 'https://health.googleapis.com/v4/users/me/dataTypes/';
export const scopes = ['health_metrics_and_measurements', 'activity_and_fitness', 'sleep'].map(name => `https://www.googleapis.com/auth/googlehealth.${name}.readonly`);

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function civilDate(date: GoogleDate | undefined) {
  if (!date?.year || !date.month || !date.day) return null;
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
const toGoogleDate = (iso: string) => { const [year, month, day] = iso.split('-').map(Number); return { year, month, day }; };
const finite = (value: unknown, min: number, max: number) => { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
// A daily type: one point per date, so later sources simply win the merge.
function daily(field: string, read: (value: Point) => number | null): (point: Point) => Parsed {
  return point => {
    const day = civilDate(point[field]?.date), value = point[field] && read(point[field]);
    return day && value !== null && value !== undefined ? [day, value, 0] : null;
  };
}

export const METRICS: Record<string, Metric> = {
  steps: { dataType: 'steps', unit: 'steps', method: 'rollup', parse: point => {
    const day = civilDate(point.civilStartTime?.date), value = finite(point.steps?.countSum, 0, 1000000);
    return day && value !== null ? [day, value, 0] : null;
  } },
  activeZoneMinutes: { dataType: 'active-zone-minutes', unit: 'min', method: 'rollup', parse: point => {
    const day = civilDate(point.civilStartTime?.date), azm = point.activeZoneMinutes;
    if (!day || !azm) return null;
    const value = ['sumInFatBurnHeartZone', 'sumInCardioHeartZone', 'sumInPeakHeartZone'].reduce((sum, zone) => sum + (finite(azm[zone], 0, 1440) ?? 0), 0);
    return [day, value, 0];
  } },
  restingHeartRate: { dataType: 'daily-resting-heart-rate', unit: 'bpm', method: 'list', parse: daily('dailyRestingHeartRate', v => finite(v.beatsPerMinute, 20, 250)) },
  hrv: { dataType: 'daily-heart-rate-variability', unit: 'ms', method: 'list', parse: daily('dailyHeartRateVariability', v => { const n = finite(v.averageHeartRateVariabilityMilliseconds, 1, 500); return n === null ? null : round(n); }) },
  oxygenSaturation: { dataType: 'daily-oxygen-saturation', unit: '%', method: 'list', parse: daily('dailyOxygenSaturation', v => { const n = finite(v.averagePercentage, 50, 100); return n === null ? null : round(n); }) },
  respiratoryRate: { dataType: 'daily-respiratory-rate', unit: 'br/min', method: 'list', parse: daily('dailyRespiratoryRate', v => { const n = finite(v.breathsPerMinute, 1, 60); return n === null ? null : round(n); }) },
  // Fitbit shows skin temperature as the change from your own baseline, not a raw reading.
  skinTemperature: { dataType: 'daily-sleep-temperature-derivations', unit: '°C', method: 'list', parse: daily('dailySleepTemperatureDerivations', v => {
    const nightly = finite(v.nightlyTemperatureCelsius, 20, 45), baseline = finite(v.baselineTemperatureCelsius, 20, 45);
    return nightly === null || baseline === null ? null : round(nightly - baseline, 2);
  }) },
  vo2Max: { dataType: 'daily-vo2-max', unit: 'ml/kg/min', method: 'list', parse: daily('dailyVo2Max', v => { const n = finite(v.vo2Max, 5, 100); return n === null ? null : round(n); }) },
  weight: { dataType: 'weight', unit: 'kg', method: 'list', filter: since => `weight.sample_time.physical_time >= "${since}T00:00:00Z"`, parse: point => {
    const day = civilDate(point.weight?.sampleTime?.civilTime?.date), kg = finite(point.weight?.weightGrams, 1000, 1000000), at = Date.parse(point.weight?.sampleTime?.physicalTime || '');
    return day && kg !== null ? [day, round(kg / 1000), Number.isFinite(at) ? at : 0] : null;
  } },
  // Sleep counts toward the morning you wake up; naps are left out. Google may send
  // only stage times, so totals fall back to adding those up.
  sleep: { dataType: 'sleep', unit: 'min', method: 'reconcile', filter: since => `sleep.interval.civil_end_time >= "${since}"`, parse: point => {
    const sleep = point.sleep, interval = sleep?.interval, ended = Date.parse(interval?.endTime || '');
    if (!Number.isFinite(ended) || sleep.metadata?.nap) return null;
    const day = isoDate(ended + (parseInt(interval.endUtcOffset) || 0) * 1000), totals: Record<string, number> = {};
    for (const stage of sleep.stages || []) {
      const name = String(stage.type || '').toLowerCase(), minutes = (Date.parse(stage.endTime) - Date.parse(stage.startTime)) / 60000;
      if (minutes > 0) totals[name] = (totals[name] || 0) + minutes;
    }
    for (const stage of sleep.summary?.stagesSummary || []) {
      const minutes = finite(stage.minutes, 0, 1440);
      if (minutes !== null) totals[String(stage.type || '').toLowerCase()] = minutes;
    }
    const asleep = finite(sleep.summary?.minutesAsleep ?? Object.entries(totals).reduce((sum, [name, minutes]) => name === 'awake' || name === 'restless' ? sum : sum + minutes, 0), 1, 1440);
    if (asleep === null) return null;
    const night: SleepNight = { asleep: Math.round(asleep) };
    for (const name of ['deep', 'light', 'rem', 'awake'] as const) if (name in totals) night[name] = Math.round(totals[name]);
    return [day, night, asleep];
  } },
};

export function configuredMetrics(value: string | undefined) {
  return [...new Set((value || '').split(',').map(key => key.trim()).filter(key => Object.hasOwn(METRICS, key)))];
}

// One metric per cron tick keeps each run small; a metric is due hourly, or
// sooner when it has never synced.
export function dueMetric(keys: string[], states: Record<string, MetricState | undefined>, now: number) {
  return keys.find(key => { const state = states[key]; return !state?.syncedAt && !state?.nextRun ? true : now >= (state.nextRun ?? state.syncedAt! + HOUR); });
}

async function fetchPoints(metric: Metric, since: string, today: string, google: Google) {
  const points: Point[] = [];
  if (metric.method === 'rollup') {
    // dailyRollUp accepts at most 90 days per request. The end runs two days past
    // the UTC date so every timezone's "today" is covered.
    const end = Date.parse(today) + 2 * DAY;
    for (let start = Date.parse(since); start < end; start += 90 * DAY) {
      const range = { start: { date: toGoogleDate(isoDate(start)) }, end: { date: toGoogleDate(isoDate(Math.min(start + 90 * DAY, end))) } };
      const data = await google<{ rollupDataPoints?: Point[] }>(`${API}${metric.dataType}/dataPoints:dailyRollUp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range, windowSizeDays: 1, pageSize: 100 }) });
      points.push(...data.rollupDataPoints || []);
    }
    return points;
  }
  const url = new URL(`${API}${metric.dataType}/dataPoints${metric.method === 'reconcile' ? ':reconcile' : ''}`);
  // Sleep can't be filtered by source family; reconcile merges sources itself.
  if (metric.method === 'list') url.searchParams.set('dataSourceFamily', 'users/me/dataSourceFamilies/all-sources');
  url.searchParams.set('pageSize', metric.method === 'reconcile' ? '25' : '1000');
  if (metric.filter) url.searchParams.set('filter', metric.filter(since));
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const data = await google<{ dataPoints?: Point[]; nextPageToken?: string }>(url);
    points.push(...data.dataPoints || []);
    if (!data.nextPageToken) break;
    url.searchParams.set('pageToken', data.nextPageToken);
  }
  return points;
}

export function mergeDays(stored: Record<string, HealthValue>, parsed: Parsed[], since: string, now: number) {
  const days = { ...stored }, order: Record<string, number> = {}, cutoff = isoDate(now - KEEP_DAYS * DAY);
  for (const entry of parsed) {
    if (!entry) continue;
    const [day, value, rank] = entry;
    if (day < since || day < cutoff) continue;
    if (day in order && order[day] >= rank) continue;
    order[day] = rank; days[day] = value;
  }
  for (const day of Object.keys(days)) if (day < cutoff) delete days[day];
  return days;
}

export async function syncMetric(key: string, state: MetricState | undefined, google: Google, now: number): Promise<MetricState> {
  const metric = METRICS[key], today = isoDate(now);
  // Backfill a year until something is stored, then re-read three days so late phone syncs land.
  const since = isoDate(now - (Object.keys(state?.days || {}).length ? 3 : KEEP_DAYS) * DAY);
  try {
    const parsed = (await fetchPoints(metric, since, today, google)).map(point => metric.parse(point));
    return { days: mergeDays(state?.days || {}, parsed, since, now), syncedAt: now, status: 'ok', failures: 0 };
  } catch (error) {
    // A 403 means this connection predates the scope; reconnecting fixes it.
    if ((error as { status?: number }).status === 403) return { ...state, days: state?.days || {}, status: 'reconnect', nextRun: now + HOUR };
    const failures = Math.min((state?.failures || 0) + 1, 8);
    return { ...state, days: state?.days || {}, status: 'error', failures, nextRun: now + Math.min(HOUR, 60000 * 2 ** (failures - 1)) };
  }
}

export function publicHealth(keys: string[], states: Record<string, MetricState | undefined>) {
  const metrics: Record<string, { unit: string; days: [string, HealthValue][] }> = {}, status: Record<string, MetricStatus> = {};
  let updatedAt = 0;
  for (const key of keys) {
    const state = states[key];
    status[key] = state?.status || 'pending';
    updatedAt = Math.max(updatedAt, state?.syncedAt || 0);
    const days = Object.entries(state?.days || {}).sort(([a], [b]) => a.localeCompare(b));
    if (days.length) metrics[key] = { unit: METRICS[key].unit, days };
  }
  return { updatedAt: updatedAt || null, metrics, status };
}
