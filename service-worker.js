// ESOS AI service worker entrypoint.
// Keeps the established worker intact and upgrades only the social-photo direct route.
importScripts('background-worker.js');

const ESOS_SOCIAL_PHOTO_MAX_BYTES = 1_500_000;
const ESOS_SOCIAL_PHOTO_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ESOS_SOCIAL_PHOTO_WORKER_STATE = 'esos_social_photo_worker_v405';
const ESOS_SOCIAL_PHOTO_WORKER_ALARM = 'esos-social-photo-worker-cleanup-v405';
const esosOriginalSocialPhotoFetchOne = socialPhotoFetchOne;
let esosSocialPhotoWorkerWindowId = null;
let esosSocialPhotoWorkerTabId = null;
let esosSocialPhotoWorkerLock = Promise.resolve();

function esosProviderPatterns(network) {
  return network === 'linkedin'
    ? ['https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*']
    : ['https://xing.com/*', 'https://www.xing.com/*', 'https://*.xing.com/*'];
}

function esosProviderForHost(host) {
  const normalized = String(host || '').replace(/^www\./, '').toLowerCase();
  if (normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com')) return 'linkedin';
  if (normalized === 'xing.com' || normalized.endsWith('.xing.com')) return 'xing';
  return null;
}

function esosCanonicalProfileKey(raw) {
  try {
    const url = new URL(String(raw || ''));
    const provider = esosProviderForHost(url.hostname);
    const path = url.pathname.replace(/\/+$/, '');
    if (provider === 'linkedin') {
      const match = path.match(/^\/in\/([^/]+)/i);
      return match?.[1] ? `linkedin:in:${decodeURIComponent(match[1]).toLowerCase()}` : `linkedin:${path.toLowerCase()}`;
    }
    if (provider === 'xing') {
      const profile = path.match(/^\/profile\/([^/]+)/i);
      if (profile?.[1]) return `xing:profile:${decodeURIComponent(profile[1]).toLowerCase()}`;
      const page = path.match(/^\/pages\/([^/]+)/i);
      if (page?.[1]) return `xing:pages:${decodeURIComponent(page[1]).toLowerCase()}`;
      return `xing:${path.toLowerCase()}`;
    }
    return '';
  } catch (_) {
    return '';
  }
}

function esosSniffImageMime(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12) {
    const ascii = String.fromCharCode(...bytes.subarray(0, Math.min(16, bytes.length)));
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
    if (ascii.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii.slice(8, 12))) return 'image/avif';
  }
  return null;
}

async function esosReadImageResponse(response, imageUrl, network) {
  if (!response.ok) throw new Error(`${network}: Bild HTTP ${response.status}`);

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > ESOS_SOCIAL_PHOTO_MAX_BYTES) throw new Error(`${network}: Profilbild zu groß`);

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > ESOS_SOCIAL_PHOTO_MAX_BYTES) {
    throw new Error(`${network}: Profilbild leer oder zu groß`);
  }

  const headerType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const mimeType = ESOS_SOCIAL_PHOTO_IMAGE_TYPES.has(headerType) ? headerType : esosSniffImageMime(buffer);
  if (!ESOS_SOCIAL_PHOTO_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`${network}: Bildantwort ist kein unterstütztes Profilbild${headerType ? ` (${headerType})` : ''}`);
  }

  return {
    outcome: 'found',
    network,
    mimeType,
    imageBase64: socialPhotoArrayBufferToBase64(buffer),
    sourceUrl: response.url || imageUrl,
  };
}

async function esosReadImageCandidate(imageUrl, network) {
  const errors = [];
  for (const credentials of ['include', 'omit']) {
    try {
      const response = await safeFetch(imageUrl, {
        method: 'GET',
        credentials,
        cache: 'no-store',
        redirect: 'follow',
        headers: { Accept: 'image/webp,image/png,image/jpeg,image/avif,*/*;q=0.4' },
      }, 15000);
      return await esosReadImageResponse(response, imageUrl, network);
    } catch (error) {
      errors.push(`${credentials}: ${error.message || 'Bildabruf fehlgeschlagen'}`);
    }
  }
  throw new Error(errors.slice(0, 2).join(' | '));
}

async function esosSendProviderMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['profile-photo-dom-fix.js', 'social-photo-content-bridge.js'],
    });
    await new Promise(resolve => setTimeout(resolve, 180));
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function esosReadCandidatesFromTab(tabId, target) {
  const result = await esosSendProviderMessage(tabId, {
    type: 'ESOS_SOCIAL_PHOTO_PROFILE_CANDIDATES',
    network: target.network,
    profileUrl: target.url,
  });

  if (result?.outcome === 'not_found') return { outcome: 'not_found', network: target.network };
  if (result?.outcome === 'error') {
    return { outcome: 'error', error: result.error || `${target.network}: Provider-DOM konnte nicht gelesen werden` };
  }
  if (!Array.isArray(result?.imageUrls) || !result.imageUrls.length) {
    return { outcome: 'error', error: `${target.network}: Provider-DOM lieferte keine Bildkandidaten` };
  }

  const imageErrors = [];
  for (const imageUrl of result.imageUrls) {
    try {
      return await esosReadImageCandidate(imageUrl, target.network);
    } catch (error) {
      imageErrors.push(error.message || 'Bildabruf fehlgeschlagen');
    }
  }
  return {
    outcome: 'error',
    error: imageErrors.slice(0, 3).join(' | ') || `${target.network}: kein nutzbares Profilbild`,
  };
}

// Fastest route: only reuse an already-open tab when it is the exact same profile.
// Sending another person's URL into an arbitrary XING tab caused the provider fetch
// failures seen in the bulk run, because XING blocks those synthetic subrequests.
async function esosFetchViaExactProviderTab(target) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: esosProviderPatterns(target.network) });
  } catch (error) {
    return { outcome: 'error', error: `${target.network}: Provider-Tab konnte nicht ermittelt werden (${error.message})` };
  }

  const targetKey = esosCanonicalProfileKey(target.url);
  const exact = tabs.filter(tab => tab.id && esosCanonicalProfileKey(tab.url || '') === targetKey);
  if (!exact.length) return { outcome: 'unavailable' };

  exact.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
  const errors = [];
  for (const tab of exact.slice(0, 2)) {
    try {
      const result = await esosReadCandidatesFromTab(tab.id, target);
      if (result.outcome === 'found' || result.outcome === 'not_found') return result;
      if (result.error) errors.push(result.error);
    } catch (error) {
      errors.push(`${target.network}: geöffnetes Profil ${error.message || 'nicht lesbar'}`);
    }
  }
  return { outcome: 'error', error: errors.slice(0, 3).join(' | ') || `${target.network}: geöffnetes Profil konnte nicht gelesen werden` };
}

async function esosPersistWorkerState() {
  try {
    await chrome.storage.local.set({
      [ESOS_SOCIAL_PHOTO_WORKER_STATE]: {
        windowId: esosSocialPhotoWorkerWindowId,
        tabId: esosSocialPhotoWorkerTabId,
      },
    });
  } catch (_) {}
}

async function esosScheduleWorkerCleanup() {
  try {
    await chrome.alarms.create(ESOS_SOCIAL_PHOTO_WORKER_ALARM, { delayInMinutes: 4 });
  } catch (_) {}
}

async function esosCloseWorkerWindow() {
  let windowId = esosSocialPhotoWorkerWindowId;
  if (!windowId) {
    try {
      const stored = await chrome.storage.local.get(ESOS_SOCIAL_PHOTO_WORKER_STATE);
      windowId = stored?.[ESOS_SOCIAL_PHOTO_WORKER_STATE]?.windowId || null;
    } catch (_) {}
  }
  esosSocialPhotoWorkerWindowId = null;
  esosSocialPhotoWorkerTabId = null;
  try { await chrome.storage.local.remove(ESOS_SOCIAL_PHOTO_WORKER_STATE); } catch (_) {}
  if (windowId) {
    try { await chrome.windows.remove(windowId); } catch (_) {}
  }
}

async function esosGetWorkerTab() {
  if (esosSocialPhotoWorkerTabId) {
    try {
      const tab = await chrome.tabs.get(esosSocialPhotoWorkerTabId);
      if (tab?.id) {
        await esosScheduleWorkerCleanup();
        return tab.id;
      }
    } catch (_) {
      esosSocialPhotoWorkerTabId = null;
      esosSocialPhotoWorkerWindowId = null;
    }
  }

  try {
    const stored = await chrome.storage.local.get(ESOS_SOCIAL_PHOTO_WORKER_STATE);
    const state = stored?.[ESOS_SOCIAL_PHOTO_WORKER_STATE];
    if (state?.tabId) {
      const tab = await chrome.tabs.get(state.tabId);
      if (tab?.id) {
        esosSocialPhotoWorkerTabId = tab.id;
        esosSocialPhotoWorkerWindowId = tab.windowId || state.windowId || null;
        try {
          if (esosSocialPhotoWorkerWindowId) {
            await chrome.windows.update(esosSocialPhotoWorkerWindowId, { state: 'minimized', focused: false });
          }
        } catch (_) {}
        await esosScheduleWorkerCleanup();
        return tab.id;
      }
    }
  } catch (_) {}

  const created = await chrome.windows.create({
    url: 'about:blank',
    focused: false,
    state: 'minimized',
    type: 'normal',
  });
  if (!created?.id) throw new Error('Browser-Arbeitsfenster konnte nicht erstellt werden');
  const tabs = Array.isArray(created.tabs) && created.tabs.length
    ? created.tabs
    : await chrome.tabs.query({ windowId: created.id });
  const tabId = tabs?.[0]?.id;
  if (!tabId) {
    try { await chrome.windows.remove(created.id); } catch (_) {}
    throw new Error('Browser-Arbeitstab konnte nicht erstellt werden');
  }

  esosSocialPhotoWorkerWindowId = created.id;
  esosSocialPhotoWorkerTabId = tabId;
  await esosPersistWorkerState();
  await esosScheduleWorkerCleanup();
  return tabId;
}

function esosWaitForTargetLoaded(tabId, target, timeoutMs = 26000) {
  const targetKey = esosCanonicalProfileKey(target.url);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, tab) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve(tab);
    };
    const matches = tab => tab?.status === 'complete'
      && esosProviderForHost(new URL(tab.url || 'about:blank').hostname) === target.network
      && esosCanonicalProfileKey(tab.url || '') === targetKey;
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      try {
        if (matches(tab)) finish(null, tab);
      } catch (_) {}
    };
    const onRemoved = removedTabId => {
      if (removedTabId === tabId) finish(new Error('Browser-Arbeitstab wurde geschlossen'));
    };
    const timer = setTimeout(() => finish(new Error(`${target.network}: Browser-Profil Zeitüberschreitung`)), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.get(tabId).then(tab => {
      try {
        if (matches(tab)) finish(null, tab);
      } catch (_) {}
    }).catch(() => {});
  });
}

async function esosFetchViaBrowserWorkerUnlocked(target) {
  let tabId;
  try {
    tabId = await esosGetWorkerTab();
    await chrome.tabs.update(tabId, { url: target.url, active: true });
    await esosWaitForTargetLoaded(tabId, target);
    // Give XING/LinkedIn hydration and lazy profile-image loading a moment to finish.
    await new Promise(resolve => setTimeout(resolve, 1100));

    let result = await esosReadCandidatesFromTab(tabId, target);
    if (result.outcome === 'found') return result;

    // One additional DOM pass catches images that arrive a little later on slower profiles.
    if (result.outcome === 'error' || result.outcome === 'not_found') {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const second = await esosReadCandidatesFromTab(tabId, target);
      if (second.outcome === 'found' || second.outcome === 'not_found') return second;
      result = second;
    }
    return result;
  } catch (error) {
    return { outcome: 'error', error: `${target.network}: Browser-Arbeitsfenster ${error.message || 'fehlgeschlagen'}` };
  } finally {
    await esosScheduleWorkerCleanup();
  }
}

function esosFetchViaBrowserWorker(target) {
  const run = esosSocialPhotoWorkerLock.then(() => esosFetchViaBrowserWorkerUnlocked(target));
  esosSocialPhotoWorkerLock = run.catch(() => {});
  return run;
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm?.name === ESOS_SOCIAL_PHOTO_WORKER_ALARM) {
    esosCloseWorkerWindow().catch(() => {});
  }
});

socialPhotoFetchOne = async function(rawTarget) {
  const target = socialPhotoValidateTarget(rawTarget);
  if (!target) return { outcome: 'error', error: 'Ungültiger Social-Profillink.' };

  // 1) If the exact profile is already open, read the rendered DOM immediately.
  const exactTab = await esosFetchViaExactProviderTab(target);
  if (exactTab.outcome === 'found' || exactTab.outcome === 'not_found') return exactTab;

  // 2) Bulk mode: render the target as a real page in one reusable, minimized browser
  // worker window. It uses the user's normal provider session, never steals focus and
  // avoids XING's blocked fetch/iframe paths. The same window is reused for the run.
  const browserWorker = await esosFetchViaBrowserWorker(target);
  if (browserWorker.outcome === 'found' || browserWorker.outcome === 'not_found') return browserWorker;

  // 3) Existing extension-origin fetch remains a technical backup.
  const legacyDirect = await esosOriginalSocialPhotoFetchOne(target);
  if (legacyDirect.outcome === 'found' || legacyDirect.outcome === 'not_found') return legacyDirect;

  const errors = [];
  if (exactTab.outcome === 'error' && exactTab.error) errors.push(exactTab.error);
  if (browserWorker.outcome === 'error' && browserWorker.error) errors.push(browserWorker.error);
  if (legacyDirect.outcome === 'error' && legacyDirect.error) errors.push(legacyDirect.error);
  return {
    outcome: 'error',
    error: errors.join(' | ').slice(0, 500) || `${target.network}: direkter Abruf fehlgeschlagen`,
  };
};

// Existing LinkedIn/XING tabs do not automatically receive newly-added content
// scripts after an extension update. Inject the DOM detector into them once so
// manual profile import can see the avatar immediately after reloading ESOS AI.
async function esosBootstrapRenderedPhotoDetector() {
  try {
    const tabs = await chrome.tabs.query({ url: [
      ...esosProviderPatterns('linkedin'),
      ...esosProviderPatterns('xing'),
    ] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['profile-photo-dom-fix.js'] });
      } catch (_) {}
    }
  } catch (_) {}
}
setTimeout(esosBootstrapRenderedPhotoDetector, 200);

console.log('[ESOS AI] SocialPhoto direct route active: exact DOM -> minimized browser worker -> extension fetch -> server fallback.');