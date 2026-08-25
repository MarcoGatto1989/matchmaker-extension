import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, transitionState } from '../src/domain/lifecycle.js';
import { computeRetentionActions } from '../src/storage/retention.js';
import { makeBackup, parseBackup } from '../src/storage/backup.js';

const day=24*60*60*1000;

test('lifecycle accepts recruiter workflow and rejects impossible transitions',()=>{
  assert.equal(canTransition('new','reviewed'),true);
  assert.equal(transitionState('reviewed','project_linked'),'project_linked');
  assert.throws(()=>transitionState('new','contacted'),/Ungültiger Statuswechsel/);
});

test('retention removes expired project-bound records and short-lived seen references',()=>{
  const now=Date.parse('2026-08-25T12:00:00Z');
  const data={
    candidates:[{reference:'old-B',updatedAt:new Date(now-100*day).toISOString()},{reference:'fresh-B',updatedAt:new Date(now-2*day).toISOString()}],
    seenReferences:[{reference:'seen-old-B',lastSeen:new Date(now-40*day).toISOString()},{reference:'fresh-B',lastSeen:new Date(now-2*day).toISOString()}],
    links:[{id:'l1',candidateReference:'old-B'},{id:'l2',candidateReference:'fresh-B'}],
    drafts:[{id:'d1',candidateReference:'old-B'},{id:'d2',candidateReference:'fresh-B'}]
  };
  const result=computeRetentionActions(data,{candidateDays:90,seenDays:30},now);
  assert.deepEqual(result.candidateRefs,['old-B']);
  assert.deepEqual(result.seenRefs,['seen-old-B']);
  assert.deepEqual(result.linkIds,['l1']);
  assert.deepEqual(result.draftIds,['d1']);
});

test('backup round trip is versioned and product-bound',()=>{
  const original={projects:[{id:'p1',name:'P'}],candidates:[],seenReferences:[],links:[],drafts:[],settings:{candidateDays:90}};
  const backup=makeBackup(original);
  const restored=parseBackup(JSON.stringify(backup));
  assert.equal(restored.projects[0].id,'p1');
  assert.throws(()=>parseBackup({product:'other',version:1,data:{}}),/Ungültiges/);
});

test('retention is based on the latest project interaction, not only the profile capture timestamp',()=>{
  const now=Date.parse('2026-08-25T12:00:00Z');
  const data={
    candidates:[{reference:'active-B',updatedAt:new Date(now-100*day).toISOString()}],
    seenReferences:[{reference:'active-B',lastSeen:new Date(now-100*day).toISOString()}],
    links:[{id:'l-active',candidateReference:'active-B',updatedAt:new Date(now-2*day).toISOString()}],
    drafts:[]
  };
  const result=computeRetentionActions(data,{candidateDays:90,seenDays:30},now);
  assert.deepEqual(result.candidateRefs,[]);
  assert.deepEqual(result.linkIds,[]);
});
