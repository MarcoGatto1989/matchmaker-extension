// ESOS AI v4.0.19 — authoritative Outreach counters.
// The backend is the single source of truth for sent/queued/today values.
// This prevents volatile service-worker memory and unrelated completed jobs from
// being shown as successful Outreach sends or consuming the daily limit.
importScripts('service-worker-v418.js');

const ESOS_V419_STATS_TTL_MS = 15_000;
let esosV419StatsFetchedAt = 0;
let esosV419StatsCache = null;
let esosV419StatsPromise = null;

function esosV419ApplyAuthoritativeStats(stats) {
  if (!stats || typeof stats !== 'object') return null;

  const sentToday = Number(stats.sent_today);
  if (Number.isFinite(sentToday) && sentToday >= 0) {
    // dailyCount is defined by the established queue worker in background.js.
    // Keep it as a compatibility variable, but source it only from ESOS now.
    dailyCount = Math.floor(sentToday);
  }

  esosV419StatsCache = stats;
  esosV419StatsFetchedAt = Date.now();
  return stats;
}

// GET_STATUS in the established worker already calls /api/outreach-ext/stats.
// Intercept only that successful response so "Heute" is updated before the
// legacy listener reads dailyCount and sends the popup response.
const esosV419BaseFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function esosV419Fetch(input, init) {
  const response = await esosV419BaseFetch(input, init);
  const rawUrl = typeof input === 'string' ? input : String(input?.url || '');
  if (/\/api\/outreach-ext\/stats(?:\?|$)/.test(rawUrl) && response.ok) {
    try {
      const stats = await response.clone().json();
      esosV419ApplyAuthoritativeStats(stats);
    } catch (_) {}
  }
  return response;
};

async function esosV419RefreshAuthoritativeStats(force = false) {
  const fresh = esosV419StatsCache && Date.now() - esosV419StatsFetchedAt < ESOS_V419_STATS_TTL_MS;
  if (!force && fresh) return esosV419StatsCache;
  if (esosV419StatsPromise) return esosV419StatsPromise;

  esosV419StatsPromise = (async () => {
    const token = String(await getToken() || '').trim();
    if (!token) return null;
    const apiBase = await getApiBase();
    try {
      const response = await safeFetch(`${apiBase}/api/outreach-ext/stats`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }, 10_000);
      if (!response.ok) return null;
      const stats = await response.json();
      return esosV419ApplyAuthoritativeStats(stats);
    } catch (error) {
      console.warn('[ESOS AI] Outreach-Statistik konnte nicht synchronisiert werden:', error?.message || error);
      return null;
    }
  })();

  try {
    return await esosV419StatsPromise;
  } finally {
    esosV419StatsPromise = null;
  }
}

// The original queue checks dailyCount before claiming an Outreach job. Refresh
// it from ESOS first, so extension restarts, browser restarts and midnight do not
// reset or inflate the real daily usage.
const esosV419LegacyProcessNextJob = processNextJob;
processNextJob = async function esosV419ProcessNextJob(...args) {
  await esosV419RefreshAuthoritativeStats(false);
  return esosV419LegacyProcessNextJob(...args);
};

chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => { esosV419RefreshAuthoritativeStats(true).catch(() => {}); }, 250);
});

chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => { esosV419RefreshAuthoritativeStats(true).catch(() => {}); }, 250);
});

setTimeout(() => {
  esosV419RefreshAuthoritativeStats(true).catch(() => {});
}, 700);

console.log('[ESOS AI] v4.0.19 active: authoritative Outreach sent/today/queue counters.');
