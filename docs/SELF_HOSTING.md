# Self-host Pulse

Pulse is a single Node service with long-lived WebSockets. Use one process/replica. Independent replicas do not share feeds; scaling needs a shared pub/sub layer or feed-aware routing. Static-only hosting cannot run the relay.

## Configure

Run `npm ci`, then `npm run setup -- my-pulse`. Setup writes a new `.env` with a cryptographically random private publishing token and does not overwrite an existing file. Keep `.env` private; it is ignored by Git and Docker builds.

For several people, configure independent feed names and tokens in `PULSE_FEEDS`:

```dotenv
PULSE_FEEDS={"alice":"FIRST_RANDOM_TOKEN_AT_LEAST_32_CHARACTERS","bob":"SECOND_RANDOM_TOKEN_AT_LEAST_32_CHARACTERS"}
```

Generate real tokens with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. The strings above are placeholders. Never publish them as working credentials. Restart the server after configuration changes. Share each token privately with its broadcaster; viewers only get the feed URL. Rotating a token and restarting the service revokes the old token and disconnects all existing sessions.

## Node + HTTPS proxy

On a server, run `npm start` under your process manager. The default binds to `127.0.0.1:4317`. Place an HTTPS reverse proxy in front that supports WebSocket upgrades. For example, a Caddy site block:

```caddyfile
pulse.example.com {
  reverse_proxy 127.0.0.1:4317 {
    header_up Host 127.0.0.1:4317
  }
}
```

Replace the domain, point its DNS at your server, and configure the proxy through your hosting provider's normal setup. The explicit upstream Host matches the app's loopback Host allowlist. Keep the Node port private. In container platforms that require listening on all interfaces, set `HOST=0.0.0.0` and put HTTPS/network controls in front of the app.

Use `wss://` in production: the browser derives the WebSocket address from the page origin. Do not cache widget HTML or live messages. Set proxy idle timeouts above 30 seconds; the server sends WebSocket pings every 15 seconds.

## Docker alternative

```sh
docker build -t pulse .
docker run --rm --env-file .env -p 127.0.0.1:4317:4317 pulse
```

Put the same HTTPS proxy in front. Docker builds exclude `.env` and recordings. Runtime environment supplies the secrets. The image runs as the non-root `node` user. Docker deployment instructions are provided; the image has not been exercised in this Mac session.

## Verify before embedding

1. Open your deployed HTTPS broadcaster in Chrome on the Mac near your Fitbit.
2. Connect, enter your feed/token and start sharing.
3. Open the widget on a different device/network. Confirm live readings.
4. Stop sharing: the widget should show Offline. Pause receipt without closing the network: readings expire after 5 seconds.
5. Paste the generated iframe into your website. If your website sets a Content Security Policy, add your Pulse domain to its `frame-src` allowlist.

A token permits publishing; a feed slug is public. This is an early self-hostable tool, not a hardened multi-tenant hosted service. Internet-facing deployments should set connection limits at the proxy and monitor resource usage. No historical health database is created. Server restart loses current readings and requires broadcasters to start sharing again.
