import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const panel = await readFile(new URL('./linkedhelper-auto-panel-v421.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('./linkedhelper-batch-worker-v421.js', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('./service-worker-v421.js', import.meta.url), 'utf8');

test('LinkedHelper panel auto-loads on LinkedIn/XING', () => {
  const providerBlocks = manifest.content_scripts.filter(block =>
    (block.matches || []).some(value => /linkedin\.com|xing\.com/.test(value))
  );
  assert.ok(providerBlocks.length > 0);
  assert.ok(providerBlocks.every(block => block.js.includes('linkedhelper-auto-panel-v421.js')));
  assert.match(panel, /boot\(\)/);
  assert.match(panel, /XING-Tabs starten/);
  assert.match(panel, /LinkedIn-Tabs starten/);
});

test('batch orchestration lives in service worker, not popup lifecycle', () => {
  assert.equal(manifest.background.service_worker, 'service-worker-v421.js');
  assert.match(serviceWorker, /linkedhelper-batch-worker-v421\.js/);
  assert.match(worker, /ESOS_LINKEDHELPER_START_XING/);
  assert.match(worker, /ESOS_LINKEDHELPER_START_LINKEDIN/);
  assert.match(worker, /chrome\.tabs\.query/);
  assert.match(worker, /await closeTab\(tab\.id\)/);
});

test('failed profiles stay open and new profile data persists before close', () => {
  assert.match(worker, /Profil-URL\/Metadaten konnten nicht gespeichert werden; Tab bleibt offen/);
  assert.match(worker, /await persistNew\('xing'/);
  assert.match(worker, /await persistNew\('linkedin'/);
  assert.match(worker, /if \(!result\?\.success\)[\s\S]*continue/);
});
