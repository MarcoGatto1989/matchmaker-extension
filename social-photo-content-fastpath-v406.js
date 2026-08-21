// ESOS AI v4.0.6 — exact-profile DOM fast path.
// When the browser worker is already showing the requested profile, answer from the
// rendered page only. This prevents XING fallback fetches from mistaking JS assets
// for profile images and turns a genuine missing portrait into a clean not_found.
(() => {
  'use strict';

  if (globalThis.__ESOS_SOCIAL_PHOTO_FASTPATH_V406__) return;
  globalThis.__ESOS_SOCIAL_PHOTO_FASTPATH_V406__ = true;

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normalize = raw => {
    try {
      const value = String(raw || '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\\u002F/gi, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/\\\//g, '/')
        .replace(/[),;]+$/, '');
      const url = new URL(value, location.href);
      return url.protocol === 'https:' ? url.toString() : '';
    } catch (_) {
      return '';
    }
  };

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
        return match?.[1] ? `linkedin:in:${decodeURIComponent(match[1]).toLowerCase()}` : '';
      }
      if (provider === 'xing') {
        const match = path.match(/^\/profile\/([^/]+)/i);
        if (match?.[1]) return `xing:profile:${decodeURIComponent(match[1]).toLowerCase()}`;
        const page = path.match(/^\/pages\/([^/]+)/i);
        return page?.[1] ? `xing:pages:${decodeURIComponent(page[1]).toLowerCase()}` : '';
      }
      return '';
    } catch (_) {
      return '';
    }
  };

  const obviousNonImage = raw => {
    try {
      const url = new URL(raw);
      const path = url.pathname.toLowerCase();
      return /\.(?:js|mjs|css|json|map|woff2?|ttf|otf|svg)(?:$|[/?#])/.test(path)
        || /(?:javascript|webpack|chunk|runtime|polyfill|stylesheet|font)/i.test(path);
    } catch (_) {
      return true;
    }
  };

  const allowedImage = (raw, network) => {
    const value = normalize(raw);
    if (!value || obviousNonImage(value)) return '';
    try {
      const url = new URL(value);
      const lower = value.toLowerCase();
      if (/ghost|default[-_ ]?avatar|favicon|company[-_ ]?logo|\blogo\b|banner|sprite|icon/.test(lower)) return '';
      const host = url.hostname.toLowerCase();
      const allowed = network === 'linkedin'
        ? (host.endsWith('licdn.com') || host.endsWith('linkedin.com'))
        : (host.includes('xing') || host.endsWith('ctfassets.net') || host.endsWith('xingassets.com'));
      return allowed ? value : '';
    } catch (_) {
      return '';
    }
  };

  const currentSrc = img => {
    const marked = normalize(img.getAttribute?.('data-esos-profile-photo-src'));
    if (marked) return marked;
    const direct = normalize(img.currentSrc || img.src || img.getAttribute?.('src'));
    if (direct) return direct;
    const srcset = String(img.getAttribute?.('srcset') || img.getAttribute?.('data-srcset') || '')
      .split(',')
      .map(part => normalize(part.trim().split(/\s+/)[0]))
      .filter(Boolean);
    return srcset[srcset.length - 1] || normalize(img.getAttribute?.('data-src'));
  };

  const backgroundUrl = element => {
    try {
      const value = getComputedStyle(element).backgroundImage || '';
      const match = value.match(/url\(["']?([^"')]+)["']?\)/i);
      return normalize(match?.[1]);
    } catch (_) {
      return '';
    }
  };

  const collectRendered = network => {
    const name = clean(document.querySelector('main h1, h1')?.textContent).toLowerCase();
    const scored = [];
    const seenNodes = new Set();

    const score = (element, rawUrl, alt = '', boost = 0) => {
      if (!element || seenNodes.has(element)) return;
      const url = allowedImage(rawUrl, network);
      if (!url) return;
      seenNodes.add(element);

      let rect = { width: 0, height: 0, top: 0, left: 0 };
      try { rect = element.getBoundingClientRect(); } catch (_) {}
      const naturalWidth = Number(element.naturalWidth || 0);
      const naturalHeight = Number(element.naturalHeight || 0);
      const width = Number(rect.width || naturalWidth || 0);
      const height = Number(rect.height || naturalHeight || 0);
      if (width < 48 || height < 48) return;

      let points = boost;
      const ratio = width / Math.max(1, height);
      if (ratio >= .72 && ratio <= 1.38) points += 8;
      if (width >= 80 && height >= 80) points += 4;
      if (width >= 120 && height >= 120) points += 2;
      if (rect.top >= -150 && rect.top <= 950) points += 5;
      if (rect.left >= -30 && rect.left <= Math.max(window.innerWidth * .75, 900)) points += 2;
      const altText = clean(alt).toLowerCase();
      if (name && altText && (altText.includes(name) || name.includes(altText))) points += 12;
      try { if (element.closest?.('nav, [role="navigation"], footer')) points -= 14; } catch (_) {}
      scored.push({ url, points });
    };

    for (const marked of document.querySelectorAll('[data-esos-profile-photo="true"]')) {
      const url = marked instanceof HTMLImageElement ? currentSrc(marked) : backgroundUrl(marked);
      score(marked, url, marked.getAttribute?.('alt') || marked.getAttribute?.('aria-label') || '', 35);
    }

    for (const img of Array.from(document.querySelectorAll('main img, [role="main"] img, article img, section img')).slice(0, 900)) {
      score(img, currentSrc(img), img.getAttribute('alt') || '', 0);
    }

    for (const element of Array.from(document.querySelectorAll('main *, [role="main"] *')).slice(0, 1600)) {
      const url = backgroundUrl(element);
      if (url) score(element, url, element.getAttribute?.('aria-label') || '', 1);
    }

    const seenUrls = new Set();
    return scored
      .sort((a, b) => b.points - a.points)
      .filter(item => item.points >= 6 && !seenUrls.has(item.url) && seenUrls.add(item.url))
      .slice(0, 10)
      .map(item => item.url);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ESOS_SOCIAL_PHOTO_PROFILE_CANDIDATES') return;

    const network = String(message.network || '').toLowerCase();
    const currentNetwork = providerForHost(location.hostname);
    if (!currentNetwork || currentNetwork !== network) return;

    const requestedKey = canonicalProfileKey(message.profileUrl);
    const currentKey = canonicalProfileKey(location.href);
    if (!requestedKey || requestedKey !== currentKey) return;

    const imageUrls = collectRendered(network);
    sendResponse(imageUrls.length
      ? { outcome: 'found_candidates', imageUrls, source: 'rendered_dom_v406' }
      : { outcome: 'not_found', source: 'rendered_dom_v406' });

    // This exact-profile answer is definitive for this pass. The background worker
    // performs its own delayed second DOM pass before accepting not_found.
    return false;
  });
})();
