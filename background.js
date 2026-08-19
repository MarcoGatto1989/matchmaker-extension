// background.js — MatchMaker BOOT Extension v3.5 Service Worker
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

  // Interaktive ESOS-Aufträge haben Vorrang und dürfen nicht durch
  // Outreach-Arbeitszeiten, Tageslimits oder Zufallswartezeiten blockiert werden.
  isProcessing = true;
  try {
    for (const priorityType of ['position_check', 'scout_search']) {
      const priorityResponse = await safeFetch(
        `${apiBase}/api/outreach-ext/jobs/queued?limit=1&job_type=${priorityType}`,
        { headers: { 'Authorization': 'Bearer ' + token } }
      );
      if (!priorityResponse.ok) continue;
      const priorityJobs = await priorityResponse.json();
      if (!priorityJobs || priorityJobs.length === 0) continue;
      if (priorityType === 'position_check') await runPositionCheck(priorityJobs[0], apiBase, token);
      else await runScoutSearch(priorityJobs[0], apiBase, token);
      return;
    }
  } catch (e) {
    console.warn('[BOOT] Sofortabruf fehlgeschlagen:', e.message);
  } finally {
    isProcessing = false;
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

    // ── Positionsabgleich: known LinkedIn/XING profile, read live profile data ──
    if (job.job_type === 'position_check' && job.payload) {
      await runPositionCheck(job, apiBase, token);
      return;
    }

    // ── Social post: use the already authenticated browser session.
    // Provider credentials/cookies never leave the provider tab.
    if (job.job_type === 'social_post' && job.payload) {
      await runSocialPost(job, apiBase, token);
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
chrome.alarms.create('priorityJobs', { periodInMinutes: 1 });
chrome.alarms.create('heartbeat', { periodInMinutes: 5 });
chrome.alarms.create('resetDaily', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'priorityJobs') {
    await processNextJob();
  }
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
processNextJob();


// ── KandiScout: execute a people-search and report results ─────────────
async function runScoutSearch(job, apiBase, token) {
  try {
    const payload = job.payload || {};
    const searchUrl = payload.searchUrl || job.linkedin_url;
    const source = payload.source || (searchUrl.includes('xing.com') ? 'xing' : 'linkedin');

    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    // Wait for page render (SPA)
    await new Promise(r => setTimeout(r, 9000));

    let response = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ success: false, error: 'Timeout' }), 20000);
      chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_SEARCH_RESULTS', source }, (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(res || { success: false, error: 'Keine Antwort' });
      });
    });

    try { chrome.tabs.remove(tab.id); } catch (e) {}

    // Ergebnisse immer an ESOS melden – auch eine leere Trefferliste beendet
    // die Suche korrekt und verhindert einen dauerhaft wartenden Status.
    if (response.success) {
      const candidates = Array.isArray(response.candidates) ? response.candidates : [];
      const report = await safeFetch(`${apiBase}/api/scout/extension-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-extension-token': token },
        body: JSON.stringify({
          scoutSearchId: payload.scoutSearchId,
          source,
          candidates,
        }),
      });
      if (!report.ok) {
        const detail = await report.text().catch(() => '');
        response = { success: false, error: `ESOS-Rückgabe fehlgeschlagen (${report.status}) ${detail}`.trim() };
      } else {
        console.log(`[Scout] ${candidates.length} Kandidaten gemeldet`);
      }
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

// ── Positionsabgleich: read a known LinkedIn/XING profile live ─────────
async function runPositionCheck(job, apiBase, token) {
  const payload = job.payload || {};
  const profileUrl = payload.profileUrl || job.linkedin_url;
  let tab;

  const report = async (success, data = null, platform = null, error = null) => {
    const response = await safeFetch(`${apiBase}/api/position-check/extension/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: job.id, success, data, platform, error }),
    }, 15000);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`ESOS-Rückgabe fehlgeschlagen (${response.status}) ${detail}`.trim());
    }
  };

  try {
    if (!/^https:\/\/(www\.)?(linkedin\.com|xing\.com)\//i.test(String(profileUrl || ''))) {
      await report(false, null, null, 'Ungültiger LinkedIn-/XING-Profillink.');
      return;
    }

    tab = await chrome.tabs.create({ url: profileUrl, active: false });
    try {
      await waitForTabReady(tab.id, 25000);
    } catch (error) {
      // SPAs can already be usable even if the tab update event was missed.
      console.warn('[Positionsabgleich] Tab-Ready nicht bestätigt:', error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 4500));

    const scraped = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ success: false, error: 'Zeitüberschreitung beim Auslesen des Profils.' }), 25000);
      chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_PROFILE' }, result => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(result || { success: false, error: 'Keine Antwort vom Profil-Scraper.' });
      });
    });

    if (!scraped.success) {
      await report(false, null, scraped.platform || null, scraped.error || 'Profil konnte nicht ausgelesen werden.');
      return;
    }

    await report(true, scraped.data || {}, scraped.platform || payload.network || null, null);
    console.log(`[Positionsabgleich] ${job.candidate_name} live geprüft (${scraped.platform || payload.network || 'Profil'}).`);
  } catch (error) {
    console.error('[Positionsabgleich] Fehler:', error.message);
    try {
      await report(false, null, payload.network || null, error.message || 'Positionsprüfung fehlgeschlagen.');
    } catch (reportError) {
      console.error('[Positionsabgleich] Rückmeldung fehlgeschlagen:', reportError.message);
    }
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

// ── Social Content: publish through the user's provider session ─────────
async function runSocialPost(job, apiBase, token) {
  const payload = job.payload || {};
  const channel = payload.channel;
  const composeUrls = {
    linkedin: 'https://www.linkedin.com/feed/',
    xing_social: 'https://www.xing.com/news',
    xing_jobs: 'https://www.xing.com/jobs',
  };
  const targetUrl = payload.composeUrl || composeUrls[channel];

  if (!targetUrl) {
    await completeJob(job.id, apiBase, token, 'failed', `Kanal ${channel || 'unbekannt'} wird von der Browser-Verbindung nicht unterstützt.`);
    return;
  }

  let tab;
  try {
    const image = payload.imageUrl ? await loadSocialImage(payload.imageUrl, apiBase, token, job.id) : null;
    // Active on purpose: the user can see and, if the provider requests it,
    // complete an account/security confirmation in the normal provider UI.
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
    await waitForTabReady(tab.id, 20000);
    await new Promise(resolve => setTimeout(resolve, 3500));

    const response = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ success: false, error: 'Zeitüberschreitung beim Öffnen des Beitragsdialogs.' }), 30000);
      chrome.tabs.sendMessage(tab.id, {
        type: 'EXECUTE_SOCIAL_POST',
        payload: {
          channel,
          text: payload.text || job.text_content || '',
          image,
        },
      }, result => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(result || { success: false, error: 'Keine Antwort von der Anmeldeseite.' });
      });
    });

    await completeJob(job.id, apiBase, token, response.success ? 'completed' : 'failed', response.success ? null : response.error);
  } catch (error) {
    await completeJob(job.id, apiBase, token, 'failed', error.message || 'Veröffentlichung fehlgeschlagen.');
  }
}

async function loadSocialImage(imageUrl, apiBase, token, jobId) {
  const absolute = new URL(imageUrl, apiBase);
  const allowedOrigin = new URL(apiBase).origin;
  if (absolute.origin !== allowedOrigin) throw new Error('Das Beitragsbild stammt nicht aus der verbundenen ESOS-Instanz.');
  const response = await safeFetch(absolute.toString(), {
    headers: { 'Authorization': 'Bearer ' + token },
  }, 120000);
  if (!response.ok) throw new Error(`Das Beitragsbild konnte nicht geladen werden (${response.status}).`);
  const mimeType = (response.headers.get('content-type') || 'image/webp').split(';')[0];
  if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) throw new Error(`Das Bildformat ${mimeType} wird für Social Posts nicht unterstützt.`);
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > 10 * 1024 * 1024) throw new Error('Das Beitragsbild ist leer oder größer als 10 MB.');
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  return { base64: btoa(binary), mimeType, fileName: `esos-social-${jobId}.${extension}` };
}

function waitForTabReady(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Anmeldeseite konnte nicht geladen werden.'));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function completeJob(jobId, apiBase, token, status, error) {
  await safeFetch(`${apiBase}/api/outreach-ext/jobs/${jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ status, error: error || null }),
  }, 12000);
}
