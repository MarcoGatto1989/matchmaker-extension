// ESOS AI service worker entrypoint.
// Keeps the established worker intact and upgrades only the social-photo direct route.
importScripts('background-worker.js');

const ESOS_SOCIAL_PHOTO_MAX_BYTES = 1_500_000;
const ESOS_SOCIAL_PHOTO_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const esosOriginalSocialPhotoFetchOne = socialPhotoFetchOne;

function esosProviderPatterns(network) {
  return network === 'linkedin'
    ? ['https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*']
    : ['https://xing.com/*', 'https://www.xing.com/*', 'https://*.xing.com/*'];
}

function esosSniffImageMime(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12) {
    const ascii = String.fromCharCode(...bytes.subarray(0, Math.min(16, bytes.length)));
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
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
  // CDN images generally do not need provider cookies. Try authenticated first for
  // protected assets, then without credentials because some CDNs reject cookie-bearing
  // extension requests although the same image is publicly readable.
  for (const credentials of ['include', 'omit']) {
    try {
      const response = await safeFetch(imageUrl, {
        method: 'GET',
        credentials,
        cache: 'no-store',
        redirect: 'follow',
        // Do not request AVIF because the current ESOS API accepts JPEG/PNG/WebP.
        headers: { Accept: 'image/webp,image/png,image/jpeg,*/*;q=0.4' },
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
    // After an extension update, already-open provider tabs may still lack the new bridge.
    // Inject both the DOM detector and bridge on demand, then retry once without a reload.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['profile-photo-dom-fix.js', 'social-photo-content-bridge.js'],
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function esosFetchViaProviderTab(target) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: esosProviderPatterns(target.network) });
  } catch (error) {
    return { outcome: 'error', error: `${target.network}: Provider-Tab konnte nicht ermittelt werden (${error.message})` };
  }
  if (!tabs.length) return { outcome: 'unavailable' };

  let targetHost = '';
  let targetPath = '';
  try {
    const url = new URL(target.url);
    targetHost = url.hostname.replace(/^www\./, '').toLowerCase();
    targetPath = url.pathname.replace(/\/$/, '').toLowerCase();
  } catch (_) {}

  tabs.sort((a, b) => {
    const score = tab => {
      try {
        const url = new URL(tab.url || '');
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        const path = url.pathname.replace(/\/$/, '').toLowerCase();
        if (host === targetHost && path === targetPath) return 10;
        if (host === targetHost && tab.active) return 4;
        return tab.active ? 2 : 1;
      } catch (_) { return 0; }
    };
    return score(b) - score(a);
  });

  const errors = [];
  let cleanNoPhoto = false;
  for (const tab of tabs.slice(0, 3)) {
    if (!tab.id) continue;
    let result;
    try {
      result = await esosSendProviderMessage(tab.id, {
        type: 'ESOS_SOCIAL_PHOTO_PROFILE_CANDIDATES',
        network: target.network,
        profileUrl: target.url,
      });
    } catch (error) {
      errors.push(`${target.network}: Provider-Bridge ${error.message || 'nicht erreichbar'}`);
      continue;
    }

    if (result?.outcome === 'not_found') {
      cleanNoPhoto = true;
      continue;
    }
    if (result?.outcome === 'error') {
      errors.push(result.error || `${target.network}: Provider-Tab-Abruf fehlgeschlagen`);
      continue;
    }
    if (!Array.isArray(result?.imageUrls) || !result.imageUrls.length) continue;

    const imageErrors = [];
    for (const imageUrl of result.imageUrls) {
      try {
        return await esosReadImageCandidate(imageUrl, target.network);
      } catch (error) {
        imageErrors.push(error.message || 'Bildabruf fehlgeschlagen');
      }
    }
    errors.push(imageErrors.slice(0, 3).join(' | ') || `${target.network}: kein nutzbares Profilbild`);
  }

  if (cleanNoPhoto && errors.length === 0) return { outcome: 'not_found', network: target.network };
  return {
    outcome: 'error',
    error: errors.filter(Boolean).slice(0, 4).join(' | ') || `${target.network}: Provider-Tab-Abruf fehlgeschlagen`,
  };
}

socialPhotoFetchOne = async function(rawTarget) {
  const target = socialPhotoValidateTarget(rawTarget);
  if (!target) return { outcome: 'error', error: 'Ungültiger Social-Profillink.' };

  // 1) Preferred path: an already-open provider tab. Exact open profiles are read
  // from the fully rendered DOM; other profiles are requested from the same origin.
  const providerTab = await esosFetchViaProviderTab(target);
  if (providerTab.outcome === 'found' || providerTab.outcome === 'not_found') return providerTab;

  // 2) Existing extension-origin fetch remains a technical backup.
  const legacyDirect = await esosOriginalSocialPhotoFetchOne(target);
  if (legacyDirect.outcome === 'found' || legacyDirect.outcome === 'not_found') return legacyDirect;

  const errors = [];
  if (providerTab.outcome === 'error' && providerTab.error) errors.push(providerTab.error);
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

console.log('[ESOS AI] SocialPhoto direct route active: rendered DOM -> provider fetch -> extension fetch -> server fallback.');
