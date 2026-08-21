// ESOS AI v4.0.7 — robust identity extraction for XING manual import.
// Handles polluted H1 content (membership badges/promotional copy) before content.js.
(() => {
  'use strict';

  if (globalThis.__ESOS_PROFILE_IDENTITY_V407__) return;
  globalThis.__ESOS_PROFILE_IDENTITY_V407__ = true;

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element) return false;
    try {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    } catch (_) {
      return true;
    }
  };

  const firstVisible = selectors => {
    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector)).find(visible);
      if (found) return found;
    }
    return null;
  };

  const noisePattern = /(https?:\/\/|www\.|werde\s+jetzt|premium|basis|basic|professional|business|mitgliedschaft|membership|profil\s+bearbeiten|kontaktieren|nachricht)/i;

  function trimNoise(value) {
    let result = clean(value);
    if (!result) return '';
    result = result
      .replace(/(?:premium|basis|basic|professional|business).*$/i, '')
      .replace(/werde\s+jetzt.*$/i, '')
      .replace(/https?:\/\/.*$/i, '')
      .replace(/www\..*$/i, '')
      .replace(/[|•·]+$/g, '')
      .trim();
    return result;
  }

  function xingSlugName() {
    const match = location.pathname.match(/^\/profile\/([^/]+)/i);
    if (!match?.[1]) return '';
    try {
      return clean(decodeURIComponent(match[1]).replace(/[_+]+/g, ' '));
    } catch (_) {
      return clean(match[1].replace(/[_+]+/g, ' '));
    }
  }

  function nameScore(value, slugName) {
    const text = trimNoise(value);
    if (!text || text.length < 3 || text.length > 90 || noisePattern.test(text)) return -1000;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 7) return -1000;
    if (tokens.some(token => /[:/@]|\d{4,}/.test(token))) return -1000;
    let score = 10;
    if (tokens.length >= 2 && tokens.length <= 4) score += 8;
    if (/^[\p{L}.'’\-\s]+$/u.test(text)) score += 6;
    const slugTokens = clean(slugName).toLocaleLowerCase('de-DE').split(/\s+/).filter(Boolean);
    const lower = text.toLocaleLowerCase('de-DE');
    if (slugTokens.length >= 2 && slugTokens.every(token => lower.includes(token))) score += 14;
    return score;
  }

  function robustNameText() {
    const slugName = xingSlugName();
    const candidates = [];
    const roots = [
      firstVisible(['[data-qa="profile-name"]']),
      firstVisible(['h1.headstone-name']),
      firstVisible(['.EntityInfo-entity-name']),
      firstVisible(['main h1', 'h1'])
    ].filter(Boolean);

    for (const root of roots) {
      candidates.push(root.getAttribute?.('aria-label') || '');
      candidates.push(root.getAttribute?.('title') || '');

      // Direct text nodes are important on current XING: the real name often sits
      // next to nested Premium/promo elements inside the same H1.
      for (const node of Array.from(root.childNodes || [])) {
        if (node.nodeType === Node.TEXT_NODE) candidates.push(node.textContent || '');
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let textNode;
      let count = 0;
      while ((textNode = walker.nextNode()) && count < 40) {
        count += 1;
        const parent = textNode.parentElement;
        if (parent?.closest('button, a, [role="button"], [data-qa*="badge" i]')) continue;
        candidates.push(textNode.textContent || '');
      }

      candidates.push(root.textContent || '');
    }
    if (slugName) candidates.push(slugName);

    let best = '';
    let bestScore = -1000;
    for (const raw of candidates) {
      const value = trimNoise(raw);
      const score = nameScore(value, slugName);
      if (score > bestScore) {
        best = value;
        bestScore = score;
      }
    }

    // The profile slug is a safer fallback than a contaminated H1.
    if ((!best || bestScore < 10) && nameScore(slugName, slugName) > -1000) return slugName;
    return best || slugName;
  }

  function parseName(fullName) {
    const tokens = clean(fullName).split(/\s+/).filter(Boolean);
    const titleTokens = [];
    const nameTokens = [];
    const titlePattern = /^(prof\.?|dr\.?|dipl\.?-?|mba|ll\.?m\.?|m\.sc\.?|b\.sc\.?|wp|stb|ra)$/i;
    for (const token of tokens) {
      if (titlePattern.test(token)) titleTokens.push(token);
      else nameTokens.push(token);
    }
    return {
      academicTitle: titleTokens.join(' '),
      firstName: nameTokens.length > 1 ? nameTokens.slice(0, -1).join(' ') : (nameTokens[0] || ''),
      lastName: nameTokens.length > 1 ? nameTokens[nameTokens.length - 1] : ''
    };
  }

  function detectExams(text) {
    const exams = [];
    if (/steuerberater(?:in)?|\bstb\b/i.test(text)) exams.push('StB');
    if (/wirtschaftspr[üu]fer(?:in)?|\bwp\b/i.test(text)) exams.push('WP');
    if (/rechtsanw[äa]lt(?:in)?|\bra\b/i.test(text)) exams.push('RA');
    if (/\bcpa\b/i.test(text)) exams.push('CPA');
    return exams.join(', ');
  }

  function scrapeXingProfileV407() {
    if (!location.hostname.toLowerCase().includes('xing.com') || !/^\/profile\//i.test(location.pathname)) {
      return null;
    }

    const data = {};
    const parsedName = parseName(robustNameText());
    Object.assign(data, parsedName);

    const h1 = firstVisible(['[data-qa="profile-name"]', 'h1.headstone-name', '.EntityInfo-entity-name', 'main h1', 'h1']);
    let scope = h1;
    for (let i = 0; i < 6 && scope?.parentElement; i += 1) {
      scope = scope.parentElement;
      const scopeText = clean(scope.innerText);
      if (/Deutschland|Germany|Österreich|Austria|Schweiz|Switzerland/i.test(scopeText)) break;
    }

    const lines = String(scope?.innerText || '')
      .split('\n')
      .map(clean)
      .filter(Boolean)
      .filter((line, index, all) => all.indexOf(line) === index);

    const nameText = clean([data.academicTitle, data.firstName, data.lastName].filter(Boolean).join(' '));
    const occupationLine = lines.find(line =>
      line !== nameText &&
      !noisePattern.test(line) &&
      /^(angestellt|selbstst[aä]ndig|freiberuflich|inhaber|partner|geschäftsführer|geschaeftsfuehrer|director|manager|consultant|senior|head|vorstand)[,\s]/i.test(line) &&
      line.includes(',')
    );

    if (occupationLine) {
      const parts = occupationLine.split(',').map(clean).filter(Boolean);
      if (/^(angestellt|selbstst[aä]ndig|freiberuflich)$/i.test(parts[0] || '') && parts.length >= 3) {
        data.currentPosition = parts[1];
        data.currentCompany = parts.slice(2).join(', ');
      } else if (parts.length >= 2) {
        data.currentPosition = parts[0];
        data.currentCompany = parts.slice(1).join(', ');
      }
    }

    if (!data.currentPosition) {
      const pos = firstVisible([
        '[data-qa="profile-occupation"]',
        '.EntityInfo-entity-occupation',
        '.headstone-occupation'
      ]);
      if (pos) data.currentPosition = clean(pos.textContent);
    }
    if (!data.currentCompany) {
      const company = firstVisible([
        '[data-qa="profile-company"]',
        '.EntityInfo-entity-company',
        'a[data-qa="profile-company-link"]'
      ]);
      if (company) data.currentCompany = clean(company.textContent);
    }

    const locationEl = firstVisible([
      '[data-qa="profile-location"]',
      '.EntityInfo-entity-location',
      '[data-qa="profile-city"]'
    ]);
    if (locationEl) {
      data.locationFull = clean(locationEl.textContent);
      data.companyCity = clean(data.locationFull.split(',')[0]);
    } else {
      const locationLine = lines.find(line => /,\s*(Deutschland|Germany|Österreich|Austria|Schweiz|Switzerland)$/i.test(line));
      if (locationLine) {
        data.locationFull = locationLine;
        data.companyCity = clean(locationLine.split(',')[0]);
      }
    }

    const markedPhoto = document.querySelector('[data-esos-profile-photo="true"]');
    const photo = markedPhoto?.getAttribute?.('data-esos-profile-photo-src')
      || (markedPhoto instanceof HTMLImageElement ? (markedPhoto.currentSrc || markedPhoto.src) : '')
      || firstVisible(['.EntityInfo-entity-image img', '[data-qa="profile-image"] img', 'img.headstone-image'])?.src;
    if (photo && !/ghost|default[-_ ]?avatar/i.test(photo)) data.profilePhoto = photo;

    const emailEl = firstVisible(['[data-qa="profile-email"] a', 'a[href^="mailto:"]']);
    if (emailEl) data.email = clean(emailEl.textContent) || String(emailEl.href || '').replace(/^mailto:/i, '');
    const phoneEl = firstVisible(['[data-qa="profile-phone"]', '[data-qa="profile-mobile"]', 'a[href^="tel:"]']);
    if (phoneEl) data.phone = clean(phoneEl.textContent) || String(phoneEl.href || '').replace(/^tel:/i, '');

    const statusEl = firstVisible(['[data-qa="profile-career-level"]', '[data-qa="profile-status"]', '[data-qa="profile-seeking"]']);
    if (statusEl && /offen|wechselbereit|auf der suche/i.test(statusEl.textContent || '')) {
      data.availability = clean(statusEl.textContent);
    }

    data.xingUrl = location.href.split('?')[0].replace(/\/$/, '');
    data.sourceChannel = 'Xing';
    data.berufsexamen = detectExams(document.body.innerText || '');

    return { success: Boolean(data.lastName), platform: 'xing', data };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'SCRAPE_PROFILE') return;
    const result = scrapeXingProfileV407();
    if (!result) return;
    // Synchronous response wins before the legacy async scraper. This keeps the
    // rest of the popup/import flow unchanged while supplying clean identity data.
    sendResponse(result);
    return false;
  });
})();
