(() => {
  const root = globalThis.BAKandidaten = globalThis.BAKandidaten || {};
  const n = root.normalizers;
  const ADAPTER_VERSION = 'ba-search-dom-v1';

  function looksLikeCard(text) {
    return text.length >= 30 && text.length <= 1500 && (/Berufserfahrung/i.test(text) || /Ab sofort/i.test(text)) && /\b\d{5}\b/.test(text);
  }

  function candidateFromText(text) {
    const lines = n.lines(text);
    const ref = text.match(/\b([0-9-]+-B)\b/i)?.[1]?.toUpperCase() || null;
    const locationMatch = text.match(/\b(\d{5})\s+([^\n–-]{2,60})/);
    return {
      title: lines[0] || 'BA-Profil',
      reference: ref,
      postalCode: locationMatch?.[1] || null,
      location: locationMatch?.[2]?.trim() || null,
      summary: lines.slice(0, 5).join(' · ').slice(0, 400)
    };
  }

  function extractVisibleSearchCards(document) {
    const selectors = [
      'main article',
      'main [role="listitem"]',
      'main li',
      'main [class*="treffer"]',
      'main [class*="result"]'
    ];
    const seenText = new Set();
    const cards = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!n.visible(element)) continue;
        const text = n.clean(element.innerText || '');
        if (!looksLikeCard(text) || seenText.has(text)) continue;
        if ([...seenText].some(existing => existing.includes(text) || text.includes(existing))) continue;
        seenText.add(text);
        cards.push(candidateFromText(text));
        if (cards.length >= 100) return cards;
      }
      if (cards.length) break;
    }
    return cards;
  }

  function isSearchPage(location = globalThis.location, document = globalThis.document) {
    const url = String(location?.href || '');
    const text = document?.body?.innerText || '';
    return /bewerberboerse\/suche/i.test(url) || /Bewerberbörse/.test(text) && /Filter/.test(text);
  }

  root.searchAdapter = { ADAPTER_VERSION, extractVisibleSearchCards, isSearchPage };
})();
