// MatchMaker BOOT v3.6 position worker
// Reads an existing LinkedIn/XING profile with the browser session in a
// background request. It never creates or activates a browser tab.
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
    const html = (await response.text()).slice(0, 2_000_000);
    const parsed = MatchMakerPositionParser.parseProfileHtml(html, { platform, profileUrl: url.toString() });
    if (!parsed.success) {
      await report(false, null, platform, parsed.error || 'Position konnte nicht ausgelesen werden.');
      return;
    }

    await report(true, parsed.data, platform, null);
    console.log(`[Positionsabgleich] ${job.candidate_name} im Hintergrund geprüft (${platform}).`);
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

// Refresh the connection immediately after install/reload and pick up an
// already queued interactive check without waiting for the next alarm tick.
sendHeartbeat();
setTimeout(() => processNextJob(), 250);
