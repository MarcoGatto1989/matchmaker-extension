export function classifyVisibleSearchCards(cards = [], existingByReference = new Map()) {
  const counts = { total: cards.length, stable: 0, new: 0, seen: 0, skipped: 0, contacted: 0, unresolved: 0 };
  const classified = cards.map(card => {
    if (!card.reference) {
      counts.unresolved += 1;
      return { ...card, reviewStatus: 'unresolved' };
    }
    counts.stable += 1;
    const existing = existingByReference.get(card.reference);
    let reviewStatus = 'new';
    if (existing?.outcome === 'skipped' || existing?.outcome === 'not_relevant') reviewStatus = 'skipped';
    else if (existing?.outcome === 'contacted_elsewhere') reviewStatus = 'contacted';
    else if (existing) reviewStatus = 'seen';
    counts[reviewStatus] += 1;
    return { ...card, reviewStatus };
  });
  return { cards: classified, counts };
}
