// ESOS AI v4.0.20 — LinkedIn background positions via an authenticated LinkedIn page.
// XING keeps the proven v4.0.19/v4.0.14 path unchanged. LinkedIn no longer falls back
// to extension-origin raw HTML, which frequently contains only a shell or Name–Company data.
importScripts('service-worker-v419.js');

const esosV420PreviousRunPositionCheck = runPositionCheck;

function esosV420Provider(raw) {
  try {
    const url = new URL(String(raw || ''));
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if ((host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /^\/in\//i.test(url.pathname)) return 'linkedin';
    if ((host === 'xing.com' || host.endsWith('.xing.com')) && /^\/(?:profile|pages)\//i.test(url.pathname)) return 'xing';
  } catch (_) {}
  return null;
}

async function esosV420EnsureLinkedInBridge(tabId) {
  for (const file of ['position-profile-parser.js', 'linkedin-position-background-v420.js']) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (error) {
      throw new Error(`LinkedIn-Hintergrundleser konnte nicht geladen werden: ${error?.message || error}`);
    }
  }
}

async function esosV420FindLinkedInCarrier(profileUrl) {
  const exactTabId = typeof esosV412FindExactTab === 'function'
    ? await esosV412FindExactTab(profileUrl, 'linkedin')
    : null;
  if (exactTabId) return { tabId: exactTabId, exact: true };

  const tabs = await chrome.tabs.query({
    url: ['https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*'],
  });
  const usable = (tabs || [])
    .filter(tab => Number.isInteger(tab.id) && /^https:\/\/(?:[^/]+\.)?linkedin\.com\//i.test(String(tab.url || '')))
    .sort((a, b) => {
      const complete = Number(b.status === 'complete') - Number(a.status === 'complete');
      if (complete) return complete;
      return Number(Boolean(b.active)) - Number(Boolean(a.active));
    });
  return usable[0]?.id ? { tabId: usable[0].id, exact: false } : null;
}

async function esosV420ReportPosition(apiBase, token, job, success, data = null, error = null) {
  const response = await safeFetch(`${apiBase}/api/position-check-ext/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId: job.id, success, data, platform: 'linkedin', error }),
  }, 18000);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ESOS-Rückgabe fehlgeschlagen (${response.status}) ${detail}`.trim());
  }
}

runPositionCheck = async function esosV420RunPositionCheck(job, apiBase, token) {
  const payload = job?.payload || {};
  const profileUrl = String(payload.profileUrl || job?.linkedin_url || '').trim();
  const platform = esosV420Provider(profileUrl);

  // Keep XING exactly on the known-good path.
  if (platform !== 'linkedin') {
    return esosV420PreviousRunPositionCheck(job, apiBase, token);
  }

  try {
    // Best case: the exact target is already open, so read the genuinely rendered DOM.
    const exactTabId = typeof esosV412FindExactTab === 'function'
      ? await esosV412FindExactTab(profileUrl, 'linkedin')
      : null;
    if (exactTabId && typeof esosV412ReadRenderedProfile === 'function') {
      const scraped = await esosV412ReadRenderedProfile(exactTabId, 'linkedin');
      const currentPosition = String(scraped?.data?.currentPosition || '').replace(/\s+/g, ' ').trim();
      if (scraped?.success && currentPosition) {
        await esosV420ReportPosition(apiBase, token, job, true, {
          currentPosition,
          positionConfidence: 0.95,
          positionSource: 'linkedin_rendered_open_profile',
          parserVersion: 20,
        });
        console.log(`[Positionsabgleich] LinkedIn gerendert geprüft: ${currentPosition}`);
        return;
      }
    }

    // Otherwise borrow any already-open LinkedIn page as an authenticated same-origin
    // execution context. It is never navigated and no tab/window is created.
    const carrier = await esosV420FindLinkedInCarrier(profileUrl);
    if (!carrier?.tabId) {
      await esosV420ReportPosition(
        apiBase,
        token,
        job,
        false,
        null,
        'LinkedIn kann im Hintergrund nur über eine bereits geöffnete, angemeldete LinkedIn-Seite geprüft werden. Es wurde bewusst kein neuer Tab geöffnet.',
      );
      return;
    }

    await esosV420EnsureLinkedInBridge(carrier.tabId);
    const result = await chrome.tabs.sendMessage(carrier.tabId, {
      type: 'ESOS_FETCH_LINKEDIN_POSITION',
      profileUrl,
    });
    const currentPosition = String(result?.data?.currentPosition || '').replace(/\s+/g, ' ').trim();
    if (!result?.success || !currentPosition) {
      await esosV420ReportPosition(
        apiBase,
        token,
        job,
        false,
        null,
        result?.error || 'Im LinkedIn-Profil wurde keine eindeutige aktuelle Position gefunden.',
      );
      return;
    }

    await esosV420ReportPosition(apiBase, token, job, true, {
      currentPosition,
      positionConfidence: Math.max(0.8, Math.min(0.98, Number(result?.data?.positionConfidence || 0.92))),
      positionSource: String(result?.data?.positionSource || 'linkedin_same_origin_bridge').slice(0, 80),
      parserVersion: Number(result?.data?.parserVersion || 20),
    });
    console.log(`[Positionsabgleich] LinkedIn im Hintergrund geprüft: ${currentPosition}`);
  } catch (error) {
    console.error('[Positionsabgleich v4.0.20] LinkedIn-Fehler:', error?.message || error);
    try {
      await esosV420ReportPosition(apiBase, token, job, false, null, error?.message || 'LinkedIn-Positionsprüfung fehlgeschlagen.');
    } catch (reportError) {
      console.error('[Positionsabgleich v4.0.20] Rückmeldung fehlgeschlagen:', reportError?.message || reportError);
    }
  } finally {
    setTimeout(() => processNextJob(), 500);
  }
};

async function esosV420HotInjectLinkedInBridge() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*'],
    });
    for (const tab of tabs || []) {
      if (!Number.isInteger(tab.id)) continue;
      try { await esosV420EnsureLinkedInBridge(tab.id); } catch (_) {}
    }
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(esosV420HotInjectLinkedInBridge);
chrome.runtime.onStartup.addListener(esosV420HotInjectLinkedInBridge);
setTimeout(esosV420HotInjectLinkedInBridge, 450);

console.log('[ESOS AI] v4.0.20 active: LinkedIn same-origin rendered background position checks.');
