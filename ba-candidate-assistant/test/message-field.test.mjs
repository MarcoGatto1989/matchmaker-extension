import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/content/message-field-global.js', import.meta.url), 'utf8');

function element({ attrs = {}, context = '', disabled = false } = {}) {
  return {
    disabled,
    id: attrs.id || '',
    name: attrs.name || '',
    getAttribute(name) { return attrs[name] ?? null; },
    matches(selector) { return selector.includes('textarea'); },
    closest() { return context ? { innerText: context } : null; }
  };
}

function load(elements) {
  const sandbox = {
    globalThis: {
      BAKandidaten: { normalizers: { visible: () => true } }
    }
  };
  vm.runInNewContext(source, sandbox);
  const host = { contains: () => false };
  const document = { querySelectorAll: () => elements };
  return { api: sandbox.globalThis.BAKandidaten.messageField, document, host };
}

test('generic visible textarea is rejected when it is not clearly the BA message composer', () => {
  const generic = element({ attrs: { placeholder:'Notiz' }, context:'Kontakt und Verwaltung' });
  const { api, document, host } = load([generic]);
  assert.equal(api.findVisibleBaMessageEditor(document, host), null);
});

test('uniquely identified message textarea is accepted', () => {
  const message = element({ attrs: { 'aria-label':'Nachricht an Bewerber schreiben', placeholder:'Nachricht' }, context:'Nachricht schreiben Empfänger' });
  const { api, document, host } = load([message]);
  assert.equal(api.findVisibleBaMessageEditor(document, host), message);
});

test('ambiguous equally strong message fields fail closed', () => {
  const first = element({ attrs: { 'aria-label':'Nachricht' }, context:'Nachricht schreiben' });
  const second = element({ attrs: { 'aria-label':'Nachricht' }, context:'Nachricht schreiben' });
  const { api, document, host } = load([first, second]);
  assert.equal(api.findVisibleBaMessageEditor(document, host), null);
});
