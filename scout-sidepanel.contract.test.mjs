import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const panel = readFileSync(new URL('./scout-sidepanel.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('./scout-sidepanel.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('./scout-sidepanel-worker.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('./service-worker-v421.js', import.meta.url), 'utf8');

test('native docked panel replaces browser action popup', () => {
  assert.equal(manifest.side_panel.default_path, 'scout-sidepanel.html');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.action.default_popup, undefined);
  assert.match(service, /scout-sidepanel-worker\.js/);
  assert.match(worker, /openPanelOnActionClick: true/);
});

test('searches are only started by an explicit click and saved in the Scout inbox', () => {
  assert.match(panel, /Aktuelle Suche importieren/);
  assert.match(source, /\$\('start'\)\.addEventListener\('click'/);
  assert.match(source, /\/extension\/sessions/);
  assert.match(source, /\/extension\/sessions\/.*\/items/);
  assert.doesNotMatch(source, /\/api\/extension\/import-candidate/);
});

test('capture is not truncated to 25 results and recovers incomplete pages', () => {
  assert.match(source, /let cycle = 0; cycle < 180; cycle\+\+/);
  assert.match(source, /mehr anzeigen/);
  assert.match(source, /clickedNext/);
  assert.match(source, /count === 0/);
  assert.match(source, /state\.total >= state\.expected/);
  assert.match(source, /Teilimport:/);
  assert.doesNotMatch(source, /\.slice\(0,\s*25\)/);
});

test('provider capture keeps photo, name, employer, position, location and profile URL', () => {
  for (const field of ['profileUrl', 'displayName', 'position', 'employer', 'location', 'photoUrl']) {
    assert.match(source, new RegExp('\\b' + field + '\\b'));
  }
});
