// ESOS AI v4.0.15 — canonical production routing + authoritative ESOS browser session.
// All ESOS traffic uses the public ESOS domain. Stored Railway URLs are migrated
// transparently so the popup/worker cannot authenticate against an internal service URL.
importScripts('service-worker-v414.js');

const ESOS_V415_API_BASE = 'https://www.esos.cloud';

function esosV415CanonicalApiBase(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return ESOS_V415_API_BASE;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.endsWith('.up.railway.app')) return ESOS_V415_API_BASE;
    if (parsed.origin === ESOS_V415_API_BASE) return ESOS_V415_API_BASE;
  } catch (_) {
    return ESOS_V415_API_BASE;
  }
  return raw;
}

// background.js defined these as functions, so v4.0.15 can replace the routing
// policy without editing the legacy queue implementation.
normalizeStoredEsosUrl = function esosV415NormalizeStoredEsosUrl(value) {
  return esosV415CanonicalApiBase(value);
};

getApiBase = function esosV415GetApiBase() {
  return new Promise(resolve => {
    chrome.storage.local.get('esos_url', async result => {
      const canonical = esosV415CanonicalApiBase(result?.esos_url);
      if (canonical !== String(result?.esos_url || '').replace(/\/$/, '')) {
        try { await chrome.storage.local.set({ esos_url: canonical }); } catch (_) {}
      }
      resolve(canonical);
    });
  });
};

async function esosV415SyncSession() {
  try {
    await chrome.storage.local.set({ esos_url: ESOS_V415_API_BASE });
  } catch (_) {}

  // v4.0.14 already performs the secure HttpOnly-cookie -> extension-session sync.
  // Calling it after replacing getApiBase makes it read the cookie from ESOS CRM,
  // i.e. the deployment the user is actually logged into.
  if (typeof esosV414SyncBrowserSession !== 'function') {
    return { connected: false, source: 'session_sync_unavailable' };
  }
  return esosV414SyncBrowserSession();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'SYNC_ESOS_SESSION') return undefined;
  esosV415SyncSession()
    .then(result => sendResponse(result || { connected: false }))
    .catch(error => sendResponse({
      connected: false,
      error: error?.message || 'ESOS-Sitzung konnte nicht synchronisiert werden.',
    }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  esosV415SyncSession().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  esosV415SyncSession().catch(() => {});
});

setTimeout(() => {
  esosV415SyncSession().catch(() => {});
}, 40);

console.log('[ESOS AI] v4.0.15 active: canonical ESOS CRM routing + authoritative browser session.');
