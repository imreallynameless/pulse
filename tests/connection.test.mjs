import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { decodeHeartRate, summarizeIntervals, readingState } from '../web/heart-rate.mjs';

// Exercise the real UI module with only DOM/Bluetooth boundaries replaced.
// This catches a late subscription success reviving a disconnected session.
test('disconnect during notification setup cannot revive the session', async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', dataset: {}, handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; } });
    return elements.get(id);
  };
  let finishSubscription;
  let subscriptionStarted;
  const enteredSubscription = new Promise((resolve) => { subscriptionStarted = resolve; });
  const subscription = new Promise((resolve) => { finishSubscription = resolve; });
  const characteristic = {
    addEventListener() {}, removeEventListener() {},
    startNotifications() { subscriptionStarted(); return subscription; }
  };
  const events = new Map();
  const device = { name: 'Test sensor',
    addEventListener(type, fn) { events.set(type, fn); },
    removeEventListener(type) { events.delete(type); },
    gatt: { connected: false,
      async connect() { this.connected = true; return this; },
      async getPrimaryService() { return { async getCharacteristic() { return characteristic; } }; },
      disconnect() { this.connected = false; }
    }
  };
  const source = (await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source, {
    decodeHeartRate, summarizeIntervals, readingState, performance,
    setupBroadcast: () => ({stop() {}, send() {}}),
    navigator: { bluetooth: { async requestDevice() { return device; } } },
    document: { getElementById: element, addEventListener() {} },
    window: { isSecureContext: true, addEventListener() {} },
    setInterval() {}, setTimeout() {}, console
  });
  const connection = element('connect').handlers.click();
  await enteredSubscription;
  device.gatt.connected = false;
  events.get('gattserverdisconnected')();
  finishSubscription();
  await connection;
  assert.equal(element('status').textContent, 'Offline');
  assert.equal(element('connect').disabled, false);
  assert.equal(element('disconnect').disabled, true);
  assert.doesNotMatch(element('message').textContent, /^Connected/);
});
