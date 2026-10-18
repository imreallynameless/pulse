import { createRelay } from './relay.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/embed.html', ['embed.html', 'text/html']],
  ['/embed.mjs', ['embed.mjs', 'text/javascript']],
  ['/embed.css', ['embed.css', 'text/css']],
  ['/broadcast.mjs', ['broadcast.mjs', 'text/javascript']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/heart-rate.mjs', ['heart-rate.mjs', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']]
]);
const port = Number(process.env.PORT || 4317);
const host = process.env.HOST || '127.0.0.1';
const feeds = JSON.parse(process.env.PULSE_FEEDS || '{}');
if (!feeds || typeof feeds !== 'object' || Array.isArray(feeds) || Object.entries(feeds).some(([slug, token]) => !/^[a-z0-9-]{1,64}$/.test(slug) || typeof token !== 'string' || token.length < 32)) {
  throw new Error('PULSE_FEEDS must map lowercase feed slugs to private tokens of at least 32 characters. Run npm run setup.');
}
const server = createServer(async (req, res) => {
  const file = files.get(req.url?.split('?')[0]);
  if (host === '127.0.0.1' && req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    res.writeHead(403).end('Invalid host'); return;
  }
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(new URL(`web/${file[0]}`, import.meta.url));
    res.writeHead(200, {
      'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors ${file[0] === 'embed.html' ? '*' : "'none'"}; base-uri 'none'`,
      'Permissions-Policy': 'bluetooth=(self)'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500).end('Unable to load page'); }
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
createRelay(server, feeds);
server.listen(port, host, () => console.log(`Pulse local tester: http://127.0.0.1:${port} — open in Chrome`));
