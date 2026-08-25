import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSeenReference } from '../src/domain/seen-reference.js';

test('reopening a profile preserves an existing terminal seen outcome when no new outcome is supplied', () => {
  const current = {
    reference: '10000-1207477090-B',
    firstSeen: '2026-08-24T08:00:00.000Z',
    lastSeen: '2026-08-24T09:00:00.000Z',
    outcome: 'skipped',
    reasonCode: 'not_now'
  };
  const next = mergeSeenReference(current, {
    reference: current.reference,
    now: '2026-08-25T12:00:00.000Z'
  });
  assert.equal(next.outcome, 'skipped');
  assert.equal(next.reasonCode, 'not_now');
  assert.equal(next.firstSeen, current.firstSeen);
  assert.equal(next.lastSeen, '2026-08-25T12:00:00.000Z');
});

test('an explicit new outcome intentionally replaces the prior seen outcome', () => {
  const next = mergeSeenReference({ reference:'x-B', outcome:'skipped', firstSeen:'a', lastSeen:'b' }, {
    reference:'x-B', outcome:'contacted_elsewhere', reasonCode:null, now:'2026-08-25T12:00:00.000Z'
  });
  assert.equal(next.outcome, 'contacted_elsewhere');
  assert.equal(next.reasonCode, null);
});
