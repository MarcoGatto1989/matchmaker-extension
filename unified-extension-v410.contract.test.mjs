import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const popup = readFileSync(new URL('./popup.html', import.meta.url), 'utf8');
const popupJs = readFileSync(new URL('./popup.js', import.meta.url), 'utf8');
const content = readFileSync(new URL('./content.js', import.meta.url), 'utf8');
const manual = readFileSync(new URL('./manual-outreach-v421.js', import.meta.url), 'utf8');
const handoff = readFileSync(new URL('./esos-socialfinder-handoff-v421.js', import.meta.url), 'utf8');

test('unified ESOS AI keeps the established background worker and adds helper scripts', () => {
  assert.equal(manifest.background.service_worker, 'service-worker-v420.js');
  assert.ok(manifest.content_scripts.some(block => block.js?.includes('manual-outreach-v421.js')));
  assert.ok(manifest.content_scripts.some(block => block.js?.includes('esos-socialfinder-handoff-v421.js')));
});

test('popup exposes CRM, Outreach, Network and Settings tabs', () => {
  for (const tab of ['import', 'outreach', 'network', 'settings']) {
    assert.match(popup, new RegExp('data-tab="' + tab + '"'));
    assert.match(popup, new RegExp('id="tab-' + tab + '"'));
  }
});

test('manual outreach supports connect and message modes', () => {
  assert.match(popup, /manual-mode-connect/);
  assert.match(popup, /manual-mode-message/);
  assert.match(popupJs, /ESOS_MANUAL_OUTREACH_V421/);
  assert.match(manual, /linkedinConnect/);
  assert.match(manual, /linkedinMessage/);
});

test('LinkedHelper batch sync distinguishes new, existing and errors', () => {
  assert.match(popup, /network-new-count/);
  assert.match(popup, /network-existing-count/);
  assert.match(popup, /network-error-count/);
  assert.match(popupJs, /ESOS_XING_OPEN_TALENT_MANAGER/);
  assert.match(popupJs, /ESOS_XING_ADD_PROJECT/);
  assert.match(popupJs, /ESOS_LINKEDIN_SAVE_SALES_NAV/);
  assert.match(content, /alreadyAssignedTarget/);
});

test('new verified profiles are handed to SocialFinder with profile metadata', () => {
  assert.match(popupJs, /esos_socialfinder_profile_metadata_v421/);
  assert.match(handoff, /data-esos-socialfinder-link-input/);
  assert.match(handoff, /esos-ai-profile-metadata/);
});

test('Settings keeps ESOS login fields and optional hover highlighting', () => {
  for (const id of ['esos-url', 'esos-email', 'esos-password', 'boot-token', 'hover-highlight-toggle']) {
    assert.match(popup, new RegExp('id="' + id + '"'));
  }
  assert.match(manual, /esos_hover_highlight_fields/);
});
