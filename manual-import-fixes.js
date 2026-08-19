// manual-import-fixes.js — MatchMaker BOOT v3.8.3
// Verbesserungen nur für den manuellen LinkedIn/XING-Import.
// Background-Worker, Netzwerk-Projekte, Positionscheck und Outreach bleiben unverändert.

(function () {
  'use strict';

  const BADGE_SUFFIX_RE = /(?:basis|basic|premium|professional|business)$/i;
  const BADGE_PRO_RE = /(?:\s+pro)$/i;

  function clean383(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function stripBadge383(value) {
    const original = clean383(value);
    if (!original) return '';
    const stripped = original.replace(BADGE_SUFFIX_RE, '').replace(BADGE_PRO_RE, '').trim();
    return stripped || original;
  }

  function normalizeGender383(value) {
    const normalized = clean383(value).toLowerCase();
    if (!normalized || normalized === 'keine angabe') return '';
    if (/^(m|male|männlich|maennlich|herr|mr\.?|he\/him|er\/ihm)$/.test(normalized)) return 'männlich';
    if (/^(w|f|female|weiblich|frau|ms\.?|mrs\.?|she\/her|sie\/ihr)$/.test(normalized)) return 'weiblich';
    if (/^(divers|diverse|non[- ]?binary|nicht[- ]?binär|nicht[- ]?binaer|they\/them|mx\.?)$/.test(normalized)) return 'divers';
    return '';
  }

  function applyGender383(value, source) {
    const gender = normalizeGender383(value);
    const select = document.getElementById('candidate-gender');
    if (!gender || !select) return false;

    const current = normalizeGender383(select.value);
    if (current) return false;

    select.value = gender;
    select.title = source
      ? `Automatisch übernommen aus: ${source}`
      : 'Automatisch aus einer eindeutigen vorhandenen Angabe übernommen.';

    if (typeof scrapedData !== 'undefined' && scrapedData && !scrapedData.gender) {
      scrapedData.gender = gender;
    }
    return true;
  }

  function fixScrapedName383() {
    if (typeof scrapedData === 'undefined' || !scrapedData) return false;

    const correctedLastName = stripBadge383(scrapedData.lastName);
    const correctedFirstName = clean383(scrapedData.firstName);

    if (correctedLastName && correctedLastName !== scrapedData.lastName) {
      scrapedData.lastName = correctedLastName;
    }
    if (correctedFirstName) scrapedData.firstName = correctedFirstName;

    const lastInput = document.getElementById('candidate-last-name');
    const firstInput = document.getElementById('candidate-first-name');
    if (lastInput) lastInput.value = correctedLastName || '';
    if (firstInput) firstInput.value = correctedFirstName || '';

    const nameEl = document.getElementById('profile-name');
    if (nameEl) {
      const title = clean383(scrapedData.academicTitle);
      nameEl.textContent = [title, correctedFirstName, correctedLastName].filter(Boolean).join(' ');
    }

    return Boolean(correctedFirstName || correctedLastName);
  }

  function setDuplicateBox383(kind, title, text) {
    const box = document.getElementById('duplicate-warning');
    if (!box) return;
    box.style.display = 'block';

    if (kind === 'duplicate') {
      box.style.background = '#fef3c7';
      box.style.borderColor = '#fbbf24';
      box.style.color = '#92400e';
    } else if (kind === 'ok') {
      box.style.background = '#ecfdf5';
      box.style.borderColor = '#a7f3d0';
      box.style.color = '#166534';
    } else if (kind === 'error') {
      box.style.background = '#fef2f2';
      box.style.borderColor = '#fecaca';
      box.style.color = '#991b1b';
    } else {
      box.style.background = '#eff6ff';
      box.style.borderColor = '#bfdbfe';
      box.style.color = '#1e40af';
    }

    const titleEl = document.getElementById('duplicate-title') || box.querySelector('strong');
    const textEl = document.getElementById('duplicate-text') || box.querySelector('span');
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
  }

  async function openExistingContact383(contactId) {
    if (!contactId || typeof getSettings !== 'function' || typeof getEsosUrl !== 'function') return;
    const button = document.getElementById('import-open-btn');
    if (!button) return;
    const settings = await getSettings();
    const base = getEsosUrl(settings);
    button.style.display = 'block';
    button.textContent = '↗️ Vorhandenen Kontakt in ESOS öffnen';
    button.onclick = () => chrome.tabs.create({ url: `${base}/contacts/${contactId}` });
  }

  async function applyExistingGender383(contactId, fallbackGender) {
    if (applyGender383(fallbackGender, 'vorhandener ESOS-Datensatz')) return;
    if (!contactId || typeof esosApi !== 'function') return;

    try {
      const response = await esosApi(`/api/contacts/${contactId}`);
      if (!response.ok) return;
      const contact = await response.json();
      applyGender383(contact?.gender, 'vorhandener ESOS-Datensatz');
    } catch (_) {}
  }

  async function duplicateCheck383() {
    if (typeof esosApi !== 'function' || typeof readEditableProfile !== 'function') return;

    const data = readEditableProfile();
    data.lastName = stripBadge383(data.lastName);

    const importButton = document.getElementById('import-btn');
    if (importButton) importButton.disabled = true;
    setDuplicateBox383('checking', '🔎 Duplikatprüfung', 'Prüfe XING/LinkedIn-Link, E-Mail und Name gegen ESOS …');

    try {
      let response = await esosApi('/api/extension/check-duplicate', {
        method: 'POST',
        body: JSON.stringify({
          linkedInUrl: data.linkedInUrl,
          xingUrl: data.xingUrl,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName
        })
      });

      let result = null;

      if (response.ok) {
        result = await response.json();
      } else {
        const filter = encodeURIComponent(JSON.stringify({
          firstName: { equals: data.firstName || '', mode: 'insensitive' },
          lastName: { equals: data.lastName || '', mode: 'insensitive' }
        }));
        const fallback = await esosApi(`/api/contacts?q=${filter}&limit=5`);
        if (!fallback.ok) throw new Error(`ESOS Duplikatcheck: HTTP ${fallback.status}`);
        const contacts = await fallback.json();
        const existing = Array.isArray(contacts) ? contacts[0] : null;
        result = existing ? {
          isDuplicate: true,
          matchedBy: 'Name',
          contactId: existing.id,
          contactName: `${existing.firstName || ''} ${existing.lastName || ''}`.trim(),
          gender: existing.gender
        } : { isDuplicate: false };
      }

      if (result?.isDuplicate) {
        setDuplicateBox383(
          'duplicate',
          '⚠️ Kandidat bereits in ESOS',
          `${result.contactName || 'Vorhandener Kontakt'}${result.matchedBy ? ` · Treffer über ${result.matchedBy}` : ''}. Es wird kein zweiter Datensatz angelegt.`
        );
        if (importButton) {
          importButton.disabled = false;
          importButton.textContent = '🔄 Bestehenden ESOS-Kontakt aktualisieren';
        }
        await Promise.all([
          openExistingContact383(result.contactId),
          applyExistingGender383(result.contactId, result.gender)
        ]);
      } else {
        setDuplicateBox383('ok', '✅ Kein Duplikat gefunden', 'XING/LinkedIn-Link, E-Mail und Name wurden gegen ESOS geprüft.');
        if (importButton) {
          importButton.disabled = false;
          importButton.textContent = '📥 In ESOS übernehmen';
        }
      }
    } catch (error) {
      setDuplicateBox383('error', '⚠️ Duplikatprüfung fehlgeschlagen', `${error.message}. Import ist sicherheitshalber gesperrt.`);
      if (importButton) importButton.disabled = true;
    }
  }

  async function deriveExplicitProfileGender383() {
    const select = document.getElementById('candidate-gender');
    if (!select || normalizeGender383(select.value)) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/linkedin\.com|xing\.com/i.test(tab.url || '')) return;

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
          const classify = value => {
            const text = clean(value).toLowerCase();
            if (/\b(he\s*\/\s*him|er\s*\/\s*ihm)\b/i.test(text)) return 'männlich';
            if (/\b(she\s*\/\s*her|sie\s*\/\s*ihr)\b/i.test(text)) return 'weiblich';
            if (/\b(they\s*\/\s*them)\b|nicht[- ]?binär|non[- ]?binary/i.test(text)) return 'divers';
            if (/^(herr|mr\.?)$/i.test(text)) return 'männlich';
            if (/^(frau|ms\.?|mrs\.?)$/i.test(text)) return 'weiblich';
            if (/^mx\.?$/i.test(text)) return 'divers';
            return '';
          };

          const candidates = [];
          document.querySelectorAll('[aria-label], [data-qa], [class]').forEach(element => {
            const marker = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('data-qa') || ''} ${element.className || ''}`;
            if (/pronoun|pronomen/i.test(marker)) {
              candidates.push(element.getAttribute('aria-label') || '');
              candidates.push(element.textContent || '');
            }
          });

          const h1 = document.querySelector('main h1, h1');
          if (h1) {
            let scope = h1.parentElement;
            for (let i = 0; i < 3 && scope; i += 1, scope = scope.parentElement) {
              candidates.push(scope.innerText || '');
            }

            const name = clean(h1.textContent).replace(/(?:Basis|Basic|Premium|Professional|Business)$/i, '').trim();
            if (name) {
              const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const nearby = clean(h1.parentElement?.parentElement?.innerText || '');
              if (new RegExp(`\\bHerr\\s+${escaped}\\b`, 'i').test(nearby)) return { gender: 'männlich', evidence: 'explizite Anrede auf dem Profil' };
              if (new RegExp(`\\bFrau\\s+${escaped}\\b`, 'i').test(nearby)) return { gender: 'weiblich', evidence: 'explizite Anrede auf dem Profil' };
            }
          }

          for (const candidate of candidates) {
            const gender = classify(candidate);
            if (gender) return { gender, evidence: 'explizite Pronomen/Anrede auf dem Profil' };
          }
          return { gender: '', evidence: '' };
        }
      });

      const result = results?.[0]?.result;
      if (result?.gender) applyGender383(result.gender, result.evidence || 'explizite Profilangabe');
    } catch (_) {}
  }

  let opportunities383 = [];

  function renderProjects383() {
    const opportunitySelect = document.getElementById('opportunity-select');
    if (!opportunitySelect) return;

    const previous = opportunitySelect.value;
    opportunitySelect.innerHTML = '<option value="">— Ohne Projektzuordnung speichern —</option>';

    opportunities383.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = [
        clean383(item.mandateNumber),
        clean383(item.soughtRole || item.name),
        clean383(item.accountName)
      ].filter(Boolean).join(' · ') || item.id;
      opportunitySelect.appendChild(option);
    });

    if (previous && opportunities383.some(item => item.id === previous)) {
      opportunitySelect.value = previous;
    }
  }

  async function loadProjects383() {
    if (typeof esosApi !== 'function') return;

    const opportunitySelect = document.getElementById('opportunity-select');
    const status = document.getElementById('project-status');
    if (!opportunitySelect) return;

    opportunitySelect.disabled = true;
    if (status) status.textContent = 'Lade aktive Suchprojekte aus ESOS …';

    try {
      let response = await esosApi('/api/extension/opportunities');

      if (!response.ok) {
        const filter = encodeURIComponent(JSON.stringify({
          mandateStatus: { notIn: ['Besetzt', 'Abgebrochen'] }
        }));
        response = await esosApi(`/api/opportunities?q=${filter}&limit=500&sort_by=-createdAt`);
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      opportunities383 = (Array.isArray(data) ? data : []).filter(item => item?.id);

      renderProjects383();
      opportunitySelect.disabled = false;
      if (status) status.textContent = opportunities383.length
        ? `${opportunities383.length} aktive Suchprojekte geladen. Auswahl ist optional.`
        : 'Keine aktiven Suchprojekte gefunden. Der Kandidat kann trotzdem ohne Zuordnung gespeichert werden.';
    } catch (error) {
      opportunitySelect.innerHTML = '<option value="">— Ohne Projektzuordnung speichern —</option>';
      opportunitySelect.disabled = false;
      if (status) status.textContent = `⚠️ Suchprojekte konnten nicht geladen werden (${error.message}). Speichern ohne Zuordnung ist weiterhin möglich.`;
    }
  }

  async function apply383() {
    if (!fixScrapedName383()) return false;
    await Promise.all([duplicateCheck383(), loadProjects383()]);
    await deriveExplicitProfileGender383();
    return true;
  }

  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    const ready = typeof scrapedData !== 'undefined' && scrapedData;
    if (ready) {
      clearInterval(timer);
      await apply383();
    } else if (attempts >= 20) {
      clearInterval(timer);
    }
  }, 200);

  const scrapeButton = document.getElementById('scrape-btn');
  if (scrapeButton) {
    scrapeButton.addEventListener('click', () => {
      setTimeout(() => apply383(), 900);
    });
  }
})();