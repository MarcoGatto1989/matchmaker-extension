// ESOS AI v4.0.14 — reuse the active ESOS browser session and forbid hidden provider windows.
// Automatic position/photo jobs may read an already-open profile or use extension-origin HTML,
// but they never create or navigate a hidden LinkedIn/XING browser window.
importScripts('service-worker-v413.js');

const ESOS_V414_BROWSER_SESSION_SOURCE = 'browser_cookie';
const ESOS_V414_SESSION_SOURCE_KEY = 'esos_jwt_source';

async function esosV414BrowserSessionCookie(apiBase) {
  if (!chrome.cookies?.get) return null;
  try {
    const url = new URL(apiBase || await getApiBase());
    const cookie = await chrome.cookies.get({
      url: `${url.origin}/`,
      name: 'esos_token',
    });
    return cookie?.value || null;
  } catch (_) {
    return null;
  }
}

async function esosV414ValidateEsosSession(apiBase, token) {
  if (!token) return false;
  try {
    const response = await safeFetch(`${apiBase}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }, 10000);
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function esosV414SyncBrowserSession() {
  const apiBase = await getApiBase();
  const token = await esosV414BrowserSessionCookie(apiBase);
  const stored = await chrome.storage.local.get(['esos_jwt', ESOS_V414_SESSION_SOURCE_KEY]);

  if (!token) {
    if (stored?.[ESOS_V414_SESSION_SOURCE_KEY] === ESOS_V414_BROWSER_SESSION_SOURCE) {
      await chrome.storage.local.remove(['esos_jwt', ESOS_V414_SESSION_SOURCE_KEY]);
    }
    return { connected: false, source: 'browser_session_missing' };
  }

  const valid = await esosV414ValidateEsosSession(apiBase, token);
  if (!valid) {
    if (stored?.[ESOS_V414_SESSION_SOURCE_KEY] === ESOS_V414_BROWSER_SESSION_SOURCE) {
      await chrome.storage.local.remove(['esos_jwt', ESOS_V414_SESSION_SOURCE_KEY]);
    }
    return { connected: false, source: 'browser_session_invalid' };
  }

  if (stored?.esos_jwt !== token || stored?.[ESOS_V414_SESSION_SOURCE_KEY] !== ESOS_V414_BROWSER_SESSION_SOURCE) {
    await chrome.storage.local.set({
      esos_jwt: token,
      [ESOS_V414_SESSION_SOURCE_KEY]: ESOS_V414_BROWSER_SESSION_SOURCE,
    });
  }
  return { connected: true, source: ESOS_V414_BROWSER_SESSION_SOURCE };
}

function esosV414Provider(raw) {
  try {
    const url = new URL(String(raw || ''));
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if ((host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /^\/in\//i.test(url.pathname)) return 'linkedin';
    if ((host === 'xing.com' || host.endsWith('.xing.com')) && /^\/(?:profile|pages)\//i.test(url.pathname)) return 'xing';
  } catch (_) {}
  return null;
}

function esosV414SameProfile(expectedUrl, actualUrl, platform) {
  try {
    const expected = new URL(expectedUrl);
    const actual = new URL(actualUrl);
    const actualHost = actual.hostname.replace(/^www\./, '').toLowerCase();
    const sameNetwork = platform === 'linkedin'
      ? actualHost === 'linkedin.com' || actualHost.endsWith('.linkedin.com')
      : actualHost === 'xing.com' || actualHost.endsWith('.xing.com');
    if (!sameNetwork) return false;
    const expectedPath = expected.pathname.replace(/\/$/, '').toLowerCase();
    const actualPath = actual.pathname.replace(/\/$/, '').toLowerCase();
    return actualPath === expectedPath || actualPath.startsWith(`${expectedPath}/`);
  } catch (_) {
    return false;
  }
}

async function esosV414DirectProfilePosition(profileUrl, platform) {
  const response = await safeFetch(profileUrl, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
    },
  }, 22000);

  if (!response.ok) {
    throw new Error(`Profil konnte nicht tablos geladen werden (HTTP ${response.status}).`);
  }
  if (!esosV414SameProfile(profileUrl, response.url || profileUrl, platform)) {
    throw new Error('Das Netzwerk hat den tablosen Abruf auf eine Login- oder andere Seite umgeleitet.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error('Das Profil lieferte beim tablosen Abruf kein lesbares HTML.');
  }

  const html = (await response.text()).slice(0, 2_500_000);
  if (!html || html.length < 80) {
    throw new Error('Das Profil lieferte beim tablosen Abruf keine auswertbaren Positionsdaten.');
  }

  const parsed = MatchMakerPositionParser.parseProfileHtml(html, { platform, profileUrl });
  const currentPosition = String(parsed?.data?.currentPosition || '').replace(/\s+/g, ' ').trim();
  if (!parsed?.success || !currentPosition) {
    throw new Error(parsed?.error || 'Im tablosen Profilabruf wurde keine eindeutige aktuelle Position gefunden.');
  }

  return {
    ...parsed.data,
    currentPosition,
    currentCompany: parsed?.data?.currentCompany || null,
    positionSource: parsed?.data?.positionSource || 'extension_direct_html',
    parserVersion: 14,
  };
}

// Disable the v4.0.5/v4.0.12 minimized browser worker completely. This is the
// source of the recurring provider windows seen on macOS. Exact already-open
// provider tabs remain usable; otherwise social-photo code falls back to the
// existing extension-origin fetch path instead of creating browser UI.
esosFetchViaBrowserWorker = async function esosV414NoProviderWindow() {
  return { outcome: 'unavailable', error: 'Verdeckte Provider-Fenster sind deaktiviert.' };
};

runPositionCheck = async function esosV414RunPositionCheck(job, apiBase, token) {
  const payload = job?.payload || {};
  const profileUrl = String(payload.profileUrl || job?.linkedin_url || '').trim();
  const platform = esosV414Provider(profileUrl);

  const report = async (success, data = null, error = null) => {
    const response = await safeFetch(`${apiBase}/api/position-check-ext/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

    const exactTabId = typeof esosV412FindExactTab === 'function'
      ? await esosV412FindExactTab(profileUrl, platform)
      : null;

    if (exactTabId && typeof esosV412ReadRenderedProfile === 'function') {
      const scraped = await esosV412ReadRenderedProfile(exactTabId, platform);
      const currentPosition = String(scraped?.data?.currentPosition || '').replace(/\s+/g, ' ').trim();
      if (scraped?.success && currentPosition) {
        await report(true, {
          ...scraped.data,
          currentPosition,
          currentCompany: scraped?.data?.currentCompany || null,
          positionConfidence: platform === 'linkedin' ? 0.94 : 0.9,
          positionSource: 'rendered_open_profile',
          parserVersion: 14,
        }, null);
        return;
      }
    }

    try {
      const data = await esosV414DirectProfilePosition(profileUrl, platform);
      await report(true, data, null);
      console.log(`[Positionsabgleich] ${platform} tablos geprüft: ${data.currentPosition}`);
    } catch (error) {
      const detail = error?.message || 'Tabloser Positionsabruf fehlgeschlagen.';
      await report(false, null, `${detail} Es wurde bewusst kein LinkedIn-/XING-Fenster geöffnet.`);
    }
  } catch (error) {
    console.error('[Positionsabgleich v4.0.14] Fehler:', error?.message || error);
    try {
      await report(false, null, error?.message || 'Positionsprüfung fehlgeschlagen.');
    } catch (reportError) {
      console.error('[Positionsabgleich v4.0.14] Rückmeldung fehlgeschlagen:', reportError?.message || reportError);
    }
  } finally {
    setTimeout(() => processNextJob(), 500);
  }
};

async function esosV414CloseLegacyWorker() {
  try {
    if (typeof esosCloseWorkerWindow === 'function') await esosCloseWorkerWindow();
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(() => {
  esosV414SyncBrowserSession().catch(() => {});
  esosV414CloseLegacyWorker().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  esosV414SyncBrowserSession().catch(() => {});
  esosV414CloseLegacyWorker().catch(() => {});
});

if (chrome.cookies?.onChanged) {
  chrome.cookies.onChanged.addListener(changeInfo => {
    if (changeInfo?.cookie?.name !== 'esos_token') return;
    esosV414SyncBrowserSession().catch(() => {});
  });
}

setTimeout(() => {
  esosV414SyncBrowserSession().catch(() => {});
  esosV414CloseLegacyWorker().catch(() => {});
}, 80);

console.log('[ESOS AI] v4.0.14 active: browser-session sync + no hidden provider windows.');
