// ESOS AI profile-photo DOM detector.
// Marks the real rendered profile image so the existing profile scraper and
// the social-photo bridge can reuse one robust source of truth.
(() => {
  'use strict';

  const provider = location.hostname.includes('linkedin.com')
    ? 'linkedin'
    : location.hostname.includes('xing.com') ? 'xing' : null;
  if (!provider) return;

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeUrl = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      return url.protocol === 'https:' ? url.toString() : '';
    } catch (_) {
      return '';
    }
  };

  const bestSrc = img => {
    const direct = normalizeUrl(img.currentSrc || img.src);
    if (direct) return direct;
    const srcset = String(img.getAttribute('srcset') || '')
      .split(',')
      .map(part => part.trim().split(/\s+/)[0])
      .map(normalizeUrl)
      .filter(Boolean);
    return srcset[srcset.length - 1] || '';
  };

  const knownHost = src => {
    try {
      const host = new URL(src).hostname.toLowerCase();
      return provider === 'linkedin'
        ? (host.endsWith('licdn.com') || host.endsWith('linkedin.com'))
        : (host.includes('xing') || host.endsWith('ctfassets.net') || host.endsWith('xingassets.com'));
    } catch (_) {
      return false;
    }
  };

  const candidateScore = img => {
    const src = bestSrc(img);
    if (!src) return -1000;
    const lower = `${src} ${img.alt || ''} ${img.className || ''}`.toLowerCase();
    if (/ghost|default[-_ ]?avatar|favicon|company[-_ ]?logo|logo|banner|background|sprite|icon/.test(lower)) return -1000;

    const rect = img.getBoundingClientRect();
    const width = rect.width || img.naturalWidth || 0;
    const height = rect.height || img.naturalHeight || 0;
    if (width < 48 || height < 48) return -1000;

    let score = 0;
    const ratio = width / Math.max(1, height);
    if (ratio >= 0.75 && ratio <= 1.33) score += 6;
    if (width >= 80 && height >= 80) score += 4;
    if (width >= 120 && height >= 120) score += 2;
    if (rect.top >= -100 && rect.top <= 900) score += 4;
    if (rect.left >= 0 && rect.left <= Math.max(window.innerWidth * 0.65, 800)) score += 2;
    if (knownHost(src)) score += 5;

    const name = clean(document.querySelector('main h1, h1')?.textContent).toLowerCase();
    const alt = clean(img.alt).toLowerCase();
    if (name && alt && (alt.includes(name) || name.includes(alt))) score += 8;

    const ancestry = clean(img.closest('main, [role="main"], section, article')?.textContent).toLowerCase();
    if (name && ancestry.includes(name)) score += 3;
    if (img.closest('nav, [role="navigation"], footer')) score -= 8;
    return score;
  };

  const explicitSelectors = provider === 'linkedin'
    ? [
        '.pv-top-card-profile-picture__image--show',
        '.profile-photo-edit__preview',
        'img.pv-top-card-profile-picture__image',
        'main img[alt][src*="licdn"]',
        'main img[src*="profile-displayphoto"]'
      ]
    : [
        '.EntityInfo-entity-image img',
        '[data-qa="profile-image"] img',
        'img.headstone-image',
        'main img[src*="xing"]',
        'main img[src*="ctfassets"]'
      ];

  const detect = () => {
    let best = null;
    let bestScore = -1000;

    for (const selector of explicitSelectors) {
      for (const img of document.querySelectorAll(selector)) {
        const score = candidateScore(img) + 20;
        if (score > bestScore) {
          best = img;
          bestScore = score;
        }
      }
    }

    for (const img of document.querySelectorAll('main img, [role="main"] img, article img, section img')) {
      const score = candidateScore(img);
      if (score > bestScore) {
        best = img;
        bestScore = score;
      }
    }

    if (!best || bestScore < 6) return;
    const src = bestSrc(best);
    if (!src) return;

    document.querySelectorAll('[data-esos-profile-photo="true"]').forEach(node => {
      if (node !== best) node.removeAttribute('data-esos-profile-photo');
    });

    best.setAttribute('data-esos-profile-photo', 'true');
    best.setAttribute('data-esos-profile-photo-src', src);
    // Compatibility classes consumed by the existing scraper.
    best.classList.add('headstone-image');
    best.classList.add('pv-top-card-profile-picture__image');
    best.classList.add('pv-top-card-profile-picture__image--show');
  };

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(detect, 120);
  };

  detect();
  setTimeout(detect, 600);
  setTimeout(detect, 1800);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
  window.addEventListener('popstate', schedule, true);
})();
