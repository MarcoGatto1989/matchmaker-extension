// ESOS AI v4.0.6 social-photo worker refinements.
// Builds on v4.0.5 and reduces false image candidates / noisy XING errors.
importScripts('service-worker.js');

const ESOS_V406_MAX_BYTES = 1_500_000;
const esosV405SocialPhotoFetchOne = socialPhotoFetchOne;

function esosV406ObviousNonImageUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    const path = url.pathname.toLowerCase();
    return /\.(?:js|mjs|css|json|map|woff2?|ttf|otf|svg)(?:$|[/?#])/.test(path)
      || /(?:javascript|webpack|chunk|runtime|polyfill|stylesheet|font)/i.test(path);
  } catch (_) {
    return true;
  }
}

function esosV406SniffMime(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12) {
    const ascii = String.fromCharCode(...bytes.subarray(0, Math.min(20, bytes.length)));
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
    if (ascii.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii.slice(8, 12))) return 'image/avif';
  }
  return null;
}

async function esosV406AvifToWebp(buffer) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('AVIF kann in diesem Browser-Worker nicht konvertiert werden');
  }
  const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/avif' }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Bildkonvertierung nicht verfügbar');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 });
    const converted = await blob.arrayBuffer();
    if (!converted.byteLength || converted.byteLength > ESOS_V406_MAX_BYTES) {
      throw new Error('Konvertiertes Profilbild ist leer oder zu groß');
    }
    return converted;
  } finally {
    try { bitmap.close(); } catch (_) {}
  }
}

// Override the v4.0.5 candidate download only. JPEG/WebP/PNG are preferred before
// AVIF, and cookie-free CDN access is tried first. This matches how social image
// CDNs normally work and avoids the repeated "include: Failed to fetch" noise.
esosReadImageCandidate = async function(imageUrl, network) {
  if (esosV406ObviousNonImageUrl(imageUrl)) {
    throw new Error(`${network}: Bildkandidat verworfen (kein Bild-Asset)`);
  }

  const errors = [];
  for (const credentials of ['omit', 'include']) {
    try {
      const response = await safeFetch(imageUrl, {
        method: 'GET',
        credentials,
        cache: 'no-store',
        redirect: 'follow',
        headers: {
          Accept: 'image/jpeg,image/webp;q=0.96,image/png;q=0.90,image/avif;q=0.65,*/*;q=0.05',
        },
      }, 15000);

      if (!response.ok) throw new Error(`Bild HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > ESOS_V406_MAX_BYTES) throw new Error('Profilbild zu groß');

      const headerType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (/^(?:application\/(?:javascript|json)|text\/|text$)/i.test(headerType)) {
        throw new Error(`kein Bild (${headerType})`);
      }

      let buffer = await response.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > ESOS_V406_MAX_BYTES) {
        throw new Error('Profilbild leer oder zu groß');
      }

      let mimeType = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(headerType)
        ? headerType
        : esosV406SniffMime(buffer);
      if (!mimeType) throw new Error(`kein unterstütztes Profilbild${headerType ? ` (${headerType})` : ''}`);

      // ESOS stores JPEG/PNG/WebP. If a CDN still insists on AVIF despite our Accept
      // preference, normalize it in-browser instead of turning it into an error.
      if (mimeType === 'image/avif') {
        buffer = await esosV406AvifToWebp(buffer);
        mimeType = 'image/webp';
      }

      return {
        outcome: 'found',
        network,
        mimeType,
        imageBase64: socialPhotoArrayBufferToBase64(buffer),
        sourceUrl: response.url || imageUrl,
      };
    } catch (error) {
      errors.push(`${credentials}: ${error?.message || 'Bildabruf fehlgeschlagen'}`);
    }
  }

  throw new Error(errors.slice(0, 2).join(' | '));
};

// Deleted / retired social profiles are not technical failures. Treat provider
// 404/410 as a clean no-photo result so the live preview is not flooded in red.
socialPhotoFetchOne = async function(rawTarget) {
  const result = await esosV405SocialPhotoFetchOne(rawTarget);
  if (result?.outcome === 'error' && /Profil HTTP (?:404|410)\b/i.test(String(result.error || ''))) {
    const target = socialPhotoValidateTarget(rawTarget);
    return { outcome: 'not_found', network: target?.network || String(rawTarget?.network || '') };
  }
  return result;
};

// Existing provider tabs do not receive new content scripts after extension reload.
// Inject the v4.0.6 exact-profile fast path once so open tabs benefit immediately.
async function esosV406BootstrapFastPath() {
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://linkedin.com/*', 'https://www.linkedin.com/*', 'https://*.linkedin.com/*',
      'https://xing.com/*', 'https://www.xing.com/*', 'https://*.xing.com/*',
    ] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['profile-photo-dom-fix.js', 'social-photo-content-fastpath-v406.js'],
        });
      } catch (_) {}
    }
  } catch (_) {}
}
setTimeout(esosV406BootstrapFastPath, 250);

console.log('[ESOS AI] v4.0.6 photo refinements active: exact DOM, JPEG/WebP preference, AVIF normalization.');
