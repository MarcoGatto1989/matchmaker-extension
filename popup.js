// popup.js — MatchMaker BOOT Extension v3
// Tabs: CRM Import | Outreach | Settings

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
let esosToken = null; // JWT token for ESOS API

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
chrome.storage.local.get(['esos_url', 'esos_email', 'esos_password', 'extension_token', 'esos_jwt'], (res) => {
  esosUrlInput.value = res.esos_url || 'https://executive-sphere-production.up.railway.app';
  esosEmailInput.value = res.esos_email || '';
  esosPasswordInput.value = res.esos_password || '';
  bootTokenInput.value = res.extension_token || '';
  esosToken = res.esos_jwt || null;
  
  // Check connections on load
  checkConnections();
  loadOutreachStatus();
});

saveSettingsBtn.addEventListener('click', async () => {
  const url = esosUrlInput.value.trim().replace(/\/$/, '');
  const email = esosEmailInput.value.trim();
  const password = esosPasswordInput.value.trim();
  const bootToken = bootTokenInput.value.trim();

  saveSettingsBtn.disabled = true;
  settingsStatus.textContent = '⏳ Verbinde…';

  // Save all settings
  chrome.storage.local.set({
    esos_url: url,
    esos_email: email,
    esos_password: password,
    extension_token: bootToken
  });

  // Also tell background.js about new BOOT token
  if (bootToken) {
    chrome.runtime.sendMessage({ type: 'SET_TOKEN', token: bootToken });
  }

  // Try ESOS login
  if (url && email && password) {
    try {
      const r = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (r.ok) {
        const data = await r.json();
        esosToken = data.token;
        chrome.storage.local.set({ esos_jwt: data.token });
        settingsStatus.textContent = '✅ ESOS verbunden! Eingeloggt als ' + (data.user?.fullName || email);
      } else {
        settingsStatus.textContent = '❌ ESOS Login fehlgeschlagen (Passwort falsch?)';
      }
    } catch (e) {
      settingsStatus.textContent = '❌ ESOS nicht erreichbar: ' + e.message;
    }
  }

  saveSettingsBtn.disabled = false;
  checkConnections();
});

async function checkConnections() {
  const esosBadge = document.getElementById('esos-badge');
  const esosBadgeText = document.getElementById('esos-badge-text');
  const bootBadge = document.getElementById('boot-badge');
  const bootBadgeText = document.getElementById('boot-badge-text');

  // Check ESOS
  const url = esosUrlInput.value.trim().replace(/\/$/, '');
  if (esosToken && url) {
    try {
      const r = await fetch(`${url}/api/auth/me`, {
        headers: { 'Authorization': 'Bearer ' + esosToken }
      });
      if (r.ok) {
        esosBadge.className = 'conn-badge ok';
        esosBadgeText.textContent = 'ESOS ✓';
      } else {
        esosBadge.className = 'conn-badge fail';
        esosBadgeText.textContent = 'ESOS ✗';
        esosToken = null;
      }
    } catch {
      esosBadge.className = 'conn-badge fail';
      esosBadgeText.textContent = 'ESOS ✗';
    }
  } else {
    esosBadge.className = 'conn-badge fail';
    esosBadgeText.textContent = 'ESOS';
  }

  // Check BOOT
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (res?.connected) {
      bootBadge.className = 'conn-badge ok';
      bootBadgeText.textContent = 'BOOT API ✓';
    } else {
      bootBadge.className = 'conn-badge fail';
      bootBadgeText.textContent = 'BOOT API';
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CRM IMPORT TAB
// ═══════════════════════════════════════════════════════════════════════

const scrapeBtn = document.getElementById('scrape-btn');
const importBtn = document.getElementById('import-btn');
const importOpenBtn = document.getElementById('import-open-btn');
const importStatus = document.getElementById('import-status');

// Detect platform on current tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  const tabUrl = tabs[0].url || '';
  const bar = document.getElementById('platform-bar');
  const name = document.getElementById('platform-name');
  
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

// Scrape profile button
scrapeBtn.addEventListener('click', async () => {
  scrapeBtn.disabled = true;
  scrapeBtn.innerHTML = '<span class="spinner"></span> Lade Profil…';
  importStatus.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Kein aktiver Tab');

    chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PROFILE' }, async (response) => {
      if (chrome.runtime.lastError) {
        importStatus.textContent = '❌ Content Script nicht geladen. Seite neu laden und erneut versuchen.';
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = '🔍 Profil laden';
        return;
      }

      if (!response?.success) {
        importStatus.textContent = '❌ ' + (response?.error || 'Profil konnte nicht gelesen werden');
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
    scrapeBtn.disabled = false;
    scrapeBtn.textContent = '🔍 Profil laden';
  }
});

function displayProfile(data) {
  document.getElementById('import-empty').style.display = 'none';
  document.getElementById('import-profile').style.display = 'block';

  const title = data.academicTitle ? data.academicTitle + ' ' : '';
  document.getElementById('profile-name').textContent = title + (data.firstName || '') + ' ' + (data.lastName || '');
  document.getElementById('profile-title').textContent = data.currentPosition || '—';
  document.getElementById('profile-company').textContent = '🏢 ' + (data.currentCompany || '—');
  document.getElementById('profile-location').textContent = '📍 ' + (data.companyCity || '—');

  // Email
  const emailEl = document.getElementById('profile-email');
  if (data.email) {
    emailEl.style.display = 'flex';
    emailEl.querySelector('span').textContent = data.email;
  }

  // Phone
  const phoneEl = document.getElementById('profile-phone');
  if (data.phone) {
    phoneEl.style.display = 'flex';
    phoneEl.querySelector('span').textContent = data.phone;
  }

  // Badges
  const badgesEl = document.getElementById('profile-badges');
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

async function checkDuplicate(data) {
  const url = esosUrlInput.value.trim().replace(/\/$/, '');
  if (!esosToken || !url) return;

  try {
    const r = await fetch(`${url}/api/extension/check-duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + esosToken
      },
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
      if (result.isDuplicate) {
        warning.style.display = 'block';
        document.getElementById('duplicate-text').textContent =
          `Existiert bereits als "${result.contactName || 'Kontakt'}". Import aktualisiert vorhandene Daten.`;
        importBtn.textContent = '🔄 Daten aktualisieren';
      } else {
        warning.style.display = 'none';
        importBtn.textContent = '📥 In ESOS importieren';
      }
    }
  } catch (e) {
    console.warn('Duplikat-Check fehlgeschlagen:', e.message);
  }
}

async function loadOpportunities() {
  const url = esosUrlInput.value.trim().replace(/\/$/, '');
  if (!esosToken || !url) return;

  try {
    const r = await fetch(`${url}/api/extension/opportunities`, {
      headers: { 'Authorization': 'Bearer ' + esosToken }
    });
    if (r.ok) {
      const opps = await r.json();
      const select = document.getElementById('opportunity-select');
      select.innerHTML = '<option value="">— Kein Mandat —</option>';
      (opps || []).forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `${o.mandateNumber || '—'} · ${o.soughtRole || o.title || '—'} (${o.accountName || '—'})`;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn('Mandate laden fehlgeschlagen:', e.message);
  }
}

// Import button
importBtn.addEventListener('click', async () => {
  if (!scrapedData) return;

  const url = esosUrlInput.value.trim().replace(/\/$/, '');
  if (!esosToken || !url) {
    importStatus.textContent = '⚠️ Zuerst ESOS-Verbindung in Settings konfigurieren!';
    return;
  }

  importBtn.disabled = true;
  importBtn.innerHTML = '<span class="spinner"></span> Importiere…';
  importStatus.textContent = '';

  try {
    const opportunityId = document.getElementById('opportunity-select').value || undefined;

    const r = await fetch(`${url}/api/extension/import-candidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + esosToken
      },
      body: JSON.stringify({
        ...scrapedData,
        opportunityId
      })
    });

    if (r.ok) {
      const result = await r.json();
      const action = result.action === 'created' ? 'Neu erstellt' : 'Aktualisiert';
      importStatus.textContent = `✅ ${action}! ID: ${result.contactId || '—'}`;
      importBtn.textContent = '✅ Importiert!';
      importBtn.style.background = '#16a34a';

      // Show "Open in CRM" button
      if (result.contactId) {
        importOpenBtn.style.display = 'block';
        importOpenBtn.onclick = () => {
          chrome.tabs.create({ url: `${url}/contacts/${result.contactId}` });
        };
      }
    } else {
      const err = await r.json().catch(() => ({}));
      importStatus.textContent = '❌ ' + (err.error || 'Import fehlgeschlagen');
    }
  } catch (e) {
    importStatus.textContent = '❌ ' + e.message;
  }

  importBtn.disabled = false;
  setTimeout(() => {
    importBtn.textContent = '📥 In ESOS importieren';
    importBtn.style.background = '';
  }, 3000);
});

// ═══════════════════════════════════════════════════════════════════════
// OUTREACH TAB
// ═══════════════════════════════════════════════════════════════════════

function loadOutreachStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    const badge = document.getElementById('outreach-badge');
    const badgeText = document.getElementById('outreach-badge-text');

    if (res?.connected) {
      badge.className = 'conn-badge ok';
      badgeText.textContent = 'Verbunden';

      if (res.stats) {
        document.getElementById('queued').textContent = res.stats.queued || 0;
        document.getElementById('completed').textContent = res.stats.completed || 0;
      }
      document.getElementById('today').textContent = res.dailyCount || 0;

      if (res.isActive) {
        document.getElementById('active-status').textContent = '🟢 Aktiv';
        document.getElementById('active-status').style.color = '#22c55e';
      } else {
        document.getElementById('active-status').textContent = '🔴 Pausiert';
        document.getElementById('active-status').style.color = '#ef4444';
      }

      if (res.config) {
        document.getElementById('active-hours').textContent =
          `${res.config.active_hours_start || '—'} – ${res.config.active_hours_end || '—'}`;
        document.getElementById('daily-limit').textContent =
          `${res.dailyCount || 0} / ${res.config.daily_limit || '—'}`;
      }
    } else {
      badge.className = 'conn-badge fail';
      badgeText.textContent = 'Nicht verbunden';
    }
  });
}
