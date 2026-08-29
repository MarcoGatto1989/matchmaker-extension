// ESOS AI v4.0.18 — self-healing tenant extension authentication.
// Reuses the authoritative app.esos.cloud browser session from v4.0.17 and
// only rotates the tenant worker token when it is missing or explicitly rejected.
importScripts('service-worker-v415.js');

const ESOS_V418_TOKEN_VERIFY_TTL_MS = 5 * 60 * 1000;
let esosV418VerifiedToken = '';
let esosV418TokenVerifiedAt = 0;
let esosV418EnsurePromise = null;

async function esosV418StoredAuth() {
  return chrome.storage.local.get([
    'extension_token',
    'esos_jwt',
    'esos_jwt_source',
  ]);
}

async function esosV418Heartbeat(apiBase, extensionToken) {
  if (!extensionToken) return { accepted: false, rejected: true, status: 0 };
  try {
    const response = await safeFetch(`${apiBase}/api/outreach-ext/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${extensionToken}` },
      cache: 'no-store',
    }, 10000);
    if (response.ok) return { accepted: true, rejected: false, status: response.status };
    return {
      accepted: false,
      rejected: response.status === 401 || response.status === 403,
      status: response.status,
    };
  } catch (error) {
    return {
      accepted: false,
      rejected: false,
      status: 0,
      error: error?.message || 'Heartbeat fehlgeschlagen.',
    };
  }
}

async function esosV418RotateExtensionToken(apiBase, sessionToken) {
  if (!sessionToken) {
    return { token: '', error: 'Keine aktive ESOS-Browsersitzung verfügbar.' };
  }

  try {
    const response = await safeFetch(`${apiBase}/api/outreach/config/regenerate-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }, 10000);
    if (!response.ok) {
      return { token: '', error: `Extension-Token konnte nicht erneuert werden (HTTP ${response.status}).` };
    }
    const body = await response.json().catch(() => null);
    const token = String(body?.token || '').trim();
    if (!token) return { token: '', error: 'ESOS lieferte keinen Extension-Token.' };
    await chrome.storage.local.set({ extension_token: token });
    return { token, error: null };
  } catch (error) {
    return { token: '', error: error?.message || 'Extension-Token konnte nicht erneuert werden.' };
  }
}

async function esosV418EnsureExtensionToken() {
  if (esosV418EnsurePromise) return esosV418EnsurePromise;

  esosV418EnsurePromise = (async () => {
    const apiBase = await getApiBase();
    const auth = await esosV418StoredAuth();
    const currentToken = String(auth?.extension_token || '').trim();
    const now = Date.now();

    if (
      currentToken
      && currentToken === esosV418VerifiedToken
      && now - esosV418TokenVerifiedAt < ESOS_V418_TOKEN_VERIFY_TTL_MS
    ) {
      return { connected: true, token: currentToken, source: 'cached_extension_token' };
    }

    if (currentToken) {
      const heartbeat = await esosV418Heartbeat(apiBase, currentToken);
      if (heartbeat.accepted) {
        esosV418VerifiedToken = currentToken;
        esosV418TokenVerifiedAt = now;
        return { connected: true, token: currentToken, source: 'existing_extension_token' };
      }
      // A transport outage is not proof that the credential is invalid. Never
      // rotate in that case, because doing so could unnecessarily revoke another
      // browser instance using the same tenant token.
      if (!heartbeat.rejected) {
        return { connected: false, token: currentToken, source: 'heartbeat_unavailable', error: heartbeat.error || `Heartbeat HTTP ${heartbeat.status}` };
      }
    }

    const sessionToken = String(auth?.esos_jwt || '').trim();
    if (!sessionToken || auth?.esos_jwt_source !== 'browser_cookie') {
      return { connected: false, token: currentToken, source: 'browser_session_missing', error: 'Aktive ESOS-Browsersitzung fehlt.' };
    }

    const rotated = await esosV418RotateExtensionToken(apiBase, sessionToken);
    if (!rotated.token) {
      return { connected: false, token: '', source: 'token_rotation_failed', error: rotated.error };
    }

    const confirmed = await esosV418Heartbeat(apiBase, rotated.token);
    if (!confirmed.accepted) {
      return { connected: false, token: rotated.token, source: 'rotated_token_unconfirmed', error: confirmed.error || `Heartbeat HTTP ${confirmed.status}` };
    }

    esosV418VerifiedToken = rotated.token;
    esosV418TokenVerifiedAt = Date.now();
    return { connected: true, token: rotated.token, source: 'rotated_extension_token' };
  })();

  try {
    return await esosV418EnsurePromise;
  } finally {
    esosV418EnsurePromise = null;
  }
}

const esosV418LegacyGetToken = getToken;
getToken = async function esosV418GetToken() {
  const current = String(await esosV418LegacyGetToken() || '').trim();
  if (current) return current;
  const ensured = await esosV418EnsureExtensionToken();
  return String(ensured?.token || '').trim();
};

sendHeartbeat = async function esosV418SendHeartbeat() {
  const result = await esosV418EnsureExtensionToken();
  if (result?.connected) {
    try { await processNextJob(); } catch (_) {}
  }
  return result;
};

chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => { esosV418EnsureExtensionToken().catch(() => {}); }, 120);
});

chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => { esosV418EnsureExtensionToken().catch(() => {}); }, 120);
});

setTimeout(() => {
  esosV418EnsureExtensionToken()
    .then(result => {
      if (result?.connected) processNextJob().catch(() => {});
    })
    .catch(() => {});
}, 500);

console.log('[ESOS AI] v4.0.18 active: tenant worker token self-heal + Social Publishing queue recovery.');
