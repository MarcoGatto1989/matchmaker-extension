import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const worker = fs.readFileSync(new URL('./service-worker-v413.js', import.meta.url), 'utf8');

test('v4.0.13 loads the checked connection-status worker', () => {
  assert.equal(manifest.version, '4.0.13');
  assert.equal(manifest.background.service_worker, 'service-worker-v413.js');
  assert.match(worker, /response\.ok/);
  assert.match(worker, /outreach-ext\\\/stats/);
  assert.match(worker, /outreach-ext\/heartbeat/);
  assert.match(worker, /chrome\.storage\.onChanged/);
});
