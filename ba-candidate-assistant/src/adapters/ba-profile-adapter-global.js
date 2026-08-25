(() => {
  const root = globalThis.BAKandidaten = globalThis.BAKandidaten || {};
  const n = root.normalizers;
  const ADAPTER_VERSION = 'ba-profile-text-v1';

  function parseReference(text) {
    return text.match(/Referenz-Nr\.?\s*:\s*([0-9-]+-B)\b/i)?.[1]?.toUpperCase() || null;
  }

  function parseLocation(text) {
    const match = text.match(/\b(\d{5})\s+([^\n(]{2,80})\s*\(Umkreis:\s*(\d+)\s*km\)/i);
    if (!match) return { postalCode: null, location: null, radiusKm: null };
    return { postalCode: match[1], location: n.clean(match[2]), radiusKm: Number(match[3]) };
  }

  function parseDesiredRoles(text) {
    const all = n.lines(text);
    const idx = all.findIndex(line => /^Sucht Stelle als:?$/i.test(line));
    if (idx < 0) return [];
    const output = [];
    for (let i = idx + 1; i < all.length; i += 1) {
      const line = all[i];
      if (/^(Ab sofort|Vollzeit|Teilzeit|\d{5}\s)/i.test(line)) break;
      if (/^(Lebenslauf|Berufserfahrung|Schul- und Berufsausbildung)$/i.test(line)) break;
      output.push(...line.split('|').map(item => n.clean(item)).filter(Boolean));
    }
    return n.unique(output);
  }

  function parseWorkTimes(text) {
    const values = [];
    if (/\bVollzeit\b/i.test(text)) values.push('Vollzeit');
    if (/\bTeilzeit\b/i.test(text)) values.push('Teilzeit');
    if (/Schicht\/Nacht\/Wochenende/i.test(text)) values.push('Schicht/Nacht/Wochenende');
    if (/Heim-\/Telearbeit|Homeoffice/i.test(text)) values.push('Heim-/Telearbeit');
    if (/\bMinijob\b/i.test(text)) values.push('Minijob');
    return values;
  }

  function parseExperienceYears(text) {
    const match = text.match(/\b(\d{1,2})\s+Jahre?\s+Berufserfahrung\b/i);
    return match ? Number(match[1]) : null;
  }

  function parseLanguages(text) {
    const section = n.section(text, 'Sprachkenntnisse', ['Kompetenzen', 'Kenntnisse und Fertigkeiten', 'Kontakt und Verwaltung']);
    const known = [];
    const languageNames = ['Deutsch', 'Englisch', 'Französisch', 'Spanisch', 'Italienisch', 'Polnisch', 'Russisch', 'Türkisch', 'Arabisch', 'Niederländisch'];
    const joined = section.join(' | ');
    for (const name of languageNames) {
      const re = new RegExp(`\\b${name}\\b(?:\\s+([^|]{0,50}))?`, 'i');
      const match = joined.match(re);
      if (match) known.push(match[1] ? `${name} – ${n.clean(match[1])}` : name);
    }
    return n.unique(known);
  }

  function parseSkills(text) {
    const section = n.section(text, 'Kenntnisse und Fertigkeiten', ['Kontakt und Verwaltung']);
    const joined = section.join(' | ')
      .replace(/Erweiterte Kenntnisse/gi, '')
      .replace(/Grundkenntnisse/gi, '');
    return n.unique(joined.split('|').map(item => item.replace(/^[A-Z]\s+/, '').trim()).filter(item => item.length >= 3 && item.length <= 100));
  }

  function parseCompetencies(text) {
    const section = n.section(text, 'Kompetenzen', ['Kenntnisse und Fertigkeiten', 'Kontakt und Verwaltung']);
    return n.unique(section.flatMap(line => line.split('|')).map(item => n.clean(item)).filter(item => item.length > 2));
  }

  function parseMobility(text) {
    const section = n.section(text, 'Mobilität', ['Sprachkenntnisse', 'Kompetenzen']);
    return n.unique(section.flatMap(line => line.split('|')).map(item => n.clean(item)).filter(item => item.length > 2));
  }

  function parseTimeline(text) {
    const section = n.section(text, 'Berufserfahrung', ['Schul- und Berufsausbildung', 'Bewerber/in im Detail', 'Mobilität']);
    const entries = [];
    for (let i = 0; i < section.length; i += 1) {
      const date = section[i].match(/^(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4}|heute)$/i);
      if (!date) continue;
      const role = section[i + 1] || '';
      const location = section[i + 2] || '';
      entries.push({ from: date[1], to: date[2], role: n.clean(role), location: n.clean(location) });
    }
    return entries;
  }

  function parseEducation(text) {
    const section = n.section(text, 'Schul- und Berufsausbildung', ['Bewerber/in im Detail', 'Mobilität']);
    const entries = [];
    for (let i = 0; i < section.length; i += 1) {
      const date = section[i].match(/^(\d{2}\.\d{4}|\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{4}|\d{2}\.\d{2}\.\d{4})/);
      if (!date) continue;
      entries.push({ period: section[i], qualification: n.clean(section[i + 1] || ''), location: n.clean(section[i + 2] || '') });
    }
    return entries;
  }

  function parseProfileText(text) {
    const cleanText = n.clean(text);
    const reference = parseReference(cleanText);
    const location = parseLocation(cleanText);
    const desiredRoles = parseDesiredRoles(cleanText);
    const skills = parseSkills(cleanText);
    const languages = parseLanguages(cleanText);
    const publication = cleanText.match(/Veröffentlicht:\s*([^\n]+)/i)?.[1]?.trim() || null;
    const availability = /\bAb sofort\b/i.test(cleanText) ? 'Ab sofort' : cleanText.match(/Verfügbar(?:keit)?\s*:?\s*([^\n]+)/i)?.[1]?.trim() || null;
    const missingFields = [];
    if (!reference) missingFields.push('reference');
    if (!desiredRoles.length) missingFields.push('desiredRoles');
    if (!location.location) missingFields.push('location');
    if (!skills.length) missingFields.push('skills');
    const evidenceCount = 4 - missingFields.filter(field => ['reference', 'desiredRoles', 'location', 'skills'].includes(field)).length;
    const confidence = Math.max(0.2, Math.min(1, evidenceCount / 4));

    return {
      source: 'ba_profile',
      adapterVersion: ADAPTER_VERSION,
      reference,
      publication,
      desiredRoles,
      ...location,
      availability,
      workTimes: parseWorkTimes(cleanText),
      experienceYears: parseExperienceYears(cleanText),
      experience: parseTimeline(cleanText),
      education: parseEducation(cleanText),
      skills,
      languages,
      competencies: parseCompetencies(cleanText),
      mobility: parseMobility(cleanText),
      missingFields,
      confidence,
      capturedAt: new Date().toISOString()
    };
  }

  function parseVisibleProfile(document) {
    const text = document?.body?.innerText || '';
    if (!/Kontakt und Verwaltung|Referenz-Nr\./i.test(text)) return null;
    return parseProfileText(text);
  }

  root.profileAdapter = { ADAPTER_VERSION, parseProfileText, parseVisibleProfile, parseReference, parseLocation };
})();
