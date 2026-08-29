import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const background = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
const socialWorker = fs.readFileSync(new URL('./service-worker-v406.js', import.meta.url), 'utf8');

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing start marker: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing end marker: ${endNeedle}`);
  return source.slice(start, end + endNeedle.length);
}

test('outreach queue validates HTTP status and JSON shape before reading candidate_name', () => {
  const block = sliceBetween(
    background,
    "const r = await fetch(`${apiBase}/api/outreach-ext/jobs/queued?limit=1`",
    'const job = jobs[0];',
  );

  const statusGuard = block.search(/if\s*\(\s*!r\.ok\s*\)/);
  const arrayGuard = block.search(/Array\.isArray\(jobs\)/);
  const jobRead = block.indexOf('const job = jobs[0];');

  assert.ok(statusGuard >= 0, 'queue must reject non-2xx responses before parsing a job');
  assert.ok(arrayGuard >= 0, 'queue must reject non-array JSON payloads before reading jobs[0]');
  assert.ok(statusGuard < jobRead, 'HTTP guard must run before jobs[0]');
  assert.ok(arrayGuard < jobRead, 'array guard must run before jobs[0]');
});

test('v4.0.19 verifies or self-heals the extension token before queue work', () => {
  assert.equal(manifest.version, '4.0.19');
  assert.equal(manifest.background.service_worker, 'service-worker-v419.js');

  const worker = fs.readFileSync(new URL('./service-worker-v419.js', import.meta.url), 'utf8');
  assert.match(worker, /importScripts\('service-worker-v418\.js'\)/);
  assert.match(worker, /esosV418EnsureExtensionToken\(\)/);
  assert.doesNotMatch(worker, /if\s*\(current\)\s*return current/);
});

test('XING runtime JavaScript is rejected as a photo candidate and CDN fetches start cookie-free', () => {
  assert.match(socialWorker, /esosV406ObviousNonImageUrl/);
  assert.match(socialWorker, /\bjs\b/);
  assert.match(socialWorker, /\['omit', 'include'\]/);
});
