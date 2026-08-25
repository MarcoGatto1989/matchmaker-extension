import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../src/content/assistant-panel.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');

test('search panel asks the service worker for deduplication state before rendering visible cards', () => {
  assert.match(panel, /BAK_GET_SEARCH_VIEW/);
  assert.match(panel, /reviewStatus/);
  assert.match(panel, /counts\.new/);
  assert.match(bootstrap, /await root\.panel\.renderSearch\(cards\)/);
});
