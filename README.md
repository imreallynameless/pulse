# Pulse ♥

Your heart rate, on your website. Embed your latest Google Health measurement with its age, or stream directly from a Fitbit Air over Bluetooth.

**For a widget that works away from your Mac:** follow the [Cloudflare setup guide](docs/CLOUDFLARE.md). Each fork uses its owner’s Google and Cloudflare accounts. Cloud mode checks once a minute and keeps authorization securely across restarts.

**Early working prototype.** A real Fitbit Air connected on a Mac and delivered 115 readings at roughly 1 Hz: median interval 1,020 ms, p95 1,022 ms, longest gap 1,089 ms in that initial short session. RR intervals and sensor contact were not observed. These are notification intervals, not physiological latency. A subsequent session also delivered readings through the local relay to a cross-origin iframe; stopping sharing cleared the widget. Its largest observed notification gap was 1,343 ms. Long-duration reliability and public-internet delivery latency remain unverified.

## Run locally

Requires **Node.js 22+** and **Chrome on your Mac**. Safari can view the widget but does not natively support the Bluetooth broadcaster.

```sh
git clone https://github.com/imreallynameless/pulse.git
cd pulse
npm ci
npm run setup
npm start
```

Open **http://127.0.0.1:4317** in Chrome.

1. Wear your Fitbit Air near your Mac.
2. On your phone, open **Google Health → Connections → Fitbit Air → Share heart rate → Get started**. Confirm any pairing/sharing prompts.
3. Click **Connect Fitbit**, select your Air, and allow Chrome Bluetooth access if macOS asks. Wait for actual BPM readings; a successful connection alone does not prove data is streaming.
4. In the sharing section, use feed name `my-pulse`. Copy its private token from the generated `.env` file into the password field.
5. Click **Start sharing**, then **Open widget preview**. This tests Bluetooth → local relay → widget on your Mac.
6. **Stop sharing** ends the feed. **Disconnect** also stops sharing. Closing the page or losing Bluetooth stops broadcasting.

Readings remain in the browser until you explicitly start sharing. A new subscription starts fresh diagnostic data. The Mac must stay awake and Chrome must keep running. Sharing is never automatically started on page load or after a relay disconnection.

## Embed on a website

Deploy Pulse to an HTTPS domain first—localhost is only reachable on your own computer. Open the broadcaster at that deployed address, connect your Fitbit, and start sharing. Its **Copy embed code** button creates a snippet like:

```html
<iframe
  src="https://pulse.example.com/embed.html?feed=my-pulse"
  title="Heart rate"
  width="320"
  height="112"
  style="border:0;width:100%"
  loading="lazy"
></iframe>
```

Visitors only see the read-only widget; they do not need Bluetooth or a Fitbit account. Never put the private publishing token in embed code or URLs. The feed is public to anyone with its address. The widget shows live, waiting, stale, offline, or unavailable states. It has no simulated ECG or heartbeat animation.

See **[self-hosting instructions](docs/SELF_HOSTING.md)** for Docker, HTTPS, multiple feeds and secret management.

## How it works

`Fitbit Air → Bluetooth notification → Chrome broadcaster → WebSocket relay → iframe widget`

The relay forwards each incoming notification immediately, even if BPM is unchanged. It keeps only the latest value per feed in memory, expires it after 5 seconds, and clears it when the publisher disconnects. Viewers reconnect automatically. Publishers explicitly restart sharing after a lost relay connection. Slow viewers are disconnected instead of accumulating an old-data queue. No database or Google cloud API is on the live path.

Each feed has its own private publishing token. Viewer connections cannot publish. Only one broadcaster may own a feed at a time. There is no hosted signup/account system in this version; owners configure feeds on their server.

## Connection diagnostics

The broadcaster displays median, p95 and maximum **notification intervals** plus optional RR intervals and contact detection. These are receipt timings, not sensor-processing or internet delivery latency. The proposed sub-500 ms p95 added-delay target is not a measured result.

Up to 10,000 readings are retained in browser memory. **Download test data** explicitly exports local JSON containing BPM and timestamps, with no Bluetooth identifier. Keep this private; do not attach personal recordings to public issues. No raw recordings belong in the repository.

## Troubleshooting

- Enable sharing again if the Air is missing, and close other apps or fitness equipment using its heart-rate feed.
- Check **System Settings → Privacy & Security → Bluetooth → Google Chrome**.
- Cancel the picker and try **Show all nearby devices** if the standard heart-rate filter fails. Select your own Air.
- If connected but waiting, check the phone for pairing/sharing confirmation. In our first test, notifications started after sharing was confirmed.
- A stale widget means no fresh measurement has arrived for 5 seconds. It deliberately clears the number.
- A browser cannot stream while your computer sleeps. Native companion apps and longer reliability testing are future work.

## Fork, customize, contribute

Click GitHub's **Fork** button, clone your fork, then use the setup steps above. Generate your own `.env`; never copy somebody else's publishing token. Change the broadcaster in `web/`, and the widget in `web/embed.html`, `web/embed.css`, and `web/embed.mjs`. Refresh the browser; there is no build step.

```sh
npm test
```

Tests cover BLE decoding, connection races, feed isolation, authentication, repeated values, expiry and disconnection. GitHub Actions runs the suite. See [CONTRIBUTING.md](CONTRIBUTING.md).

**MIT licensed.** Forks, modifications and commercial use are permitted; retain the license and copyright notice. This independent project is not affiliated with Google or Fitbit.

## References

- [Google: share live heart rate](https://support.google.com/googlehealth/answer/14236705?hl=en)
- [Bluetooth Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
- [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Google Health data availability](https://developers.google.com/health/data-types#data_availability)

## Google Health cloud experiment

A Google Health connection can supply the widget with the latest measured BPM and its age. See [cloud setup](docs/CLOUD_TEST.md). Fitbit cloud access has been verified with real readings; Apple Health imports still need account-level testing.

Set `PULSE_CLOUD_FEED=my-pulse` in the environment of both the server and cloud connection process, then use `/embed.html?feed=my-pulse&source=cloud` as the iframe URL. This explicitly enables sharing the connected account's latest BPM and measurement timestamp. Disconnect on the connection page to clear the shared reading. The endpoint exposes no Google credentials, account details, source metadata, or history.

The widget refreshes the shared snapshot every five seconds and updates age every second. Google is polled every 30 seconds; that does not force the phone to sync. An old reading stays visible with its original age. Errors or no successful check for two minutes show “Updates paused.” The snapshot is stored with private file permissions in ignored `recordings/`; restarting the connection clears it. This local prototype requires the processes and Mac to remain running; use the [Cloudflare deployment](docs/CLOUDFLARE.md) for operation without the Mac. It has durable encrypted authorization and minute-based polling; webhooks are not implemented.

### Widget appearance

The compact, borderless widget uses Figtree for readings and Cabin for labels, lowercase text, and the portfolio's charcoal/lavender palette with red accents in light mode and yellow accents in dark mode. Its background is transparent so it sits on the host page. Fonts are self-hosted; their SIL Open Font Licenses are included in `web/fonts/` and remain separate from the source code's MIT license.

Add `&theme=light` or `&theme=dark` to match the host site's selected theme; otherwise the widget follows the device's color preference. An iframe does not inherit its parent's CSS or theme toggle, so the embedding site must update this parameter when its theme changes. Use an iframe around 320px wide and 112px high, with `border:0;width:100%`, allowing more height at unusually narrow sizes or enlarged text.
