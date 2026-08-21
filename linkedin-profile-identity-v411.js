// ESOS AI v4.0.11 — strict LinkedIn manual profile extraction.
// Only reads candidate-owned profile regions. Never infer email, exams or company
// from sidebars, suggestions, ads or unrelated page content.
(() => {
  'use strict';

  if (globalThis.__ESOS_LINKEDIN_PROFILE_IDENTITY_V411__) return;
  globalThis.__ESOS_LINKEDIN_PROFILE_IDENTITY_V411__ = true;

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

  const firstVisibleWithin = (root, selectors) => {
    if (!root?.querySelectorAll) return null;
    for (const selector of selectors) {
      try {
        const found = Array.from(root.querySelectorAll(selector)).find(visible);
        if (found) return found;
      } catch (_) {}
    }
    return null;
  };

  const firstVisible = selectors => firstVisibleWithin(document, selectors);
  const profilePath = () => /^\/in\/[^/]+\/?$/i.test(location.pathname);

  function linkedinSlugName() {
    const match = location.pathname.match(/^\/in\/([^/]+)/i);
    if (!match?.[1]) return '';
    let slug = '';
    try { slug = decodeURIComponent(match[1]); } catch (_) { slug = match[1]; }
    slug = slug.replace(/[_+]+/g, ' ').replace(/-/g, ' ').trim();
    const parts = slug.split(/\s+/).filter(Boolean);
    if (parts.length >= 3 && /^[a-z0-9]{7,}$/i.test(parts[parts.length - 1]) && /\d/.test(parts[parts.length - 1])) {
      parts.pop();
    }
    return clean(parts.join(' '));
  }

  function titleName() {
    const meta = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute('content') || '';
    const candidates = [meta, document.title]
      .map(value => clean(value)
        .replace(/\s*[|–—-]\s*LinkedIn.*$/i, '')
        .replace(/^LinkedIn\s*[|–—-]\s*/i, '')
        .trim())
      .filter(Boolean);
    return candidates[0] || '';
  }

  const noisePattern = /(linkedin|profil|profile|kontaktinformationen|contact info|vernetzen|connect|folgen|follow|nachricht|message|mehr|more|premium|business|mitgliedschaft|membership|500\+?\s*kontakte?|connections?)/i;

  function nameScore(value, slugName) {
    const text = clean(value);
    if (!text || text.length < 3 || text.length > 90 || noisePattern.test(text)) return -1000;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 7) return -1000;
    if (tokens.some(token => /[:/@]|\d{4,}/.test(token))) return -1000;
    let score = 10;
    if (tokens.length >= 2 && tokens.length <= 4) score += 8;
    if (/^[\p{L}.'’\-\s]+$/u.test(text)) score += 6;
    const slugTokens = clean(slugName).toLocaleLowerCase('de-DE').split(/\s+/).filter(Boolean);
    const lower = text.toLocaleLowerCase('de-DE');
    if (slugTokens.length >= 2 && slugTokens.every(token => lower.includes(token))) score += 16;
    return score;
  }

  function robustNameText() {
    const slugName = linkedinSlugName();
    const candidates = [];
    const roots = [
      firstVisible(['[data-anonymize="person-name"]']),
      firstVisible(['h1.text-heading-xlarge']),
      firstVisible(['.pv-text-details__left-panel h1']),
      firstVisible(['main h1']),
      firstVisible(['[role="main"] h1']),
      firstVisible(['h1'])
    ].filter(Boolean);

    for (const root of roots) {
      candidates.push(root.getAttribute?.('aria-label') || '');
      candidates.push(root.getAttribute?.('title') || '');
      for (const node of Array.from(root.childNodes || [])) {
        if (node.nodeType === Node.TEXT_NODE) candidates.push(node.textContent || '');
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      let count = 0;
      while ((node = walker.nextNode()) && count < 40) {
        count += 1;
        if (node.parentElement?.closest('button, a, [role="button"]')) continue;
        candidates.push(node.textContent || '');
      }
      candidates.push(root.textContent || '');
    }

    candidates.push(titleName());
    candidates.push(slugName);

    let best = '';
    let bestScore = -1000;
    for (const candidate of candidates) {
      const value = clean(candidate).replace(/\s*\([^)]*pronouns?[^)]*\)\s*$/i, '').trim();
      const score = nameScore(value, slugName);
      if (score > bestScore) {
        best = value;
        bestScore = score;
      }
    }
    return bestScore >= 10 ? best : slugName;
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

  function topCardScope() {
    const h1 = firstVisible(['[data-anonymize="person-name"]', 'h1.text-heading-xlarge', 'main h1', '[role="main"] h1', 'h1']);
    if (!h1) return null;

    const directSection = h1.closest('section');
    if (directSection) return directSection;

    let scope = h1.parentElement;
    let best = scope;
    for (let depth = 0; depth < 6 && scope?.parentElement; depth += 1) {
      if (scope.matches?.('main, [role="main"], body')) break;
      const text = clean(scope.innerText);
      if (text.length >= 30 && text.length <= 2200) best = scope;
      scope = scope.parentElement;
    }
    return best || h1.parentElement;
  }

  function companyText(element) {
    if (!element) return '';
    const aria = clean(element.getAttribute?.('aria-label'));
    const ariaMatch = aria.match(/(?:Aktuelle Firma|Current company)\s*[:–—-]?\s*(.+)$/i);
    if (ariaMatch?.[1]) return clean(ariaMatch[1]);

    const lines = String(element.innerText || element.textContent || '')
      .split('\n')
      .map(clean)
      .filter(Boolean)
      .filter(line => !/^(?:Aktuelle Firma|Current company|Follower:in|Followers?|Beschäftigte|Employees?)\b/i.test(line))
      .filter(line => !/^\d+[\d.,]*\s*(?:Follower|followers?)/i.test(line));
    return clean(lines[0] || '');
  }

  function findCurrentCompany(scope) {
    if (!scope) return '';
    const explicit = firstVisibleWithin(scope, [
      'button[aria-label*="Aktuelle Firma" i]',
      'button[aria-label*="Current company" i]',
      '[data-anonymize="company-name"]',
      '.pv-text-details__right-panel-item-text'
    ]);
    const explicitText = companyText(explicit);
    if (explicitText) return explicitText;

    const companyLinks = Array.from(scope.querySelectorAll('a[href*="/company/"]'))
      .filter(visible)
      .map(companyText)
      .filter(value => value && value.length <= 180 && !/alle\s+details|see\s+all|follower|beschäftigte|employees?/i.test(value));
    return companyLinks[0] || '';
  }

  function findLocation(scope) {
    if (!scope) return '';
    const explicit = firstVisibleWithin(scope, [
      '.text-body-small.inline.t-black--light.break-words',
      '.pv-top-card--list-bullet .text-body-small',
      '.pv-text-details__left-panel .text-body-small.inline',
      '[data-anonymize="location"]'
    ]);
    if (explicit) return clean(explicit.textContent);

    const lines = String(scope.innerText || '')
      .split('\n')
      .map(clean)
      .filter(Boolean);
    return lines.find(line =>
      line.length <= 120 &&
      /(?:Deutschland|Germany|Österreich|Austria|Schweiz|Switzerland|United Kingdom|France|España|Spain|Italia|Italy|Netherlands|Belgium|USA|United States)/i.test(line)
    ) || '';
  }

  function findPhoto(scope) {
    const marked = scope?.querySelector?.('[data-esos-profile-photo="true"]') || document.querySelector('[data-esos-profile-photo="true"]');
    const markedSrc = marked?.getAttribute?.('data-esos-profile-photo-src')
      || (marked instanceof HTMLImageElement ? (marked.currentSrc || marked.src) : '');
    if (markedSrc) return markedSrc;

    const explicit = firstVisibleWithin(scope || document, [
      'img.pv-top-card-profile-picture__image',
      '.pv-top-card-profile-picture__image--show',
      '.profile-photo-edit__preview',
      'button[aria-label*="Profilfoto" i] img',
      'button[aria-label*="profile photo" i] img'
    ]);
    if (explicit instanceof HTMLImageElement) return explicit.currentSrc || explicit.src || '';

    const candidates = Array.from(scope?.querySelectorAll?.('img') || [])
      .filter(visible)
      .map(image => image.currentSrc || image.src || '')
      .filter(src => /licdn\.com/i.test(src) && !/ghost|logo|company/i.test(src));
    return candidates[0] || '';
  }

  function findPosition(scope) {
    const headline = firstVisibleWithin(scope || document, [
      '[data-anonymize="headline"]',
      '.text-body-medium.break-words',
      '.pv-top-card--list .text-body-medium',
      '.pv-text-details__left-panel .text-body-medium'
    ]);
    const value = clean(headline?.textContent || '');
    const roleSignal = /\b(?:geschäftsführ\w*|managing director|director|partner|prokurist|vorstand|ceo|cfo|cto|coo|chief|head of|leiter\w*|manager\w*|consultant|berater\w*|wirtschaftsprüf\w*|steuerberat\w*|rechtsanw\w*|auditor|accountant|controller|specialist|expert|associate|principal|analyst|engineer|developer|architect|recruiter|sales|marketing|founder|gründer\w*|inhaber\w*|owner|professor\w*)\b/i;
    if (roleSignal.test(value) && value.split(/\s+/).length <= 20) return value;

    try {
      const parser = globalThis.MatchMakerPositionParser;
      if (parser?.parseProfileHtml) {
        const parsed = parser.parseProfileHtml(document.documentElement.outerHTML, { platform: 'linkedin' });
        const candidate = clean(parsed?.data?.currentPosition || '');
        const company = clean(findCurrentCompany(scope)).toLocaleLowerCase('de-DE');
        if (parsed?.success && candidate && candidate.toLocaleLowerCase('de-DE') !== company) return candidate;
      }
    } catch (_) {}
    return '';
  }

  function contactInfoScope() {
    const candidates = [
      ...Array.from(document.querySelectorAll('.pv-contact-info, [data-test-modal-id*="contact-info" i], [role="dialog"], .artdeco-modal'))
    ].filter(visible);
    return candidates.find(node => {
      const text = clean(node.innerText || node.textContent || '');
      return /Kontaktinformationen|Contact info/i.test(text)
        && Boolean(node.querySelector('a[href^="mailto:"], a[href^="tel:"]'));
    }) || null;
  }

  function readDirectContactData() {
    const scope = contactInfoScope();
    if (!scope) return {};
    const result = {};
    const email = firstVisibleWithin(scope, ['a[href^="mailto:"]']);
    if (email) result.email = clean(email.textContent) || String(email.href || '').replace(/^mailto:/i, '').split('?')[0];
    const phone = firstVisibleWithin(scope, ['a[href^="tel:"]']);
    if (phone) result.phone = clean(phone.textContent) || String(phone.href || '').replace(/^tel:/i, '');
    return result;
  }

  function profileSectionByAnchor(id) {
    const anchor = document.querySelector(id);
    if (!anchor) return null;
    return anchor.closest('section') || anchor.parentElement?.closest('section') || anchor.parentElement || null;
  }

  function profileExamText(scope) {
    const chunks = [];
    if (scope?.innerText) chunks.push(scope.innerText);
    for (const id of ['#about', '#experience', '#education', '#licenses_and_certifications']) {
      const section = profileSectionByAnchor(id);
      if (section?.innerText) chunks.push(section.innerText);
    }
    return chunks.join('\n').slice(0, 50000);
  }

  function detectExams(text) {
    const exams = [];
    if (/steuerberater(?:in)?|\bstb\b/i.test(text)) exams.push('StB');
    if (/wirtschaftspr[üu]fer(?:in)?|\bwp\b/i.test(text)) exams.push('WP');
    if (/rechtsanw[äa]lt(?:in)?|\bra\b/i.test(text)) exams.push('RA');
    if (/\bcpa\b/i.test(text)) exams.push('CPA');
    return exams.join(', ');
  }

  function scrapeLinkedInProfileV411() {
    if (!location.hostname.toLowerCase().includes('linkedin.com') || !profilePath()) return null;

    const data = {};
    Object.assign(data, parseName(robustNameText()));

    const scope = topCardScope();
    const company = findCurrentCompany(scope);
    const position = findPosition(scope);
    const locationText = findLocation(scope);
    const directContact = readDirectContactData();
    const exams = detectExams(profileExamText(scope));

    // These fields are authoritative for LinkedIn. `false` is deliberate: the
    // popup's legacy fallback merger treats it as a present value, while all form
    // renderers turn it into an empty field. This prevents unrelated fallback
    // data from reappearing when the strict parser correctly found nothing.
    data.currentCompany = company || false;
    data.currentPosition = position || false;
    data.locationFull = locationText || false;
    data.companyCity = locationText ? clean(locationText.split(',')[0]) : false;
    data.email = directContact.email || false;
    data.phone = directContact.phone || false;
    data.phoneMobile = false;
    data.berufsexamen = exams || false;

    const photo = findPhoto(scope);
    if (photo) data.profilePhoto = photo;

    data.linkedInUrl = location.href.split('?')[0].replace(/\/$/, '');
    data.sourceChannel = 'LinkedIn';

    return {
      success: Boolean(data.firstName || data.lastName),
      platform: 'linkedin',
      data,
      diagnostics: {
        extractor: 'linkedin-profile-identity-v411',
        scopedCompany: Boolean(company),
        directContactInfo: Boolean(directContact.email || directContact.phone),
        scopedExams: Boolean(exams)
      }
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'SCRAPE_PROFILE') return;
    const result = scrapeLinkedInProfileV411();
    if (!result) return;
    sendResponse(result);
    return false;
  });
})();
