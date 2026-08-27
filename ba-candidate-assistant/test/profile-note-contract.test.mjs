import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/content/assistant-panel.js', import.meta.url), 'utf8');

test('project-bound candidate notes can be edited from the profile assistant', () => {
  assert.match(worker, /BAK_UPDATE_LINK_NOTE/);
  assert.match(panel, /data-link-note/);
  assert.match(panel, /Notiz speichern/);
  assert.match(panel, /BAK_UPDATE_LINK_NOTE/);
});
