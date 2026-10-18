# Contributing

Fork this repository, create a branch, run `npm test`, and open a pull request describing the behavior changed and how you checked it. Use Node 22 or later. Run npm ci first. The WebSocket relay uses ws; there is no build step.

## Hardware reports

Please report device model/firmware, macOS and Chrome versions, test duration, approximate notification cadence, whether RR intervals appeared, and disconnect/reconnect behavior. Do not upload raw recordings, tokens, Bluetooth identifiers, or personal health data to public issues. Synthetic byte fixtures are preferable for parser bugs.

A UI smoke test or passing unit test is not proof of a working Fitbit connection. Clearly label what was tested on real hardware and what remains unverified.

## Priorities

1. Prove the hardware feed and measure notification timing.
2. Keep readings local until the user explicitly starts broadcasting.
3. Preserve every new notification, including unchanged BPM values.
4. Distinguish receipt cadence from physiological latency.
5. Never show stale readings as live.

Contributions are made under the repository's MIT license.
