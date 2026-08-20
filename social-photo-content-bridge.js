// Same-provider bridge for social profile photos.
// Runs inside an already-open LinkedIn/XING tab and returns candidate image URLs.
// It first reuses the rendered authenticated DOM, then tries a same-origin profile
// request with the browser session, and finally retries without cookies before the
// server-side fallback is ever needed.
(() => {
  'use strict';

  const normalize = raw => String(raw || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/[),;]+$/, '');

  const providerForHost = host => {
    const normalized = String(host || '').replace(/^www\./, '').toLowerCase();
    if (normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com')) return 'linkedin';
    if (normalized === 'xing.com' || normalized.endsWith('.xing.com')) return 'xing';
    return null;
  };

  const canonicalProfileKey = raw => {
    try {
      const url = new URL(String(raw || ''));
      return `${providerForHost(url.hostname) || ''}:${url.pathname.replace(/\/$/, '').toLowerCase()}`;
    } catch (_) {
      return '';
    }
  };

  const isAllowedImage = (value, network) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') return false;
      const lower = value.toLowerCase();
      if (/ghost|default[-_ ]?avatar|favicon|logo|company[-_ ]?logo|background[-_ ]?image|banner|sprite|icon/.test(lower)) return false;
      const host = parsed.hostname.toLowerCase();
      return network === 'linkedin'
        ? (host.endsWith('licdn.com') || host.endsWith('linkedin.com'))
        : (host.includes('xing') || host.endsWith('ctfassets.net') || host.endsWith('xingassets.com'));
    } catch (_) {
      return false;
    }
  };

  const pushCandidate = (list, value) => {
    const normalized = normalize(value);
    if (normalized) list.push(normalized);
  };

  const collectFromDom = (root, network) => {
    const candidates = [];
    if (!root?.querySelectorAll) return candidates;

    for (const node of root.querySelectorAll('[data-esos-profile-photo="true"], img')) {
      if (!(node instanceof HTMLImageElement)) continue;
      pushCandidate(candidates, node.getAttribute('data-esos-profile-photo-src'));
      pushCandidate(candidates, node.currentSrc);
      pushCandidate(candidates, node.src);
      const srcset = String(node.getAttribute('srcset') || '').split(',');
      for (const part of srcset) pushCandidate(candidates, part.trim().split(/\s+/)[0]);
    }

    for (const node of root.querySelectorAll('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"],meta[name="twitter:image:src"]')) {
      pushCandidate(candidates, node.getAttribute('content'));
    }

    const seen = new Set();
    return candidates.filter(value => {
      if (!isAllowedImage(value, network) || seen.has(value)) return false;
      seen.add(value);
      return true;
    }).slice(0, 16);
  };

  const collectFromHtml = (html, network) => {
    const candidates = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const value of collectFromDom(doc, network)) pushCandidate(candidates, value);
      for (const node of doc.querySelectorAll('img')) {
        pushCandidate(candidates, node.getAttribute('src'));
        pushCandidate(candidates, node.getAttribute('data-src'));
        const srcset = String(node.getAttribute('srcset') || node.getAttribute('data-srcset') || '').split(',');
        for (const part of srcset) pushCandidate(candidates, part.trim().split(/\s+/)[0]);
      }
    } catch (_) {}

    const directPattern = /https?:\\?\/\\?\/[^"'\s<>]+/ig;
    let match;
    while ((match = directPattern.exec(html)) && candidates.length < 180) pushCandidate(candidates, match[0]);

    const seen = new Set();
    const imageUrls = [];
    for (const raw of candidates) {
      const value = normalize(raw);
      if (!value || seen.has(value) || !isAllowedImage(value, network)) continue;
      seen.add(value);
      imageUrls.push(value);
      if (imageUrls.length >= 16) break;
    }
    return imageUrls;
  };

  const fetchProfileCandidates = async (url, network, credentials) => {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      credentials,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7'
      }
    });

    if (!response.ok) {
      return { outcome: 'error', error: `${network}: Provider-Tab Profil HTTP ${response.status} (${credentials})` };
    }

    const finalUrl = new URL(response.url);
    const finalNetwork = providerForHost(finalUrl.hostname);
    if (finalNetwork !== network || /login|signin|auth/i.test(finalUrl.pathname)) {
      return { outcome: 'error', error: `${network}: Provider-Tab auf Login/andere Seite umgeleitet (${credentials})` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { outcome: 'error', error: `${network}: Provider-Tab lieferte kein HTML (${contentType})` };
    }

    const html = (await response.text()).slice(0, 2_500_000);
    if (!html) return { outcome: 'error', error: `${network}: Provider-Tab Profilseite leer (${credentials})` };
    const imageUrls = collectFromHtml(html, network);
    return imageUrls.length
      ? { outcome: 'found_candidates', imageUrls }
      : { outcome: 'not_found' };
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

      // Best path: if this exact profile is already open, read the fully rendered
      // authenticated DOM. Modern XING/LinkedIn often hydrate the avatar only after
      // page load, so a raw HTML request alone can miss it.
      if (canonicalProfileKey(requested.toString()) === canonicalProfileKey(location.href)) {
        const rendered = collectFromDom(document, currentNetwork);
        if (rendered.length) {
          sendResponse({ outcome: 'found_candidates', imageUrls: rendered, source: 'rendered_dom' });
          return;
        }
      }

      // Force the already-open provider origin while keeping the requested profile path.
      requested.protocol = location.protocol;
      requested.host = location.host;
      requested.hash = '';

      const errors = [];
      let hadCleanNoPhoto = false;

      // First try the logged-in browser session.
      try {
        const authenticated = await fetchProfileCandidates(requested.toString(), currentNetwork, 'include');
        if (authenticated.outcome === 'found_candidates') {
          sendResponse(authenticated);
          return;
        }
        if (authenticated.outcome === 'not_found') hadCleanNoPhoto = true;
        else if (authenticated.error) errors.push(authenticated.error);
      } catch (error) {
        errors.push(`${currentNetwork}: Provider-Tab ${error?.message || 'Abruf fehlgeschlagen'} (include)`);
      }

      // XING in particular can serve a SPA/404 to authenticated fetches while the
      // public SSR page contains the avatar. Retry from the same browser/provider
      // tab without cookies before falling back to the ESOS server.
      try {
        const sessionless = await fetchProfileCandidates(requested.toString(), currentNetwork, 'omit');
        if (sessionless.outcome === 'found_candidates') {
          sendResponse({ ...sessionless, source: 'provider_tab_public_retry' });
          return;
        }
        if (sessionless.outcome === 'not_found') hadCleanNoPhoto = true;
        else if (sessionless.error) errors.push(sessionless.error);
      } catch (error) {
        errors.push(`${currentNetwork}: Provider-Tab ${error?.message || 'Abruf fehlgeschlagen'} (omit)`);
      }

      if (hadCleanNoPhoto && errors.length === 0) {
        sendResponse({ outcome: 'not_found' });
        return;
      }
      sendResponse({
        outcome: 'error',
        error: errors.filter(Boolean).slice(0, 4).join(' | ') || `${currentNetwork}: Provider-Tab-Abruf fehlgeschlagen`
      });
    })();

    return true;
  });
})();
