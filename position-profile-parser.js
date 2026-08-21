(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MatchMakerPositionParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PARSER_VERSION = 3;
  const MIN_CONFIDENCE = 0.8;
  const ROLE_CONTEXT = /(?:^|[.\[])(?:position|positions|experience|experiences|employment|occupation|career|job|jobs)(?:$|[.\[\]])/i;
  const COMPANY_CONTEXT = /(?:^|[.\[])(?:company|companies|organization|organizations|worksfor|employer|employers)(?:$|[.\[\]])/i;
  const BLOCKED_TEXT = /(?:sign in|log in|login|anmelden|authwall|captcha|checkpoint|security verification)/i;
  const ROLE_SIGNAL = /\b(?:geschäftsführ\w*|geschäftsleit\w*|managing\s+director|director|partner(?:in)?|prokurist(?:in)?|vorstand|ceo|cfo|cto|coo|chief\b|head\s+of|leiter(?:in)?|leitung|manager(?:in)?|consultant|berater(?:in)?|wirtschaftsprüf\w*|steuerberat\w*|rechtsanw\w*|anwalt|anwältin|auditor|accountant|controller|buchhalter(?:in)?|sachbearbeit\w*|referent(?:in)?|specialist|expert(?:in)?|associate|principal|analyst|engineer|developer|entwickler(?:in)?|architect|architekt(?:in)?|recruiter|talent\b|human\s+resources|hr\b|sales\b|vertrieb|marketing|founder|gründer(?:in)?|inhaber(?:in)?|owner|freelanc\w*|selbstständig|student(?:in)?|professor(?:in)?|wissenschaft\w*|tax\b|audit\b|legal\b|finance\b|financial\b|operations\b|projektleiter(?:in)?|project\s+manager|produktleiter(?:in)?|product\s+manager|bereichsleit\w*|teamleit\w*|abteilungsleit\w*|kanzleileit\w*)\b/i;
  const COMPANY_SIGNAL = /\b(?:gmbh|ag|kg|mbb|mbh|llp|ltd|inc|corp|corporation|se|plc|partnerschaft|kanzlei|wirtschaftsprüfungsgesellschaft|steuerberatungsgesellschaft|rechtsanwaltsgesellschaft)\b/i;

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
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003c/gi, '<')
      .replace(/\\u003e/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripTags(value) {
    return decode(String(value || '').replace(/<[^>]+>/g, ' '));
  }

  function metaContent(html, keys) {
    const wanted = new Set(keys.map(key => key.toLowerCase()));
    const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!key || !wanted.has(key)) continue;
      const content = tag.match(/content\s*=\s*["']([\s\S]*?)["']/i)?.[1];
      if (content) return stripTags(content);
    }
    return '';
  }

  function pageTitle(html) {
    return metaContent(html, ['og:title', 'twitter:title'])
      || stripTags(String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  }

  function cleanSiteSuffix(value) {
    return stripTags(value)
      .replace(/\s*[|–—-]\s*(LinkedIn|XING)(?:\s.*)?$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizePosition(value) {
    let position = cleanSiteSuffix(value)
      .replace(/^(?:aktuelle\s+)?(?:position|tätigkeit|beruf|rolle)\s*[:–—-]\s*/i, '')
      .replace(/^[-–—|·,;:\s]+|[-–—|·,;:\s]+$/g, '')
      .trim();
    const companySuffix = position.match(/^(.+?)\s+(?:bei|at|@)\s+.{2,}$/i);
    if (companySuffix) position = companySuffix[1].trim();
    position = position
      .replace(/\s+(?:bei|at)\s+$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!position || position.length < 2 || position.length > 220) return '';
    if (BLOCKED_TEXT.test(position)) return '';
    if (/^(?:linkedin|xing|profil|profile|mitglied|member|startseite|home|jobs?|kontakte?|network)$/i.test(position)) return '';
    if (/https?:\/\/|www\./i.test(position)) return '';
    if (!/[A-Za-zÄÖÜäöüß]/.test(position)) return '';
    if (position.split(/\s+/).length > 24) return '';
    return position.slice(0, 220);
  }

  function companyKey(value) {
    return cleanSiteSuffix(value)
      .toLocaleLowerCase('de-DE')
      .replace(/\b(?:gmbh|ag|kg|mbb|mbh|llp|ltd|inc|corp|corporation|se|plc|partnerschaft(?:\s+mbb)?|wirtschaftsprüfungsgesellschaft|steuerberatungsgesellschaft|rechtsanwaltsgesellschaft)\b/gi, ' ')
      .replace(/[^a-z0-9äöüß]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function addCompany(companies, value) {
    const company = cleanSiteSuffix(value);
    const key = companyKey(company);
    if (!company || key.length < 3) return;
    if (!companies.some(item => item.key === key)) companies.push({ key, company });
  }

  function sameCompany(position, company) {
    const left = companyKey(position);
    const right = companyKey(company);
    if (!left || !right) return false;
    if (left === right) return true;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length > right.length ? left : right;
    return shorter.length >= 8 && shorter.split(/\s+/).length >= 2 && longer.includes(shorter);
  }

  function roleLikeConfidence(value, trustedConfidence, platform, weakConfidence = 0.76) {
    if (platform !== 'linkedin') return trustedConfidence;
    const raw = stripTags(value);
    const normalized = normalizePosition(raw);
    if (!normalized) return 0;
    if (/\s(?:bei|at|@)\s/i.test(raw) || ROLE_SIGNAL.test(normalized)) return trustedConfidence;
    if (COMPANY_SIGNAL.test(normalized)) return Math.min(weakConfidence, 0.58);
    return Math.min(trustedConfidence, weakConfidence);
  }

  function addCandidate(candidates, value, confidence, source) {
    const position = normalizePosition(value);
    if (!position) return;
    const key = position.toLocaleLowerCase('de-DE');
    const existing = candidates.find(item => item.key === key);
    const candidate = {
      key,
      position,
      confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
      source,
    };
    if (!existing) candidates.push(candidate);
    else if (candidate.confidence > existing.confidence) Object.assign(existing, candidate);
  }

  function objectCurrentState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
    if (value.current === true || value.isCurrent === true || value.present === true || value.active === true) return 'current';
    if (value.current === false || value.isCurrent === false || value.present === false || value.active === false) return 'ended';
    for (const key of ['endDate', 'end_date', 'endTimestamp', 'endYear']) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      return value[key] == null || value[key] === '' ? 'current' : 'ended';
    }
    const range = value.timePeriod || value.dateRange || value.dates;
    if (range && typeof range === 'object') {
      for (const key of ['endDate', 'end', 'endTimestamp', 'endYear']) {
        if (!Object.prototype.hasOwnProperty.call(range, key)) continue;
        return range[key] == null || range[key] === '' ? 'current' : 'ended';
      }
    }
    return 'unknown';
  }

  function roleConfidence(base, value, path) {
    const state = objectCurrentState(value);
    if (state === 'current') return Math.max(base, 0.98);
    if (state === 'ended') return Math.min(base, 0.68);
    if (ROLE_CONTEXT.test(path)) return Math.min(base, 0.91);
    return base;
  }

  function occupationValue(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    for (const key of ['jobTitle', 'roleName', 'positionName', 'title', 'name']) {
      if (typeof value[key] === 'string') return value[key];
    }
    return '';
  }

  function walkStructured(value, path, candidates, companies, platform, depth, seen) {
    if (depth > 16 || value == null) return;
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((item, index) => walkStructured(item, `${path}[${index}]`, candidates, companies, platform, depth + 1, seen));
      return;
    }

    const state = objectCurrentState(value);
    for (const [rawKey, child] of Object.entries(value)) {
      const key = rawKey.toLowerCase().replace(/[^a-z]/g, '');
      const childPath = path ? `${path}.${rawKey}` : rawKey;
      if (typeof child === 'string') {
        if (key === 'companyname' || key === 'employername' || key === 'organizationname' || (key === 'name' && COMPANY_CONTEXT.test(path))) {
          addCompany(companies, child);
        }

        if (key === 'currentposition') addCandidate(candidates, child, roleConfidence(0.99, value, path), 'structured-current-position');
        else if (key === 'jobtitle' || key === 'positionname' || key === 'rolename') {
          addCandidate(candidates, child, roleConfidence(0.97, value, path), `structured-${key}`);
        } else if (key === 'occupation') {
          const confidence = roleLikeConfidence(child, roleConfidence(0.96, value, path), platform, 0.74);
          addCandidate(candidates, child, confidence, 'structured-occupation');
        } else if (key === 'headline' || key === 'professionalheadline') {
          const base = state === 'ended' ? 0.65 : 0.86;
          addCandidate(candidates, child, roleLikeConfidence(child, base, platform, 0.79), 'structured-headline');
        } else if ((key === 'title' || key === 'name') && state === 'current' && ROLE_CONTEXT.test(path)) {
          addCandidate(candidates, child, 0.98, 'structured-current-role');
        }
      } else if (key === 'occupation' && child && typeof child === 'object') {
        const occupation = occupationValue(child);
        const confidence = roleLikeConfidence(occupation, roleConfidence(0.96, value, path), platform, 0.74);
        addCandidate(candidates, occupation, confidence, 'structured-occupation-object');
      }
      walkStructured(child, childPath, candidates, companies, platform, depth + 1, seen);
    }
  }

  function parseStructuredScripts(html, candidates, companies, platform) {
    const scripts = String(html || '').match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const script of scripts.slice(0, 250)) {
      const open = script.match(/^<script\b([^>]*)>/i)?.[1] || '';
      const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
      const structured = /application\/(?:ld\+json|json)/i.test(open)
        || /(?:__NEXT_DATA__|__INITIAL_STATE__|application-state)/i.test(open);
      if (!structured || !body || body.length > 1_800_000 || !/^[{[]/.test(body)) continue;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        try { parsed = JSON.parse(decode(body)); } catch { continue; }
      }
      if (typeof parsed === 'string' && /^[{[]/.test(parsed.trim())) {
        try { parsed = JSON.parse(parsed); } catch { /* keep string */ }
      }
      walkStructured(parsed, '', candidates, companies, platform, 0, new WeakSet());
    }
  }

  function jsonStringValues(html, key, limit = 12) {
    const values = [];
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'gi');
    let match;
    while ((match = pattern.exec(String(html || ''))) && values.length < limit) {
      let value = match[1];
      try { value = JSON.parse(`"${value}"`); } catch {
        value = value
          .replace(/\\u([0-9a-f]{4})/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)))
          .replace(/\\\//g, '/')
          .replace(/\\"/g, '"');
      }
      values.push(decode(value));
    }
    return values;
  }

  function parseEmbeddedStrings(html, candidates, companies, platform) {
    for (const key of ['companyName', 'employerName', 'organizationName']) {
      for (const value of jsonStringValues(html, key)) addCompany(companies, value);
    }

    const keys = [
      ['currentPosition', 0.99, 'embedded-current-position', 0.99],
      ['jobTitle', 0.97, 'embedded-job-title', 0.97],
      ['positionName', 0.97, 'embedded-position-name', 0.97],
      ['roleName', 0.97, 'embedded-role-name', 0.97],
      ['occupation', 0.94, 'embedded-occupation', 0.74],
      ['professionalHeadline', 0.86, 'embedded-professional-headline', 0.79],
      ['headline', 0.85, 'embedded-headline', 0.79],
    ];
    for (const [key, confidence, source, weakConfidence] of keys) {
      for (const value of jsonStringValues(html, key)) {
        const adjusted = ['occupation', 'professionalHeadline', 'headline'].includes(key)
          ? roleLikeConfidence(value, confidence, platform, weakConfidence)
          : confidence;
        addCandidate(candidates, value, adjusted, source);
      }
    }
  }

  function titlePosition(value, platform = 'linkedin') {
    const cleaned = cleanSiteSuffix(value);
    const parts = cleaned.split(/\s+(?:-|–|—|\|)\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return '';
    const raw = parts.slice(1).join(' · ');
    const normalized = normalizePosition(raw);
    if (!normalized) return '';

    // LinkedIn frequently formats the page title as "Name – Company | LinkedIn".
    // That second segment is a company, not a job title. Only accept the title
    // fallback when it carries a clear role signal or an explicit "role at company" form.
    if (platform === 'linkedin' && !/\s(?:bei|at|@)\s/i.test(raw) && !ROLE_SIGNAL.test(normalized)) return '';
    return normalized;
  }

  function descriptionPositions(value) {
    const description = stripTags(value);
    const positions = [];
    const labelled = description.match(/(?:^|[.;])\s*(?:aktuelle\s+)?(?:position|tätigkeit|beruf|rolle)\s*[:–—-]\s*([^.;]{2,220})/i)?.[1];
    if (labelled) positions.push(labelled);
    const workingAs = description.match(/\b(?:arbeitet|tätig)\s+(?:derzeit\s+)?als\s+([^.;]{2,220})/i)?.[1];
    if (workingAs) positions.push(workingAs);
    return positions;
  }

  function demoteCompanyCandidates(candidates, companies) {
    if (!companies.length) return;
    for (const candidate of candidates) {
      if (!companies.some(company => sameCompany(candidate.position, company.company))) continue;
      candidate.confidence = Math.min(candidate.confidence, 0.55);
      candidate.source = `${candidate.source}-company-match`;
    }
  }

  function parseProfileHtml(html, options = {}) {
    const platform = options.platform === 'xing' ? 'xing' : 'linkedin';
    const source = String(html || '');
    const title = pageTitle(source);
    const description = metaContent(source, ['og:description', 'description', 'twitter:description']);
    if (BLOCKED_TEXT.test(`${title} ${description}`)) {
      return { success: false, error: 'Die Browsersitzung ist beim Netzwerk nicht angemeldet oder wurde blockiert.' };
    }

    const candidates = [];
    const companies = [];
    parseStructuredScripts(source, candidates, companies, platform);
    parseEmbeddedStrings(source, candidates, companies, platform);
    addCandidate(candidates, titlePosition(title, platform), 0.91, 'meta-title');
    for (const value of descriptionPositions(description)) addCandidate(candidates, value, 0.82, 'meta-description');
    demoteCompanyCandidates(candidates, companies);

    candidates.sort((left, right) => right.confidence - left.confidence);
    const best = candidates[0];
    if (!best || best.confidence < MIN_CONFIDENCE) {
      return {
        success: false,
        error: 'Im Profil wurde keine eindeutige öffentliche aktuelle Position gefunden.',
        diagnostics: { parserVersion: PARSER_VERSION, candidateCount: candidates.length, companyCount: companies.length },
      };
    }

    return {
      success: true,
      platform,
      data: {
        currentPosition: best.position,
        positionConfidence: best.confidence,
        positionSource: best.source,
        parserVersion: PARSER_VERSION,
      },
      diagnostics: { parserVersion: PARSER_VERSION, candidateCount: candidates.length, companyCount: companies.length },
    };
  }

  return {
    PARSER_VERSION,
    parseProfileHtml,
    pageTitle,
    metaContent,
    normalizePosition,
    titlePosition,
  };
});
