# Pulse ♥

A direct Bluetooth heart-rate feed, starting with Fitbit Air. The goal is a small live widget anyone can embed on their website.

**Current stage: local connection tester.** The relay and embeddable widget are not implemented yet. Real Fitbit Air compatibility and cadence must be verified on hardware before proceeding. No account, API key, or Google cloud sync is needed for the tester.

## Try it on your Mac

Requires **Node.js 22+** and **Google Chrome**. Safari does not natively support Web Bluetooth.

```sh
git clone https://github.com/imreallynameless/pulse.git
cd pulse
npm start
```

Open **http://127.0.0.1:4317** in Chrome. There are no packages to install.

1. Wear your Fitbit Air and keep it near your Mac.
2. On your phone, open **Google Health → Connections → Fitbit Air → Share heart rate → Get started**.
3. Click **Connect Fitbit**, select your tracker and pair. Allow Chrome Bluetooth access if macOS prompts you.
4. Keep the Mac awake and observe the readings. The tester reports notification intervals, repeated values, optional RR intervals and contact detection.
5. Click **Disconnect** when finished. **Download test data** exports a local JSON file if you want to examine the measurements.

The app never simulates readings. It clears the current BPM after 5 seconds without a valid packet and immediately upon disconnect. This 5-second threshold is provisional pending device testing. Contact loss is shown if the device provides that information.

### If the tracker does not appear

- Enable heart-rate sharing again and keep your Air nearby.
- Close other apps or fitness equipment using the heart-rate connection.
- Check **System Settings → Privacy & Security → Bluetooth → Google Chrome**.
- Cancel the picker, enable **Show all nearby devices**, and retry. Select only your own Air; this fallback asks for access to its heart-rate service even if its advertisement omits that service.
- A secure browser context is required: localhost works for development; a hosted receiver will require HTTPS.
- A browser tab cannot promise continuous operation while your Mac sleeps. Native companion support is planned if needed.

## What the measurements mean

- **Typical interval:** median time between incoming notifications, using the nearest-rank percentile.
- **95th percentile:** 95% of observed intervals were at or below this value.
- **Longest interval:** largest observed gap in the retained session window.
- **Beat intervals:** RR intervals supplied by the tracker, if present. Not assumed to be supported by Air.

These are Bluetooth **receipt timings**, not sensor-processing latency or website delivery latency. The tracker may internally filter readings. A BPM-driven animation would not represent exact beat timing.

The tester retains up to 10,000 readings and 9,999 intervals in browser memory. Each new subscription begins a fresh session. Export before reconnecting to retain the old session.

## Privacy

No analytics, remote fonts, cloud requests, persistent browser storage or automatic uploads. The Node server binds only to 127.0.0.1 and serves an explicit allowlist of static files. Heart-rate readings stay in the browser unless you explicitly download them. Export files include readings and timestamps, but no Bluetooth device identifier. Do not attach private recordings to public issues.

## Roadmap

- [x] Local Bluetooth tester with tested packet decoding and freshness states.
- [ ] Validate cadence, RR fields, reconnect behavior and sustained operation on a real Fitbit Air.
- [ ] Authenticated real-time relay with separate publishing and viewing permissions.
- [ ] Read-only iframe widget with live/stale/offline states and copyable embed code.
- [ ] Self-hosting deployment instructions and multi-user feeds.
- [ ] Measure receiver-to-widget latency. A sub-500 ms p95 added-delay target is a goal, not an established result.

## Fork and contribute

Use GitHub's **Fork** button to create your own copy, then clone your fork and run `npm start`. You can change the UI in `web/` without a build step. Refresh Chrome after editing.

```sh
npm test
```

Tests cover 8/16-bit heart-rate packets, optional fields, malformed data, timing summaries and stale/offline behavior. The repository includes a GitHub Actions test workflow. Read [CONTRIBUTING.md](CONTRIBUTING.md) for hardware reports and pull requests.

MIT licensed: keep the license and copyright notice when distributing copies. Forks, modifications and commercial use are permitted. Fitbit and Google are trademarks of their respective owners; this project is independent.

## References

- [Google: share live heart rate](https://support.google.com/googlehealth/answer/14236705?hl=en)
- [Bluetooth Heart Rate Service specification](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
- [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Google Health data availability](https://developers.google.com/health/data-types#data_availability)
