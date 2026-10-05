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
  assert.match(content, /findAlreadyAssignedTarget/);
  assert.match(content, /alreadyAssignedResult/);
  assert.match(content, /for \(let attempt = 0; attempt < 5; attempt \+= 1\)/);
  assert.match(content, /dialogStillOpen/);
  assert.match(content, /projectAssignmentConfirmed/);
  assert.match(content, /currentConfirm\.disabled/);
  assert.match(content, /closeProjectDialog/);
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
  assert.match(background, /networkSyncCompleteJob\(job\.id, apiBase, token, 'failed', reason\)/);
  assert.match(background, /networkSyncSendWithRetry/);
  assert.match(background, /networkSyncWaitForTabReady/);
});

test('extension release identifies Network Sync capability', () => {
  assert.equal(manifest.version, '4.1.3');
  assert.match(manifest.description, /Network Sync/);
  assert.match(manifest.description, /Sales Navigator/);
  assert.match(manifest.description, /TalentManager/);
});


test('successful URL output is populated only after verified success', () => {
  assert.match(background, /const sourceProfileUrl = String\(profileUrl \|\| ''\)\.trim\(\)/);
  assert.match(background, /await networkSyncCompleteJob\(job\.id, apiBase, token, 'completed', null\);[\s\S]*await networkSyncRecordSuccessfulUrl/);
  assert.match(background, /NETWORK_SYNC_SUCCESS_STORAGE_KEY/);
});

test('popup exposes the successful URL list with copy and clear actions', async () => {
  const popupHtml = await readFile(new URL('./popup.html', import.meta.url), 'utf8');
  const popupJs = await readFile(new URL('./popup.js', import.meta.url), 'utf8');
  assert.match(popupHtml, /network-sync-success-urls/);
  assert.match(popupHtml, /Liste kopieren/);
  assert.match(popupJs, /navigator\.clipboard\.writeText/);
  assert.match(popupJs, /loadNetworkSyncSuccessUrls/);
});
