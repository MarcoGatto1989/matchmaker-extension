import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVisibleSearchCards } from '../src/domain/search-review.js';

test('visible search references are classified as new, skipped, contacted or seen without full-profile persistence', () => {
  const cards = [
    { reference:'new-B', title:'Neu' },
    { reference:'skip-B', title:'Skip' },
    { reference:'contact-B', title:'Kontakt' },
    { reference:'seen-B', title:'Gesehen' },
    { reference:null, title:'Ohne Referenz' }
  ];
  const existing = new Map([
    ['skip-B', { reference:'skip-B', outcome:'skipped' }],
    ['contact-B', { reference:'contact-B', outcome:'contacted_elsewhere' }],
    ['seen-B', { reference:'seen-B', outcome:'unreviewed' }]
  ]);
  const result = classifyVisibleSearchCards(cards, existing);
  assert.deepEqual(result.counts, { total:5, stable:4, new:1, seen:1, skipped:1, contacted:1, unresolved:1 });
  assert.equal(result.cards.find(card=>card.reference==='new-B').reviewStatus, 'new');
  assert.equal(result.cards.find(card=>card.reference==='skip-B').reviewStatus, 'skipped');
  assert.equal(result.cards.find(card=>card.reference==='contact-B').reviewStatus, 'contacted');
  assert.equal(result.cards.find(card=>card.reference==='seen-B').reviewStatus, 'seen');
  assert.equal(result.cards.find(card=>!card.reference).reviewStatus, 'unresolved');
});
