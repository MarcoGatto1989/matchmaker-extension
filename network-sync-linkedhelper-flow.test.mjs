import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const content = await readFile(new URL('./content.js', import.meta.url), 'utf8');
const background = await readFile(new URL('./background.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));

test('network sync uses the proven XING LinkedHelper flow', () => {
  assert.match(content, /Als Kontakt hinzufügen/);
  assert.match(content, /Im\\s\+talent\\s\*manager\\s\+ansehen/i);
  assert.match(content, /Zu Projekt hinzufügen/);
  assert.match(content, /projectField && sameProject/);
  assert.match(content, /for \(let attempt = 0; attempt < 5; attempt \+= 1\)/);
  assert.match(content, /dialogStillOpen/);
});

test('network sync saves LinkedIn candidates in Sales Navigator', () => {
  assert.match(content, /In Sales Navigator speichern/);
  assert.match(content, /ESOS_LINKEDIN_SAVE_SALES_NAV/);
  assert.match(content, /saveLinkedInToSalesNavigator/);
});

test('network sync closes successful tabs and preserves failed tabs', () => {
  assert.match(background, /await chrome\.tabs\.remove\(sourceTab\.id\)/);
  assert.match(background, /idsToClose/);
  assert.match(background, /Deliberately keep source\/target tabs open/);
  assert.match(background, /completeJob\(job\.id, apiBase, token, 'failed', reason\)/);
});

test('extension release identifies Network Sync capability', () => {
  assert.equal(manifest.version, '4.0.21');
  assert.match(manifest.description, /Network Sync/);
  assert.match(manifest.description, /Sales Navigator/);
  assert.match(manifest.description, /TalentManager/);
});
