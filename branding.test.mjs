import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const legacyBrand = new RegExp(['executive', 'sphere'].join('[\\s_-]*'), 'i');
const textExtensions = new Set(['.js', '.mjs', '.json', '.html', '.css', '.md']);

async function files(dir = '.') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else if (textExtensions.has(extname(entry.name))) out.push(path);
  }
  return out;
}

test('extension contains no legacy ESOS product branding', async () => {
  const offenders = [];
  for (const path of await files()) {
    const content = await readFile(path, 'utf8');
    if (legacyBrand.test(content)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});
