import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readCloudSnapshot } from './cloud-snapshot.ts';
const files = new Map<string, [string,string]>([
  ['/fonts/Figtree-Variable.woff2', ['fonts/Figtree-Variable.woff2', 'font/woff2']],
  ['/fonts/Cabin-Variable.woff2', ['fonts/Cabin-Variable.woff2', 'font/woff2']],
  ['/', ['embed.html', 'text/html']],
  ['/embed.html', ['embed.html', 'text/html']],
  ['/embed.mjs', ['embed.mjs', 'text/javascript']],
  ['/cloud-embed.mjs', ['cloud-embed.mjs', 'text/javascript']],
  ['/embed.css', ['embed.css', 'text/css']],
]);
const port = Number(process.env.PORT || 4317);
const host = process.env.HOST || '127.0.0.1';
const cloudFeed = process.env.PULSE_CLOUD_FEED;
const server = createServer(async (req, res) => {
  const file = files.get((req.url||'/').split('?')[0]);
  if (host === '127.0.0.1' && req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    res.writeHead(403).end('Invalid host'); return;
  }
  if ((req.url||'/').split('?')[0] === '/cloud-reading' && req.method === 'GET') {
    const requested = new URL(req.url||'/', 'http://localhost').searchParams.get('feed');
    if (!cloudFeed || requested !== cloudFeed) { res.writeHead(404).end('Unknown feed'); return; }
    const value = await readCloudSnapshot(cloudFeed);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value)); return;
  }
  if (!file || !['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(new URL(`dist/${file[0]}`, import.meta.url));
    res.writeHead(200, {
      'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors ${file[0] === 'embed.html' ? '*' : "'none'"}; base-uri 'none'`,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500).end('Unable to load page'); }
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Pulse local tester: http://127.0.0.1:${port}`));
