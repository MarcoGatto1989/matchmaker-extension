import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);

async function read(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('v4.0.19 activates the truthful outreach stats worker', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.version, '4.0.19');
  assert.equal(manifest.background?.service_worker, 'service-worker-v419.js');
});

test('v4.0.19 synchronizes today and the daily limit from authoritative server stats', async () => {
  const worker = await read('service-worker-v419.js');
  assert.match(worker, /importScripts\('service-worker-v418\.js'\)/);
  assert.match(worker, /\/api\/outreach-ext\/stats/);
  assert.match(worker, /sent_today/);
  assert.match(worker, /dailyCount\s*=/);
  assert.match(worker, /processNextJob\s*=\s*async/);
});
