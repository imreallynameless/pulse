// Local connection experiment; not a production OAuth server or public widget.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { writeCloudSnapshot } from '../cloud-snapshot.mjs';

const origin = 'http://127.0.0.1:4318';
const redirect = `${origin}/callback`;
const scope = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';
const credentialPath = process.env.GOOGLE_CREDENTIALS_FILE;
const cloudFeed = process.env.PULSE_CLOUD_FEED;
if (cloudFeed && !/^[a-z0-9-]{1,64}$/.test(cloudFeed)) throw new Error('Invalid cloud feed name');
async function publishSnapshot() {
  if (cloudFeed) await writeCloudSnapshot({ feed: cloudFeed, sharing: Boolean(tokens), latest, checkedAt, error: Boolean(error) });
}
let credentials;
if (credentialPath) {
  const json = JSON.parse(await readFile(credentialPath, 'utf8'));
  credentials = json.web;
  if (!credentials?.client_id || !credentials?.client_secret) throw new Error('Use a Web application OAuth credentials JSON.');
}
let tokens, pending, session, latest, checkedAt, error, busy = false;
const observations = [];
const random = () => randomBytes(32).toString('base64url');

async function googleJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) {
    // Do not echo upstream responses, which can contain private identifiers.
    throw new Error(`Google request failed (${response.status}). Check API enablement, consent, and account linking.`);
  }
  return data;
}
async function tokenRequest(fields) {
  const data = await googleJson('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ client_id: credentials.client_id, client_secret: credentials.client_secret, ...fields })
  });
  if (!data.access_token) throw new Error('Google did not return an access token.');
  return { ...data, expiresAt: Date.now() + data.expires_in * 1000 };
}
async function api(url) {
  if (tokens.expiresAt < Date.now() + 60000) {
    if (!tokens.refresh_token) throw new Error('Please reconnect to Google.');
    tokens = { ...tokens, ...await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }) };
  }
  return googleJson(url, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
}
async function poll() {
  if (!tokens || busy) return;
  busy = true;
  try {
    const now = Date.now();
    const url = new URL('https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints');
    url.searchParams.set('dataSourceFamily', 'users/me/dataSourceFamilies/all-sources');
    url.searchParams.set('pageSize', '10000');
    url.searchParams.set('filter', `heart_rate.sample_time.physical_time >= "${new Date(now - 86400000).toISOString()}" AND heart_rate.sample_time.physical_time < "${new Date(now).toISOString()}"`);
    let newest = null, pages = 0;
    do {
      const data = await api(url);
      for (const point of data.dataPoints || []) {
        const bpm = Number(point.heartRate?.beatsPerMinute);
        const measuredAt = Date.parse(point.heartRate?.sampleTime?.physicalTime);
        if (!Number.isInteger(bpm) || bpm < 1 || bpm > 300 || !Number.isFinite(measuredAt) || measuredAt > now) continue;
        if (!newest || measuredAt > newest.measuredAt) newest = { bpm, measuredAt, source: point.dataSource?.platform || 'Unspecified' };
      }
      url.searchParams.set('pageToken', data.nextPageToken || '');
      if (++pages >= 30 && data.nextPageToken) throw new Error('Too many pages; latest reading could not be established.');
    } while (url.searchParams.get('pageToken'));
    checkedAt = Date.now();
    error = null;
    if (newest && (!latest || newest.measuredAt > latest.measuredAt)) {
      latest = { ...newest, firstSeenAt: checkedAt };
      observations.push(latest);
      if (observations.length > 1000) observations.shift();
    }
  } catch (e) { error = e.message; }
  finally {
    try { await publishSnapshot(); } catch { error = 'Unable to update the widget snapshot.'; }
    busy = false;
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // Keep same-origin POST Origin headers while withholding referrers from Google.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'");
  const send = (status, body, type = 'text/plain') => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` }); res.end(body); };
  if (req.headers.host !== '127.0.0.1:4318') return send(403, 'Invalid host');
  const url = new URL(req.url, origin);
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(200, await readFile(new URL('./cloud-probe.html', import.meta.url), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/ui.mjs') {
      return send(200, await readFile(new URL('./cloud-probe-ui.mjs', import.meta.url), 'utf8'), 'text/javascript');
    }
    if (req.method === 'POST' && url.pathname === '/connect') {
      if (req.headers.origin !== origin) return send(403, 'Invalid origin');
      if (!credentials) return send(503, 'OAuth credentials not configured. See docs/CLOUD_TEST.md.');
      pending = { state: random(), verifier: random(), browser: random(), expires: Date.now() + 600000 };
      res.setHeader('Set-Cookie', `pulse_auth=${pending.browser}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({ client_id: credentials.client_id, redirect_uri: redirect, response_type: 'code', scope, state: pending.state, access_type: 'offline', prompt: 'consent', code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      res.writeHead(303, { Location: auth.href }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      if (!pending || pending.expires < Date.now() || cookies.pulse_auth !== pending.browser || url.searchParams.get('state') !== pending.state) return send(403, 'Expired or invalid sign-in. Return to the tester and reconnect.');
      const attempt = pending; pending = null;
      if (!url.searchParams.get('code')) return send(400, 'Permission was not granted. Return to the tester to retry.');
      tokens = await tokenRequest({ code: url.searchParams.get('code'), code_verifier: attempt.verifier, grant_type: 'authorization_code', redirect_uri: redirect });
      try { await api('https://health.googleapis.com/v4/users/me/identity'); }
      catch (e) { tokens = null; throw e; }
      session = random(); latest = null; observations.length = 0; error = null; checkedAt = null;
      await publishSnapshot();
      res.setHeader('Set-Cookie', `pulse_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
      res.writeHead(303, { Location: '/' }); res.end();
      void poll(); return;
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      const authorized = Boolean(session && cookies.pulse_session === session);
      return send(200, JSON.stringify({ configured: Boolean(credentials), connected: authorized && Boolean(tokens), ...(authorized ? { latest, checkedAt, error, observations, cloudFeed } : {}) }), 'application/json');
    }
    if (req.method === 'POST' && url.pathname === '/disconnect') {
      if (req.headers.origin !== origin || !session || cookies.pulse_session !== session) return send(403, 'Invalid session');
      if (busy) return send(409, 'A check is finishing. Please retry shortly.');
      tokens = null; session = null; latest = null; observations.length = 0;
      await publishSnapshot();
      res.setHeader('Set-Cookie', 'pulse_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      res.writeHead(303, { Location: '/' }); return res.end();
    }
    send(404, 'Not found');
  } catch (e) { send(502, e.message); }
});
setInterval(() => void poll(), 30000).unref();
await publishSnapshot();
server.listen(4318, '127.0.0.1', () => console.log(`Private cloud tester: ${origin} (credentials ${credentials ? 'configured' : 'needed'})`));
