// ESOS AI v4.0.13 — truthful API connectivity and immediate heartbeat refresh.
// Keep the rendered-profile work from v4.0.12, but never report an invalid
// extension token as connected merely because the server returned JSON.
importScripts('service-worker-v412.js');

const esosV413NativeFetch = globalThis.fetch.bind(globalThis);

async function esosV413ResponseError(response, prefix) {
  let detail = '';
  try {
    const body = await response.clone().json();
    detail = String(body?.error || body?.message || '').trim();
  } catch (_) {
    try { detail = String(await response.clone().text()).trim(); } catch (_) {}
  }
  const suffix = detail ? `: ${detail.slice(0, 180)}` : '';
  return new Error(`${prefix} (HTTP ${response.status})${suffix}`);
}

// background.js GET_STATUS uses fetch() directly and historically treated every
// JSON response — including 401/403 — as a successful connection. Fail closed
// specifically for the stats probe so the existing listener enters its error path.
globalThis.fetch = async function esosV413Fetch(input, init) {
  const response = await esosV413NativeFetch(input, init);
  const rawUrl = typeof input === 'string' ? input : String(input?.url || '');
  if (/\/api\/outreach-ext\/stats(?:\?|$)/.test(rawUrl) && !response.ok) {
    throw await esosV413ResponseError(response, 'ESOS-AI-Verbindung abgelehnt');
  }
  return response;
};

// Replace the legacy heartbeat with a checked variant. A heartbeat is only a
// connection when the server actually accepted the current tenant token.
sendHeartbeat = async function esosV413Heartbeat() {
  const token = await getToken();
  const apiBase = await getApiBase();
  if (!token) return { connected: false, error: 'Kein Extension-Token gespeichert.' };

  try {
    const response = await safeFetch(`${apiBase}/api/outreach-ext/heartbeat`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    }, 10000);
    if (!response.ok) {
      throw await esosV413ResponseError(response, 'Heartbeat abgelehnt');
    }
    return { connected: true, status: response.status };
  } catch (error) {
    console.warn('[ESOS AI] Heartbeat nicht bestätigt:', error?.message || error);
    return { connected: false, error: error?.message || 'Heartbeat fehlgeschlagen.' };
  }
};

async function esosV413RefreshConnection() {
  const result = await sendHeartbeat();
  if (result?.connected) {
    try { await processNextJob(); } catch (_) {}
  }
  return result;
}

// Token changes should become visible in ESOS immediately rather than waiting for
// the five-minute heartbeat alarm. The storage write itself has already completed
// when this event fires, so this also removes the previous token/status race.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.extension_token) return;
  setTimeout(() => { esosV413RefreshConnection().catch(() => {}); }, 60);
});

chrome.runtime.onStartup.addListener(() => {
  esosV413RefreshConnection().catch(() => {});
});

setTimeout(() => { esosV413RefreshConnection().catch(() => {}); }, 350);

console.log('[ESOS AI] v4.0.13 active: checked heartbeat and fail-closed connection status.');
