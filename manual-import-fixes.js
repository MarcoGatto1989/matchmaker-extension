// manual-import-fixes.js — ESOS AI v4.0.4
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

  function safePhotoUrl383(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return '';
      const lower = url.toString().toLowerCase();
      if (/ghost|default[-_ ]?avatar|favicon|company[-_ ]?logo|banner|sprite|icon/.test(lower)) return '';
      return url.toString();
    } catch (_) {
      return '';
    }
  }

  function renderProfilePhoto383(rawUrl, sourceText) {
    const card = document.querySelector('#import-profile .profile-card');
    if (!card) return;

    let row = document.getElementById('esos-profile-photo-preview');
    if (!row) {
      row = document.createElement('div');
      row.id = 'esos-profile-photo-preview';
      row.style.display = 'none';
      row.style.alignItems = 'center';
      row.style.gap = '11px';
      row.style.marginBottom = '11px';
      row.style.paddingBottom = '11px';
      row.style.borderBottom = '1px solid #eef2f7';

      const image = document.createElement('img');
      image.id = 'esos-profile-photo-preview-image';
      image.alt = 'Profilbild';
      image.style.width = '68px';
      image.style.height = '68px';
      image.style.flex = '0 0 68px';
      image.style.objectFit = 'cover';
      image.style.borderRadius = '14px';
      image.style.border = '1px solid #e2e8f0';
      image.style.background = '#f8fafc';

      const copy = document.createElement('div');
      copy.style.minWidth = '0';
      const title = document.createElement('div');
      title.id = 'esos-profile-photo-preview-title';
      title.style.fontSize = '11px';
      title.style.fontWeight = '800';
      title.style.color = '#166534';
      const detail = document.createElement('div');
      detail.id = 'esos-profile-photo-preview-detail';
      detail.style.marginTop = '3px';
      detail.style.fontSize = '9px';
      detail.style.lineHeight = '1.35';
      detail.style.color = '#64748b';
      copy.append(title, detail);
      row.append(image, copy);
      card.insertBefore(row, card.firstChild);
    }

    const url = safePhotoUrl383(rawUrl);
    const image = document.getElementById('esos-profile-photo-preview-image');
    const title = document.getElementById('esos-profile-photo-preview-title');
    const detail = document.getElementById('esos-profile-photo-preview-detail');

    if (!url) {
      row.style.display = 'none';
      return;
    }

    row.style.display = 'flex';
    if (title) title.textContent = '✓ Profilbild erkannt';
    if (detail) detail.textContent = sourceText || 'Direkt aus dem geöffneten Social-Media-Profil gelesen.';
    if (image) {
      image.style.opacity = '1';
      image.src = url;
      image.onerror = () => {
        image.style.opacity = '.35';
        if (title) title.textContent = '✓ Profilbild erkannt · Vorschau blockiert';
        if (detail) detail.textContent = 'Die Bildadresse wurde aus dem Profil gelesen; der Anbieter blockiert nur die Popup-Vorschau.';
      };
    }
  }

  async function syncProfilePhoto383() {
    if (typeof scrapedData === 'undefined' || !scrapedData) return false;

    const existing = safePhotoUrl383(scrapedData.profilePhoto);
    if (existing) renderProfilePhoto383(existing, 'Vom ESOS-Profilparser erkannt.');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/linkedin\.com|xing\.com/i.test(tab.url || '')) return Boolean(existing);

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
          const provider = location.hostname.includes('linkedin.com')
            ? 'linkedin'
            : location.hostname.includes('xing.com') ? 'xing' : '';
          const name = clean(document.querySelector('main h1, h1')?.textContent).toLowerCase();
          const bad = /ghost|default[-_ ]?avatar|favicon|company[-_ ]?logo|\blogo\b|banner|sprite|icon/i;

          const normalize = raw => {
            try {
              const url = new URL(String(raw || ''), location.href);
              return url.protocol === 'https:' ? url.toString() : '';
            } catch (_) {
              return '';
            }
          };

          const knownHost = raw => {
            try {
              const host = new URL(raw).hostname.toLowerCase();
              return provider === 'linkedin'
                ? (host.endsWith('licdn.com') || host.endsWith('linkedin.com'))
                : (host.includes('xing') || host.endsWith('ctfassets.net') || host.endsWith('xingassets.com'));
            } catch (_) {
              return false;
            }
          };

          const backgroundUrl = element => {
            const value = getComputedStyle(element).backgroundImage || '';
            const match = value.match(/url\(["']?([^"')]+)["']?\)/i);
            return normalize(match?.[1]);
          };

          const score = (element, url, alt = '') => {
            if (!url || bad.test(`${url} ${alt} ${element.className || ''}`)) return -1000;
            const rect = element.getBoundingClientRect();
            const naturalWidth = element instanceof HTMLImageElement ? element.naturalWidth : 0;
            const naturalHeight = element instanceof HTMLImageElement ? element.naturalHeight : 0;
            const width = rect.width || naturalWidth || 0;
            const height = rect.height || naturalHeight || 0;
            if (width < 48 || height < 48) return -1000;
            let points = 0;
            const ratio = width / Math.max(1, height);
            if (ratio >= .72 && ratio <= 1.38) points += 7;
            if (width >= 80 && height >= 80) points += 4;
            if (width >= 120 && height >= 120) points += 2;
            if (rect.top >= -120 && rect.top <= 900) points += 5;
            if (rect.left >= -20 && rect.left <= Math.max(window.innerWidth * .72, 850)) points += 2;
            if (knownHost(url)) points += 5;
            const altText = clean(alt).toLowerCase();
            if (name && altText && (altText.includes(name) || name.includes(altText))) points += 10;
            if (element.matches?.('[data-esos-profile-photo="true"]')) points += 25;
            if (element.closest?.('nav, [role="navigation"], footer')) points -= 12;
            return points;
          };

          let best = { url: '', points: -1000, element: null, kind: '' };
          const consider = (element, url, alt, kind) => {
            const normalized = normalize(url);
            const points = score(element, normalized, alt);
            if (points > best.points) best = { url: normalized, points, element, kind };
          };

          const marked = document.querySelector('[data-esos-profile-photo="true"]');
          if (marked) {
            const markedUrl = normalize(marked.getAttribute('data-esos-profile-photo-src'))
              || (marked instanceof HTMLImageElement ? normalize(marked.currentSrc || marked.src) : '')
              || backgroundUrl(marked);
            consider(marked, markedUrl, marked.getAttribute('alt') || '', 'markiert');
          }

          for (const img of Array.from(document.querySelectorAll('main img, [role="main"] img, article img, section img')).slice(0, 700)) {
            let url = normalize(img.currentSrc || img.src);
            if (!url) {
              const srcset = String(img.getAttribute('srcset') || '').split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
              url = normalize(srcset[srcset.length - 1]);
            }
            consider(img, url, img.alt || '', 'Bild im gerenderten Profil');
          }

          const backgroundCandidates = Array.from(document.querySelectorAll('main *, [role="main"] *')).slice(0, 1400);
          for (const element of backgroundCandidates) {
            const url = backgroundUrl(element);
            if (url) consider(element, url, element.getAttribute('aria-label') || '', 'gerendertes Hintergrundbild');
          }

          if (!best.url || best.points < 6 || !best.element) return { url: '', source: '' };
          try {
            document.querySelectorAll('[data-esos-profile-photo="true"]').forEach(node => {
              if (node !== best.element) node.removeAttribute('data-esos-profile-photo');
            });
            best.element.setAttribute('data-esos-profile-photo', 'true');
            best.element.setAttribute('data-esos-profile-photo-src', best.url);
            if (best.element instanceof HTMLImageElement) {
              best.element.classList.add('headstone-image', 'pv-top-card-profile-picture__image', 'pv-top-card-profile-picture__image--show');
            }
          } catch (_) {}
          return { url: best.url, source: best.kind || 'gerendertes Profil', score: best.points };
        }
      });

      const result = results?.[0]?.result;
      const url = safePhotoUrl383(result?.url);
      if (!url) return Boolean(existing);

      scrapedData.profilePhoto = url;
      renderProfilePhoto383(url, `Direkt aus ${activeProfilePlatform === 'linkedin' ? 'LinkedIn' : 'XING'} gelesen (${result?.source || 'gerendertes Profil'}).`);
      return true;
    } catch (_) {
      return Boolean(existing);
    }
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
    await syncProfilePhoto383();
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