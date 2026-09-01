// ESOS AI v4.0.20 — authenticated LinkedIn position bridge without tabs/windows.
// Runs inside an already-open LinkedIn page. Target profiles are loaded same-origin
// (first via authenticated fetch, then via an invisible same-origin frame as fallback)
// so the service worker never has to parse LinkedIn's unauthenticated/client shell.
(function (root) {
  'use strict';

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;
  const ROLE_SIGNAL = /\b(?:geschäftsführ\w*|geschäftsleit\w*|managing\s+director|director|partner(?:in)?|prokurist(?:in)?|vorstand|ceo|cfo|cto|coo|chief\b|head\s+of|leiter(?:in)?|leitung|manager(?:in)?|consultant|berater(?:in)?|wirtschaftsprüf\w*|steuerberat\w*|rechtsanw\w*|anwalt|anwältin|auditor|accountant|controller|buchhalter(?:in)?|sachbearbeit\w*|referent(?:in)?|specialist|expert(?:in)?|associate|principal|analyst|engineer|developer|entwickler(?:in)?|architect|architekt(?:in)?|recruiter|talent\b|human\s+resources|hr\b|sales\b|vertrieb|marketing|founder|gründer(?:in)?|inhaber(?:in)?|owner|freelanc\w*|selbstständig|student(?:in)?|professor(?:in)?|wissenschaft\w*|tax\b|audit\b|legal\b|finance\b|financial\b|operations\b|projektleiter(?:in)?|project\s+manager|produktleiter(?:in)?|product\s+manager|bereichsleit\w*|teamleit\w*|abteilungsleit\w*|kanzleileit\w*)\b/i;

  function profilePath(value) {
    let pathname = String(value || '');
    try {
      if (/^https?:\/\//i.test(pathname)) pathname = new URL(pathname).pathname;
    } catch (_) {}
    pathname = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
    const match = pathname.match(/^\/in\/([^/]+)/i);
    return match?.[1] ? `/in/${decodeURIComponent(match[1]).toLocaleLowerCase('en-US')}` : '';
  }

  function sameLinkedInProfile(expected, actual) {
    const left = profilePath(expected);
    const right = profilePath(actual);
    return Boolean(left && right && left === right);
  }

  function normalizedSameOriginProfileUrl(targetProfileUrl, carrierUrl) {
    let target;
    let carrier;
    try {
      target = new URL(String(targetProfileUrl || ''));
      carrier = new URL(String(carrierUrl || ''));
    } catch (_) {
      throw new Error('Ungültige LinkedIn-Profiladresse.');
    }
    if (!LINKEDIN_HOST.test(target.hostname) || !profilePath(target.pathname)) {
      throw new Error('Zieladresse ist kein gültiges LinkedIn-Profil.');
    }
    if (!LINKEDIN_HOST.test(carrier.hostname)) {
      throw new Error('Der Browser-Kontext ist keine LinkedIn-Seite.');
    }
    return `${carrier.origin}${target.pathname.replace(/\/+$/, '')}`;
  }

  function comparable(value) {
    return clean(value)
      .toLocaleLowerCase('de-DE')
      .replace(/\b(?:gmbh|ag|kg|mbb|mbh|llp|ltd|inc|corp|corporation|se|plc|group|gruppe|partnerschaft(?:\s+mbb)?)\b/gi, ' ')
      .replace(/[^a-z0-9äöüß]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function linkedinTitleContext(value) {
    const cleaned = clean(value)
      .replace(/\s*[|]\s*LinkedIn(?:\s.*)?$/i, '')
      .replace(/^LinkedIn\s*[|–—-]\s*/i, '')
      .trim();
    if (!cleaned) return { name: '', company: '' };
    const parts = cleaned.split(/\s+(?:–|—|-)\s+/).map(clean).filter(Boolean);
    const name = parts[0] || '';
    const tail = parts.slice(1).join(' – ');
    const company = tail && !ROLE_SIGNAL.test(tail) && !/\s(?:bei|at|@)\s/i.test(tail) ? tail : '';
    return { name, company };
  }

  function plausibleLinkedInPosition(value, context = {}) {
    const position = clean(value);
    if (!position || position.length < 2 || position.length > 220) return false;
    if (position.split(/\s+/).length > 24) return false;
    if (/https?:\/\/|www\.|linkedin|sign in|log in|anmelden|captcha|checkpoint/i.test(position)) return false;

    const positionKey = comparable(position);
    const nameKey = comparable(context.name);
    const companyKey = comparable(context.company);
    if (!positionKey) return false;

    // Regression guard: LinkedIn can expose "Name – Company" as an occupation-like
    // structured value. It is a profile header, never the current job title.
    if (nameKey && (positionKey === nameKey || positionKey.startsWith(`${nameKey} `) || positionKey.includes(` ${nameKey} `))) {
      return false;
    }
    if (companyKey && (positionKey === companyKey || (companyKey.length >= 8 && positionKey.includes(companyKey)))) {
      return false;
    }
    return true;
  }

  function visibleText(element) {
    if (!element) return '';
    return clean(element.getAttribute?.('aria-label') || element.textContent || '');
  }

  function first(doc, selectors) {
    for (const selector of selectors) {
      try {
        const element = doc?.querySelector?.(selector);
        if (element) return element;
      } catch (_) {}
    }
    return null;
  }

  function companyText(element) {
    const raw = visibleText(element);
    return clean(raw.replace(/^(?:Aktuelle Firma|Current company)\s*[:–—-]?\s*/i, ''));
  }

  function renderedContext(doc) {
    const titleMeta = doc?.querySelector?.('meta[property="og:title"], meta[name="twitter:title"]')?.getAttribute?.('content') || doc?.title || '';
    const titleContext = linkedinTitleContext(titleMeta);
    const name = visibleText(first(doc, [
      '[data-anonymize="person-name"]',
      'h1.text-heading-xlarge',
      '.pv-text-details__left-panel h1',
      'main h1',
      '[role="main"] h1',
      'h1',
    ])) || titleContext.name;
    const company = companyText(first(doc, [
      'button[aria-label*="Aktuelle Firma" i]',
      'button[aria-label*="Current company" i]',
      '[data-anonymize="company-name"]',
      '.pv-text-details__right-panel-item-text',
      'a[href*="/company/"]',
    ])) || titleContext.company;
    const headline = visibleText(first(doc, [
      '[data-anonymize="headline"]',
      '.text-body-medium.break-words',
      '.pv-top-card--list .text-body-medium',
      '.pv-text-details__left-panel .text-body-medium',
    ]));
    return { name, company, headline };
  }

  function parseProfileDocument(doc, source) {
    if (!doc?.documentElement) return { success: false, error: 'LinkedIn-Profil-DOM fehlt.' };
    const context = renderedContext(doc);
    const html = doc.documentElement.outerHTML || '';
    const parser = root.MatchMakerPositionParser;

    if (parser?.parseProfileHtml) {
      const parsed = parser.parseProfileHtml(html, { platform: 'linkedin' });
      const candidate = clean(parsed?.data?.currentPosition || '');
      if (parsed?.success && plausibleLinkedInPosition(candidate, context)) {
        return {
          success: true,
          data: {
            currentPosition: candidate,
            positionConfidence: Math.max(0.8, Math.min(0.98, Number(parsed?.data?.positionConfidence || 0.92))),
            positionSource: `${source}:${parsed?.data?.positionSource || 'parser'}`,
            parserVersion: Number(parsed?.data?.parserVersion || 3),
          },
        };
      }
    }

    // The rendered top-card headline is only a fallback when it carries a clear
    // occupational signal. This deliberately rejects slogans and Name–Company headers.
    if (ROLE_SIGNAL.test(context.headline) && plausibleLinkedInPosition(context.headline, context)) {
      return {
        success: true,
        data: {
          currentPosition: context.headline,
          positionConfidence: 0.9,
          positionSource: `${source}:rendered-headline`,
          parserVersion: 20,
        },
      };
    }

    return { success: false, error: 'Im LinkedIn-Profil wurde keine eindeutige aktuelle Position gefunden.' };
  }

  function parseHtmlDocument(html, source) {
    if (typeof DOMParser === 'undefined') return { success: false, error: 'DOMParser ist nicht verfügbar.' };
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    return parseProfileDocument(doc, source);
  }

  async function fetchSameOriginPosition(targetUrl) {
    const response = await fetch(targetUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
      },
    });
    if (!response.ok) throw new Error(`LinkedIn-Profilabruf fehlgeschlagen (HTTP ${response.status}).`);
    if (!sameLinkedInProfile(targetUrl, response.url || targetUrl)) {
      throw new Error('LinkedIn hat den Profilabruf auf Login/Checkpoint umgeleitet.');
    }
    const html = (await response.text()).slice(0, 3_000_000);
    if (html.length < 100) throw new Error('LinkedIn lieferte keine auswertbaren Profildaten.');
    return parseHtmlDocument(html, 'linkedin_same_origin_fetch');
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function renderedFramePosition(targetUrl) {
    if (typeof document === 'undefined') throw new Error('LinkedIn-Seitenkontext fehlt.');
    const host = document.body || document.documentElement;
    if (!host) throw new Error('LinkedIn-Dokument ist noch nicht bereit.');

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.left = '-10000px';
    frame.style.top = '-10000px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.border = '0';

    let loaded = false;
    const onLoad = () => { loaded = true; };
    frame.addEventListener('load', onLoad);
    host.appendChild(frame);

    try {
      frame.src = targetUrl;
      const deadline = Date.now() + 16000;
      while (!loaded && Date.now() < deadline) await delay(250);
      if (!loaded) throw new Error('LinkedIn-Profil konnte im Hintergrund nicht gerendert werden.');

      let lastError = '';
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await delay(attempt === 0 ? 900 : 650);
        try {
          const frameWindow = frame.contentWindow;
          const frameDoc = frame.contentDocument;
          if (!frameWindow || !frameDoc) throw new Error('LinkedIn-Profilframe ist nicht lesbar.');
          if (!sameLinkedInProfile(targetUrl, frameWindow.location.pathname)) {
            throw new Error('LinkedIn hat den gerenderten Profilabruf auf Login/Checkpoint umgeleitet.');
          }
          const parsed = parseProfileDocument(frameDoc, 'linkedin_same_origin_rendered_frame');
          if (parsed.success) return parsed;
          lastError = parsed.error || lastError;
        } catch (error) {
          lastError = error?.message || String(error);
          if (/Login\/Checkpoint|nicht lesbar/i.test(lastError)) break;
        }
      }
      throw new Error(lastError || 'Im gerenderten LinkedIn-Profil wurde keine Position gefunden.');
    } finally {
      frame.removeEventListener('load', onLoad);
      frame.remove();
    }
  }

  async function inspectLinkedInProfile(targetProfileUrl) {
    const carrierUrl = typeof location !== 'undefined' ? location.href : '';
    const targetUrl = normalizedSameOriginProfileUrl(targetProfileUrl, carrierUrl);
    const errors = [];

    try {
      const fetched = await fetchSameOriginPosition(targetUrl);
      if (fetched.success) return fetched;
      if (fetched.error) errors.push(fetched.error);
    } catch (error) {
      errors.push(error?.message || String(error));
    }

    try {
      const rendered = await renderedFramePosition(targetUrl);
      if (rendered.success) return rendered;
      if (rendered.error) errors.push(rendered.error);
    } catch (error) {
      errors.push(error?.message || String(error));
    }

    return {
      success: false,
      error: Array.from(new Set(errors.filter(Boolean))).join(' | ').slice(0, 480)
        || 'LinkedIn-Position konnte nicht eindeutig ermittelt werden.',
    };
  }

  const api = {
    sameLinkedInProfile,
    normalizedSameOriginProfileUrl,
    linkedinTitleContext,
    plausibleLinkedInPosition,
    inspectLinkedInProfile,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ESOSLinkedInPositionBackgroundV420 = api;

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && typeof document !== 'undefined') {
    if (!root.__ESOS_LINKEDIN_POSITION_BACKGROUND_V420__) {
      root.__ESOS_LINKEDIN_POSITION_BACKGROUND_V420__ = true;
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== 'ESOS_FETCH_LINKEDIN_POSITION') return;
        inspectLinkedInProfile(message.profileUrl)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error?.message || 'LinkedIn-Positionsprüfung fehlgeschlagen.' }));
        return true;
      });
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
