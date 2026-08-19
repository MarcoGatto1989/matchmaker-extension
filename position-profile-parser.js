(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MatchMakerPositionParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function decode(value) {
    return String(value || '')
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(parseInt(code, 10)))
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&ndash;/gi, '–')
      .replace(/&mdash;/gi, '—')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\\u0026/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function metaContent(html, keys) {
    const wanted = keys.map(key => key.toLowerCase());
    const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!key || !wanted.includes(key)) continue;
      const content = tag.match(/content\s*=\s*["']([\s\S]*?)["']/i)?.[1];
      if (content) return decode(content.replace(/<[^>]+>/g, ' '));
    }
    return '';
  }

  function pageTitle(html) {
    return metaContent(html, ['og:title', 'twitter:title'])
      || decode(String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  }

  function jsonValue(html, keys) {
    for (const key of keys) {
      const match = String(html || '').match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'));
      if (!match?.[1]) continue;
      let value = match[1];
      try { value = JSON.parse(`"${value}"`); } catch {
        value = value.replace(/\\u([0-9a-f]{4})/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)))
          .replace(/\\\//g, '/')
          .replace(/\\"/g, '"');
      }
      value = decode(value);
      if (value && value.length <= 300 && !/^(null|undefined)$/i.test(value)) return value;
    }
    return '';
  }

  function cleanSiteSuffix(value) {
    return decode(value)
      .replace(/\s*[|–—-]\s*(LinkedIn|XING).*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleParts(value) {
    const cleaned = cleanSiteSuffix(value);
    const parts = cleaned.split(/\s+(?:-|–|—|\|)\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) return { displayName: parts[0], position: parts.slice(1).join(' · ') };
    const comma = cleaned.match(/^([^,]{3,100}),\s*(.{2,250})$/);
    if (comma) return { displayName: comma[1].trim(), position: comma[2].trim() };
    return { displayName: '', position: '' };
  }

  function normalizePosition(value) {
    let position = decode(value).replace(/^[-–—|·\s]+|[-–—|·\s]+$/g, '').trim();
    const company = position.match(/^(.+?)\s+(?:bei|at|@)\s+.{2,}$/i);
    if (company) position = company[1].trim();
    if (/^(linkedin|xing|profil|profile|mitglied|member)$/i.test(position)) return '';
    if (/(?:sign in|log in|login|anmelden|authwall|captcha)/i.test(position)) return '';
    return position.slice(0, 250);
  }

  function splitName(displayName) {
    const cleaned = decode(displayName)
      .replace(/\b(?:Prof\.?\s*Dr\.?|Prof\.?|Dr\.?|Dipl\.-?[A-Za-zÄÖÜäöüß.-]+|MBA|LL\.?M\.?)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = cleaned.split(' ').filter(Boolean);
    return {
      displayName: decode(displayName).slice(0, 200),
      firstName: parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || ''),
      lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    };
  }

  function parseProfileHtml(html, options = {}) {
    const platform = options.platform === 'xing' ? 'xing' : 'linkedin';
    const title = pageTitle(html);
    const description = metaContent(html, ['og:description', 'description', 'twitter:description']);
    if (/(?:sign in|log in|login|anmelden|authwall|captcha)/i.test(`${title} ${description}`)) {
      return { success: false, error: 'Die Browsersitzung ist beim Netzwerk nicht angemeldet.' };
    }

    const fromTitle = titleParts(title);
    const fromDescription = titleParts(description);
    const embeddedPosition = jsonValue(html, ['currentPosition', 'jobTitle', 'occupation', 'headline', 'positionName']);
    const currentPosition = normalizePosition(embeddedPosition || fromTitle.position || fromDescription.position);
    if (!currentPosition) {
      return { success: false, error: 'Im Profil wurde keine öffentliche aktuelle Position gefunden.' };
    }

    const embeddedName = [
      jsonValue(html, ['firstName', 'givenName']),
      jsonValue(html, ['lastName', 'familyName']),
    ].filter(Boolean).join(' ').trim() || jsonValue(html, ['displayName', 'fullName', 'name']);
    const name = splitName(embeddedName || fromTitle.displayName || fromDescription.displayName);

    return {
      success: true,
      platform,
      data: {
        currentPosition,
        displayName: name.displayName,
        firstName: name.firstName,
        lastName: name.lastName,
      },
      evidenceTitle: title || description,
    };
  }

  return { parseProfileHtml, pageTitle, metaContent, normalizePosition };
});

