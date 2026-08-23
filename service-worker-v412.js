// ESOS AI v4.0.12 — rendered-profile position checks + parser/photo hot reload.
// LinkedIn increasingly returns only a client shell to extension-origin fetches. Position
// checks therefore use the same authenticated, rendered browser worker as profile photos.
importScripts('service-worker-v411.js');

function esosV412ProviderPatterns(network) {
  return network === 'linkedin'
    ? ['https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*']
    : ['https://xing.com/*', 'https://www.xing.com/*', 'https://*.xing.com/*'];
}

function esosV412CanonicalKey(raw) {
  try {
    const url = new URL(String(raw || ''));
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
      const match = path.match(/^\/in\/([^/]+)/i);
      return match?.[1] ? `linkedin:${decodeURIComponent(match[1]).toLowerCase()}` : '';
    }
    if (host === 'xing.com' || host.endsWith('.xing.com')) {
      const match = path.match(/^\/(?:profile|pages)\/([^/]+)/i);
      return match?.[1] ? `xing:${decodeURIComponent(match[1]).toLowerCase()}` : '';
    }
    return '';
  } catch (_) {
    return '';
  }
}

function esosV412Platform(raw) {
  try {
    const url = new URL(String(raw || ''));
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if ((host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /^\/in\//i.test(url.pathname)) return 'linkedin';
    if ((host === 'xing.com' || host.endsWith('.xing.com')) && /^\/(?:profile|pages)\//i.test(url.pathname)) return 'xing';
  } catch (_) {}
  return null;
}

async function esosV412EnsureProfileScripts(tabId, platform) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong?.status === 'ok') return;
  } catch (_) {}

  const files = platform === 'linkedin'
    ? [
        'profile-photo-dom-fix.js',
        'social-photo-content-fastpath-v406.js',
        'social-photo-content-bridge.js',
        'position-profile-parser.js',
        'linkedin-profile-identity-v411.js',
        'content.js',
      ]
    : [
        'profile-photo-dom-fix.js',
        'social-photo-content-fastpath-v406.js',
        'social-photo-content-bridge.js',
        'profile-identity-v407.js',
        'content.js',
      ];

  for (const file of files) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (_) {}
  }
  await new Promise(resolve => setTimeout(resolve, 180));
}

async function esosV412ReadRenderedProfile(tabId, platform) {
  await esosV412EnsureProfileScripts(tabId, platform);
  let last = null;
  for (const delay of [0, 900, 1600]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_PROFILE' });
      if (result?.success) {
        last = result;
        const position = String(result?.data?.currentPosition || '').trim();
        if (position) return result;
      } else if (result) {
        last = result;
      }
    } catch (error) {
      last = { success: false, error: error?.message || 'Profil-Content-Script nicht erreichbar' };
    }
  }
  return last || { success: false, error: 'Gerendertes Profil lieferte keine auswertbaren Daten.' };
}

async function esosV412FindExactTab(profileUrl, platform) {
  const key = esosV412CanonicalKey(profileUrl);
  if (!key) return null;
  try {
    const tabs = await chrome.tabs.query({ url: esosV412ProviderPatterns(platform) });
    const exact = (tabs || [])
      .filter(tab => Number.isInteger(tab.id) && esosV412CanonicalKey(tab.url || '') === key)
      .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
    return exact[0]?.id || null;
  } catch (_) {
    return null;
  }
}

async function esosV412OpenWorkerProfile(profileUrl, platform) {
  // Reuse the social-photo worker. It is a single minimized authenticated provider
  // window, so bulk runs do not create user-visible tab storms.
  const tabId = await esosGetWorkerTab();
  await chrome.tabs.update(tabId, { url: profileUrl, active: true });
  await esosWaitForTargetLoaded(tabId, { network: platform, url: profileUrl }, 30000);
  await new Promise(resolve => setTimeout(resolve, 1300));
  return tabId;
}

runPositionCheck = async function(job, apiBase, token) {
  const payload = job?.payload || {};
  const profileUrl = String(payload.profileUrl || job?.linkedin_url || '').trim();
  const platform = esosV412Platform(profileUrl);

  const report = async (success, data = null, error = null) => {
    const response = await safeFetch(`${apiBase}/api/position-check-ext/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ jobId: job.id, success, data, platform, error }),
    }, 18000);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`ESOS-Rückgabe fehlgeschlagen (${response.status}) ${detail}`.trim());
    }
  };

  try {
    if (!platform) {
      await report(false, null, 'Ungültiger LinkedIn-/XING-Profillink.');
      return;
    }

    let tabId = await esosV412FindExactTab(profileUrl, platform);
    let source = 'rendered_open_profile';
    if (!tabId) {
      tabId = await esosV412OpenWorkerProfile(profileUrl, platform);
      source = 'rendered_background_profile';
    }

    const scraped = await esosV412ReadRenderedProfile(tabId, platform);
    const currentPosition = String(scraped?.data?.currentPosition || '').replace(/\s+/g, ' ').trim();
    if (!scraped?.success || !currentPosition) {
      await report(false, null, scraped?.error || 'Im gerenderten Profil wurde keine eindeutige aktuelle Position gefunden.');
      return;
    }

    const data = {
      currentPosition,
      currentCompany: scraped?.data?.currentCompany || null,
      positionConfidence: platform === 'linkedin' ? 0.94 : 0.9,
      positionSource: source,
      parserVersion: 12,
    };
    await report(true, data, null);
    console.log(`[Positionsabgleich] Gerendertes ${platform}-Profil geprüft: ${currentPosition}`);
  } catch (error) {
    console.error('[Positionsabgleich v4.0.12] Fehler:', error?.message || error);
    try {
      await report(false, null, error?.message || 'Positionsprüfung fehlgeschlagen.');
    } catch (reportError) {
      console.error('[Positionsabgleich v4.0.12] Rückmeldung fehlgeschlagen:', reportError?.message || reportError);
    }
  } finally {
    try { await esosScheduleWorkerCleanup(); } catch (_) {}
    setTimeout(() => processNextJob(), 500);
  }
};

async function esosV412HotInject() {
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*',
      'https://xing.com/*', 'https://www.xing.com/*', 'https://*.xing.com/*',
    ] });
    for (const tab of tabs || []) {
      if (!Number.isInteger(tab.id)) continue;
      const platform = String(tab.url || '').includes('linkedin.com') ? 'linkedin' : 'xing';
      await esosV412EnsureProfileScripts(tab.id, platform);
    }
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(esosV412HotInject);
chrome.runtime.onStartup.addListener(esosV412HotInject);
setTimeout(esosV412HotInject, 300);

console.log('[ESOS AI] v4.0.12 active: rendered LinkedIn/XING position checks and photo/parser hot reload.');
