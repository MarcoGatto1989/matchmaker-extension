// Same-provider bridge for social profile photos.
// Runs inside an already-open LinkedIn/XING tab and only returns candidate image URLs.
// No credentials, cookies or tokens are read or transferred by this script.
(() => {
  const normalize = (raw) => String(raw || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/[),;]+$/, '');

  const providerForHost = (host) => {
    const normalized = String(host || '').replace(/^www\./, '').toLowerCase();
    if (normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com')) return 'linkedin';
    if (normalized === 'xing.com' || normalized.endsWith('.xing.com')) return 'xing';
    return null;
  };

  const isAllowedImage = (value, network) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') return false;
      const lower = value.toLowerCase();
      if (/ghost|default[-_]?avatar|favicon|logo|company[-_]?logo|background[-_]?image|banner/.test(lower)) return false;
      const host = parsed.hostname.toLowerCase();
      return network === 'linkedin'
        ? (host.endsWith('licdn.com') || host.endsWith('linkedin.com'))
        : (host.includes('xing') || host.endsWith('ctfassets.net') || host.endsWith('xingassets.com'));
    } catch (_) {
      return false;
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ESOS_SOCIAL_PHOTO_PROFILE_CANDIDATES') return;

    (async () => {
      const requestedNetwork = String(message.network || '').toLowerCase();
      let requested;
      try { requested = new URL(String(message.profileUrl || '')); } catch (_) { requested = null; }
      const currentNetwork = providerForHost(location.hostname);
      const requestedNetworkFromHost = providerForHost(requested?.hostname);

      if (!requested || requested.protocol !== 'https:' || !currentNetwork || requestedNetworkFromHost !== currentNetwork || requestedNetwork !== currentNetwork) {
        sendResponse({ outcome: 'error', error: `${requestedNetwork || 'social'}: Provider-Tab passt nicht zum Profil` });
        return;
      }

      // Force the already-open provider origin. This avoids extension-origin/CORS behavior
      // while keeping the exact public profile path intact.
      requested.protocol = location.protocol;
      requested.host = location.host;
      requested.hash = '';

      try {
        const response = await fetch(requested.toString(), {
          method: 'GET',
          cache: 'no-store',
          redirect: 'follow',
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        if (!response.ok) {
          sendResponse({ outcome: 'error', error: `${currentNetwork}: Provider-Tab Profil HTTP ${response.status}` });
          return;
        }

        const finalNetwork = providerForHost(new URL(response.url).hostname);
        if (finalNetwork !== currentNetwork || /login|signin|auth/i.test(new URL(response.url).pathname)) {
          sendResponse({ outcome: 'error', error: `${currentNetwork}: Provider-Tab auf Login/andere Seite umgeleitet` });
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          sendResponse({ outcome: 'error', error: `${currentNetwork}: Provider-Tab lieferte kein HTML (${contentType})` });
          return;
        }

        const html = (await response.text()).slice(0, 2_500_000);
        if (!html) {
          sendResponse({ outcome: 'error', error: `${currentNetwork}: Provider-Tab Profilseite leer` });
          return;
        }

        const candidates = [];
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          for (const node of doc.querySelectorAll('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"],meta[name="twitter:image:src"]')) {
            const value = node.getAttribute('content');
            if (value) candidates.push(value);
          }
        } catch (_) {}

        const directPattern = /https?:\\?\/\\?\/[^"'\s<>]+/ig;
        let match;
        while ((match = directPattern.exec(html)) && candidates.length < 120) candidates.push(match[0]);

        const imageUrls = [];
        const seen = new Set();
        for (const raw of candidates) {
          const value = normalize(raw);
          if (!value || seen.has(value) || !isAllowedImage(value, currentNetwork)) continue;
          seen.add(value);
          imageUrls.push(value);
          if (imageUrls.length >= 12) break;
        }

        sendResponse(imageUrls.length
          ? { outcome: 'found_candidates', imageUrls }
          : { outcome: 'not_found' });
      } catch (error) {
        sendResponse({ outcome: 'error', error: `${currentNetwork}: Provider-Tab ${error?.message || 'Abruf fehlgeschlagen'}` });
      }
    })();

    return true;
  });
})();
