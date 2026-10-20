# Contributing

Fork, create a branch, and use Node.js 22+. Run `npm ci`, `npm test`, `npm run build:cloud`, and `npx wrangler deploy --dry-run` before opening a pull request.

Keep Google authorization server-side, owner controls authenticated, and public responses limited to latest BPM, measurement time, server time and status. Preserve measurement age during failures; never describe synced readings as live.

Use synthetic measurements in tests. Do not attach credentials, OAuth callback URLs, or private health data to issues. Distinguish mocked tests from actual Google Health verification.

Contributions use the repository's MIT license; bundled fonts retain their OFL licenses.
