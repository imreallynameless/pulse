# Private Google Health connection experiment

This is a local cloud connection prototype. It can share a latest-reading snapshot with the widget when explicitly configured. It does not implement webhooks or production account management.

1. In a development Google Cloud project, enable **Google Health API**.
2. Configure Google Auth Platform for external testing and add your Google Health account as a test user.
3. Add the read-only scope `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`. Google groups heart rate with other measurements; the tester only queries heart rate and linked identity.
4. Create a **Web application** OAuth client with authorized redirect URI `http://127.0.0.1:4318/callback`.
5. Download its credentials JSON to a private directory outside the repository. Do not paste it into chat or commit it.
6. Run `GOOGLE_CREDENTIALS_FILE='/absolute/path/to/credentials.json' node scripts/cloud-probe.mjs` and open `http://127.0.0.1:4318` in your system browser. Sign in with the same account used in the Google Health phone app.

The tester binds only to loopback. OAuth uses state, a browser-bound cookie and PKCE. Credentials remain on the server; OAuth tokens and observation history are memory-only. Stopping the process removes them. Disconnect locally clears them and the shared snapshot but does not revoke the Google grant; revoke that separately in your Google Account connections if desired.

## Supply the widget

Set `PULSE_CLOUD_FEED=my-pulse` for both processes (the cloud tester needs `node --env-file-if-exists=.env scripts/cloud-probe.mjs` to load `.env`). Run the web server and cloud connection from the same repository checkout. Connect Google on port 4318, then open `http://127.0.0.1:4317/embed.html?feed=my-pulse&source=cloud`.

This opt-in publishes only BPM and original measurement time via the web server. Anyone who can access that server and knows the feed URL can read them. The server reads an atomically replaced snapshot from ignored `recordings/cloud-latest.json`, created with owner-only permissions. An interrupted worker leaves the last measurement visible, marked “Updates paused” after two minutes; its age keeps increasing. Restarting the worker or disconnecting clears the shared snapshot. Keep the snapshot directory out of backups you intend to share. Both processes must remain running; this is not yet a Mac-independent deployment.

It queries all sources over the last 24 hours, follows pagination and selects the newest valid heart-rate measurement by its original physical timestamp. Apple Health imports are eligible, but actual availability on an account must be verified. A 30-second poll is for measurement only; production should use webhooks. Failed requests do not reset measurement age. Retry happens on the next fixed poll, so this short-lived experiment is not a production backoff implementation.

## Measure sync behavior

Keep the tester running and the Mac awake. Observe each scenario for at least 30 minutes: Google Health open on the phone, app in the background with the phone unlocked, and phone locked. Record scenario boundaries separately. First-seen age is an upper bound on availability latency, adding up to a polling interval plus request time in successful operation. The initial observation is historical and must not count as a latency sample. Later rows track only the newest sample in each observed batch, not every sample's latency. No precise latency claim should be made from this experiment alone.

Google setup: https://developers.google.com/health/setup

Data-point reference: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
