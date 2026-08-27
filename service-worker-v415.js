// ESOS AI v4.0.17 — canonical production routing + authoritative ESOS browser session.
// All ESOS CRM/API traffic uses app.esos.cloud. Stored legacy web/Railway URLs are
// migrated transparently so popup and worker always share the same backend origin.
importScripts('service-worker-v414.js');

const ESOS_V415_API_BASE = 'https://app.esos.cloud';
const ESOS_V415_LEGACY_RAILWAY_ORIGIN = `https://${['executive', 'sphere', 'production'].join('-')}.up.railway.app`;
const ESOS_V415_LEGACY_ORIGINS = new Set([
  ESOS_V415_LEGACY_RAILWAY_ORIGIN,
  'https://esos.cloud',
  'https://www.esos.cloud',
]);

function esosV415CanonicalApiBase(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return ESOS_V415_API_BASE;
  try {
    const parsed = new URL(raw);
    if (parsed.origin === ESOS_V415_API_BASE) return ESOS_V415_API_BASE;
    if (ESOS_V415_LEGACY_ORIGINS.has(parsed.origin)) return ESOS_V415_API_BASE;
  } catch (_) {
    return ESOS_V415_API_BASE;
  }
  return raw;
}

// The existing worker functions are replaced here so this release can enforce the
// canonical ESOS routing policy without changing the proven queue implementation.
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

  // The prior session bridge performs the secure HttpOnly-cookie -> extension-session sync.
  // Calling it after replacing getApiBase makes it read the cookie from app.esos.cloud,
  // i.e. the canonical CRM/API deployment the extension must authenticate against.
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

console.log('[ESOS AI] v4.0.17 active: app.esos.cloud CRM/API routing + authoritative browser session.');
