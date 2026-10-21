# Host Pulse on Cloudflare

This is a single-owner, self-hosted widget. Fork the MIT repository and use your own Cloudflare and Google accounts. There is no central Pulse signup service and no sharing of Google credentials between owners. Visitors need only an iframe.

## What runs where

Fitbit / supported Google Health sources → Google Health cloud → Cloudflare Worker → widget.

The phone and Google must sync the measurement first. Your Mac can be off. Cloudflare checks once per minute, the iframe requests the saved snapshot every five seconds, and the age advances every second. This adds roughly 0–65 seconds after a measurement becomes available in Google's API under normal successful scheduling/network conditions; it is not a guarantee or a device-to-website latency claim. No webhook is implemented.

Fitbit access was verified locally. Apple Watch data depends on Apple Health import into Google Health and API availability for that account; it is not yet verified by this project.

## Deploy your fork

1. Fork and clone this repository. Install Node.js 22+ and run `npm ci`.
2. Run `npx wrangler login`. Check `npx wrangler whoami` and select the intended account by exporting `CLOUDFLARE_ACCOUNT_ID` when you have several accounts.
3. Change `name` in `wrangler.jsonc` to your Worker name and `vars.FEED` to your public feed slug (lowercase letters, numbers, hyphens). The file contains no original owner's account ID or credentials. Before deploying your fork, customize `web/about.html` and `web/privacy.html` with your own operator name, contact address, deployment URL, and actual data practices.
4. Run `npm run deploy:cloud`. This creates a Worker, a SQLite Durable Object binding, static widget assets, and a once-per-minute cron trigger. Keep the printed HTTPS URL. The management page stays unavailable until secrets are configured.
5. In your Google Cloud project enable the Google Health API, configure the OAuth consent screen, and create a **Web application** OAuth client. Add `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/callback` as an authorized redirect URI. Use your actual URL, including the exact path. Add your Google account as a test user if the OAuth app is in Testing.
6. Configure the four secrets below with Wrangler's hidden interactive input. Keep them out of your shell command arguments, git, screenshots, and embed URLs.

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ADMIN_KEY
npx wrangler secret put TOKEN_KEY
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` come from that OAuth client. Generate **two different random values of at least 32 bytes** for `ADMIN_KEY` and `TOKEN_KEY`, using a password manager or a cryptographic random generator. Store them privately in your password manager. The owner key unlocks the management page. The token key encrypts stored Google tokens; replacing it makes the existing authorization unreadable and requires reconnecting Google.

7. Open the Worker URL, enter your owner key, and click **connect Google Health**. Complete Google's consent for the read-only health metrics scope. The page states that connecting publishes the latest BPM and measurement timestamp.
8. Open the widget preview, verify a real reading and its age, then embed it.

The requested scope is `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`. API eligibility and verification requirements are controlled by Google. Do not assume a shared public signup service is approved because a personal test account works.

## Embed

```html
<iframe
  src="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/embed.html?feed=my-pulse&source=cloud&theme=light"
  title="Latest measured heart rate and measurement age"
  width="480"
  height="112"
  style="display:block;border:0;width:100%;max-width:480px"
  loading="lazy"
  referrerpolicy="no-referrer"
></iframe>
```

Add `&layout=compact` for an 11px header-sized line with a short measurement age (for example, `7m ago`); use an iframe about 180px wide and 44px high.

Change `feed` to your configured slug. Set `theme=dark` for a dark host page, or omit it to follow the viewer's device. When the host's theme toggle changes, send `{ type: 'pulse:theme', theme: 'light' }` (or `'dark'`) using the iframe's `contentWindow.postMessage` with your Pulse origin as the target. Send the current theme on iframe load too. This preserves the reading without reloading the iframe. The widget uses transparent background, Figtree and Cabin, and includes their OFL licenses separately from the MIT source license. Allow more height for very narrow containers or enlarged text.

## Operation and privacy

- A single Durable Object stores encrypted Google authorization and one latest reading, not a measurement history. Cloudflare secrets hold the encryption key and client credentials. Cloudflare remains a trusted hosting provider with access to the running service.
- Public responses include only status, BPM, original measurement time, and server time. Anyone who knows the feed URL can read or copy those fields. Feed names are not passwords.
- Owner sessions expire after 24 hours. This does not stop background sharing. Enter the owner key again to manage it.
- **Stop sharing & disconnect** removes stored tokens, the reading, and pending sign-in. It does not revoke the app in Google's account settings; you can remove Google access there separately. It cannot retract readings already seen by others.
- Google apps in **Testing** generally have seven-day refresh-token expiry for this scope. Reconnect when authorization expires. Production publishing/verification is a separate Google process, not something this deployment bypasses.
- The first fetch searches the past 24 hours. After catching up, new fetches start five minutes before the latest measurement, looking back no more than 24 hours. Each poll reads up to six pages and saves any remaining pagination progress for the next poll. Once a reading is found it is retained with its original age, including across restarts, until replaced or sharing is stopped.
- Failures retain the previous reading and show **Updates paused**. Retry delay grows from one minute up to five minutes. A successful check resets the delay. A connection that has not checked successfully in two minutes is also marked paused. A newly connected account without data shows Waiting.
- Built-in Worker observability is disabled to avoid recording OAuth callback URLs. Do not enable request logging or attach private health recordings to public issues without reviewing what they contain.
- Check Cloudflare's current quotas and charges for Workers, Durable Objects and storage. Every visible widget polls every five seconds; traffic grows with concurrent visitors. This is a personal-site architecture, not an unlimited hosted service.

## Updates and checks

```sh
npm test
npm run build:cloud
npx wrangler deploy --dry-run
npm run deploy:cloud
```

Only allowlisted widget files are copied to `dist/` and uploaded. The secret files, local recordings and local tester are not deployed. Keep `migrations` history in `wrangler.jsonc`; do not remove or rename the Durable Object class when updating an existing deployment.

After deployment check `/cloud-reading?feed=YOUR-FEED`, verify that an unrecognized feed returns 404, and test the iframe in light and dark mode. Keep credentials server-side. Never place an owner key, Google token or client secret in your public website.

References: [Google Health setup](https://developers.google.com/health/setup), [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Cloudflare cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/).

## Moving a personal deployment out of Testing

Set a public homepage and privacy-policy link on Google Auth Platform → Branding. This deployment supplies `/about.html` and `/privacy.html`. Save the configuration, then use Audience → Publish app. Publishing and Google verification are separate states: personal-use exceptions may apply, while broader distribution of restricted scopes can require review. Follow the requirements Google shows for your project.

After the publishing status reads **In production**, reconnect from the owner page to obtain authorization issued in production. Do not assume a token issued during Testing has had its seven-day expiry removed. Production refresh tokens can still be revoked or expire for other reasons. Keep development and production OAuth clients/projects separate according to Google's guidance.
