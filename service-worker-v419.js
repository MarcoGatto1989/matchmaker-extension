// ESOS AI v4.0.19 — queue-response guard + verified startup token.
//
// Two startup races used to surface as misleading extension errors:
// 1) a rejected/stale extension token could make /jobs/queued return an error object;
//    the legacy worker then treated that object like an array and read job.candidate_name.
// 2) Chrome can retain older XING CDN CORS errors even after the v4.0.6 image guard
//    stopped JavaScript assets from being fetched as profile images.
//
// Keep the historical worker chain intact and add the smallest compatibility layer here.
importScripts('service-worker-v418.js');

const esosV419PreviousFetch = globalThis.fetch.bind(globalThis);

function esosV419RequestUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function esosV419EmptyQueueResponse(response, reason, detail = '') {
  const status = Number(response?.status || 0);
  const suffix = detail ? `: ${String(detail).slice(0, 180)}` : '';
  console.warn(
    `[ESOS AI] Queue-Antwort verworfen${status ? ` (HTTP ${status})` : ''}: ${reason}${suffix}`
  );
  return new Response('[]', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// The legacy background worker expects every queue response to be a JSON array.
// Normalize only this endpoint so a backend/auth error can never become
// "Cannot read properties of undefined (reading 'candidate_name')" again.
globalThis.fetch = async function esosV419Fetch(input, init) {
  const response = await esosV419PreviousFetch(input, init);
  const url = esosV419RequestUrl(input);
  if (!url.includes('/api/outreach-ext/jobs/queued')) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch (_) {
    return esosV419EmptyQueueResponse(response, 'ungültiges JSON');
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload.error || payload.message || '')
      : '';
    return esosV419EmptyQueueResponse(response, 'Backend hat den Abruf abgelehnt', detail);
  }

  if (!Array.isArray(payload)) {
    return esosV419EmptyQueueResponse(response, 'unerwartetes Antwortformat');
  }

  if (payload.some(job => !job || typeof job !== 'object' || Array.isArray(job))) {
    return esosV419EmptyQueueResponse(response, 'ungültiger Auftrag in der Warteschlange');
  }

  return response;
};

// v4.0.18 already knows how to verify and rotate the tenant extension token.
// The old getter returned any stored token immediately, though, allowing the 250 ms
// startup poll to beat that verification. Always go through the verifier first.
getToken = async function esosV419GetToken() {
  try {
    const result = await esosV418EnsureExtensionToken();
    const token = String(result?.token || '').trim();
    if (result?.connected && token) return token;

    // A transport outage is not proof that the stored credential is bad. Keep the
    // token in that one case so the normal retry loop can recover when the network does.
    if (result?.source === 'heartbeat_unavailable' && token) return token;

    if (result?.error) {
      console.warn(`[ESOS AI] Extension-Token noch nicht einsatzbereit: ${result.error}`);
    }
    return '';
  } catch (error) {
    console.warn('[ESOS AI] Extension-Token-Prüfung fehlgeschlagen:', error?.message || error);
    return '';
  }
};

console.log('[ESOS AI] v4.0.19 active: queue guard + verified startup token.');
