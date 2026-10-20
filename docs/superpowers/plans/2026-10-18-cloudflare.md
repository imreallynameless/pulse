# Cloudflare Pulse Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Host the latest-measurement widget independently of the Mac, with single-owner Google authorization and reusable MIT self-host setup.
**Architecture:** A Worker serves an allowlisted asset bundle. One Durable Object serializes account mutations and scheduled refreshes, stores encrypted tokens and the latest reading, and exposes a sanitized public snapshot. Cron checks Google once per minute with bounded retries/backoff.
**Tech Stack:** JavaScript, Cloudflare Workers and SQLite Durable Objects, Web Crypto, existing Node tests.
**Spec:** User-approved deployment and self-host scope in this conversation.

## Global Constraints
- Latest measured BPM plus its original age; never claim live.
- Single-owner deployment; admin secret protects connection/disconnection.
- Google secrets stay server-side; public response includes only BPM, measurement time, status, server time.

## Review Focus
- Forged OAuth state/cookie must fail; test callback rejection.
- Unauthorized connect/disconnect must fail; test origin/session checks.
- Restart must retain encrypted authorization; test storage across instances.
- Google failures retain old reading with paused status; test backoff and token refresh.
- Disconnect racing with polling must not resurrect sharing; serialize all operations and test order.

### Task 1: Hosted service
Files: cloudflare/worker.mjs, cloudflare/security.mjs, tests/worker.test.mjs, scripts/build-cloud.mjs, wrangler.jsonc.
Interfaces: Worker fetch and scheduled; PulseAccount fetch; encrypt/decrypt helpers; public snapshot matches existing widget.
- [x] Write failing auth, crypto, snapshot and refresh tests.
- [x] Implement secure single-owner service and asset build.
- [x] Run full tests and deployment dry run.

### Task 2: Deploy and connect
- [x] Deploy in personal Cloudflare account; put secrets via private input.
- [x] Add hosted callback to existing Google OAuth client.
- [ ] Connect hosted Google account and verify public snapshot and widget.

### Task 3: Website and reusable release
- [ ] Embed hosted widget with portfolio theme support once feed verified.
- [x] Document own-account deployment, reconnect, limitations, font licensing and MIT.
- [ ] Verify portfolio build and review changes.

## Execution record
Authorized to proceed by user; implement inline without redundant approval. Existing local widget changes retained on feature branch. Cron chosen for first release; no unverified webhook implementation or latency guarantee.

Verification: 25 tests passed; deployed Worker and assets HTTP 200; forged routes return 404. Review fixed public-read blocking behind slow Google polls, confirmed by a deferred-network regression test. Initial 24-hour search limitation documented. Portfolio component added locally; production build and targeted lint passed. Hosted OAuth awaiting owner consent; portfolio remains unpublished with unrelated pre-existing edits.
