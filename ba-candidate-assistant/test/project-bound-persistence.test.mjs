import test from 'node:test';
import assert from 'node:assert/strict';
import { orphanedCandidateReferencesAfterProjectRemoval } from '../src/domain/project-bound-persistence.js';

test('deleting the only project link makes the full candidate snapshot orphaned', () => {
  const links = [
    { id:'a', candidateReference:'ref-a-B', projectId:'p1' },
    { id:'b', candidateReference:'ref-b-B', projectId:'p2' }
  ];
  assert.deepEqual(orphanedCandidateReferencesAfterProjectRemoval(links, 'p1'), ['ref-a-B']);
});

test('candidate remains project-bound when another project link survives', () => {
  const links = [
    { id:'a1', candidateReference:'ref-a-B', projectId:'p1' },
    { id:'a2', candidateReference:'ref-a-B', projectId:'p2' }
  ];
  assert.deepEqual(orphanedCandidateReferencesAfterProjectRemoval(links, 'p1'), []);
});
