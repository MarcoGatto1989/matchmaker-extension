import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function adapter() {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['../src/adapters/normalizers-global.js','../src/adapters/ba-profile-adapter-global.js']) {
    vm.runInContext(await readFile(new URL(file, import.meta.url), 'utf8'), context, { filename:file });
  }
  return context.BAKandidaten.profileAdapter;
}

test('visible BA profile fixture is normalized with stable reference and core matching fields', async () => {
  const profile = await adapter();
  const text = await readFile(new URL('./fixtures/profile-visible.txt', import.meta.url), 'utf8');
  const parsed = profile.parseProfileText(text);
  assert.equal(parsed.reference, '10000-1207477090-B');
  assert.equal(parsed.postalCode, '18055');
  assert.equal(parsed.location, 'Rostock');
  assert.equal(parsed.radiusKm, 30);
  assert.equal(parsed.experienceYears, 8);
  assert.ok(parsed.desiredRoles.includes('Lohn- und Gehaltsbuchhalter/in'));
  assert.ok(parsed.workTimes.includes('Vollzeit'));
  assert.ok(parsed.workTimes.includes('Teilzeit'));
  assert.ok(parsed.skills.some(skill => /Datev/i.test(skill)));
  assert.ok(parsed.languages.some(language => language.startsWith('Deutsch')));
  assert.ok(parsed.mobility.some(value => /Fahrerlaubnis B/i.test(value)));
  assert.ok(parsed.confidence >= 0.75);
});

test('adapter degrades explicitly when sections are missing instead of inventing values', async () => {
  const profile = await adapter();
  const parsed = profile.parseProfileText('Kontakt und Verwaltung\nReferenz-Nr.: 12345-67890-B');
  assert.equal(parsed.reference, '12345-67890-B');
  assert.equal(parsed.location, null);
  assert.deepEqual([...parsed.desiredRoles], []);
  assert.ok(parsed.missingFields.includes('location'));
  assert.ok(parsed.missingFields.includes('desiredRoles'));
  assert.ok(parsed.confidence < 0.5);
});
