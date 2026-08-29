import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);

async function read(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('v4.0.20 layers truthful Outreach counters on top of the v4.0.19 queue guard', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.version, '4.0.20');
  assert.equal(manifest.background?.service_worker, 'service-worker-v420.js');

  const worker = await read('service-worker-v420.js');
  assert.match(worker, /importScripts\('service-worker-v419\.js'\)/);
  assert.match(worker, /\/api\/outreach-ext\/stats/);
  assert.match(worker, /sent_today/);
  assert.match(worker, /dailyCount\s*=/);
  assert.match(worker, /processNextJob\s*=\s*async/);
});
