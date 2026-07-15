// popup.js — MatchMaker BOOT Extension v3.2.1 (Stable)
// Tabs: CRM Import | Outreach | Settings
// Key improvements: auto-reauth, fetch timeouts, graceful error recovery

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

/** Fetch with timeout (default 8s) + error wrapping */
async function safeFetch(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung — Server antwortet nicht');
    throw e;
  }
}

/** Get stored settings */
function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['esos_url', 'esos_email', 'esos_password', 'extension_token', 'esos_jwt'],
      res => resolve(res)
    );
  });
}

/** Get ESOS API base URL */
function getEsosUrl(settings) {
  return (settings?.esos_url || 'https://executive-sphere-production.up.railway.app').replace(/\/$/, '');
}

// ═══════════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════════

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════

let scrapedData = null;
let esosToken = null;

// ═══════════════════════════════════════════════════════════════════════
// ESOS AUTH — auto-login, token refresh
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ensure we have a valid ESOS JWT token.
 * Tries stored token first (/api/auth/me), falls back to re-login.
 * Returns token or null.
 */
async function ensureEsosAuth() {
  const settings = await getSettings();
  const url = getEsosUrl(settings);
  const storedJwt = settings.esos_jwt;

  // 1) Try existing token
  if (storedJwt) {
    try {
      const r = await safeFetch(`${url}/api/auth/me`, {
        headers: { Authorization: 'Bearer ' + storedJwt }
      });
      if (r.ok) {
        esosToken = storedJwt;
        return storedJwt;
      }
    } catch (e) { /* token invalid or expired → re-login below */ }
  }

  // 2) Re-login with stored credentials
  const email = settings.esos_email;
  const password = settings.esos_password;
  if (!email || !password || !url) return null;

  try {
    const r = await safeFetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (r.ok) {
      const data = await r.json();
      esosToken = data.token;
      chrome.storage.local.set({ esos_jwt: data.token });
      return data.token;
    }
  } catch (e) { /* login failed */ }

  esosToken = null;
  return null;
}

/**
 * Make an authenticated ESOS API call.
 * Auto-retries once with fresh token if 401.
 */
async function esosApi(path, opts = {}) {
  const settings = await getSettings();
  const url = getEsosUrl(settings);

  let token = esosToken || (await ensureEsosAuth());
  if (!token) throw new Error('Nicht eingeloggt — bitte in Settings verbinden');

  const doFetch = async (t) => {
    return safeFetch(`${url}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + t,
        ...(opts.headers || {})
      }
    });
  };

  let r = await doFetch(token);
  if (r.status === 401) {
    // Token expired → re-auth and retry
    token = await ensureEsosAuth();
    if (!token) throw new Error('Automatische Anmeldung fehlgeschlagen');
    r = await doFetch(token);
  }
  return r;
}

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════════

const esosUrlInput = document.getElementById('esos-url');
const esosEmailInput = document.getElementById('esos-email');
const esosPasswordInput = document.getElementById('esos-password');
const bootTokenInput = document.getElementById('boot-token');
const saveSettingsBtn = document.getElementById('save-settings');
const settingsStatus = document.getElementById('settings-status');

// Load saved settings
(async () => {
  const res = await getSettings();
  esosUrlInput.value = res.esos_url || 'https://executive-sphere-production.up.railway.app';
  esosEmailInput.value = res.esos_email || '';
  esosPasswordInput.value = res.esos_password || '';
  bootTokenInput.value = res.extension_token || '';
  esosToken = res.esos_jwt || null;

  // Silent auth check + update badges
  await checkConnections();
  loadOutreachStatus();
})();

saveSettingsBtn.addEventListener('click', async () => {
  const url = esosUrlInput.value.trim().replace(/\/$/, '');
  const email = esosEmailInput.value.trim();
  const password = esosPasswordInput.value.trim();
  const bootToken = bootTokenInput.value.trim();

  if (!url) { settingsStatus.textContent = '⚠️ Bitte ESOS URL eingeben'; return; }
  if (!email || !password) { settingsStatus.textContent = '⚠️ Bitte E-Mail und Passwort eingeben'; return; }

  saveSettingsBtn.disabled = true;
  settingsStatus.textContent = '⏳ Verbinde…';
  settingsStatus.style.color = '#888';

  // Save all settings first
  chrome.storage.local.set({
    esos_url: url,
    esos_email: email,
    esos_password: password,
    extension_token: bootToken
  });

  // Tell background.js about BOOT token
  if (bootToken) {
    try { chrome.runtime.sendMessage({ type: 'SET_TOKEN', token: bootToken }); } catch (e) {}
  }

  // Try ESOS login
  try {
    const r = await safeFetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }, 10000);

    if (r.ok) {
      const data = await r.json();
      esosToken = data.token;
      chrome.storage.local.set({ esos_jwt: data.token });
      settingsStatus.textContent = '✅ ESOS verbunden! Eingeloggt als ' + (data.user?.fullName || email);
      settingsStatus.style.color = '#16a34a';
    } else {
      const err = await r.json().catch(() => ({}));
      settingsStatus.textContent = '❌ Login fehlgeschlagen: ' + (err.error || `HTTP ${r.status}`);
      settingsStatus.style.color = '#ef4444';
    }
  } catch (e) {
    settingsStatus.textContent = '❌ ESOS nicht erreichbar: ' + e.message;
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

  // Check ESOS — use ensureEsosAuth (handles auto-relogin)
  try {
    const token = await ensureEsosAuth();
    if (token) {
      esosBadge.className = 'conn-badge ok';
      esosBadgeText.textContent = 'ESOS ✓';
    } else {
      esosBadge.className = 'conn-badge fail';
      esosBadgeText.textContent = 'ESOS ✗';
    }
  } catch (e) {
    esosBadge.className = 'conn-badge fail';
    esosBadgeText.textContent = 'ESOS ✗';
  }

  // Check BOOT
  try {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError) {
        bootBadge.className = 'conn-badge fail';
        bootBadgeText.textContent = 'BOOT API ✗';
        return;
      }
      if (res?.connected) {
        bootBadge.className = 'conn-badge ok';
        bootBadgeText.textContent = 'BOOT API ✓';
      } else {
        bootBadge.className = 'conn-badge fail';
        bootBadgeText.textContent = 'BOOT API ✗';
      }
    });
  } catch (e) {
    bootBadge.className = 'conn-badge fail';
    bootBadgeText.textContent = 'BOOT API ✗';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CRM IMPORT TAB
// ═══════════════════════════════════════════════════════════════════════

const scrapeBtn = document.getElementById('scrape-btn');
const importBtn = document.getElementById('import-btn');
const importOpenBtn = document.getElementById('import-open-btn');
const importStatus = document.getElementById('import-status');

// Detect platform on current tab
try {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || !tabs[0]) return;
    const tabUrl = tabs[0].url || '';
    const bar = document.getElementById('platform-bar');
    const name = document.getElementById('platform-name');
    if (!bar || !name) return;

    if (tabUrl.includes('linkedin.com')) {
      bar.style.display = 'flex';
      name.textContent = 'LinkedIn';
      name.style.color = '#0a66c2';
    } else if (tabUrl.includes('xing.com')) {
      bar.style.display = 'flex';
      name.textContent = 'Xing';
      name.style.color = '#006567';
    }
  });
} catch (e) { /* tab query failed — not critical */ }

// Scrape profile button
scrapeBtn.addEventListener('click', async () => {
  scrapeBtn.disabled = true;
  scrapeBtn.innerHTML = '<span class="spinner"></span> Lade Profil…';
  importStatus.textContent = '';
  importStatus.style.color = '#888';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Kein aktiver Tab');

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // Script might already be injected — that's fine
    }

    // Small delay to let content script initialize
    await new Promise(r => setTimeout(r, 300));

    chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PROFILE' }, async (response) => {
      if (chrome.runtime.lastError) {
        importStatus.textContent = '❌ Seite nicht unterstützt. Bitte ein LinkedIn- oder Xing-Profil öffnen.';
        importStatus.style.color = '#ef4444';
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = '🔍 Profil laden';
        return;
      }

      if (!response?.success) {
        importStatus.textContent = '❌ ' + (response?.error || 'Profil konnte nicht gelesen werden');
        importStatus.style.color = '#ef4444';
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = '🔍 Profil laden';
        return;
      }

      scrapedData = response.data;
      displayProfile(scrapedData);
      await checkDuplicate(scrapedData);
      await loadOpportunities();

      scrapeBtn.textContent = '🔄 Erneut laden';
      scrapeBtn.disabled = false;
    });
  } catch (e) {
    importStatus.textContent = '❌ ' + e.message;
    importStatus.style.color = '#ef4444';
    scrapeBtn.disabled = false;
    scrapeBtn.textContent = '🔍 Profil laden';
  }
});

function displayProfile(data) {
  const empty = document.getElementById('import-empty');
  const profile = document.getElementById('import-profile');
  if (empty) empty.style.display = 'none';
  if (profile) profile.style.display = 'block';

  const title = data.academicTitle ? data.academicTitle + ' ' : '';
  setText('profile-name', title + (data.firstName || '') + ' ' + (data.lastName || ''));
  setText('profile-title', data.currentPosition || '—');
  setText('profile-company', '🏢 ' + (data.currentCompany || '—'));
  setText('profile-location', '📍 ' + (data.companyCity || data.locationFull || '—'));

  // Email
  const emailEl = document.getElementById('profile-email');
  if (emailEl) {
    if (data.email) {
      emailEl.style.display = 'flex';
      const span = emailEl.querySelector('span');
      if (span) span.textContent = data.email;
    } else {
      emailEl.style.display = 'none';
    }
  }

  // Phone
  const phoneEl = document.getElementById('profile-phone');
  if (phoneEl) {
    if (data.phone) {
      phoneEl.style.display = 'flex';
      const span = phoneEl.querySelector('span');
      if (span) span.textContent = data.phone;
    } else {
      phoneEl.style.display = 'none';
    }
  }

  // Badges
  const badgesEl = document.getElementById('profile-badges');
  if (badgesEl) {
    badgesEl.innerHTML = '';
    if (data.berufsexamen) {
      data.berufsexamen.split(', ').forEach(exam => {
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
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function checkDuplicate(data) {
  try {
    const r = await esosApi('/api/extension/check-duplicate', {
      method: 'POST',
      body: JSON.stringify({
        linkedInUrl: data.linkedInUrl,
        xingUrl: data.xingUrl,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName
      })
    });

    if (r.ok) {
      const result = await r.json();
      const warning = document.getElementById('duplicate-warning');
      if (warning) {
        if (result.isDuplicate) {
          warning.style.display = 'block';
          const dupText = document.getElementById('duplicate-text');
          if (dupText) dupText.textContent =
            `Existiert bereits als "${result.contactName || 'Kontakt'}". Import aktualisiert vorhandene Daten.`;
          if (importBtn) importBtn.textContent = '🔄 Daten aktualisieren';
        } else {
          warning.style.display = 'none';
          if (importBtn) importBtn.textContent = '📥 In ESOS importieren';
        }
      }
    }
  } catch (e) {
    console.warn('Duplikat-Check fehlgeschlagen:', e.message);
    // Non-critical — continue without duplicate check
  }
}

async function loadOpportunities() {
  try {
    const r = await esosApi('/api/extension/opportunities');
    if (r.ok) {
      const opps = await r.json();
      const select = document.getElementById('opportunity-select');
      if (select) {
        select.innerHTML = '<option value="">— Kein Mandat —</option>';
        (opps || []).forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.id;
          opt.textContent = `${o.mandateNumber || '—'} · ${o.soughtRole || o.title || '—'} (${o.accountName || '—'})`;
          select.appendChild(opt);
        });
      }
    }
  } catch (e) {
    console.warn('Mandate laden fehlgeschlagen:', e.message);
  }
}

// Import button
importBtn.addEventListener('click', async () => {
  if (!scrapedData) return;

  // Check auth
  const token = await ensureEsosAuth();
  if (!token) {
    importStatus.textContent = '⚠️ Zuerst ESOS-Verbindung in Settings konfigurieren!';
    importStatus.style.color = '#f59e0b';
    return;
  }

  importBtn.disabled = true;
  importBtn.innerHTML = '<span class="spinner"></span> Importiere…';
  importStatus.textContent = '';

  try {
    const opportunityId = document.getElementById('opportunity-select')?.value || undefined;

    const r = await esosApi('/api/extension/import-candidate', {
      method: 'POST',
      body: JSON.stringify({
        ...scrapedData,
        opportunityId
      })
    });

    if (r.ok) {
      const result = await r.json();
      const action = result.action === 'created' ? 'Neu erstellt' : 'Aktualisiert';
      importStatus.textContent = `✅ ${action}! ID: ${result.contactId || '—'}`;
      importStatus.style.color = '#16a34a';
      importBtn.textContent = '✅ Importiert!';
      importBtn.style.background = '#16a34a';

      // Show "Open in CRM" button
      if (result.contactId && importOpenBtn) {
        importOpenBtn.style.display = 'block';
        const settings = await getSettings();
        const url = getEsosUrl(settings);
        importOpenBtn.onclick = () => {
          chrome.tabs.create({ url: `${url}/contacts/${result.contactId}` });
        };
      }
    } else {
      const err = await r.json().catch(() => ({}));
      if (err.blacklisted) {
        importStatus.textContent = `🛡️ Domain @${err.domain} gesperrt — Kandidat darf nicht importiert werden.`;
        importStatus.style.color = '#ef4444';
      } else {
        importStatus.textContent = '❌ ' + (err.error || 'Import fehlgeschlagen');
        importStatus.style.color = '#ef4444';
      }
    }
  } catch (e) {
    importStatus.textContent = '❌ ' + e.message;
    importStatus.style.color = '#ef4444';
  }

  importBtn.disabled = false;
  setTimeout(() => {
    if (importBtn) {
      importBtn.textContent = '📥 In ESOS importieren';
      importBtn.style.background = '';
    }
  }, 3000);
});

// ═══════════════════════════════════════════════════════════════════════
// OUTREACH TAB
// ═══════════════════════════════════════════════════════════════════════

function loadOutreachStatus() {
  try {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError) return;

      const badge = document.getElementById('outreach-badge');
      const badgeText = document.getElementById('outreach-badge-text');
      if (!badge || !badgeText) return;

      if (res?.connected) {
        badge.className = 'conn-badge ok';
        badgeText.textContent = 'Verbunden';

        if (res.stats) {
          setText('queued', String(res.stats.queued || 0));
          setText('completed', String(res.stats.completed || 0));
        }
        setText('today', String(res.dailyCount || 0));

        const statusEl = document.getElementById('active-status');
        if (statusEl) {
          if (res.isActive) {
            statusEl.textContent = '🟢 Aktiv';
            statusEl.style.color = '#22c55e';
          } else {
            statusEl.textContent = '🔴 Pausiert';
            statusEl.style.color = '#ef4444';
          }
        }

        if (res.config) {
          setText('active-hours', `${res.config.active_hours_start || '—'} – ${res.config.active_hours_end || '—'}`);
          setText('daily-limit', `${res.dailyCount || 0} / ${res.config.daily_limit || '—'}`);
        }
      } else {
        badge.className = 'conn-badge fail';
        badgeText.textContent = 'Nicht verbunden';
      }
    });
  } catch (e) { /* background page not available */ }
}
