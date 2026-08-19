// manual-import-fixes.js — MatchMaker BOOT v3.8.1
// Hotfix for manual LinkedIn/XING import only. Background workers remain unchanged.

(function () {
  'use strict';

  const BADGE_SUFFIX_RE = /(?:basis|basic|premium|professional|business)$/i;
  const BADGE_PRO_RE = /(?:\s+pro)$/i;

  function clean381(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function stripBadge381(value) {
    const original = clean381(value);
    if (!original) return '';
    const stripped = original.replace(BADGE_SUFFIX_RE, '').replace(BADGE_PRO_RE, '').trim();
    return stripped || original;
  }

  function fixScrapedName381() {
    if (typeof scrapedData === 'undefined' || !scrapedData) return false;

    const correctedLastName = stripBadge381(scrapedData.lastName);
    const correctedFirstName = clean381(scrapedData.firstName);

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
      const title = clean381(scrapedData.academicTitle);
      nameEl.textContent = [title, correctedFirstName, correctedLastName].filter(Boolean).join(' ');
    }

    return Boolean(correctedFirstName || correctedLastName);
  }

  function setDuplicateBox381(kind, title, text) {
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

  async function openExistingContact381(contactId) {
    if (!contactId || typeof getSettings !== 'function' || typeof getEsosUrl !== 'function') return;
    const button = document.getElementById('import-open-btn');
    if (!button) return;
    const settings = await getSettings();
    const base = getEsosUrl(settings);
    button.style.display = 'block';
    button.textContent = '↗️ Vorhandenen Kontakt in ESOS öffnen';
    button.onclick = () => chrome.tabs.create({ url: `${base}/contacts/${contactId}` });
  }

  async function duplicateCheck381() {
    if (typeof esosApi !== 'function' || typeof readEditableProfile !== 'function') return;

    const data = readEditableProfile();
    data.lastName = stripBadge381(data.lastName);

    const importButton = document.getElementById('import-btn');
    if (importButton) importButton.disabled = true;
    setDuplicateBox381('checking', '🔎 Duplikatprüfung', 'Prüfe XING/LinkedIn-Link, E-Mail und Name gegen ESOS …');

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
          contactName: `${existing.firstName || ''} ${existing.lastName || ''}`.trim()
        } : { isDuplicate: false };
      }

      if (result?.isDuplicate) {
        setDuplicateBox381(
          'duplicate',
          '⚠️ Kandidat bereits in ESOS',
          `${result.contactName || 'Vorhandener Kontakt'}${result.matchedBy ? ` · Treffer über ${result.matchedBy}` : ''}. Es wird kein zweiter Datensatz angelegt.`
        );
        if (importButton) {
          importButton.disabled = false;
          importButton.textContent = '🔄 Bestehenden ESOS-Kontakt aktualisieren';
        }
        await openExistingContact381(result.contactId);
      } else {
        setDuplicateBox381('ok', '✅ Kein Duplikat gefunden', 'XING/LinkedIn-Link, E-Mail und Name wurden gegen ESOS geprüft.');
        if (importButton) {
          importButton.disabled = false;
          importButton.textContent = '📥 In ESOS übernehmen';
        }
      }
    } catch (error) {
      setDuplicateBox381('error', '⚠️ Duplikatprüfung fehlgeschlagen', `${error.message}. Import ist sicherheitshalber gesperrt.`);
      if (importButton) importButton.disabled = true;
    }
  }

  let opportunities381 = [];

  function accountKey381(item) {
    return item.accountId || clean381(item.accountName) || '__ohne_mandant__';
  }

  function renderProjects381() {
    const accountSelect = document.getElementById('account-select');
    const opportunitySelect = document.getElementById('opportunity-select');
    if (!accountSelect || !opportunitySelect) return;

    const selectedAccount = accountSelect.value;
    const filtered = selectedAccount
      ? opportunities381.filter(item => accountKey381(item) === selectedAccount)
      : opportunities381;

    opportunitySelect.innerHTML = '<option value="">— Kein Suchprojekt / Mandat —</option>';
    filtered.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = [
        clean381(item.accountName),
        clean381(item.mandateNumber),
        clean381(item.soughtRole || item.name)
      ].filter(Boolean).join(' · ') || item.id;
      opportunitySelect.appendChild(option);
    });
  }

  function renderAccounts381() {
    const accountSelect = document.getElementById('account-select');
    if (!accountSelect) return;

    const accounts = new Map();
    opportunities381.forEach(item => {
      const key = accountKey381(item);
      const label = clean381(item.accountName) || 'Ohne Mandant/Kunde';
      if (!accounts.has(key)) accounts.set(key, label);
    });

    accountSelect.innerHTML = '<option value="">— Alle Mandanten / Kunden —</option>';
    [...accounts.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'de'))
      .forEach(([key, label]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = label;
        accountSelect.appendChild(option);
      });

    accountSelect.disabled = false;
    accountSelect.onchange = renderProjects381;
  }

  async function loadProjects381() {
    if (typeof esosApi !== 'function') return;

    const accountSelect = document.getElementById('account-select');
    const opportunitySelect = document.getElementById('opportunity-select');
    const status = document.getElementById('project-status');
    if (!accountSelect || !opportunitySelect) return;

    accountSelect.disabled = true;
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
      opportunities381 = (Array.isArray(data) ? data : []).filter(item => item?.id);

      renderAccounts381();
      renderProjects381();
      opportunitySelect.disabled = false;
      if (status) status.textContent = opportunities381.length
        ? `${opportunities381.length} aktive Suchprojekte geladen.`
        : 'Keine aktiven Suchprojekte gefunden.';
    } catch (error) {
      accountSelect.innerHTML = '<option value="">— Mandanten konnten nicht geladen werden —</option>';
      opportunitySelect.innerHTML = '<option value="">— Suchprojekte konnten nicht geladen werden —</option>';
      if (status) status.textContent = `⚠️ ${error.message}`;
    }
  }

  async function apply381() {
    if (!fixScrapedName381()) return false;
    await Promise.all([duplicateCheck381(), loadProjects381()]);
    return true;
  }

  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    const ready = typeof scrapedData !== 'undefined' && scrapedData;
    if (ready) {
      clearInterval(timer);
      await apply381();
    } else if (attempts >= 20) {
      clearInterval(timer);
    }
  }, 200);

  const scrapeButton = document.getElementById('scrape-btn');
  if (scrapeButton) {
    scrapeButton.addEventListener('click', () => {
      setTimeout(() => apply381(), 900);
    });
  }
})();
