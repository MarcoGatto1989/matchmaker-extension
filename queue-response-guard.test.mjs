import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const socialWorker = fs.readFileSync(new URL('./service-worker-v406.js', import.meta.url), 'utf8');
const v419Url = new URL('./service-worker-v419.js', import.meta.url);
const activeWorkerUrl = new URL('./service-worker-v420.js', import.meta.url);

function readV419() {
  assert.ok(fs.existsSync(v419Url), 'service-worker-v419.js must exist');
  return fs.readFileSync(v419Url, 'utf8');
}

test('v4.0.19 queue guard remains in the active v4.0.20 worker chain', () => {
  assert.equal(manifest.version, '4.0.20');
  assert.equal(manifest.background.service_worker, 'service-worker-v420.js');
  const activeWorker = fs.readFileSync(activeWorkerUrl, 'utf8');
  assert.match(activeWorker, /importScripts\('service-worker-v419\.js'\)/);

  const worker = readV419();
  assert.match(worker, /importScripts\('service-worker-v418\.js'\)/);
  assert.match(worker, /outreach-ext\/jobs\/queued/);
  assert.match(worker, /response\.clone\(\)\.json\(\)/);
  assert.match(worker, /Array\.isArray\(payload\)/);
  assert.ok(worker.includes("new Response('[]'"));
});

test('v4.0.19 verifies or self-heals the extension token before queue work', () => {
  const worker = readV419();
  assert.match(worker, /esosV418EnsureExtensionToken\(\)/);
  assert.doesNotMatch(worker, /if\s*\(current\)\s*return current/);
});

test('XING runtime JavaScript is rejected as a photo candidate and CDN fetches start cookie-free', () => {
  assert.match(socialWorker, /esosV406ObviousNonImageUrl/);
  assert.match(socialWorker, /\bjs\b/);
  assert.match(socialWorker, /\['omit', 'include'\]/);
});
