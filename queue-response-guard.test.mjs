import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const socialWorker = fs.readFileSync(new URL('./service-worker-v406.js', import.meta.url), 'utf8');

test('v4.0.19 normalizes failed or malformed queue responses before legacy job parsing', () => {
  assert.equal(manifest.version, '4.0.19');
  assert.equal(manifest.background.service_worker, 'service-worker-v419.js');

  const worker = fs.readFileSync(new URL('./service-worker-v419.js', import.meta.url), 'utf8');
  assert.match(worker, /importScripts\('service-worker-v418\.js'\)/);
  assert.match(worker, /outreach-ext\/jobs\/queued/);
  assert.match(worker, /response\.clone\(\)\.json\(\)/);
  assert.match(worker, /Array\.isArray\(payload\)/);
  assert.match(worker, /new Response\('\\[\\]'/);
});

test('v4.0.19 verifies or self-heals the extension token before queue work', () => {
  const worker = fs.readFileSync(new URL('./service-worker-v419.js', import.meta.url), 'utf8');
  assert.match(worker, /esosV418EnsureExtensionToken\(\)/);
  assert.doesNotMatch(worker, /if\s*\(current\)\s*return current/);
});

test('XING runtime JavaScript is rejected as a photo candidate and CDN fetches start cookie-free', () => {
  assert.match(socialWorker, /esosV406ObviousNonImageUrl/);
  assert.match(socialWorker, /\bjs\b/);
  assert.match(socialWorker, /\['omit', 'include'\]/);
});
