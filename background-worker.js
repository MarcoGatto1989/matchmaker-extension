// ESOS AI position + social-photo worker
// Uses the authenticated LinkedIn/XING browser session without opening visible tabs.
importScripts('background.js', 'position-profile-parser.js');

runPositionCheck = async function(job, apiBase, token) {
  const payload = job.payload || {};
  const profileUrl = payload.profileUrl || job.linkedin_url;

  const report = async (success, data = null, platform = null, error = null) => {
    const response = await safeFetch(`${apiBase}/api/position-check-ext/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ jobId: job.id, success, data, platform, error }),
    }, 15000);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`ESOS-Rückgabe fehlgeschlagen (${response.status}) ${detail}`.trim());
    }
  };

  try {
    let url;
    try { url = new URL(String(profileUrl || '')); } catch { url = null; }
    const host = url?.hostname.replace(/^www\./, '').toLowerCase() || '';
    const platform = host === 'xing.com' || host.endsWith('.xing.com') ? 'xing'
      : host === 'linkedin.com' || host.endsWith('.linkedin.com') ? 'linkedin'
        : null;
    const validPath = platform === 'xing'
      ? /^\/(?:profile|pages)\//i.test(url?.pathname || '')
      : platform === 'linkedin'
        ? /^\/in\//i.test(url?.pathname || '')
        : false;
    if (!url || url.protocol !== 'https:' || !platform || !validPath) {
      await report(false, null, platform || payload.network || null, 'Ungültiger LinkedIn-/XING-Profillink.');
      return;
    }

    const response = await safeFetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
      },
    }, 20000);
    if (!response.ok) {
      await report(false, null, platform, `Profil konnte nicht geladen werden (HTTP ${response.status}).`);
      return;
    }

    let finalUrl;
    try { finalUrl = new URL(response.url); } catch { finalUrl = null; }
    const expectedPath = url.pathname.replace(/\/$/, '').toLowerCase();
    const finalPath = finalUrl?.pathname.replace(/\/$/, '').toLowerCase() || '';
    const finalHost = finalUrl?.hostname.replace(/^www\./, '').toLowerCase() || '';
    const sameNetwork = platform === 'xing'
      ? finalHost === 'xing.com' || finalHost.endsWith('.xing.com')
      : finalHost === 'linkedin.com' || finalHost.endsWith('.linkedin.com');
    if (!sameNetwork || (expectedPath !== finalPath && !finalPath.startsWith(`${expectedPath}/`))) {
      await report(false, null, platform, 'Das Netzwerk hat auf eine Login- oder andere Seite umgeleitet.');
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await report(false, null, platform, 'Das Profil lieferte kein lesbares HTML.');
      return;
    }
    const responseText = await response.text();
    if (!responseText || responseText.length < 80) {
      await report(false, null, platform, 'Das Profil lieferte keine auswertbaren öffentlichen Positionsdaten.');
      return;
    }
    const html = responseText.slice(0, 2_500_000);
    const parsed = MatchMakerPositionParser.parseProfileHtml(html, { platform, profileUrl: url.toString() });
    if (!parsed.success) {
      await report(false, null, platform, parsed.error || 'Position konnte nicht ausgelesen werden.');
      return;
    }

    await report(true, parsed.data, platform, null);
    console.log(
      `[Positionsabgleich] Position im Hintergrund geprüft (${platform}, ${parsed.data.positionSource}, ${Math.round(parsed.data.positionConfidence * 100)}%).`,
    );
  } catch (error) {
    console.error('[Positionsabgleich] Fehler:', error.message);
    try {
      await report(false, null, payload.network || null, error.message || 'Positionsprüfung fehlgeschlagen.');
    } catch (reportError) {
      console.error('[Positionsabgleich] Rückmeldung fehlgeschlagen:', reportError.message);
    }
  } finally {
    // Position checks are not outreach jobs. Continue quickly without consuming
    // outreach limits or opening any provider tab.
    setTimeout(() => processNextJob(), 500);
  }
};

const SOCIAL_PHOTO_MAX_BYTES = 1_500_000;
const SOCIAL_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
let socialPhotoBurst = 0;

function socialPhotoNormalizeUrl(raw) {
  return String(raw || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/[),;]+$/, '');
}

function socialPhotoExtractImageUrl(html, network) {
  const candidates = [];
  const metaPatterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["']/ig,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["']/ig,
  ];
  for (const pattern of metaPatterns) {
    let match;
    while ((match = pattern.exec(html))) candidates.push(match[1]);
  }

  const directPattern = /https?:\\?\/\\?\/[^"'\s<>]+/ig;
  let direct;
  while ((direct = directPattern.exec(html)) && candidates.length < 100) candidates.push(direct[0]);

  for (const raw of candidates) {
    const value = socialPhotoNormalizeUrl(raw);
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') continue;
      const lower = value.toLowerCase();
      if (/ghost|default[-_]?avatar|favicon|logo|company[-_]?logo|background[-_]?image|banner/.test(lower)) continue;
      const host = url.hostname.toLowerCase();
      if (network === 'linkedin') {
        if (host.endsWith('licdn.com') || host.endsWith('linkedin.com')) return url.toString();
      } else if (host.includes('xing') || host.endsWith('ctfassets.net') || host.endsWith('xingassets.com')) {
        return url.toString();
      }
    } catch (e) { /* malformed candidate */ }
  }
  return null;
}

function socialPhotoArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function socialPhotoValidateTarget(rawTarget) {
  const network = String(rawTarget?.network || '').toLowerCase();
  let url;
  try { url = new URL(String(rawTarget?.url || '')); } catch { return null; }
  if (url.protocol !== 'https:' || !['linkedin', 'xing'].includes(network)) return null;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const validHost = network === 'linkedin'
    ? host === 'linkedin.com' || host.endsWith('.linkedin.com')
    : host === 'xing.com' || host.endsWith('.xing.com');
  const validPath = network === 'linkedin'
    ? /^\/in\//i.test(url.pathname)
    : /^\/(?:profile|pages)\//i.test(url.pathname);
  if (!validHost || !validPath) return null;
  return { network, url: url.toString() };
}

async function socialPhotoFetchOne(rawTarget) {
  const target = socialPhotoValidateTarget(rawTarget);
  if (!target) return { outcome: 'error', error: 'Ungültiger Social-Profillink.' };

  try {
    const profileResponse = await safeFetch(target.url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
      },
    }, 20000);
    if (!profileResponse.ok) {
      return { outcome: 'error', error: `${target.network}: Profil HTTP ${profileResponse.status}` };
    }

    let finalUrl;
    try { finalUrl = new URL(profileResponse.url); } catch { finalUrl = null; }
    const finalHost = finalUrl?.hostname.replace(/^www\./, '').toLowerCase() || '';
    const sameNetwork = target.network === 'linkedin'
      ? finalHost === 'linkedin.com' || finalHost.endsWith('.linkedin.com')
      : finalHost === 'xing.com' || finalHost.endsWith('.xing.com');
    if (!sameNetwork || /login|signin|auth/i.test(finalUrl?.pathname || '')) {
      return { outcome: 'error', error: `${target.network}: auf Login/andere Seite umgeleitet` };
    }

    const type = profileResponse.headers.get('content-type') || '';
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
      return { outcome: 'error', error: `${target.network}: Profil lieferte kein HTML` };
    }
    const html = (await profileResponse.text()).slice(0, 2_500_000);
    if (!html) return { outcome: 'error', error: `${target.network}: Profilseite leer` };
    const imageUrl = socialPhotoExtractImageUrl(html, target.network);
    if (!imageUrl) return { outcome: 'not_found', network: target.network };

    const imageResponse = await safeFetch(imageUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' },
    }, 15000);
    if (!imageResponse.ok) return { outcome: 'error', error: `${target.network}: Bild HTTP ${imageResponse.status}` };
    const mimeType = (imageResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!SOCIAL_PHOTO_TYPES.has(mimeType)) return { outcome: 'error', error: `${target.network}: kein unterstütztes Bildformat` };
    const declared = Number(imageResponse.headers.get('content-length') || 0);
    if (declared > SOCIAL_PHOTO_MAX_BYTES) return { outcome: 'error', error: `${target.network}: Profilbild zu groß` };
    const buffer = await imageResponse.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > SOCIAL_PHOTO_MAX_BYTES) {
      return { outcome: 'error', error: `${target.network}: Profilbild leer oder zu groß` };
    }
    return {
      outcome: 'found',
      network: target.network,
      mimeType,
      imageBase64: socialPhotoArrayBufferToBase64(buffer),
      sourceUrl: imageResponse.url || imageUrl,
    };
  } catch (error) {
    return { outcome: 'error', error: `${target.network}: ${error.message || 'Abruf fehlgeschlagen'}` };
  }
}

async function runSocialProfilePhotoJob(job, apiBase, token) {
  const payload = job.payload || {};
  const targets = Array.isArray(payload.profileUrls) ? payload.profileUrls : [];
  const errors = [];
  let cleanNoPhotoCount = 0;

  for (const target of targets) {
    const result = await socialPhotoFetchOne(target);
    if (result.outcome === 'found') {
      const response = await safeFetch(`${apiBase}/api/position-check-ext/social-profile-photos/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          jobId: job.id,
          outcome: 'found',
          source: `${result.network}_esos_ai_extension`,
          sourceUrl: result.sourceUrl,
          mimeType: result.mimeType,
          imageBase64: result.imageBase64,
        }),
      }, 20000);
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`ESOS-Bildrückgabe fehlgeschlagen (${response.status}) ${detail}`.trim());
      }
      console.log(`[SocialPhoto] Bild für ${job.candidate_name || payload.contactId} über ${result.network} gespeichert.`);
      return;
    }
    if (result.outcome === 'not_found') cleanNoPhotoCount += 1;
    else errors.push(result.error || 'Unbekannter ESOS-AI-Fehler');
  }

  const outcome = errors.length ? 'error' : 'not_found';
  const response = await safeFetch(`${apiBase}/api/position-check-ext/social-profile-photos/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({
      jobId: job.id,
      outcome,
      error: errors.join(' | ').slice(0, 500) || (cleanNoPhotoCount ? null : 'Keine verwertbaren Profillinks.'),
    }),
  }, 25000);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ESOS-Bildrückgabe fehlgeschlagen (${response.status}) ${detail}`.trim());
  }
}

// Keep photo imports outside the outreach queue. The wrapper gives them priority
// in short bursts, then yields back to position checks / KandiScout / outreach.
const standardProcessNextJob = processNextJob;
processNextJob = async function() {
  if (isProcessing) return;

  const token = await getToken();
  const apiBase = await getApiBase();
  if (token && socialPhotoBurst < 3) {
    let handled = false;
    isProcessing = true;
    try {
      const response = await safeFetch(`${apiBase}/api/position-check-ext/social-profile-photos/jobs/queued?limit=1`, {
        headers: { 'Authorization': 'Bearer ' + token },
      }, 10000);
      if (response.ok) {
        const jobs = await response.json();
        if (Array.isArray(jobs) && jobs.length) {
          handled = true;
          socialPhotoBurst += 1;
          await runSocialProfilePhotoJob(jobs[0], apiBase, token);
        }
      }
    } catch (error) {
      console.warn('[SocialPhoto] Hintergrundabruf fehlgeschlagen:', error.message);
    } finally {
      isProcessing = false;
    }
    if (handled) {
      setTimeout(() => processNextJob(), 600);
      return;
    }
  }

  socialPhotoBurst = 0;
  return standardProcessNextJob();
};

// Refresh the connection immediately after install/reload and pick up queued
// interactive work without waiting for the next alarm tick.
sendHeartbeat();
setTimeout(() => processNextJob(), 250);
