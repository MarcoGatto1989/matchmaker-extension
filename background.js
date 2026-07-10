// background.js — MatchMaker BOOT Extension v3.2 Service Worker
// Connects to ESOS Full-Stack backend (outreach-ext endpoints)
// Improvements: fetch timeouts, graceful error recovery, better alarm handling

// ── Default API base (can be overridden via settings) ──
const DEFAULT_API_BASE = 'https://executive-sphere-production.up.railway.app';

// ── State ──────────────────────────────────────────────────────────────
let isProcessing = false;
let dailyCount = 0;
let config = null;
let lastConfigFetch = 0;

// ── Storage helpers ────────────────────────────────────────────────────

function getToken() {
  return new Promise(resolve => {
    chrome.storage.local.get('extension_token', res => resolve(res.extension_token || ''));
  });
}

function getApiBase() {
  return new Promise(resolve => {
    chrome.storage.local.get('esos_url', res => {
      const url = (res.esos_url || DEFAULT_API_BASE).replace(/\/$/, '');
      resolve(url);
    });
  });
}

// ── Fetch with timeout ─────────────────────────────────────────────────

async function safeFetch(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── Config fetch ───────────────────────────────────────────────────────

async function fetchConfig(apiBase, token) {
  try {
    const r = await safeFetch(`${apiBase}/api/outreach-ext/config`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (r.ok) {
      config = await r.json();
      lastConfigFetch = Date.now();
    }
  } catch (e) {
    console.warn('[BOOT] Config fetch failed:', e.message);
  }
}

// ── Time / Day checks ──────────────────────────────────────────────────

function isWithinActiveHours() {
  if (!config) return true;
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const current = h * 60 + m;

  const [startH, startM] = (config.active_hours_start || '09:00').split(':').map(Number);
  const [endH, endM] = (config.active_hours_end || '17:00').split(':').map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  return current >= start && current <= end;
}

function isWeekday() {
  const day = new Date().getDay();
  return day >= 1 && day <= 5;
}

function randomDelay() {
  const min = (config?.min_delay_seconds || 45) * 1000;
  const max = (config?.max_delay_seconds || 120) * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Heartbeat ──────────────────────────────────────────────────────────

async function sendHeartbeat() {
  const token = await getToken();
  const apiBase = await getApiBase();
  if (!token) return;
  try {
    await safeFetch(`${apiBase}/api/outreach-ext/heartbeat`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
  } catch (e) { /* silent */ }
}

// ── Job Processing Loop ────────────────────────────────────────────────

async function processNextJob() {
  if (isProcessing) return;

  const token = await getToken();
  const apiBase = await getApiBase();
  if (!token) return;

  // Refresh config every 5 minutes
  if (!config || Date.now() - lastConfigFetch > 300000) {
    await fetchConfig(apiBase, token);
  }

  // Check daily limit
  const dailyLimit = config?.daily_limit || 25;
  if (dailyCount >= dailyLimit) {
    console.log(`[BOOT] Daily limit reached (${dailyCount}/${dailyLimit})`);
    return;
  }

  // Check active hours
  if (!isWithinActiveHours()) {
    console.log('[BOOT] Outside active hours — skipping');
    return;
  }

  // Check weekday
  if (config?.weekdays_only && !isWeekday()) {
    console.log('[BOOT] Weekend — skipping');
    return;
  }

  isProcessing = true;
  try {
    const r = await fetch(`${apiBase}/api/outreach-ext/jobs/queued?limit=1`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const jobs = await r.json();

    if (!jobs || jobs.length === 0) {
      console.log('[BOOT] No queued jobs');
      return;
    }

    const job = jobs[0];
    console.log(`[BOOT] Processing: ${job.candidate_name} — ${job.linkedin_url}`);

    // ── KandiScout search job: open search URL, scrape result list ──
    if (job.job_type === 'scout_search' && job.payload) {
      await runScoutSearch(job, apiBase, token);
      return;
    }

    // Find or open LinkedIn tab
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    let tabId;
    if (tabs.length > 0) {
      tabId = tabs[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com', active: false });
      tabId = tab.id;
      await new Promise(r => setTimeout(r, 3000));
    }

    // Send command to content script
    chrome.tabs.sendMessage(tabId, {
      type: 'EXECUTE_CONTACT_REQUEST',
      payload: {
        linkedin_url: job.linkedin_url,
        text_content: job.text_content || '',
        job_id: job.id,
        api_base: apiBase,
        token: token,
      }
    });

    dailyCount++;

  } catch (e) {
    console.error('[BOOT] Error:', e.message);
  } finally {
    isProcessing = false;
  }
}

// ── Alarm-based scheduling ─────────────────────────────────────────────

chrome.alarms.create('processJobs', { periodInMinutes: 2 });
chrome.alarms.create('heartbeat', { periodInMinutes: 5 });
chrome.alarms.create('resetDaily', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'processJobs') {
    const delay = randomDelay();
    setTimeout(() => processNextJob(), delay);
  }
  if (alarm.name === 'heartbeat') {
    await sendHeartbeat();
  }
  if (alarm.name === 'resetDaily') {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() < 60) {
      dailyCount = 0;
    }
  }
});

// ── Message handling ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_TOKEN') {
    chrome.storage.local.set({ extension_token: msg.token }, () => {
      sendResponse({ ok: true });
      sendHeartbeat();
    });
    return true;
  }

  if (msg.type === 'GET_TOKEN') {
    chrome.storage.local.get('extension_token', (res) => sendResponse(res));
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    (async () => {
      const token = await getToken();
      const apiBase = await getApiBase();
      if (!token) {
        sendResponse({ connected: false, dailyCount: 0, config: null });
        return;
      }
      try {
        const r = await fetch(`${apiBase}/api/outreach-ext/stats`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const stats = await r.json();
        sendResponse({
          connected: true,
          dailyCount,
          config,
          stats,
          isProcessing,
          isActive: isWithinActiveHours() && (!config?.weekdays_only || isWeekday()),
        });
      } catch (e) {
        sendResponse({ connected: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'PROCESS_NOW') {
    processNextJob().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'FETCH_JOBS') {
    (async () => {
      const token = await getToken();
      const apiBase = await getApiBase();
      try {
        const r = await fetch(`${apiBase}/api/outreach-ext/jobs/queued?limit=1`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const jobs = await r.json();
        sendResponse({ jobs });
      } catch (e) { sendResponse({ error: e.message }); }
    })();
    return true;
  }

  if (msg.type === 'EXECUTE_JOB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'EXECUTE_CONTACT_REQUEST',
        payload: msg.payload
      }, sendResponse);
    });
    return true;
  }
});

// ── Initial heartbeat ──────────────────────────────────────────────────
sendHeartbeat();


// ── KandiScout: execute a people-search and report results ─────────────
async function runScoutSearch(job, apiBase, token) {
  try {
    const payload = job.payload || {};
    const searchUrl = payload.searchUrl || job.linkedin_url;
    const source = payload.source || (searchUrl.includes('xing.com') ? 'xing' : 'linkedin');

    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    // Wait for page render (SPA)
    await new Promise(r => setTimeout(r, 9000));

    const response = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ success: false, error: 'Timeout' }), 20000);
      chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_SEARCH_RESULTS', source }, (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(res || { success: false, error: 'Keine Antwort' });
      });
    });

    try { chrome.tabs.remove(tab.id); } catch (e) {}

    // Report results to ESOS
    if (response.success && response.candidates && response.candidates.length) {
      await safeFetch(`${apiBase}/api/scout/extension-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-extension-token': token },
        body: JSON.stringify({
          scoutSearchId: payload.scoutSearchId,
          source,
          candidates: response.candidates,
        }),
      });
      console.log(`[Scout] ${response.candidates.length} Kandidaten gemeldet`);
    } else {
      console.warn('[Scout] Keine Kandidaten gefunden:', response.error || '');
    }

    // Mark job completed
    await safeFetch(`${apiBase}/api/outreach-ext/jobs/${job.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        status: response.success ? 'completed' : 'failed',
        error: response.success ? null : (response.error || 'Scraping fehlgeschlagen'),
      }),
    });
  } catch (e) {
    console.error('[Scout] Fehler:', e.message);
  }
}
