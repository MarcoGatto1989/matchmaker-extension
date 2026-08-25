import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../', import.meta.url);

test('manifest is standalone BA-only and requests no credential/crawling permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'BA Kandidaten');
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.ok(!manifest.permissions.includes('cookies'));
  assert.ok(!manifest.permissions.includes('tabs'));
  assert.ok(!manifest.permissions.includes('webRequest'));
  assert.ok(manifest.host_permissions.every(host => /arbeitsagentur\.de/.test(host)));
  assert.ok(manifest.content_scripts[0].matches.every(host => /arbeitsagentur\.de/.test(host)));
});

test('content scripts never programmatically click BA controls', async () => {
  const dir = new URL('../src/content/', import.meta.url);
  const files = (await readdir(dir)).filter(name => name.endsWith('.js'));
  for (const file of files) {
    const source = await readFile(new URL(file, dir), 'utf8');
    assert.doesNotMatch(source, /\.click\s*\(/, `${file} must not invoke click()`);
    assert.doesNotMatch(source, /dispatchEvent\([^\n]*(submit|click)/i, `${file} must not synthesize submit/click events`);
  }
});
