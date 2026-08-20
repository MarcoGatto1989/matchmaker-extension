// Same-provider bridge for social profile photos.
// Runs inside an already-open LinkedIn/XING tab and returns candidate image URLs.
// v4.0.4: exact-profile DOM -> hidden same-origin rendered profile -> provider fetches.
(() => {
  'use strict';

  if (globalThis.__ESOS_SOCIAL_PHOTO_BRIDGE_V404__) return;
  globalThis.__ESOS_SOCIAL_PHOTO_BRIDGE_V404__ = true;

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
      const provider = providerForHost(url.hostname);
      const path = url.pathname.replace(/\/+$/, '');
      if (provider === 'linkedin') {
        const match = path.match(/^\/in\/([^/]+)/i);
        return match?.[1] ? `linkedin:in:${decodeURIComponent(match[1]).toLowerCase()}` : `linkedin:${path.toLowerCase()}`;
      }
      if (provider === 'xing') {
        const profile = path.match(/^\/profile\/([^/]+)/i);
        if (profile?.[1]) return `xing:profile:${decodeURIComponent(profile[1]).toLowerCase()}`;
        const page = path.match(/^\/pages\/([^/]+)/i);
        if (page?.[1]) return `xing:pages:${decodeURIComponent(page[1]).toLowerCase()}`;
        return `xing:${path.toLowerCase()}`;
      }
      return '';
    } catch (_) {
      return '';
    }
  };

  const isAllowedImage = (value, network) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') return false;
      const lower = value.toLowerCase();
      if (/ghost|default[-_ ]?avatar|favicon|company[-_ ]?logo|\blogo\b|banner|sprite|icon/.test(lower)) return false;
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

  const imageSrc = node => {
    if (!node) return '';
    const marked = normalize(node.getAttribute?.('data-esos-profile-photo-src'));
    if (marked) return marked;
    if (String(node.tagName || '').toUpperCase() === 'IMG') {
      const direct = normalize(node.currentSrc || node.src || node.getAttribute?.('src'));
      if (direct) return direct;
      const srcset = String(node.getAttribute?.('srcset') || node.getAttribute?.('data-srcset') || '')
        .split(',')
        .map(part => part.trim().split(/\s+/)[0])
        .map(normalize)
        .filter(Boolean);
      if (srcset.length) return srcset[srcset.length - 1];
      return normalize(node.getAttribute?.('data-src'));
    }
    return '';
  };

  const computedBackgroundUrl = (node, view) => {
    if (!node || !view?.getComputedStyle) return '';
    try {
      const value = view.getComputedStyle(node).backgroundImage || '';
      const match = value.match(/url\(["']?([^"')]+)["']?\)/i);
      return normalize(match?.[1]);
    } catch (_) {
      return '';
    }
  };

  const collectFromRenderedDom = (root, network) => {
    const documentRoot = root?.nodeType === 9 ? root : root?.ownerDocument || document;
    if (!documentRoot?.querySelectorAll) return [];
    const view = documentRoot.defaultView || window;
    const name = String(documentRoot.querySelector('main h1, h1')?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const scored = [];
    const seenNodes = new Set();

    const scoreNode = (node, rawUrl, alt = '', boost = 0) => {
      const url = normalize(rawUrl);
      if (!url || !isAllowedImage(url, network) || seenNodes.has(node)) return;
      seenNodes.add(node);

      let rect = { width: 0, height: 0, top: 0, left: 0 };
      try { rect = node.getBoundingClientRect(); } catch (_) {}
      const naturalWidth = Number(node.naturalWidth || 0);
      const naturalHeight = Number(node.naturalHeight || 0);
      const width = Number(rect.width || naturalWidth || 0);
      const height = Number(rect.height || naturalHeight || 0);
      if (width < 40 || height < 40) return;

      let score = boost;
      const ratio = width / Math.max(1, height);
      if (ratio >= .72 && ratio <= 1.38) score += 8;
      if (width >= 80 && height >= 80) score += 4;
      if (width >= 120 && height >= 120) score += 2;
      if (rect.top >= -150 && rect.top <= 950) score += 5;
      if (rect.left >= -30 && rect.left <= Math.max((view.innerWidth || 1200) * .75, 900)) score += 2;
      const altText = String(alt || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (name && altText && (altText.includes(name) || name.includes(altText))) score += 11;
      try {
        if (node.closest?.('nav, [role="navigation"], footer')) score -= 12;
      } catch (_) {}
      scored.push({ url, score });
    };

    for (const marked of documentRoot.querySelectorAll('[data-esos-profile-photo="true"]')) {
      const url = imageSrc(marked) || computedBackgroundUrl(marked, view);
      scoreNode(marked, url, marked.getAttribute?.('alt') || marked.getAttribute?.('aria-label') || '', 30);
    }

    for (const img of Array.from(documentRoot.querySelectorAll('main img, [role="main"] img, article img, section img')).slice(0, 900)) {
      scoreNode(img, imageSrc(img), img.getAttribute?.('alt') || '', 0);
    }

    // Some XING layouts render the portrait as a CSS background rather than an <img>.
    for (const node of Array.from(documentRoot.querySelectorAll('main *, [role="main"] *')).slice(0, 1600)) {
      const url = computedBackgroundUrl(node, view);
      if (url) scoreNode(node, url, node.getAttribute?.('aria-label') || '', 1);
    }

    const seenUrls = new Set();
    return scored
      .sort((a, b) => b.score - a.score)
      .filter(item => item.score >= 5 && !seenUrls.has(item.url) && seenUrls.add(item.url))
      .slice(0, 12)
      .map(item => item.url);
  };

  const collectFromHtml = (html, network) => {
    const candidates = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const node of doc.querySelectorAll('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"],meta[name="twitter:image:src"]')) {
        pushCandidate(candidates, node.getAttribute('content'));
      }
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

  const renderProfileInHiddenFrame = (url, network) => new Promise(resolve => {
    let settled = false;
    const frame = document.createElement('iframe');
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { frame.remove(); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ outcome: 'error', error: `${network}: verstecktes Provider-Profil Zeitüberschreitung` });
    }, 12000);

    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.position = 'fixed';
    frame.style.left = '-12000px';
    frame.style.top = '-12000px';
    frame.style.width = '1280px';
    frame.style.height = '900px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.border = '0';

    frame.onload = async () => {
      try {
        // Let provider hydration/lazy images settle while the frame remains fully rendered off-screen.
        await new Promise(r => setTimeout(r, 950));
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        if (!doc || !win) {
          finish({ outcome: 'error', error: `${network}: verstecktes Provider-Profil nicht lesbar` });
          return;
        }
        const finalUrl = new URL(win.location.href);
        if (providerForHost(finalUrl.hostname) !== network || /login|signin|auth/i.test(finalUrl.pathname)) {
          finish({ outcome: 'error', error: `${network}: verstecktes Provider-Profil auf Login/andere Seite umgeleitet` });
          return;
        }
        const imageUrls = collectFromRenderedDom(doc, network);
        if (imageUrls.length) {
          finish({ outcome: 'found_candidates', imageUrls, source: 'hidden_provider_frame' });
          return;
        }
        finish({ outcome: 'not_found' });
      } catch (error) {
        finish({ outcome: 'error', error: `${network}: verstecktes Provider-Profil ${error?.message || 'nicht zugänglich'}` });
      }
    };

    frame.onerror = () => finish({ outcome: 'error', error: `${network}: verstecktes Provider-Profil konnte nicht geladen werden` });
    frame.src = url;
    (document.body || document.documentElement).appendChild(frame);
  });

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

      const errors = [];
      let hadCleanNoPhoto = false;

      // Best path: if any subpage of this exact person is already open, use its
      // fully rendered DOM. XING /profile/name and /profile/name/web_profiles are
      // the same candidate and must not be treated as different profiles.
      if (canonicalProfileKey(requested.toString()) === canonicalProfileKey(location.href)) {
        const rendered = collectFromRenderedDom(document, currentNetwork);
        if (rendered.length) {
          sendResponse({ outcome: 'found_candidates', imageUrls: rendered, source: 'rendered_dom' });
          return;
        }
      }

      // Keep the request on the already-open provider origin.
      requested.protocol = location.protocol;
      requested.host = location.host;
      requested.hash = '';

      // Primary direct route for other candidates: render the profile invisibly in
      // the existing provider page. This uses the logged-in browser session, runs
      // provider hydration and opens no new tab/window.
      try {
        const hiddenFrame = await renderProfileInHiddenFrame(requested.toString(), currentNetwork);
        if (hiddenFrame.outcome === 'found_candidates') {
          sendResponse(hiddenFrame);
          return;
        }
        if (hiddenFrame.outcome === 'not_found') hadCleanNoPhoto = true;
        else if (hiddenFrame.error) errors.push(hiddenFrame.error);
      } catch (error) {
        errors.push(`${currentNetwork}: verstecktes Provider-Profil ${error?.message || 'Abruf fehlgeschlagen'}`);
      }

      // Technical backup: same-origin fetch with the logged-in session.
      try {
        const authenticated = await fetchProfileCandidates(requested.toString(), currentNetwork, 'include');
        if (authenticated.outcome === 'found_candidates') {
          sendResponse({ ...authenticated, source: 'provider_authenticated_fetch' });
          return;
        }
        if (authenticated.outcome === 'not_found') hadCleanNoPhoto = true;
        else if (authenticated.error) errors.push(authenticated.error);
      } catch (error) {
        errors.push(`${currentNetwork}: Provider-Tab ${error?.message || 'Abruf fehlgeschlagen'} (include)`);
      }

      // Last browser-side retry without cookies before the ESOS server fallback.
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