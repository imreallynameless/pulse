# Set up your own Pulse

**Use Cloudflare for the ready-to-deploy version.** Your website can stay on any host; only the small Pulse service runs on Cloudflare.

You need a Google Health account with synced heart-rate data, a Google Cloud project eligible for the Health API, a Cloudflare account, and Node.js 22+. Each owner uses their own accounts. This is a latest-measurement widget, not a live stream.

## Give this to your coding agent

For the supported Cloudflare deployment, copy this prompt into your agent with your fork open:

> Set up this Pulse fork for my own Google Health account on Cloudflare. Read docs/CLOUDFLARE.md and follow its deployment steps. Ask me for the Worker name, public feed slug, and operator/contact details needed for the public pages. Use my own Google Cloud and Cloudflare accounts; never reuse the original author's deployment or credentials. Let me complete account sign-ins and Google consent. Configure the exact hosted /callback redirect and read-only Health scope. Generate separate random owner and encryption keys of at least 32 bytes and store credentials securely using Cloudflare secrets; never print secrets in chat, commit them, or put them in embed URLs. Explain that connecting publishes my latest BPM and measurement time. Run tests and a deployment dry run, deploy, and verify the widget and unknown-feed 404. Give me the owner URL, public iframe snippet, and instructions to stop sharing. Do not claim a live connection or verified Apple Watch support. If Google denies API access, explain the blocker rather than substituting someone else's account.

## Agent setup for other backends

AWS, Vercel, GCP, Azure and other servers are **porting targets**, not working deployment adapters in this repository. These prompts ask an agent to implement and verify the missing backend. Use Cloudflare above if you want the existing implementation.

Copy this common prompt, then append one provider instruction below:

> Adapt this Pulse fork to my selected backend. Read docs/CLOUDFLARE.md and inspect cloudflare/worker.ts, cloudflare/security.ts and the tests to preserve existing behavior. First explain the proposed services, storage, scheduling and expected costs. Implement the provider-specific runtime, durable storage, concurrency control, secrets and deployment configuration; do not treat the local tester as production-ready. Keep Google tokens encrypted, credentials out of source/chat/logs, and owner sessions, OAuth state/PKCE, origin checks and bounded request reads intact. Prevent overlapping refreshes or in-flight polls from restoring data after disconnect. Use my own Google OAuth client and exact hosted /callback URL; let me complete sign-ins and consent. Keep public access limited to static widget files and the sanitized reading endpoint. Preserve measurement age, retry backoff and stale status. Test authorization, refresh persistence across restarts, disconnect races and secret isolation. Deploy only to my selected account, verify a real reading and the embed, and document setup and removal. Clearly report any unverified behavior or API eligibility blocker. Never claim that a new host makes phone syncing real-time.

Append **one** of these:

- **AWS:** “Use Lambda with an HTTPS entry point, EventBridge Scheduler invoking the polling function through IAM, DynamoDB for durable account/session state, and Secrets Manager for credentials. Use conditional writes or a lease with version checks to coordinate polling and owner mutations across invocations. Include static asset hosting and infrastructure configuration.”
- **Vercel:** “Use Functions, a persistent database with transaction/locking support, and private environment secrets. Use an authenticated cron endpoint. Check my plan's scheduling limits first; Hobby's daily cron cannot provide minute-based checks. Explain a suitable plan or external scheduler before configuring it. Do not use process memory or temporary files for durable state.”
- **GCP:** “Use Cloud Run, Firestore or another transactional persistent store, Secret Manager, and Cloud Scheduler. Keep the scheduled polling target authenticated with a dedicated service identity. If the widget service is public, enforce scheduler authentication in the poll handler or use a separate private polling service; public service access must not expose polling controls. Include least-privilege IAM and deployment configuration.”
- **Azure:** “Use Azure Functions HTTP routes and a timer-triggered poll, persistent storage such as Cosmos DB with conditional updates, and Key Vault through a managed identity. Configure the timer's required host storage. Coordinate timer and HTTP owner mutations; the timer's own singleton behavior does not protect disconnect races. Keep public reading routes separate from authenticated owner controls.”
- **Other servers:** “Use a maintained Node.js runtime behind HTTPS, persistent storage with transactions or a single serialized mutation path, protected secret files or a secret manager, and a supervised polling schedule. Document process restart, backups, upgrades and removal. Do not expose an unauthenticated polling endpoint or reuse the memory-only local tester as the deployed service.”

## The short manual path (Cloudflare)

1. Fork and clone Pulse; run `npm ci` and `npx wrangler login`.
2. Choose your Worker name and feed in `wrangler.jsonc`. Customize `web/about.html` and `web/privacy.html` for your deployment.
3. Run `npm run deploy:cloud` to obtain the hosted URL. The owner page is unavailable until secrets are added.
4. Enable Google Health API in your Google Cloud project. Configure consent and a Web application OAuth client with `https://YOUR-PULSE-HOST/callback`. Add yourself as a test user if the app is in Testing.
5. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_KEY` and `TOKEN_KEY` using `npx wrangler secret put NAME`. Generate distinct random owner and encryption keys; save them privately.
6. Open your hosted URL, unlock with the owner key, and connect Google Health. Verify a reading, then copy the [README iframe](../README.md#put-it-on-your-website) with your own host/feed.

The [full Cloudflare guide](CLOUDFLARE.md) includes the exact scope, commands, privacy details and production OAuth setup. Testing authorizations generally expire after seven days; production publishing and Google verification are separate processes. Never paste credentials into your website.

No reading yet? Sync your device with Google Health. The first fetch searches the last 24 hours. An old reading can mean phone or Google syncing is delayed; “Updates paused” means Pulse's recent checks are failing or late. Stop sharing on the owner page to clear the stored connection and reading.

## Can I use another provider?

**Your website host and Pulse's backend host are independent.** A website on Vercel, Netlify, GitHub Pages or your own server can embed the existing Cloudflare widget without a backend port.

For hosting Pulse itself, only Cloudflare is implemented and tested. These are possible porting targets, not deployment recipes:

| Backend | What a port needs |
| --- | --- |
| AWS Lambda | HTTP routes, EventBridge Scheduler, persistent storage such as DynamoDB, and secret storage. [Scheduler supports minute-based schedules](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html). |
| Vercel | Functions, a database, secrets, and an authenticated scheduled endpoint. [Hobby cron is limited to daily runs](https://vercel.com/docs/cron-jobs/usage-and-pricing), so minute-based updates need a suitable plan or external scheduler. |
| GCP | Cloud Run, persistent storage, Secret Manager and [Cloud Scheduler with authenticated invocation](https://docs.cloud.google.com/run/docs/triggering/using-scheduler). Keep the polling target private or validate its scheduler identity explicitly. |
| Azure | HTTP-triggered Functions, persistent account storage, Key Vault and a [timer trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer?tabs=javascript). Use [managed identities](https://learn.microsoft.com/en-us/azure/azure-functions/manage-connections) where supported. |
| Other servers | A persistent HTTPS service, database and scheduler, plus backups and process supervision. The local tester is not a production server replacement. |

Every port must replace Cloudflare Durable Object storage and serialization, scheduled triggers, secrets and static asset bindings. Keep encrypted tokens across restarts, serialize token refresh/disconnect operations, authenticate owner actions and cron calls, preserve OAuth state/PKCE, and expose only the sanitized snapshot. Changing hosts does not speed up phone-to-Google syncing.

Provider capabilities and pricing can change; check the linked documentation before choosing. The MIT license permits adapting Pulse; retain the license notice and font licenses.
