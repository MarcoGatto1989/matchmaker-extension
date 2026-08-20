// popup.js — MatchMaker BOOT Extension
// Manual CRM import: opening the extension on a LinkedIn/XING profile auto-reads
// the active profile and pre-fills an ESOS-aligned editable form.
// Background queues (network projects, position check, outreach, social publishing)
// are intentionally untouched.

const extensionVersion = document.getElementById('extension-version');
if (extensionVersion) extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;

async function safeFetch(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') throw new Error('Zeitüberschreitung — Server antwortet nicht');
    throw error;
  }
}

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['esos_url', 'esos_email', 'esos_password', 'extension_token', 'esos_jwt'],
      result => resolve(result)
    );
  });
}

function getEsosUrl(settings) {
  return (settings?.esos_url || 'https://executive-sphere-production.up.railway.app').replace(/\/$/, '');
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || '';
}

function getValue(id) {
  return (document.getElementById(id)?.value || '').trim();
}

function isSupportedProfileUrl(url = '') {
  return /https?:\/\/([^/]+\.)?(linkedin\.com|xing\.com)\//i.test(url);
}

function isLinkedInUrl(url = '') {
  return /linkedin\.com/i.test(url);
}

function isXingUrl(url = '') {
  return /xing\.com/i.test(url);
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Content-Script nicht erreichbar'));
        return;
      }
      resolve(response);
    });
  });
}

function executeFallbackScraper(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = element => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const firstVisible = selectors => {
        for (const selector of selectors) {
          const matches = Array.from(document.querySelectorAll(selector));
          const found = matches.find(visible);
          if (found) return found;
        }
        return null;
      };
      const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
      const parseName = fullName => {
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
      };
      const detectExams = text => {
        const exams = [];
        if (/steuerberater(?:in)?|\bstb\b/i.test(text)) exams.push('StB');
        if (/wirtschaftspr[üu]fer(?:in)?|\bwp\b/i.test(text)) exams.push('WP');
        if (/rechtsanw[äa]lt(?:in)?|\bra\b/i.test(text)) exams.push('RA');
        if (/\bcpa\b/i.test(text)) exams.push('CPA');
        return exams.join(', ');
      };

      const data = {};
      const host = location.hostname.toLowerCase();
      const platform = host.includes('linkedin.com') ? 'linkedin' : host.includes('xing.com') ? 'xing' : 'unknown';
      const h1 = firstVisible(['main h1', 'h1']);

      if (h1) Object.assign(data, parseName(h1.textContent));

      if (platform === 'xing') {
        data.xingUrl = location.href.split('?')[0].replace(/\/$/, '');
        data.sourceChannel = 'Xing';

        let scope = h1;
        for (let i = 0; i < 6 && scope?.parentElement; i += 1) {
          scope = scope.parentElement;
          const scopeText = clean(scope.innerText);
          if (scopeText.includes(clean(h1?.textContent)) && /Deutschland|Germany|Österreich|Switzerland|Schweiz/i.test(scopeText)) break;
        }
        const lines = String(scope?.innerText || document.body.innerText || '')
          .split('\n')
          .map(clean)
          .filter(Boolean)
          .filter((line, index, all) => all.indexOf(line) === index);

        const nameLine = clean(h1?.textContent);
        const occupationLine = lines.find(line =>
          line !== nameLine &&
          /^(angestellt|selbstst[aä]ndig|freiberuflich|inhaber|partner|geschäftsführer|geschaeftsfuehrer|director|manager|consultant|senior|head|vorstand)[,\s]/i.test(line) &&
          line.includes(',')
        );

        if (occupationLine) {
          const parts = occupationLine.split(',').map(clean).filter(Boolean);
          if (/^(angestellt|selbstst[aä]ndig|freiberuflich)$/i.test(parts[0] || '') && parts.length >= 3) {
            data.currentPosition = parts[1];
            data.currentCompany = parts.slice(2).join(', ');
            data._headerParsed = true;
          } else if (parts.length >= 2) {
            data.currentPosition = parts[0];
            data.currentCompany = parts.slice(1).join(', ');
            data._headerParsed = true;
          }
        }

        const locationLine = lines.find(line =>
          /,\s*(Deutschland|Germany|Österreich|Austria|Schweiz|Switzerland)$/i.test(line)
        );
        if (locationLine) {
          data.locationFull = locationLine;
          data.companyCity = clean(locationLine.split(',')[0]);
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
      }

      if (platform === 'linkedin') {
        data.linkedInUrl = location.href.split('?')[0].replace(/\/$/, '');
        data.sourceChannel = 'LinkedIn';

        const headline = firstVisible([
          '.text-body-medium.break-words',
          '.pv-top-card--list .text-body-medium',
          '.pv-text-details__left-panel .text-body-medium',
          '[data-anonymize="headline"]'
        ]);
        if (headline) data.currentPosition = clean(headline.textContent);

        const company = firstVisible([
          '.pv-text-details__right-panel-item-text',
          'button[aria-label*="Aktuelle Firma"]',
          'button[aria-label*="Current company"]',
          '[data-anonymize="company-name"]'
        ]);
        if (company) data.currentCompany = clean(company.textContent);

        const locationElement = firstVisible([
          '.text-body-small.inline.t-black--light.break-words',
          '.pv-top-card--list-bullet .text-body-small',
          '.pv-text-details__left-panel .text-body-small.inline'
        ]);
        if (locationElement) {
          data.locationFull = clean(locationElement.textContent);
          data.companyCity = clean(data.locationFull.split(',')[0]);
        }
      }

      const emailElement = firstVisible(['a[href^="mailto:"]']);
      if (emailElement) data.email = clean(emailElement.textContent) || emailElement.href.replace(/^mailto:/i, '');
      const phoneElement = firstVisible(['a[href^="tel:"]']);
      if (phoneElement) data.phone = clean(phoneElement.textContent) || phoneElement.href.replace(/^tel:/i, '');

      data.berufsexamen = detectExams(document.body.innerText || '');
      return { success: platform !== 'unknown', platform, data };
    }
  }).then(results => results?.[0]?.result || null);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(item => item.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
  });
});

let scrapedData = null;
let esosToken = null;
let activeProfilePlatform = null;

async function ensureEsosAuth() {
  const settings = await getSettings();
  const url = getEsosUrl(settings);
  const storedJwt = settings.esos_jwt;

  if (storedJwt) {
    try {
      const response = await safeFetch(`${url}/api/auth/me`, {
        headers: { Authorization: 'Bearer ' + storedJwt }
      });
      if (response.ok) {
        esosToken = storedJwt;
        return storedJwt;
      }
    } catch (_) {}
  }

  if (!settings.esos_email || !settings.esos_password || !url) return null;

  try {
    const response = await safeFetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: settings.esos_email, password: settings.esos_password })
    });
    if (response.ok) {
      const data = await response.json();
      esosToken = data.token;
      chrome.storage.local.set({ esos_jwt: data.token });
      return data.token;
    }
  } catch (_) {}

  esosToken = null;
  return null;
}

async function esosApi(path, opts = {}) {
  const settings = await getSettings();
  const url = getEsosUrl(settings);
  let token = esosToken || await ensureEsosAuth();
  if (!token) throw new Error('Nicht eingeloggt — bitte in Settings verbinden');

  const doFetch = currentToken => safeFetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + currentToken,
      ...(opts.headers || {})
    }
  });

  let response = await doFetch(token);
  if (response.status === 401) {
    chrome.storage.local.remove('esos_jwt');
    esosToken = null;
    token = await ensureEsosAuth();
    if (!token) throw new Error('Automatische Anmeldung fehlgeschlagen');
    response = await doFetch(token);
  }
  return response;
}

const esosUrlInput = document.getElementById('esos-url');
const esosEmailInput = document.getElementById('esos-email');
const esosPasswordInput = document.getElementById('esos-password');
const bootTokenInput = document.getElementById('boot-token');
const saveSettingsBtn = document.getElementById('save-settings');
const settingsStatus = document.getElementById('settings-status');

(async () => {
  const settings = await getSettings();
  esosUrlInput.value = settings.esos_url || 'https://executive-sphere-production.up.railway.app';
  esosEmailInput.value = settings.esos_email || '';
  esosPasswordInput.value = settings.esos_password || '';
  bootTokenInput.value = settings.extension_token || '';
  esosToken = settings.esos_jwt || null;
  await checkConnections();
  loadOutreachStatus();
})();

saveSettingsBtn.addEventListener('click', async () => {
  const url = esosUrlInput.value.trim().replace(/\/$/, '');
  const email = esosEmailInput.value.trim();
  const password = esosPasswordInput.value.trim();
  const bootToken = bootTokenInput.value.trim();

  if (!url) {
    settingsStatus.textContent = '⚠️ Bitte ESOS URL eingeben';
    return;
  }
  if (!email || !password) {
    settingsStatus.textContent = '⚠️ Bitte E-Mail und Passwort eingeben';
    return;
  }

  saveSettingsBtn.disabled = true;
  settingsStatus.textContent = '⏳ Verbinde…';
  settingsStatus.style.color = '#888';

  chrome.storage.local.set({
    esos_url: url,
    esos_email: email,
    esos_password: password,
    extension_token: bootToken
  });

  if (bootToken) {
    try {
      chrome.runtime.sendMessage({ type: 'SET_TOKEN', token: bootToken });
    } catch (_) {}
  }

  try {
    const response = await safeFetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }, 10000);

    if (response.ok) {
      const data = await response.json();
      esosToken = data.token;
      chrome.storage.local.set({ esos_jwt: data.token });
      settingsStatus.textContent = '✅ ESOS verbunden! Eingeloggt als ' + (data.user?.fullName || email);
      settingsStatus.style.color = '#16a34a';
    } else {
      const error = await response.json().catch(() => ({}));
      settingsStatus.textContent = '❌ Login fehlgeschlagen: ' + (error.error || `HTTP ${response.status}`);
      settingsStatus.style.color = '#ef4444';
    }
  } catch (error) {
    settingsStatus.textContent = '❌ ESOS nicht erreichbar: ' + error.message;
    settingsStatus.style.color = '#ef4444';
  }

  saveSettingsBtn.disabled = false;
  await checkConnections();
});

async function checkConnections() {
  const esosBadge = document.getElementById('esos-badge');
  const esosBadgeText = document.getElementById('esos-badge-text');
  const bootBadge = document.getElementById('boot-badge');
  const bootBadgeText = document.getElementById('boot-badge-text');

  try {
    const token = await ensureEsosAuth();
    esosBadge.className = token ? 'conn-badge ok' : 'conn-badge fail';
    esosBadgeText.textContent = token ? 'ESOS ✓' : 'ESOS ✗';
  } catch (_) {
    esosBadge.className = 'conn-badge fail';
    esosBadgeText.textContent = 'ESOS ✗';
  }

  try {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, result => {
      if (chrome.runtime.lastError || !result?.connected) {
        bootBadge.className = 'conn-badge fail';
        bootBadgeText.textContent = 'BOOT API ✗';
        return;
      }
      bootBadge.className = 'conn-badge ok';
      bootBadgeText.textContent = 'BOOT API ✓';
    });
  } catch (_) {
    bootBadge.className = 'conn-badge fail';
    bootBadgeText.textContent = 'BOOT API ✗';
  }
}

const scrapeBtn = document.getElementById('scrape-btn');
const importBtn = document.getElementById('import-btn');
const importOpenBtn = document.getElementById('import-open-btn');
const importStatus = document.getElementById('import-status');

function updatePlatformBar(url) {
  const bar = document.getElementById('platform-bar');
  const name = document.getElementById('platform-name');
  if (!bar || !name) return;

  if (isLinkedInUrl(url)) {
    bar.style.display = 'flex';
    name.textContent = 'LinkedIn';
    name.style.color = '#0a66c2';
  } else if (isXingUrl(url)) {
    bar.style.display = 'flex';
    name.textContent = 'XING';
    name.style.color = '#006567';
  } else {
    bar.style.display = 'none';
  }
}

function mergeProfileData(primary = {}, fallback = {}) {
  const merged = { ...fallback, ...Object.fromEntries(
    Object.entries(primary).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
  ) };

  if (fallback._headerParsed) {
    if (fallback.currentPosition) merged.currentPosition = fallback.currentPosition;
    if (fallback.currentCompany) merged.currentCompany = fallback.currentCompany;
  }
  delete merged._headerParsed;
  return merged;
}

function displayProfile(data) {
  document.getElementById('import-empty').style.display = 'none';
  document.getElementById('import-profile').style.display = 'block';

  const title = data.academicTitle ? data.academicTitle + ' ' : '';
  setText('profile-name', `${title}${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unbekanntes Profil');
  setText('profile-title', data.currentPosition || '—');
  setText('profile-company', '🏢 ' + (data.currentCompany || '—'));
  setText('profile-location', '📍 ' + (data.companyCity || data.locationFull || '—'));

  setValue('candidate-title', data.academicTitle);
  setValue('candidate-first-name', data.firstName);
  setValue('candidate-last-name', data.lastName);
  setValue('candidate-gender', data.gender);
  setValue('candidate-position', data.currentPosition);
  setValue('candidate-company', data.currentCompany);
  setValue('candidate-city', data.companyCity || data.locationFull);
  setValue('candidate-zip', data.companyZip);
  setValue('candidate-email', data.email);
  setValue('candidate-phone', data.phone);
  setValue('candidate-mobile', data.phoneMobile);
  setValue('candidate-exams', data.berufsexamen);
  setValue('candidate-category', data.berufskategorie);
  setValue('candidate-availability', data.availability);
  setValue('candidate-classification', data.klassifikation);
  setValue('candidate-linkedin', data.linkedInUrl);
  setValue('candidate-xing', data.xingUrl);
  setValue('candidate-notes', data.notes);

  const emailEl = document.getElementById('profile-email');
  const phoneEl = document.getElementById('profile-phone');
  if (emailEl) {
    emailEl.style.display = data.email ? 'flex' : 'none';
    emailEl.querySelector('span').textContent = data.email || '';
  }
  if (phoneEl) {
    phoneEl.style.display = data.phone || data.phoneMobile ? 'flex' : 'none';
    phoneEl.querySelector('span').textContent = data.phoneMobile || data.phone || '';
  }

  const badgesEl = document.getElementById('profile-badges');
  badgesEl.innerHTML = '';
  if (data.berufsexamen) {
    String(data.berufsexamen).split(',').map(item => item.trim()).filter(Boolean).forEach(exam => {
      const badge = document.createElement('span');
      badge.className = 'exam-badge';
      badge.textContent = exam;
      badgesEl.appendChild(badge);
    });
  }
  if (data.availability) {
    const badge = document.createElement('span');
    badge.className = 'open-badge';
    badge.textContent = '✓ ' + data.availability;
    badgesEl.appendChild(badge);
  }
}

function readEditableProfile() {
  return {
    ...scrapedData,
    academicTitle: getValue('candidate-title') || undefined,
    firstName: getValue('candidate-first-name') || undefined,
    lastName: getValue('candidate-last-name') || undefined,
    gender: getValue('candidate-gender') || undefined,
    currentPosition: getValue('candidate-position') || undefined,
    currentCompany: getValue('candidate-company') || undefined,
    companyCity: getValue('candidate-city') || undefined,
    companyZip: getValue('candidate-zip') || undefined,
    email: getValue('candidate-email') || undefined,
    phone: getValue('candidate-phone') || undefined,
    phoneMobile: getValue('candidate-mobile') || undefined,
    berufsexamen: getValue('candidate-exams') || undefined,
    berufskategorie: getValue('candidate-category') || undefined,
    availability: getValue('candidate-availability') || undefined,
    klassifikation: getValue('candidate-classification') || undefined,
    linkedInUrl: getValue('candidate-linkedin') || undefined,
    xingUrl: getValue('candidate-xing') || undefined,
    notes: getValue('candidate-notes') || undefined,
    sourceChannel: scrapedData?.sourceChannel || (activeProfilePlatform === 'linkedin' ? 'LinkedIn' : activeProfilePlatform === 'xing' ? 'Xing' : 'BOOT Extension')
  };
}

async function ensureContentScript(tabId) {
  try {
    await sendTabMessage(tabId, { type: 'PING' });
    return;
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

async function loadCurrentProfile({ auto = false } = {}) {
  scrapeBtn.disabled = true;
  scrapeBtn.innerHTML = '<span class="spinner"></span> Lese Profil…';
  importStatus.textContent = auto ? 'Profil wird automatisch ausgelesen…' : '';
  importStatus.style.color = '#64748b';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !isSupportedProfileUrl(tab.url || '')) {
      throw new Error('Bitte ein LinkedIn- oder XING-Profil öffnen.');
    }

    updatePlatformBar(tab.url || '');
    await ensureContentScript(tab.id);

    let response = null;
    try {
      response = await sendTabMessage(tab.id, { type: 'SCRAPE_PROFILE' });
    } catch (_) {}

    let fallback = null;
    try {
      fallback = await executeFallbackScraper(tab.id);
    } catch (_) {}

    const primary = response?.success ? response.data || {} : {};
    const fallbackData = fallback?.success ? fallback.data || {} : {};
    const merged = mergeProfileData(primary, fallbackData);

    if (!merged.lastName && !merged.firstName) {
      throw new Error(response?.error || 'Profil konnte nicht zuverlässig gelesen werden.');
    }

    activeProfilePlatform = response?.platform || fallback?.platform || (isLinkedInUrl(tab.url) ? 'linkedin' : 'xing');
    scrapedData = merged;
    displayProfile(scrapedData);

    importStatus.textContent = '✅ Profil automatisch gelesen. Felder können vor dem Import geändert werden.';
    importStatus.style.color = '#16a34a';

    await Promise.allSettled([
      checkDuplicate(readEditableProfile()),
      loadOpportunities()
    ]);

    scrapeBtn.textContent = '🔄 Profil neu einlesen';
  } catch (error) {
    importStatus.textContent = '❌ ' + error.message;
    importStatus.style.color = '#ef4444';
    scrapeBtn.textContent = '🔍 Profil einlesen';
  } finally {
    scrapeBtn.disabled = false;
  }
}

scrapeBtn.addEventListener('click', () => loadCurrentProfile({ auto: false }));

async function checkDuplicate(data) {
  try {
    const response = await esosApi('/api/extension/check-duplicate', {
      method: 'POST',
      body: JSON.stringify({
        linkedInUrl: data.linkedInUrl,
        xingUrl: data.xingUrl,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName
      })
    });

    if (!response.ok) return;
    const result = await response.json();
    const warning = document.getElementById('duplicate-warning');

    if (result.isDuplicate) {
      warning.style.display = 'block';
      setText('duplicate-text', `Existiert bereits als "${result.contactName || 'Kontakt'}". Import aktualisiert vorhandene Daten.`);
      importBtn.textContent = '🔄 Daten in ESOS aktualisieren';
    } else {
      warning.style.display = 'none';
      importBtn.textContent = '📥 In ESOS übernehmen';
    }
  } catch (_) {}
}

async function loadOpportunities() {
  try {
    const response = await esosApi('/api/extension/opportunities');
    if (!response.ok) return;
    const opportunities = await response.json();
    const select = document.getElementById('opportunity-select');
    const currentValue = select.value;
    select.innerHTML = '<option value="">— Kein Mandat —</option>';
    (opportunities || []).forEach(opportunity => {
      const option = document.createElement('option');
      option.value = opportunity.id;
      option.textContent = `${opportunity.mandateNumber || '—'} · ${opportunity.soughtRole || opportunity.name || '—'} (${opportunity.accountName || '—'})`;
      select.appendChild(option);
    });
    if (currentValue) select.value = currentValue;
  } catch (_) {}
}

importBtn.addEventListener('click', async () => {
  if (!scrapedData) {
    importStatus.textContent = '⚠️ Zuerst ein Profil einlesen.';
    importStatus.style.color = '#f59e0b';
    return;
  }

  const payload = readEditableProfile();
  if (!payload.lastName) {
    importStatus.textContent = '⚠️ Nachname fehlt. Bitte prüfen.';
    importStatus.style.color = '#f59e0b';
    return;
  }

  const token = await ensureEsosAuth();
  if (!token) {
    importStatus.textContent = '⚠️ Zuerst ESOS-Verbindung in Settings konfigurieren.';
    importStatus.style.color = '#f59e0b';
    return;
  }

  importBtn.disabled = true;
  importBtn.innerHTML = '<span class="spinner"></span> Übernehme…';
  importStatus.textContent = '';

  try {
    payload.opportunityId = document.getElementById('opportunity-select')?.value || undefined;
    const response = await esosApi('/api/extension/import-candidate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      const action = result.action === 'created' ? 'Neu erstellt' : 'Aktualisiert';
      importStatus.textContent = `✅ ${action}! ID: ${result.contactId || '—'}`;
      importStatus.style.color = '#16a34a';
      importBtn.textContent = '✅ In ESOS übernommen';
      importBtn.style.background = '#16a34a';

      if (result.contactId && importOpenBtn) {
        importOpenBtn.style.display = 'block';
        const settings = await getSettings();
        const url = getEsosUrl(settings);
        importOpenBtn.onclick = () => chrome.tabs.create({ url: `${url}/contacts/${result.contactId}` });
      }
    } else {
      const error = await response.json().catch(() => ({}));
      if (error.blacklisted) {
        importStatus.textContent = `🛡️ Domain @${error.domain} gesperrt — Kandidat darf nicht importiert werden.`;
      } else {
        importStatus.textContent = '❌ ' + (error.error || 'Import fehlgeschlagen');
      }
      importStatus.style.color = '#ef4444';
    }
  } catch (error) {
    importStatus.textContent = '❌ ' + error.message;
    importStatus.style.color = '#ef4444';
  } finally {
    importBtn.disabled = false;
    setTimeout(() => {
      importBtn.textContent = '📥 In ESOS übernehmen';
      importBtn.style.background = '';
    }, 2500);
  }
});

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    updatePlatformBar(tab.url || '');
    if (isSupportedProfileUrl(tab.url || '')) {
      await loadCurrentProfile({ auto: true });
    }
  } catch (_) {}
})();

function loadOutreachStatus() {
  try {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, result => {
      if (chrome.runtime.lastError) return;

      const badge = document.getElementById('outreach-badge');
      const badgeText = document.getElementById('outreach-badge-text');
      if (!badge || !badgeText) return;

      if (result?.connected) {
        badge.className = 'conn-badge ok';
        badgeText.textContent = 'Verbunden';

        if (result.stats) {
          setText('queued', String(result.stats.queued || 0));
          setText('completed', String(result.stats.completed || 0));
        }
        setText('today', String(result.dailyCount || 0));

        const statusElement = document.getElementById('active-status');
        if (statusElement) {
          statusElement.textContent = result.isActive ? '🟢 Aktiv' : '🔴 Pausiert';
          statusElement.style.color = result.isActive ? '#22c55e' : '#ef4444';
        }

        if (result.config) {
          setText('active-hours', `${result.config.active_hours_start || '—'} – ${result.config.active_hours_end || '—'}`);
          setText('daily-limit', `${result.dailyCount || 0} / ${result.config.daily_limit || '—'}`);
        }
      } else {
        badge.className = 'conn-badge fail';
        badgeText.textContent = 'Nicht verbunden';
      }
    });
  } catch (_) {}
}
