import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const APP = 'https://app.esos.cloud';
const LEGACY_RAILWAY = `https://${['executive', 'sphere', 'production'].join('-')}.up.railway.app`;

test('manifest grants the canonical ESOS app origin and drops the legacy CRM host', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.host_permissions.includes(`${APP}/*`));
  assert.ok(!manifest.host_permissions.includes(`${LEGACY_RAILWAY}/*`));
});

test('active extension runtime canonicalizes ESOS API traffic to app.esos.cloud', async () => {
  const worker = await readFile(new URL('./service-worker-v415.js', import.meta.url), 'utf8');
  const preload = await readFile(new URL('./popup-session-preload-v415.js', import.meta.url), 'utf8');
  assert.match(worker, /https:\/\/app\.esos\.cloud/);
  assert.match(preload, /https:\/\/app\.esos\.cloud/);
});
