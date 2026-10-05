// popup.js — ESOS AI Extension
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

const DEFAULT_ESOS_URL = 'https://esos-web-production.up.railway.app';

function getEsosUrl(settings) {
  const configured = String(settings?.esos_url || '').trim().replace(/\/$/, '');
  if (!configured) return DEFAULT_ESOS_URL;
  try {
    const parsed = new URL(configured);
    const defaultHost = new URL(DEFAULT_ESOS_URL).hostname;
    if (parsed.hostname.endsWith('.up.railway.app') && parsed.hostname !== defaultHost) {
      chrome.storage.local.set({ esos_url: DEFAULT_ESOS_URL });
      return DEFAULT_ESOS_URL;
    }
  } catch (_) {}
  return configured;
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
  esosUrlInput.value = getEsosUrl(settings);
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
        bootBadgeText.textContent = 'ESOS AI API ✗';
        return;
      }
      bootBadge.className = 'conn-badge ok';
      bootBadgeText.textContent = 'ESOS AI API ✓';
    });
  } catch (_) {
    bootBadge.className = 'conn-badge fail';
    bootBadgeText.textContent = 'ESOS AI API ✗';
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
    sourceChannel: scrapedData?.sourceChannel || (activeProfilePlatform === 'linkedin' ? 'LinkedIn' : activeProfilePlatform === 'xing' ? 'Xing' : 'ESOS AI Extension')
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


const NETWORK_SYNC_SUCCESS_STORAGE_KEY = 'esos_network_sync_success_urls_v1';

async function loadNetworkSyncSuccessUrls() {
  const textarea = document.getElementById('network-sync-success-urls');
  const count = document.getElementById('network-sync-url-count');
  if (!textarea || !count) return;
  const stored = await chrome.storage.local.get(NETWORK_SYNC_SUCCESS_STORAGE_KEY);
  const entries = Array.isArray(stored?.[NETWORK_SYNC_SUCCESS_STORAGE_KEY])
    ? stored[NETWORK_SYNC_SUCCESS_STORAGE_KEY]
    : [];
  const urls = entries.map(entry => String(entry?.url || '').trim()).filter(Boolean);
  textarea.value = urls.join('\n');
  count.textContent = String(urls.length);
}

const copyNetworkSyncUrlsBtn = document.getElementById('copy-network-sync-urls');
const clearNetworkSyncUrlsBtn = document.getElementById('clear-network-sync-urls');
const networkSyncUrlStatus = document.getElementById('network-sync-url-status');

copyNetworkSyncUrlsBtn?.addEventListener('click', async () => {
  const textarea = document.getElementById('network-sync-success-urls');
  const value = String(textarea?.value || '').trim();
  if (!value) {
    if (networkSyncUrlStatus) networkSyncUrlStatus.textContent = 'Keine erfolgreichen URLs vorhanden.';
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    if (networkSyncUrlStatus) networkSyncUrlStatus.textContent = '✅ URL-Liste kopiert.';
  } catch (_) {
    textarea?.focus();
    textarea?.select();
    try {
      document.execCommand('copy');
      if (networkSyncUrlStatus) networkSyncUrlStatus.textContent = '✅ URL-Liste kopiert.';
    } catch (error) {
      if (networkSyncUrlStatus) networkSyncUrlStatus.textContent = '❌ Kopieren fehlgeschlagen.';
    }
  }
});

clearNetworkSyncUrlsBtn?.addEventListener('click', async () => {
  await chrome.storage.local.set({ [NETWORK_SYNC_SUCCESS_STORAGE_KEY]: [] });
  await loadNetworkSyncSuccessUrls();
  if (networkSyncUrlStatus) networkSyncUrlStatus.textContent = 'Liste geleert.';
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[NETWORK_SYNC_SUCCESS_STORAGE_KEY]) {
    loadNetworkSyncSuccessUrls().catch(() => {});
  }
});

loadNetworkSyncSuccessUrls().catch(() => {});


// ESOS_MANUAL_OUTREACH_POPUP_V421
(() => {
  const connectBtn = document.getElementById('manual-mode-connect');
  const messageBtn = document.getElementById('manual-mode-message');
  const subjectInput = document.getElementById('manual-outreach-subject');
  const textInput = document.getElementById('manual-outreach-text');
  const sendBtn = document.getElementById('manual-outreach-send');
  const statusEl = document.getElementById('manual-outreach-status');
  const platformEl = document.getElementById('manual-outreach-platform');
  const hoverToggle = document.getElementById('hover-highlight-toggle');

  if (!connectBtn || !messageBtn || !textInput || !sendBtn) return;

  let mode = 'connect';
  const DEFAULT_NOTE = 'Vielen Dank für die Vernetzung. Ich würde mich gerne kurz und unverbindlich mit Ihnen zu einer interessanten beruflichen Möglichkeit austauschen.';

  function setMode(next) {
    mode = next === 'message' ? 'message' : 'connect';
    connectBtn.classList.toggle('active', mode === 'connect');
    messageBtn.classList.toggle('active', mode === 'message');
    if (subjectInput) subjectInput.style.display = mode === 'message' ? 'block' : 'none';
    sendBtn.textContent = mode === 'message' ? 'Nachricht / InMail senden' : 'Vernetzungsanfrage senden';
    chrome.storage.local.set({ esos_manual_outreach_mode: mode });
  }

  function activeTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] || null));
    });
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message || 'Content-Script nicht erreichbar.' });
          return;
        }
        resolve(response || { success: false, error: 'Keine Antwort vom Profil-Tab.' });
      });
    });
  }

  async function refreshPlatform() {
    const tab = await activeTab();
    const url = String(tab?.url || '');
    let label = 'PROFIL';
    let ok = false;
    if (/linkedin\.com/i.test(url)) { label = 'LINKEDIN'; ok = true; }
    else if (/xing\.com/i.test(url)) { label = 'XING'; ok = true; }
    if (platformEl) {
      platformEl.textContent = label;
      platformEl.classList.toggle('ok', ok);
    }
  }

  async function sendManualOutreach() {
    const tab = await activeTab();
    if (!tab?.id || !/linkedin\.com|xing\.com/i.test(String(tab.url || ''))) {
      if (statusEl) statusEl.textContent = 'Bitte zuerst ein LinkedIn- oder XING-Profil öffnen.';
      return;
    }

    const body = String(textInput.value || '').trim();
    const subject = String(subjectInput?.value || '').trim();
    if (!body) {
      if (statusEl) statusEl.textContent = 'Bitte zuerst einen Text eingeben.';
      return;
    }

    sendBtn.disabled = true;
    if (statusEl) statusEl.textContent = mode === 'connect'
      ? 'Vernetzungsanfrage wird vorbereitet …'
      : 'Nachricht wird vorbereitet …';

    await chrome.storage.local.set({
      esos_manual_outreach_text: body,
      esos_manual_outreach_subject: subject,
      esos_manual_outreach_mode: mode,
    });

    const result = await sendToTab(tab.id, {
      type: 'ESOS_MANUAL_OUTREACH_V421',
      mode,
      note: body,
      body,
      subject,
    });

    if (statusEl) statusEl.textContent = result?.success
      ? (result.detail || 'Erfolgreich ausgeführt.')
      : (result?.error || 'Aktion fehlgeschlagen.');
    sendBtn.disabled = false;
  }

  connectBtn.addEventListener('click', () => setMode('connect'));
  messageBtn.addEventListener('click', () => setMode('message'));
  sendBtn.addEventListener('click', sendManualOutreach);

  if (hoverToggle) {
    hoverToggle.addEventListener('change', () => {
      chrome.storage.local.set({ esos_hover_highlight_fields: Boolean(hoverToggle.checked) });
    });
  }

  chrome.storage.local.get([
    'esos_manual_outreach_text',
    'esos_manual_outreach_subject',
    'esos_manual_outreach_mode',
    'esos_hover_highlight_fields',
  ], (stored) => {
    textInput.value = stored.esos_manual_outreach_text || DEFAULT_NOTE;
    if (subjectInput) subjectInput.value = stored.esos_manual_outreach_subject || '';
    setMode(stored.esos_manual_outreach_mode || 'connect');
    if (hoverToggle) hoverToggle.checked = Boolean(stored.esos_hover_highlight_fields);
  });

  refreshPlatform();
})();


// ESOS_LINKEDHELPER_BATCH_V421
(() => {
  const xingProjectInput = document.getElementById('network-xing-project');
  const runXingBtn = document.getElementById('network-run-xing');
  const runLinkedInBtn = document.getElementById('network-run-linkedin');
  const statusEl = document.getElementById('network-run-status');
  const newCountEl = document.getElementById('network-new-count');
  const existingCountEl = document.getElementById('network-existing-count');
  const errorCountEl = document.getElementById('network-error-count');
  if (!runXingBtn || !runLinkedInBtn) return;

  const SUCCESS_KEY = 'esos_network_sync_success_urls_v1';
  const META_KEY = 'esos_socialfinder_profile_metadata_v421';
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const canonical = (url, network) => {
    try {
      const parsed = new URL(String(url || ''));
      parsed.hash = '';
      parsed.search = '';
      parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
      if (network === 'linkedin') {
        const match = parsed.pathname.match(/^\/in\/([^/]+)/i);
        return match ? 'linkedin:' + match[1].toLowerCase() : '';
      }
      const match = parsed.pathname.match(/^\/profile\/([^/]+)/i);
      return match ? 'xing:' + match[1].toLowerCase() : '';
    } catch (_) {
      return '';
    }
  };

  function sendTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message || 'Tab nicht erreichbar.' });
          return;
        }
        resolve(response || { success: false, error: 'Keine Antwort vom Profil-Tab.' });
      });
    });
  }

  function getTab(tabId) {
    return new Promise((resolve) => chrome.tabs.get(tabId, (tab) => resolve(chrome.runtime.lastError ? null : tab)));
  }

  async function waitReady(tabId, timeout) {
    const end = Date.now() + (timeout || 18000);
    let stableUrl = '';
    let stableAt = 0;
    while (Date.now() < end) {
      const tab = await getTab(tabId);
      if (!tab) return false;
      const url = String(tab.url || '');
      if (url !== stableUrl) { stableUrl = url; stableAt = Date.now(); }
      if (tab.status === 'complete' && Date.now() - stableAt > 450) return true;
      await delay(220);
    }
    return false;
  }

  function queryTabs(patterns) {
    return new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true, url: patterns }, (tabs) => resolve(tabs || []));
    });
  }

  async function scrapeProfile(tabId) {
    const result = await sendTab(tabId, { type: 'SCRAPE_PROFILE' });
    return result && result.success ? (result.data || {}) : {};
  }

  async function saveNewSuccess(network, url, candidateName, profileData) {
    const stored = await chrome.storage.local.get([SUCCESS_KEY, META_KEY]);
    const existing = Array.isArray(stored[SUCCESS_KEY]) ? stored[SUCCESS_KEY] : [];
    const wanted = canonical(url, network) || String(url || '').trim().toLowerCase();
    const filtered = existing.filter((entry) => {
      const entryNetwork = String(entry && entry.network || '');
      const key = canonical(entry && entry.url, entryNetwork) || String(entry && entry.url || '').trim().toLowerCase();
      return key !== wanted;
    });
    filtered.push({
      network: network,
      url: url,
      candidateName: String(candidateName || '').trim() || null,
      succeededAt: new Date().toISOString(),
    });

    const metadata = stored[META_KEY] && typeof stored[META_KEY] === 'object' ? stored[META_KEY] : {};
    const urlKey = String(url || '').trim().replace(/\/+$/, '').toLowerCase();
    metadata[urlKey] = {
      url: url,
      network: network,
      currentPosition: profileData && profileData.currentPosition || '',
      currentCompany: profileData && profileData.currentCompany || '',
      city: profileData && (profileData.companyCity || profileData.locationFull) || '',
      gender: profileData && profileData.gender || '',
      positionStartedAt: profileData && (profileData.positionStartedAt || profileData.currentPositionStartedAt) || '',
      observedAt: new Date().toISOString(),
      source: 'esos_ai_unified_v421',
    };
    const update = {};
    update[SUCCESS_KEY] = filtered.slice(-1000);
    update[META_KEY] = metadata;
    await chrome.storage.local.set(update);
  }

  function updateCounters(stats) {
    if (newCountEl) newCountEl.textContent = String(stats.added);
    if (existingCountEl) existingCountEl.textContent = String(stats.existing);
    if (errorCountEl) errorCountEl.textContent = String(stats.errors);
  }

  function isAlready(result) {
    const detail = String(result && result.detail || '');
    return Boolean(result && result.alreadyAssigned)
      || (/\b(bereits|already|gespeichert)\b/i.test(detail) && !/\bhinzugefügt|added\b/i.test(detail));
  }

  async function closeTab(tabId) {
    return new Promise((resolve) => chrome.tabs.remove(tabId, () => resolve()));
  }

  async function runXing() {
    const project = String(xingProjectInput && xingProjectInput.value || '').trim();
    if (!project) {
      if (statusEl) statusEl.textContent = 'Bitte zuerst das XING-Zielprojekt eingeben.';
      return;
    }
    await chrome.storage.local.set({ esos_linkedhelper_xing_project: project });
    const tabs = (await queryTabs(['https://xing.com/*','https://www.xing.com/*','https://*.xing.com/*']))
      .filter((tab) => /\/profile\//i.test(String(tab.url || '')));
    if (!tabs.length) {
      if (statusEl) statusEl.textContent = 'Keine geöffneten XING-Kandidatenprofile gefunden.';
      return;
    }

    const stats = { added: 0, existing: 0, errors: 0 };
    updateCounters(stats);
    runXingBtn.disabled = true;
    if (statusEl) statusEl.textContent = tabs.length + ' XING-Profile werden verarbeitet …';

    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index];
      const sourceUrl = String(tab.url || '');
      if (statusEl) statusEl.textContent = 'XING ' + (index + 1) + '/' + tabs.length + ': Profil wird geprüft …';

      const profileData = await scrapeProfile(tab.id);
      const opened = await sendTab(tab.id, { type: 'ESOS_XING_OPEN_TALENT_MANAGER' });
      if (!opened || !opened.success) {
        stats.errors += 1; updateCounters(stats);
        continue;
      }

      if (opened.navigating) {
        await waitReady(tab.id, 18000);
        await delay(450);
      }
      const added = await sendTab(tab.id, {
        type: 'ESOS_XING_ADD_PROJECT',
        payload: { project_name: project, project_url: '' },
      });

      if (!added || !added.success) {
        stats.errors += 1; updateCounters(stats);
        continue;
      }

      if (isAlready(added)) {
        stats.existing += 1;
      } else {
        stats.added += 1;
        await saveNewSuccess('xing', sourceUrl, added.candidateName || opened.candidateName, profileData);
      }
      updateCounters(stats);
      await closeTab(tab.id);
      await delay(180);
    }

    runXingBtn.disabled = false;
    if (statusEl) statusEl.textContent = 'Fertig: ' + stats.added + ' neu · ' + stats.existing + ' bereits im Projekt · ' + stats.errors + ' Fehler. Fehler-Tabs bleiben offen.';
  }

  async function runLinkedIn() {
    const tabs = (await queryTabs(['https://linkedin.com/*','https://www.linkedin.com/*','https://*.linkedin.com/*']))
      .filter((tab) => /\/in\//i.test(String(tab.url || '')));
    if (!tabs.length) {
      if (statusEl) statusEl.textContent = 'Keine geöffneten LinkedIn-Kandidatenprofile gefunden.';
      return;
    }

    const stats = { added: 0, existing: 0, errors: 0 };
    updateCounters(stats);
    runLinkedInBtn.disabled = true;
    if (statusEl) statusEl.textContent = tabs.length + ' LinkedIn-Profile werden verarbeitet …';

    for (let index = 0; index < tabs.length; index += 1) {
      const tab = tabs[index];
      const sourceUrl = String(tab.url || '');
      if (statusEl) statusEl.textContent = 'LinkedIn ' + (index + 1) + '/' + tabs.length + ': Profil wird geprüft …';

      const profileData = await scrapeProfile(tab.id);
      const result = await sendTab(tab.id, { type: 'ESOS_LINKEDIN_SAVE_SALES_NAV' });

      if (!result || !result.success) {
        stats.errors += 1; updateCounters(stats);
        continue;
      }

      if (isAlready(result)) {
        stats.existing += 1;
      } else {
        stats.added += 1;
        await saveNewSuccess('linkedin', sourceUrl, result.candidateName, profileData);
      }
      updateCounters(stats);
      await closeTab(tab.id);
      await delay(180);
    }

    runLinkedInBtn.disabled = false;
    if (statusEl) statusEl.textContent = 'Fertig: ' + stats.added + ' neu · ' + stats.existing + ' bereits gespeichert · ' + stats.errors + ' Fehler. Fehler-Tabs bleiben offen.';
  }

  runXingBtn.addEventListener('click', runXing);
  runLinkedInBtn.addEventListener('click', runLinkedIn);

  chrome.storage.local.get(['esos_linkedhelper_xing_project'], (stored) => {
    if (xingProjectInput) xingProjectInput.value = stored.esos_linkedhelper_xing_project || '';
  });
})();
