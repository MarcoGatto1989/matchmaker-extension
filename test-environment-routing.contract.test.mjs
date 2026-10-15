import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const worker = read('./service-worker-v415.js');
const popupBridge = read('./popup-session-preload-v415.js');
const popup = read('./popup.js');
const auth = read('./service-worker-v418.js');
const photoWorker = read('./background-worker.js');
const manifest = JSON.parse(read('./manifest.json'));

test('explicit test origin remains selected across worker session synchronization', () => {
  assert.match(worker, /esos-frontend-test\.up\.railway\.app/);
  assert.doesNotMatch(worker, /await chrome\.storage\.local\.set\(\{ esos_url: ESOS_V415_API_BASE \}\)/);
  assert.match(worker, /return esosV414SyncBrowserSession\(\)/);
});

test('popup session and auth validation use the configured environment', () => {
  assert.match(popupBridge, /async function esosV415ConfiguredApiBase\(\)/);
  assert.match(popupBridge, /esosV415CookieToken\(apiBase\)/);
  assert.match(popupBridge, /nativeFetch\(`\$\{apiBase\}\/api\/auth\/me`/);
  assert.match(popupBridge, /esos_url: apiBase/);
  assert.match(popup, /parsed\.origin !== ESOS_TEST_URL/);
});

test('cached verified extension token is scoped to selected API origin', () => {
  assert.match(auth, /apiBase === esosV418VerifiedApiBase/);
  assert.match(auth, /esosV418VerifiedApiBase = apiBase/g);
});

test('photo worker and manifest support the test queue without opening a browser tab', () => {
  assert.ok(manifest.host_permissions.includes('https://esos-frontend-test.up.railway.app/*'));
  assert.match(photoWorker, /\$\{apiBase\}\/api\/position-check-ext\/social-profile-photos\/jobs\/queued/);
  assert.match(photoWorker, /\$\{apiBase\}\/api\/position-check-ext\/social-profile-photos\/results/);
});
