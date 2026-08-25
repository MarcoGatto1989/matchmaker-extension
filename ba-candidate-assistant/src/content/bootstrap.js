(() => {
  const root = globalThis.BAKandidaten;
  if (!root || globalThis.__baKandidatenBootstrapped) return;
  globalThis.__baKandidatenBootstrapped = true;
  root.panel.ensureHost();

  let timer = null;
  let lastSignature = '';

  function signature(value) {
    try { return JSON.stringify(value).slice(0, 12000); } catch { return String(Date.now()); }
  }

  async function inspect() {
    timer = null;
    const profile = root.profileAdapter.parseVisibleProfile(document);
    if (profile) {
      const next = `profile:${profile.reference || ''}:${profile.desiredRoles?.join('|')}:${profile.skills?.slice(0, 5).join('|')}`;
      if (next !== lastSignature) {
        lastSignature = next;
        await root.panel.loadProfile(profile);
      }
      return;
    }

    if (root.searchAdapter.isSearchPage(location, document)) {
      const cards = root.searchAdapter.extractVisibleSearchCards(document);
      const next = `search:${signature(cards)}`;
      if (next !== lastSignature) {
        lastSignature = next;
        await root.panel.renderSearch(cards);
      }
      return;
    }

    if (lastSignature !== 'unsupported') {
      lastSignature = 'unsupported';
      root.panel.renderUnsupported();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(inspect, 350);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-hidden', 'class'] });
  window.addEventListener('popstate', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  schedule();
})();
