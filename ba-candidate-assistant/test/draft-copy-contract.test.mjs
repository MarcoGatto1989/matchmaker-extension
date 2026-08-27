import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../src/content/assistant-panel.js', import.meta.url), 'utf8');

test('clipboard status is persisted only after the browser clipboard write succeeds', () => {
  const start = panel.indexOf('async function copyDraft()');
  const end = panel.indexOf('function visibleEditable()', start);
  const source = panel.slice(start, end);
  const write = source.indexOf('navigator.clipboard.writeText');
  const persisted = source.indexOf("persistDraft('copied_to_ba')");
  assert.ok(write >= 0 && persisted > write, source);
});
