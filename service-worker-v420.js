// ESOS AI v4.0.20 — authoritative Outreach counters.
// Keep the v4.0.19 queue-response/token protections intact and add only the
// counter synchronization layer. ESOS backend is the source of truth for
// queued, sent and today's confirmed Outreach sends.
importScripts('service-worker-v419.js');

const ESOS_V420_STATS_TTL_MS = 15_000;
let esosV420StatsFetchedAt = 0;
let esosV420StatsCache = null;
let esosV420StatsPromise = null;

function esosV420ApplyAuthoritativeStats(stats) {
  if (!stats || typeof stats !== 'object') return null;

  const sentToday = Number(stats.sent_today);
  if (Number.isFinite(sentToday) && sentToday >= 0) {
    // background.js still exposes dailyCount through GET_STATUS and uses it for
    // the daily limit. Keep that compatibility surface, but source the value
    // exclusively from confirmed server-side sends rather than worker memory.
    dailyCount = Math.floor(sentToday);
  }

  esosV420StatsCache = stats;
  esosV420StatsFetchedAt = Date.now();
  return stats;
}

// GET_STATUS already fetches /api/outreach-ext/stats before it returns its popup
// payload. Update dailyCount from a clone of that successful response first so
// the existing popup's "Heute" field receives the authoritative value as well.
const esosV420PreviousFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function esosV420Fetch(input, init) {
  const response = await esosV420PreviousFetch(input, init);
  const rawUrl = typeof input === 'string' ? input : String(input?.url || '');
  if (/\/api\/outreach-ext\/stats(?:\?|$)/.test(rawUrl) && response.ok) {
    try {
      esosV420ApplyAuthoritativeStats(await response.clone().json());
    } catch (_) {}
  }
  return response;
};

async function esosV420RefreshAuthoritativeStats(force = false) {
  const fresh = esosV420StatsCache
    && Date.now() - esosV420StatsFetchedAt < ESOS_V420_STATS_TTL_MS;
  if (!force && fresh) return esosV420StatsCache;
  if (esosV420StatsPromise) return esosV420StatsPromise;

  esosV420StatsPromise = (async () => {
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
      return esosV420ApplyAuthoritativeStats(await response.json());
    } catch (error) {
      console.warn(
        '[ESOS AI] Outreach-Statistik konnte nicht synchronisiert werden:',
        error?.message || error,
      );
      return null;
    }
  })();

  try {
    return await esosV420StatsPromise;
  } finally {
    esosV420StatsPromise = null;
  }
}

// Synchronize before the established queue loop checks its daily limit. This
// makes browser restarts, service-worker suspension and midnight resets unable
// to fabricate or lose today's confirmed send count.
const esosV420LegacyProcessNextJob = processNextJob;
processNextJob = async function esosV420ProcessNextJob(...args) {
  await esosV420RefreshAuthoritativeStats(false);
  return esosV420LegacyProcessNextJob(...args);
};

chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => { esosV420RefreshAuthoritativeStats(true).catch(() => {}); }, 250);
});

chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => { esosV420RefreshAuthoritativeStats(true).catch(() => {}); }, 250);
});

setTimeout(() => {
  esosV420RefreshAuthoritativeStats(true).catch(() => {});
}, 700);

console.log('[ESOS AI] v4.0.20 active: authoritative Outreach counters + v4.0.19 queue guard.');
