import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const feed = process.argv[2] || 'my-pulse';
if (!/^[a-z0-9-]{1,64}$/.test(feed)) throw new Error('Use 1–64 lowercase letters, digits or hyphens for the feed name.');
const token = randomBytes(32).toString('hex');
try {
  await writeFile(new URL('../.env', import.meta.url), `PULSE_FEEDS=${JSON.stringify({ [feed]: token })}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Created private .env for feed ${feed}.\nRun npm start, then paste the token from .env into the broadcaster. Do not share or commit .env.`);
} catch (error) {
  if (error.code === 'EEXIST') console.error('.env already exists; kept your current configuration.');
  else throw error;
}
