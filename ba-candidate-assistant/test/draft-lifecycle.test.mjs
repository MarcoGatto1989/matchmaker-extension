import test from 'node:test';
import assert from 'node:assert/strict';
import { markProjectDraftsSent } from '../src/domain/draft-lifecycle.js';

test('manual contact confirmation marks only drafts for the selected project as sent', () => {
  const drafts = [
    { id:'d1', projectId:'p1', status:'draft', updatedAt:'old' },
    { id:'d2', projectId:'p2', status:'copied_to_ba', updatedAt:'old' }
  ];
  const result = markProjectDraftsSent(drafts, 'p1', '2026-08-25T12:00:00.000Z');
  assert.equal(result[0].status, 'marked_sent');
  assert.equal(result[0].updatedAt, '2026-08-25T12:00:00.000Z');
  assert.equal(result[1], drafts[1]);
});
