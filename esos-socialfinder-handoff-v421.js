(() => {
  if (window.__ESOS_SOCIALFINDER_HANDOFF_V421__) return;
  window.__ESOS_SOCIALFINDER_HANDOFF_V421__ = true;

  const SUCCESS_KEY = 'esos_network_sync_success_urls_v1';
  const META_KEY = 'esos_socialfinder_profile_metadata_v421';
  const SEEN_KEY = 'esos_socialfinder_handoff_seen_v421';

  const canon = (value) => String(value || '').trim().replace(/\/+$/, '').toLowerCase();

  async function read(keys) {
    return chrome.storage.local.get(keys);
  }

  async function deliver() {
    const fields = Array.from(document.querySelectorAll('[data-esos-socialfinder-link-input]'));
    if (!fields.length) return;

    const stored = await read([SUCCESS_KEY, META_KEY, SEEN_KEY]);
    const successes = Array.isArray(stored[SUCCESS_KEY]) ? stored[SUCCESS_KEY] : [];
    const metadata = stored[META_KEY] && typeof stored[META_KEY] === 'object' ? stored[META_KEY] : {};
    const seen = stored[SEEN_KEY] && typeof stored[SEEN_KEY] === 'object' ? stored[SEEN_KEY] : {};
    const nextSeen = { ...seen };
    const deliveredMetadata = [];

    for (const field of fields) {
      const network = String(field.getAttribute('data-esos-socialfinder-link-input') || '').toLowerCase();
      if (!['linkedin', 'xing'].includes(network)) continue;

      const existing = new Set(String(field.value || '').split(/\s+/).map(canon).filter(Boolean));
      const pending = successes.filter((entry) => {
        const url = canon(entry?.url);
        if (!url || String(entry?.network || '').toLowerCase() !== network) return false;
        const deliveryKey = network + '|' + url;
        return !seen[deliveryKey] && !existing.has(url);
      });
      if (!pending.length) continue;

      const current = String(field.value || '').replace(/\s+$/g, '');
      const addition = pending.map((entry) => String(entry.url || '').trim()).filter(Boolean).join('\n');
      const nextValue = [current, addition].filter(Boolean).join(current && addition ? '\n' : '');

      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor?.set) descriptor.set.call(field, nextValue + (nextValue ? '\n' : ''));
      else field.value = nextValue + (nextValue ? '\n' : '');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));

      for (const entry of pending) {
        const url = canon(entry.url);
        nextSeen[network + '|' + url] = new Date().toISOString();
        const record = metadata[url];
        if (record) deliveredMetadata.push(record);
      }
    }

    if (deliveredMetadata.length) {
      window.dispatchEvent(new CustomEvent('esos-ai-profile-metadata', {
        detail: { records: deliveredMetadata },
      }));
    }

    await chrome.storage.local.set({ [SEEN_KEY]: nextSeen });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SUCCESS_KEY] || changes[META_KEY]) setTimeout(deliver, 80);
  });

  const observer = new MutationObserver(() => {
    if (document.querySelector('[data-esos-socialfinder-link-input]')) deliver();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(deliver, 150);
})();